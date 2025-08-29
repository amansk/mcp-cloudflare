# Deployment Instructions

## API Token Permissions (Minimal)

When creating your API token, you only need:

**Account Permissions:**
- Account → Workers KV Storage → Edit
- Account → Workers Scripts → Edit
- Account → Account Settings → Read (for account ID)

**Zone Permissions:**
- None needed (unless using custom domain)

Note: "Workers Routes" permission is NOT needed for `*.workers.dev` deployments

## Step 1: Authenticate with Cloudflare

Option A - Interactive login (recommended):
```bash
npx wrangler login
```

Option B - Use API token:
```bash
export CLOUDFLARE_API_TOKEN="your-token-here"
```

## Step 2: Create KV Namespaces

Run these commands and save the IDs:
```bash
npx wrangler kv namespace create "OAUTH_CODES"
npx wrangler kv namespace create "ACCESS_TOKENS"
```

## Step 3: Update wrangler.toml

Replace the placeholder IDs with the real ones from Step 2:

```toml
[[kv_namespaces]]
binding = "OAUTH_CODES"
id = "YOUR_ACTUAL_OAUTH_CODES_ID_HERE"

[[kv_namespaces]]
binding = "ACCESS_TOKENS"
id = "YOUR_ACTUAL_ACCESS_TOKENS_ID_HERE"
```

## Step 4: Deploy

```bash
npx wrangler deploy
```

## Step 5: Get your Worker URL

After deployment, you'll get a URL like:
`https://mcp-cloudflare.YOUR-SUBDOMAIN.workers.dev`

## Step 6: Test OAuth Flow

```bash
curl https://mcp-cloudflare.YOUR-SUBDOMAIN.workers.dev/oauth/initiate
```

This will return a WLVY code to use on wellavy.co/auth/oauth