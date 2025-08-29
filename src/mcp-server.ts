import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { MCPTool, MCPRequest, MCPResponse } from './types';

export class MCPServerDO {
  private state: DurableObjectState;
  private env: any;
  private sessions: Map<string, any>;

  constructor(state: DurableObjectState, env: any) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    // Handle SSE connections
    if (url.pathname === '/sse' || url.pathname === '/mcp') {
      return this.handleSSE(request);
    }

    return new Response('Not Found', { status: 404 });
  }

  async handleSSE(request: Request): Promise<Response> {
    // Extract and validate token
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({
        error: 'unauthorized',
        error_description: 'Invalid or missing authorization token'
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const token = authHeader.substring(7);
    
    // Validate token with KV store
    const tokenData = await this.env.ACCESS_TOKENS.get(token);
    if (!tokenData) {
      return new Response(JSON.stringify({
        error: 'unauthorized',
        error_description: 'Invalid access token'
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Create SSE response
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // Store session
    const sessionId = crypto.randomUUID();
    this.sessions.set(sessionId, {
      writer,
      token,
      createdAt: Date.now()
    });

    // Send initial connection message
    await writer.write(encoder.encode('data: {"type":"connection","status":"connected"}\n\n'));

    // Handle incoming messages
    this.handleMessages(sessionId, request);

    return new Response(readable, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    });
  }

  async handleMessages(sessionId: string, request: Request) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const encoder = new TextEncoder();
    const { writer } = session;

    try {
      // Process incoming messages if this is a POST with body
      if (request.method === 'POST' && request.body) {
        const reader = request.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const text = decoder.decode(value);
          const lines = text.split('\n');

          for (const line of lines) {
            if (line.trim() && !line.startsWith(':')) {
              try {
                const message: MCPRequest = JSON.parse(line);
                const response = await this.handleMCPRequest(message);
                
                // Send response via SSE
                const responseText = `data: ${JSON.stringify(response)}\n\n`;
                await writer.write(encoder.encode(responseText));
              } catch (e) {
                console.error('Error processing message:', e);
              }
            }
          }
        }
      } else {
        // For GET requests, just keep the connection alive
        // and wait for the client to send messages via POST
        // In practice, MCP uses bidirectional communication
        
        // Send periodic heartbeat
        const heartbeatInterval = setInterval(async () => {
          try {
            await writer.write(encoder.encode(':heartbeat\n\n'));
          } catch (e) {
            clearInterval(heartbeatInterval);
            this.sessions.delete(sessionId);
          }
        }, 30000); // Every 30 seconds
      }
    } catch (error) {
      console.error('Session error:', error);
      this.sessions.delete(sessionId);
    }
  }

  async handleMCPRequest(request: MCPRequest): Promise<MCPResponse> {
    console.log('MCP Request:', request);

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
            tools: this.getTools()
          },
          id: request.id
        };

      case 'tools/call':
        return await this.handleToolCall(request);

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

  getTools(): MCPTool[] {
    return [
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
    ];
  }

  async handleToolCall(request: MCPRequest): Promise<MCPResponse> {
    const { name, arguments: args } = request.params;

    console.log('Tool call:', name, args);

    try {
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
    } catch (error: any) {
      return {
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: error.message || 'Internal error'
        },
        id: request.id
      };
    }
  }
}