# ميزان التاجر — بحث عن التجار

محرك بحث عن التجار المصريين: أدخل رقم هاتف، أو اسم تاجر، أو رابط صفحة/حساب، فتحصل على أقرب تطابق مع كل ما تستنتجه قاعدة البيانات عنه (الحكم على الموثوقية، آراء المستخدمين، والتحليل).

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
2. التحقق من أن مخطط المصدر `schema_version = 3`، ومراقبة تعديل المصدر أثناء النسخ عبر `PRAGMA data_version` + مقارنة أعداد الجداول التسعة، مع إعادة المحاولة حتى ثلاث مرات.
3. تشغيل التدقيق الصارم `scripts/audit-data.mjs --strict` على النسخة المؤقتة؛ أي خطأ قاتل يُلغي العملية.
4. كتابة جدول `snapshot_meta` (صف واحد: `app_schema_version=1`, `source_schema_version=3`, وقت التوليد UTC، أحدث `captured_at`/`updated_at` في المصدر، وأعداد تسع جداول) داخل النسخة المؤقتة فقط.
5. الاستبدال الذري عبر `mv`؛ أي فشل يترك النسخة السابقة كما هي بايت ببايت. قفل `flock` غير حاجب يمنع تشغيلين متزامنين.

```bash
pnpm snapshot          # بناء نسخة جديدة من المصدر الافتراضي
pnpm snapshot:verify   # تدقيق صارم للنسخة الحالية (يُشغَّل داخل بناء Docker أيضًا)
SRC_DB=/path/to/other.db bash scripts/snapshot-db.sh   # مصدر بديل
DEST_DB=/path/to/out.db bash scripts/snapshot-db.sh    # وجهة بديلة
```

عند بدء التشغيل يتحقق `MerchantDb` من `snapshot_meta` (الإصداران 1/3 وتطابق الأعداد) ويفشل بوضوح إن كانت النسخة قديمة أو ناقصة؛ لا يوجد تراجع إلى صيغة قديمة. تصديرات `data/export/*.json|csv|jsonl` تشخيصية تاريخية فقط ولا يقرؤها التطبيق أبدًا.

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

## واجهة API

- `GET /api/search?q=…` — بحث بالاسم أو الهاتف أو الرابط. يعيد `{ query, detectedType, hits[] }`؛ استعلام فارغ يعيد 400.
- `GET /api/merchants/[id]` — تفاصيل تاجر كاملة (معرّفات، أسماء بديلة، أدلة، مطالبات، تحليل، مشاعر، تجار مرتبطون)؛ معرّف غير معروف يعيد 404.

## تنبيه

النتائج مبنية على بحث آلي من مصادر عامة وقد تكون قديمة أو ناقصة.
