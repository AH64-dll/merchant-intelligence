export function SearchBox({ defaultValue }: { defaultValue?: string }) {
  return (
    <form action="/search" method="get" role="search" className="flex w-full max-w-xl flex-col gap-2 sm:flex-row">
      <label htmlFor="merchant-search" className="text-base font-bold">
        ابحث عن تاجر
      </label>
      <div className="flex w-full gap-2">
        <input
          id="merchant-search"
          type="search"
          name="q"
          defaultValue={defaultValue}
          maxLength={300}
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          dir="auto"
          required
          minLength={1}
          aria-describedby="merchant-search-hint"
          className="min-h-[44px] w-full border border-black px-3 py-2 text-base"
        />
        <button
          type="submit"
          className="min-h-[44px] min-w-[44px] border border-black px-6 py-2 text-base font-bold"
        >
          بحث
        </button>
      </div>
      <p id="merchant-search-hint" className="text-sm">
        رقم هاتف مصري، أو اسم تاجر، أو رابط صفحة/حساب.
      </p>
    </form>
  );
}
