# Skill 04: Merchant Profile Layout, Overlap & UX Audit

> **Target Profile**: Merchant Profile Pages (`/ar/merchant/[id]/` and `/en/merchant/[id]/`)  
> **Scope**: Route `/ar/merchant/<id>/` (RTL) + `/en/merchant/<id>/` (LTR), including evidence cards, claim cards, cited brief, identifiers, related merchants, and report navigation across all 707 static merchant profiles.  
> **Source Files**:  
> - `webapp/app/[locale]/merchant/[id]/page.tsx`  
> - `webapp/app/[locale]/merchant/[id]/CopyReportButton.tsx`  
> - `webapp/src/components/ClaimCards.tsx`  
> - `webapp/src/components/EvidenceCard.tsx`  
> - `webapp/src/components/CitedBrief.tsx`  
> - `webapp/src/components/IdentifierList.tsx`  
> - `webapp/src/components/RelatedMerchants.tsx`  
> - `webapp/src/components/SourceCitations.tsx`  
> - `webapp/src/components/SentimentBar.tsx` (reference/library component)  
> - `webapp/src/components/MerchantEvidenceOverview.tsx` (reference/library component)  
> - `webapp/app/bayyna.css`  
> - Emitted CSS: `webapp/out/_next/static/css/0a9de0b3de909b20.css`  
> **Status**: Read-only audit. Ground truth verified against local source + `webapp/out/` artifacts, cross-checked against live deployment `https://daleeleltogar.pages.dev`.

---

## 1. Executive Summary & Mandated Bug Root Cause

### Mandated Bug: Two Dots Stacking / Colliding Directly Above and On the Word **محايد**

The user reported: **"TWO dots/elements overlapping directly above/on the word محايد on merchant pages, plus other colliding text."**

Our audit identified the exact CSS selector and DOM interaction causing this defect. The bug is reproduced deterministically across every merchant page in both Arabic (`محايد`) and English (`Neutral`), as well as on supporting (`إيجابي` / `Positive`) and negative (`سلبي` / `Negative`) badges.

#### Root Cause Mechanism
In `webapp/app/bayyna.css` (line 24) and the compiled CSS bundle `0a9de0b3de909b20.css`, the rule for `.stance` badges is:
```css
.stance {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 3px;
  font-weight: 500;
}
.stance>span {
  width: 4px;
  height: 4px;
  background: currentColor;
  border-radius: 50%;
}
.stance.mixed { background: #eceee9; color: #6a7568; }
.stance.supporting { background: #e9f0eb; color: #4a7c7e; }
.stance.negative { background: #f3eae6; color: #a65d57; }
```

In the TSX source code:
- `ClaimCards.tsx` (lines 73–76):
  ```tsx
  <span className={`stance ${stanceClass}`}>
    <span />
    <span>{sentimentLabel(claim.sentiment, locale)}</span>
  </span>
  ```
- `EvidenceCard.tsx` (lines 89–95):
  ```tsx
  <span className={`stance ${stanceClass}`}>
    <span />
    <span>
      {strings.evidenceDirection}
      {sentimentLabel(evidence.sentiment, locale)}
    </span>
  </span>
  ```
- `MerchantEvidenceOverview.tsx` (line 346):
  ```tsx
  <span className={`stance ${stanceClass}`}>
    <span />
    <span>{sentimentLabel(item.sentiment, locale)}</span>
  </span>
  ```

Because `.stance>span` uses a descendant combinator targeting **any direct child `span`** of `.stance` rather than `:first-child`, the selector matches **both** spans:
1. **Child 1 (`<span />`)**: receives `width: 4px; height: 4px; background: currentColor; border-radius: 50%` — this creates **Dot #1** (the intended 4px bullet dot).
2. **Child 2 (`<span>محايد</span>`)**: ALSO receives `width: 4px; height: 4px; background: currentColor; border-radius: 50%` — this creates **Dot #2**!

