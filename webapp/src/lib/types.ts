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
}

export interface SearchHit {
  merchant: Merchant;
  match: SearchMatch;
}

export interface Identifier {
  kind: IdentifierKind;
  value: string;
  confidence: number;
}

export interface EvidenceItem {
  id: string;
  claimType: string;
  sentiment: Sentiment;
  summary: string;
  quotedExcerpt: string;
  authorType: string;
  confidence: number;
  reliabilityBand: string;
  language: string;
  publishedAt: string | null;
  platform: string;
  url: string;
  independent: boolean;
}

export interface ClaimItem {
  id: string;
  claimType: string;
  sentiment: Sentiment;
  summary: string;
  independentSourceCount: number;
  mentionCount: number;
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

export interface SentimentCounts {
  positive: number;
  negative: number;
  neutral: number;
}

export interface MerchantDetail {
  merchant: Merchant;
  identifiers: Identifier[];
  aliases: string[];
  evidence: EvidenceItem[];
  claims: ClaimItem[];
  analysis: AnalysisPayload | null;
  sentiment: SentimentCounts;
  related: { id: string; name: string; relation: string; confidence: number }[];
}
