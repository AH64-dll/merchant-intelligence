import type { JSX } from 'react';
import type { Verdict } from '@/lib/verdict';

const TONE_LABELS: Record<Verdict['tone'], string> = {
  good: 'إيجابي',
  mixed: 'متباين',
  warn: 'تحذيري',
  bad: 'خطر',
  unknown: 'غير محدد',
};

export function VerdictCard({ verdict }: { verdict: Verdict }): JSX.Element {
  return (
    <section aria-labelledby="verdict-heading">
      <h2 id="verdict-heading">الحكم</h2>
      <p dir="auto">{verdict.label}</p>
      <p dir="auto">
        التصنيف: {TONE_LABELS[verdict.tone]}
      </p>
      <p dir="auto">{verdict.reason}</p>
    </section>
  );
}