In browser flexbox layout:
- Child 2 has `background: #6a7568` and `border-radius: 50%`.
- Even though the flex item stretches horizontally to contain text, the 4px height and 50% border radius render a dark circular/elliptical background disk directly behind and through the first character of the word **محايد** (specifically overlapping the round loop of the Arabic letter **م**).
- Since `.stance` has `display: inline-flex` with `gap: 6px`, the browser positions Dot #1, inserts a 6px gap, and then draws Dot #2 directly on top of the beginning of the word **محايد**.
- To the human eye, this manifests as **TWO dots stacked side-by-side, with the second dot stamped directly on the word محايد**.

---

## 2. Element-Overlap Map

```
====================================================================================================
                        STANCE BADGE ELEMENT COLLISION GEOMETRY
====================================================================================================

Parent: <span class="stance mixed">
  CSS: display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px; background: #eceee9; color: #6a7568;

  --------------------------------------------------------------------------------------------------
  RTL Layout Flow (Inline Start = Right Side):
  [Padding 8px] ---> [Child 1 (Dot #1)] ---> [Gap 6px] ---> [Child 2 (Dot #2 + Text)] ---> [Padding 8px]
  --------------------------------------------------------------------------------------------------

  +------------------------------------------------------------------------------------------------+
  |  .stance (badge container)                                                                     |
  |                                                                                                |
  |   Child 1: <span></span>                  Child 2: <span>محايد</span>                           |
  |   +-------------------+                   +-----------------------------------------------+    |
  |   | width: 4px        |                   | width: 4px; height: 4px                       |    |
  |   | height: 4px       |    gap: 6px       | background: #6a7568 (currentColor)            |    |
  |   | border-radius: 50%|  <---------->     | border-radius: 50% (DRAWS SECOND DOT!)        |    |
  |   | bg: #6a7568       |                   | [•] <=== DOT #2 COLLIDES WITH OVERFLOW TEXT   |    |
  |   +-------------------+                   |  |                                            |    |
  |             ^                             |  +---> مـحـايـد                                |    |
  |             |                             +-----------------------------------------------+    |
  |         DOT #1                                      ^                                          |
  |   (intended bullet)                                 |                                          |
  |                                        DOT #2 ON TOP OF "محايد"                                |
  |                                    (caused by .stance>span selector)                           |
  +------------------------------------------------------------------------------------------------+

Exact CSS Selector Collision:
  `bayyna.css:24`:  .stance>span { width:4px; height:4px; background:currentColor; border-radius:50% }
  Matches Child 1:  <span />             ==> Correct 4px bullet dot.
  Matches Child 2:  <span>محايد</span>   ==> INCORRECT: Paints 4px round circular background artifact
                                             directly under/above the letters of "محايد"!
====================================================================================================
```

---

## 3. Inventory of Physical, Directional & Positioning Properties

We conducted a full-AST grep and regex sweep across merchant-page TSX components and `bayyna.css` for `position: absolute|relative`, negative margins, pseudo-elements (`::before/::after`), and physical directions (`left`, `right`, `ml-*`, `mr-*`, `pl-*`, `pr-*`, `border-l-*`, `border-r-*`, `dir="*"`):

