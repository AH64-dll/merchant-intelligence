import type { IdentifierRole } from './identifier-policy';
import type { SourceCategory } from './taxonomy';

export type Sentiment = 'positive' | 'negative' | 'neutral';

export type IdentifierKind =
  | 'phone'
  | 'whatsapp'
  | 'facebook'
  | 'website'
  | 'email'
  | 'instagram'
  | 'address'
  | 'commercial_register'
  | 'marketplace'
  | 'google_maps'
  | 'tiktok';

export type MerchantState =
  | 'VERIFIED_HIGH_CONFIDENCE'
  | 'VERIFIED_MODERATE_CONFIDENCE'
  | 'MIXED_REPUTATION'
  | 'OFFICIAL_WARNING'
  | 'HIGH_RISK_SIGNALS'
  | 'REQUIRES_MANUAL_REVIEW'
  | 'IDENTITY_UNCERTAIN'
  | 'INSUFFICIENT_DATA';

export type InputKind = 'phone' | 'email' | 'url' | 'name';

/**
 * Match tiers and match kinds. `MatchedOn` pairs each tier with the identifier
 * kind or name map that produced the hit; ordering by tier is defined in
 * search.ts.
 */
export type MatchedOn =
  | IdentifierKind
  | 'website-host'
  | 'marketplace-host'
  | 'exact_name'
  | 'exact_alias'
  | 'normalized_variant'
  | 'partial_name'
  | 'typo';

export type SearchDiagnostic = 'invalid_egyptian_phone';

export interface SearchMatch {
  kind: MatchedOn;
  value: string;
  label: string;
}

export interface SearchResult {
  query: string;
  inputKind: InputKind;
  total: number;
  page: number;
  pageSize: number;
  ambiguous: boolean;
  diagnostic: SearchDiagnostic | null;
  hits: SearchHit[];
}

export const SEARCH_PAGE_SIZE = 20;

export type SearchTier =
  | 'exact_identifier'
  | 'exact_name'
  | 'exact_alias'
  | 'normalized_variant'
  | 'partial_name'
  | 'typo';

export interface Merchant {
  id: string;
  canonicalName: string;
  category: string;
  city: string;
  governorate: string;
  identityConfidence: number;
  state: MerchantState;
  createdAt: string;
  updatedAt: string;
}

export interface SearchHit {
  merchant: Merchant;
  match: SearchMatch;
}

export interface Identifier {
  id: number;
  /** Original stored value, e.g. as typed by the pipeline. */
  value: string;
  /** Pipeline-normalized value used for matching. */
  normalizedValue: string;
  kind: IdentifierKind;
  /** Stored pipeline confidence. Internal/audit only — never shown as a percentage. */
  confidence: number;
  role: IdentifierRole;
  searchable: boolean;
  displayable: boolean;
}

export interface EvidenceItem {
  id: string;
  claimType: string;
  sentiment: Sentiment;
  summary: string;
  quotedExcerpt: string;
  authorType: string;
  /** Raw pipeline confidence. Internal/audit only — never shown as a percentage. */
  confidence: number;
  reliabilityBand: string;
  language: string;
  publishedAt: string | null;
  capturedAt: string;
  platform: string;
  url: string;
  sourceType: string;
  sourceCategory: SourceCategory;
  transactionEvidence: boolean;
  /** Stored review flag: evidence was included in an automated verification round. */
  verified: boolean;
  /** Stored duplicate-suppression flag: this row is not marked as a duplicate. */
  independent: boolean;
  /** Direct duplicate pointer (already root-canonical in schema v3). */
  duplicateOf: string | null;
  /** Merchant that owns the duplicate root, when the root lives on another merchant. */
  duplicateRootMerchantId: string | null;
  /** Claim this evidence is attributed to, when linked. */
  claimId: string | null;
}

export interface ClaimItem {
  id: string;
  claimType: string;
  sentiment: Sentiment;
  summary: string;
  independentSourceCount: number;
  mentionCount: number;
  /** Evidence ids linked through claim_evidence. */
  evidenceIds: string[];
}

