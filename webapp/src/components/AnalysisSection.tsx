import type { JSX } from 'react';

import type { AnalysisPayload } from '@/lib/types';

function SignalList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section>
      <h3>{title}</h3>
      <ul>
        {items.map((item, i) => (
          <li key={i} dir="auto">
            - {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AnalysisSection({ analysis }: { analysis: AnalysisPayload | null }): JSX.Element {
  if (analysis === null) {
    return <p>لا يوجد تحليل كافٍ لهذا التاجر بعد.</p>;
  }

  const hasClaims =
    analysis.verifiedClaims.length > 0 || analysis.unverifiedClaims.length > 0;

  return (
    <section aria-labelledby="analysis-heading">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="analysis-heading">تحليل التاجر</h2>
        {analysis.requiresMoreResearch && (
          <span>[يتطلب بحثًا إضافيًا]</span>
        )}
      </div>

      {analysis.evidenceSummary.trim().length > 0 && (
        <section>
          <h3>ملخص الأدلة</h3>
          <p dir="auto">{analysis.evidenceSummary}</p>
        </section>
      )}

      <p>
        تنوع المصادر: <span dir="ltr">{analysis.sourceDiversity}</span> · مستوى
        ثقة الأدلة: <span dir="ltr">{Math.round(analysis.evidenceConfidence * 100)}%</span>
      </p>

      {hasClaims && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {analysis.verifiedClaims.length > 0 && (
            <section>
              <h3>ادعاءات موثقة</h3>
              <ul>
                {analysis.verifiedClaims.map((claim, i) => (
                  <li key={i} dir="auto">
                    - {claim}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {analysis.unverifiedClaims.length > 0 && (
            <section>
              <h3>ادعاءات غير موثقة</h3>
              <ul>
                {analysis.unverifiedClaims.map((claim, i) => (
                  <li key={i} dir="auto">
                    - {claim}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
      <SignalList title="إشارات خطورة" items={analysis.riskSignals} />
      <SignalList title="نقاط إيجابية" items={analysis.positiveSignals} />
      <SignalList title="تناقضات" items={analysis.contradictions} />
      <SignalList title="معلومات ناقصة" items={analysis.missingInformation} />

      {(
        [
          { title: 'ملاحظات السمعة', note: analysis.reputationNotes },
          { title: 'ملاحظات المخاطر الاحتيالية', note: analysis.fraudRiskNotes },
          { title: 'رضا المستهلكين', note: analysis.consumerSatisfactionNotes },
        ] as const
      ).map(({ title, note }) => {
        const text = note.trim();
        if (text.length === 0) return null;
        return (
          <p key={title} dir="auto">
            <strong>{title}:</strong> {text}
          </p>
        );
      })}
    </section>
  );
}