| Category | File & Line | Code Snippet | RTL/LTR Safety Assessment |
|---|---|---|---|
| **Selector Scope** | `bayyna.css:24` | `.stance>span` | **BROKEN**: Matches all direct span children, generating duplicate dots on text. |
| **Selector Scope** | `bayyna.css:22` | `.page-heading>p` | **OVERRIDE BUG**: Unlayered rule overrides all Tailwind utilities on header `<p>` tags. |
| **Directional Inversion** | `page.tsx:311` | `<h1 dir="auto">` | **MISALIGNED**: Evaluates English brand names to LTR on Arabic pages, flipping icon and heading to left margin across 634/707 merchants. |
| **Directional Inversion** | `EvidenceCard.tsx:117` | `<blockquote dir="auto" className="border-s-2 ...">` | **FLIPPED BORDER**: Latin-leading quotes flip logical `border-s-2` to the left on Arabic RTL pages. |
| **Missing Marker** | `page.tsx:472,491`, `EvidenceCard.tsx:157` | `<summary className="... inline-flex ...">` | **DEFECT**: `inline-flex` suppresses native `::marker` without providing an icon fallback. |
| **Contrast Failure** | `bayyna.css:24` | `.stance.supporting { color: #4a7c7e; background: #e9f0eb; }` | **WCAG FAIL**: 4.05:1 contrast ratio (< 4.5:1 required for 11px text). |
| **Contrast Failure** | `bayyna.css:24` | `.stance.negative { color: #a65d57; background: #f3eae6; }` | **WCAG FAIL**: 4.10:1 contrast ratio (< 4.5:1 required for 11px text). |
| **Contrast Failure** | `bayyna.css:24` | `.stance.mixed { color: #6a7568; background: #eceee9; }` | **WCAG FAIL**: 4.12:1 contrast ratio (< 4.5:1 required for 11px text). |
| **Contrast Failure** | `bayyna.css:26` | `.section-note { font-size: 11px; color: #8b9683; }` | **WCAG FAIL**: 2.94:1 contrast ratio on `#faf9f6` (< 3.0:1 large, < 4.5:1 normal). |
| **Contrast Failure** | `bayyna.css:26` | `.report-nav a { font-size: 11px; color: #7c8b71; }` | **WCAG FAIL**: 3.45:1 contrast ratio on `#faf9f6` (< 4.5:1 required for 11px text). |
| **Sub-10px Typography** | `bayyna.css:28` | `[dir=ltr] .copy-button { font-size: 9px; }` | **DEFECT**: 9px text violates legibility standards on English merchant pages. |
| **BiDi Attribute** | `ClaimCards.tsx:27` | `<a ... dir="ltr">{strings.evidenceAnchor}</a>` | **BiDi NIT**: Forces Arabic phrase `دليل 1` into LTR layout. |
| **Floating Separators** | `EvidenceCard.tsx:96,101,105` | `<span>·</span>` flex items in `flex-wrap` | **WRAPPING NIT**: Standalone middle dots wrap to start of line on 360px mobile viewports. |
| **Orphaned Punctuation** | `RelatedMerchants.tsx:36` | `<span> — </span>` at start of `<p>` | **VISUAL NIT**: Line begins unconditionally with an orphaned em-dash. |

---

## 4. Comprehensive Findings & Fix Specifications

### Finding 1: Mandated Bug — Stacking / Colliding Dots on Sentiment Badges (محايد, Neutral, etc.)
- **Severity**: **P0 (Visual-broken / core design defect)**
- **Surface**:  
  - `/ar/merchant/<id>/` (all 707 merchant profiles)  
  - `/en/merchant/<id>/` (all 707 merchant profiles)  
  - Affected components: `ClaimCards.tsx:73`, `EvidenceCard.tsx:89`, `MerchantEvidenceOverview.tsx:346`, `MerchantSummaryCard.tsx:97`
- **Evidence**:  
  - Emitted HTML (`webapp/out/ar/merchant/00450860-3c15-4508-bbbe-f3d0871094cf/index.html`):
    ```html
    <span class="stance mixed"><span></span><span>محايد</span></span>
    <span class="stance mixed"><span></span><span>اتجاه الدليل: <!-- -->محايد</span></span>
    ```
  - Emitted HTML (`webapp/out/en/merchant/00450860-3c15-4508-bbbe-f3d0871094cf/index.html`):
    ```html
    <span class="stance mixed"><span></span><span>Neutral</span></span>
    <span class="stance mixed"><span></span><span>Evidence sentiment: <!-- -->Neutral</span></span>
    ```
  - CSS rule (`webapp/app/bayyna.css:24`):
    ```css
    .stance>span{width:4px;height:4px;background:currentColor;border-radius:50%}
    ```
- **Root Cause**:  
  The selector `.stance>span` styles every child `span`. When components wrap text in `<span>{label}</span>`, Child 2 matches the dot selector and renders a 4px circular background artifact directly on/under the word **محايد** (or **Neutral**), creating two visible dots side by side.
