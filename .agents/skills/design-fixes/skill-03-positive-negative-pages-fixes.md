# Skill 03: Positive Sellers Page & Negative Route Audit Fixes

Comprehensive UI/UX, layout, typography, contrast, and bidi audit of the Positive Evidence Directory routes (`/ar/merchants/positive-evidence/`, `/en/merchants/positive-evidence/`), the `PositiveEvidenceCard` component, and verification of the Negative Sellers route absence.

Audited against local source code (`webapp/app/[locale]/merchants/positive-evidence/`, `webapp/src/components/`, `webapp/app/bayyna.css`), local static export artifacts (`webapp/out/`), and live pre-fetched snapshots (`/tmp/mi-audit/live/`).

---

## Architectural Verification: Negative Sellers Page Absence

### Negative Sellers page does not exist — nothing to fix

- **Status**: **PASS (Intentional Architectural & Methodological Invariant)**
- **Surface**:
  - `/ar/merchants/negative-evidence/`
  - `/en/merchants/negative-evidence/`
- **Evidence**:
  1. **HTTP Status**: Live snapshots verify `/tmp/mi-audit/live/en-neg.code` returns `404`. Static export directory `webapp/out/` contains zero routes under `negative-evidence/`.
  2. **Type System Union**: In `webapp/src/lib/types.ts:279`, the directory view union is strictly binary:
     ```ts
     export type MerchantDirectoryView = 'all' | 'positive-evidence';
     ```
  3. **Runtime Parameter Validation**: In `webapp/src/lib/directory.ts:193-195`:
     ```ts
     if (input.view !== 'all' && input.view !== 'positive-evidence') {
       throw new DirectoryQueryValidationError('view', 'view must be all or positive-evidence');
     }
     ```
  4. **Component View Constraint**: In `webapp/src/components/DirectoryBrowser.tsx:44`:
     ```ts
     view: 'all' | 'positive-evidence';
     ```
  5. **UI Toolbar Select Options**: In `webapp/src/components/DirectoryPageShell.tsx:138-140`, the directory view dropdown provides only two options:
     - `all` (`strings.allMerchantsTitle`: "جميع البائعين" / "All Vendors")
     - `positive-evidence` (`strings.positiveEvidenceTitle`: "البائعون ذوو أقوى الأدلة الإيجابية" / "Vendors with Strongest Positive Evidence")
- **Methodological Rationale**:
  The platform's verification protocol (Bayyna / دليل التجار) publishes primary merchant records with transparent, aggregate evidence counts and citations. It intentionally does not provide a separate "negative merchant blacklist" or scalar score directory. Adverse claims and negative customer feedback are presented strictly in context on individual merchant dossiers (`/merchant/[id]`).

---

## Audited Findings & Required Fixes

### 1. Static Export Prerenders Wrong Route Loading Skeleton (Parent Route Fallback Collision)
- **Severity**: **P1 (readable-but-wrong / initial visual flicker)**
- **Surface**:
  - `/ar/merchants/positive-evidence/`
  - `/en/merchants/positive-evidence/`
  - Initial static HTML before client hydration
- **Evidence**:
  - Rendered export HTML: `webapp/out/ar/merchants/positive-evidence/index.html` lines 30–45
  - Page Component: `webapp/app/[locale]/merchants/positive-evidence/page.tsx:34-36`
  - Parent fallback: `webapp/app/[locale]/merchants/loading.tsx:18-23`
  - Route fallback: `webapp/app/[locale]/merchants/positive-evidence/loading.tsx:18-23`
  - Emitted HTML inspects:
    ```html
    <h1>
      <svg class="lucide lucide-building-complex lucide-building-2" ...></svg>
      <span dir="auto">جميع البائعين</span>
      <span aria-hidden="true"> · </span>
      <span dir="auto">All Vendors</span>
    </h1>
    ```
- **Root cause**:
  In `webapp/app/[locale]/merchants/positive-evidence/page.tsx:34`, `DirectoryBrowser` is wrapped in a bare `<Suspense>` boundary with NO `fallback` prop:
  ```tsx
  return (
    <Suspense>
      <DirectoryBrowser view="positive-evidence" ... />
    </Suspense>
  );
  ```
  Because `<Suspense>` has no `fallback`, Next.js static generation bubbles up to the nearest parent route boundary that defines one, which is `webapp/app/[locale]/merchants/loading.tsx` (`MerchantsDirectoryLoading`).
  As a result, the static pre-rendered HTML for `/merchants/positive-evidence/` serves the `Building2` icon and "جميع البائعين · All Vendors" instead of the `Scale` icon and "البائعون ذوو أقوى الأدلة الإيجابية · Vendors with Strongest Positive Evidence". When client JavaScript hydrates, the header abruptly morphs from All Vendors to Positive Evidence.
