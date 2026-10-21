# Skill 01 — Global Layout, Design Tokens & Home Page Standards

> **Audit Target:** Global Chrome (`SiteHeader`, `SiteFooter`, `ShellChrome`, `LanguageSwitcher`, `SearchBox`) and Home Page (`/ar/` and `/en/`).  
> **Source Files:**  
> - Stylesheets: `webapp/app/bayyna.css`, `webapp/app/globals.css`  
> - Components: `webapp/src/components/{ShellChrome,SiteHeader,SiteFooterContent,LanguageSwitcher,SearchBox,SearchBoxFromParams}.tsx`  
> - Route Pages: `webapp/app/[locale]/page.tsx`, `webapp/app/[locale]/layout.tsx`, `webapp/app/layout.tsx`  
> **Status:** Read-only audit & engineering specification. **Zero source edits performed.**  
> **Ground Truth Verification:** Audited against local source, fresh local export artifacts (`webapp/out/ar/index.html`, `webapp/out/en/index.html`), and live deployment snapshots (`/tmp/mi-audit/live/*-home.html`).

---

## 1. Design Token Benchmark (Home as Baseline Standard)

The design system is **Bayyna** (بيّنة), an editorial, research-first design standard rooted in the physical aesthetic of legal/governmental dossiers, archival paper, and dark slate ink. Meaning is strictly text-carried; color is functional or decorative only.

### 1.1 Palette & Color System

| Token Name | CSS Variable | Hex Value | Role / Usage |
|---|---|---|---|
| **Canvas Background** | `--bg` | `#f5f3ef` | Base background for the main viewport canvas |
| **Paper Surface** | `--paper` | `#fdfcf9` | Primary card background, index panel background |
| **White Surface** | `--white` | `#ffffff` | Elevated input fields (`.search-form`), active search hits |
| **Slate Ink** | `--ink` | `#2a3441` | Primary text color, brand mark, dark statement cards |
| **Muted Grey** | `--muted` | `#7a8085` | Secondary text, status indicators, meta fields |
| **Border Tone** | `--border` | `#e4e3de` | Dividers, card strokes, header/footer separation |
| **Teal Accent** | `--teal` | `#4a7c7e` | Focus outlines, link hovers, active evidence stance |
| **Brick Red** | `--brick` | `#a65d57` | Negative stance indicators, validation errors |
| **Sidebar Tint** | — | `#faf9f6` | Fixed desktop sidebar background |
| **Topbar Tint** | — | `#f9f8f5` | Fixed desktop topbar header background |
| **Pill Background** | — | `#eceee8` | Search example pills (`.recent-link`), data notice box |
| **Chip Background** | — | `#f9f8f4` | Filter button chip surface |
| **Selection Tint** | — | `#dbe7e4` | Text selection highlight (`::selection`) |

---

### 1.2 Button Variants & Interactive Controls Contrast Matrix

Evaluated under WCAG 2.1 / 2.2 AA standards:
- **Normal Text** (< 18pt / 24px regular, < 14pt / 18.66px bold): **Minimum 4.5:1**
- **Large Text** (≥ 18pt / 24px regular, ≥ 14pt / 18.66px bold): **Minimum 3.0:1**
- **UI Components & Graphical Boundaries**: **Minimum 3.0:1**

| Component / Element | Selector | Foreground | Background | Contrast Ratio | WCAG AA Status | Notes |
|---|---|---|---|---|---|---|
| **Primary Button (Search)** | `.search-submit` | `#f9f9f5` | `#2a3441` | **11.94:1** | **PASS** | Default state; 13px 500 weight |
| **Primary Button (Hover)** | `.search-submit:hover` | `#f9f9f5` | `#3d4a5c` | **8.53:1** | **PASS** | Dark slate hover state |
| **Secondary Button** | `.secondary-button` | `#627659` | `#f3f5ee` | **4.64:1** | **PASS** | Used in empty search actions |
| **Secondary Button (Hover)** | `.secondary-button:hover` | `#627659` | `#e5ecdd` | **4.01:1** | **PASS (Large/UI)** | Fails 4.5:1 for 12px text |
| **Search Filter Chip (Idle)** | `.search-types button` | `#657466` | `#f9f8f4` | **4.66:1** | **PASS** | Overridden in line 42 (`#657466`) |
| **Search Filter Chip (Active)**| `.search-types button.selected`| `#4e6b5e` | `#e7ece5` | **4.88:1** | **PASS** | Active toggle state |
| **Search Example Pill** | `.recent-link` | `#2a3441` | `#eceee8` | **10.78:1** | **PASS** | Added in current code |
| **Search Example Pill (Hover)**| `.recent-link:hover` | `#4a7c7e` | `#e3e8df` | **3.77:1** | **FAIL (4.5:1)** | Fails 4.5:1 for 11px text |
| **Text Link** | `.text-link` | `#526d65` | `#f5f3ef` | **5.07:1** | **PASS** | 11px/12px medium weight |
| **Text Link (Hover)** | `.text-link:hover` | `#273f38` | `#f5f3ef` | **10.22:1** | **PASS** | Deep evergreen hover |
| **Dark Card Link** | `.principle-card .text-link` | `#e2e8e3` | `#2a3441` | **10.14:1** | **PASS** | On dark slate background |
| **Language Toggle** | `.language-button` | `#67717b` | `#f9f8f5` | **4.68:1** | **PASS** | Header switcher link |
| **Nav Item (Inactive)** | `.nav-item` | `#69717a` | `#faf9f6` | **4.70:1** | **PASS** | Sidebar link idle |
| **Nav Item (Active)** | `.nav-item.active` | `#304740` | `#eaece7` | **8.40:1** | **PASS** | Deep green active state |
| **Copy Report Button** | `.copy-button` | `#2a3441` | `#fdfcf9` | **12.29:1** | **PASS** | Paper background |
| **Pagination Item** | `.pagination-item` | `#2a3441` | `#fdfcf9` | **12.29:1** | **PASS** | Bordered page button |
| **Pagination Active** | `.pagination-active` | `#f8f8f3` | `#2a3441` | **11.94:1** | **PASS** | Inverted slate block |
| **Text Selection** | `::selection` | `#2a3441` | `#dbe7e4` | **9.94:1** | **PASS** | Global browser selection |

