import { Scale } from 'lucide-react';

/**
 * Route-level loading state for /merchants/positive-evidence.
 * Static export never passes route params to loading fallbacks — bilingual
 * caption keeps both locales correct.
 */
export default function PositiveEvidenceDirectoryLoading() {
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">
          <span />
          <span dir="auto">أدلة إيجابية</span>
          <span aria-hidden="true">·</span>
          <span dir="auto">Positive Evidence</span>
        </div>
        <h1>
          <Scale size={27} aria-hidden="true" />
          <span dir="auto">البائعون ذوو أقوى الأدلة الإيجابية</span>
          <span aria-hidden="true"> · </span>
          <span dir="auto">Vendors with Strongest Positive Evidence</span>
        </h1>
        <p dir="auto">
          <span>قائمة مرتبة بقوة وتنوع الأدلة الإيجابية الموثقة — وليست ضمانًا لجودة التاجر.</span>
          <span style={{ display: 'block', fontSize: '11px', marginTop: '4px', opacity: 0.8 }}>
            Ranked by documented positive-evidence strength — not a vendor-quality guarantee.
          </span>
        </p>
      </div>

      <section className="index-panel" aria-busy="true">
        <div className="index-toolbar">
          <h2>
            <Scale size={18} aria-hidden="true" />
            <span dir="auto">الأدلة الإيجابية</span>
            <span aria-hidden="true"> · </span>
            <span dir="auto">Positive Evidence</span>
            <span className="unavailable-count">—</span>
          </h2>
        </div>
        <div className="directory-empty">
          <div className="empty-index-icon">
            <Scale size={29} aria-hidden="true" />
          </div>
          <h3 dir="auto">
            <span>جارٍ تحميل قائمة البائعين…</span>
            <span style={{ display: 'block', fontSize: '11px', marginTop: '4px', opacity: 0.8 }}>
              Loading the vendor list…
            </span>
          </h3>
        </div>
      </section>
    </>
  );
}
