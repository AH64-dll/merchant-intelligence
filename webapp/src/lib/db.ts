import Database from 'better-sqlite3';
import type { Database as DatabaseHandle } from 'better-sqlite3';
import { buildMerchantDirectoryProjection, selectMerchantDirectory } from './directory';
import type {
  DirectoryEvidenceRow,
  DirectoryLinkRow,
  DirectoryMerchantIdentifierRow,
  MerchantDirectoryProjection,
} from './directory';
import { identifyIdentifierRole, isDisplayableIdentifier, isSearchableIdentifier } from './identifier-policy';
import { deriveSourceCategory } from './taxonomy';
import type {
  AnalysisPayload,
  ClaimItem,
  EvidenceItem,
  Identifier,
  IdentifierKind,
  Merchant,
  MerchantDetail,
  MerchantDirectoryEntry,
  MerchantDirectoryQueryInput,
  MerchantDirectoryResult,
  MerchantState,
  Sentiment,
  SentimentCounts,
  SnapshotInfo,
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

const APP_SCHEMA_VERSION = 1;
const SOURCE_SCHEMA_VERSION = 3;

const MANIFEST_COUNT_KEYS = [
  'merchants',
  'sources',
  'evidence',
  'claims',
  'claim_evidence',
  'merchant_analyses',
  'merchant_identifiers',
  'merchant_aliases',
  'merchant_links',
] as const;

const MANIFEST_COUNT_COLUMNS: Record<(typeof MANIFEST_COUNT_KEYS)[number], string> = {
  merchants: 'merchants_count',
  sources: 'sources_count',
  evidence: 'evidence_count',
  claims: 'claims_count',
  claim_evidence: 'claim_evidence_count',
  merchant_analyses: 'merchant_analyses_count',
  merchant_identifiers: 'merchant_identifiers_count',
  merchant_aliases: 'merchant_aliases_count',
  merchant_links: 'merchant_links_count',
};

const MANIFEST_COUNT_TABLES: Record<(typeof MANIFEST_COUNT_KEYS)[number], string> = {
  merchants: 'merchants',
  sources: 'sources',
  evidence: 'evidence',
  claims: 'claims',
  claim_evidence: 'claim_evidence',
  merchant_analyses: 'merchant_analyses',
  merchant_identifiers: 'merchant_identifiers',
  merchant_aliases: 'merchant_aliases',
  merchant_links: 'merchant_links',
};

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
  created_at: string;
  updated_at: string;
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
  id: number;
  kind: IdentifierKind;
  value: string;
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
  captured_at: string;
  platform: string;
  url: string;
  source_type: string;
  transaction_evidence: number;
  verified: number;
  independent: number;
  duplicate_of: string | null;
  claim_id: string | null;
}

interface ClaimRow {
  id: string;
  claim_type: string;
  sentiment: Sentiment;
  summary: string;
  independent_source_count: number;
  mention_count: number;
}

interface ClaimEvidenceRow {
  claim_id: string;
  evidence_id: string;
}

interface AnalysisRow {
  payload_json: string;
}

interface DuplicateRootRow {
  id: string;
  merchant_id: string;
}

interface RelatedRow {
  relation: string;
  confidence: number;
  rationale: string;
  id: string;
  canonical_name: string;
}

interface SnapshotMetaRow {
  id: number;
  app_schema_version: number;
  source_schema_version: number;
  generated_at: string;
  merchants_count: number;
  sources_count: number;
  evidence_count: number;
  claims_count: number;
  claim_evidence_count: number;
  merchant_analyses_count: number;
  merchant_identifiers_count: number;
  merchant_aliases_count: number;
  merchant_links_count: number;
}

