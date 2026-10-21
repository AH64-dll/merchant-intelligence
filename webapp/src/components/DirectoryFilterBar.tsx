import type { JSX } from 'react';

import type { MerchantDirectoryAvailableFilters } from '@/lib/types';
import { coverageLevelLabel } from '@/lib/labels';
import { t, type Locale } from '@/lib/i18n';

/**
 * Server-rendered GET filter form shared by the two directories.
 *
 * The selects use the raw stored filter values (category/governorate text,
 * coverage level keys) as both option values and URL values — the selector
 * layer normalizes them. Submitting drops `page`, so any filter change
 * restarts at page 1; the unfiltered option submits an empty value, which the
 * page's input builder drops. All controls are touch-friendly.
 */
export function DirectoryFilterBar({
  availableFilters,
  action,
  activeFilters,
  locale = 'ar',
}: {
  availableFilters: MerchantDirectoryAvailableFilters;
  /** Form action path, e.g. /merchants or /merchants/positive-evidence. */
  action: string;
  /** Current normalized filters marking the selected options. */
  activeFilters: { category?: string; governorate?: string; coverage?: string };
  locale?: Locale;
}): JSX.Element {
  const strings = t(locale);

  return (
    <form
      action={action}
      method="get"
      aria-label={strings.filterListAria}
      className="flex flex-wrap items-center gap-3 rounded-[5px] border border-[var(--border)] bg-[var(--paper)] p-3 text-xs shadow-[0_1px_3px_rgba(42,52,65,0.03)]"
    >
      <div className="filter-field flex min-w-0 flex-1 items-center gap-2">
        <label htmlFor="directory-category" className="shrink-0 font-medium text-[#525a62]">
          {strings.categoryFilter}:
        </label>
        <select
          id="directory-category"
          name="category"
          defaultValue={activeFilters.category ?? ''}
          aria-label={strings.categoryFilter}
          className="filter-bar-select min-h-[44px] w-full min-w-0 text-xs pe-7 ps-2.5"
        >
          <option value="">{strings.allCategories}</option>
          {availableFilters.categories.map((category) => (
            <option key={category} value={category} dir="auto">
              {category}
            </option>
          ))}
        </select>
      </div>
      <div className="filter-field flex min-w-0 flex-1 items-center gap-2">
        <label htmlFor="directory-governorate" className="shrink-0 font-medium text-[#525a62]">
          {strings.governorateFilter}:
        </label>
        <select
          id="directory-governorate"
          name="governorate"
          defaultValue={activeFilters.governorate ?? ''}
          aria-label={strings.governorateFilter}
          className="filter-bar-select min-h-[44px] w-full min-w-0 text-xs pe-7 ps-2.5"
        >
          <option value="">{strings.allGovernorates}</option>
          {availableFilters.governorates.map((governorate) => (
            <option key={governorate} value={governorate} dir="auto">
              {governorate}
            </option>
          ))}
        </select>
      </div>
      <div className="filter-field flex min-w-0 flex-1 items-center gap-2">
        <label htmlFor="directory-coverage" className="shrink-0 font-medium text-[#525a62]">
          {strings.coverageFilter}:
        </label>
        <select
          id="directory-coverage"
          name="coverage"
          defaultValue={activeFilters.coverage ?? ''}
          aria-label={strings.coverageFilter}
          className="filter-bar-select min-h-[44px] w-full min-w-0 text-xs pe-7 ps-2.5"
        >
          <option value="">{strings.allCoverageLevels}</option>
          {availableFilters.coverage.map((level) => (
            <option key={level} value={level}>
              {coverageLevelLabel(level, locale)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2 ms-auto">
        <button
          type="submit"
          className="filter-bar-submit inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[4px] bg-[var(--ink)] px-4 py-1.5 text-xs font-medium !text-white transition hover:bg-[#1d2530] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--teal)]"
        >
          {strings.applyFilter}
        </button>
        <a
          href={action}
          className="secondary-button inline-flex min-h-[44px] items-center justify-center px-3 py-1.5 text-xs"
        >
          {strings.resetFilter}
        </a>
      </div>
    </form>
  );
}
