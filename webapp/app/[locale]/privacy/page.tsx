import type { JSX } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { isLocale, type Locale } from '@/lib/i18n';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Cookie,
  Megaphone,
  Scale,
  Shield,
  ShieldCheck,
} from 'lucide-react';

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

export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<JSX.Element> {
  const { locale: rawLocale } = await params;
  if (!isLocale(rawLocale)) notFound();
  const locale = rawLocale;
  const isEn = locale === 'en';

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

          {/* Section 02: Cookies & Technical Preferences */}
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

        {/* Section 02: Cookies & Technical Preferences */}
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
}
