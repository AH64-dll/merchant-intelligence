import { safeHttpUrl } from '@/components/display';
import {
  assessEvidenceCoverage,
  assessIdentity,
  isRiskEvidence,
  isWarningEvidence,
} from './assessment';
import {
  identifyIdentifierRole,
  isDisplayableIdentifier,
  isSearchableIdentifier,
} from './identifier-policy';
import { deriveSourceCategory } from './taxonomy';
import type {
  EvidenceItem,
  Identifier,
  IdentifierKind,
  MerchantDirectoryAvailableFilters,
  MerchantDirectoryCoverageLevel,
  MerchantDirectoryEntry,
  MerchantDirectoryQuery,
  MerchantDirectoryQueryInput,
  MerchantDirectoryResult,
  MerchantState,
  Sentiment,
  SnapshotInfo,
} from './types';
import { MERCHANT_DIRECTORY_PAGE_SIZE } from './types';

const COVERAGE_LEVELS: readonly MerchantDirectoryCoverageLevel[] = [
  'none',
  'limited',
  'moderate',
  'broad',
];
const VERIFIED_DIRECTORY_STATES: ReadonlySet<MerchantState> = new Set([
  'VERIFIED_HIGH_CONFIDENCE',
  'VERIFIED_MODERATE_CONFIDENCE',
]);
const STRONG_RELIABILITY_BANDS: ReadonlySet<string> = new Set(['strong', 'very_strong']);

/** One row of the merchants + display-identifier directory read. */
export interface DirectoryMerchantIdentifierRow {
  merchantId: string;
  canonicalName: string;
  category: string;
  city: string;
  governorate: string;
  state: MerchantState;
  updatedAt: string;
  identifierId: number | null;
  identifierKind: IdentifierKind | null;
  identifierValue: string | null;
  identifierNormalizedValue: string | null;
}

/** One row of the merchant-link relation directory read. */
export interface DirectoryLinkRow {
  leftMerchantId: string;
  rightMerchantId: string;
  relation: string;
}

/** Compact evidence/source row; long excerpts and raw provenance are intentionally absent. */
export interface DirectoryEvidenceRow {
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
  transactionEvidence: boolean;
  verified: boolean;
  independent: boolean;
  duplicateOf: string | null;
}

interface MerchantSeed {
  id: string;
  canonicalName: string;
  category: string;
  city: string;
  governorate: string;
  state: MerchantState;
  updatedAt: string;
  identifiers: Identifier[];
}

interface PositiveRank {
  customerPositiveSources: number;
  verifiedPositiveSources: number;
  strongPositiveSources: number;
  positiveSources: number;
  nonDuplicateSources: number;
  newestPositiveAt: number;
}

interface ProjectionMetadata {
  governorate: string;
  eligible: boolean;
  rank: PositiveRank;
}

export class DirectoryQueryValidationError extends Error {
  readonly field: keyof MerchantDirectoryQueryInput;

  constructor(field: keyof MerchantDirectoryQueryInput, message: string) {
    super(message);
    this.name = 'DirectoryQueryValidationError';
    this.field = field;
  }
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareNameAndId(left: MerchantDirectoryEntry, right: MerchantDirectoryEntry): number {
  return compareText(left.canonicalName, right.canonicalName) || compareText(left.id, right.id);
}

function normalizedStoredLabel(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/gu, ' ');
}

function normalizedFilter(
  field: 'category' | 'governorate',
  value: unknown,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new DirectoryQueryValidationError(field, `${field} must be a single string`);
  }
  if (/[\u0000-\u001f\u007f]/u.test(value)) {
    throw new DirectoryQueryValidationError(field, `${field} has invalid syntax`);
  }
  const normalized = normalizedStoredLabel(value);
  if (normalized.length === 0 || normalized.length > 160) {
    throw new DirectoryQueryValidationError(field, `${field} has invalid syntax`);
  }
  return normalized;
}

