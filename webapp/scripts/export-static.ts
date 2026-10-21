/**
 * Static data exporter for `output: 'export'` builds.
 *
 * Reads the frozen snapshot DB (data/merchants.db) and emits every JSON payload
 * the static site needs into public/, so a plain `next build` produces a fully
 * self-contained artifact — no server-side data fetches at request time.
 *
 * Outputs:
 *   public/data/search-index.json      SearchIndex input (getIndexData) — lazy-fetched by /search
 *   public/data/directory-source.json  buildMerchantDirectoryProjection inputs — lazy-fetched by directory pages
 *   public/api/merchants/index.json    Full public directory list (API parity for /api/merchants)
 *   public/api/merchants/<id>.json     Per-merchant detail (API parity for /api/merchants/[id])
 *
 * Run: pnpm export:data   (after pnpm snapshot)
 */

import { CONTENT_SECURITY_POLICY } from '../src/lib/csp';

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { getDb } from '../src/lib/singletons';
import { publicDetail, publicEntry, publicResult } from '../src/lib/public-api';
const PUBLIC = join(process.cwd(), 'public');

function emit(relPath: string, data: unknown): number {
  const abs = join(PUBLIC, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  const body = JSON.stringify(data);
  writeFileSync(abs, body);
  return body.length;
}

function main(): void {
  const db = getDb();

  // Ship a stable neutral confidence value — the field is a sort tie-breaker
  // consumed by SearchIndex, but the raw pipeline score must not be public.
  const indexData = db.getIndexData();
  const sanitizedIndex = {
    ...indexData,
    merchants: indexData.merchants.map((m) => ({ ...m, identityConfidence: 0.5 })),
  };
  const indexBytes = emit('data/search-index.json', sanitizedIndex);
  console.log(`search-index.json      ${(indexBytes / 1024).toFixed(0)} KB`);

  const dirBytes = emit('data/directory.json', db.getDirectoryProjection());
  console.log(`directory.json         ${(dirBytes / 1024).toFixed(0)} KB`);
  // API parity shards: full public item list (no pagination cap) + filter metadata.
  const list = publicResult(db.getMerchantDirectory({ view: 'all', page: 1 }));
  const fullList = {
    ...list,
    items: db.getMerchantDirectoryEntries().map((entry) => publicEntry(entry)),
  };
  const listBytes = emit('api/merchants/index.json', fullList);
  console.log(`api/merchants/index.json  ${(listBytes / 1024).toFixed(0)} KB (${fullList.items.length} merchants)`);

  let detailBytes = 0;
  let detailCount = 0;
  for (const entry of fullList.items) {
    const detail = db.getMerchantDetail(entry.id);
    if (detail === null) continue;
    detailBytes += emit(`api/merchants/${entry.id}.json`, publicDetail(detail, db.getSnapshotInfo()));
    detailCount += 1;
  }

  // sitemap.xml: every canonical route, both locales, every merchant.
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://daleeleltogar.pages.dev').replace(/\/$/, '');
  const urls: string[] = [];
  const push = (path: string) => urls.push(`${base}${path}`);
  push('/');
  for (const loc of ['ar', 'en'] as const) {
    for (const tail of ['', 'merchants/', 'merchants/positive-evidence/', 'search/', 'privacy/']) {
      push(`/${loc}/${tail}`);
    }
    for (const entry of fullList.items) {
      push(`/${loc}/merchant/${entry.id}/`);
    }
  }
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>\n`;
  writeFileSync(join(PUBLIC, 'sitemap.xml'), sitemap);
  console.log(`sitemap.xml            ${urls.length} urls`);
  console.log(`api/merchants/<id>.json ${(detailBytes / 1024 / 1024).toFixed(2)} MB total across ${detailCount} shards`);
  const headersFile = [
    '/*',
    `  Content-Security-Policy: ${CONTENT_SECURITY_POLICY}`,
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  X-Frame-Options: DENY',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()',
    '  Cross-Origin-Opener-Policy: same-origin',
    '',
    '/data/*',
    '  X-Robots-Tag: noindex, nofollow',
    '',
    '/api/*',
    '  X-Robots-Tag: noindex, nofollow',
    '',
  ].join('\n');
  writeFileSync(join(PUBLIC, '_headers'), headersFile);
  console.log('_headers emitted (Cloudflare Pages)');
}

main();
