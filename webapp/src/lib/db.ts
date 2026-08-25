import Database from 'better-sqlite3';
import type { Database as DatabaseHandle } from 'better-sqlite3';
import type {
  AnalysisPayload,
  ClaimItem,
  EvidenceItem,
  Identifier,
  IdentifierKind,
  Merchant,
  MerchantDetail,
  MerchantState,
  Sentiment,
  SentimentCounts,
} from './types';
const SEARCHABLE_KINDS: readonly IdentifierKind[] = [
  'phone',
  'whatsapp',
  'facebook',
  'website',
  'email',
  'instagram',
  'marketplace',
  'google_maps',
  'tiktok',
];
export interface IndexData {
  merchants: Merchant[];
  identifiers: { merchantId: string; kind: IdentifierKind; normalized: string }[];
  aliases: { merchantId: string; alias: string }[];
}

interface MerchantRow {
  id: string;
  canonical_name: string;
  category: string;
  city: string;
  governorate: string;
  identity_confidence: number;
  state: MerchantState;
}

interface IndexIdentifierRow {
  merchant_id: string;
  kind: IdentifierKind;
  normalized_value: string;
}

interface AliasRow {
  merchant_id: string;
  alias: string;
}

interface DetailIdentifierRow {
  kind: IdentifierKind;
  normalized_value: string;
  confidence: number;
}

interface EvidenceRow {
  id: string;
  claim_type: string;
  sentiment: Sentiment;
  summary: string;
  quoted_excerpt: string;
  author_type: string;
  confidence: number;
  reliability_band: string;
  language: string;
  published_at: string | null;
  platform: string;
  url: string;
  independent: number;
}

interface ClaimRow {
  id: string;
  claim_type: string;
  sentiment: Sentiment;
  summary: string;
  independent_source_count: number;
  mention_count: number;
}

interface AnalysisRow {
  payload_json: string;
}

