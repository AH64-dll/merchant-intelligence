import { beforeAll, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { assessEvidenceCoverage, assessIdentity, assessReputation } from '../lib/assessment';
import type { EvidenceCoverage } from '../lib/assessment';
import { MerchantDb } from '../lib/db';
import { EvidenceCard } from './EvidenceCard';
import { ClaimCards } from './ClaimCards';
import { SentimentBar } from './SentimentBar';

/**
 * Snapshot-driven contract test: real merchants in the three sensitive
 * states must render without trust/rating copy and without leaked internal
 * fields. Uses the same snapshot the app serves; read-only.
 */
const BANNED_COPY = ['موثوق', 'جيد', 'الحكم', 'التقييمات', 'trust score'];
const BANNED_LEAKS = ['identityConfidence', 'duplicate_of', 'source_type:', 'reliability_band'];

/**
 * Banned words inside raw quoted excerpts are verbatim community/user text —
 * data we display as quoted provenance, not product copy. These UI strings
 * must never appear: our own trust-adjacent Arabic copy and internal field
 * names. The renderMerchant() output below excludes quoted excerpts for the
 * banned-copy check (they are checked separately for safe links only).
 */

const MERCHANTS_DB = process.env.MERCHANTS_DB ?? './data/merchants.db';

let db: MerchantDb;

beforeAll(() => {
  db = new MerchantDb(MERCHANTS_DB);
});

function renderMerchant(id: string): string {
  const detail = db.getMerchantDetail(id);
  if (detail === null) throw new Error(`merchant ${id} missing from snapshot`);
  const identity = assessIdentity(
    detail.merchant.state,
    detail.identifiers,
    detail.related.map((r) => r.relation),
  );
  const coverage = assessEvidenceCoverage(detail.evidence);
  const reputation = assessReputation(
    detail.merchant.state,
    detail.evidence,
    new Date('2026-08-30T00:00:00Z'),
  );
  // Quoted excerpts contain verbatim community text, so they are excluded
  // from the banned-copy assertion (which guards OUR copy, not the data).
  const partsWithoutExcerpts: string[] = [
    detail.merchant.canonicalName,
    identity.level,
    coverageText(coverage),
    reputation.headline,
    reputation.explanation,
    ...detail.evidence.map((evidence) =>
      renderToStaticMarkup(
        createElement(EvidenceCard, {
          evidence: { ...evidence, quotedExcerpt: '' },
        }),
      ),
    ),
    ...detail.claims.map((claim) =>
      renderToStaticMarkup(createElement(ClaimCards, { claims: [claim] })),
    ),
    renderToStaticMarkup(
      createElement(SentimentBar, {
        sentiment: detail.sentiment,
        duplicateCount: detail.duplicateEvidenceCount,
      }),
    ),
  ];
  return partsWithoutExcerpts.join('\n');
}

function coverageText(coverage: EvidenceCoverage): string {
  return [
    coverage.level,
    String(coverage.nonDuplicate),
    String(coverage.total),
    String(coverage.distinctSources),
  ].join(' ');
}

describe('snapshot merchants render without banned trust/rating copy', () => {
  it('OFFICIAL_WARNING merchant (Metra Computer)', () => {
    const html = renderMerchant('0eca990d-d567-45a7-b565-c1b284974c14');
    for (const banned of BANNED_COPY) expect(html).not.toContain(banned);
    for (const leak of BANNED_LEAKS) expect(html).not.toContain(leak);
    // A linked official signal stays dated and source-attributed.
    expect(html).toContain('إشارة رسمية');
  });

  it('IDENTITY_UNCERTAIN merchant (Future Electronics Egypt)', () => {
    const html = renderMerchant('ae094b1c-9d78-4800-89da-088b3330c4de');
    for (const banned of BANNED_COPY) expect(html).not.toContain(banned);
    // Uncertain identity never receives a reputation conclusion.
    expect(html).toContain('لا يمكن إسناد استنتاج سمعة');
  });

  it('INSUFFICIENT_DATA merchant (Sigma Computer)', () => {
    const html = renderMerchant('3da82768-832c-4bf5-80c1-6cf3059cf5c5');
    for (const banned of BANNED_COPY) expect(html).not.toContain(banned);
    // Sigma carries mixed positive/negative evidence, so the reputation
    // narrative is the MIXED "conflicting evidence" wording with counts —
    // never a trust label.
    expect(html).toMatch(/أدلة متضاربة|إشارة إيجابية|إشارة سلبية/);
  });

  it('evidence rows in the OFFICIAL_WARNING merchant use safe links only', () => {
    const detail = db.getMerchantDetail('0eca990d-d567-45a7-b565-c1b284974c14');
    if (detail === null) throw new Error('merchant missing');
    for (const evidence of detail.evidence) {
      const html = renderToStaticMarkup(createElement(EvidenceCard, { evidence }));
      if (evidence.url.startsWith('http://') || evidence.url.startsWith('https://')) {
        expect(html).toContain('<a');
      } else {
        expect(html).not.toContain('<a href');
        // raw scheme value remains visible as provenance text
        expect(html).toContain(evidence.url.split('/')[0]);
      }
    }
  });
});
