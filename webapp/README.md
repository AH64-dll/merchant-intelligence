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

التطبيق لا يفتح قاعدة بيانات خط المعالجة مباشرة أبدًا؛ يقرأ نسخة مضغوطة بلا WAL في `data/merchants.db` أنشأها السكربت عبر `VACUUM INTO`:

```bash
bash scripts/snapshot-db.sh          # المسار الافتراضي للمصدر
SRC_DB=/path/to/other.db bash scripts/snapshot-db.sh   # مصدر بديل
# أو: pnpm snapshot
```

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

تُنسخ `data/merchants.db` داخل الصورة وتُقرأ من `MERCHANTS_DB=/app/data/merchants.db` (readonly).

## متغيرات البيئة

| المتغير | الافتراضي | الوصف |
| --- | --- | --- |
| `MERCHANTS_DB` | `./data/merchants.db` | مسار نسخة قاعدة البيانات |

## واجهة API

- `GET /api/search?q=…` — بحث بالاسم أو الهاتف أو الرابط. يعيد `{ query, detectedType, hits[] }`؛ استعلام فارغ يعيد 400.
- `GET /api/merchants/[id]` — تفاصيل تاجر كاملة (معرّفات، أسماء بديلة، أدلة، مطالبات، تحليل، مشاعر، تجار مرتبطون)؛ معرّف غير معروف يعيد 404.

## تنبيه

النتائج مبنية على بحث آلي من مصادر عامة وقد تكون قديمة أو ناقصة.