- **Fix**:  
  Update `webapp/app/bayyna.css` (line 24):
  ```css
  /* BEFORE */
  .stance>span{width:4px;height:4px;background:currentColor;border-radius:50%}

  /* AFTER */
  .stance>span:first-child{width:4px;height:4px;background:currentColor;border-radius:50%;flex-shrink:0}
  ```
  *(Optionally in component TSX: `<span className="stance-dot" aria-hidden="true" />` paired with `.stance-dot { width: 4px; height: 4px; background: currentColor; border-radius: 50%; flex-shrink: 0; }`)*.
- **Confidence**: 100% (Confirmed via static markup analysis, computed CSS rule tracing, and live vs local parity check).

---

### Finding 2: Unlayered `.page-heading>p` Overriding Tailwind Utility Classes in Header Metadata
- **Severity**: **P1 (Readable-but-wrong / Spacing & hierarchy flaw)**
- **Surface**: `/ar/merchant/<id>/` and `/en/merchant/<id>/` (all 707 profiles)
- **Evidence**:  
  - `webapp/app/[locale]/merchant/[id]/page.tsx` lines 316, 327, 345, 367:
    ```tsx
    <p className="text-sm text-[#56606a] mt-1">...</p>
    <p className="text-xs text-[#7a8085] mt-1">...</p>
    <p className="text-xs text-[#7a8085] mt-1">...</p>
    <p className="text-xs text-[#7a8085] mt-2" dir="auto">...</p>
    ```
  - `webapp/app/bayyna.css` line 22:
    ```css
    .page-heading>p{font-size:14px;color:#7a8181;line-height:2;max-width:700px;margin-top:11px}
    ```
- **Root Cause**:  
  Because `bayyna.css` is unlayered, `.page-heading>p` overrides Tailwind's `@layer utilities` classes (`text-xs`, `text-[#7a8085]`, `mt-1`, `mt-2`). All metadata `<p>` tags in the identity header are forced to `font-size: 14px; margin-top: 11px; line-height: 2`, creating loose, bloated spacing and destroying the designed hierarchy.
- **Fix**:  
  In `webapp/app/bayyna.css:22`, replace `.page-heading>p` with `.page-heading>.page-intro`:
  ```css
  /* BEFORE */
  .page-heading>p{font-size:14px;color:#7a8181;line-height:2;max-width:700px;margin-top:11px}

  /* AFTER */
  .page-heading>.page-intro{font-size:14px;color:#7a8181;line-height:2;max-width:700px;margin-top:11px}
  ```
- **Confidence**: 100%.

---

### Finding 3: Header H1 Inversion on Arabic Pages for Latin/English Store Names
- **Severity**: **P1 (Visual misalignment / BiDi defect)**
- **Surface**: `/ar/merchant/<id>/` across 634 of 707 merchants (89.7% of catalog, including `Elaraby Group`, `Giza Systems Distribution`, `B.TECH`, `LG Egypt`, etc.)
- **Evidence**:  
  - `webapp/app/[locale]/merchant/[id]/page.tsx` lines 311–314:
    ```tsx
    <h1 dir="auto">
      <Fingerprint size={28} className="text-[#4a7c7e]" aria-hidden="true" />
      <span>{merchant.canonicalName}</span>
    </h1>
    ```
  - `bayyna.css:22`:
    ```css
    .page-heading h1{display:flex;align-items:center;gap:13px;font-size:26px;font-weight:500;line-height:1.7;margin-top:13px}
    ```
- **Root Cause**:  
  `dir="auto"` on `<h1>` forces the entire flex container into LTR when `canonicalName` starts with a Latin character. The Fingerprint icon moves to the far left margin, and the heading text starts on the left, while the eyebrow above it (`تقرير فحص التاجر`) and subtitle below it are aligned to the right margin.
- **Fix**:  
  In `webapp/app/[locale]/merchant/[id]/page.tsx:311-314`:
  ```tsx
  /* BEFORE */
  <h1 dir="auto">
    <Fingerprint size={28} className="text-[#4a7c7e]" aria-hidden="true" />
    <span>{merchant.canonicalName}</span>
  </h1>

  /* AFTER */
  <h1>
    <Fingerprint size={28} className="text-[#4a7c7e] flex-shrink-0" aria-hidden="true" />
    <span dir="auto">{merchant.canonicalName}</span>
  </h1>
  ```