---

### 1.3 Card Styles Specification

| Card Name | Selector | Surface Background | Border | Padding | Hover State | Elevation / Shadow |
|---|---|---|---|---|---|---|
| **Step Card (Home)** | `.step-card` | `#fdfcf9` (`--paper`) | `1px solid var(--border)` | `16px 19px 19px` (desktop), `16px` (mobile grid) | bg: `#ffffff`, border: `#c4cfc5` | None |
| **Directory Preview** | `.directory-preview` | `#fdfcf9` (`--paper`) | `1px solid var(--border)` | Heading: `19px 21px 17px`, Body: `26px 25px 29px` | None | None |
| **Statement Card** | `.principle-card` | `#2a3441` (`--ink`) | `1px solid #2a3441` | `22px 24px` (desktop), `24px` (mobile) | None | None (nested SVG orb rings) |
| **Directory Hit Row** | `.hit-card` | `#ffffff` (`--white`)| `border-bottom: 1px solid var(--border)` | `18px 23px` | bg: `#fafaf6`, title: `var(--teal)` | None |
| **Merchant Card** | `.merchant-card` | `#fdfcf9` (`--paper`) | `1px solid #e4e3de` | `16px 18px` (<640px), `19px 21px` (≥640px) | border: `#ccd2ce`, bg: `#fafaf6` | None |
| **Search Empty Panel**| `.search-empty-panel` | `#fdfcf9` (`--paper`) | `1px solid var(--border)` | `46px 30px` (desktop), `32px 20px` (mobile) | None | None |
| **Notice Box** | `.data-notice` | `#eceee8` | `1px solid #dfe3d9` | `17px 20px` (desktop), `16px` (mobile) | None | None |

---

### 1.4 Typography Scale (Responsive & Bidi)

Primary Typefaces:
- **Arabic (Default RTL):** `'IBM Plex Sans Arabic', sans-serif` (weights 400, 500, 600, 700)
- **English (LTR):** `Inter, 'IBM Plex Sans Arabic', sans-serif` (weights 400, 500, 600)

| Level / Role | Desktop (Base / ≥1450px) | Laptop (901px–1150px) | Tablet (651px–900px) | Mobile (≤650px) | LTR ([dir=ltr]) Adjustments | Line Height | Weight |
|---|---|---|---|---|---|---|---|
| **H1 (Home Hero)** | `30px` / `32px` | `27px` | `29px` | `27px` / `26px` | `30px` (max-w: 560px), mobile `28px` | `1.65` (AR) / `1.4` (LTR) | `500` |
| **H1 (Page Heading)** | `26px` | `26px` | `26px` | `24px` / `23px` (LTR) | `26px` (line-height: `1.5`) | `1.7` (AR) / `1.5` (LTR) | `500` |
| **H2 (Section Title)**| `17px` / `18px` | `16px` | `18px` | `16px` | `16px` (laptop `14px`, mobile `17px`) | `1.8` | `500` |
| **H2 (Statement Card)**| `17px` / `19px` | `17px` | `19px` | `20px` | `18px` (line-height: `1.55`) | `1.8` | `500` |
| **H3 (Card Title)** | `13px` / `14px` | `13px` | `14px` | `14px` | `12px` / `13px` | `1.5` | `500` |
| **Body (Hero Copy)** | `14px` | `12px` | `14px` | `13px` / `12px` | `13px` (desktop), `12px` (mobile) | `2.05`–`2.1` (AR) / `1.9` (LTR) | `400` |
| **Body (Card Copy)** | `12px` | `12px` | `12px` | `12px` / `11px` | `11px` (desktop), `11px` (mobile) | `1.95` (AR) / `1.8` (LTR) | `400` |
| **Eyebrow / Kicker** | `11px` / `10px` | `11px` | `11px` | `10px` / `9px` | `9px` (tracking: `0.65px`), mob `8px` | `1.8` | `500` |
| **Micro Caption / Dot**| `9px`–`11px` | `9px`–`10px` | `10px`–`11px` | `8px`–`10px` | `7px`–`9px` | `1.7`–`2.0` | `400` |

---

### 1.5 Layout Dimensions & Section Spacing Scale

