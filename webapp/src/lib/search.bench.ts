/**
 * Search benchmark: cold index build, heap delta, first-query latency, and
 * median/p95/p99 for exact/name/fuzzy/typo workloads against the real snapshot
 * plus deterministic 10x/100x replicated merchants.
 *
 * Run: pnpm bench:search   (executed through vitest as a runner-free TS harness)
 * Gates (plan Phase 6 step 5):
 *   current:  build <= 250ms, first query <= 500ms, p99 <= 25ms
 *   10x:      build <= 2.5s, heap <= 150MB, exact/name p99 <= 25ms, typo p99 <= 60ms
 *   100x:     build <= 10s, heap <= 500MB, p99 <= 250ms
 */
import { MerchantDb } from './db';
import { SearchIndex } from './search';

const DB_PATH = new URL('../../data/merchants.db', import.meta.url).pathname;

interface ScaleResult {
  label: string;
  merchants: number;
  identifiers: number;
  buildMs: number;
  heapDeltaMb: number;
  firstQueryMs: number;
  exactP99Ms: number;
  nameP99Ms: number;
  fuzzyP99Ms: number;
  typoP99Ms: number;
}

const EXACT_QUERIES = [
  '01286619966',
  '+201286619966',
  'facebook.com/MTIholding',
  'https://facebook.com/B.TECH.Egypt',
  'instagram.com/btech.egypt',
  'tiktok.com/@compumarts',
  'g.page/ikelvinatorr',
  'https://goo.gl/maps/BbZuAKqi75232WJZ8',
  'https://play.google.com/store/apps/details?id=com.hyperone.app',
  'https://apps.apple.com/us/app/hyperone/id1559427531',
  'https://ahw.store',
  'ahmed226887@gmail.com',
];

const NAME_QUERIES = [
  'بي تك',
  'B.TECH',
  'MTI Holding',
  'Dream 2000',
  'El Nour Tech',
  'شركة روفائيل للأجهزة الكهربائية الإسكندرية',
  'بي تك بورسعيد',
  'Games 2 Egypt',
  'Smart Home Egypt',
  'b.tech',
];

const FUZZY_QUERIES = [
  'موبايل',
  'لابتوب',
  'نور',
  'tech',
  'games 2',
  'سمارت هوم',
  'spinetnyz',
  'alfy computer',
];

const TYPO_QUERIES = [
  'conect',
  'b techh egyot',
  'b techh',
  'روفايل',
  'techy',
];

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function measure(index: SearchIndex, queries: string[], rounds: number): number[] {
  const samples: number[] = [];
  for (let round = 0; round < rounds; round += 1) {
    for (const query of queries) {
      const t0 = performance.now();
      index.search(query);
      samples.push(performance.now() - t0);
    }
  }
  samples.sort((a, b) => a - b);
  return samples;
}

function benchScale(label: string, replication: number): ScaleResult {
  // Force GC when exposed (--expose-gc); falls back to a no-op otherwise.
  // Every returned index goes out of scope before the next scale runs, so the
  // heap baseline for each scale is not polluted by the previous one.
  const maybeGc = (globalThis as { gc?: () => void }).gc;
  if (typeof maybeGc === 'function') maybeGc();
  const db = new MerchantDb(DB_PATH);
  const base = db.getIndexData();
  const merchants = [...base.merchants];
  const identifiers = [...base.identifiers];
  const aliases = [...base.aliases];
  for (let copy = 1; copy <= replication; copy += 1) {
    const suffix = `r${copy}`;
    for (const m of base.merchants) {
      merchants.push({ ...m, id: `${m.id}-${suffix}`, canonicalName: `${m.canonicalName} ${suffix}` });
    }
    for (const id of base.identifiers) {
      identifiers.push({ ...id, merchantId: `${id.merchantId}-${suffix}` });
    }
    for (const a of base.aliases) {
      aliases.push({ merchantId: `${a.merchantId}-${suffix}`, alias: `${a.alias} ${suffix}` });
    }
  }

  const heapBefore = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  const index = new SearchIndex({ merchants, identifiers, aliases });
  const buildMs = performance.now() - t0;
  const heapDeltaMb = (process.memoryUsage().heapUsed - heapBefore) / (1024 * 1024);

  // First query after cold build (uncached path).
  const firstQueryMs = (() => {
    const t = performance.now();
    index.search('بي تك');
    return performance.now() - t;
  })();

  // Warm rounds; report p99 of each workload. 30 rounds x ~12 queries ≈ 360 samples.
  const exact = percentile(measure(index, EXACT_QUERIES, 30), 99);
  const name = percentile(measure(index, NAME_QUERIES, 30), 99);
  const fuzzy = percentile(measure(index, FUZZY_QUERIES, 30), 99);
  const typo = percentile(measure(index, TYPO_QUERIES, 30), 99);

  return {
    label,
    merchants: merchants.length,
    identifiers: identifiers.length,
    buildMs,
    heapDeltaMb,
    firstQueryMs,
    exactP99Ms: exact,
    nameP99Ms: name,
    fuzzyP99Ms: fuzzy,
    typoP99Ms: typo,
  };
}