- **Fix**:
  In `webapp/app/[locale]/merchants/positive-evidence/page.tsx`, import `PositiveEvidenceDirectoryLoading` and supply it as the explicit fallback:
  ```tsx
  import PositiveEvidenceDirectoryLoading from './loading';

  export default async function PositiveEvidenceDirectoryPage({ params }: ...) {
    ...
    return (
      <Suspense fallback={<PositiveEvidenceDirectoryLoading />}>
        <DirectoryBrowser view="positive-evidence" ... />
      </Suspense>
    );
  }
  ```
- **Confidence**: 100% (Directly verified in `webapp/out/ar/merchants/positive-evidence/index.html`).

---

### 2. Numeric Count Collapsed into a 4px Circular Dot (`number-over-dot` defect)
- **Severity**: **P0 (visual-broken)**
- **Surface**:
  - `/ar/merchants/positive-evidence/`
  - `/en/merchants/positive-evidence/`
  - All 23 merchant cards (rendered via `PositiveEvidenceCard` wrapping `MerchantSummaryCard`)
- **Evidence**:
  - Component: `webapp/src/components/MerchantSummaryCard.tsx:93-104`
  - Wrapper: `webapp/src/components/PositiveEvidenceCard.tsx:31`
  - Stylesheet: `webapp/app/bayyna.css:24`
  - Markup in `MerchantSummaryCard.tsx`:
    ```tsx
    <div className="flex flex-wrap items-center gap-2 pt-0.5 text-xs">
      <span className="stance supporting">
        <span />
        {sentimentLabel('positive', locale)}: <span dir="ltr">{evidence.positive}</span>
      </span>
      <span className="stance mixed">
        <span />
        {sentimentLabel('neutral', locale)}: <span dir="ltr">{evidence.neutral}</span>
      </span>
      <span className="stance negative">
        <span />
        {sentimentLabel('negative', locale)}: <span dir="ltr">{evidence.negative}</span>
      </span>
      <span className="text-xs text-[#7a8085]">{strings.fromNonDuplicateEvidence}</span>
    </div>
    ```
  - CSS rule in `webapp/app/bayyna.css:24`:
    ```css
    .stance{display:inline-flex;align-items:center;gap:6px;font-size:11px;padding:3px 8px;border-radius:3px;font-weight:500}
    .stance>span{width:4px;height:4px;background:currentColor;border-radius:50%}
    ```
- **Root cause**:
  The CSS selector `.stance > span` selects **every direct child `<span>`** of `.stance`.
  Inside `MerchantSummaryCard.tsx`:
  - Child 1 is `<span />` (intended to be the 4px circular status dot).
  - Child 2 is a text node (`إيجابي: ` / `Positive: `).
  - Child 3 is `<span dir="ltr">{evidence.positive}</span>` (the numeric tally).
  
  Because `.stance` is `display: inline-flex`, all direct children are flex items. The browser forces `width: 4px; height: 4px; background: currentColor; border-radius: 50%` onto `<span dir="ltr">`. The count number is forced into a 4px by 4px box that has a colored circular background. The text overflows this 4px box, rendering the number directly on top of a circle or clipping it entirely.
- **Fix**:
  Scope the dot selector to `:first-child` (or use a dedicated `.stance-dot` class):
  ```css
  /* In webapp/app/bayyna.css line 24 */
  .stance > span:first-child {
    width: 4px;
    height: 4px;
    background: currentColor;
    border-radius: 50%;
    flex-shrink: 0;
  }
  ```
  And in `webapp/src/components/MerchantSummaryCard.tsx:93-104`, explicitly give the dot a class:
  ```tsx
  <span className="stance supporting">
    <span className="stance-dot" aria-hidden="true" />
    {sentimentLabel('positive', locale)}: <span dir="ltr" className="font-semibold">{evidence.positive}</span>
  </span>
  ```
- **Confidence**: 100% (Reproducible on every card displaying stance tallies).

---

### 3. Positive Evidence Card Highlight Stance Badge Alignment & Architectural Fragility
- **Severity**: **P1 (readable-but-wrong)**
- **Surface**:
  - `/ar/merchants/positive-evidence/`
  - `/en/merchants/positive-evidence/`
  - Highlight header on every `PositiveEvidenceCard`
