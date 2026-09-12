import type { MerchantDirectoryQueryInput } from './types';

/**
 * Raw Next.js page search params for the directory routes: every value may be
 * missing, a single string, or a repeated string.
 */
export type DirectorySearchParams = Record<string, string | string[] | undefined>;

/**
 * Builds the selector input for one directory view from raw page params.
 *
 * The GET filter form submits an empty string for an unfiltered select
 * (`category=`, `governorate=`, `coverage=`), which is a form artifact — the
 * selector rejects empty values as invalid syntax. Empty single values are
 * dropped here so the page's own form always round-trips. Repeated params
 * (`?page=1&page=2`) are forwarded as-is so the selector rejects them, matching
 * the list API's `invalid_query`; anything else is forwarded unchanged.
 */
export function directoryPageInput(
  params: DirectorySearchParams,
  view: 'all' | 'positive-evidence',
): MerchantDirectoryQueryInput {
  const forward = (value: string | string[] | undefined): string | string[] | undefined => {
    if (value === undefined) return undefined;
    if (Array.isArray(value)) return value;
    return value.length > 0 ? value : undefined;
  };
  const category = forward(params.category);
  const governorate = forward(params.governorate);
  const coverage = forward(params.coverage);
  const page = forward(params.page);
  return {
    view,
    ...(page !== undefined ? { page } : {}),
    ...(category !== undefined ? { category } : {}),
    ...(governorate !== undefined ? { governorate } : {}),
    ...(coverage !== undefined ? { coverage } : {}),
  };
}
