import { afterAll, it } from 'vitest';
import type { ScaleResult } from './search.bench';
import { benchScale, GATES } from './search.bench';

/**
 * Bench entry point: `pnpm bench:search` runs
 * `vitest run src/lib/search.bench.spec.ts` — vitest is already the project
 * TS runner, and the bench prints its measured table + gate verdicts to
 * stdout. Exits nonzero when any gate fails.
 *
 * The three scales run in separate `it` blocks separated by macrotask yields:
 * a single 250s+ synchronous CPU block starves the vitest worker's RPC timer
 * ("Timeout calling onTaskUpdate") and registers as an unhandled error even
 * when every gate passes.
 */
const SCALES: ReadonlyArray<readonly [string, number]> = [
  ['1x (351)', 0],
  ['10x (3,510)', 9],
  ['100x (35,100)', 99],
];

const results: ScaleResult[] = [];

function yieldTick(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}

for (const [label, replication] of SCALES) {
  it(`search bench gates ${label}`, { timeout: 600_000 }, async () => {
    await yieldTick();
    results.push(benchScale(label, replication));
  });
}

afterAll(() => {
  if (results.length === 0) return;
  console.log('=== search bench (real snapshot + replicated merchants) ===');
  for (const r of results) printRow(r);
  const allOk = results.every(gatesOk);
  console.log(allOk ? 'BENCH:PASS' : 'BENCH:FAIL (measured numbers above are the recommendation input)');
});

function printRow(r: ScaleResult): void {
  const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : 'NaN');
  const ms = (v: number) => `${fmt(v)}ms`;
  console.log(
    r.label.padEnd(15),
    String(r.merchants).padStart(7),
    String(r.identifiers).padStart(9),
    ms(r.buildMs).padStart(10),
    `${fmt(r.heapDeltaMb)}MB`.padStart(8),
    ms(r.firstQueryMs).padStart(9),
    ms(r.exactP99Ms).padStart(9),
    ms(r.nameP99Ms).padStart(8),
    ms(r.fuzzyP99Ms).padStart(9),
    ms(r.typoP99Ms).padStart(8),
  );
}

function gatesOk(r: ScaleResult): boolean {
  return (GATES[r.label] ?? []).every((gate) => {
    const value = r[gate.field as keyof ScaleResult] as number;
    return Number.isFinite(value) && value <= gate.limit;
  });
}
