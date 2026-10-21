import Link from 'next/link';
import { FileQuestion, ArrowLeft, ArrowRight } from 'lucide-react';

/**
 * Root 404 — the static export emits a single not-found shell served for both
 * locales, so text is bilingual and the fallback link goes to /ar (default).
 * Client-side locale detection can't run here without a hydration flicker,
 * and the root segment has no reliable locale param.
 */
export default function NotFound() {
  return (
    <section className="search-empty-panel" role="status">
      <div className="large-empty-icon" aria-hidden="true">
        <FileQuestion size={38} />
      </div>
      <h2 dir="auto">
        <span>الصفحة غير موجودة</span>
        <span style={{ marginInline: '8px', opacity: 0.5 }}>/</span>
        <span>Page not found</span>
      </h2>
      <p dir="auto">
        <span>الرابط الذي اتبعته غير صحيح أو أن الصفحة لم تعد متاحة.</span>
        <span style={{ display: 'block', fontSize: '11px', marginTop: '4px', opacity: 0.8 }}>
          The link you followed is incorrect, or this page is no longer available.
        </span>
      </p>
      <div className="empty-actions">
        <Link href="/ar" className="secondary-button">
          <ArrowLeft size={14} aria-hidden="true" />
          <span dir="auto">العودة إلى الرئيسية</span>
        </Link>
        <Link href="/en" className="secondary-button">
          <ArrowRight size={14} aria-hidden="true" />
          <span dir="auto">Back to home</span>
        </Link>
      </div>
    </section>
  );
}