/** Parse raw URL-search values into the single canonical directory query shape. */
export function normalizeDirectoryQuery(input: MerchantDirectoryQueryInput = {}): MerchantDirectoryQuery {
  let view: MerchantDirectoryQuery['view'] = 'all';
  if (input.view !== undefined) {
    if (input.view !== 'all' && input.view !== 'positive-evidence') {
      throw new DirectoryQueryValidationError('view', 'view must be all or positive-evidence');
    }
    view = input.view;
  }

  let page = 1;
  if (input.page !== undefined) {
    if (typeof input.page === 'number') {
      if (!Number.isSafeInteger(input.page) || input.page < 1) {
        throw new DirectoryQueryValidationError('page', 'page must be a positive safe integer');
      }
      page = input.page;
    } else if (typeof input.page === 'string' && /^[1-9]\d*$/u.test(input.page)) {
      const parsed = Number(input.page);
      if (!Number.isSafeInteger(parsed)) {
        throw new DirectoryQueryValidationError('page', 'page must be a positive safe integer');
      }
      page = parsed;
    } else {
      throw new DirectoryQueryValidationError('page', 'page must use normalized positive-integer syntax');
    }
  }

  let coverage: MerchantDirectoryCoverageLevel | undefined;
  if (input.coverage !== undefined) {
    if (typeof input.coverage !== 'string' || !COVERAGE_LEVELS.includes(input.coverage as MerchantDirectoryCoverageLevel)) {
      throw new DirectoryQueryValidationError('coverage', 'coverage is not a supported level');
    }
    coverage = input.coverage as MerchantDirectoryCoverageLevel;
  }

  const category = normalizedFilter('category', input.category);
  const governorate = normalizedFilter('governorate', input.governorate);
  return Object.freeze({
    view,
    page,
    ...(category === undefined ? {} : { category }),
    ...(governorate === undefined ? {} : { governorate }),
    ...(coverage === undefined ? {} : { coverage }),
  });
}

/** Stable bounded-cache key; equivalent raw queries collapse after normalization. */
export function directoryQueryCacheKey(input: MerchantDirectoryQueryInput = {}): string {
  const query = normalizeDirectoryQuery(input);
  return JSON.stringify([
    query.view,
    query.page,
    query.category ?? null,
    query.governorate ?? null,
    query.coverage ?? null,
  ]);
}

function toEvidenceItem(row: DirectoryEvidenceRow): EvidenceItem {
  return {
    id: row.id,
    claimType: row.claimType,
    sentiment: row.sentiment,
    summary: row.summary,
    quotedExcerpt: '',
    authorType: row.authorType,
    confidence: row.confidence,
    reliabilityBand: row.reliabilityBand,
    language: '',
    publishedAt: row.publishedAt,
    capturedAt: row.capturedAt,
    platform: row.platform,
    url: row.canonicalSourceUrl.length > 0 ? row.canonicalSourceUrl : row.sourceUrl,
    sourceType: row.sourceType,
    sourceCategory: deriveSourceCategory({
      url: row.sourceUrl,
      sourceType: row.sourceType,
      authorType: row.authorType,
      sourcePlatform: row.platform,
    }),
    transactionEvidence: row.transactionEvidence,
    verified: row.verified,
    independent: row.independent,
    duplicateOf: row.duplicateOf,
    duplicateRootMerchantId: null,
    claimId: null,
    citations: [],
    isMeaningful: row.duplicateOf === null && row.summary.trim().length > 0,
    isDuplicateChild: row.duplicateOf !== null,
  };
}

function sourceKey(row: DirectoryEvidenceRow): string | null {
  const publicUrl = safeHttpUrl(row.sourceUrl);
  if (publicUrl === null) return null;
  const candidate = row.canonicalSourceUrl.length > 0 ? row.canonicalSourceUrl : publicUrl;
  const safe = safeHttpUrl(candidate);
  if (safe === null) return null;
  const parsed = new URL(safe);
  parsed.hash = '';
  return parsed.toString();
}

function evidenceDateValue(row: DirectoryEvidenceRow): number {
  const raw = row.publishedAt ?? row.capturedAt;
  const value = Date.parse(raw);
  return Number.isFinite(value) ? value : 0;
}

