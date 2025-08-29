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

// Handle MCP JSON-RPC requests for StreamableHttp transport
async function handleMCPRequest(request: any, env: Env): Promise<any> {
  console.log('Handling MCP request:', request.method);
  
  switch (request.method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
            resources: {},
            prompts: {}
          },
          serverInfo: {
            name: 'mcp-cloudflare',
            version: '1.0.0'
          }
        },
        id: request.id
      };

    case 'initialized':
      return {
        jsonrpc: '2.0',
        result: {},
        id: request.id
      };

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        result: {
          tools: [
            {
              name: 'test_tool',
              description: 'A simple test tool that responds with OK',
              input_schema: {
                type: 'object',
                properties: {
                  message: {
                    type: 'string',
                    description: 'Optional message'
                  }
                },
                required: []
              }
            },
            {
              name: 'get_time',
              description: 'Get the current time',
              input_schema: {
                type: 'object',
                properties: {
                  timezone: {
                    type: 'string',
                    description: 'Timezone (e.g., UTC, America/New_York)'
                  }
                },
                required: []
              }
            },
            {
              name: 'echo',
              description: 'Echo back the provided message',
              input_schema: {
                type: 'object',
                properties: {
                  text: {
                    type: 'string',
                    description: 'Text to echo back'
                  }
                },
                required: ['text']
              }
            }
          ]
        },
        id: request.id
      };

    case 'tools/call':
      const { name, arguments: args } = request.params;
      
      switch (name) {
        case 'test_tool':
          return {
            jsonrpc: '2.0',
            result: {
              content: [
                {
                  type: 'text',
                  text: `OK: ${args?.message || 'Test successful'}`
                }
              ]
            },
            id: request.id
          };

        case 'get_time':
          const now = new Date();
          const timezone = args?.timezone || 'UTC';
          const timeString = now.toLocaleString('en-US', { timeZone: timezone });
          return {
            jsonrpc: '2.0',
            result: {
              content: [
                {
                  type: 'text',
                  text: `Current time in ${timezone}: ${timeString}`
                }
              ]
            },
            id: request.id
          };

        case 'echo':
          return {
            jsonrpc: '2.0',
            result: {
              content: [
                {
                  type: 'text',
                  text: args.text
                }
              ]
            },
            id: request.id
          };

        default:
          return {
            jsonrpc: '2.0',
            error: {
              code: -32601,
              message: `Unknown tool: ${name}`
            },
            id: request.id
          };
      }

    default:
      return {
        jsonrpc: '2.0',
        error: {
          code: -32601,
          message: `Method not found: ${request.method}`
        },
        id: request.id
      };
  }
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

    // OAuth discovery endpoints (EXACTLY like original prototype)
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      const baseUrl = 'https://mcp-cloudflare.amansk.workers.dev';
      return new Response(JSON.stringify({
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/oauth/authorize`,
        token_endpoint: `${baseUrl}/oauth/token`,
        registration_endpoint: `${baseUrl}/oauth/register`,
        response_types_supported: ['code'],
        response_modes_supported: ['query'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
        revocation_endpoint: `${baseUrl}/oauth/revoke`,
        code_challenge_methods_supported: ['plain', 'S256']  // THIS WAS MISSING!
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    if (url.pathname === '/.well-known/mcp_oauth') {
      const baseUrl = 'https://mcp-cloudflare.amansk.workers.dev';
      return new Response(JSON.stringify({
        authorization_endpoint: `${baseUrl}/oauth/authorize`,
        token_endpoint: `${baseUrl}/oauth/token`,
        device_authorization_endpoint: `${baseUrl}/oauth/device`,
        supported_response_types: ['code'],
        grant_types_supported: ['authorization_code', 'urn:ietf:params:oauth:grant-type:device_code']
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

    // Client registration (EXACTLY like original prototype)
    if (url.pathname === '/oauth/register') {
      let body: any = {};
      try {
        if (request.method === 'POST') {
          body = await request.json();
        }
      } catch (e) {
        // Ignore parse errors
      }
      
      const clientId = crypto.randomUUID();
      const clientSecret = crypto.randomUUID();
      
      return new Response(JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_secret_expires_at: 0, // Never expires
        redirect_uris: body.redirect_uris || [],
        token_endpoint_auth_method: 'client_secret_basic',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code']
      }), {
        status: 200,  // Original uses 200, not 201
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }


    // MCP endpoints - support both SSE and HTTP transports
    if (url.pathname === '/mcp' || url.pathname === '/sse') {
      // Extract token for validation
      const token = oauthHandler.extractToken(request);
      
      // For POST requests (StreamableHttp), also check body for auth
      let isAuthenticated = false;
      if (token) {
        isAuthenticated = await oauthHandler.validateToken(token);
      }
      
      if (!isAuthenticated && !token) {
        return new Response(JSON.stringify({
          error: 'invalid_token',
          error_description: 'Missing or invalid bearer token'
        }), {
          status: 401,
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }

      if (!isAuthenticated) {
        console.log('Token validation failed for:', token);
        return new Response(JSON.stringify({
          error: 'invalid_token', 
          error_description: 'Missing or invalid bearer token'
        }), {
          status: 401,
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }

      // For HTTP POST (StreamableHttp transport), handle JSON-RPC directly
      if (request.method === 'POST') {
        const body = await request.json();
        console.log('MCP HTTP Request:', body);
        
        // Handle JSON-RPC requests
        if (body.jsonrpc === '2.0') {
          const response = await handleMCPRequest(body, env);
          return new Response(JSON.stringify(response), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            }
          });
        }
      }

      // For GET requests, use SSE (deprecated but still supported)
      if (request.method === 'GET') {
        // Route to Durable Object for SSE
        const id = env.MCP_SERVER.idFromName('global-mcp-server');
        const stub = env.MCP_SERVER.get(id);
        return await stub.fetch(request);
      }

      return new Response('Method not allowed', { status: 405 });
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