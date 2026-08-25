import { SearchBox } from '@/components/SearchBox';

export default function HomePage() {
  return (
    <section className="flex flex-col items-center gap-6 py-16 text-center">
      <h1 className="text-3xl font-bold">ميزان التاجر</h1>
      <p dir="auto" className="max-w-xl text-base">
        ابحث برقم الهاتف أو اسم التاجر أو رابط صفحته لترى تقييم موثوقيته
        وآراء العملاء وتحليل البيانات المتوفرة عنه.
      </p>
      <SearchBox />
    </section>
  );
}