- **Evidence**:
  - Component: `webapp/src/components/PositiveEvidenceCard.tsx:33-39`
  - Markup:
    ```tsx
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-xs font-semibold text-[#2a3441]">{strings.highlightedPositiveEvidence}</h3>
      <span className="stance supporting">
        <span />
        {locale === 'ar' ? 'إيجابي' : 'Positive'}
      </span>
    </div>
    ```
- **Root cause**:
  1. **Vertical Centering on Title Wrap**: The heading "أبرز دليل إيجابي موثق" (or "Highlighted documented positive evidence" — 41 characters) wraps to two lines on 375px mobile viewports. Because the container has `items-center` without `flex-wrap`, the badge is centered across the height of both lines rather than top-aligning with the first line of text.
  2. **Selector Fragility**: In `PositiveEvidenceCard.tsx:37`, `{locale === 'ar' ? 'إيجابي' : 'Positive'}` is currently an unparenthesized text node. If wrapped in a `<span>` (as is done in `ClaimCards.tsx:75` and `EvidenceCard.tsx:91`), the bug from Finding 2 immediately collapses the badge text into a 4px dot.
- **Fix**:
  In `webapp/src/components/PositiveEvidenceCard.tsx:33-39`, update alignment to `items-start` with responsive wrapping and explicit dot class:
  ```tsx
  <div className="flex flex-wrap items-start justify-between gap-2">
    <h3 className="text-xs font-semibold text-[#2a3441] leading-snug">{strings.highlightedPositiveEvidence}</h3>
    <span className="stance supporting shrink-0">
      <span className="stance-dot" aria-hidden="true" />
      <span>{locale === 'ar' ? 'إيجابي' : 'Positive'}</span>
    </span>
  </div>
  ```
- **Confidence**: 100%.

---

### 4. Arabic External Source Anchor Hardcodes `dir="ltr"` on Localized Arabic Text
- **Severity**: **P1 (readable-but-wrong / RTL layout flaw)**
- **Surface**:
  - `/ar/merchants/positive-evidence/`
  - Action row on every card with a valid source URL
- **Evidence**:
  - Component: `webapp/src/components/PositiveEvidenceCard.tsx:70-79`
  - Markup:
    ```tsx
    {safeSourceUrl !== null ? (
      <a
        href={safeSourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-[44px] items-center text-[#4a7c7e] hover:text-[#2a3441] underline underline-offset-2"
        dir="ltr"
      >
        {strings.openOriginalSource}
      </a>
    ) : null}
    ```
  - String definition in `webapp/src/lib/i18n.ts:207`:
    ```ts
    openOriginalSource: 'فتح المصدر الأصلي',
    ```
- **Root cause**:
  `dir="ltr"` is hardcoded on the anchor element wrapping `{strings.openOriginalSource}`.
  In Arabic (`locale === 'ar'`), this renders pure Arabic text ("فتح المصدر الأصلي") inside an LTR embedding direction. This causes:
  - Reversal of logical text flow and bidirectional punctuation handling.
  - Potential punctuation hop (if quotes or brackets surround it).
  - Misaligned visual target order in flex rows.
  The original developer likely intended `dir="ltr"` for the URL, but applied it to the localized anchor label.
- **Fix**:
  Remove `dir="ltr"` from the anchor element in `webapp/src/components/PositiveEvidenceCard.tsx:75`:
  ```tsx
  {safeSourceUrl !== null ? (
    <a
      href={safeSourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-[44px] items-center text-[var(--teal)] hover:text-[var(--ink)] underline underline-offset-2"
    >
      {strings.openOriginalSource}
    </a>
  ) : null}
  ```
- **Confidence**: 100% (Directly verified in source).

---

### 5. Unbounded Highlighted Evidence Summary Without `line-clamp` Balloons Card Heights
- **Severity**: **P2 (nit / visual layout rhythm)**
- **Surface**:
  - `/ar/merchants/positive-evidence/`
  - `/en/merchants/positive-evidence/`
  - Seller list cards
- **Evidence**:
  - Component: `webapp/src/components/PositiveEvidenceCard.tsx:40-42`
  - Markup:
    ```tsx
    <p dir="auto" className="text-sm font-medium text-[#2a3441] leading-relaxed">
      {displaySummary(highlight.summary, locale)}
    </p>
    ```
  - Summary character length distribution in snapshot (`out/data/directory.json`):
    - Minimum length: 115 chars (`Makers Electronics`)
    - Maximum length: 289 chars (`Technology Valley`)
    - Average length: 194 chars
    - Variance: > 2.5× difference in vertical line count (2 lines vs. 6 lines).
