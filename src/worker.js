// Sigil MCP server (Streamable HTTP transport, MCP spec 2025-03-26).
//
// Sigil ships as a separate MCP surface (P35 Shape B). One Worker, two hosts:
//   - mcp.sigil.tunnelmind.ai/mcp        — JSON-RPC 2.0 MCP endpoint
//   - sigil.tunnelmind.ai/.well-known/mcp.json — discovery card
//
// Methods: initialize, notifications/initialized, tools/list, tools/call, ping.
// The Authorization header on an MCP request is passed through to the Sigil
// API, so an MCP client with a paid TunnelMind key gets its tier; anonymous
// clients get the free tier (rate-limited). Discovery is always unauthenticated.

import { findTool, listToolsForResponse, TOOLS } from './tools.js';

const PROTOCOL_VERSION = '2025-03-26';
const SERVER_INFO = { name: 'sigil', version: '0.2.0' };

const MCP_CARD = {
  schema_version: 'mcp-server-card/1.0-draft',
  name: 'TunnelMind Sigil',
  registry_name: 'ai.tunnelmind/sigil',
  description: 'Agentic supply verification for programmatic advertising: ads.txt authorization, IP classification, app-bundle and supply-path verification, entity trust scoring, ATAP receipts, and the cross_lens_verify fused Scry × Sigil verdict.',
  server_url: 'https://mcp.sigil.tunnelmind.ai',
  transport: 'streamable-http',
  tools_count: TOOLS.length,
  auth: {
    type: 'oauth2',
    authorization_url: 'https://auth.tunnelmind.ai/oauth/authorize',
    token_url: 'https://auth.tunnelmind.ai/oauth/token',
    scopes: ['sigil:verify', 'sigil:attest', 'sigil:score', 'sigil:receipt'],
  },
  openapi_url: 'https://data.tunnelmind.ai/.well-known/openapi.json',
  homepage: 'https://tunnelmind.ai',
  contact: 'api@tunnelmind.ai',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const { pathname } = url;

    if (method === 'GET' && pathname === '/.well-known/mcp.json') {
      return jsonResponse(MCP_CARD);
    }
    if (method === 'GET' && (pathname === '/' || pathname === '')) {
      return jsonResponse({
        service: 'sigil-mcp',
        version: SERVER_INFO.version,
        protocol: PROTOCOL_VERSION,
        transport: 'streamable-http',
        endpoint: 'POST /mcp',
        discovery: 'GET /.well-known/mcp.json',
        tools: TOOLS.map((t) => t.name),
      });
    }
    if (method === 'POST' && pathname === '/mcp') {
      return handleMcp(request, env);
    }
    return jsonResponse({ error: 'not found' }, 404);
  },
};

async function handleMcp(request, env) {
  let req;
  try {
    req = await request.json();
  } catch {
    return jsonRpcError(null, -32700, 'parse error');
  }
  if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
    return jsonRpcError(req?.id ?? null, -32600, 'invalid request');
  }

  const id = req.id ?? null;
  const auth = request.headers.get('Authorization') || null;

  switch (req.method) {
    case 'initialize':
      return jsonRpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });

    case 'notifications/initialized':
      return new Response(null, { status: 204 });

    case 'tools/list':
      return jsonRpcResult(id, { tools: listToolsForResponse() });

    case 'tools/call': {
      const name = req.params?.name;
      const args = req.params?.arguments ?? {};
      const tool = findTool(name);
      if (!tool) return jsonRpcError(id, -32602, `unknown tool: ${name}`);
      try {
        const result = await tool.call(args, env, auth);
        return jsonRpcResult(id, result);
      } catch (e) {
        return jsonRpcError(id, -32603, `tool execution failed: ${e?.message ?? e}`);
      }
    }

    case 'ping':
      return jsonRpcResult(id, {});

    default:
      return jsonRpcError(id, -32601, `method not found: ${req.method}`);
  }
}

function jsonRpcResult(id, result) {
  return jsonResponse({ jsonrpc: '2.0', id, result });
}
function jsonRpcError(id, code, message) {
  return jsonResponse({ jsonrpc: '2.0', id, error: { code, message } });
}
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
