// Sigil MCP tool definitions.
//
// Each tool: { name, description (agent-oriented), inputSchema (JSON Schema),
// call(args, env, auth) -> { content: [...] } }. Tools proxy the live Sigil
// API at data.tunnelmind.ai via the `API` service binding — no DNS hop, no
// same-zone 522. The MCP request's Authorization header is forwarded so a
// paid TunnelMind key gets its tier; anonymous callers get the free tier.

const API_ORIGIN = 'https://data.tunnelmind.ai';

async function apiCall(env, method, path, { body, auth } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) headers['Authorization'] = auth;
  const resp = await env.API.fetch(new Request(`${API_ORIGIN}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }));
  const text = await resp.text();
  if (!resp.ok) {
    return { isError: true, content: [{ type: 'text', text: `Sigil API ${resp.status}: ${text}` }] };
  }
  return { content: [{ type: 'text', text }] };
}

export const TOOLS = [
  {
    name: 'cross_lens_verify',
    description:
      'A2 — the cross-lens join. Fuse TunnelMind\'s two lenses (Scry attacker\n' +
      'intelligence + Sigil supply graph) into ONE verdict on a single node key.\n' +
      'This is the moat: no siloed competitor owns both halves of the graph, so\n' +
      'the fused `cross_lens` block carries information neither lens can supply\n' +
      'alone.\n\n' +
      'Use this tool when:\n' +
      '- An agent must decide whether to transact with an IP, domain, ASN, or\n' +
      '  entity_slug, and a one-lens answer is not enough.\n' +
      '- You want a single composite trust verdict instead of running\n' +
      '  Scry + Sigil calls separately and reconciling them by hand.\n\n' +
      'Inputs:\n' +
      '- `node` (required): an IPv4 address, a domain, an ASN (e.g. `AS64500`),\n' +
      '  or an entity_slug. Type is auto-detected.\n' +
      '- `weights` (optional): per-component weight overrides.\n' +
      '- `thresholds` (optional): `{ pass, fail }` verdict cutoffs (defaults 0.7 / 0.3).\n' +
      '- `ait` (optional): an ATAP AIT id. When present, the verdict is chained\n' +
      '  onto the AIT as a witness-tier `cross_lens:verified` event signed by\n' +
      '  Sigil (witness OAI-2026-0000201) — replayable evidence, not just JSON.\n\n' +
      'Returns: per-lens `scry` + `sigil` blocks (transparency), a fused\n' +
      '`cross_lens` block with `verdict` / `trust_score` / `confidence` /\n' +
      '`signals` / `recommendations`, a 5-minute signed `sigil_token`, and a\n' +
      '`witnessed_event` block when an AIT was supplied.\n\n' +
      'Failure semantics: each lens fails independently. Single-lens answers\n' +
      'still return 200 with a `confidence` of 0.55. Returns 503 only when BOTH\n' +
      'lenses are unavailable.',
    inputSchema: {
      type: 'object',
      required: ['node'],
      properties: {
        node: {
          type: 'string',
          description: 'The node to verify. IPv4, domain, ASN (AS-prefixed or numeric), or entity_slug.',
          example: 'nytimes.com',
        },
        weights: { type: 'object' },
        thresholds: { type: 'object' },
        ait: { type: 'string', description: 'Optional ATAP AIT id to witness this verification under.' },
      },
    },
    call: (a, env, auth) => {
      const node = a?.node;
      if (!node || typeof node !== 'string') {
        return { isError: true, content: [{ type: 'text', text: 'node is required' }] };
      }
      const { node: _drop, ...rest } = a;
      return apiCall(env, 'POST', `/v1/verify/${encodeURIComponent(node)}`, { body: rest, auth });
    },
  },

  {
    name: 'sigil_verify_supply_path',
    description:
      'The core pre-bid check. Verify the trustworthiness of one programmatic ad\n' +
      'supply path and get back a composite trust verdict plus a signed proof token.\n' +
      'Sigil composes ads.txt authorization, datacenter-IP classification, Scry\n' +
      'fraud-corpus lookup, and app-bundle checks into one score.\n\n' +
      'Use this tool when:\n' +
      '- An ad-buying agent is about to bid and must confirm the supply is genuine.\n' +
      '- You want one call instead of running ads.txt / IP / bundle checks separately.\n\n' +
      'Inputs:\n' +
      '- `supply_path` (required): { publisher_domain, exchange, seller_id, and\n' +
      '  optionally ip_address, app_bundle:{bundle_id,platform} }.\n' +
      '- `ait` (optional): an ATAP AIT id — when present, Sigil records this\n' +
      '  verification as a witnessed attestation event and binds the token to it.\n\n' +
      'Returns: `trust_score` (0-1), `verdict` (pass/warn/fail/unknown), per-check\n' +
      'results, `recommendations`, and a signed `sigil_token` (5-min) to attach to\n' +
      'the bid as proof. The submitted IP is used for lookup only — never stored.',
    inputSchema: {
      type: 'object',
      required: ['supply_path'],
      properties: {
        supply_path: {
          type: 'object',
          required: ['publisher_domain', 'exchange', 'seller_id'],
          properties: {
            publisher_domain: { type: 'string', example: 'nytimes.com' },
            exchange: { type: 'string', example: 'rubiconproject.com' },
            seller_id: { type: 'string' },
            ip_address: { type: 'string', description: 'Optional IPv4. Lookup only — never logged or stored.' },
            app_bundle: {
              type: 'object',
              properties: { bundle_id: { type: 'string' }, platform: { type: 'string' } },
            },
          },
        },
        ait: { type: 'string', description: 'Optional ATAP AIT id to witness this verification under.' },
      },
    },
    call: (a, env, auth) => apiCall(env, 'POST', '/v1/sigil/verify/supply_path', { body: a, auth }),
  },

  {
    name: 'sigil_verify_ads_txt',
    description:
      'Check whether an exchange/SSP is authorized to sell a publisher\'s inventory,\n' +
      'per the publisher\'s ads.txt file. Fast cached lookup against Sigil\'s daily\n' +
      'crawl of the top ~10k publisher domains.\n\n' +
      'Use this tool when:\n' +
      '- You need a single, narrow authorization check (not a full supply-path score).\n' +
      '- You are validating a (publisher, exchange, seller_id) triple from a bid request.\n\n' +
      'Inputs:\n' +
      '- `publisher_domain`, `exchange_domain`, `seller_id` (all required).\n' +
      '- `resolve_chain` (optional): when true and the entry is RESELLER, Sigil walks\n' +
      '  one hop into the exchange\'s sellers.json to identify the upstream seller.\n\n' +
      'Returns: `verified` (true/false/null), `confidence`, the matched ads.txt entry,\n' +
      'and any `warnings` (e.g. seller_type mismatch).',
    inputSchema: {
      type: 'object',
      required: ['publisher_domain', 'exchange_domain', 'seller_id'],
      properties: {
        publisher_domain: { type: 'string', example: 'cnn.com' },
        exchange_domain: { type: 'string', example: 'pubmatic.com' },
        seller_id: { type: 'string' },
        resolve_chain: { type: 'boolean', default: false },
      },
    },
    call: (a, env, auth) => apiCall(env, 'POST', '/v1/sigil/verify/ads_txt', { body: a, auth }),
  },

  {
    name: 'sigil_verify_ip_type',
    description:
      'Classify an IPv4 address as datacenter, residential, mobile, or unknown.\n' +
      'Detects datacenter traffic posing as real user devices. Stateless — the IP\n' +
      'is never logged or stored.\n\n' +
      'Use this tool when:\n' +
      '- You need to know whether bid-request traffic originates from a datacenter.\n\n' +
      'Inputs:\n' +
      '- `ip` (required): an IPv4 address.\n\n' +
      'Returns: `ip_type`, `confidence` (high/medium/low), and the ASN + AS-org name.',
    inputSchema: {
      type: 'object',
      required: ['ip'],
      properties: { ip: { type: 'string', example: '8.8.8.8' } },
    },
    call: (a, env, auth) =>
      apiCall(env, 'GET', `/v1/sigil/verify/ip_type?ip=${encodeURIComponent(a.ip || '')}`, { auth }),
  },

  {
    name: 'sigil_verify_app_bundle',
    description:
      'Verify that a mobile/CTV app bundle ID actually exists in its app store and,\n' +
      'optionally, that the listed developer matches. Detects bundle-ID spoofing in\n' +
      'bid requests.\n\n' +
      'Use this tool when:\n' +
      '- A bid request names an app bundle and you must confirm the app is real.\n\n' +
      'Inputs:\n' +
      '- `bundle_id` (required), `platform` (required: ios | android | ctv_* | web),\n' +
      '- `claimed_developer` (optional): developer name to match against the listing.\n\n' +
      'Returns: `verified` (true/false/null), the store listing, and `developer_match`.',
    inputSchema: {
      type: 'object',
      required: ['bundle_id', 'platform'],
      properties: {
        bundle_id: { type: 'string', example: 'com.nytimes.NYTimes' },
        platform: { type: 'string', example: 'ios' },
        claimed_developer: { type: 'string' },
      },
    },
    call: (a, env, auth) => apiCall(env, 'POST', '/v1/sigil/verify/app_bundle', { body: a, auth }),
  },

  {
    name: 'sigil_verify_supply_chain',
    description:
      'Verify a full OpenRTB SupplyChain (schain) object — every node, end to end.\n' +
      'Per node Sigil checks the seller against the exchange sellers.json and the\n' +
      'origin ads.txt, then returns a per-node and aggregate verdict plus a signed\n' +
      'token.\n\n' +
      'Use this tool when:\n' +
      '- A bid request carries an OpenRTB `schain` and you want it verified verbatim.\n\n' +
      'Inputs:\n' +
      '- `schain` (required): an OpenRTB SupplyChain object ({ ver, complete,\n' +
      '  nodes:[{asi,sid,hp}] }).\n' +
      '- `site_domain` or `app_bundle` (optional): the inventory origin, checked\n' +
      '  against node[0] via ads.txt / OWNERDOMAIN.\n\n' +
      'Returns: per-node `nodes` results, an aggregate `verdict`, `recommendations`,\n' +
      'and a signed `sigil_token`.',
    inputSchema: {
      type: 'object',
      required: ['schain'],
      properties: {
        schain: {
          type: 'object',
          description: 'OpenRTB SupplyChain object.',
          properties: {
            ver: { type: 'string' },
            complete: { type: 'integer' },
            nodes: { type: 'array', items: { type: 'object' } },
          },
        },
        site_domain: { type: 'string' },
        app_bundle: { type: 'string' },
      },
    },
    call: (a, env, auth) => apiCall(env, 'POST', '/v1/sigil/verify/supply_chain', { body: a, auth }),
  },

  {
    name: 'traverse_supply_chain',
    description:
      'Walk the supply graph for a publisher domain and get back the ITEMIZED\n' +
      'sell paths — distinct from sigil_verify_supply_chain (which verifies a\n' +
      'schain you BRING) and from the dark-pool-risk signal (which only returns\n' +
      'counts). Here Sigil reconstructs the paths from its own crawl: every SSP\n' +
      'the publisher declares it sells through, joined to that SSP\'s identity and\n' +
      'classified two-sided against the SSP\'s sellers.json.\n\n' +
      'Use this tool when:\n' +
      '- You have a publisher domain but no schain, and want to SEE its real\n' +
      '  authorized supply paths and where the opacity is.\n' +
      '- dark-pool-risk flagged a publisher and you need the specific contradicted\n' +
      '  paths driving the risk, not just the aggregate.\n\n' +
      'Inputs:\n' +
      '- `domain` (required): the publisher domain, e.g. `cnn.com`.\n' +
      '- `limit` (optional): max paths returned (default 200, cap 500). The list\n' +
      '  is ordered riskiest-first (contradicted, then reseller) so a truncated\n' +
      '  page is still the most useful; the `supply_paths` counts are always over\n' +
      '  the FULL set.\n\n' +
      'Returns: `supply_paths` aggregate counts (total / direct / reseller /\n' +
      'corroborated / contradicted / unchecked) and `paths[]`, each with the SSP\n' +
      'identity, `seller_id`, `seller_type`, `klass` (corroborated = seat present;\n' +
      'contradicted = SSP crawled but seller_id absent → real risk; unchecked =\n' +
      'SSP not yet crawled → not risk), and `resells_to` (one level of downstream\n' +
      'reseller expansion). Returns in_supply_graph:false if the domain is not in\n' +
      'the crawled corpus.',
    inputSchema: {
      type: 'object',
      required: ['domain'],
      properties: {
        domain: { type: 'string', description: 'Publisher domain to traverse.', example: 'cnn.com' },
        limit:  { type: 'integer', description: 'Max paths returned (default 200, cap 500).' },
      },
    },
    call: (a, env, auth) => {
      const domain = typeof a?.domain === 'string' ? a.domain.trim().toLowerCase() : '';
      if (!domain) return { isError: true, content: [{ type: 'text', text: 'domain is required' }] };
      const qs = a?.limit != null ? `&limit=${encodeURIComponent(a.limit)}` : '';
      return apiCall(env, 'GET', `/v1/sigil/traverse?domain=${encodeURIComponent(domain)}${qs}`, { auth });
    },
  },

  {
    name: 'sigil_score_entity',
    description:
      'Get the pre-computed trust score for one supply-chain entity (a publisher or\n' +
      'an SSP). Scores are recomputed daily from ads.txt health, supply-chain\n' +
      'directness, reach, and stability — deterministic, no ML black box.\n\n' +
      'Use this tool when:\n' +
      '- You want a fast standing trust signal for an entity without running checks.\n\n' +
      'Inputs:\n' +
      '- `entity_id` (required): `{type}:{domain}` — e.g. `publisher:nytimes.com` or\n' +
      '  `ssp:pubmatic.com`.\n\n' +
      'Returns: `trust_score` (0-1), `score_components`, the 14-day `trend`, and\n' +
      '`warnings`.',
    inputSchema: {
      type: 'object',
      required: ['entity_id'],
      properties: {
        entity_id: { type: 'string', example: 'publisher:nytimes.com' },
      },
    },
    call: (a, env, auth) =>
      apiCall(env, 'GET', `/v1/sigil/score/${encodeURIComponent(a.entity_id || '')}`, { auth }),
  },

  {
    name: 'sigil_score_batch',
    description:
      'Pre-computed trust scores for up to 200 entities in one call — built for an\n' +
      'agent evaluating many supply sources during campaign setup.\n\n' +
      'Use this tool when:\n' +
      '- You have a list of publishers/SSPs to grade at once.\n\n' +
      'Inputs:\n' +
      '- `entity_ids` (required): array of `{type}:{domain}` ids, up to 200.\n' +
      '- `weights` (optional): custom component weights to re-score with.\n\n' +
      'Returns: `count`, `scored_count`, and a per-entity `results` array (invalid\n' +
      'ids are reported inline, never failing the batch).',
    inputSchema: {
      type: 'object',
      required: ['entity_ids'],
      properties: {
        entity_ids: { type: 'array', items: { type: 'string' }, maxItems: 200 },
        weights: { type: 'object' },
      },
    },
    call: (a, env, auth) => apiCall(env, 'POST', '/v1/sigil/score/batch', { body: a, auth }),
  },

  {
    name: 'sigil_atap_register_ait',
    description:
      'Register an ATAP v0.1 Agent Identity Token for a media-buying agent. Sigil\n' +
      'validates the capabilities + constraints against the `sigil:media_buyer:v1`\n' +
      'profile, signs the AIT as the witness, and returns it. Do this once per agent\n' +
      'campaign before witnessing any events.\n\n' +
      'Inputs:\n' +
      '- `profile` (required): must be `sigil:media_buyer:v1`.\n' +
      '- `operator` (required): the agent operator\'s canonical OAI.\n' +
      '- `capabilities` (required): array from the profile vocabulary.\n' +
      '- `constraints` (required): { currency, max_bid_cpm, supply_trust_minimum,\n' +
      '  budget_total_cap, allowed_channels, ... }.\n' +
      '- `attestation_policy` (required): { witness_granularity, block_interval_seconds\n' +
      '  (60-3600), receipt_generation }.\n' +
      '- `expires_at` (required): ISO date-time, <= 365 days out.\n\n' +
      'Returns: the signed AIT (note its `id` for subsequent witness calls).',
    inputSchema: {
      type: 'object',
      required: ['profile', 'operator', 'capabilities', 'constraints', 'attestation_policy', 'expires_at'],
      properties: {
        profile: { type: 'string', example: 'sigil:media_buyer:v1' },
        operator: { type: 'string', example: 'OAI-2026-0009001' },
        agent_type: { type: 'string', default: 'media-buyer' },
        capabilities: { type: 'array', items: { type: 'string' } },
        constraints: { type: 'object' },
        attestation_policy: { type: 'object' },
        expires_at: { type: 'string', format: 'date-time' },
      },
    },
    call: (a, env, auth) => apiCall(env, 'POST', '/v1/sigil/atap/ait', { body: a, auth }),
  },

  {
    name: 'sigil_atap_witness',
    description:
      'Witness one agent-reported bid or budget event into an AIT\'s hash-chained\n' +
      'attestation log. Sigil validates the payload (rejecting any PII), classifies\n' +
      'the evidence tier — `anchored` if a bid cites a valid Sigil token, else\n' +
      '`asserted` — derives constraint violations, and signs the event.\n\n' +
      'Use this tool when:\n' +
      '- An ATAP-enrolled media-buyer agent submits a bid, win, loss, or budget\n' +
      '  decrement and you want it on the attestation record.\n\n' +
      'Inputs:\n' +
      '- `ait` (required): the AIT id.\n' +
      '- `event_type` (required): bid:submitted | bid:won | bid:lost | budget:decremented.\n' +
      '- `payload` (required): the event payload (see the sigil:media_buyer:v1 profile).\n\n' +
      'Returns: the signed witness event(s), the assigned `tier`, and any derived\n' +
      'constraint violations. (supply:verified events come from verify_supply_path,\n' +
      'not this tool.)',
    inputSchema: {
      type: 'object',
      required: ['ait', 'event_type', 'payload'],
      properties: {
        ait: { type: 'string' },
        event_type: {
          type: 'string',
          enum: ['bid:submitted', 'bid:won', 'bid:lost', 'budget:decremented'],
        },
        payload: { type: 'object' },
      },
    },
    call: (a, env, auth) => apiCall(env, 'POST', '/v1/sigil/atap/witness', { body: a, auth }),
  },

  {
    name: 'sigil_generate_receipt',
    description:
      'Generate the ATAP v0.1 compliance Receipt for an AIT — the portable, signed\n' +
      'artifact a media buyer hands its principal. The receipt grades every event\n' +
      'witnessed / anchored / asserted and is verifiable offline with the bundled\n' +
      'verify.sh.\n\n' +
      'Use this tool when:\n' +
      '- A reporting period closes and you need a compliance export for the AIT.\n\n' +
      'Inputs:\n' +
      '- `ait` (required): the AIT id.\n' +
      '- `format` (optional): `full` (default) or `summary`.\n\n' +
      'Returns: JSON with `receipt_id` and `zip_base64` — base64-decode `zip_base64`\n' +
      'to a .zip, unpack it, and run verify.sh to verify the chain independently.',
    inputSchema: {
      type: 'object',
      required: ['ait'],
      properties: {
        ait: { type: 'string' },
        format: { type: 'string', enum: ['full', 'summary'], default: 'full' },
      },
    },
    async call(a, env, auth) {
      const headers = { 'Content-Type': 'application/json', Accept: 'application/zip' };
      if (auth) headers.Authorization = auth;
      const resp = await env.API.fetch(new Request(`${API_ORIGIN}/v1/sigil/receipt/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ait: a.ait, format: a.format }),
      }));
      if (!resp.ok) {
        const t = await resp.text();
        return { isError: true, content: [{ type: 'text', text: `Sigil API ${resp.status}: ${t}` }] };
      }
      const buf = new Uint8Array(await resp.arrayBuffer());
      let bin = '';
      for (const b of buf) bin += String.fromCharCode(b);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            receipt_id: resp.headers.get('X-ATAP-Receipt-Id') || 'unknown',
            format: a.format || 'full',
            bytes: buf.length,
            zip_base64: btoa(bin),
            note: 'Base64-decode zip_base64 to a .zip; unpack and run verify.sh to verify the attestation chain offline.',
          }),
        }],
      };
    },
  },
];

export function findTool(name) {
  return TOOLS.find((t) => t.name === name) || null;
}

export function listToolsForResponse() {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}