- **Root cause**:
  There is no `line-clamp` or maximum vertical constraint applied to `highlight.summary`. In the single-column list inside `.index-panel`, longer summaries cause individual cards to balloon dramatically in height, creating an uneven and disjointed vertical scanning rhythm across the 23 items.
- **Fix**:
  Apply `line-clamp-3` to the summary paragraph in `webapp/src/components/PositiveEvidenceCard.tsx:40`:
  ```tsx
  <p dir="auto" className="text-sm font-medium text-[#2a3441] leading-relaxed line-clamp-3">
    {displaySummary(highlight.summary, locale)}
  </p>
  ```
- **Confidence**: 100%.

---

### 6. Sub-AA Contrast on `--muted` Token and Hardcoded Card Metadata (`#7a8085` @ 3.89:1)
- **Severity**: **P1 (readable-but-wrong / accessibility failure)**
- **Surface**:
  - `/ar/merchants/positive-evidence/`
  - `/en/merchants/positive-evidence/`
  - Card metadata, counters, timestamps, and empty state text
- **Evidence**:
  - Token in `webapp/app/bayyna.css:9`: `--muted: #7a8085;`
  - Hardcoded usages:
    - `PositiveEvidenceCard.tsx:49`: `<p className="text-xs text-[#7a8085]">`
    - `MerchantSummaryCard.tsx:69`: `<p className="text-xs text-[#7a8085]">`
    - `MerchantSummaryCard.tsx:85`: `<p className="text-xs text-[#7a8085]">`
    - `MerchantSummaryCard.tsx:105`: `<span className="text-xs text-[#7a8085]">`
    - `MerchantSummaryCard.tsx:108`: `<p className="text-xs text-[#7a8085] pt-1 border-t border-[#f0eee9]">`
    - `DirectoryPageShell.tsx:119`: `<p className="text-xs text-[var(--muted)]">`
    - `DirectoryPageShell.tsx:211`: `<p className="text-xs text-[var(--muted)]">`
  - Contrast calculations:
    - `#7a8085` on `--paper` (`#fdfcf9`): **3.89:1** (FAILS WCAG AA minimum 4.5:1)
    - `#7a8085` on `--bg` (`#f5f3ef`): **3.61:1** (FAILS WCAG AA minimum 4.5:1)
    - `#7a8085` on `#ffffff`: **4.00:1** (FAILS WCAG AA minimum 4.5:1)
- **Root cause**:
  `#7a8085` is too light for small 11px/12px (`text-xs`) typography across the cream/neutral card surfaces.
- **Fix**:
  1. In `webapp/app/bayyna.css:9`, darken `--muted`:
     ```css
     --muted: #5f6973; /* Contrast 5.05:1 on #f5f3ef, 5.46:1 on #fdfcf9 — PASSES WCAG AA */
     ```
  2. Replace hardcoded `#7a8085` with `var(--muted)` or `#56606a` across `PositiveEvidenceCard.tsx` and `MerchantSummaryCard.tsx`.
- **Confidence**: 100% (Mathematically proven via standard WCAG 2.1 relative luminance formula).

---

### 7. Stance Badge Background/Foreground Contrast Fails WCAG AA (4.05:1)
- **Severity**: **P1 (readable-but-wrong / accessibility failure)**
- **Surface**:
  - `/ar/merchants/positive-evidence/`
  - `/en/merchants/positive-evidence/`
  - All stance badges on cards (`.stance.supporting`, `.stance.negative`, `.stance.mixed`)
- **Evidence**:
  - Stylesheet: `webapp/app/bayyna.css:24`
  - Badge definitions:
    ```css
    .stance.supporting{background:#e9f0eb;color:#4a7c7e}
    .stance.negative{background:#f3eae6;color:#a65d57}
    .stance.mixed{background:#eceee9;color:#6a7568}
    ```
  - Contrast ratios computed at `font-size: 11px; font-weight: 500`:
    - Supporting (`#4a7c7e` on `#e9f0eb`): **4.05:1** (FAILS WCAG AA 4.5:1)
    - Negative (`#a65d57` on `#f3eae6`): **4.10:1** (FAILS WCAG AA 4.5:1)
    - Mixed (`#6a7568` on `#eceee9`): **4.12:1** (FAILS WCAG AA 4.5:1)
- **Root cause**:
  Muted brand palette colors are paired with light pastel backgrounds at small text sizing (11px), falling short of the required 4.5:1 threshold.
