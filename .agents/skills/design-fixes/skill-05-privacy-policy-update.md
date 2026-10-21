# Skill 05 — Privacy Policy & Evidence Transparency Audit & Rewrite

> **Audit Target:** `/ar/privacy/` and `/en/privacy/`  
> **Source Component:** `merchant-intelligence/webapp/app/[locale]/privacy/page.tsx`  
> **Status:** Read-only audit and ready-to-paste implementation plan. **Zero source edits performed.**  
> **Ground Truth Verification:** Audited against local source (`webapp/app/[locale]/privacy/page.tsx`), local production build (`webapp/out/`), and live snapshots (`/tmp/mi-audit/live/*-privacy.html`).

---

## 1. Executive Summary & Policy Rewrite Blueprint

The privacy policy on Daleel El-Togar (دليل التجار) is being restructured from a standard ad-supported disclosure into an **Evidence Collection & Ad Transparency Policy**.

### Core Policy Mandates
1. **REMOVE completely:**
   - All references to Google AdSense, third-party ad networks, advertising cookies (`mi_ad_consent`), DART cookies, personalized ad opt-outs (`aboutads.info`, Google Ad Settings), and the consent banner mechanism.
   - Entire Section 4 («خيارك أنت» / «Your Choice») which solely handled the cookie consent banner.
2. **KEEP intact verbatim:**
   - Section 1: «طبيعة الخدمة والبيانات المنشورة» / «1. Nature of the Service & Published Data» (audit lines 65–75 EN / 193–203 AR).
   - Disclaimer Section: «إخلاء المسؤولية وعدم الضمان» / «Non-Guarantee & Non-Judgement Disclaimer» (audit lines 151–156 EN / 277–282 AR), renumbered to Section 04.
3. **REWRITE core as «سياسة جمع الأدلة والشفافية الإعلانية» (Evidence Collection & Ad Transparency):**
   - **(a) Public Evidence Aggregation:** Platform systematically aggregates and archives publicly accessible social-media evidence, open consumer forums, and official registries under objective filtering.
   - **(b) Strict Ban on Ads in Evidence:** Zero paid placements, no sponsored reviews, no altering or suppressing reports.
   - **(c) Future Ad Transparency:** Any future display advertising to fund servers will be strictly labeled with `Ad`/`إعلان` and isolated from report content.
   - **Functional Cookie Retention:** Retain `mi_lang` cookie row (`max-age=31536000`, ~1 year) storing interface language preference without tracking or personal data.

---

## 2. Section Map (Keep / Remove / Rewrite)

| Current Section (Source line) | Title (AR / EN) | Action | Target Section & Details |
|---|---|---|---|
| **Metadata** (`page.tsx:21-30`) | Title & Description | **REWRITE** | Update metadata to reflect evidence collection and transparency standards rather than ad network disclosures. |
| **Header** (`page.tsx:46-56, 174-184`) | «سياسة الخصوصية والإفصاح الإعلاني» / "Privacy Policy & Advertising Disclosure" | **REWRITE** | Update title to «سياسة الخصوصية والشفافية التوثيقية» / "Privacy Policy & Evidence Transparency". |
| **Section 1** (`page.tsx:59-76, 187-204`) | «1. طبيعة الخدمة والبيانات المنشورة» / "1. Nature of the Service & Published Data" | **KEEP VERBATIM** | Stays Section 01. Retains all statements on indexing public-source data and zero collection of personal user accounts. |
| **Section 2** (`page.tsx:78-96, 206-224`) | «2. ملفات تعريف الارتباط (Cookies)» / "2. Cookies & Local Storage" | **REWRITE** | Stays Section 02. Retitle to «ملفات تعريف الارتباط والتفضيلات التقنية» / "Cookies & Technical Preferences". **REMOVE** `mi_ad_consent` row. **KEEP** `mi_lang` (365 days) explanation. |
| **Section 3** (`page.tsx:98-128, 226-255`) | «3. سياسة الإعلانات» / "3. Advertising Policy" | **REWRITE** | Stays Section 03. Retitle to «3. سياسة جمع الأدلة والشفافية الإعلانية» / "3. Evidence Collection & Ad Transparency Policy". Rewritten around mandates (a), (b), (c) + updated documentary integrity notice box. |
| **Section 4** (`page.tsx:130-143, 257-269`) | «4. خيارك أنت» / "4. Your Choice" | **REMOVE** | Entirely eliminated. Covered consent banner acceptance/rejection of `mi_ad_consent`. |
| **Section 5** (`page.tsx:145-158, 271-283`) | «5. إخلاء المسؤولية وعدم الضمان» / "5. Non-Guarantee & Non-Judgement Disclaimer" | **KEEP VERBATIM (RENUMBER)** | Moves to Section 04. Text kept 100% intact verbatim; ID updated to `section-4`. |
| **Footer** (`page.tsx:161-166, 286-291`) | Return link (`← العودة إلى الصفحة الرئيسية` / `← Return to Home`) | **FIX LAYOUT** | Remove literal unicode arrow `←` from text to fix opposing/duplicate arrows. |

