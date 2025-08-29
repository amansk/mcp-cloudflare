import { OAuthSession, AccessToken } from './types';

const WLVY_PREFIX = 'WLVY';

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
    const url = new URL(request.url);
    const redirectUri = url.searchParams.get('redirect_uri');
    const state = url.searchParams.get('state') || crypto.randomUUID();
    
    // Generate WLVY code
    const code = this.generateWLVYCode();
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

    // Redirect to our auth page with the code
    const baseUrl = 'https://mcp-cloudflare.amansk.workers.dev';
    const authUrl = new URL(`${baseUrl}/auth`);
    authUrl.searchParams.set('code', code);
    authUrl.searchParams.set('state', state);
    if (redirectUri) {
      authUrl.searchParams.set('redirect_uri', redirectUri);
    }

    return Response.redirect(authUrl.toString(), 302);
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

  async showAuthPage(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const redirectUri = url.searchParams.get('redirect_uri');

    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Authorize MCP Server</title>
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
    .code-display {
      background: #f7fafc;
      padding: 1.5rem;
      border-radius: 4px;
      font-family: monospace;
      font-size: 1.5rem;
      font-weight: bold;
      margin: 1rem 0;
      border: 2px solid #667eea;
      color: #4c51bf;
    }
    button {
      background: #667eea;
      color: white;
      border: none;
      padding: 0.75rem 2rem;
      font-size: 1rem;
      border-radius: 4px;
      cursor: pointer;
      margin-top: 1rem;
      width: 100%;
    }
    button:hover {
      background: #5a67d8;
    }
    .instruction {
      color: #718096;
      margin: 1rem 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Authorize MCP Server</h1>
    <p class="instruction">Your authorization code is:</p>
    <div class="code-display">${code}</div>
    <p class="instruction">Enter this code on the Wellavy app to complete authorization</p>
    <form method="POST" action="/auth/submit">
      <input type="hidden" name="code" value="${code}">
      <input type="hidden" name="state" value="${state}">
      <input type="hidden" name="redirect_uri" value="${redirectUri || ''}">
      <button type="submit">I've Entered the Code - Complete Authorization</button>
    </form>
  </div>
</body>
</html>
    `;

    return new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html' }
    });
  }

  async handleAuthSubmit(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const formData = await request.formData();
    const code = formData.get('code') as string;
    const state = formData.get('state') as string;
    const redirectUri = formData.get('redirect_uri') as string;

    if (!code || !code.startsWith('WLVY-')) {
      return new Response('Invalid code', { status: 400 });
    }

    // Verify code exists in KV
    const sessionData = await this.env.OAUTH_CODES.get(code);
    if (!sessionData) {
      return new Response('Code not found or expired', { status: 400 });
    }

    const session: OAuthSession = JSON.parse(sessionData);

    // Verify state matches
    if (session.state !== state) {
      return new Response('State mismatch', { status: 400 });
    }

    // Generate access token
    const accessToken = crypto.randomUUID();
    const tokenData: AccessToken = {
      token: accessToken,
      userId: `user_${code}`,
      createdAt: Date.now(),
      expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
    };

    // Store access token
    await this.env.ACCESS_TOKENS.put(accessToken, JSON.stringify(tokenData), {
      expirationTtl: 86400 // 24 hours
    });

    // Clean up used code
    await this.env.OAUTH_CODES.delete(code);

    // If we have a redirect URI, redirect back with the token
    if (redirectUri) {
      const callbackUrl = new URL(redirectUri);
      callbackUrl.searchParams.set('access_token', accessToken);
      callbackUrl.searchParams.set('token_type', 'Bearer');
      callbackUrl.searchParams.set('state', state);
      return Response.redirect(callbackUrl.toString(), 302);
    }

    // Otherwise show success page
    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Authorization Complete</title>
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
      color: #48bb78;
      margin-bottom: 1rem;
    }
    .success {
      color: #48bb78;
      font-size: 1.2rem;
      margin: 1rem 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>✓ Authorization Complete</h1>
    <p class="success">You can now close this window and return to Claude Desktop.</p>
  </div>
</body>
</html>
    `;

    return new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html' }
    });
  }
}