- **Fix**:
  In `webapp/app/bayyna.css:24`, darken the text colors of all three stance classes to meet or exceed 5.5:1:
  ```css
  .stance.supporting {
    background: #e9f0eb;
    color: #355f60; /* Contrast: 5.82:1 — PASSES AA */
  }
  .stance.negative {
    background: #f3eae6;
    color: #8c4b46; /* Contrast: 5.62:1 — PASSES AA */
  }
  .stance.mixed {
    background: #eceee9;
    color: #4f574d; /* Contrast: 6.54:1 — PASSES AA */
  }
  ```
- **Confidence**: 100% (Mathematical luminance calculation).

---

### 8. Empty State Hardcodes `Building2` Directory Icon Instead of `Scale` Balance Icon
- **Severity**: **P1 (readable-but-wrong)**
- **Surface**:
  - `/ar/merchants/positive-evidence/`
  - `/en/merchants/positive-evidence/`
  - Empty filtered state (e.g., filtering for a governorate with 0 positive merchants)
- **Evidence**:
  - Component: `webapp/src/components/DirectoryPageShell.tsx:148-153`
  - Markup:
    ```tsx
    <div className="directory-empty p-8 text-center">
      <div className="empty-index-icon">
        <Building2 size={29} />
        <span className="empty-index-small">
          <Search size={13} />
        </span>
      </div>
      {emptyState}
    </div>
    ```
- **Root cause**:
  `DirectoryPageShell` hardcodes `<Building2 size={29} />` inside `.empty-index-icon`.
  On `/merchants/positive-evidence/`, the heading uses `<Scale size={27} />`, the toolbar uses `<Scale size={18} />`, and `loading.tsx` uses `<Scale size={29} />`.
  Displaying the building icon on an empty state in the positive evidence route creates an iconographic mismatch. In addition, neither `<Building2>` nor `<Search>` has `aria-hidden="true"`.
- **Fix**:
  In `webapp/src/components/DirectoryPageShell.tsx:149`, render the icon conditionally:
  ```tsx
  <div className="empty-index-icon">
    {view === 'all' ? (
      <Building2 size={29} aria-hidden="true" />
    ) : (
      <Scale size={29} aria-hidden="true" />
    )}
    <span className="empty-index-small">
      <Search size={13} aria-hidden="true" />
    </span>
  </div>
  ```
- **Confidence**: 100%.

---

### 9. Directory View Switcher Truncates Titles (`max-width: 170px`) & Vanishes on Mobile
- **Severity**: **P1 (readable-but-wrong / mobile loss of feature)**
- **Surface**:
  - `/ar/merchants/positive-evidence/`
  - `/en/merchants/positive-evidence/`
  - Toolbar view switcher dropdown
- **Evidence**:
  - Component: `webapp/src/components/DirectoryPageShell.tsx:125-141`
  - Stylesheet: `webapp/app/bayyna.css:22` (`.filter-select select{max-width:170px}`)
  - Stylesheet mobile query: `webapp/app/bayyna.css:32` (`@media(max-width:900px){.filter-select select{max-width:154px}}`)
  - String lengths:
    - Arabic: "البائعون ذوو أقوى الأدلة الإيجابية" (32 chars)
    - English: "Vendors with Strongest Positive Evidence" (40 chars)
- **Root cause**:
  1. The select input inherits `.filter-select select` styling from `bayyna.css:22`, which limits `max-width` to `170px` (and `154px` at ≤900px). At 11px font size, a 170px select fits only ~22 characters. Both localized titles clip abruptly inside the dropdown control.
  2. The parent label has `className="filter-select hidden sm:flex"`. On screens under 640px, the directory switcher disappears completely from the view. Mobile users on the positive evidence page have no in-page control to switch back to the All Merchants directory.
- **Fix**:
  In `webapp/src/components/DirectoryPageShell.tsx:125-141`:
  1. Add a dedicated class `.view-switcher-select` that overrides `max-width` to `max-w-[280px]` or `w-auto`.
  2. Change `hidden sm:flex` to `flex` with responsive sizing so mobile users can navigate directories directly from the toolbar.
- **Confidence**: 100%.

---

### 10. Pagination Flex Nav Missing `w-full` Leaves Controls Bunched at Container Edge
- **Severity**: **P1 (readable-but-wrong / layout alignment flaw)**
- **Surface**:
  - `/ar/merchants/positive-evidence/`
  - `/en/merchants/positive-evidence/`
  - Footer pagination (page 1 of 2 across 23 items)