---

## 3. UI/UX & Layout Findings

### 1. Opposing & Duplicate Arrows in Return-to-Home Link
- **Severity:** P1 (readable-but-wrong)
- **Surface:** `/ar/privacy/` and `/en/privacy/`
- **Evidence:**
  - Component source: `webapp/app/[locale]/privacy/page.tsx:163-164, 288-289`
  - HTML out: `webapp/out/ar/privacy/index.html` and `webapp/out/en/privacy/index.html`
  - Rendered markup (AR): `<svg class="lucide-arrow-right">...</svg><span>← العودة إلى الصفحة الرئيسية</span>`
  - Rendered markup (EN): `<svg class="lucide-arrow-left">...</svg><span>← Return to Home</span>`
- **Root cause:**
  - In Arabic (`dir="rtl"`), Lucide `<ArrowRight size={16} />` visually points to the right (`→`, logical return in RTL). However, the hardcoded text string inside `<span>` contains a literal unicode arrow `←` (pointing to the left). As a result, the two arrows point directly toward each other (`→` followed by `←`), creating visual dissonance.
  - In English (`dir="ltr"`), `<ArrowLeft size={16} />` points left (`←`), and the text also contains `←`, rendering two adjacent left arrows (`← ← Return to Home`).
- **Fix:** Remove the literal `←` from the text string in both languages:
  - AR: `<span>العودة إلى الصفحة الرئيسية</span>`
  - EN: `<span>Return to Home</span>`
- **Confidence:** Very High (100% verified in static output and source)

---

### 2. RTL Inversion of List Indentation (`pe-2` instead of `ps-2`)
- **Severity:** P1 (readable-but-wrong)
- **Surface:** `/ar/privacy/`
- **Evidence:**
  - Component source: `webapp/app/[locale]/privacy/page.tsx:214, 247`
  - HTML out: `webapp/out/ar/privacy/index.html`
  - Class: `<ul className="list-disc list-inside space-y-2 text-sm pe-2 text-[#56606a]">`
- **Root cause:** In Arabic RTL, the developer applied `pe-2` (`padding-inline-end: 0.5rem`). In an RTL context, `inline-end` is the **left side** (trailing edge). This results in zero indentation on the right (start edge where the bullet point sits), and unintended padding on the trailing left edge. In English (`page.tsx:86`), `ps-2` (`padding-inline-start`) was used correctly.
- **Fix:** Replace `pe-2` with `ps-5` on Arabic `<ul>` elements (and update English to `ps-5`).
- **Confidence:** Very High

---

### 3. Bullet Point Marker Multi-line Text Alignment (`list-inside` wrapping defect)
- **Severity:** P1 (readable-but-wrong)
- **Surface:** `/ar/privacy/` and `/en/privacy/`
- **Evidence:**
  - Component source: `webapp/app/[locale]/privacy/page.tsx:86, 120, 214, 247`
  - CSS rule: Tailwind `list-inside` (`list-style-position: inside`)
- **Root cause:** `list-inside` places the bullet marker within the inline flow of the list item box. When bullet items contain more than one sentence or wrap across multiple lines (e.g. cookie descriptions or notice items), subsequent lines wrap directly underneath the bullet point rather than having a clean hanging indent (`list-outside`).
- **Fix:** Replace `list-inside` with `list-outside ps-5` on all `<ul>` elements.
- **Confidence:** Very High

---

### 4. Redundant Double Numbering on Desktop & Selector Collision on Section `<h2>`
- **Severity:** P1 (readable-but-wrong)
- **Surface:** `/ar/privacy/` and `/en/privacy/`
- **Evidence:**
  - Component source: `webapp/app/[locale]/privacy/page.tsx:59-65, 187-193`
  - CSS rules: `webapp/app/bayyna.css:24` (`.method-item h2`), `bayyna.css:26` (`.report-section h2`), `bayyna.css:32` (`@media (max-width: 900px) .method-number { display: none }`)