interface DirectoryEvidenceDbRow {
  id: string;
  merchantId: string;
  claimType: string;
  sentiment: Sentiment;
  summary: string;
  authorType: string;
  confidence: number;
  reliabilityBand: string;
  publishedAt: string | null;
  capturedAt: string;
  platform: string;
  sourceUrl: string;
  canonicalSourceUrl: string;
  sourceType: string;
  transactionEvidence: number;
  verified: number;
  independent: number;
  duplicateOf: string | null;
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

export class SnapshotManifestError extends Error {}

/**
 * Validates the one-row snapshot_meta manifest against the actual tables.
 * Throws a clear startup error — no legacy fallback.
 */
export function validateSnapshotManifest(db: DatabaseHandle): SnapshotInfo {
  const table = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'snapshot_meta'",
    )
    .get() as { name: string } | undefined;
  if (table === undefined) {
    throw new SnapshotManifestError(
      'snapshot is missing the snapshot_meta manifest table; regenerate the snapshot with scripts/snapshot-db.sh',
    );
  }
  const meta = db.prepare('SELECT * FROM snapshot_meta WHERE id = 1').get() as
    | SnapshotMetaRow
    | undefined;
  if (meta === undefined) {
    throw new SnapshotManifestError('snapshot_meta is empty; regenerate the snapshot');
  }
  if (meta.app_schema_version !== APP_SCHEMA_VERSION) {
    throw new SnapshotManifestError(
      `snapshot_meta.app_schema_version is ${meta.app_schema_version}, expected ${APP_SCHEMA_VERSION}`,
    );
  }
  if (meta.source_schema_version !== SOURCE_SCHEMA_VERSION) {
    throw new SnapshotManifestError(
      `snapshot_meta.source_schema_version is ${meta.source_schema_version}, expected ${SOURCE_SCHEMA_VERSION}`,
    );
  }

  const counts: Record<string, number> = {};
  for (const key of MANIFEST_COUNT_KEYS) {
    const actual = (
      db.prepare(`SELECT COUNT(*) AS n FROM ${MANIFEST_COUNT_TABLES[key]}`).get() as { n: number }
    ).n;
    const declared = (meta as unknown as Record<string, unknown>)[MANIFEST_COUNT_COLUMNS[key]];
    if (typeof declared !== 'number' || declared !== actual) {
      throw new SnapshotManifestError(
        `snapshot_meta.${MANIFEST_COUNT_COLUMNS[key]} is ${String(declared)} but table ${MANIFEST_COUNT_TABLES[key]} has ${actual} rows; regenerate the snapshot`,
      );
    }
    counts[key] = actual;
  }

  return {
    generatedAt: meta.generated_at,
    sourceSchemaVersion: meta.source_schema_version,
    appSchemaVersion: meta.app_schema_version,
    counts,
  };
}

