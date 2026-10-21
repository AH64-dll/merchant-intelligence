# Bayyna → merchant-intelligence UI port contract

GOAL: reskin the entire site to the Bayyna design (source: `~/Documents/تصميم البائع`)
while preserving EVERY existing behavior, prop contract, and test expectation.

## Source of truth
- Design CSS: `app/bayyna.css` (ALREADY imported via `app/globals.css`). Do NOT edit
  it — every class you need is already defined. Read it to learn class names.
- Mockup (structure + a11y + interactions): `~/Documents/تصميم البائع/src/App.tsx`
- Copy map (ar/en strings): `~/Documents/تصميم البائع/src/lib/labels.ts`
  (reference only — our brand is "ميزان التاجر"/"Merchant Intelligence", NOT "بيّنة";
  adapt strings to our identity, keep the design's tone)
- Fonts: `@fontsource/ibm-plex-sans-arabic` + `@fontsource/inter` (installed, imported).
- Icons: `lucide-react` (installed). `.lucide{stroke-width:1.5}` already set.
- `dir`/`lang`: driven by URL locale — do NOT add cookie logic.

## Non-negotiable rules
1. Use EXISTING semantic classes from bayyna.css (`.sidebar`, `.topbar`, `.brand-*`,
   `.nav-item`, `.hero`, `.search-form`, `.step-card`, `.index-panel`, `.index-toolbar`,
   `.report-nav`, `.report-section`, `.method-item`, `.stance-*`, `.page-heading`,
   `.eyebrow`, `.data-notice`, `.search-tips`, `.principle-card`, `.footer`, …).
   The class contract IS the design — don't invent lookalikes.
2. Replace Tailwind `min-h-[44px] border border-black bg-white …` utilities with the
   design's classes where a 1:1 class exists. Where no class exists, style to the
   palette: paper `#fdfcf9`, ink `#2a3441`, muted `#7a8085`, border `#e4e3de`,
   teal `#4a7c7e`, brick `#a65d57`, radius 4-5px, NO pure black borders/shadows.
3. Interpretation boundary: NO numeric score/confidence %/reliability band ever.
4. Keep all `t(locale)`/`locale` plumbing; add missing strings inline via
   `locale === 'ar' ? '…' : '…'` — you do NOT own `src/lib/i18n.ts`.
5. Server components stay server; client components keep their hooks. New
   interactive chrome (mobile menu) = a client component.
6. Links: `<Link>` with `/${locale}` prefix (absolute site links get locale prefix;
   `/data/`, `/api/`, `/_next/` never do).
7. Keep all `dir="auto"`/`<bdi>`/`ltr-isolate` bidi protections on raw identifiers.
8. `app/bayyna.css` and `app/globals.css` are ORCHESTRATOR-OWNED. If you need a
   missing class, note it in your output — do not edit the files.
9. Run `npx tsc --noEmit` + `npx eslint <your files>` before finishing; zero errors.
   `pnpm test` scoped to specs you touched must pass (update assertions that pinned
   old class names — update to assert new semantic class or behavior).
10. NEVER remove ad-slot components, Suspense boundaries, data fetching, or
    searchParams wiring. Design only.
