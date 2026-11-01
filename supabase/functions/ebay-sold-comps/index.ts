import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
// ---------------------------------------------------------------------------
// Shared eBay Sold-Comps Service (Mission Control)
// Returns aggregated eBay SOLD-price comps (trimmed mean / median / count /
// sample listings). Built once, consumed by many (FlipRadar #1, VZT #2).
//
// Secrets: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are auto-injected.
// EBAY_COMPS_SERVICE_TOKEN + APIFY_API_TOKEN are read at runtime from the
// `credentials` table via the service role.
//
// v6 (2026-10-31): real sold data, no LLM. v5 had Firecrawl extract listings
// with an LLM; eBay 403s automated requests, and on a blocked page the LLM
// invented listings (every cached sale dated 2023, ~24% with item id
// 1234567890). v6 reads structured rows from an Apify actor that browses eBay
// with residential proxies, keeps only rows with a real item number and a sale
// inside MAX_SOLD_AGE_DAYS, and never serves v5's cached rows.
//
// v4 (2026-07-05): credentials table rows are now AES-256-GCM encrypted
// (personal-os lib/crypto.ts format: iv 24hex + authTag 32hex + ciphertext hex).
// v3 compared the caller's plaintext token against the ENCRYPTED stored value,
// which 401'd every caller. v4 decrypts with CREDENTIAL_ENCRYPTION_KEY (function
// secret, same 64-char hex key personal-os uses). If the key is unset or a value
// doesn't decrypt, the raw stored value is used (plaintext-row compatible).
// ---------------------------------------------------------------------------
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const CREDENTIAL_ENCRYPTION_KEY = Deno.env.get("CREDENTIAL_ENCRYPTION_KEY") ?? "";
// FlipRadar's Mission Control project row (cost-logging target).
const FLIPRADAR_PROJECT_ID = "95e468ba-d76b-4329-aef0-3c56289a96fa";
// Cache freshness window.
const CACHE_TTL_DAYS = 7;
// Sold-listings source (Apify pay-per-event pricing, checked 2026-10-31).
// minimal: one actor, no fallback; khadinakbar~ebay-sold-comps-analytics-scraper
// is the researched backup if this one degrades.
const APIFY_ACTOR = "blackfalcondata~ebay-sold-listings-scraper";
const APIFY_COST_PER_RUN_USD = 0.01;
const APIFY_COST_PER_LISTING_USD = 0.0024;
// eBay's sold search covers ~90 days; anything older, or without a real item
// number, is not a sale we can stand behind. Mirrors FlipRadar comps-guard.ts.
const MAX_SOLD_AGE_DAYS = 120;
// Cache rows written by this source. v5's rows ("ebay_sold") are fabricated
// and are never served.
const DATA_SOURCE = "ebay_sold_apify";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const json = (body, status = 200)=>new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
// --- AES-256-GCM decryption (mirror of personal-os lib/crypto.ts) ---------
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for(let i = 0; i < out.length; i++){
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
const HEX_RE = /^[0-9a-f]+$/;
async function decryptIfNeeded(value) {
  // Stored format: iv(24 hex) + authTag(32 hex) + ciphertext(hex).
  // Anything shorter than iv+tag, non-hex, or with no key available is
  // treated as a plaintext row.
  if (!CREDENTIAL_ENCRYPTION_KEY || value.length <= 56 || !HEX_RE.test(value)) {
    return value;
  }
  try {
    const key = await crypto.subtle.importKey("raw", hexToBytes(CREDENTIAL_ENCRYPTION_KEY), "AES-GCM", false, [
      "decrypt"
    ]);
    const iv = hexToBytes(value.slice(0, 24));
    const tag = hexToBytes(value.slice(24, 56));
    const ciphertext = hexToBytes(value.slice(56));
    // WebCrypto expects ciphertext||tag concatenated.
    const data = new Uint8Array(ciphertext.length + tag.length);
    data.set(ciphertext);
    data.set(tag, ciphertext.length);
    const plain = await crypto.subtle.decrypt({
      name: "AES-GCM",
      iv,
      tagLength: 128
    }, key, data);
    return new TextDecoder().decode(plain);
  } catch  {
    // Not decryptable with this key — assume plaintext row.
    return value;
  }
}
// --- Runtime secret loading (module-cached) -------------------------------
let secretsPromise = null;
function loadSecrets() {
  if (!secretsPromise) {
    secretsPromise = (async ()=>{
      const { data, error } = await admin.from("credentials").select("key_name, value").in("key_name", [
        "EBAY_COMPS_SERVICE_TOKEN",
        "APIFY_API_TOKEN"
      ]);
      if (error) throw new Error(`credential load failed: ${error.message}`);
      const map = new Map((data ?? []).map((r)=>[
          r.key_name,
          r.value
        ]));
      const rawToken = map.get("EBAY_COMPS_SERVICE_TOKEN");
      const rawApify = map.get("APIFY_API_TOKEN");
      if (!rawToken || !rawApify) {
        throw new Error("missing EBAY_COMPS_SERVICE_TOKEN or APIFY_API_TOKEN");
      }
      const serviceToken = await decryptIfNeeded(rawToken);
      const apifyToken = await decryptIfNeeded(rawApify);
      return {
        serviceToken,
        apifyToken
      };
    })();
  }
  return secretsPromise;
}
// A real eBay sale: positive price, a genuine item number (not a placeholder
// such as 1234567890), and sold within MAX_SOLD_AGE_DAYS.
function isPlausibleSold(r) {
  if (typeof r.price !== "number" || !(r.price > 0) || !r.title) return false;
  const id = r.url?.match(/ebay\.com\/itm\/(?:[^/?#]+\/)?(\d{9,15})(?:[/?#]|$)/)?.[1];
  if (!id || /^(\d)\1+$/.test(id) || "01234567890123456789".includes(id) || "98765432109876543210".includes(id)) {
    return false;
  }
  const sold = Date.parse(r.soldDate ?? "");
  if (Number.isNaN(sold)) return false;
  const ageDays = (Date.now() - sold) / 86_400_000;
  return ageDays >= -2 && ageDays <= MAX_SOLD_AGE_DAYS;
}
// One synchronous actor run per query (11-37s in the 2026-10-31 probe). Returns
// the trusted rows plus how many the actor billed for (cost log).
async function fetchSoldListings(apiToken, query, limit) {
  const res = await fetch(`https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?timeout=120`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query,
      maxResults: limit,
      soldWithinDays: 90,
      compact: true
    })
  });
  if (!res.ok) {
    // Rejected key: reload credentials on the next call, so updating the key
    // in MC takes effect without a redeploy.
    if (res.status === 401) secretsPromise = null;
    const txt = await res.text();
    throw new Error(`Apify sold scrape failed: ${res.status} ${txt.slice(0, 200)}`);
  }
  const items = await res.json();
  if (!Array.isArray(items)) throw new Error("Apify sold scrape returned no item list");
  const rows = items.map((r)=>({
      title: r.title,
      price: r.priceValue,
      currency: r.priceCurrency,
      condition: r.condition,
      url: r.canonicalUrl,
      soldDate: r.soldDate
    }));
  return {
    rows: rows.filter(isPlausibleSold).slice(0, limit),
    billed: items.length
  };
}
// --- Normalisation + stat logic (ported verbatim from ebay.ts:108-132) ----
function normQuery(q) {
  return q.toLowerCase().trim().replace(/\s+/g, " ");
}
function itemIdFromUrl(url, idx) {
  const m = url?.match(/\/itm\/(\d+)/);
  return m ? m[1] : `sold-${idx}`;
}
function aggregate(query, raw) {
  const listings = raw.map((r, i)=>({
      itemId: itemIdFromUrl(r.url, i),
      title: r.title,
      price: Number(r.price),
      currency: r.currency ?? "USD",
      condition: r.condition,
      itemWebUrl: r.url ?? "",
      soldDate: r.soldDate
    }));
  if (listings.length === 0) {
    return {
      query,
      avgPrice: 0,
      medianPrice: 0,
      count: 0,
      listings: [],
      dataSource: "ebay_sold"
    };
  }
  // Drop top/bottom 10% to reduce outlier influence
  const sorted = [
    ...listings
  ].sort((a, b)=>a.price - b.price);
  const trim = Math.floor(sorted.length * 0.1);
  const trimmed = sorted.slice(trim, sorted.length - trim);
  const sum = trimmed.reduce((acc, l)=>acc + l.price, 0);
  const avgPrice = trimmed.length > 0 ? sum / trimmed.length : 0;
  const mid = Math.floor(trimmed.length / 2);
  const medianPrice = trimmed.length === 0 ? 0 : trimmed.length % 2 === 0 ? ((trimmed[mid - 1]?.price ?? 0) + (trimmed[mid]?.price ?? 0)) / 2 : trimmed[mid]?.price ?? 0;
  return {
    query,
    avgPrice: Number(avgPrice.toFixed(2)),
    medianPrice: Number(medianPrice.toFixed(2)),
    count: listings.length,
    listings: listings.slice(0, 5),
    dataSource: "ebay_sold"
  };
}
// --- Handler --------------------------------------------------------------
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  if (req.method !== "POST") {
    return json({
      error: "Method not allowed"
    }, 405);
  }
  let secrets;
  try {
    secrets = await loadSecrets();
  } catch (e) {
    return json({
      error: `secret load: ${String(e)}`
    }, 500);
  }
  // Manual Bearer auth (verify_jwt is false).
  const auth = req.headers.get("Authorization");
  if (auth !== `Bearer ${secrets.serviceToken}`) {
    return json({
      error: "Unauthorized"
    }, 401);
  }
  let payload;
  try {
    payload = await req.json();
  } catch  {
    return json({
      error: "Invalid JSON body"
    }, 400);
  }
  const query = (payload.query ?? "").trim();
  const limit = Math.min(Math.max(payload.limit ?? 20, 1), 60);
  if (!query) return json({
    error: "query is required"
  }, 400);
  const qn = normQuery(query);
  // Cache read.
  const { data: cached } = await admin.from("ebay_sold_comps").select("avg_price, median_price, sample_count, listings, scraped_at").eq("query_norm", qn).eq("data_source", DATA_SOURCE).maybeSingle();
  if (cached) {
    const ageMs = Date.now() - new Date(cached.scraped_at).getTime();
    if (ageMs < CACHE_TTL_DAYS * 24 * 60 * 60 * 1000) {
      return json({
        query,
        avgPrice: Number(cached.avg_price),
        medianPrice: Number(cached.median_price),
        count: cached.sample_count,
        listings: cached.listings ?? [],
        dataSource: "ebay_sold",
        cached: true
      });
    }
  }
  // Live scrape via provider seam.
  let result;
  let billed = 0;
  try {
    const sold = await fetchSoldListings(secrets.apifyToken, query, limit);
    billed = sold.billed;
    result = aggregate(query, sold.rows);
  } catch (e) {
    return json({
      error: `scrape failed: ${String(e)}`
    }, 502);
  }
  // Cost log (real model_costs schema).
  await admin.from("model_costs").insert({
    project_id: FLIPRADAR_PROJECT_ID,
    provider: "apify",
    model: APIFY_ACTOR,
    tokens_in: 0,
    tokens_out: 0,
    cost_usd: Number((APIFY_COST_PER_RUN_USD + billed * APIFY_COST_PER_LISTING_USD).toFixed(4)),
    purpose: "ebay_sold_comps"
  });
  // Cache write (upsert) — only persist non-empty results.
  if (result.count > 0) {
    await admin.from("ebay_sold_comps").upsert({
      query_norm: qn,
      avg_price: result.avgPrice,
      median_price: result.medianPrice,
      sample_count: result.count,
      listings: result.listings,
      data_source: DATA_SOURCE,
      scraped_at: new Date().toISOString()
    });
  }
  result.cached = false;
  return json(result);
});