function compareHighlight(left: DirectoryEvidenceRow, right: DirectoryEvidenceRow): number {
  const factors: readonly [number, number][] = [
    [left.authorType === 'customer' ? 1 : 0, right.authorType === 'customer' ? 1 : 0],
    [left.verified ? 1 : 0, right.verified ? 1 : 0],
    [STRONG_RELIABILITY_BANDS.has(left.reliabilityBand) ? 1 : 0, STRONG_RELIABILITY_BANDS.has(right.reliabilityBand) ? 1 : 0],
    [left.transactionEvidence ? 1 : 0, right.transactionEvidence ? 1 : 0],
    [left.confidence, right.confidence],
    [evidenceDateValue(left), evidenceDateValue(right)],
  ];
  for (const [leftValue, rightValue] of factors) {
    if (leftValue !== rightValue) return rightValue - leftValue;
  }
  return compareText(left.id, right.id);
}

function makeLocationLabel(seed: MerchantSeed, addresses: readonly Identifier[]): string {
  const primaryParts: string[] = [];
  if (seed.city.trim().length > 0) primaryParts.push(seed.city.trim());
  const governorate = seed.governorate.trim();
  if (governorate.length > 0 && !primaryParts.includes(governorate)) primaryParts.push(governorate);
  if (primaryParts.length > 0) return primaryParts.join('، ');
  const firstAddress = addresses[0]?.value.trim();
  return firstAddress && firstAddress.length > 0 ? firstAddress : 'الموقع غير محدد';
}

function positiveRank(rows: readonly DirectoryEvidenceRow[]): PositiveRank {
  const independent = rows.filter((row) => row.independent && row.duplicateOf === null);
  const positive = independent.filter((row) => row.sentiment === 'positive' && sourceKey(row) !== null);
  const sources = (predicate: (row: DirectoryEvidenceRow) => boolean): number =>
    new Set(positive.filter(predicate).map((row) => sourceKey(row) as string)).size;
  const nonDuplicateSources = new Set(
    rows
      .filter((row) => row.duplicateOf === null)
      .map(sourceKey)
      .filter((key): key is string => key !== null),
  ).size;
  return {
    customerPositiveSources: sources((row) => row.authorType === 'customer'),
    verifiedPositiveSources: sources((row) => row.verified),
    strongPositiveSources: sources((row) => STRONG_RELIABILITY_BANDS.has(row.reliabilityBand)),
    positiveSources: sources(() => true),
    nonDuplicateSources,
    newestPositiveAt: positive.reduce((latest, row) => Math.max(latest, evidenceDateValue(row)), 0),
  };
}

function isPositiveEligible(
  state: MerchantState,
  identityLevel: MerchantDirectoryEntry['identityLevel'],
  rows: readonly DirectoryEvidenceRow[],
  rank: PositiveRank,
): boolean {
  if (!VERIFIED_DIRECTORY_STATES.has(state) || identityLevel === 'uncertain') return false;
  if (rank.positiveSources < 2) return false;
  const independent = rows.filter((row) => row.independent && row.duplicateOf === null);
  if (independent.some((row) => row.authorType !== 'merchant' && row.sentiment === 'negative')) return false;
  return !independent.map(toEvidenceItem).some((item) => isWarningEvidence(item) || isRiskEvidence(item));
}

function freezeEntry(entry: MerchantDirectoryEntry): MerchantDirectoryEntry {
  Object.freeze(entry.categoryTags);
  Object.freeze(entry.evidence);
  if (entry.positiveHighlight !== null) Object.freeze(entry.positiveHighlight);
  return Object.freeze(entry);
}

function comparePositive(
  left: MerchantDirectoryEntry,
  right: MerchantDirectoryEntry,
  metadata: ReadonlyMap<string, ProjectionMetadata>,
): number {
  const leftRank = metadata.get(left.id)?.rank;
  const rightRank = metadata.get(right.id)?.rank;
  if (leftRank === undefined || rightRank === undefined) return compareNameAndId(left, right);
  const factors: readonly [number, number][] = [
    [leftRank.customerPositiveSources, rightRank.customerPositiveSources],
    [leftRank.verifiedPositiveSources, rightRank.verifiedPositiveSources],
    [leftRank.strongPositiveSources, rightRank.strongPositiveSources],
    [leftRank.positiveSources, rightRank.positiveSources],
    [leftRank.nonDuplicateSources, rightRank.nonDuplicateSources],
    [leftRank.newestPositiveAt, rightRank.newestPositiveAt],
  ];
  for (const [leftValue, rightValue] of factors) {
    if (leftValue !== rightValue) return rightValue - leftValue;
  }
  return compareNameAndId(left, right);
}

