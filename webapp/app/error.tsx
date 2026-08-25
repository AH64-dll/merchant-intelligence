'use client';

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="py-16 text-center">
      <h1 className="text-xl font-bold mb-4">حدث خطأ غير متوقع.</h1>
      <button type="button" onClick={() => reset()} className="border border-black px-4 py-2">
        إعادة المحاولة
      </button>
    </div>
  );
}