export interface AnalysisPayload {
  merchantName: string;
  identityConfidence: number;
  evidenceSummary: string;
  sourceDiversity: number;
  verifiedClaims: string[];
  unverifiedClaims: string[];
  contradictions: string[];
  riskSignals: string[];
  positiveSignals: string[];
  missingInformation: string[];
  requiresMoreResearch: boolean;
  internalState: string;
  evidenceConfidence: number;
  reputationNotes: string;
  fraudRiskNotes: string;
  consumerSatisfactionNotes: string;
}

/** Detail view payload without the snapshot manifest. */
export interface MerchantDetailBase {
  merchant: Merchant;
  identifiers: Identifier[];
  aliases: string[];
  evidence: EvidenceItem[];
  claims: ClaimItem[];
  analysis: AnalysisPayload | null;
  /** Sentiment counts computed over non-duplicate evidence only. */
  sentiment: SentimentCounts;
  /** Count of duplicate evidence rows excluded from `sentiment`. */
  duplicateEvidenceCount: number;
  related: RelatedMerchant[];
}

export interface SentimentCounts {
  positive: number;
  negative: number;
  neutral: number;
}

/** MerchantLinks projection with rationale; confidence is internal/audit only. */
export interface RelatedMerchant {
  id: string;
  name: string;
  relation: string;
  rationale: string;
  /** Raw pipeline link confidence. Internal/audit only — never shown as a percentage. */
  confidence: number;
}

/**
 * One-row snapshot manifest written by snapshot-db.sh. MerchantDb validates it
 * against the actual tables at startup — no legacy fallback.
 */
export interface SnapshotInfo {
  generatedAt: string;
  sourceSchemaVersion: number;
  appSchemaVersion: number;
  counts: Record<string, number>;
}

export interface MerchantDetail extends MerchantDetailBase {
  snapshot: SnapshotInfo;
}

export const MERCHANT_DIRECTORY_PAGE_SIZE = 20;

export type MerchantDirectoryView = 'all' | 'positive-evidence';
export type MerchantDirectoryCoverageLevel = 'none' | 'limited' | 'moderate' | 'broad';

/**
 * Public seller summary used by directory pages and the list API.
 *
 * Deliberately excludes model state, confidence, reliability, duplicate
 * pointers, and raw provenance. Those remain available only in seller detail.
 */
export interface MerchantDirectoryEntry {
  id: string;
  canonicalName: string;
  categoryTags: string[];
  locationLabel: string;
  /** Number of distinct stored address records, not an asserted branch count. */
  locationCount: number;
  identityLevel: 'established' | 'supported' | 'uncertain';
  coverageLevel: MerchantDirectoryCoverageLevel;
  evidence: {
    total: number;
    nonDuplicate: number;
    distinctSources: number;
    positive: number;
    neutral: number;
    negative: number;
    customerPositiveSources: number;
    latestPublishedAt: string | null;
    lastCapturedAt: string | null;
  };
  positiveHighlight: null | {
    evidenceId: string;
    summary: string;
    sourceUrl: string;
    sourceCategory: SourceCategory;
    publishedAt: string | null;
  };
  updatedAt: string;
}

export interface MerchantDirectoryFilters {
  category?: string;
  governorate?: string;
  coverage?: MerchantDirectoryCoverageLevel;
}

export interface MerchantDirectoryQuery extends MerchantDirectoryFilters {
  view: MerchantDirectoryView;
  page: number;
}

/** Raw server query values accepted by the shared directory selector. */
export interface MerchantDirectoryQueryInput {
  view?: unknown;
  page?: unknown;
  category?: unknown;
  governorate?: unknown;
  coverage?: unknown;
}

export interface MerchantDirectoryPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface MerchantDirectoryAvailableFilters {
  categories: readonly string[];
  governorates: readonly string[];
  coverage: readonly MerchantDirectoryCoverageLevel[];
}

export interface MerchantDirectoryResult {
  items: readonly MerchantDirectoryEntry[];
  pagination: MerchantDirectoryPagination;
  availableFilters: MerchantDirectoryAvailableFilters;
  snapshot: SnapshotInfo;
}
