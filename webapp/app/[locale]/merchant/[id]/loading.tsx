import { Fingerprint } from 'lucide-react';

/**
 * Merchant detail loading state — bilingual (loading fallbacks never receive
 * route params under static export).
 */
export default function MerchantLoading() {
  return (
    <section className="search-empty-panel" aria-live="polite" aria-busy="true">
      <div className="large-empty-icon" aria-hidden="true">
        <Fingerprint size={38} />
      </div>
      <h2 dir="auto">
        <span>جارٍ تحميل بيانات التاجر…</span>
        <span style={{ marginInline: '8px', opacity: 0.5 }}>/</span>
        <span>Loading vendor data…</span>
      </h2>
      <p dir="auto">
        <span>يتم الآن جمع الأدلة والمعرفات المرتبطة بهذا التاجر.</span>
        <span style={{ display: 'block', fontSize: '11px', marginTop: '4px', opacity: 0.8 }}>
          Gathering evidence and identifiers linked to this vendor.
        </span>
      </p>
    </section>
  );
}
