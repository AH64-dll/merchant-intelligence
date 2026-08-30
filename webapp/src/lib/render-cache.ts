/**
 * Bounded in-process render cache for SSR pages.
 *
 * The served snapshot is frozen for the lifetime of the process: MerchantDb
 * validates snapshot_meta at startup and never mutates its data afterwards.
 * Rendered HTML for a given (route, query) pair is therefore deterministic,
 * so caching it trades unbounded memory for CPU on the hot paths measured at
 * 31ms (detail) and 5-7ms (search) per render under 50-user load.
 *
 * Correctness: a new snapshot means a new process (snapshot:verify + restart),
 * so no TTL is needed; the LRU bound (default 512 entries, ~1-2MB) protects
 * memory against cache-flooding via arbitrary query strings.
 */
const cache = new Map<string, { body: string; contentType: string }>();
const MAX_ENTRIES = Number(process.env.RENDER_CACHE_MAX ?? 512);

export function renderCacheGet(
  key: string,
): { body: string; contentType: string } | undefined {
  const hit = cache.get(key);
  if (hit === undefined) return undefined;
  // LRU touch: delete + set re-inserts at the end of the insertion order.
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

export function renderCacheSet(key: string, body: string, contentType: string): void {
  if (cache.has(key)) {
    cache.delete(key);
  } else if (cache.size >= MAX_ENTRIES) {
    // Evict the least recently used entry.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { body, contentType });
}
