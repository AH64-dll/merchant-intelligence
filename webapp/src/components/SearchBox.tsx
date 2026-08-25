export function SearchBox({ defaultValue }: { defaultValue?: string }) {
  return (
    <form action="/search" method="get" className="flex w-full max-w-xl gap-2">
      <input
        type="text"
        name="q"
        defaultValue={defaultValue}
        placeholder="رقم الهاتف، اسم التاجر، أو رابط الصفحة"
        dir="auto"
        aria-label="بحث عن تاجر"
        className="w-full border border-black px-3 py-2 text-base"
      />
      <button
        type="submit"
        className="border border-black px-4 py-2 text-base"
      >
        بحث
      </button>
    </form>
  );
}
