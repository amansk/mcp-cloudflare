import { OAuthSession, AccessToken } from './types';

const WLVY_PREFIX = 'WLVY';
const AUTH_URL = 'https://wellavy.co/auth/oauth';

export class OAuthHandler {
  private env: any;

  constructor(env: any) {
    this.env = env;
  }

  generateWLVYCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `${WLVY_PREFIX}-${code}`;
  }

  generateCodeChallenge(verifier: string): string {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const hash = crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(hash as any)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  generateCodeVerifier(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return btoa(String.fromCharCode(...array))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  async initiateOAuth(request: Request): Promise<Response> {
    const code = this.generateWLVYCode();
    const state = crypto.randomUUID();
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = this.generateCodeChallenge(codeVerifier);

    const session: OAuthSession = {
      code,
      state,
      codeChallenge,
      codeVerifier,
      createdAt: Date.now(),
      expiresAt: Date.now() + (5 * 60 * 1000) // 5 minutes
    };

    // Store in KV
    await this.env.OAUTH_CODES.put(code, JSON.stringify(session), {
      expirationTtl: 300 // 5 minutes
    });

    const authUrl = new URL(AUTH_URL);
    authUrl.searchParams.set('code', code);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    return new Response(JSON.stringify({
      success: true,
      code,
      auth_url: authUrl.toString(),
      expires_in: 300
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async handleCallback(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    if (!code || !state) {
      return new Response(JSON.stringify({
        error: 'missing_parameters',
        error_description: 'Code and state are required'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Retrieve session from KV
    const sessionData = await this.env.OAUTH_CODES.get(code);
    if (!sessionData) {
      return new Response(JSON.stringify({
        error: 'invalid_code',
        error_description: 'Invalid or expired authorization code'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const session: OAuthSession = JSON.parse(sessionData);

    // Validate state
    if (session.state !== state) {
      return new Response(JSON.stringify({
        error: 'invalid_state',
        error_description: 'State mismatch'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Generate access token
    const accessToken = crypto.randomUUID();
    const tokenData: AccessToken = {
      token: accessToken,
      userId: `user_${code}`, // In production, this would be a real user ID
      createdAt: Date.now(),
      expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
    };

    // Store access token
    await this.env.ACCESS_TOKENS.put(accessToken, JSON.stringify(tokenData), {
      expirationTtl: 86400 // 24 hours
    });

    // Clean up used code
    await this.env.OAUTH_CODES.delete(code);

    // Return HTML with success message and token
    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Authorization Successful</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    .container {
      background: white;
      padding: 2rem;
      border-radius: 8px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      text-align: center;
      max-width: 400px;
    }
    h1 {
      color: #4c51bf;
      margin-bottom: 1rem;
    }
    .token {
      background: #f7fafc;
      padding: 1rem;
      border-radius: 4px;
      font-family: monospace;
      word-break: break-all;
      margin: 1rem 0;
      border: 1px solid #e2e8f0;
    }
    .success {
      color: #48bb78;
      font-size: 1.2rem;
      margin: 1rem 0;
    }
    .instruction {
      color: #718096;
      margin-top: 1rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1> Authorization Successful</h1>
    <p class="success">Your MCP server has been authorized!</p>
    <div class="token">
      <strong>Access Token:</strong><br>
      ${accessToken}
    </div>
    <p class="instruction">
      You can now close this window and return to Claude Desktop.
    </p>
  </div>
</body>
</html>
    `;

    return new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html' }
    });
  }

  async validateToken(token: string): Promise<boolean> {
    const tokenData = await this.env.ACCESS_TOKENS.get(token);
    if (!tokenData) return false;

    const accessToken: AccessToken = JSON.parse(tokenData);
    return accessToken.expiresAt > Date.now();
  }

  extractToken(request: Request): string | null {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) return null;

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') return null;

    return parts[1];
  }
}