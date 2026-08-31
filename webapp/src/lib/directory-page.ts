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
 * selector rejects empty values as invalid syntax. Empty strings are dropped
 * here so the page's own form always round-trips; anything else is forwarded
 * unchanged and invalid syntax still surfaces as a selector error.
 */
export function directoryPageInput(
  params: DirectorySearchParams,
  view: 'all' | 'positive-evidence',
): MerchantDirectoryQueryInput {
  const scalar = (value: string | string[] | undefined): string | undefined => {
    const first = Array.isArray(value) ? value[0] : value;
    return typeof first === 'string' && first.length > 0 ? first : undefined;
  };
  const category = scalar(params.category);
  const governorate = scalar(params.governorate);
  const coverage = scalar(params.coverage);
  const page = scalar(params.page);
  return {
    view,
    ...(page !== undefined ? { page } : {}),
    ...(category !== undefined ? { category } : {}),
    ...(governorate !== undefined ? { governorate } : {}),
    ...(coverage !== undefined ? { coverage } : {}),
  };
}
