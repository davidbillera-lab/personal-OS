export interface SoldRow {
  title: string;
  price: number;
  condition?: string | null;
}

const BROKEN_RE = /\b(broken|for parts|parts only|not working|non[- ]?working|for repair|as[- ]is|defective)\b/i;
const NEW_RE = /\b(brand new|new in box|nib|nos|factory sealed|sealed)\b/i;

function medianOf(prices: number[]): number {
  const s = [...prices].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Keep sales comparable to a used, working local listing:
 * 1. drop broken / for-parts units;
 * 2. drop new-in-box sales when at least 3 used ones remain;
 * 3. drop price outliers (an accessory, a bundle) outside 0.4x-2.5x the median.
 * minimal: assumes the listing being priced is used; pass its condition in the
 * payload if new-in-box listings ever need new comps.
 */
export function comparable<T extends SoldRow>(raw: T[]): T[] {
  let rows = raw.filter((r) => !BROKEN_RE.test(r.title));
  const isNew = (r: T) => /^(brand )?new\b/i.test(r.condition ?? "") || NEW_RE.test(r.title);
  const used = rows.filter((r) => !isNew(r));
  if (used.length >= 3) rows = used;
  if (rows.length >= 4) {
    const med = medianOf(rows.map((r) => Number(r.price)));
    rows = rows.filter((r) => r.price >= med * 0.4 && r.price <= med * 2.5);
  }
  return rows;
}