- **Evidence**:
  - Component: `webapp/src/components/Pagination.tsx:61-64`
  - Container: `webapp/src/components/DirectoryPageShell.tsx:198-206`
  - Stylesheet: `webapp/app/bayyna.css:84`
  - Markup in `Pagination.tsx`:
    ```tsx
    <nav
      aria-label={activeAriaLabel}
      className="pagination flex flex-wrap items-center justify-between gap-3 text-xs"
    >
      <div className="flex flex-wrap items-center gap-1.5">...</div>
      <span className="pagination-status text-xs text-[var(--muted)]">...</span>
    </nav>
    ```
  - Stylesheet in `bayyna.css:84`:
    ```css
    .index-footer{padding:16px 23px;border-top:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:14px;background:#fafaf6}
    ```
- **Root cause**:
  `.index-footer` is a flex container with `justify-content: space-between`.
  Its direct child is `<nav className="pagination">`.
  Because `<nav>` does not declare `w-full` or `flex-1`, it shrinks to wrap only its own contents.
  Although `<nav>` has `justify-between` between its inner button group and `.pagination-status`, the whole `<nav>` is pinned to one side of `.index-footer` (right side in RTL, left side in LTR). This leaves a wide, awkward blank space across the entire container width instead of pinning page buttons to the start edge and "صفحة 1 من 2" to the end edge.
- **Fix**:
  Add `w-full` to `<nav>` in `webapp/src/components/Pagination.tsx:63`:
  ```tsx
  <nav
    aria-label={activeAriaLabel}
    className="pagination w-full flex flex-wrap items-center justify-between gap-3 text-xs"
  >
  ```
- **Confidence**: 100% (Directly verifiable in DOM box model).

---

### 11. Arabic Date Formatting Visually Inverted Inside `dir="ltr"` Wrapper
- **Severity**: **P1 (readable-but-wrong / RTL date display)**
- **Surface**:
  - `/ar/merchants/positive-evidence/`
  - Published and captured timestamps on every card
- **Evidence**:
  - Component: `webapp/src/components/PositiveEvidenceCard.tsx:55`
  - Component: `webapp/src/components/MerchantSummaryCard.tsx:111, 120`
  - Component: `webapp/src/components/DirectoryPageShell.tsx:213`
  - Formatter: `webapp/src/components/display.ts:44-49`
  - Formatter implementation:
    ```ts
    const AR_EG_DATE = new Intl.DateTimeFormat('ar-EG', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    });
    ```
- **Root cause**:
  `AR_EG_DATE.format()` outputs dates using Arabic-Indic digits and Arabic month names (e.g. `١٨ مايو ٢٠٢٤`).
  In `PositiveEvidenceCard.tsx:55`, `MerchantSummaryCard.tsx:111`, and `DirectoryPageShell.tsx:213`, the timestamp is wrapped in `<time dateTime="..." dir="ltr">`.
  Under the Unicode Bidirectional Algorithm (UBA), forcing an LTR embedding (`dir="ltr"`) on Arabic-script text containing Arabic-Indic digits flips the visual rendering order relative to the sentence: the year appears on the far right and the day on the far left.
- **Fix**:
  In `PositiveEvidenceCard.tsx:55`, `MerchantSummaryCard.tsx:111`, and `DirectoryPageShell.tsx:213`, use `<time dateTime={...} dir="auto">` or omit `dir="ltr"` when `locale === 'ar'`:
  ```tsx
  <time dateTime={highlight.publishedAt.slice(0, 10)} dir={locale === 'en' ? 'ltr' : 'auto'}>
    {formatDate(highlight.publishedAt, locale)}
  </time>
  ```
- **Confidence**: 100%.

---

### 12. Empty State "Data Notice" Paragraph Contrast Fails WCAG AA (4.31:1)
- **Severity**: **P1 (readable-but-wrong / accessibility failure)**
- **Surface**:
  - `/ar/merchants/positive-evidence/`
  - `/en/merchants/positive-evidence/`
  - Empty state notice panel ("ملاحظة حول تغطية الأدلة" / "Evidence Coverage Note")
- **Evidence**:
  - Component: `webapp/src/components/DirectoryPageShell.tsx:156-168`
  - Stylesheet: `webapp/app/bayyna.css:22, 57`
  - CSS rules:
    ```css
    .data-notice{background:#eceee8;border:1px solid #dfe3d9;border-radius:4px;color:#75806f}
    .data-notice p{font-size:12px;color:#65735e}
    ```
  - Contrast:
    - Text `#65735e` on background `#eceee8`: **4.31:1** (FAILS WCAG AA minimum 4.5:1).