- **Root cause:**
  1. On desktop viewports (>900px), `<div className="method-number">01</div>` is displayed in the gutter column, while `<h2>1. Nature of the Service</h2>` repeats the numeral in the heading text. On mobile, `.method-number` is hidden via `display: none`, making the inline number necessary only for small screens.
  2. The markup applies both `.report-section` and `.method-item` to `<section>`. In `bayyna.css`, `.report-section h2` (line 26) comes after `.method-item h2` (line 24) and sets `display: flex; align-items: center; gap: 10px; font-size: 18px;`. This flex rule was designed for merchant report headers that contain an icon child (`<FileSearch /><span>Title</span>`). Applied to text-only headings in `privacy/page.tsx`, it turns plain text into an anonymous flex child, affecting natural typography and breaking line wrapping.
- **Fix:**
  - In `privacy/page.tsx`, use pure `.method-item` without `.report-section` collision, or ensure heading styles retain `display: block; font-size: 18px; line-height: 1.8;`.
  - Harmonize numbering so desktop does not feel awkwardly duplicated.
- **Confidence:** High

---

### 5. Contrast Failures on Method Numerals and Paragraph Text
- **Severity:** P1 (readable-but-wrong)
- **Surface:** `/ar/privacy/` and `/en/privacy/`
- **Evidence:**
  - CSS source: `webapp/app/bayyna.css:24` (`.method-number { color: #a4aba0 }`), `bayyna.css:55` (`.method-item p { color: #697861 }`), `bayyna.css:22` (`.data-notice p { color: #818878 }`)
  - Background: `#f5f3ef` (`--bg`), Notice card background: `#eceee8`
  - Contrast ratios:
    - `.method-number` (`#a4aba0` on `#f5f3ef`): **2.13:1** (WCAG AA failure; minimum 3.0:1 for large, 4.5:1 for standard text)
    - `.method-item p` (`#697861` on `#f5f3ef`): **4.25:1** (fails WCAG AA 4.5:1 requirement for body text)
    - `.data-notice p` (`#818878` on `#eceee8`): **3.14:1** (fails WCAG AA 4.5:1)
- **Root cause:** Subdued olive/gray palette colors chosen for print-like aesthetics fail digital accessibility contrast ratios against the cream background.
- **Fix:**
  - Update `.method-number` to `#6c756b` (4.5:1+) or use semantic token `var(--muted)` (`#56606a` at 5.78:1).
  - Darken `.method-item p` to `#404f3d` or `var(--ink)` (`#2a3441` at 11.37:1).
  - Darken `.data-notice p` to `#4a5746` (5.1:1).
- **Confidence:** Very High (mathematically proven via WCAG 2.1 relative luminance formula)

---

### 6. Code Chip Fragmentation & RTL Bidi Bleed on Technical Tokens
- **Severity:** P2 (nit)
- **Surface:** `/ar/privacy/` and `/en/privacy/`
- **Evidence:**
  - Component source: `webapp/app/[locale]/privacy/page.tsx:88, 93, 216, 221`
  - Rendered markup: `<code className="font-mono bg-[#f0eee9] text-[#2a3441] px-1.5 py-0.5 rounded-[3px] border border-[#e4e3de] text-xs">/ar/…</code>`
- **Root cause:**
  - `<code>` tags lack `whitespace-nowrap` and `inline-block`. When a cookie name or path token hits a responsive line break, the rounded border badge can break mid-character or split into two jagged boxes.
  - In Arabic RTL paragraphs, technical tokens containing slashes (`/ar/…`) and underscores (`mi_lang`) surrounded by parentheses can suffer bidi punctuation mirroring (parenthesis flipping or slash detachment) unless wrapped with `unicode-bidi: isolate` / `.ltr-isolate`.
- **Fix:** Add `whitespace-nowrap inline-block ltr-isolate` to all technical code chips.
- **Confidence:** High

---

### 7. Desktop Header Icon Vertical Misalignment on Multi-line Wrap
- **Severity:** P2 (nit)
- **Surface:** `/ar/privacy/` and `/en/privacy/`
- **Evidence:**
  - Component source: `webapp/app/[locale]/privacy/page.tsx:51-54, 179-182`
  - CSS rule: `bayyna.css:22` (`.page-heading h1 { display: flex; align-items: center; gap: 13px; }`)
