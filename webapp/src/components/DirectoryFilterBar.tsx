import type { JSX } from 'react';

import type { MerchantDirectoryAvailableFilters } from '@/lib/types';
import { COVERAGE_LEVEL_LABELS } from '@/lib/labels';

/**
 * Server-rendered GET filter form shared by the two directories.
 *
 * The selects use the raw stored filter values (category/governorate text,
 * coverage level keys) as both option values and URL values — the selector
 * layer normalizes them. Submitting drops `page`, so any filter change
 * restarts at page 1; the unfiltered option submits an empty value, which the
 * page's input builder drops. All controls are ≥44px tall.
 */
export function DirectoryFilterBar({
  availableFilters,
  action,
  activeFilters,
}: {
  availableFilters: MerchantDirectoryAvailableFilters;
  /** Form action path, e.g. /merchants or /merchants/positive-evidence. */
  action: string;
  /** Current normalized filters marking the selected options. */
  activeFilters: { category?: string; governorate?: string; coverage?: string };
}): JSX.Element {
  return (
    <form action={action} method="get" aria-label="تصفية القائمة" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="directory-category" className="text-sm font-bold">
          التصنيف
        </label>
        <select
          id="directory-category"
          name="category"
          defaultValue={activeFilters.category ?? ''}
          className="min-h-[44px] border border-black px-3 py-2 text-sm"
        >
          <option value="">كل التصنيفات</option>
          {availableFilters.categories.map((category) => (
            <option key={category} value={category} dir="auto">
              {category}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="directory-governorate" className="text-sm font-bold">
          المحافظة
        </label>
        <select
          id="directory-governorate"
          name="governorate"
          defaultValue={activeFilters.governorate ?? ''}
          className="min-h-[44px] border border-black px-3 py-2 text-sm"
        >
          <option value="">كل المحافظات</option>
          {availableFilters.governorates.map((governorate) => (
            <option key={governorate} value={governorate} dir="auto">
              {governorate}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="directory-coverage" className="text-sm font-bold">
          تغطية الأدلة
        </label>
        <select
          id="directory-coverage"
          name="coverage"
          defaultValue={activeFilters.coverage ?? ''}
          className="min-h-[44px] border border-black px-3 py-2 text-sm"
        >
          <option value="">كل المستويات</option>
          {availableFilters.coverage.map((level) => (
            <option key={level} value={level}>
              {COVERAGE_LEVEL_LABELS[level]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          className="min-h-[44px] min-w-[44px] border border-black px-6 py-2 text-base font-bold"
        >
          تطبيق التصفية
        </button>
        <a href={action} className="inline-block min-h-[44px] px-2 py-2 underline underline-offset-2">
          إلغاء التصفية
        </a>
      </div>
    </form>
  );
}