- **Root cause**:
  The paragraph text color inside `.data-notice` is set to `#65735e`, which is slightly too light on `#eceee8`.
- **Fix**:
  In `webapp/app/bayyna.css`, darken `.data-notice p`:
  ```css
  .data-notice p {
    font-size: 12px;
    color: #4e5d48; /* Contrast: 6.27:1 — PASSES WCAG AA */
  }
  ```
- **Confidence**: 100%.

---

### 13. Invalid Filter Query State Lacks Reset / Escape Action
- **Severity**: **P2 (nit / UX dead end)**
- **Surface**:
  - `/ar/merchants/positive-evidence/?category=invalid`
  - `/en/merchants/positive-evidence/?page=invalid`
- **Evidence**:
  - Component: `webapp/src/components/DirectoryBrowser.tsx:161-190`
  - Markup:
    ```tsx
    <div className="data-notice" role="alert">
      <Info size={18} />
      <div>
        <strong>{isEn ? 'Invalid Filter or Page' : 'قيمة الترشيح غير صالحة'}</strong>
        <p>
          {isEn
            ? 'The filter or page value in the address is invalid.'
            : 'قيمة الترشيح أو الصفحة في العنوان غير صالحة.'}
        </p>
      </div>
    </div>
    ```
- **Root cause**:
  When a user enters an invalid filter or page number in the query string, `DirectoryBrowser` renders an alert notice but provides **no link or button** to clear filters or return to `/merchants/positive-evidence`. The user is left in a dead-end state unless they manually edit the browser URL.
- **Fix**:
  In `webapp/src/components/DirectoryBrowser.tsx:186`, add an escape action link:
  ```tsx
  <Link
    href={`/${locale}/merchants/positive-evidence`}
    className="secondary-button inline-flex mt-3"
  >
    {isEn ? 'Reset to full list' : 'العودة إلى القائمة كاملة'}
  </Link>
  ```
- **Confidence**: 100%.

---

### 14. Double Border and Border-Radius Mismatch on List Cards inside `.index-panel`
- **Severity**: **P2 (nit / visual polish)**
- **Surface**:
  - `/ar/merchants/positive-evidence/`
  - `/en/merchants/positive-evidence/`
  - Seller cards list
- **Evidence**:
  - Component: `webapp/src/components/DirectoryPageShell.tsx:187-197`
  - Markup:
    ```tsx
    <ul className="divide-y divide-[var(--border)]" aria-label={listLabel}>
      {result.items.map((entry) => (
        <li key={entry.id}>
          <PositiveEvidenceCard entry={entry} locale={locale} />
        </li>
      ))}
    </ul>
    ```
  - Component: `webapp/src/components/MerchantSummaryCard.tsx:39` (`<article className="merchant-card space-y-3">`)
  - Stylesheet: `webapp/app/bayyna.css:117` (`.merchant-card{background:#fdfcf9;border:1px solid #e4e3de;border-radius:5px;...}`)
- **Root cause**:
  `DirectoryPageShell` places items in a `<ul className="divide-y divide-[var(--border)]">`. However, each item renders `<article className="merchant-card">`, which already possesses its own 4-sided border (`border: 1px solid #e4e3de`) and `border-radius: 5px`. This produces stacked double borders (`1px + 1px`) and rounded corners floating flush against container edges.
- **Fix**:
  In `webapp/src/components/DirectoryPageShell.tsx:187`, change `divide-y divide-[var(--border)]` to `p-4 space-y-3` (card list styling) so each `.merchant-card` has natural breathing room inside `.index-panel`:
  ```tsx
  <ul className="p-4 space-y-3" aria-label={listLabel}>
  ```
- **Confidence**: 100%.

---

### 15. Unconditional 300px Sidebar Ad Gutter on Desktop When Ads Disabled
- **Severity**: **P2 (nit / desktop responsive optimization)**
- **Surface**:
  - `/ar/merchants/positive-evidence/`
  - `/en/merchants/positive-evidence/`
  - Desktop viewports (≥1024px)
- **Evidence**:
  - Component: `webapp/app/[locale]/merchants/layout.tsx:28-41`
  - Markup:
    ```tsx
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-8">
      <div className="min-w-0">{children}</div>
      <aside aria-label="..." className="hidden lg:block lg:sticky lg:top-4">
        <AdSidebarBanner locale={locale} />
      </aside>
    </div>
    ```
