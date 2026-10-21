# ميزان التاجر — بحث عن هوية التجار وأدلتهم

محرك بحث عن التجار المصريين: أدخل رقم هاتف مصري، أو اسم تاجر، أو رابط صفحة/حساب، فتحصل على أقرب تطابق مع ملخص لما توثقه المصادر العامة عنه: هوية التاجر ودرجة تأكيدها، وتغطية الأدلة وحداثتها، واتجاه الأدلة غير المكررة، وإشارات بارزة مدعومة بالمصادر. النتائج ليست تقييم موثوقية ولا ضمانًا — راجع المصادر الأصلية بنفسك.

## التشغيل محليًا (Development)

المتطلبات: Node.js ≥ 22 و [pnpm](https://pnpm.io).

```bash
pnpm install
bash scripts/snapshot-db.sh   # ينشئ data/merchants.db من قاعدة بيانات خط المعالجة
pnpm dev                      # http://localhost:3000
```

## لقطات قاعدة البيانات (Snapshot)

`data/merchant_intelligence.db` (في جذر المستودع) هو المصدر الوحيد للحقيقة؛ التطبيق لا يفتحه أبدًا. ما يقرأه التطبيق هو نسخة مشتقة مُدقَّقة في `webapp/data/merchants.db` تبنيها `scripts/snapshot-db.sh` هكذا:

1. فتح المصدر للقراءة فقط وأخذ نسخة متسقة عبر `VACUUM INTO` في ملف مؤقت داخل مجلد الوجهة.
2. التحقق من أن مخطط المصدر `schema_version = 5`، ومراقبة تعديل المصدر أثناء النسخ عبر `PRAGMA data_version` + مقارنة أعداد الجداول التسعة، مع إعادة المحاولة حتى ثلاث مرات.
3. تشغيل التدقيق الصارم `scripts/audit-data.mjs --strict` على النسخة المؤقتة؛ أي خطأ قاتل يُلغي العملية.
4. كتابة جدول `snapshot_meta` (صف واحد: `app_schema_version=1`, `source_schema_version=5`, وقت التوليد UTC، أحدث `captured_at`/`updated_at` في المصدر، وأعداد تسع جداول) داخل النسخة المؤقتة فقط.
5. الاستبدال الذري عبر `mv`؛ أي فشل يترك النسخة السابقة كما هي بايت ببايت. قفل `flock` غير حاجب يمنع تشغيلين متزامنين.

```bash
pnpm snapshot          # بناء نسخة جديدة من المصدر الافتراضي
pnpm snapshot:verify   # تدقيق صارم للنسخة الحالية (يُشغَّل داخل بناء Docker أيضًا)
SRC_DB=/path/to/other.db bash scripts/snapshot-db.sh   # مصدر بديل
DEST_DB=/path/to/out.db bash scripts/snapshot-db.sh    # وجهة بديلة
```

عند بدء التشغيل يتحقق `MerchantDb` من `snapshot_meta` (الإصداران 1/5 وتطابق الأعداد) ويفشل بوضوح إن كانت النسخة قديمة أو ناقصة؛ لا يوجد تراجع إلى صيغة قديمة. تصديرات `data/export/*.json|csv|jsonl` تشخيصية تاريخية فقط ولا يقرؤها التطبيق أبدًا.

## الاختبارات والفحوص

```bash
pnpm test        # vitest run
pnpm lint        # eslint
pnpm build       # بناء إنتاجي (output: standalone)
```

## Docker

```bash
docker build -t seller-search .
docker run -p 3000:3000 seller-search
```

مرحلة البناء (`builder`) تشغّل `pnpm snapshot:verify` قبل `pnpm build`؛ يفشل البناء فورًا إن كانت `data/merchants.db` المضمَّنة ناقصة أو قديمة أو غير متوافقة مع عقد `snapshot_meta`. تُنسخ النسخة داخل الصورة وتُقرأ من `MERCHANTS_DB=/app/data/merchants.db` (readonly) في مرحلة التشغيل.

## متغيرات البيئة

| المتغير | الافتراضي | الوصف |
| --- | --- | --- |
| `SRC_DB` | `../data/merchant_intelligence.db` | قاعدة بيانات خط المعالجة (لـ `snapshot-db.sh`) |
| `DEST_DB` | `webapp/data/merchants.db` | وجهة النسخة المشتقة (لـ `snapshot-db.sh`) |
| `MERCHANTS_DB` | `./data/merchants.db` | مسار نسخة قاعدة البيانات |
| `NEXT_PUBLIC_ENABLE_ADS` | `0` | تفعيل/تعطيل إعلانات Google AdSense (`0` أو `1`) |
| `NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT_ID` | `ca-pub-XXXXXXXXXXXXXXXX` | معرّف الناشر في Google AdSense |
| `NEXT_PUBLIC_ADSENSE_SLOT_BOTTOM` | `""` | معرّف وحدة الإعلان الأفقية السفلية (Bottom banner) |
| `NEXT_PUBLIC_ADSENSE_SLOT_SIDEBAR` | `""` | معرّف وحدة الإعلان الجانبية المستطيلة (Sidebar banner) |
## نموذج البائع والواجهات العامة

كل صف في `merchants` يمثل بائعًا قانونيًا/تجاريًا واحدًا، لا فرعًا مستقلًا. تُجمع الأسماء البديلة والمعرّفات وعناوين المواقع والأدلة والادعاءات والتحليلات تحت معرّف البائع الثابت، بينما تبقى عناوين المواقع في `merchant_identifiers(kind='address')`. عدد العناوين المعروض هو عدد **سجلات مواقع** موثقة، وليس ادعاءً بعدد الفروع الفعلي.

- `/merchants` — جميع البائعين الأساسيين، 20 بائعًا في الصفحة، مع مرشحات التصنيف والمحافظة وتغطية الأدلة.
- `/merchants/positive-evidence` — البائعون ذوو أقوى الأدلة الإيجابية، بترتيب حتمي يعتمد على تنوع المصادر الإيجابية المستقلة وقوتها وحداثتها. هذا ترتيب للأدلة المنشورة، وليس درجة ثقة أو ضمانًا لجودة البائع أو نتيجة الشراء.
- `/merchant/[id]` — الملخص المرتب في الأعلى، ثم التحليل والأدلة الكاملة وروابط المصادر والادعاءات والمعرّفات في الأسفل.

قائمة الأدلة الإيجابية لا تستخدم رقمًا مركبًا أو حكمًا مولدًا من نموذج. الأهلية تستبعد الدليل المكرر، وإعلانات التاجر الذاتية من عدّ ملاحظات العملاء، وأي دليل سلبي مستقل من مؤلف غير التاجر، وإشارات التحذير الرسمية/المخاطر. تُحسم حالات التعادل بترتيب معجمي ثابت موثق في `src/lib/directory.ts`.

## واجهة API

- `GET /api/search?q=…&page=…` — بحث بالاسم أو الهاتف أو الرابط. يعيد `{ query, inputKind, total, page, pageSize, ambiguous, diagnostic, hits[] }`؛ كل `hit` يحمل التاجر مع `match: { kind, value, label }` لسبب المطابقة بالعربية. استعلام فارغ أو أطول من 300 حرف يعيد 400.
- `GET /api/merchants/[id]` — تفاصيل تاجر كاملة: معرّفات بأدوارها وسياسة العرض، أسماء بديلة، أدلة مع توثيق كامل (المصدر، المؤلف، التواريخ، حالة التكرار والجذر)، ادعاءات مرتبطة بالأدلة، اتجاه الأدلة غير المكررة مع عدد المكررات المستثناة، وتاجر مرتبطون بأسباب العلاقة. معرّف غير معروف يعيد 404.
- `GET /api/merchants?view=all|positive-evidence&page=…&category=…&governorate=…&coverage=…` — نفس إسقاط القوائم وترتيبها ومرشحاتها؛ يعيد `{ items, pagination, availableFilters, snapshot }`. لا يعرض حالة النموذج الخام أو الثقة الرقمية أو نطاق الموثوقية أو بيانات الأدلة الخام. صيغة استعلام غير صالحة تعيد 400، والصفحة الصحيحة خارج المدى تعيد قائمة فارغة مع بيانات ترقيم صحيحة.

## Advertising (Google AdSense)

يوفر التطبيق تكاملاً مع Google AdSense عبر مكونات خادم (Server Components) مشروطة بمتغيرات البيئة ومحمية ضد انزياح التخطيط التراكمي (CLS).

### 1. بنية المكونات وتوصيلها (Wiring)
- **`src/lib/ads.ts`**: يقرأ ويتحقق من متغيرات البيئة (`NEXT_PUBLIC_ENABLE_ADS`, `NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT_ID`, `NEXT_PUBLIC_ADSENSE_SLOT_BOTTOM`, `NEXT_PUBLIC_ADSENSE_SLOT_SIDEBAR`). إذا كانت الإعلانات معطلة أو المعرفات ناقصة، تُرجع المكونات `null` فورًا (لا تستهلك أي مساحة ولا تدرج أي نصوص).
- **`AdBottomBanner` (`src/components/ads/AdBottomBanner.tsx`)**: مكون خادم (Server Component) لشريط الإعلان الأفقي السفلي (`horizontal` format). يحجز مساحة مسبقة (~130px على الشاشات الكبيرة و~280px على الشاشات الصغيرة) لمنع CLS.
- **`AdSidebarBanner` (`src/components/ads/AdSidebarBanner.tsx`)**: مكون خادم لشريط الإعلان الجانبي المستطيل (`rectangle` format) لعمود بعرض ~300px، مع حجز مساحة مسبقة 250px.
- **`AdSlotPush` (`src/components/ads/AdSlotPush.tsx`)**: مكون عميل (`'use client'`) يستدعي `(window.adsbygoogle = window.adsbygoogle || []).push({})` بأمان عند التركيب مع معالجة استثناءات أدوات حظر الإعلانات.
- **`AdSenseScript` (`src/components/ads/AdSenseScript.tsx`)**: مكون خادم يدرج تهيئة Consent Mode v2 (جميع الأذونات `denied` افتراضيًا) ومحمّل نصوص AdSense عبر `next/script` باستراتيجية `afterInteractive`.
- **`ConsentBanner` (`src/components/ads/ConsentBanner.tsx`)**: مكون عميل لإدارة موافقة المستخدم وتحديث Consent Mode v2 وفق اللوائح الإعلانية.

### 2. تمييز الإعلانات عن محتوى الدليل
- تلتزم مساحات الإعلانات بهوية بصرية متباينة تمامًا عن بطاقات التجار التحريرية:
  - إطار خارجي منقط دقيق (dashed hairline: `border-dashed`).
  - خلفية بلون خافت لتمييز المساحة الإعلانية.
  - وسم واضح وصغير «إعلان» أو "Ad" يعرّف طبيعة المساحة للمستخدم.
- الانهيار التلقائي عند عدم التوفر (Auto-collapse): تطبق الحاويات قاعدة `.ad-slot:has(ins[data-ad-status='unfilled']) { display: none !important; }` لتختفي تلقائيًا دون ترك فراغ عند عدم توفر إعلان.

### 3. أماكن التوزيع (Placements)
- **الشريط السفلي (Bottom Banner)**: يوضع أسفل المحتوى الرئيسي وقبل تذييل الموقع (`SiteFooter`) في `layout.tsx` أو الصفحات المسموح بها.
- **الشريط الجانبي (Sidebar Banner)**: يوضع داخل الأعمدة الجانبية (بعرض ~300px) في صفحات الدليل والبحث.

### 4. قائمة التحقق للإطلاق والإنتاج (Go-Live Checklist)
1. **تفعيل الإعلانات**: ضبط `NEXT_PUBLIC_ENABLE_ADS=1` في بيئة الإنتاج.
2. **معرّف الناشر**: تعيين `NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT_ID` بالمعرّف الحقيقي (صيغة `ca-pub-XXXXXXXXXXXXXXXX`).
3. **معرّفات الوحدات الإعلانية**: إنشاء وحدات إعلانية في لوحة تحكم AdSense وتعيين `NEXT_PUBLIC_ADSENSE_SLOT_BOTTOM` و`NEXT_PUBLIC_ADSENSE_SLOT_SIDEBAR`.
4. **استبدال ملف `ads.txt`**: في ملف `public/ads.txt`، استبدل المعرف المؤقت `pub-XXXXXXXXXXXXXX` بمعرف الناشر الفعلي ليصبح السطر:
   `google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0`
5. **إدارة الموافقة (Consent Mode v2)**: التأكد من تفعيل وضع الموافقة الافتراضي (`ad_storage: denied` و`ad_personalization: denied`) قبل بدء تحميل إعلانات AdSense المخصصة.
6. **الاستضافة التجارية**: تتطلب إعلانات AdSense استضافة تسمح بالاستخدام التجاري (تجنب خطط Vercel Hobby المجانية التي تحظر الإعلانات).

### 5. السياسة الإلزامية وسلامة العلامة التجارية (Brand Safety Policy Rule)
- **قاعدة حظر الإعلانات مع الادعاءات السلبية**: يُحظر تمامًا عرض الإعلانات على أي صفحة تحمل ادعاءات سلبية، أو تحذيرات رسمية، أو مؤشرات احتيال/مخاطر عالية ضد أي تاجر محدد (مثل صفحات `/merchant/[id]` التي توثق بلاغات أو تحذيرات نصب). يلتزم النظام بدالة `canDisplayAdsOnPage` في `src/lib/ads.ts` لحجب الإعلانات برمجيًا على هذه الصفحات منعًا لمخالفة سياسات شبكات الإعلانات وحماية للنزاهة التحريرية.

## تنبيه

النتائج مبنية على بحث آلي في مصادر عامة، وقد تكون قديمة أو ناقصة، وهي ليست تقييم موثوقية ولا حكمًا نهائيًا على أي تاجر — افتح المصادر الأصلية واحكم بنفسك.