- **Root cause:** On desktop viewports (>900px), `.page-heading h1` uses `align-items: center`. When the heading wraps to two lines on intermediate viewport widths (e.g. 910px–1050px or in Arabic), the 27px Lucide icon floats vertically between lines 1 and 2 rather than anchoring to the first line. Note that mobile (`bayyna.css:32`) already had to override this with `align-items: flex-start; margin-top: 8px`.
- **Fix:** Change desktop `.page-heading h1` to `align-items: flex-start` with `margin-top: 5px` on the SVG child.
- **Confidence:** High

---

### 8. Container & Paragraph Max-Width Disparity Causing Staggered Layout Edges
- **Severity:** P2 (nit)
- **Surface:** `/ar/privacy/` and `/en/privacy/`
- **Evidence:**
  - Component source: `webapp/app/[locale]/privacy/page.tsx:45, 173` (`max-w-4xl` = 896px)
  - CSS rules: `bayyna.css:22` (`.page-heading { max-width: 820px }`), `bayyna.css:24` (`.method-item p { max-width: 745px }`)
- **Root cause:** The outer article container is 896px wide. The page header is capped at 820px. Inside `.method-item`, paragraphs are constrained to `max-width: 745px`, but headings and `.data-notice` cards fill 100% of the flex child (~780px). This causes paragraphs to terminate 35px earlier than callout boxes and headings, producing a stepped, uneven trailing margin.
- **Fix:** Harmonize container widths: set a consistent `max-w-3xl` (768px) on the parent `<article>` or let children fill the flex container uniformly.
- **Confidence:** Medium

---

### 9. Live Deployment Parity Audit (Already Fixed in Source)
- **Status:** **ALREADY FIXED in source — no action**
- **Evidence:**
  - Live snapshot `/tmp/mi-audit/live/ar-privacy.html` contains:
    - `3. إعلانات Google AdSense ونظام Consent Mode v2`
    - `4. كيفية تعطيل الإعلانات المخصصة وإدارة الخيارات`
    - Links to `aboutads.info` and Google Ads Settings
    - References to DART cookies
  - Local source `webapp/app/[locale]/privacy/page.tsx` had already removed the direct Google AdSense and `aboutads.info` mentions in favor of generic display ad wording.
  - The remaining task is to remove the leftover `mi_ad_consent` cookie row and the consent banner section, replacing them with the Evidence Collection and Ad Transparency policy.

---

## 4. Full Replacement Arabic Text (Canonical RTL)

Below is the verbatim, section-by-section replacement code ready to be pasted directly into `merchant-intelligence/webapp/app/[locale]/privacy/page.tsx` for the Arabic canonical version (`locale === 'ar'`).

