import type {
  EvidenceItem,
  Identifier,
  MerchantDetail,
  MerchantDirectoryEntry,
  MerchantDirectoryResult,
  RelatedMerchant,
  SnapshotInfo,
} from './types';

import { publicAnalysisText } from './db';

/**
 * Whitelisted public projections shared by the static JSON exporter
 * (scripts/export-static.ts). These mirror the field allow-lists the former
 * /api/merchants* route handlers served — same contract, same omission of
 * internal confidence/state fields per the interpretation boundary.
 */

export function publicEntry(entry: MerchantDirectoryEntry): MerchantDirectoryEntry {
  return {
    id: entry.id,
    canonicalName: entry.canonicalName,
    categoryTags: [...entry.categoryTags],
    locationLabel: entry.locationLabel,
    locationCount: entry.locationCount,
    identityLevel: entry.identityLevel,
    coverageLevel: entry.coverageLevel,
    evidence: {
      total: entry.evidence.total,
      nonDuplicate: entry.evidence.nonDuplicate,
      distinctSources: entry.evidence.distinctSources,
      positive: entry.evidence.positive,
      neutral: entry.evidence.neutral,
      negative: entry.evidence.negative,
      customerPositiveSources: entry.evidence.customerPositiveSources,
      latestPublishedAt: entry.evidence.latestPublishedAt,
      lastCapturedAt: entry.evidence.lastCapturedAt,
    },
    positiveHighlight: entry.positiveHighlight === null
      ? null
      : {
          evidenceId: entry.positiveHighlight.evidenceId,
          summary: publicAnalysisText(entry.positiveHighlight.summary),
          sourceUrl: entry.positiveHighlight.sourceUrl,
          sourceCategory: entry.positiveHighlight.sourceCategory,
          publishedAt: entry.positiveHighlight.publishedAt,
        },
    updatedAt: entry.updatedAt,
  };
}

export function publicResult(result: MerchantDirectoryResult): MerchantDirectoryResult {
  return {
    items: result.items.map(publicEntry),
    pagination: {
      page: result.pagination.page,
      pageSize: result.pagination.pageSize,
      total: result.pagination.total,
      totalPages: result.pagination.totalPages,
    },
    availableFilters: {
      categories: [...result.availableFilters.categories],
      governorates: [...result.availableFilters.governorates],
      coverage: [...result.availableFilters.coverage],
    },
    snapshot: {
      generatedAt: result.snapshot.generatedAt,
      sourceSchemaVersion: result.snapshot.sourceSchemaVersion,
      appSchemaVersion: result.snapshot.appSchemaVersion,
      counts: { ...result.snapshot.counts },
    },
  };
}

function publicIdentifier(identifier: Identifier) {
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

function publicEvidence(evidence: EvidenceItem) {
  return {
    id: evidence.id,
    claimType: evidence.claimType,
    sentiment: evidence.sentiment,
    summary: publicAnalysisText(evidence.summary),
    quotedExcerpt: publicAnalysisText(evidence.quotedExcerpt),
    authorType: evidence.authorType,
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

function publicRelated(related: RelatedMerchant) {
  return {
    id: related.id,
    name: related.name,
    relation: related.relation,
    rationale: publicAnalysisText(related.rationale),
  };
}

function publicMerchant(merchant: MerchantDetail['merchant']) {
  return {
    id: merchant.id,
    canonicalName: merchant.canonicalName,
    category: merchant.category,
    city: merchant.city,
    governorate: merchant.governorate,
    createdAt: merchant.createdAt,
    updatedAt: merchant.updatedAt,
  };
}

function publicAnalysis(analysis: MerchantDetail['analysis']) {
  if (analysis === null) return null;
  return {
    evidenceSummary: analysis.evidenceSummary ?? '',
    verifiedClaims: Array.isArray(analysis.verifiedClaims) ? [...analysis.verifiedClaims] : [],
    unverifiedClaims: Array.isArray(analysis.unverifiedClaims) ? [...analysis.unverifiedClaims] : [],
    contradictions: Array.isArray(analysis.contradictions) ? [...analysis.contradictions] : [],
    riskSignals: Array.isArray(analysis.riskSignals) ? [...analysis.riskSignals] : [],
    positiveSignals: Array.isArray(analysis.positiveSignals) ? [...analysis.positiveSignals] : [],
    missingInformation: Array.isArray(analysis.missingInformation) ? [...analysis.missingInformation] : [],
    reputationNotes: analysis.reputationNotes ?? '',
    fraudRiskNotes: analysis.fraudRiskNotes ?? '',
    consumerSatisfactionNotes: analysis.consumerSatisfactionNotes ?? '',
  };
}

function publicBrief(brief: MerchantDetail['brief']) {
  if (brief === null) return null;
  const rawBullets: unknown[] =
    brief.payload !== null &&
    typeof brief.payload === 'object' &&
    'bullets' in brief.payload &&
    Array.isArray(brief.payload.bullets)
      ? brief.payload.bullets
      : [];
  const bullets = rawBullets.map((b) => {
    if (typeof b === 'object' && b !== null) {
      const item = b as Record<string, unknown>;
      const candidate = item.evidence_ids ?? item.evidenceIds;
      const rawIds = Array.isArray(candidate) ? candidate : [];
      return {
        text: typeof item.text === 'string' ? item.text : '',
        evidenceIds: rawIds.filter((x): x is string => typeof x === 'string'),
      };
    }
    return { text: String(b), evidenceIds: [] };
  });
  return {
    generatedAt: brief.generatedAt,
    model: brief.model,
    isFresh: brief.isFresh,
    bullets,
  };
}

/** Public detail projection: whitelisted displayable fields only. */
export function publicDetail(detail: MerchantDetail, snapshot: SnapshotInfo) {
  return {
    merchant: publicMerchant(detail.merchant),
    identifiers: detail.identifiers.filter((identifier) => identifier.displayable).map(publicIdentifier),
    aliases: [...detail.aliases],
    evidence: detail.evidence.map(publicEvidence),
    claims: detail.claims.map((claim) => ({ ...claim, evidenceIds: [...claim.evidenceIds] })),
    analysis: publicAnalysis(detail.analysis),
    sentiment: { ...detail.sentiment },
    related: detail.related.map(publicRelated),
    duplicateEvidenceCount: detail.duplicateEvidenceCount,
    duplicateChildrenCount: detail.duplicateChildrenCount,
    sourceOnlyCount: detail.sourceOnlyCount,
    brief: publicBrief(detail.brief),
    snapshot,
  };
}
