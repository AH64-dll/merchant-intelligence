import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  FileText,
  Fingerprint,
  FileSearch,
  Scale,
  Building2,
  Search,
  ArrowLeft,
  ArrowRight,
} from 'lucide-react';

import { SearchBox } from '@/components/SearchBox';
import { isLocale, t } from '@/lib/i18n';
import { AdBottomBanner } from '@/components/ads';

function ResearchIllustration({ isEn }: { isEn: boolean }) {
  const evidenceLabel = isEn ? 'Evidence' : 'الأدلة';
  const sourceLabel = isEn ? 'Source' : 'المصدر';
  const identityLabel = isEn ? 'Identity' : 'الهوية';
  const contextLabel = isEn ? 'Context' : 'السياق';

  return (
    <div className="research-art" aria-hidden="true">
      <div className="art-orbit orbit-one" />
      <div className="art-orbit orbit-two" />
      <div className="art-cross cross-one">+</div>
      <div className="art-cross cross-two">+</div>
      <div className="document document-back">
        <div className="document-top">
          <span />
          <span />
        </div>
        <div className="document-line" />
        <div className="document-line short" />
      </div>
      <div className="document document-front">
        <div className="document-heading">
          <FileText size={15} />
          <span>{evidenceLabel}</span>
          <span className="document-dots">···</span>
        </div>
        <div className="document-divider" />
        <div className="document-line" />
        <div className="document-line" />
        <div className="document-line short" />
        <div className="document-source">
          <span className="tiny-dot" />
          {sourceLabel}
          <span className="source-dash" />
        </div>
      </div>
      <div className="identity-lens">
        <Fingerprint size={55} />
        <span className="lens-handle" />
      </div>
      <div className="art-label">
        <span className="tiny-dot" />
        {identityLabel}
        <span>·</span>
        {evidenceLabel}
        <span>·</span>
        {contextLabel}
      </div>
    </div>
  );
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const strings = t(locale);
  const isEn = locale === 'en';

  const examples = [
    { label: strings.exampleVendorName, example: strings.exampleVendorSample },
    { label: strings.examplePhone, example: strings.examplePhoneSample },
    { label: strings.exampleLink, example: strings.exampleLinkSample },
  ] as const;

  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-top">
          <div className="hero-copy">
            <div className="eyebrow">
              <span />
              {isEn
                ? 'SEARCH WITH CLARITY. DECIDE WITH CONTEXT.'
                : 'ابحث بوضوح. قرّر بمعرفة.'}
            </div>
            <h1 id="hero-title">
              {isEn
                ? 'Behind every vendor, information worth exploring.'
                : 'وراء كل تاجر، معلومات تستحق البحث.'}
            </h1>
            <p>
              {isEn
                ? 'Explore a vendor’s identity, trace public evidence to its sources, and understand what the available information says — and what it doesn’t.'
                : 'ابحث عن هوية التاجر، واستكشف الأدلة ومصادرها العامة، وافهم ما تقوله البيانات المتاحة — وما لا تقوله.'}
            </p>
          </div>
          <ResearchIllustration isEn={isEn} />
        </div>

        <SearchBox locale={locale} />

        <div className="recent-searches">
          <span>{isEn ? 'Try searching:' : 'أمثلة للبحث:'}</span>
          {examples.map(({ label, example }) => (
            <Link
              key={label}
              href={`/${locale}/search?q=${encodeURIComponent(example)}`}
              className="recent-link"
            >
              <Search size={12} aria-hidden="true" />
              <span>{label}: </span>
              <bdi
                dir={/^[+\d]|https?:/i.test(example) ? 'ltr' : 'auto'}
                className={/^[+\d]|https?:/i.test(example) ? 'ltr-isolate' : undefined}
              >
                {example}
              </bdi>
            </Link>
          ))}
        </div>
      </section>

      <section className="process-section" aria-labelledby="process-title">
        <div className="section-heading">
          <div>
            <p className="section-kicker">
              {isEn
                ? 'A CLEARER PICTURE, STEP BY STEP'
                : 'صورة أوضح، خطوة بخطوة'}
            </p>
            <h2 id="process-title">
              {isEn
                ? 'Look past impressions. Start with evidence.'
                : 'لا تكتفِ بالانطباع. ابدأ بالأدلة.'}
            </h2>
          </div>
          <Link href={`/${locale}/privacy`} className="text-link">
            {isEn ? 'How Merchant Intelligence works' : 'كيف يعمل دليل التجار'}
            {isEn ? (
              <ArrowRight size={14} className="link-arrow" aria-hidden="true" />
            ) : (
              <ArrowLeft size={14} className="link-arrow" aria-hidden="true" />
            )}
          </Link>
        </div>
        <div className="steps-grid">
          <div className="step-card">
            <div className="step-top">
              <span className="step-icon">
                <Fingerprint size={23} aria-hidden="true" />
              </span>
              <span className="step-number">01</span>
            </div>
            <h3>{isEn ? 'Establish the identity' : 'حدّد هوية التاجر'}</h3>
            <p>
              {isEn
                ? 'Start with a name, identifier, or phone number. Distinguish between vendors with similar names.'
                : 'ابدأ باسم أو معرّف أو رقم، وميّز بين التجار ذوي الأسماء المتشابهة بدقة.'}
            </p>
          </div>
          <div className="step-card">
            <div className="step-top">
              <span className="step-icon">
                <FileSearch size={23} aria-hidden="true" />
              </span>
              <span className="step-number">02</span>
            </div>
            <h3>{isEn ? 'Read evidence in context' : 'اقرأ الأدلة في سياقها'}</h3>
            <p>
              {isEn
                ? 'Explore claims, public records, and evidence dates, and what supports or contradicts them.'
                : 'اطّلع على البيانات ومصادرها وتواريخها، وما يدعمها أو يوثقها في سياقها الحقيقي.'}
            </p>
          </div>
          <div className="step-card">
            <div className="step-top">
              <span className="step-icon">
                <Scale size={23} aria-hidden="true" />
              </span>
              <span className="step-number">03</span>
            </div>
            <h3>{isEn ? 'Build a balanced picture' : 'كوّن صورة متوازنة'}</h3>
            <p>
              {isEn
                ? 'Understand what is available, what is verified, and what remains unknown.'
                : 'تعرّف على ما هو متاح وموثّق، وما يزال غير معلوم، وقرّر بمعرفة ووضوح.'}
            </p>
          </div>
        </div>
      </section>

      <div className="home-bottom">
        <section className="directory-preview">
          <div className="preview-heading">
            <div>
              <h2>
                <Building2 size={19} aria-hidden="true" />
                {strings.directory}
              </h2>
              <p>
                {isEn
                  ? 'An index of merchant identities and public evidence, not recommendations.'
                  : 'فهرس للهويات والبيانات العامة المتاحة، وليس قائمة توصيات.'}
              </p>
            </div>
            <Link href={`/${locale}/merchants`} className="text-link">
              {isEn ? 'Explore directory' : 'استكشف الدليل'}
              {isEn ? (
                <ArrowRight
                  size={14}
                  className="link-arrow"
                  aria-hidden="true"
                />
              ) : (
                <ArrowLeft
                  size={14}
                  className="link-arrow"
                  aria-hidden="true"
                />
              )}
            </Link>
          </div>
          <div className="directory-empty">
            <div className="empty-index-icon">
              <Building2 size={29} aria-hidden="true" />
              <span className="empty-index-small">
                <Search size={13} aria-hidden="true" />
              </span>
            </div>
            <h3>
              {isEn
                ? 'Browse verified merchant records'
                : 'تصفح سجلات التجار المتاحة'}
            </h3>
            <p>
              {isEn
                ? 'Explore merchant identities, governorates, and documented public evidence across Egypt.'
                : 'استكشف هويات التجار والمحافظات والأدلة العامة الموثقة في مصر.'}
            </p>
          </div>
        </section>

        <aside className="principle-card">
          <Scale size={27} aria-hidden="true" />
          <span className="principle-overline">
            {isEn ? 'Independent research platform' : 'منصة بحث مستقلة'}
          </span>
          <h2>
            {isEn ? 'Evidence is not an endorsement.' : 'الأدلة ليست تزكية.'}
          </h2>
          <p>
            {isEn
              ? 'Information about a vendor is not a guarantee. An absence of evidence is not an absence of risk. We show what is known — and what isn’t.'
              : 'المعلومات عن التاجر ليست ضمانة. وغياب الدليل ليس دليلًا على الأمان. نعرض ما هو متاح — وما ليس متاحًا.'}
          </p>
          <Link href={`/${locale}/privacy`} className="text-link">
            {isEn ? 'Read our principles' : 'اقرأ منهجيتنا ومبادئنا'}
            {isEn ? (
              <ArrowRight
                size={14}
                className="link-arrow"
                aria-hidden="true"
              />
            ) : (
              <ArrowLeft size={14} className="link-arrow" aria-hidden="true" />
            )}
          </Link>
          <div className="principle-line" aria-hidden="true" />
        </aside>
      </div>

      <AdBottomBanner locale={locale} />
      <p dir="auto" className="sr-only">
        {strings.homeDisclaimer}
      </p>
    </>
  );
}