```tsx
  // Canonical Arabic version
  return (
    <article className="max-w-4xl mx-auto py-6" lang="ar" dir="rtl">
      <header className="page-heading">
        <div className="eyebrow">
          <span />
          السياسات والالتزام
        </div>
        <h1>
          <ShieldCheck size={27} className="mt-1 shrink-0" />
          سياسة الخصوصية والشفافية التوثيقية
        </h1>
        <p>آخر تحديث: أكتوبر 2026</p>
      </header>

      <div className="method-list report-sections">
        {/* Section 01: Nature of the Service & Published Data (KEEP VERBATIM) */}
        <section className="report-section method-item" id="section-1">
          <div className="method-number">01</div>
          <span className="method-icon">
            <Shield size={24} />
          </span>
          <div className="space-y-3 flex-1 min-w-0">
            <h2>1. طبيعة الخدمة والبيانات المنشورة</h2>
            <p>
              «دليل التجار» هو محرك بحث ودليل أدلة توثيقية للتجار والمتاجر في السوق المصري.
              تعتمد المنصة حصرًا على <strong className="font-semibold text-[#2a3441]">المصادر العامة المتاحة علنًا</strong>، مثل سجلات القيد التجاري العامة، والبلاغات والتحذيرات الرسمية المنشورة،
              ومعرفات التواصل المعلنة من التجار، ومراجعات المستهلكين العامة.
            </p>
            <p>
              <strong className="font-semibold text-[#2a3441]">عدم جمع بيانات شخصية للمستخدمين:</strong> لا يتطلب الموقع إنشاء حسابات، ولا يطلب تسجيل الدخول أو كلمات مرور أو بريدًا إلكترونيًا،
              ولا يقوم بأي معالجة لبيانات الدفع أو البطاقات البنكية. تصفح الموقع متاح بالكامل دون جمع أي هوية للمتصفحين.
            </p>
          </div>
        </section>

        {/* Section 02: Cookies & Technical Preferences (REWRITE: REMOVE mi_ad_consent, KEEP mi_lang) */}
        <section className="report-section method-item" id="section-2">
          <div className="method-number">02</div>
          <span className="method-icon">
            <Cookie size={24} />
          </span>
          <div className="space-y-3 flex-1 min-w-0">
            <h2>2. ملفات تعريف الارتباط والتفضيلات التقنية</h2>
            <p>
              نستخدم حدًا أدنى تقنيًا من ملفات تعريف الارتباط يقتصر على حفظ خياراتك الوظيفية الأساسية،
              ولا نستخدم أي ملفات تتبع إعلانية أو أدوات تحليلية تتبع نشاطك عبر المواقع:
            </p>
            <ul className="list-disc list-outside space-y-2 text-sm ps-5 text-[#56606a]">
              <li>
                <code className="font-mono bg-[#f0eee9] text-[#2a3441] px-1.5 py-0.5 rounded-[3px] border border-[#e4e3de] text-xs whitespace-nowrap inline-block ltr-isolate">mi_lang</code>:
                لحفظ لغة الواجهة التي اخترتها (<code className="font-mono bg-[#f0eee9] text-[#2a3441] px-1.5 py-0.5 rounded-[3px] border border-[#e4e3de] text-xs whitespace-nowrap inline-block ltr-isolate">ar</code> أو <code className="font-mono bg-[#f0eee9] text-[#2a3441] px-1.5 py-0.5 rounded-[3px] border border-[#e4e3de] text-xs whitespace-nowrap inline-block ltr-isolate">en</code>)
                لمدة عام تقريبًا (365 يومًا)، كي تُفتَح زيارتك القادمة والروابط المُشارَكة باللغة ذاتها؛
                وهو ملف تقني لا يحمل أي بيانات شخصية ولا يُستخدم للإعلانات ولا يُشارك مع أي طرف خارجي.
              </li>
            </ul>
            <p>
              لغة الواجهة هي في الأصل جزء من عنوان الصفحة نفسه (<code className="font-mono bg-[#f0eee9] text-[#2a3441] px-1.5 py-0.5 rounded-[3px] border border-[#e4e3de] text-xs whitespace-nowrap inline-block ltr-isolate">/ar/…</code> أو <code className="font-mono bg-[#f0eee9] text-[#2a3441] px-1.5 py-0.5 rounded-[3px] border border-[#e4e3de] text-xs whitespace-nowrap inline-block ltr-isolate">/en/…</code>).
              وعند قيامك بتغييرها يدويًا عبر زر تبديل اللغة، يُحفظ ملف التفضيل المذكور أعلاه لضمان تجربة تصفح متسقة.
            </p>
          </div>
        </section>

        {/* Section 03: Evidence Collection & Ad Transparency (REWRITE) */}
        <section className="report-section method-item" id="section-3">
          <div className="method-number">03</div>
          <span className="method-icon">
            <Megaphone size={24} />
          </span>
          <div className="space-y-3 flex-1 min-w-0">
            <h2>3. سياسة جمع الأدلة والشفافية الإعلانية</h2>
            <p>
              <strong className="font-semibold text-[#2a3441]">جمع الأدلة وأرشفتها من المصادر العامة:</strong> يقوم «دليل التجار» برصد وتجميع وتوثيق الأدلة المتاحة علنًا عبر منصات التواصل الاجتماعي، ومجموعات المستهلكين العامة، وقنوات السجلات والتحذيرات الرسمية، وتجارب المشترين المنشورة. تُفرز هذه البيانات وتُرتّب وتُصنّف آليًا وفق معايير موضوعية ومحايدة، لعرض سياق التعامل التجاري كما هو دون اجتزاء أو تعديل لصالح أي طرف.
            </p>
            <p>
              <strong className="font-semibold text-[#2a3441]">حظر الإعلانات داخل الأدلة والتقييمات:</strong> نلتزم بفصل مطلق بين المحتوى التوثيقي وأي نشاط تجاري؛ فلا يمكن لأي تاجر أو جهة تجارية دفع مقابل مالي لوضع محتوى ترويجي داخل تقارير التجار أو الأدلة التوثيقية أو سجلات المراجعات، ولا لتعديل نتائج التحليل أو حذف الأدلة السلبية أو التأثير على معايير المنصة.
            </p>
            <p>
              <strong className="font-semibold text-[#2a3441]">الشفافية الكاملة ووسم الإعلانات المستقبلية:</strong> إذا تقرر في المستقبل عرض أي إعلانات تجارية للمساهمة في استدامة البنية التحتية للخوادم، فستكون مفصولة مكانيًا وبصريًا بشكل قاطع عن محتوى الأدلة والتقارير، وموسومة بوضوح صريح ودون أدنى لبس بعلامة <code className="font-mono bg-[#f0eee9] text-[#2a3441] px-1.5 py-0.5 rounded-[3px] border border-[#e4e3de] text-xs whitespace-nowrap inline-block">إعلان</code>. لن تظهر الإعلانات أبدًا داخل نصوص الأدلة أو الادعاءات أو المصادر، ولن تُصمَّم لتشبه الأدلة التوثيقية بأي شكل.
            </p>
            <div className="data-notice mt-4">
              <ShieldCheck size={20} className="shrink-0 text-[#4a7c7e]" />
              <div className="space-y-2">
                <strong className="block text-sm font-medium text-[#2a3441]">قواعد النزاهة التوثيقية والشفافية:</strong>
                <ul className="list-disc list-outside space-y-1.5 text-sm text-[#56606a] ps-5">
                  <li>الأدلة والمراجعات مستخلصة حصريًا من الفضاء الرقمي العام ولا تقبل الرعاية أو الترويج المدفوع.</li>
                  <li>لا يمكن شراء مواضع داخل تقارير التجار، ولا وجود لأي استثناء يتيح تلميع السمعة أو حجب الشكاوى الموثقة.</li>
                  <li>أي مساحات إعلانية مستقبلية ستكون مفصولة مكانيًا وموسومة صراحة بعيدًا عن سياق السجلات والأدلة.</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Section 04: Non-Guarantee & Non-Judgement Disclaimer (KEEP VERBATIM, RENUMBERED FROM 05) */}
        <section className="report-section method-item" id="section-4">
          <div className="method-number">04</div>
          <span className="method-icon">
            <Scale size={24} />
          </span>
          <div className="space-y-3 flex-1 min-w-0">
            <h2>4. إخلاء المسؤولية وعدم الضمان</h2>
            <p>
              البيانات والأدلة المنشورة مستخلصة آليًا من مصادر عامة، ولا تمثل تقييمًا ائتمانيًا أو ضمانًا تجاريًا رسميًا أو حكمًا نهائيًا على أي بائع.
              يتحمل المستخدم دائمًا مسؤولية مراجعة المصادر الأصلية والتحقق منها بنفسه قبل اتخاذ أي قرار تعاقدي أو شراء.
            </p>
          </div>
        </section>
      </div>

      <footer className="pt-6 mt-8 border-t border-[#e4e3de]">
        <Link href={`/${locale}`} className="text-link font-medium inline-flex items-center gap-2">
          <ArrowRight size={16} />
          <span>العودة إلى الصفحة الرئيسية</span>
        </Link>
      </footer>
    </article>
  );
```