| Layout Region | Breakpoint Tier | Dimensions / Paddings | Gaps / Margins |
|---|---|---|---|
| **Sidebar Width** | Desktop ≥1450px | `width: 245px` (fixed) | `border-inline-end: 1px solid var(--border)` |
| | Desktop 1151px–1449px | `width: 228px` (fixed) | `border-inline-end: 1px solid var(--border)` |
| | Laptop 901px–1150px | `width: 205px` (fixed) | `border-inline-end: 1px solid var(--border)` |
| | Mobile / Tablet ≤900px | `width: 0px` (slide-over `250px` when active) | Overlay z-index 45 |
| **Topbar Height** | Universal (All widths) | `height: 69px; min-height: 69px` | `border-bottom: 1px solid var(--border)` |
| **Topbar Inset** | Desktop ≥1450px | `padding-inline: 57px` | `gap: 20px` |
| | Desktop 1151px–1449px | `padding-inline: 43px` | `gap: 20px` |
| | Laptop 901px–1150px | `padding-inline: 29px` | `gap: 20px` |
| | Tablet 651px–900px | `padding-inline: 27px` | `gap: 20px` |
| | Mobile ≤650px | `padding-inline: 20px` | `gap: 12px` |
| **Main Content Container** | Desktop ≥1450px | `max-width: 1200px; padding: 43px 57px 34px` | `margin-inline: auto` |
| | Desktop 1151px–1449px | `max-width: 1200px; padding: 35px 43px 34px` | `margin-inline: auto` |
| | Laptop 901px–1150px | `max-width: 1200px; padding: 35px 29px 34px` | `margin-inline: auto` |
| | Tablet 651px–900px | `padding: 31px 30px` | Full width |
| | Mobile ≤650px | `padding: 28px 20px 27px` | Full width |
| **Hero Section** | Desktop | `padding-block: 4px 27px; border-bottom: 1px` | `min-height: 192px; margin-bottom: 24px` |
| | Mobile ≤650px | `padding-block: 2px 25px; border-bottom: 1px` | `min-height: 0; margin-bottom: 23px` |
| **Process Section** | Desktop | `padding-block: 25px 27px` | Grid gap: `13px` |
| | Mobile ≤650px | `padding-block: 24px` | Grid gap: `10px` |
| **Home Bottom Grid** | Desktop | `grid-template-columns: minmax(0, 1.77fr) minmax(0, 1fr)` | Gap: `18px` |
| | Mobile ≤650px | `grid-template-columns: 1fr` | Gap: `17px` |

---

### 1.6 Focus Ring & Accessibility Standards

- **Interactive Elements Focus Ring:** `button:focus-visible, a:focus-visible, select:focus-visible { outline: 2px solid #4a7c7e; outline-offset: 4px; }`
  - Outline color: `#4a7c7e` on `#f5f3ef` produces **4.23:1** contrast against page canvas (exceeds WCAG 2.2 SC 2.4.11 / 2.4.13 requirement of ≥ 3:1).
- **Skip Link:** Fixed position `.skip-link { position: fixed; inset-block-start: -80px; inset-inline-start: 245px; background: var(--ink); color: white; padding: 12px 22px; z-index: 100; }`. On focus: `inset-block-start: 10px;`. Mobile: `inset-inline-start: 16px;`.
- **Motion Reduction:** `@media(prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; transition: none !important; } }`.

---

## 2. Audit Findings (Defects & Architectural Gaps)

### 1. Footer Widescreen Alignment Shear with Main Content
- **Severity:** P1 (readable-but-wrong)
- **Surface:** Global Chrome (All routes `/[locale]/*`, `ar` & `en`), viewports ≥ 1450px and widescreen displays (1600px+).
- **Evidence:**
  - CSS source: `webapp/app/bayyna.css:14`:  
    `.footer { max-width: 1200px; width: calc(100% - 86px); margin-inline: auto; border-top: 1px solid var(--border); padding-block: 18px 21px; display: flex; ... }`
  - CSS media query: `webapp/app/bayyna.css:29`:  
    `@media(min-width: 1450px) { ... .footer { width: calc(100% - 114px); } }`
  - Container source: `webapp/app/bayyna.css:14, 29`:  
    `.main-content { width: 100%; max-width: 1200px; padding: 35px 43px 34px; margin-inline: auto; }`  
    `@media(min-width: 1450px) { .main-content { padding-inline: 57px; } }`
- **Root cause:**
  - Under `box-sizing: border-box`, `.main-content` clamps to a total outer box of `1200px`. Its text and card boundaries are indented by `padding-inline: 57px`, meaning the actual content column spans `1200 - 114 = 1086px`.
  - `.footer` uses a width calculation `width: calc(100% - 114px)` combined with `max-width: 1200px`, but specifies **zero** horizontal padding (`padding-inline`).
  - On a 1600px display (with 245px sidebar, leaving a 1355px `main-shell`):
    - `.main-content` centers within 1355px (outer margins = `(1355 - 1200) / 2 = 77.5px`). Its text begins at `77.5 + 57 = 134.5px` from the main-shell edge.
    - `.footer` calculation `calc(1355px - 114px) = 1241px` is clamped by `max-width: 1200px` to `1200px` and centered (`margin = 77.5px`). Because `.footer` lacks `padding-inline`, its text begins at `77.5px` from the main-shell edge.
    - **Result:** The footer text and brand mark extend `57px` farther outward than the main content on both sides, creating an awkward visual stair-step misalignment on large screens.
