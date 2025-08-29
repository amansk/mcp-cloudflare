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
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

    // OAuth endpoints
    if (url.pathname === '/oauth/initiate') {
      return await oauthHandler.initiateOAuth(request);
    }

    if (url.pathname === '/oauth/callback') {
      return await oauthHandler.handleCallback(request);
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

    // Default response
    return new Response(JSON.stringify({
      name: 'MCP Cloudflare Server',
      version: '1.0.0',
      endpoints: {
        oauth: {
          initiate: '/oauth/initiate',
          callback: '/oauth/callback'
        },
        mcp: {
          sse: '/mcp',
          alternate: '/sse'
        },
        health: '/health'
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};