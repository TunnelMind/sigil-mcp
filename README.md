# sigil-mcp

MCP server for **Sigil** — TunnelMind's agentic supply-chain verification layer
for programmatic advertising (P35).

Sigil ships as a separate MCP surface (P35 Shape B). One Cloudflare Worker, two
hosts:

| Host | Serves |
|---|---|
| `mcp.sigil.tunnelmind.ai/mcp` | Streamable-HTTP MCP endpoint (JSON-RPC 2.0) |
| `sigil.tunnelmind.ai/.well-known/mcp.json` | Discovery card (`mcp-server-card/1.0-draft`) |

The Worker is a thin agent-facing wrapper: every tool proxies the live Sigil
API at `data.tunnelmind.ai/v1/sigil/*` over a Cloudflare service binding. The
`Authorization` header on an MCP request is forwarded — a paid TunnelMind key
gets its tier, anonymous callers get the free tier. Discovery is unauthenticated.

## Tools

| Tool | Purpose |
|---|---|
| `cross_lens_verify` | A2 — fused Scry × Sigil verdict on one node key (IP / domain / entity / ASN). The moat: both lenses, one answer. |
| `sigil_verify_supply_path` | Composite pre-bid trust verdict + signed token |
| `sigil_verify_ads_txt` | ads.txt seller-authorization check |
| `sigil_verify_ip_type` | Datacenter / residential / mobile IP classification |
| `sigil_verify_app_bundle` | App-store bundle-ID verification |
| `sigil_verify_supply_chain` | Full OpenRTB SupplyChain (schain) verification |
| `sigil_score_entity` | Pre-computed entity trust score + 14-day trend |
| `sigil_score_batch` | Trust scores for up to 200 entities |
| `sigil_atap_register_ait` | Register an ATAP AIT for a media-buyer agent |
| `sigil_atap_witness` | Witness a bid/budget event into the attestation chain |
| `sigil_generate_receipt` | Generate the ATAP compliance Receipt ZIP |

Published in the official MCP registry as `ai.tunnelmind/sigil`.

MCP methods: `initialize`, `tools/list`, `tools/call`, `ping`.

## Develop

```bash
npm install      # wrangler
npm test         # tool-definition checks
npm run dev      # local
npm run deploy   # -> Cloudflare
```

## Licence

MIT.
