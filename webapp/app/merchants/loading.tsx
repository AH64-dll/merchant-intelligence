/**
 * Route-level loading state for /merchants. Static Arabic skeleton matching
 * the shell structure — no data is rendered before the snapshot read lands.
 */
export default function MerchantsDirectoryLoading() {
  return (
    <section className="flex w-full flex-col gap-6 py-8" aria-busy="true">
      <h1 className="text-2xl font-bold">جميع البائعين</h1>
      <p>جارٍ تحميل قائمة البائعين…</p>
      <div className="border border-black p-4 text-sm">
        تُعرض 20 بائعًا في الصفحة، مع مرشحات التصنيف والمحافظة وتغطية
        الأدلة، من لقطة البيانات الحالية.
      </div>
    </section>
  );
}