- **Fix:**
  Harmonize `.footer`'s box model with `.main-content` by replacing `width: calc(...)` with standard container padding:
  ```css
  /* In bayyna.css line 14: replace width: calc(100% - 86px) */
  .footer {
    width: 100%;
    max-width: 1200px;
    margin-inline: auto;
    border-top: 1px solid var(--border);
    padding-block: 18px 21px;
    padding-inline: 43px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    color: #949793;
    font-size: 10px;
    box-sizing: border-box;
  }

  /* In media queries: replace width: calc() with padding-inline */
  @media(min-width: 1450px) { .footer { padding-inline: 57px; width: 100%; } }
  @media(min-width: 901px) and (max-width: 1150px) { .footer { padding-inline: 29px; width: 100%; } }
  @media(max-width: 900px) { .footer { padding-inline: 30px; width: 100%; } }
  @media(max-width: 650px) { .footer { padding-inline: 20px; width: 100%; } }
  ```
- **Confidence:** Very High (100% geometric proof).

---

### 2. Mobile Section Heading Collision & Line Wrapping in Arabic (RTL)
- **Severity:** P1 (readable-but-wrong)
- **Surface:** `/[locale]/` Home page (`/ar/`), viewports ≤ 650px (particularly 320px–375px mobile screens).
- **Evidence:**
  - CSS source: `webapp/app/bayyna.css:20, 32, 68`:
    ```css
    /* line 20 */ .section-heading{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:18px}
    /* line 32 */ @media(max-width:650px){.section-heading{align-items:flex-start;gap:10px;margin-bottom:17px}.section-heading h2{font-size:16px;max-width:230px;line-height:1.85}.section-heading>.text-link{margin-top:28px;font-size:9px;gap:4px}}
    /* line 68 */ @media(max-width:650px){.section-heading>.text-link{font-size:10px;white-space:normal;max-width:100px}}
    ```
  - LTR override in `bayyna.css:32, 78`:
    ```css
    [dir=ltr] .section-heading{display:block}
    [dir=ltr] .section-heading>.text-link{margin-top:9px;font-size:10px;max-width:none;white-space:nowrap}
    ```
  - HTML source: `webapp/app/[locale]/page.tsx:130-151`
- **Root cause:**
  - In English (`[dir=ltr]`), the developer noticed the collision and converted `.section-heading` to `display: block`, allowing the text-link to sit cleanly below the heading with `margin-top: 9px`.
  - In Arabic (`[dir=rtl]`), `.section-heading` remained a flex row (`display: flex; justify-content: space-between; align-items: flex-start; gap: 10px`).
  - On a 320px screen (`main-content` padding is 20px each side, leaving 280px available):
    - Heading `h2` has `max-width: 230px`.
    - Text link has `max-width: 100px`.
    - Total required width: `230 + 100 + 10 (gap) = 340px > 280px`.
    - The flex items compress each other, and the Arabic string «كيف يعمل دليل التجار» (20 characters) is constrained to a 100px box with `white-space: normal`, forcing it to wrap into 3 awkward vertical fragments («كيف يعمل / دليل / التجار») while pushed down by an unnatural `margin-top: 28px`.
- **Fix:**
  Apply the block/stacked layout uniformly to Arabic on mobile (matching English):
  ```css
  /* In bayyna.css under @media(max-width:650px) */
  .section-heading {
    display: block;
    margin-bottom: 17px;
  }
  .section-heading h2 {
    font-size: 16px;
    max-width: none;
    line-height: 1.6;
  }
  .section-heading > .text-link {
    display: inline-flex;
    margin-top: 10px;
    font-size: 11px;
    max-width: none;
    white-space: nowrap;
    gap: 6px;
  }
  ```
- **Confidence:** Very High (100% verified against computed layout).

---

### 3. Sub-44px Tap Targets across Global Chrome & Home Interactive Elements
- **Severity:** P1 (readable-but-wrong / mobile ergonomics)
- **Surface:** Global Chrome (Topbar, Language Switcher, Mobile Menu Trigger) & Home Search Controls (`ar` & `en`).
- **Evidence:**
  - `.language-button`:
    - Desktop: `bayyna.css:14, 39`: `padding: 2px 0; padding-inline-start: 21px; min-height: 30px;` (height = **30px**).
    - Mobile: `bayyna.css:74`: `@media(max-width:650px) { .language-button { min-height: 40px; font-size: 11px; } }` (height = **40px**).
  - `.mobile-menu-button`:
    - Tablet (651px–900px): `bayyna.css:31`: `padding: 5px;` with 22px icon (size = **32×32px**).
    - Mobile (≤650px): `bayyna.css:75`: `min-width: 36px; min-height: 40px;` (size = **36×40px**).
  - `.search-types button` (Search chips):
    - Desktop: `bayyna.css:16, 42`: `padding: 3px 8px; padding-block: 4px;` (height = **~29px**).
    - Mobile: `bayyna.css:69`: `@media(max-width:650px) { .search-types button { min-height: 31px; } }` (height = **31px**).
  - `.clear-input` (Search query reset button):
    - `bayyna.css:16`: `padding: 5px;` with 16px Lucide X icon (computed size = **26×26px**).
  - `.search-submit` (Mobile):
    - `bayyna.css:32`: `min-width: 69px; min-height: 43px;` (**43px**, 1px short of 44px).
  - `.text-link`:
    - `bayyna.css:14`: `display: inline-flex; font-size: 11px/12px;` with no touch padding (computed height = **~18px**).
  - Footer Privacy Link:
    - `webapp/src/components/SiteFooterContent.tsx:48`: inline text link without touch-target padding.
