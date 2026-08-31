import {
  DirectoryQueryValidationError,
  directoryQueryCacheKey,
} from '../../../src/lib/directory';
import { renderCacheGet, renderCacheSet } from '../../../src/lib/render-cache';
import { getDb } from '../../../src/lib/singletons';
import type {
  MerchantDirectoryEntry,
  MerchantDirectoryQueryInput,
  MerchantDirectoryResult,
} from '../../../src/lib/types';

export const dynamic = 'force-dynamic';

const QUERY_FIELDS = ['view', 'page', 'category', 'governorate', 'coverage'] as const;

function readDirectoryInput(searchParams: URLSearchParams): MerchantDirectoryQueryInput {
  const input: MerchantDirectoryQueryInput = {};

  for (const field of QUERY_FIELDS) {
    const values = searchParams.getAll(field);
    if (values.length === 1) input[field] = values[0];
    else if (values.length > 1) input[field] = values;
  }

  return input;
}

function publicEntry(entry: MerchantDirectoryEntry): MerchantDirectoryEntry {
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
          summary: entry.positiveHighlight.summary,
          sourceUrl: entry.positiveHighlight.sourceUrl,
          sourceCategory: entry.positiveHighlight.sourceCategory,
          publishedAt: entry.positiveHighlight.publishedAt,
        },
    updatedAt: entry.updatedAt,
  };
}

function publicResult(result: MerchantDirectoryResult): MerchantDirectoryResult {
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

export async function GET(request: Request): Promise<Response> {
  try {
    const input = readDirectoryInput(new URL(request.url).searchParams);
    const key = `api-merchants:${directoryQueryCacheKey(input)}`;
    const cached = renderCacheGet(key);
    if (cached !== undefined) {
      return new Response(cached.body, { headers: { 'content-type': cached.contentType } });
    }

    const result = publicResult(getDb().getMerchantDirectory(input));
    const body = JSON.stringify(result);
    renderCacheSet(key, body, 'application/json');
    return new Response(body, { headers: { 'content-type': 'application/json' } });
  } catch (error) {
    if (error instanceof DirectoryQueryValidationError) {
      return Response.json({ error: 'invalid_query' }, { status: 400 });
    }
    throw error;
  }
}