function sortedDistinct(values: Iterable<string>): readonly string[] {
  return Object.freeze([...new Set([...values].filter((value) => value.length > 0))].sort(compareText));
}

/** Immutable, process-local result of the three directory reads. */
export class MerchantDirectoryProjection {
  readonly entries: readonly MerchantDirectoryEntry[];
  readonly snapshot: SnapshotInfo;
  private readonly metadata: ReadonlyMap<string, ProjectionMetadata>;
  private readonly positiveEntries: readonly MerchantDirectoryEntry[];

  constructor(
    entries: readonly MerchantDirectoryEntry[],
    metadata: ReadonlyMap<string, ProjectionMetadata>,
    snapshot: SnapshotInfo,
  ) {
    this.entries = Object.freeze([...entries].sort(compareNameAndId));
    this.metadata = new Map(
      [...metadata].map(([id, value]) => [
        id,
        Object.freeze({ ...value, rank: Object.freeze({ ...value.rank }) }),
      ]),
    );
    this.positiveEntries = Object.freeze(
      this.entries
        .filter((entry) => this.metadata.get(entry.id)?.eligible === true)
        .sort((left, right) => comparePositive(left, right, this.metadata)),
    );
    this.snapshot = Object.freeze({
      ...snapshot,
      counts: Object.freeze({ ...snapshot.counts }),
    });
    Object.freeze(this);
  }

  select(input: MerchantDirectoryQueryInput = {}): MerchantDirectoryResult {
    const query = normalizeDirectoryQuery(input);
    const viewEntries = query.view === 'positive-evidence' ? this.positiveEntries : this.entries;
    const availableFilters: MerchantDirectoryAvailableFilters = Object.freeze({
      categories: sortedDistinct(viewEntries.flatMap((entry) => entry.categoryTags)),
      governorates: sortedDistinct(
        viewEntries.map((entry) => this.metadata.get(entry.id)?.governorate ?? ''),
      ),
      coverage: Object.freeze(
        COVERAGE_LEVELS.filter((level) => viewEntries.some((entry) => entry.coverageLevel === level)),
      ),
    });
    const filtered = viewEntries.filter((entry) => {
      if (query.category !== undefined && !entry.categoryTags.includes(query.category)) return false;
      if (query.governorate !== undefined && this.metadata.get(entry.id)?.governorate !== query.governorate) return false;
      if (query.coverage !== undefined && entry.coverageLevel !== query.coverage) return false;
      return true;
    });
    const total = filtered.length;
    const totalPages = Math.ceil(total / MERCHANT_DIRECTORY_PAGE_SIZE);
    const offset = (query.page - 1) * MERCHANT_DIRECTORY_PAGE_SIZE;
    const items = Object.freeze(filtered.slice(offset, offset + MERCHANT_DIRECTORY_PAGE_SIZE));
    return Object.freeze({
      items,
      pagination: Object.freeze({
        page: query.page,
        pageSize: MERCHANT_DIRECTORY_PAGE_SIZE,
        total,
        totalPages,
      }),
      availableFilters,
      snapshot: this.snapshot,
    });
  }
}