- **Root cause:**
  - Controls were visually styled for tight desktop editorial presentation without establishing an explicit touch bounding box (`min-height: 44px; min-width: 44px;`) or touch pseudo-elements (`::after` hit area) as recommended by WCAG 2.5.5 (Target Size) and Apple/Google Human Interface Guidelines.
- **Fix:**
  Ensure minimum 44px hit bounds on touch viewports without disrupting typography:
  ```css
  /* Language switcher: min-height 44px */
  .language-button {
    min-height: 44px;
    display: inline-flex;
    align-items: center;
  }

  /* Mobile menu button: 44x44px minimum */
  .mobile-menu-button {
    min-width: 44px;
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* Search chips: expand touch target on touch viewports */
  @media(max-width: 900px) {
    .search-types button {
      min-height: 38px;
      padding: 6px 12px;
    }
  }

  /* Search submit button on mobile */
  @media(max-width: 650px) {
    .search-submit {
      min-height: 44px;
    }
  }

  /* Clear button: expanded invisible touch target */
  .clear-input {
    position: relative;
    padding: 10px;
    min-width: 44px;
    min-height: 44px;
    align-items: center;
    justify-content: center;
  }
  ```
- **Confidence:** Very High (100% verified against CSS metrics).

---

### 4. Static Export HTML Root `lang="ar"` & `dir="rtl"` Emitted on English Routes
- **Severity:** P1 (readable-but-wrong / SEO / Accessibility)
- **Surface:** All English static pages (`/en/`, `/en/merchants/`, `/en/privacy/`, etc.).
- **Evidence:**
  - Emitted HTML: `webapp/out/en/index.html:1`:  
    `<!DOCTYPE html><!--...--><html lang="ar" dir="rtl"><head>...`
  - Root Layout: `webapp/app/layout.tsx:24`:  
    `<html lang="ar" dir="rtl" suppressHydrationWarning>`
  - Inline Client Script: `webapp/app/layout.tsx:28-32`:  
    `"(function(){var s=location.pathname.split('/')[1];var l=s==='en'?'en':'ar';var d=document.documentElement;d.lang=l;d.dir=l==='en'?'ltr':'rtl';})();"`
  - Font Selector: `webapp/app/bayyna.css:10`:  
    `[lang=en] body{font-family:Inter,'IBM Plex Sans Arabic',sans-serif}`
  - Shell Container: `webapp/src/components/ShellChrome.tsx:146`:  
    `<div className="app-shell" dir={DIR_FOR[locale]}>`
- **Root cause:**
  - Next.js root layout `app/layout.tsx` is placed outside the `[locale]` dynamic route directory. Because it does not receive route params at static export time, it hardcodes `lang="ar" dir="rtl"` for all exported pages.
  - Although the inline script mutates `document.documentElement` at parse time on client browsers, web scrapers, search engine crawlers (Googlebot, Bingbot), social card generators, screen readers parsing raw HTML, and users with JavaScript disabled receive an English document with root Arabic/RTL semantics.
  - Furthermore, `ShellChrome.tsx` sets `dir="ltr"` on `.app-shell`, but **omits** `lang="en"`. Therefore, the CSS rule `[lang=en] body` does not match statically, causing English text to initially render with `'IBM Plex Sans Arabic'` until client-side JS executes.
- **Fix:**
  1. Add `lang={locale}` to `ShellChrome.tsx:146`:
     ```tsx
     <div className="app-shell" dir={DIR_FOR[locale]} lang={locale}>
     ```
  2. Broaden font family selector in `bayyna.css:10`:
     ```css
     :root[lang=en] body, [dir=ltr] {
       font-family: Inter, 'IBM Plex Sans Arabic', sans-serif;
     }
     ```
  3. **Architectural Fix (Merge Root & Locale Layouts):** Standardize Next.js App Router i18n by moving `<html>` and `<body>` into `app/[locale]/layout.tsx`, deleting `app/layout.tsx`. Because `app/[locale]/layout.tsx` has access to `params.locale`, Next.js static export generates native `<html lang="en" dir="ltr">` for all English pages and `<html lang="ar" dir="rtl">` for all Arabic pages.
- **Confidence:** Very High (100% verified in static export files).

---

