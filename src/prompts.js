// src/prompts.js
//
// MCP prompts/list + prompts/get handlers for the Sigil MCP surface.
//
// Same shape as tunnelmind-data-api/mcp/prompts-handler.js:
//   - Single source of truth is GET /v1/config/analyst on tunnelmind-data-api.
//   - The receipt signing key lives ONLY on tunnelmind-data-api.
//   - This Worker delegates via the existing API service binding
//     (wrangler.toml [[services]] binding="API"), avoiding the same-zone
//     Worker->Worker self-fetch 522 trap.
//
// Defaults the surface to "sigil" so an MCP client landing on the
// Sigil-scoped surface gets a Sigil-shaped bundle without arguments.

const DATA_API_ORIGIN = 'https://data.tunnelmind.ai';

const PROMPTS = [
  {
    name: 'tunnelmind_analyst',
    description:
      'TunnelMind analyst config bundle (system prompt + tool subset + response schema + attestation tiers). Sigil-scoped by default — pass surface="data" or surface="scry" to retarget. Inline Ed25519 signature, verifiable against tunnelmind.ai/.well-known/receipt-signing-key.json.',
    arguments: [
      {
        name: 'surface',
        description:
          'Tool surface scope. Defaults to "sigil" on this MCP. Pass "data" for the full tool set or "scry" for Scry-only.',
        required: false,
      },
      {
        name: 'format',
        description:
          'System-prompt format. One of "anthropic" (default), "openai", "generic". The bundle always carries all three; this only picks which one to highlight.',
        required: false,
      },
    ],
    _endpoint: '/v1/config/analyst',
    _defaultSurface: 'sigil',
  },
];

function dataApiFetch(env, href, init) {
  if (env && env.API && typeof env.API.fetch === 'function') {
    return env.API.fetch(href, init);
  }
  return fetch(href, init);
}

export function handlePromptsList() {
  return {
    prompts: PROMPTS.map(({ _endpoint, _defaultSurface, ...rest }) => {
      void _endpoint;
      void _defaultSurface;
      return rest;
    }),
  };
}

export async function handlePromptsGet(env, params) {
  const name = params?.name;
  if (!name) {
    const e = new Error('prompts/get requires `params.name`');
    e.code = -32602;
    throw e;
  }
  const prompt = PROMPTS.find((p) => p.name === name);
  if (!prompt) {
    const e = new Error(`unknown prompt: ${name}`);
    e.code = -32602;
    throw e;
  }

  const args = params?.arguments || {};
  const surface = args.surface || prompt._defaultSurface;
  const url = new URL(prompt._endpoint, DATA_API_ORIGIN);
  url.searchParams.set('surface', surface);
  if (args.version) url.searchParams.set('version', args.version);

  const r = await dataApiFetch(env, url.href, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!r.ok) {
    const e = new Error(`data-api returned ${r.status} for ${url.pathname}`);
    e.code = -32603;
    throw e;
  }
  const bundle = await r.json();

  const promptKey = ['anthropic', 'openai', 'generic'].includes(args.format)
    ? args.format
    : 'anthropic';

  return {
    description: `TunnelMind analyst config v${bundle.version} for surface "${bundle.surface}" (${promptKey} system prompt highlighted; all three included in the bundle).`,
    messages: [
      {
        role: 'system',
        content: { type: 'text', text: bundle.system_prompts[promptKey] },
      },
      {
        role: 'user',
        content: {
          type: 'text',
          text:
            'The full TunnelMind analyst config bundle is below. Use the tools.surface_subset, response_format, and attestation_tiers fields to constrain your behavior. Inline bundle_signature is verifiable against tunnelmind.ai/.well-known/receipt-signing-key.json.\n\n' +
            JSON.stringify(bundle, null, 2),
        },
      },
    ],
  };
}