interface RelatedRow {
  relation: string;
  confidence: number;
  id: string;
  canonical_name: string;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function bool(value: unknown): boolean {
  return value === true;
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function parseAnalysisPayload(payloadJson: string): AnalysisPayload | null {
  let raw: unknown;
  try {
    raw = JSON.parse(payloadJson);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const p = raw as Record<string, unknown>;
  const evidenceSummaryRaw = p['evidence_summary'];
  const evidenceSummary =
    typeof evidenceSummaryRaw === 'object' && evidenceSummaryRaw !== null
      ? str((evidenceSummaryRaw as Record<string, unknown>)['summary'])
      : '';
  return {
    merchantName: str(p['merchant_name']),
    identityConfidence: num(p['identity_confidence']),
    evidenceSummary,
    sourceDiversity: num(p['source_diversity']),
    verifiedClaims: strArray(p['verified_claims']),
    unverifiedClaims: strArray(p['unverified_claims']),
    contradictions: strArray(p['contradictions']),
    riskSignals: strArray(p['risk_signals']),
    positiveSignals: strArray(p['positive_signals']),
    missingInformation: strArray(p['missing_information']),
    requiresMoreResearch: bool(p['requires_more_research']),
    internalState: str(p['internal_state']),
    evidenceConfidence: num(p['evidence_confidence']),
    reputationNotes: str(p['reputation_notes']),
    fraudRiskNotes: str(p['fraud_risk_notes']),
    consumerSatisfactionNotes: str(p['consumer_satisfaction_notes']),
  };
}


export class MerchantDb {
  private readonly db: DatabaseHandle;
  private readonly stmtMerchants: Database.Statement;
  private readonly stmtIndexIdentifiers: Database.Statement;
  private readonly stmtAliases: Database.Statement;
  private readonly stmtMerchantById: Database.Statement<[string]>;
  private readonly stmtDetailIdentifiers: Database.Statement<[string]>;
  private readonly stmtDetailAliases: Database.Statement<[string]>;
  private readonly stmtEvidence: Database.Statement<[string]>;
  private readonly stmtClaims: Database.Statement<[string]>;
  private readonly stmtLatestAnalysis: Database.Statement<[string]>;
  private readonly stmtRelatedOutgoing: Database.Statement<[string]>;
  private readonly stmtRelatedIncoming: Database.Statement<[string]>;

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const kindPlaceholders = SEARCHABLE_KINDS.map(() => '?').join(', ');
    this.stmtMerchants = this.db.prepare(
      'SELECT id, canonical_name, category, city, governorate, identity_confidence, state FROM merchants ORDER BY id',
    );
    this.stmtIndexIdentifiers = this.db.prepare(
      `SELECT merchant_id, kind, normalized_value FROM merchant_identifiers
       WHERE kind IN (${kindPlaceholders})
       ORDER BY merchant_id, kind, normalized_value`,
    );
    this.stmtAliases = this.db.prepare(
      'SELECT merchant_id, alias FROM merchant_aliases ORDER BY merchant_id, alias',
    );
    this.stmtMerchantById = this.db.prepare(
      'SELECT id, canonical_name, category, city, governorate, identity_confidence, state FROM merchants WHERE id = ?',
    );
    this.stmtDetailIdentifiers = this.db.prepare(
      `SELECT kind, normalized_value, confidence FROM merchant_identifiers
       WHERE merchant_id = ? ORDER BY kind, normalized_value`,
    );
    this.stmtDetailAliases = this.db.prepare(
      'SELECT alias FROM merchant_aliases WHERE merchant_id = ? ORDER BY alias',
    );
    this.stmtEvidence = this.db.prepare(
      `SELECT e.id, e.claim_type, e.sentiment, e.summary, e.quoted_excerpt, e.author_type,
              e.confidence, e.reliability_band, e.language, e.published_at,
              s.platform, s.url, e.independent
       FROM evidence e JOIN sources s ON s.id = e.source_id
       WHERE e.merchant_id = ?
       ORDER BY e.published_at DESC NULLS LAST, e.captured_at DESC`,
    );
    this.stmtClaims = this.db.prepare(
      `SELECT id, claim_type, sentiment, summary, independent_source_count, mention_count
       FROM claims WHERE merchant_id = ?
       ORDER BY independent_source_count DESC, mention_count DESC, id`,
    );
    this.stmtLatestAnalysis = this.db.prepare(
      `SELECT payload_json FROM merchant_analyses WHERE merchant_id = ?
       ORDER BY round_no DESC, id DESC LIMIT 1`,
    );
    this.stmtRelatedOutgoing = this.db.prepare(
      `SELECT ml.relation, ml.confidence, m.id, m.canonical_name
       FROM merchant_links ml JOIN merchants m ON m.id = ml.right_merchant_id
       WHERE ml.left_merchant_id = ?`,
    );
    this.stmtRelatedIncoming = this.db.prepare(
      `SELECT ml.relation, ml.confidence, m.id, m.canonical_name
       FROM merchant_links ml JOIN merchants m ON m.id = ml.left_merchant_id
       WHERE ml.right_merchant_id = ?`,
    );
  }

  getIndexData(): IndexData {
    const merchants = (this.stmtMerchants.all() as MerchantRow[]).map((row) => ({
      id: row.id,
      canonicalName: row.canonical_name,
      category: row.category,
      city: row.city,
      governorate: row.governorate,
      identityConfidence: row.identity_confidence,
      state: row.state,
    }));
    const identifierRows = this.stmtIndexIdentifiers.all(...SEARCHABLE_KINDS) as IndexIdentifierRow[];
    const identifiers = identifierRows.map((row) => ({
      merchantId: row.merchant_id,
      kind: row.kind,
      normalized: row.normalized_value,
    }));
    const aliases = (this.stmtAliases.all() as AliasRow[]).map((row) => ({
      merchantId: row.merchant_id,
      alias: row.alias,
    }));
    return { merchants, identifiers, aliases };
  }

  getMerchantDetail(id: string): MerchantDetail | null {
    const merchantRow = this.stmtMerchantById.get(id) as MerchantRow | undefined;
    if (merchantRow === undefined) {
      return null;
    }

    const identifierRows = this.stmtDetailIdentifiers.all(id) as DetailIdentifierRow[];
    const identifiers: Identifier[] = identifierRows.map((row) => ({
      kind: row.kind,
      value: row.normalized_value,
      confidence: row.confidence,
    }));

    const aliases = (this.stmtDetailAliases.all(id) as { alias: string }[]).map((row) => row.alias);

    const evidenceRows = this.stmtEvidence.all(id) as EvidenceRow[];
    const evidence: EvidenceItem[] = evidenceRows.map((row) => ({
      id: row.id,
      claimType: row.claim_type,
      sentiment: row.sentiment,
      summary: row.summary,
      quotedExcerpt: row.quoted_excerpt,
      authorType: row.author_type,
      confidence: row.confidence,
      reliabilityBand: row.reliability_band,
      language: row.language,
      publishedAt: row.published_at,
      platform: row.platform,
      url: row.url,
      independent: row.independent !== 0,
    }));

    const claimRows = this.stmtClaims.all(id) as ClaimRow[];
    const claims: ClaimItem[] = claimRows.map((row) => ({
      id: row.id,
      claimType: row.claim_type,
      sentiment: row.sentiment,
      summary: row.summary,
      independentSourceCount: row.independent_source_count,
      mentionCount: row.mention_count,
    }));

    const analysisRow = this.stmtLatestAnalysis.get(id) as AnalysisRow | undefined;
    const analysis = analysisRow === undefined ? null : parseAnalysisPayload(analysisRow.payload_json);

    const sentiment: SentimentCounts = { positive: 0, negative: 0, neutral: 0 };
    for (const item of evidence) {
      if (item.sentiment === 'positive') {
        sentiment.positive += 1;
      } else if (item.sentiment === 'negative') {
        sentiment.negative += 1;
      } else {
        sentiment.neutral += 1;
      }
    }

    const related = [
      ...(this.stmtRelatedOutgoing.all(id) as RelatedRow[]),
      ...(this.stmtRelatedIncoming.all(id) as RelatedRow[]),
    ].map((row) => ({
      id: row.id,
      name: row.canonical_name,
      relation: row.relation,
      confidence: row.confidence,
    }));

    return {
      merchant: {
        id: merchantRow.id,
        canonicalName: merchantRow.canonical_name,
        category: merchantRow.category,
        city: merchantRow.city,
        governorate: merchantRow.governorate,
        identityConfidence: merchantRow.identity_confidence,
        state: merchantRow.state,
      },
      identifiers,
      aliases,
      evidence,
      claims,
      analysis,
      sentiment,
      related,
    };
  }
}