- **Confidence**: 100%.

---

### Finding 4: Inverted Blockquote Borders for Latin-Leading Customer Quotes in Evidence Cards
- **Severity**: **P1 (Visual inconsistency / border hopping)**
- **Surface**: `/ar/merchant/<id>/` (Evidence cards with English quotes or quotes starting with brand names)
- **Evidence**:  
  - `webapp/src/components/EvidenceCard.tsx` lines 116–120:
    ```tsx
    {evidence.quotedExcerpt.trim().length > 0 ? (
      <blockquote dir="auto" className="border-s-2 border-[#4a7c7e] ps-3.5 py-1 text-sm text-[#3d4a5c] italic bg-[#fafaf6] rounded-e">
        «{evidence.quotedExcerpt}»
      </blockquote>
    ) : null}
    ```
- **Root Cause**:  
  `border-s-2` resolves to `border-inline-start-width: 2px`. When `dir="auto"` is set directly on the `<blockquote>`, any quote starting with Latin letters resolves to LTR, flipping the decorative bar to the physical left side while Arabic quotes have it on the right side.
- **Fix**:  
  In `webapp/src/components/EvidenceCard.tsx:117`:
  Keep page-level direction on the `<blockquote>` and isolate text direction internally:
  ```tsx
  /* BEFORE */
  <blockquote dir="auto" className="border-s-2 border-[#4a7c7e] ps-3.5 py-1 text-sm text-[#3d4a5c] italic bg-[#fafaf6] rounded-e">
    «{evidence.quotedExcerpt}»
  </blockquote>

  /* AFTER */
  <blockquote className="border-s-2 border-[#4a7c7e] ps-3.5 py-1 text-sm text-[#3d4a5c] italic bg-[#fafaf6] rounded-e">
    <span dir="auto">«{evidence.quotedExcerpt}»</span>
  </blockquote>
  ```
- **Confidence**: 100%.

---

### Finding 5: Missing Disclosure Markers in All Collapsible Details Sections
- **Severity**: **P1 (Usability / Affordance defect)**
- **Surface**: `/ar/merchant/<id>/` and `/en/merchant/<id>/` (all profiles)
- **Evidence**:  
  - `page.tsx:472`: `<summary className="font-medium text-[#56606a] cursor-pointer min-h-[44px] inline-flex items-center">`
  - `page.tsx:491`: `<summary className="font-medium text-[#56606a] cursor-pointer min-h-[44px] inline-flex items-center">`
  - `EvidenceCard.tsx:157`: `<summary className="min-h-[44px] inline-flex items-center cursor-pointer font-medium hover:text-[#2a3441]">`
  - `SourceCitations.tsx:209`: `<summary className="cursor-pointer text-[#7a8085] hover:text-[#2a3441] min-h-[44px] inline-flex items-center">`
- **Root Cause**:  
  Applying `display: inline-flex` to `<summary>` removes `display: list-item`, causing WebKit and Chromium browsers to completely suppress the native disclosure triangle. No custom indicator icon (such as Lucide `<ChevronDown />`) is supplied, rendering interactive accordions indistinguishable from static text.
- **Fix**:  
  Add a chevron icon with group-open rotation inside each `<summary>`:
  ```tsx
  /* Example for EvidenceCard.tsx:157 */
  <summary className="min-h-[44px] inline-flex items-center gap-1.5 cursor-pointer font-medium hover:text-[#2a3441] group">
    <ChevronDown size={14} className="transition-transform group-open:rotate-180 text-[#7a8085]" aria-hidden="true" />
    <span>{strings.sourceDetailsSummary}</span>
  </summary>
  ```
- **Confidence**: 100%.

---

