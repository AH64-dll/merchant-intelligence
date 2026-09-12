import { renderCacheGet, renderCacheSet } from '../../../../src/lib/render-cache';
import { getDb } from '../../../../src/lib/singletons';
import type {
  EvidenceItem,
  Identifier,
  MerchantDetail,
  RelatedMerchant,
  SnapshotInfo,
} from '../../../../src/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Public projection of one stored identifier: the internal/audit-only
 * `confidence` never leaves the server, and non-displayable values are
 * filtered out by the caller — the detail page applies the same policy
 * (IdentifierList filters on `displayable`).
 */
function publicIdentifier(identifier: Identifier): Omit<Identifier, 'confidence'> {
  return {
    id: identifier.id,
    value: identifier.value,
    normalizedValue: identifier.normalizedValue,
    kind: identifier.kind,
    role: identifier.role,
    searchable: identifier.searchable,
    displayable: identifier.displayable,
  };
}

/** Public projection of one evidence row: the internal `confidence` is dropped. */
function publicEvidence(evidence: EvidenceItem): Omit<EvidenceItem, 'confidence'> {
  return {
    id: evidence.id,
    claimType: evidence.claimType,
    sentiment: evidence.sentiment,
    summary: evidence.summary,
    quotedExcerpt: evidence.quotedExcerpt,
    authorType: evidence.authorType,
    reliabilityBand: evidence.reliabilityBand,
    language: evidence.language,
    publishedAt: evidence.publishedAt,
    capturedAt: evidence.capturedAt,
    platform: evidence.platform,
    url: evidence.url,
    sourceType: evidence.sourceType,
    sourceCategory: evidence.sourceCategory,
    transactionEvidence: evidence.transactionEvidence,
    verified: evidence.verified,
    independent: evidence.independent,
    duplicateOf: evidence.duplicateOf,
    duplicateRootMerchantId: evidence.duplicateRootMerchantId,
    claimId: evidence.claimId,
    citations: evidence.citations.map((citation) => ({ ...citation })),
    isMeaningful: evidence.isMeaningful,
    isDuplicateChild: evidence.isDuplicateChild,
  };
}

/** Public projection of one link: the internal link `confidence` is dropped. */
function publicRelated(related: RelatedMerchant): Omit<RelatedMerchant, 'confidence'> {
  return {
    id: related.id,
    name: related.name,
    relation: related.relation,
    rationale: related.rationale,
  };
}

/** Public detail projection: same top-level shape, internal fields dropped. */
function publicDetail(detail: MerchantDetail, snapshot: SnapshotInfo) {
  return {
    merchant: detail.merchant,
    identifiers: detail.identifiers.filter((identifier) => identifier.displayable).map(publicIdentifier),
    aliases: [...detail.aliases],
    evidence: detail.evidence.map(publicEvidence),
    claims: detail.claims.map((claim) => ({ ...claim, evidenceIds: [...claim.evidenceIds] })),
    analysis: detail.analysis,
    sentiment: { ...detail.sentiment },
    related: detail.related.map(publicRelated),
    duplicateEvidenceCount: detail.duplicateEvidenceCount,
    duplicateChildrenCount: detail.duplicateChildrenCount,
    sourceOnlyCount: detail.sourceOnlyCount,
    brief: detail.brief,
    snapshot,
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const key = `api-merchant:${id}`;
    const cached = renderCacheGet(key);
    if (cached !== undefined) {
      return new Response(cached.body, { headers: { 'content-type': cached.contentType } });
    }
    const db = getDb();
    const detail = db.getMerchantDetail(id);
    if (detail === null) {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }
    const body = JSON.stringify(publicDetail(detail, db.getSnapshotInfo()));
    renderCacheSet(key, body, 'application/json');
    return new Response(body, { headers: { 'content-type': 'application/json' } });
  } catch {
    // Generic body only: never leak error messages or filesystem paths.
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