/** Build the immutable seller projection from exactly the three bounded DB reads. */
export function buildMerchantDirectoryProjection(
  merchantIdentifierRows: readonly DirectoryMerchantIdentifierRow[],
  linkRows: readonly DirectoryLinkRow[],
  evidenceRows: readonly DirectoryEvidenceRow[],
  snapshot: SnapshotInfo,
): MerchantDirectoryProjection {
  const merchants = new Map<string, MerchantSeed>();
  for (const row of merchantIdentifierRows) {
    let seed = merchants.get(row.merchantId);
    if (seed === undefined) {
      seed = {
        id: row.merchantId,
        canonicalName: row.canonicalName,
        category: row.category,
        city: row.city,
        governorate: row.governorate,
        state: row.state,
        updatedAt: row.updatedAt,
        identifiers: [],
      };
      merchants.set(row.merchantId, seed);
    }
    if (
      row.identifierId !== null &&
      row.identifierKind !== null &&
      row.identifierValue !== null &&
      row.identifierNormalizedValue !== null &&
      isDisplayableIdentifier(row.identifierKind, row.identifierNormalizedValue)
    ) {
      seed.identifiers.push({
        id: row.identifierId,
        kind: row.identifierKind,
        value: row.identifierValue,
        normalizedValue: row.identifierNormalizedValue,
        confidence: 0,
        role: identifyIdentifierRole(row.identifierKind, row.identifierNormalizedValue),
        searchable: isSearchableIdentifier(row.identifierKind, row.identifierNormalizedValue),
        displayable: true,
      });
    }
  }

  const relations = new Map<string, string[]>();
  for (const row of linkRows) {
    const left = relations.get(row.leftMerchantId) ?? [];
    left.push(row.relation);
    relations.set(row.leftMerchantId, left);
    const right = relations.get(row.rightMerchantId) ?? [];
    right.push(row.relation);
    relations.set(row.rightMerchantId, right);
  }

  const evidenceByMerchant = new Map<string, DirectoryEvidenceRow[]>();
  for (const row of evidenceRows) {
    const list = evidenceByMerchant.get(row.merchantId) ?? [];
    list.push(row);
    evidenceByMerchant.set(row.merchantId, list);
  }

  const metadata = new Map<string, ProjectionMetadata>();
  const entries: MerchantDirectoryEntry[] = [];
  for (const seed of merchants.values()) {
    const rows = evidenceByMerchant.get(seed.id) ?? [];
    const evidence = rows.map(toEvidenceItem);
    const coverage = assessEvidenceCoverage(evidence);
    const identity = assessIdentity(seed.state, seed.identifiers, relations.get(seed.id) ?? []);
    const addresses = seed.identifiers.filter(
      (identifier) => identifier.kind === 'address' && identifier.normalizedValue.trim().length > 0,
    );
    const locationCount = new Set(addresses.map((identifier) => identifier.normalizedValue)).size;
    const independentPositive = rows
      .filter(
        (row) =>
          row.independent &&
          row.duplicateOf === null &&
          row.sentiment === 'positive' &&
          safeHttpUrl(row.sourceUrl) !== null,
      )
      .sort(compareHighlight);
    const highlightRow = independentPositive[0];
    const rank = positiveRank(rows);
    const nonDuplicateEvidence = evidence.filter((item) => item.duplicateOf === null);
    const positiveHighlight = highlightRow === undefined
      ? null
      : {
          evidenceId: highlightRow.id,
          summary: highlightRow.summary,
          sourceUrl: safeHttpUrl(highlightRow.sourceUrl) as string,
          sourceCategory: toEvidenceItem(highlightRow).sourceCategory,
          publishedAt: highlightRow.publishedAt,
        };
    const category = normalizedStoredLabel(seed.category);
    const entry = freezeEntry({
      id: seed.id,
      canonicalName: seed.canonicalName,
      categoryTags: category.length > 0 ? [category] : [],
      locationLabel: makeLocationLabel(seed, addresses),
      locationCount,
      identityLevel: identity.level,
      coverageLevel: coverage.level,
      evidence: {
        total: coverage.total,
        nonDuplicate: coverage.nonDuplicate,
        distinctSources: coverage.distinctSources,
        positive: nonDuplicateEvidence.filter((item) => item.sentiment === 'positive').length,
        neutral: nonDuplicateEvidence.filter((item) => item.sentiment === 'neutral').length,
        negative: nonDuplicateEvidence.filter((item) => item.sentiment === 'negative').length,
        customerPositiveSources: rank.customerPositiveSources,
        latestPublishedAt: coverage.latestPublishedAt,
        lastCapturedAt: coverage.lastCapturedAt,
      },
      positiveHighlight,
      updatedAt: seed.updatedAt,
    });
    entries.push(entry);
    metadata.set(seed.id, {
      governorate: normalizedStoredLabel(seed.governorate),
      eligible: isPositiveEligible(seed.state, identity.level, rows, rank),
      rank,
    });
  }
  return new MerchantDirectoryProjection(entries, metadata, snapshot);
}

/** Shared selector for server-rendered pages and GET /api/merchants. */
export function selectMerchantDirectory(
  projection: MerchantDirectoryProjection,
  input: MerchantDirectoryQueryInput = {},
): MerchantDirectoryResult {
  return projection.select(input);
}