### 5. Search Input Focus Ring Contrast Failure under WCAG 2.2 SC 2.4.13
- **Severity:** P2 (nit / accessibility refinement)
- **Surface:** Home Page (`/ar/`, `/en/`) & Search Page (`SearchBox` component).
- **Evidence:**
  - CSS source: `webapp/app/bayyna.css:10`: `input:focus { outline: none; }`
  - CSS source: `webapp/app/bayyna.css:16`:  
    `.search-form:focus-within { border-color: #6e9287; box-shadow: 0 0 0 3px #4a7c7e0d; }`
  - Unfocused border: `#ccd2ce` on `#f5f3ef` = **1.39:1**
  - Focused border: `#6e9287` on `#f5f3ef` = **3.09:1**
  - Contrast ratio between unfocused (`#ccd2ce`) and focused (`#6e9287`) border states: **2.23:1**.
  - Box-shadow tint: `#4a7c7e0d` has alpha `0x0d / 0xff = 5.1%`, making it imperceptible on standard monitors.
- **Root cause:**
  - WCAG 2.2 Success Criterion 2.4.13 (Focus Appearance - Level AA) requires focus indicators to achieve a contrast ratio of at least **3.0:1** between the focused and unfocused states of the component, or provide a 3:1 focus ring against adjacent colors.
  - The contrast change from `#ccd2ce` to `#6e9287` is only **2.23:1**, failing the change-of-contrast requirement.
- **Fix:**
  Strengthen the focus-within border and ring to use `--teal` (`#4a7c7e`, which has 4.23:1 contrast against canvas `#f5f3ef`) with perceptible opacity:
  ```css
  /* In bayyna.css line 16 */
  .search-form:focus-within {
    border-color: #4a7c7e;
    box-shadow: 0 0 0 3px rgba(74, 124, 126, 0.20);
  }
  ```
- **Confidence:** Very High (Computed contrast 4.23:1 vs 2.23:1).

---

### 6. Bidi Direction Inversion on Phone Sample Pill in RTL
- **Severity:** P2 (readable-but-wrong)
- **Surface:** `/ar/` Home page (Recent search pills).
- **Evidence:**
  - Component source: `webapp/app/[locale]/page.tsx:123`:  
    `<bdi dir="auto">{example}</bdi>`
  - String definition: `webapp/src/lib/i18n.ts:82`:  
    `examplePhoneSample: '+201000000000'`
  - Existing utility in `webapp/app/globals.css:11-14`:
    ```css
    .ltr-isolate {
      direction: ltr;
      unicode-bidi: isolate;
    }
    ```
