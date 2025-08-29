import { OAuthHandler } from './oauth';
import { MCPServerDO } from './mcp-server';

export { MCPServerDO };

export interface Env {
  MCP_SERVER: DurableObjectNamespace;
  OAUTH_CODES: KVNamespace;
  ACCESS_TOKENS: KVNamespace;
  FIXED_API_KEY: string;
  ENVIRONMENT: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const oauthHandler = new OAuthHandler(env);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, X-Requested-With',
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Max-Age': '86400'
        }
      });
    }

    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'healthy',
        environment: env.ENVIRONMENT,
        timestamp: new Date().toISOString()
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // OAuth discovery endpoints
    if (url.pathname === '/.well-known/oauth-authorization-server' || 
        url.pathname === '/.well-known/mcp_oauth') {
      const baseUrl = 'https://mcp-cloudflare.amansk.workers.dev';
      return new Response(JSON.stringify({
        issuer: baseUrl,  // MCP Inspector requires this
        authorization_endpoint: `${baseUrl}/oauth/authorize`,
        token_endpoint: `${baseUrl}/oauth/token`,
        registration_endpoint: `${baseUrl}/oauth/register`,  // MCP Inspector requires this
        response_types_supported: ['code'],  // MCP Inspector requires this exact field name
        grant_types_supported: ['authorization_code'],
        token_endpoint_auth_methods_supported: ['none']
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // OAuth endpoints
    if (url.pathname === '/oauth/authorize') {
      // This is what Claude Desktop calls
      return await oauthHandler.initiateOAuth(request);
    }

    if (url.pathname === '/oauth/initiate') {
      // For manual testing
      return await oauthHandler.initiateOAuth(request);
    }

    if (url.pathname === '/auth') {
      return await oauthHandler.showAuthPage(request);
    }

    if (url.pathname === '/auth/submit') {
      return await oauthHandler.handleAuthSubmit(request);
    }

    if (url.pathname === '/oauth/callback') {
      return await oauthHandler.handleCallback(request);
    }

    if (url.pathname === '/oauth/token') {
      return await oauthHandler.handleTokenExchange(request);
    }

    // Simple client registration for MCP Inspector
    if (url.pathname === '/oauth/register') {
      const clientId = crypto.randomUUID();
      return new Response(JSON.stringify({
        client_id: clientId,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none'
      }), {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }


    // MCP endpoints - route to Durable Object
    if (url.pathname === '/mcp' || url.pathname === '/sse') {
      // Extract token for validation
      const token = oauthHandler.extractToken(request);
      if (!token) {
        return new Response(JSON.stringify({
          error: 'unauthorized',
          error_description: 'Missing authorization token'
        }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Validate token
      const isValid = await oauthHandler.validateToken(token);
      if (!isValid) {
        return new Response(JSON.stringify({
          error: 'unauthorized',
          error_description: 'Invalid or expired token'
        }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Route to Durable Object
      const id = env.MCP_SERVER.idFromName('global-mcp-server');
      const stub = env.MCP_SERVER.get(id);
      
      // Forward the request to the Durable Object
      return await stub.fetch(request);
    }

    // API endpoints (for testing)
    if (url.pathname === '/api/test' && request.headers.get('X-API-Key') === env.FIXED_API_KEY) {
      return new Response(JSON.stringify({
        success: true,
        message: 'API key validated',
        timestamp: new Date().toISOString()
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Root endpoint - check for token, return OAuth error if missing (like Torch)
    if (url.pathname === '/') {
      const token = oauthHandler.extractToken(request);
      
      if (!token) {
        // Return OAuth error with WWW-Authenticate header (like Torch)
        return new Response(JSON.stringify({
          error: 'invalid_token',
          error_description: 'Missing or invalid bearer token'
        }), {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            'WWW-Authenticate': 'Bearer realm="https://mcp-cloudflare.amansk.workers.dev", error="invalid_token", error_description="Missing or invalid bearer token"',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
      
      // If token present, redirect to /mcp
      return Response.redirect(new URL('/mcp', request.url).toString(), 302);
    }

    // Default response
    return new Response(JSON.stringify({
      name: 'MCP Cloudflare Server',
      version: '1.0.0',
      endpoints: {
        oauth: {
          authorize: '/oauth/authorize',
          callback: '/oauth/callback'
        },
        mcp: {
          sse: '/mcp'
        },
        health: '/health'
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};