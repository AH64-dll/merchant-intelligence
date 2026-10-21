import { Building2 } from 'lucide-react';

/**
 * Route-level loading state for /merchants.
 * Static export never passes route params to loading fallbacks, so this
 * renders a bilingual caption — always correct regardless of locale.
 */
export default function MerchantsDirectoryLoading() {
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">
          <span />
          <span dir="auto">دليل البائعين</span>
          <span aria-hidden="true">·</span>
          <span dir="auto">Vendors</span>
        </div>
        <h1>
          <Building2 size={27} aria-hidden="true" />
          <span dir="auto">جميع البائعين</span>
          <span aria-hidden="true"> · </span>
          <span dir="auto">All Vendors</span>
        </h1>
        <p dir="auto">
          <span>جارٍ تحميل قائمة البائعين…</span>
          <span style={{ marginInline: '8px', opacity: 0.5 }}>/</span>
          <span>Loading the vendor directory…</span>
        </p>
      </div>

      <section className="index-panel" aria-busy="true">
        <div className="index-toolbar">
          <h2>
            <Building2 size={18} aria-hidden="true" />
            <span dir="auto">جميع البائعين</span>
            <span aria-hidden="true"> · </span>
            <span dir="auto">All Vendors</span>
            <span className="unavailable-count">—</span>
          </h2>
        </div>
        <div className="directory-empty">
          <div className="empty-index-icon">
            <Building2 size={29} aria-hidden="true" />
          </div>
          <h3 dir="auto">
            <span>جارٍ تحميل بيانات البائعين من لقطة البيانات الحالية…</span>
            <span style={{ display: 'block', fontSize: '11px', marginTop: '4px', opacity: 0.8 }}>
              Loading vendor records from the current data snapshot…
            </span>
          </h3>
        </div>
      </section>
    </>
  );
}
