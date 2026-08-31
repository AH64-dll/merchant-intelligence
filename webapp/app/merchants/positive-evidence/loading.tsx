/**
 * Route-level loading state for /merchants/positive-evidence. The heading and
 * disclaimer render immediately so the non-guarantee framing is never
 * delayed behind the snapshot read.
 */
export default function PositiveEvidenceDirectoryLoading() {
  return (
    <section className="flex w-full flex-col gap-6 py-8" aria-busy="true">
      <h1 className="text-2xl font-bold">البائعون ذوو أقوى الأدلة الإيجابية</h1>
      <p dir="auto">
        ترتيب حسب قوة وتنوع الأدلة الإيجابية المنشورة؛ لا يمثل ضمانًا لجودة
        البائع أو نتيجة الشراء.
      </p>
      <p>جارٍ تحميل القائمة…</p>
    </section>
  );
}