interface Gate {
  field: keyof ScaleResult;
  limit: number;
}

const GATES: Record<string, Gate[]> = {
  '1x (370)': [
    { field: 'buildMs', limit: 250 },
    { field: 'firstQueryMs', limit: 500 },
    { field: 'typoP99Ms', limit: 25 },
  ],
  '10x (3,700)': [
    { field: 'buildMs', limit: 2_500 },
    { field: 'heapDeltaMb', limit: 150 },
    { field: 'exactP99Ms', limit: 25 },
    { field: 'nameP99Ms', limit: 25 },
    { field: 'typoP99Ms', limit: 60 },
  ],
  '100x (37,000)': [
    { field: 'buildMs', limit: 10_000 },
    { field: 'heapDeltaMb', limit: 500 },
    { field: 'exactP99Ms', limit: 250 },
    { field: 'nameP99Ms', limit: 250 },
    { field: 'typoP99Ms', limit: 250 },
  ],
};


function runBench(): ScaleResult[] {
  const results = [benchScale('1x (370)', 0), benchScale('10x (3,700)', 9), benchScale('100x (37,000)', 99)];

  console.log('=== search bench (real snapshot + replicated merchants) ===');
  console.log(
    'scale'.padEnd(15),
    'merchs'.padStart(7),
    'ident'.padStart(7),
    'build'.padStart(9),
    'heapΔ'.padStart(9),
    'firstQ'.padStart(9),
    'exactP99'.padStart(9),
    'nameP99'.padStart(8),
    'fuzzyP99'.padStart(9),
    'typoP99'.padStart(8),
  );
  for (const r of results) {
    const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : 'NaN');
    console.log(
      r.label.padEnd(15),
      String(r.merchants).padStart(7),
      String(r.identifiers).padStart(7),
      `${fmt(r.buildMs)}ms`.padStart(9),
      `${fmt(r.heapDeltaMb)}MB`.padStart(9),
      `${fmt(r.firstQueryMs)}ms`.padStart(9),
      `${fmt(r.exactP99Ms)}ms`.padStart(9),
      `${fmt(r.nameP99Ms)}ms`.padStart(8),
      `${fmt(r.fuzzyP99Ms)}ms`.padStart(9),
      `${fmt(r.typoP99Ms)}ms`.padStart(8),
    );
  }

  console.log('\n=== gates ===');
  let allOk = true;
  for (const r of results) {
    const gates = GATES[r.label] ?? [];
    for (const g of gates) {
      const value = r[g.field] as number;
      const ok = Number.isFinite(value) && value <= g.limit;
      if (!ok) allOk = false;
      console.log(
        `${ok ? 'PASS' : 'FAIL'} ${r.label} ${String(g.field)}: ${Number.isFinite(value) ? value.toFixed(1) : 'NaN'} (limit ${g.limit})`,
      );
    }
  }
  console.log(allOk ? 'BENCH:PASS' : 'BENCH:FAIL (measured numbers above are the recommendation input — do NOT warm singletons unless a cold-start gate fails)');
  return results;
}

// Execute directly when run as the bench entry point (vitest-free): the
// package script compiles on the fly via vite-node-free path — plain node + ts
// via `vitest run` wrapper in bench:search.
export { runBench, benchScale, GATES };
export type { ScaleResult };
