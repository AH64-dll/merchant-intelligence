import { FileSearch } from 'lucide-react';

export default function SearchLoading() {
  return (
    <section className="search-empty-panel" aria-live="polite" aria-busy="true">
      <div className="large-empty-icon" aria-hidden="true">
        <FileSearch size={38} />
      </div>
      <h2 dir="auto">
        <span>جارٍ البحث…</span>
        <span style={{ marginInline: '8px', opacity: 0.5 }}>/</span>
        <span>Searching…</span>
      </h2>
      <p dir="auto">
        <span>يتم الآن البحث في الأدلة العامة المرتبطة بالتجار.</span>
        <span style={{ display: 'block', fontSize: '11px', marginTop: '4px', opacity: 0.8 }}>
          Searching public vendor evidence records.
        </span>
      </p>
    </section>
  );
}