- **Root cause**:
  When `NEXT_PUBLIC_ENABLE_ADS` is disabled (the default environment state), `AdSidebarBanner` returns `null`. However, `MerchantsLayout` statically preserves `lg:grid-cols-[minmax(0,1fr)_300px]` and leaves the empty `<aside>` in the DOM. This unnecessarily reserves a 300px blank gutter on large desktop screens, compressing the primary directory table.
- **Fix**:
  Check `areAdsEnabled()` from `@/lib/ads` before applying the grid layout:
  ```tsx
  import { areAdsEnabled } from '@/lib/ads';

  export default async function MerchantsLayout({ ... }) {
    const adsActive = areAdsEnabled();
    return (
      <div className={adsActive ? "lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-8" : "w-full"}>
        <div className="min-w-0">{children}</div>
        {adsActive ? (
          <aside aria-label="..." className="hidden lg:block lg:sticky lg:top-4">
            <AdSidebarBanner locale={locale} />
          </aside>
        ) : null}
        ...
      </div>
    );
  }
  ```
- **Confidence**: 100%.

---

## Status Items: Ground-Truth Local vs. Live Discrepancies

### ALREADY FIXED in source — no action: Filter Bar Apply Button Visibility
- **Defect on Live**: On older live builds (e.g. `layout-403310ff`), the submit button was styled with `border border-black` without explicit foreground text styling, causing it to render dark text on dark backgrounds under certain browser user-agent stylesheets.
- **Local Source State**: In the current source (`webapp/src/components/DirectoryFilterBar.tsx:102`) and emitted bundle (`out/_next/static/chunks/318-791b65f09ca241db.js`), the button explicitly includes:
  ```tsx
  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[4px] bg-[var(--ink)] px-4 py-1.5 text-xs font-medium text-white transition hover:bg-[#1d2530]"
  ```
  *(Note: To ensure priority over unlayered `button{color:inherit}` from `bayyna.css:10`, see Finding 1 in Skill 02 for `!text-white` priority).*

### ALREADY FIXED in source — no action: Positive Eligibility Data Invariants
- **Audit Verification**:
  - Total merchants in dataset snapshot: **707**
  - Exactly **23 merchants** qualify as `isPositiveEligible` (`positiveSources >= 2`, 0 non-merchant negative observations, 0 warning/risk signals, verified/established identity).
  - All 23 merchants render with accurate counts, zero NaN values, and zero adverse signals.

---

## Baseline Design Tokens

| Token | Current Value | Recommended Value | Contrast on `--paper` (`#fdfcf9`) | Purpose |
|---|---|---|---|---|
| `--ink` | `#2a3441` | `#2a3441` | 13.5:1 (AAA) | Primary headings, titles, active buttons |
| `--muted` | `#7a8085` | `#5f6973` | 5.46:1 (AA) | Labels, timestamps, secondary tallies |
| `--teal` | `#4a7c7e` | `#355f60` | 5.82:1 (AA) | Brand icons, stance supporting, active links |
| `--brick` | `#a65d57` | `#8c4b46` | 5.62:1 (AA) | Adverse alerts, negative stance badge |
| `--border` | `#e4e3de` | `#e4e3de` | N/A | Structural panel and input dividers |
| `--paper` | `#fdfcf9` | `#fdfcf9` | N/A | Card surfaces and input backgrounds |
| `--bg` | `#f5f3ef` | `#f5f3ef` | N/A | Page canvas background |

---

## Verified Clean Inventory

The following items were comprehensively verified and confirmed free of defects:
1. **Interactive Touch Targets**: Every link and button across `PositiveEvidenceCard` (vendor title link, `#evidence-<id>` anchor, external source anchor) and `Pagination` satisfies the `min-h-[44px]` touch target guideline.
2. **Deterministic Selector Invariants**: The positive view selection strictly adheres to the deterministic selector order (`rank.customerPositiveSources` descending, followed by `distinctSources`, `newestPositiveAt`, and canonical name). No scalar scores or confidence bands are computed or displayed.
3. **RTL Directional Flipping on Pagination Chevrons**: `Pagination.tsx` properly flips directional chevrons (`ChevronRight` for Previous in AR, `ChevronLeft` for Next in AR).
4. **Summary Bidirectional Isolation**: `PositiveEvidenceCard.tsx:40` uses `dir="auto"`, allowing English Reddit/Facebook evidence summaries to render left-to-right correctly while remaining embedded within the RTL Arabic page container.
5. **No Data Leakage**: The positive evidence cards expose only safe public projection fields. Internal pipeline tokens (`source_reliability`, `entity_certainty`, `reliability_band`) are 100% absent from both markup and client JSON bundles.