- **Root cause:**
  - Under the Unicode Bidirectional Algorithm (UAX #9) and HTML5 specification, `dir="auto"` resolves direction based on the first strong character (type `L`, `AL`, or `R`).
  - The string `+201000000000` consists entirely of European Number Separators (`+`) and European Numbers (`0-9`). It contains **zero** strong characters.
  - When no strong characters exist, `dir="auto"` defaults to the direction of the surrounding context (`rtl` on the Arabic page).
  - In an RTL context, a leading `+` adjacent to neutral/weak numbers is parsed as trailing punctuation, causing the phone number to render visually with the plus sign flipped to the right: `201000000000+`.
- **Fix:**
  Enforce LTR isolation on telephone and URL samples:
  ```tsx
  /* In webapp/app/[locale]/page.tsx line 123 */
  <bdi
    dir={/^[+\d]|https?:/i.test(example) ? 'ltr' : 'auto'}
    className={/^[+\d]|https?:/i.test(example) ? 'ltr-isolate' : undefined}
  >
    {example}
  </bdi>
  ```
- **Confidence:** Very High (Standard Unicode Bidi behavior).

---

### 7. Contrast Deficiencies across Secondary / Caption Muted Tokens
- **Severity:** P2 (accessibility refinement)
- **Surface:** Global Chrome & Home page secondary labels, breadcrumbs, and footers.
- **Evidence:**
  - `.section-kicker`: `#7b8378` on `#f5f3ef` = **3.54:1** (fails 4.5:1 for 10px text).
  - `.search-by`: `#737d75` on `#f5f3ef` = **3.85:1** (fails 4.5:1 for 11px text).
  - `.footer`: `#758073` on `#f5f3ef` = **3.72:1** (fails 4.5:1 for 11px text).
  - `.footer-mark`: `#9ba29a` on `#f5f3ef` = **2.36:1** (fails 3.0:1 for graphical branding text).
  - `.hero-copy > p`: `#707878` on `#f5f3ef` = **4.08:1** (fails 4.5:1 for 14px text).
  - `.step-card p`: `#737e70` on `#fdfcf9` = **4.14:1** (fails 4.5:1 for 12px text).
  - `.nav-label`: `#757d79` on `#faf9f6` = **4.02:1** (fails 4.5:1 for 11px text).
  - `.breadcrumb` link: `#717d75` on `#f9f8f5` = **4.04:1** (fails 4.5:1 for 12px text).
  - `.independent-label`: `#717d75` on `#f9f8f5` = **4.04:1** (fails 4.5:1 for 11px text).
  - `.recent-link:hover`: `#4a7c7e` on `#e3e8df` = **3.77:1** (fails 4.5:1 for 11px text).
- **Root cause:**
  - Editorial palette tuning used softened olive-grey tints (`#707878`–`#7b8378`) that produce 3.5:1–4.1:1 contrast. Under WCAG 2.1 AA, non-large body and label text (< 18pt / 24px) requires 4.5:1.
- **Fix:**
  Darken the muted color scale slightly to achieve ≥ 4.6:1 contrast without sacrificing the soft archival tone:
  - Replace `#707878` and `#737e70` with `#5e6865` (contrast **5.52:1** on `#f5f3ef`, **5.97:1** on `#fdfcf9`).
  - Replace `#757d79` and `#7b8378` with `#5e6662` (contrast **5.08:1** on `#f5f3ef`).
  - Replace footer mark `#9ba29a` with `#6f7a6e` (contrast **4.25:1** on `#f5f3ef`, exceeding 3:1).
  - Replace `.recent-link:hover` text color with `#273f38` (contrast **9.45:1** on `#e3e8df`).
- **Confidence:** Very High (Mathematically proven color formulas).

---

### 8. Cramped 3-Column Grid on Tablet Portrait Viewports (651px–820px)
- **Severity:** P2 (layout refinement)
- **Surface:** `/[locale]/` Home page (`.steps-grid` and `.home-bottom`), `ar` & `en`.
- **Evidence:**
  - `webapp/app/bayyna.css:20`:  
    `.steps-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 13px; }`  
    `.home-bottom { display: grid; grid-template-columns: minmax(0, 1.77fr) minmax(0, 1fr); gap: 18px; }`
  - Breakpoint in `bayyna.css:31`: `@media(max-width: 900px)` hides sidebar and frees canvas width, but leaves `.steps-grid` in 3 columns.
  - Breakpoint in `bayyna.css:32`: `@media(max-width: 650px)` collapses `.steps-grid` to 1 column.
- **Root cause:**
  - On a 768px tablet (iPad portrait) or 700px viewport, available content width inside `.main-content` is ~648px.
  - In a 3-column grid with 13px gaps, each `.step-card` is only `(648 - 26) / 3 = 207px` wide. Deducting horizontal padding of `19px + 19px = 38px`, the inner text width is only **169px**.
  - In Arabic, the 88-character explanation («اطّلع على البيانات ومصادرها وتواريخها، وما يدعمها أو يوثقها في سياقها الحقيقي.») wraps into 8–10 narrow lines.
  - Simultaneously, `.home-bottom` splits into 1.77fr / 1fr, compressing the `.principle-card` down to ~220px.
- **Fix:**
  Introduce an intermediate 2-column tablet layout between 651px and 820px:
  ```css
  /* In bayyna.css under @media(max-width: 820px) */
  @media(max-width: 820px) {
    .steps-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .home-bottom {
      grid-template-columns: 1fr;
    }
  }
  @media(max-width: 600px) {
    .steps-grid {
      grid-template-columns: 1fr;
    }
  }
  ```
- **Confidence:** High.

---

### 9. [ALREADY FIXED in source — no action] Live Deployment Missing `.recent-link` Styling
- **Severity:** P1 on Live / **ALREADY FIXED in source**
- **Surface:** Live deployment (https://daleeleltogar.pages.dev/ar/ and `/en/`).
- **Evidence:**
  - Live CSS bundle `/_next/static/css/01a411f567e55fe3.css` contains zero references to `.recent-link`.
  - On the live site, recent search sample pills render as unstyled, default browser anchor elements without pill backgrounds or minimum touch heights.
  - Current local source `webapp/app/bayyna.css:109-110` and export `webapp/out/_next/static/css/0a9de0b3de909b20.css` already implement:
    ```css
    .recent-link {
      border: 0;
      background: #eceee8;
      padding: 4px 10px;
      min-height: 44px;
      box-sizing: border-box;
      max-width: 220px;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      border-radius: 3px;
      color: inherit;
      text-decoration: none;
      font-size: 11px;
      transition: color 150ms, background-color 150ms;
    }
    .recent-link:hover {
      color: var(--teal);
      background: #e3e8df;
    }
    ```
- **Conclusion:** **ALREADY FIXED in source — no action required.** The issue is purely a deployment staleness artifact between Cloudflare Pages and the current local repository.

---

### 10. [ALREADY FIXED in source — no action] Live Deployment Missing "Search" Nav Link in Sidebar
- **Severity:** P2 on Live / **ALREADY FIXED in source**
- **Surface:** Live deployment (https://daleeleltogar.pages.dev/ar/ and `/en/` sidebar).
- **Evidence:**
  - Live HTML snapshot `/tmp/mi-audit/live/ar-home.html` displays only 4 navigation items in the sidebar: «الرئيسية», «جميع البائعين», «البائعون ذوو أقوى الأدلة الإيجابية», «سياسة الخصوصية والإعلانات».
  - Local source `webapp/src/components/ShellChrome.tsx:129` and local export `webapp/out/ar/index.html` include the dedicated search navigation item:
    `{ href: '/ar/search', label: 'بحث', icon: Search }` (5 total items).
- **Conclusion:** **ALREADY FIXED in source — no action required.** Verified present and functional in local codebase and `out/` export.

---

## 3. Structural Parity Audit (Arabic `/ar/` vs English `/en/`)

Audited by parsing rendered HTML DOM structures in `webapp/out/ar/index.html` vs `webapp/out/en/index.html` and cross-referencing live snapshots in `/tmp/mi-audit/live/`.

### 3.1 Landmark & Hierarchy Parity

| Structural Landmark | Arabic `/ar/` Count | English `/en/` Count | Parity Status | Notes |
|---|---|---|---|---|
| `<header class="topbar">` | 1 | 1 | **MATCH (1:1)** | Same hierarchy: mobile brand, breadcrumb, independent badge, language switcher, mobile trigger |
| `<aside class="sidebar">` | 1 | 1 | **MATCH (1:1)** | Identical 2 nav groups, 5 navigation links, bottom philosophy card, and caption |
| `<main class="main-content">` | 1 | 1 | **MATCH (1:1)** | Same ID (`#main-content`), tabindex `-1`, and landmark boundaries |
| `<section class="hero">` | 1 | 1 | **MATCH (1:1)** | Eyebrow, H1, subtitle, SearchBox, recent search pill group |
| `<section class="process-section">` | 1 | 1 | **MATCH (1:1)** | Kicker, H2, text-link to privacy, 3 step cards |
| `<div class="home-bottom">` | 1 | 1 | **MATCH (1:1)** | `.directory-preview` section + `.principle-card` aside |
| `<footer class="footer">` | 1 | 1 | **MATCH (1:1)** | Tagline, snapshot freshness / privacy link, note, and mark |
| **H1 Headings** | 1 | 1 | **MATCH (1:1)** | AR: «وراء كل تاجر، معلومات تستحق البحث.» / EN: "Behind every vendor, information worth exploring." |
| **H2 Headings** | 3 | 3 | **MATCH (1:1)** | Process, Directory preview, Principle statement |
| **H3 Headings** | 5 | 5 | **MATCH (1:1)** | Sidebar philosophy, 3 Step cards, Directory empty state |

---

### 3.2 Directional & Mirrored Iconography Audit

| Component | Icon | Arabic (`ar`) Orientation | English (`en`) Orientation | Verification |
|---|---|---|---|---|
| **Topbar Breadcrumb** | Home separator | `<ChevronLeft size={13} />` | `<ChevronRight size={13} />` | **Verified Correct.** In RTL, navigation forward points Left. In LTR, it points Right. |
| **Search Submit** | Submission Arrow | `<ArrowLeft size={16} />` | `<ArrowRight size={16} />` | **Verified Correct.** Submitting/proceeding points Left in Arabic, Right in English. |
| **Process Link** | Link Arrow | `<ArrowLeft size={14} />` | `<ArrowRight size={14} />` | **Verified Correct.** Forward text link points Left in Arabic, Right in English. |
| **Directory Link** | Link Arrow | `<ArrowLeft size={14} />` | `<ArrowRight size={14} />` | **Verified Correct.** Forward text link points Left in Arabic, Right in English. |
| **Principles Link** | Link Arrow | `<ArrowLeft size={14} />` | `<ArrowRight size={14} />` | **Verified Correct.** Forward text link points Left in Arabic, Right in English. |

---

### 3.3 Research Art Diagram Coordination

- **Markup:** `webapp/app/[locale]/page.tsx:18-68` (`ResearchIllustration`).
- **CSS Rule:** `webapp/app/bayyna.css:18`: `.research-art { position: relative; width: 232px; height: 191px; flex-shrink: 0; direction: ltr; margin-inline: 13px 3px; }`.
- **Audit Assessment:** **Clean & Intentional.** The abstract dossier diagram uses `direction: ltr` across both locales so that absolute rotational coordinates (`transform: rotate(-15deg)`, `rotate(8deg)`, `left: 44px`, `left: 76px`) maintain geometric alignment without clipping. The inner text label `.art-label` explicitly overrides direction (`direction: rtl` in Arabic with `left: 88px`; `direction: ltr` in English with `left: 64px`) to preserve proper linguistic flow.

---

## 4. Verified Clean List

The following components and subsystems on the Home Page and Global Chrome were rigorously inspected and verified **clean of defects**:

1. **Brand Mark SVG Coordination:**
   - Both `.sidebar-brand` and `.mobile-brand` render the dual-layer `ScanLine` (frame) + `Fingerprint` (inner core) cleanly with zero SVG clipping or aspect-ratio distortion.
2. **SearchBox State Synchronization:**
   - `SearchBox.tsx` correctly handles controlled input state, URL synchronization, type filter selection (`all`, `name`, `phone`, `link`), and trims whitespace before form dispatch.
3. **Sidebar Mobile Focus Trap & Body Scroll Lock:**
   - `ShellChrome.tsx:67-111` implements a robust focus trap, Escape key dismiss listener, body `overflow: hidden` scroll lock, and automatic menu dismissal on viewport resize (`> 900px`).
4. **Skip-to-Content Navigation:**
   - Skip link is fully accessible via keyboard Tab, correctly positioned in both RTL (`inset-inline-start: 245px` / `16px`) and LTR, and targets `#main-content` without browser scroll jumps.
5. **Reduced Motion Compliance:**
   - Global stylesheet enforces `scroll-behavior: auto !important; transition: none !important;` when `prefers-reduced-motion: reduce` is detected.
6. **Selection Styling:**
   - `::selection` sets `#2a3441` on `#dbe7e4`, providing an outstanding **9.94:1** contrast ratio across all text selections.
7. **AdSense & Consent Script Isolation:**
   - When ads are disabled (current production setting), `AdSenseScript` and `ConsentBanner` emit zero DOM elements, keeping the page lightweight and completely ad-script free.
