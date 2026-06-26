# Shared Service Contract — eBay Sold-Comps

**Service:** `ebay-sold-comps` (Supabase edge function, Mission Control project `dmtctlpzlfpcogpjweuv`)
**Status:** LIVE (version 3, ACTIVE) as of 2026-06-13
**Owner:** Mission Control (portfolio credential broker)
**Consumers:** FlipRadar (#1, live), VZT (#2, contract only — not yet wired)

---

## What it is

One endpoint that returns **real eBay SOLD-price comps** (not active/asking prices) for a
search query. Built once in Mission Control because multiple portfolio apps need believable
resale numbers and MC is the shared credential broker. Apps are **thin clients** — they call
this endpoint, they do **not** build their own scraper.

Data source: eBay public sold-listings search (`LH_Sold=1&LH_Complete=1`) scraped via
Firecrawl structured extraction. Results cached 7 days in `ebay_sold_comps`; cost logged to
`model_costs`.

---

## Endpoint

```
POST https://dmtctlpzlfpcogpjweuv.supabase.co/functions/v1/ebay-sold-comps
```

## Auth

Bearer token (shared service token, NOT a Supabase JWT — `verify_jwt:false`).

```
Authorization: Bearer <EBAY_COMPS_SERVICE_TOKEN>
Content-Type: application/json
```

`EBAY_COMPS_SERVICE_TOKEN` lives in MC `credentials` (tier `global`, MCP-accessible) and is
mirrored in `vault_items` (type `credential`). **Vault = source of record; the function reads
a runtime copy from `credentials`.** Pull it via `mc_get_credential` — do not hardcode.

Missing/wrong token → `401 {"error":"Unauthorized"}`.

## Request

```json
{ "query": "Dyson V8", "limit": 20 }
```

- `query` (string, required) — item search text.
- `limit` (int, optional, default 20, clamped 1..60) — max raw listings sampled.

## Response

```json
{
  "query": "Dyson V8",
  "avgPrice": 161.79,
  "medianPrice": 199.99,
  "count": 10,
  "listings": [
    {
      "itemId": "365984851274",
      "title": "Dyson V8 Cordless Stick Vacuum SV25",
      "price": 199.99,
      "currency": "USD",
      "condition": "Pre-Owned",
      "itemWebUrl": "https://www.ebay.com/itm/365984851274",
      "soldDate": "Nov 15, 2025"
    }
  ],
  "dataSource": "ebay_sold",
  "cached": false
}
```

- `avgPrice` / `medianPrice` — **trimmed** (top/bottom 10% dropped) over the sample.
- `count` — total sold listings found (before the 5-item `listings` preview cap).
- `listings` — up to 5 sample sold listings.
- `dataSource` — always `"ebay_sold"`.
- `cached` — `true` if served from the 7-day cache, `false` if freshly scraped.

Empty result: `count:0`, `listings:[]`, prices `0` (not cached/persisted).

## Error codes

| Status | Meaning |
|---|---|
| 400 | invalid JSON body / missing `query` |
| 401 | missing or wrong Bearer token |
| 405 | non-POST method |
| 500 | secret load failure (credentials table) |
| 502 | upstream scrape failed |

---

## VZT adoption note (consumer #2)

VZT is **PROTECTED** — no VZT code is touched as part of building this service. When VZT is
ready to consume believable sold comps, it adopts this same endpoint: same Bearer auth, same
request/response shape. No per-app scraper, no duplicated Firecrawl key. The data source is
swappable behind the provider seam in the edge function (Firecrawl → Playwright/Apify/eBay
Marketplace Insights) without any consumer change.

## Operator notes / gotchas

- **Firecrawl timeout:** eBay's sold page is JS-heavy; the request sets `timeout:90000` +
  `waitFor:2500`. Default (~30s) returns `502 SCRAPE_TIMEOUT`. Don't lower it.
- **Stale secret = redeploy.** Secrets are module-cached in a `secretsPromise`. Rotating
  `FIRECRAWL_API_KEY` or the service token in `credentials` requires a redeploy to bust the
  cache.
- Cost logged per live scrape: `model_costs` row, `provider:firecrawl`, `cost_usd:0.01`,
  `purpose:ebay_sold_comps`, `project_id` = FlipRadar's MC row.