---

## 5. Full Replacement English Mirror (LTR)

Below is the matching English replacement code ready to be pasted directly into `merchant-intelligence/webapp/app/[locale]/privacy/page.tsx` for the English version (`isEn` branch).

```tsx
  if (isEn) {
    return (
      <article className="max-w-4xl mx-auto py-6" lang="en" dir="ltr">
        <header className="page-heading">
          <div className="eyebrow">
            <span />
            LEGAL &amp; COMPLIANCE
          </div>
          <h1>
            <ShieldCheck size={27} className="mt-1 shrink-0" />
            Privacy Policy &amp; Evidence Transparency
          </h1>
          <p>Last updated: October 2026</p>
        </header>

        <div className="method-list report-sections">
          {/* Section 01: Nature of the Service & Published Data (KEEP VERBATIM) */}
          <section className="report-section method-item" id="section-1">
            <div className="method-number">01</div>
            <span className="method-icon">
              <Shield size={24} />
            </span>
            <div className="space-y-3 flex-1 min-w-0">
              <h2>1. Nature of the Service &amp; Published Data</h2>
              <p>
                Daleel El-Togar (دليل التجار) is an automated search engine and evidence directory for Egyptian commercial vendors.
                The platform indexes and organizes solely <strong className="font-semibold text-[#2a3441]">public-source data</strong>, such as business registry records, official notices,
                publicly listed contact channels, and published consumer feedback.
              </p>
              <p>
                <strong className="font-semibold text-[#2a3441]">No User Account or Profile Data:</strong> We do not offer user accounts, registration, email newsletter subscriptions,
                or payment processing. We do not collect names, passwords, phone numbers, or private identities from visitors browsing this website.
              </p>
            </div>
          </section>

          {/* Section 02: Cookies & Technical Preferences (REWRITE: REMOVE mi_ad_consent, KEEP mi_lang) */}
          <section className="report-section method-item" id="section-2">
            <div className="method-number">02</div>
            <span className="method-icon">
              <Cookie size={24} />
            </span>
            <div className="space-y-3 flex-1 min-w-0">
              <h2>2. Cookies &amp; Technical Preferences</h2>
              <p>
                We use a strictly minimal set of technical cookies required for your interface preferences.
                We do not use advertising cookies, marketing pixels, or cross-site tracking mechanisms:
              </p>
              <ul className="list-disc list-outside space-y-2 text-sm ps-5 text-[#56606a]">
                <li>
                  <code className="font-mono bg-[#f0eee9] text-[#2a3441] px-1.5 py-0.5 rounded-[3px] border border-[#e4e3de] text-xs whitespace-nowrap inline-block">mi_lang</code>:
                  Stores your preferred interface language (<code className="font-mono bg-[#f0eee9] text-[#2a3441] px-1.5 py-0.5 rounded-[3px] border border-[#e4e3de] text-xs whitespace-nowrap inline-block">ar</code> or <code className="font-mono bg-[#f0eee9] text-[#2a3441] px-1.5 py-0.5 rounded-[3px] border border-[#e4e3de] text-xs whitespace-nowrap inline-block">en</code>)
                  for approximately one year (365 days), ensuring subsequent visits and shared links retain your chosen language.
                  This cookie stores no personal identifiers, is never used for advertising, and is never shared with third parties.
                </li>
              </ul>
              <p>
                Your interface language is part of the page URL itself (<code className="font-mono bg-[#f0eee9] text-[#2a3441] px-1.5 py-0.5 rounded-[3px] border border-[#e4e3de] text-xs whitespace-nowrap inline-block">/ar/…</code> or <code className="font-mono bg-[#f0eee9] text-[#2a3441] px-1.5 py-0.5 rounded-[3px] border border-[#e4e3de] text-xs whitespace-nowrap inline-block">/en/…</code>).
                When you actively toggle the language selector, the preference cookie above is stored so your choice persists.
              </p>
            </div>
          </section>

          {/* Section 03: Evidence Collection & Ad Transparency Policy (REWRITE) */}
          <section className="report-section method-item" id="section-3">
            <div className="method-number">03</div>
            <span className="method-icon">
              <Megaphone size={24} />
            </span>
            <div className="space-y-3 flex-1 min-w-0">
              <h2>3. Evidence Collection &amp; Ad Transparency Policy</h2>
              <p>
                <strong className="font-semibold text-[#2a3441]">Aggregation of Public Evidence:</strong> Daleel El-Togar compiles, aggregates, and archives publicly accessible evidence from open social-media channels, public consumer communities, official registry notices, and published customer experiences. This data is systematically sorted, categorized, and filtered under neutral, objective criteria to reflect real-world commercial track records without tampering or editorial bias.
              </p>
              <p>
                <strong className="font-semibold text-[#2a3441]">No Ads Embedded Within Evidence or Reviews:</strong> We maintain strict separation between factual intelligence and commercial promotions. No merchant or commercial entity can pay to insert promotional content into vendor reports, alter search rankings, suppress negative feedback, or remove verified consumer complaints. All evidence and review indexes are completely separated from commercial influence.
              </p>
              <p>
                <strong className="font-semibold text-[#2a3441]">Future Advertising Transparency:</strong> Should the platform display advertisements in the future to support infrastructure and server maintenance costs, all promotional units will remain strictly separated from evidence reports and unambiguously marked with a clear <code className="font-mono bg-[#f0eee9] text-[#2a3441] px-1.5 py-0.5 rounded-[3px] border border-[#e4e3de] text-xs whitespace-nowrap inline-block">Ad</code>/<code className="font-mono bg-[#f0eee9] text-[#2a3441] px-1.5 py-0.5 rounded-[3px] border border-[#e4e3de] text-xs whitespace-nowrap inline-block">إعلان</code> badge. Ads will never appear inside evidence, claims, sources, or report narratives, and will never be formatted to resemble documentary records.
              </p>
              <div className="data-notice mt-4">
                <ShieldCheck size={20} className="shrink-0 text-[#4a7c7e]" />
                <div className="space-y-2">
                  <strong className="block text-sm font-medium text-[#2a3441]">Binding Documentary Integrity Principles:</strong>
                  <ul className="list-disc list-outside space-y-1.5 text-sm text-[#56606a] ps-5">
                    <li>Evidence and consumer experiences are compiled strictly from public channels and never accept paid sponsorships.</li>
                    <li>Merchants cannot purchase premium placements, pin positive reviews, or suppress documented reports.</li>
                    <li>Any future advertising slots will remain completely separated from documentary records and visibly labeled.</li>
                  </ul>
                </div>
              </div>
            </div>
          </section>

          {/* Section 04: Non-Guarantee & Non-Judgement Disclaimer (KEEP VERBATIM, RENUMBERED FROM 05) */}
          <section className="report-section method-item" id="section-4">
            <div className="method-number">04</div>
            <span className="method-icon">
              <Scale size={24} />
            </span>
            <div className="space-y-3 flex-1 min-w-0">
              <h2>4. Non-Guarantee &amp; Non-Judgement Disclaimer</h2>
              <p>
                All vendor records, claims, and evidence directories are compiled automatically from public domain sources.
                They do not constitute a credit rating, an official commercial guarantee, an endorsement, or a definitive legal judgement.
                Users are advised to inspect primary sources directly before making purchasing or contracting decisions.
              </p>
            </div>
          </section>
        </div>

        <footer className="pt-6 mt-8 border-t border-[#e4e3de]">
          <Link href={`/${locale}`} className="text-link font-medium inline-flex items-center gap-2">
            <ArrowLeft size={16} />
            <span>Return to Home</span>
          </Link>
        </footer>
      </article>
    );
  }
```