export function parseAnalysisPayload(payloadJson: string): AnalysisPayload | null {
  let raw: unknown;
  try {
    raw = JSON.parse(payloadJson);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }
  const p = raw as Record<string, unknown>;
  const payloadVersion = p['payload_version'];
  if (payloadVersion !== undefined && payloadVersion !== 1) {
    throw new Error(
      `unsupported analysis payload_version: ${String(payloadVersion)} (supported major version: 1)`,
    );
  }
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
  private readonly snapshotInfo: SnapshotInfo;
  private readonly stmtMerchants: Database.Statement;
  private readonly stmtIndexIdentifiers: Database.Statement;
  private readonly stmtAliases: Database.Statement;
  private readonly stmtMerchantById: Database.Statement<[string]>;
  private readonly stmtDetailIdentifiers: Database.Statement<[string]>;
  private readonly stmtDetailAliases: Database.Statement<[string]>;
  private readonly stmtEvidence: Database.Statement<[string]>;
  private readonly stmtEvidenceRoots: Database.Statement<unknown[]>;
  private readonly stmtClaims: Database.Statement<[string]>;
  private readonly stmtClaimEvidence: Database.Statement<[string]>;
  private readonly stmtLatestAnalysis: Database.Statement<[string]>;
  private readonly stmtRelatedOutgoing: Database.Statement<[string]>;
  private readonly stmtRelatedIncoming: Database.Statement<[string]>;
  private readonly stmtDirectoryMerchants: Database.Statement;
  private readonly stmtDirectoryLinks: Database.Statement;
  private readonly stmtDirectoryEvidence: Database.Statement;
  private directoryProjection: MerchantDirectoryProjection | null = null;

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { readonly: true, fileMustExist: true });
    // Validate the manifest before preparing any queries — no legacy fallback.
    this.snapshotInfo = validateSnapshotManifest(this.db);

    const kindPlaceholders = SEARCHABLE_KINDS.map(() => '?').join(', ');
    this.stmtMerchants = this.db.prepare(
      `SELECT id, canonical_name, category, city, governorate, identity_confidence, state, created_at, updated_at
       FROM merchants ORDER BY id`,
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
      `SELECT id, canonical_name, category, city, governorate, identity_confidence, state, created_at, updated_at
       FROM merchants WHERE id = ?`,
    );
    this.stmtDetailIdentifiers = this.db.prepare(
      `SELECT id, kind, value, normalized_value, confidence FROM merchant_identifiers
       WHERE merchant_id = ? ORDER BY kind, normalized_value`,
    );
    this.stmtDetailAliases = this.db.prepare(
      'SELECT alias FROM merchant_aliases WHERE merchant_id = ? ORDER BY alias',
    );
    this.stmtEvidence = this.db.prepare(
      `SELECT e.id, e.claim_type, e.sentiment, e.summary, e.quoted_excerpt, e.author_type,
              e.confidence, e.reliability_band, e.language, e.published_at, e.captured_at,
              s.platform, s.url, s.source_type, e.transaction_evidence, e.verified,
              e.independent, e.duplicate_of, e.claim_id
       FROM evidence e JOIN sources s ON s.id = e.source_id
       WHERE e.merchant_id = ?
       ORDER BY e.published_at DESC NULLS LAST, e.captured_at DESC`,
    );
    // Root lookup for duplicate attribution (duplicate_of is root-canonical in v3).
    this.stmtEvidenceRoots = this.db.prepare(
      'SELECT id, merchant_id FROM evidence WHERE id = ?',
    );
    this.stmtClaims = this.db.prepare(
      `SELECT id, claim_type, sentiment, summary, independent_source_count, mention_count
       FROM claims WHERE merchant_id = ?
       ORDER BY independent_source_count DESC, mention_count DESC, id`,
    );
    this.stmtClaimEvidence = this.db.prepare(
      `SELECT ce.claim_id, ce.evidence_id FROM claim_evidence ce
       JOIN claims c ON c.id = ce.claim_id
       WHERE c.merchant_id = ? ORDER BY ce.claim_id, ce.evidence_id`,
    );
    this.stmtLatestAnalysis = this.db.prepare(
      `SELECT payload_json FROM merchant_analyses WHERE merchant_id = ?
       ORDER BY round_no DESC, id DESC LIMIT 1`,
    );
    this.stmtRelatedOutgoing = this.db.prepare(
      `SELECT ml.relation, ml.confidence, ml.rationale, m.id, m.canonical_name
       FROM merchant_links ml JOIN merchants m ON m.id = ml.right_merchant_id
       WHERE ml.left_merchant_id = ?`,
    );
    this.stmtRelatedIncoming = this.db.prepare(
      `SELECT ml.relation, ml.confidence, ml.rationale, m.id, m.canonical_name
       FROM merchant_links ml JOIN merchants m ON m.id = ml.left_merchant_id
       WHERE ml.right_merchant_id = ?`,
    );
    this.stmtDirectoryMerchants = this.db.prepare(
      `SELECT m.id AS merchantId, m.canonical_name AS canonicalName,
              m.category, m.city, m.governorate, m.state, m.updated_at AS updatedAt,
              mi.id AS identifierId, mi.kind AS identifierKind,
              mi.value AS identifierValue, mi.normalized_value AS identifierNormalizedValue
       FROM merchants m
       LEFT JOIN merchant_identifiers mi ON mi.merchant_id = m.id
       ORDER BY m.id, mi.kind, mi.normalized_value, mi.id`,
    );
    this.stmtDirectoryLinks = this.db.prepare(
      `SELECT left_merchant_id AS leftMerchantId,
              right_merchant_id AS rightMerchantId, relation
       FROM merchant_links
       ORDER BY left_merchant_id, right_merchant_id, relation`,
    );
    this.stmtDirectoryEvidence = this.db.prepare(
      `SELECT e.id, e.merchant_id AS merchantId, e.claim_type AS claimType,
              e.sentiment, e.summary, e.author_type AS authorType, e.confidence,
              e.reliability_band AS reliabilityBand, e.published_at AS publishedAt,
              e.captured_at AS capturedAt, s.platform, s.url AS sourceUrl,
              s.canonical_url AS canonicalSourceUrl, s.source_type AS sourceType,
              e.transaction_evidence AS transactionEvidence, e.verified,
              e.independent, e.duplicate_of AS duplicateOf
       FROM evidence e
       JOIN sources s ON s.id = e.source_id
       ORDER BY e.merchant_id, e.id`,
    );
  }

  getSnapshotInfo(): SnapshotInfo {
    return this.snapshotInfo;
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
      createdAt: row.created_at,
      updatedAt: row.updated_at,
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

  private getDirectoryProjection(): MerchantDirectoryProjection {
    if (this.directoryProjection !== null) return this.directoryProjection;
    const merchantRows = this.stmtDirectoryMerchants.all() as DirectoryMerchantIdentifierRow[];
    const linkRows = this.stmtDirectoryLinks.all() as DirectoryLinkRow[];
    const evidenceRows = (this.stmtDirectoryEvidence.all() as DirectoryEvidenceDbRow[]).map(
      (row): DirectoryEvidenceRow => ({
        ...row,
        transactionEvidence: row.transactionEvidence !== 0,
        verified: row.verified !== 0,
        independent: row.independent !== 0,
      }),
    );
    this.directoryProjection = buildMerchantDirectoryProjection(
      merchantRows,
      linkRows,
      evidenceRows,
      this.snapshotInfo,
    );
    return this.directoryProjection;
  }

  /** Safe, immutable canonical-seller summaries in canonical-name order. */
  getMerchantDirectoryEntries(): readonly MerchantDirectoryEntry[] {
    return this.getDirectoryProjection().entries;
  }

  /** Shared paginated selector for server pages and the public list API. */
  getMerchantDirectory(input: MerchantDirectoryQueryInput = {}): MerchantDirectoryResult {
    return selectMerchantDirectory(this.getDirectoryProjection(), input);
  }

  /**
   * Dedupes reciprocal link pairs by target merchant id, keeping the entry
   * with the higher confidence (ties prefer outgoing links).
   */
  private dedupeRelated(
    outgoing: RelatedRow[],
    incoming: RelatedRow[],
  ): RelatedRow[] {
    const byTarget = new Map<string, { row: RelatedRow; direction: 0 | 1 }>();
    const consider = (row: RelatedRow, direction: 0 | 1) => {
      const existing = byTarget.get(row.id);
      if (existing === undefined) {
        byTarget.set(row.id, { row, direction });
        return;
      }
      if (row.confidence > existing.row.confidence) {
        byTarget.set(row.id, { row, direction });
      } else if (row.confidence === existing.row.confidence && direction < existing.direction) {
        byTarget.set(row.id, { row, direction });
      }
    };
    for (const row of outgoing) consider(row, 0);
    for (const row of incoming) consider(row, 1);
    return [...byTarget.values()].map(({ row }) => row);
  }

  getMerchantDetail(id: string): MerchantDetail | null {
    const merchantRow = this.stmtMerchantById.get(id) as MerchantRow | undefined;
    if (merchantRow === undefined) {
      return null;
    }

    const identifierRows = this.stmtDetailIdentifiers.all(id) as DetailIdentifierRow[];
    const identifiers: Identifier[] = identifierRows.map((row) => ({
      id: row.id,
      kind: row.kind,
      value: row.value,
      normalizedValue: row.normalized_value,
      confidence: row.confidence,
      role: identifyIdentifierRole(row.kind, row.normalized_value),
      searchable: isSearchableIdentifier(row.kind, row.normalized_value),
      displayable: isDisplayableIdentifier(row.kind, row.normalized_value),
    }));

    const aliases = (this.stmtDetailAliases.all(id) as { alias: string }[]).map((row) => row.alias);

    const evidenceRows = this.stmtEvidence.all(id) as EvidenceRow[];
    const duplicateRootMerchant = new Map<string, string>();
    for (const row of evidenceRows) {
      if (row.duplicate_of !== null && !duplicateRootMerchant.has(row.duplicate_of)) {
        const root = this.stmtEvidenceRoots.get(row.duplicate_of) as
          | DuplicateRootRow
          | undefined;
        if (root !== undefined && root.merchant_id !== id) {
          duplicateRootMerchant.set(row.duplicate_of, root.merchant_id);
        }
      }
    }
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
      capturedAt: row.captured_at,
      platform: row.platform,
      url: row.url,
      sourceType: row.source_type,
      sourceCategory: deriveSourceCategory({
        url: row.url,
        sourceType: row.source_type,
        authorType: row.author_type,
        sourcePlatform: row.platform,
      }),
      transactionEvidence: row.transaction_evidence !== 0,
      verified: row.verified !== 0,
      independent: row.independent !== 0,
      duplicateOf: row.duplicate_of,
      duplicateRootMerchantId: row.duplicate_of === null
        ? null
        : (duplicateRootMerchant.get(row.duplicate_of) ?? null),
      claimId: row.claim_id,
    }));

    const claimRows = this.stmtClaims.all(id) as ClaimRow[];
    const claimEvidenceRows = this.stmtClaimEvidence.all(id) as ClaimEvidenceRow[];
    const evidenceIdsByClaim = new Map<string, string[]>();
    for (const row of claimEvidenceRows) {
      const list = evidenceIdsByClaim.get(row.claim_id);
      if (list === undefined) {
        evidenceIdsByClaim.set(row.claim_id, [row.evidence_id]);
      } else {
        list.push(row.evidence_id);
      }
    }
    const claims: ClaimItem[] = claimRows.map((row) => ({
      id: row.id,
      claimType: row.claim_type,
      sentiment: row.sentiment,
      summary: row.summary,
      independentSourceCount: row.independent_source_count,
      mentionCount: row.mention_count,
      evidenceIds: evidenceIdsByClaim.get(row.id) ?? [],
    }));

    const analysisRow = this.stmtLatestAnalysis.get(id) as AnalysisRow | undefined;
    const analysis = analysisRow === undefined ? null : parseAnalysisPayload(analysisRow.payload_json);

    // Sentiment counts are computed over non-duplicate evidence only, with an
    // explicit duplicate count — never a silently mixed basis.
    const nonDuplicate = evidence.filter((item) => item.duplicateOf === null);
    const sentiment: SentimentCounts = { positive: 0, negative: 0, neutral: 0 };
    for (const item of nonDuplicate) {
      if (item.sentiment === 'positive') {
        sentiment.positive += 1;
      } else if (item.sentiment === 'negative') {
        sentiment.negative += 1;
      } else {
        sentiment.neutral += 1;
      }
    }

    const related = this.dedupeRelated(
      this.stmtRelatedOutgoing.all(id) as RelatedRow[],
      this.stmtRelatedIncoming.all(id) as RelatedRow[],
    ).map((row) => ({
      id: row.id,
      name: row.canonical_name,
      relation: row.relation,
      rationale: row.rationale,
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
        createdAt: merchantRow.created_at,
        updatedAt: merchantRow.updated_at,
      },
      identifiers,
      aliases,
      evidence,
      claims,
      analysis,
      sentiment,
      snapshot: this.snapshotInfo,
      duplicateEvidenceCount: evidence.length - nonDuplicate.length,
      related,
    };
  }
}
