import Link from 'next/link';

import { SearchBox } from '@/components/SearchBox';

const EXAMPLES = [
  { label: 'اسم تاجر', example: 'بي تك' },
  { label: 'رقم هاتف مصري', example: '+201000000000' },
  { label: 'رابط صفحة', example: 'https://facebook.com/PageName' },
] as const;

/** Two directory calls to action under the search box. */
const DIRECTORIES = [
  {
    href: '/merchants',
    title: 'جميع البائعين',
    body: 'استعرض كل البائعين الأساسيين مرتَّبين أبجديًا، مع مرشحات التصنيف والمحافظة وتغطية الأدلة.',
  },
  {
    href: '/merchants/positive-evidence',
    title: 'البائعون ذوو أقوى الأدلة الإيجابية',
    body: 'قائمة مرتَّبة حسب قوة وتنوع الأدلة الإيجابية المنشورة — ليست ضمانًا لجودة البائع أو نتيجة الشراء.',
  },
] as const;

export default function HomePage() {
  return (
    <section className="flex flex-col items-center gap-6 py-16 text-center">
      <h1 className="text-3xl font-bold">ميزان التاجر</h1>
      <p dir="auto" className="max-w-xl text-base">
        ابحث عن هوية تاجر والأدلة العامة المرتبطة به — بالاسم، أو برقم هاتف
        مصري، أو برابط صفحته أو حسابه.
      </p>
      <SearchBox />
      <ul className="flex flex-wrap justify-center gap-3 text-sm">
        {EXAMPLES.map(({ label, example }) => (
          <li key={label} className="border border-black px-3 py-2">
            <a href={`/search?q=${encodeURIComponent(example)}`} className="underline">
              {label}: <bdi dir="auto">{example}</bdi>
            </a>
          </li>
        ))}
      </ul>
      <ul className="flex w-full flex-wrap justify-center gap-4" aria-label="الدلائل">
        {DIRECTORIES.map(({ href, title, body }) => (
          <li key={href} className="flex max-w-sm flex-col gap-2 border border-black p-4 text-right">
            <Link
              href={href}
              className="inline-block min-h-[44px] py-2 text-base font-bold underline underline-offset-2"
            >
              <span dir="auto">{title}</span>
            </Link>
            <p dir="auto" className="text-sm">
              {body}
            </p>
          </li>
        ))}
      </ul>
      <p dir="auto" className="max-w-xl text-sm">
        تلخّص النتائج أدلة من مصادر عامة فقط، وقد تكون قديمة أو ناقصة، وهي ليست
        ضمانًا ولا حكمًا نهائيًا على أي تاجر.
      </p>
    </section>
  );
}
