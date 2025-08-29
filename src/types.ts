export interface OAuthSession {
  code: string;
  state: string;
  codeChallenge: string;
  codeVerifier: string;
  createdAt: number;
  expiresAt: number;
  authorized?: boolean;
}

export interface AccessToken {
  token: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
}

export interface MCPTool {
  name: string;
  description: string;
  input_schema: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
  };
}

export interface MCPRequest {
  jsonrpc: string;
  method: string;
  params?: any;
  id: string | number;
}

export interface MCPResponse {
  jsonrpc: string;
  result?: any;
  error?: {
    code: number;
    message: string;
  };
  id: string | number;
}