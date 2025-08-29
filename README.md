# MCP Cloudflare Server

A Model Context Protocol (MCP) server implementation using Cloudflare Workers with OAuth authentication.

## Features

- OAuth 2.0 authentication with WLVY code-based flow
- Server-Sent Events (SSE) for MCP communication
- Durable Objects for stateful connections
- KV storage for OAuth codes and access tokens
- Test tools included (test_tool, get_time, echo)

## Architecture

- **Cloudflare Workers**: Main request handler
- **Durable Objects**: Manages MCP server sessions
- **KV Namespaces**: Stores OAuth codes and access tokens
- **SSE Transport**: Real-time bidirectional communication

## Endpoints

- `/health` - Health check endpoint
- `/oauth/initiate` - Start OAuth flow with WLVY code
- `/oauth/callback` - OAuth callback handler
- `/mcp` or `/sse` - MCP server endpoint (requires authentication)

## Local Development

```bash
npm install
npx wrangler dev
```

## Deployment

```bash
npx wrangler deploy
```

## OAuth Flow

1. Client calls `/oauth/initiate` to get a WLVY-XXXX code
2. User enters code on wellavy.co/auth/oauth
3. After authorization, callback returns access token
4. Use Bearer token for `/mcp` endpoint access

## Environment Variables

- `FIXED_API_KEY` - API key for testing
- `ENVIRONMENT` - Environment name (development/production)

## License

MIT