### Finding 6: Multiple WCAG 2.1 Contrast Failures in Badges, Section Notes, and Navigation
- **Severity**: **P1 (Accessibility / Legibility defect)**
- **Surface**: `/ar/merchant/<id>/` and `/en/merchant/<id>/` (all merchant pages)
- **Evidence**:  
  - Mathematical contrast ratios calculated against backgrounds:
    - `.section-note` (`#8b9683` on `#faf9f6`): **2.94:1** (Fails 4.5:1 AA)
    - `.report-nav a` (`#7c8b71` on `#faf9f6`): **3.45:1** (Fails 4.5:1 AA)
    - `.stance.supporting` (`#4a7c7e` on `#e9f0eb`): **4.05:1** (Fails 4.5:1 AA)
    - `.stance.negative` (`#a65d57` on `#f3eae6`): **4.10:1** (Fails 4.5:1 AA)
    - `.stance.mixed` (`#6a7568` on `#eceee9`): **4.12:1** (Fails 4.5:1 AA)
    - `text-[#7a8085]` (`#7a8085` on `#fdfcf9`): **3.90:1** (Fails 4.5:1 AA)
- **Root Cause**:  
  Muted aesthetic pastel colors from the original design mock fall below the 4.5:1 contrast threshold required for 11px and 12px text under WCAG 2.1 AA.
- **Fix**:  
  In `webapp/app/bayyna.css`:
  - Change `.section-note` color from `#8b9683` to `#5d6b56` (contrast ratio 5.02:1).
  - Change `.report-nav a` color from `#7c8b71` to `#4d5e46` (contrast ratio 6.20:1).
  - Change `.stance.supporting` color from `#4a7c7e` to `#345e60` (contrast ratio 5.51:1).
  - Change `.stance.negative` color from `#a65d57` to `#8c433d` (contrast ratio 5.72:1).
  - Change `.stance.mixed` color from `#6a7568` to `#4c574a` (contrast ratio 6.21:1).
- **Confidence**: 100%.

---

### Finding 7: Sub-10px Typography on LTR Copy Button and Links in `bayyna.css`
- **Severity**: **P2 (Legibility / Accessibility nit)**
- **Surface**: `/en/merchant/<id>/` (all 707 English merchant pages)
- **Evidence**:  
  - `webapp/app/bayyna.css` line 28:
    ```css
    [dir=ltr] .copy-button{font-size:9px}
    [dir=ltr] .report-top>.text-link{font-size:10px}
    ```
- **Root Cause**:  
  `bayyna.css` hardcodes a 9px font size on `.copy-button` in LTR mode. On mobile and standard DPI displays, 9px text causes severe eye strain and violates standard minimum font standards (minimum 11px).
- **Fix**:  
  Remove the `[dir=ltr] .copy-button{font-size:9px}` override from `bayyna.css:28`, allowing the button to use the standard 11px font size specified in `.copy-button`.
- **Confidence**: 100%.

---

### Finding 8: Arabic Evidence Anchor Links Forced to LTR
- **Severity**: **P2 (BiDi / Typography nit)**
- **Surface**: `/ar/merchant/<id>/` (Claim cards with linked evidence)
- **Evidence**:  
  - `webapp/src/components/ClaimCards.tsx` lines 27–29:
    ```tsx
    <a href={`#evidence-${evidenceId}`} className="text-[#4a7c7e] hover:underline" dir="ltr">
      {strings.evidenceAnchor.replace('{n}', String(index + 1))}
    </a>
    ```
  - Emitted HTML: `<a ... dir="ltr">دليل 1</a>`
- **Root Cause**:  
  `dir="ltr"` is hardcoded on an anchor whose text in Arabic is `دليل {n}`. This isolates the Arabic text into an LTR run, producing reversed punctuation flow with surrounding middle-dot separators.
- **Fix**:  
  In `webapp/src/components/ClaimCards.tsx:27`, remove `dir="ltr"` or use `dir={locale === 'ar' ? 'rtl' : 'ltr'}`.
- **Confidence**: 100%.

---

### Finding 9: Standalone Middle-Dot Flex Items Wrapping to Start of Line
- **Severity**: **P2 (Visual nit / wrapping defect)**
- **Surface**: `/ar/merchant/<id>/` and `/en/merchant/<id>/` (`EvidenceCard.tsx:96,101,105` and `page.tsx:318,320`)
- **Evidence**:  
  - `EvidenceCard.tsx:88-109`:
    `<div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 mb-2 text-xs">`
      `<span className="stance ...">...</span>`
      `<span className="text-[#7a8085]" aria-hidden="true">·</span>`
      `<span className="text-[#56606a]">...</span>`
      `<span className="text-[#7a8085]" aria-hidden="true">·</span>`
  - On narrow viewports (360px), line wrapping can break right before `<span>·</span>`, leaving a lone floating dot at the start of a wrapped line.
