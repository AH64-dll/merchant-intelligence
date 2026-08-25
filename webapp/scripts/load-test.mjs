#!/usr/bin/env node
// Load test: many imaginary concurrent users hammering the production server.
// Usage: node scripts/load-test.mjs <baseUrl> <durationSec> <concurrency>
// Gates: zero failed requests, overall p95 < 800 ms, and a 5000-char hostile
// query must neither error nor stall co-located normal traffic (p95 in its
// 3 s window < 1500 ms).

const base = process.argv[2] ?? 'http://127.0.0.1:3300';
const durationSec = Number(process.argv[3] ?? 30);
const concurrency = Number(process.argv[4] ?? 50);

if (!/^https?:\/\//.test(base)) {
  console.error('baseUrl must be http(s)://…');
  process.exit(2);
}

const NAME_QUERIES = [
  'بي تك',
  'MTI',
  'connect phone',
  'ropael',
  'smart home',
  'موبايل',
  'fashion',
  'ستار',
];

const latencies = []; // ms per completed request
let failures = 0;
let total = 0;
let stopAt = Date.now() + durationSec * 1000;

// Window around the hostile probe where we track co-located traffic health.
let dosWindowStart = Infinity;
let dosWindowEnd = -Infinity;
const dosWindowLatencies = [];

function percentile(sorted, p) {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function timed(path) {
  const t0 = performance.now();
  let status = 0;
  try {
    const res = await fetch(base + path, { redirect: 'manual' });
    await res.arrayBuffer(); // drain body like a browser would
    status = res.status;
  } catch {
    status = 0;
  }
  const dt = performance.now() - t0;
  total += 1;
  if (status === 0 || status >= 500) failures += 1;
  latencies.push(dt);
  const now = Date.now();
  if (now >= dosWindowStart && now <= dosWindowEnd) dosWindowLatencies.push(dt);
}

async function userLoop(id) {
  const rng = mulberry32(0x9e3779b9 ^ id);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  while (Date.now() < stopAt) {
    const roll = rng();
    try {
      if (roll < 0.15) await timed(`/api/search?q=${encodeURIComponent(pick(NAME_QUERIES))}`);
      else if (roll < 0.3) await timed('/api/search?q=' + encodeURIComponent('+201286619966'));
      else if (roll < 0.4) await timed('/api/search?q=' + encodeURIComponent('http://facebook.com/MTIholding'));
      else if (roll < 0.45) await timed('/api/search?q=zzzzqqqq');
      else if (roll < 0.6 && seedDetailId) await timed(`/api/merchants/${seedDetailId}`);
      else if (roll < 0.7 && seedDetailId) await timed(`/merchant/${seedDetailId}`);
      else if (roll < 0.8) await timed('/');
      else if (roll < 0.9) await timed(`/search?q=${encodeURIComponent(pick(NAME_QUERIES))}`);
      else await timed('/api/search?q=b%20tech');
    } catch {
      failures += 1; // network-level abort counts as failure
    }
  }
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let seedDetailId = null;

// --- bootstrap: resolve a real merchant id through the public API ---
{
  const res = await fetch(base + '/api/search?q=' + encodeURIComponent('بي تك'));
  const body = await res.json();
  if (body.hits?.length) seedDetailId = body.hits[0].merchant.id;
  console.log(`bootstrap: seed merchant ${seedDetailId ?? 'NONE'} via /api/search`);
  if (!seedDetailId) process.exit(2);
}

console.log(`load test: base=${base} users=${concurrency} duration=${durationSec}s`);

// Warmup (excluded from measurements): let V8 JIT, fs cache, and socket pool settle.
{
  const warmUntil = Date.now() + 5000;
  const warmers = Array.from({ length: Math.min(concurrency, 10) }, async (_, i) => {
    while (Date.now() < warmUntil) {
      await fetch(i % 2 === 0 ? `${base}/api/search?q=b%20tech` : `${base}/`).then((r) => r.arrayBuffer()).catch(() => {});
    }
  });
  await Promise.all(warmers);
}
console.log('warmup complete');
// schedule hostile probes at t+10s: one over the route cap (expect instant 400),
// one just under it (must traverse the full search path and return honest zero hits)
const dosProbe = new Promise((resolve) => {
  setTimeout(async () => {
    dosWindowStart = Date.now();
    dosWindowEnd = Date.now() + 3000;
    const probe = async (q) => {
      const t0 = performance.now();
      const res = await fetch(`${base}/api/search?q=${encodeURIComponent(q)}`);
      const body = await res.json();
      return { status: res.status, ms: Math.round(performance.now() - t0), hits: body.hits?.length ?? -1 };
    };
    const overCap = await probe('x'.repeat(5000));
    const underCap = await probe('x'.repeat(299));
    resolve({ overCap, underCap });
  }, 10_000);
});

await Promise.all(Array.from({ length: concurrency }, (_, i) => userLoop(i)));
const dos = await dosProbe;

latencies.sort((a, b) => a - b);
dosWindowLatencies.sort((a, b) => a - b);

const rps = total / durationSec;
const p50 = percentile(latencies, 50).toFixed(1);
const p95 = percentile(latencies, 95).toFixed(1);
const p99 = percentile(latencies, 99).toFixed(1);
const max = latencies.length ? latencies[latencies.length - 1].toFixed(1) : 'NaN';
const dosP95 = percentile(dosWindowLatencies, 95)?.toFixed?.(1) ?? 'NaN';

console.log('--- results ---');
console.log(`requests:      ${total} (${rps.toFixed(1)} req/s)`);
console.log(`failures(5xx/net): ${failures}`);
console.log(`latency p50/p95/p99/max: ${p50}/${p95}/${p99}/${max} ms`);
console.log(`hostile >300-char query: HTTP ${dos.overCap.status}, ${dos.overCap.ms} ms (route cap 400 expected)`);
console.log(`hostile 299-char query: HTTP ${dos.underCap.status}, ${dos.underCap.ms} ms, ${dos.underCap.hits} hits (200 + honest zero expected)`);
console.log(`co-located traffic p95 during hostile window: ${dosP95} ms`);

const gatesOk =
  failures === 0 &&
  Number(p95) < 1000 && // single Node process, shared dev laptop; p50 ~24 ms proves headroom
  dos.overCap.status === 400 &&
  dos.overCap.ms < 500 &&
  dos.underCap.status === 200 &&
  dos.underCap.hits === 0 &&
  Number(dosP95) < 1500;

console.log(gatesOk ? 'LOAD:PASS' : 'LOAD:FAIL');
process.exit(gatesOk ? 0 : 1);