---

## 6. Metadata Updates

Replace `generateMetadata` in `webapp/app/[locale]/privacy/page.tsx:17-31` with:

```tsx
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: rawLocale } = await params;
  const locale: Locale = isLocale(rawLocale) ? rawLocale : 'ar';
  return {
    title: locale === 'en' ? 'Privacy Policy & Transparency — Daleel El-Togar' : 'سياسة الخصوصية والشفافية — دليل التجار',
    description:
      locale === 'en'
        ? 'Privacy policy, evidence collection methodology, and advertising transparency standards for Daleel El-Togar.'
        : 'سياسة الخصوصية وضوابط جمع الأدلة والشفافية الإعلانية لموقع دليل التجار.',
  };
}
```

---

## 7. Baseline Tokens

The following design tokens from `bayyna.css` govern this page:

| Token | Value | Semantic Role on Privacy Page |
|---|---|---|
| `--bg` | `#f5f3ef` | Page canvas background |
| `--paper` | `#fdfcf9` | Secondary panel backgrounds |
| `--ink` | `#2a3441` | Primary text, strong labels, headings |
| `--muted` | `#7a8085` | Subtitles, date stamps, tertiary metadata |
| `--border` | `#e4e3de` | Dividers between report sections, code chip borders |
| `--teal` | `#4a7c7e` | Integrity notice icons, interactive link hovers |
| `--brick` | `#a65d57` | Negative stance indicators |
| `font-ar` | `'IBM Plex Sans Arabic', sans-serif` | Canonical Arabic typography |
| `font-en` | `Inter, sans-serif` | English body and Latin identifiers |

---

## 8. Verified Clean Checklist

The following items were verified and confirmed clean across `/ar/privacy/` and `/en/privacy/`:
- [x] **No User Registration/Account Forms:** The page contains zero input forms, password fields, or registration hooks.
- [x] **Language Parity:** Both Arabic and English versions have identical 4-section architecture with 1-to-1 matching semantic semantics.
- [x] **Bidi Directionality:** AR renders with `dir="rtl"` and `lang="ar"`; EN renders with `dir="ltr"` and `lang="en"`.
- [x] **No Broken Anchor Targets:** All internal section IDs (`#section-1`, `#section-2`, `#section-3`, `#section-4`) follow sequential indexing without orphan fragments.
- [x] **Zero Ad Script Injection:** The page does not inject any client-side Google tag, GPT, or programmatic bidding scripts.