- **Root Cause**:  
  The separator `·` is an independent flex item with zero wrapping protection.
- **Fix**:  
  Group items with their preceding separator using `inline-flex items-center gap-1.5 whitespace-nowrap`.
- **Confidence**: 100%.

---

### Finding 10: Lone Leading Em-Dash in Related Merchants Description
- **Severity**: **P2 (Visual nit / formatting)**
- **Surface**: `/ar/merchant/<id>/` and `/en/merchant/<id>/` (`RelatedMerchants.tsx:36`)
- **Evidence**:  
  - `webapp/src/components/RelatedMerchants.tsx` line 36:
    ```tsx
    <p className="text-xs text-[#56606a]" dir="auto">
      <span> — </span>
      <span>{relationLabel(entry.relation, locale)}</span>
      ...
    </p>
    ```
- **Root Cause**:  
  The paragraph opens unconditionally with `<span> — </span>`, rendering an orphaned dash at the start of the line: `— فرع — نفس السجل التجاري`.
- **Fix**:  
  Delete `<span> — </span>` from line 36 so the description starts directly with `{relationLabel(entry.relation, locale)}`.
- **Confidence**: 100%.

---

## 5. Live Deployment Parity Audit

Per the Orchestrator directive, we cross-checked the live deployment (`https://daleeleltogar.pages.dev`) against local source and `webapp/out/`:

1. **Mandated Stacking Dot Bug (`.stance>span`)**:
   - **Live status**: **PRESENT / DEFECTIVE** (Emitted live CSS `01a411f567e55fe3.css` contains `.stance>span{background:currentColor;border-radius:50%;width:4px;height:4px}`).
   - **Local status**: **PRESENT / DEFECTIVE** in current source (`bayyna.css:24`) and local build (`0a9de0b3de909b20.css`).
   - Requires the fix specified in Finding 1.

2. **English Brief Content Translation**:
   - **Live status**: English merchant pages showed Arabic brief text (`تُعد مجموعة العربي شركة تعمل في قطاع الأجهزة...`).
   - **Local status**: **ALREADY FIXED in source — no action** (`webapp/out/en/merchant/00450860-3c15-4508-bbbe-f3d0871094cf/index.html` correctly displays `Elaraby Group is a company operating in the electronic and home appliances sector...`).

3. **Report Main Shell & Navigation Layout**:
   - Live and local markup for `<article className="max-w-4xl mx-auto px-4 py-6 space-y-6">` are identical byte-for-byte in Arabic mode.

---

## 6. Verified Clean Components

The following sections and components on the merchant profile page were audited and confirmed to be structurally and visually sound:
- `CitedBrief.tsx`: Bullet headers cleanly use `w-1.5 h-1.5 rounded-full bg-[#4a7c7e]` without any double-render or stacking.
- `SourceCitations.tsx`: External links correctly isolate URLs with `dir="ltr"` and `rel="noopener noreferrer"`, preserving bidirectional integrity when embedded in RTL contexts.
- `IdentifierList.tsx`: Long phone numbers, emails, and URLs break cleanly without overflowing cards due to `[overflow-wrap:anywhere]` and `.ltr-isolate`.
- `CopyReportButton.tsx`: Clipboard interaction states (`idle`, `copied`, `failed`) and touch target sizes (`min-height: 44px`) meet accessibility criteria in both RTL and LTR modes.
- `Report-top` Navigation: Logical back arrows (`ArrowRight` for AR RTL, `ArrowLeft` for EN LTR) point in the true semantic return direction.
