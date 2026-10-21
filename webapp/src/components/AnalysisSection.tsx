import type { JSX } from 'react';
import { FileSearch, FileText } from 'lucide-react';

import type { AnalysisPayload } from '@/lib/types';
import { t, type Locale } from '@/lib/i18n';
function SignalList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section className="bg-[#fdfcf9] border border-[#e4e3de] rounded p-4 space-y-1.5">
      <h3 className="font-semibold text-xs text-[#2a3441] border-b border-[#e4e3de] pb-1.5">{title}</h3>
      <ul className="mt-2 list-disc list-inside space-y-1 text-xs text-[#56606a]">
        {items.map((item, index) => (
          <li key={index} dir="auto">
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The stored automated analysis, framed as model output to verify — never as
 * a verdict, and never with confidence percentages.
 */
export function AnalysisSection({
  analysis,
  locale = 'ar',
}: {
  analysis: AnalysisPayload | null;
  locale?: Locale;
}): JSX.Element {
  const strings = t(locale);

  if (analysis === null) {
    return (
      <div className="report-unavailable">
        <FileText size={19} aria-hidden="true" />
        <p>{strings.noAnalysisYet}</p>
        <span>—</span>
      </div>
    );
  }

  const hasClaims = analysis.verifiedClaims.length > 0 || analysis.unverifiedClaims.length > 0;

  return (
    <section id="analysis" aria-labelledby="analysis-heading" className="report-section space-y-4">
      <h2>
        <FileSearch size={21} aria-hidden="true" />
        <span id="analysis-heading">{locale === 'en' ? 'Automated Analysis' : 'تحليل آلي'}</span>
      </h2>
      <p className="section-note">
        {strings.automatedAnalysisNotice}
      </p>
      {analysis.evidenceSummary.trim().length > 0 && (
        <section>
          <h3 className="font-bold text-sm">{strings.evidenceSummaryHeading}</h3>
          <p dir="auto" className="mt-1 text-sm">{analysis.evidenceSummary}</p>
        </section>
      )}

      {hasClaims && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {analysis.verifiedClaims.length > 0 && (
            <section className="bg-[#fdfcf9] border border-[#e4e3de] rounded p-4 space-y-1.5">
              <h3 className="font-semibold text-xs text-[#2a3441] border-b border-[#e4e3de] pb-1.5">{strings.verifiedClaims}</h3>
              <ul className="mt-2 list-disc list-inside space-y-1 text-xs text-[#56606a]">
                {analysis.verifiedClaims.map((claim, index) => (
                  <li key={index} dir="auto">
                    {claim}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {analysis.unverifiedClaims.length > 0 && (
            <section className="bg-[#fdfcf9] border border-[#e4e3de] rounded p-4 space-y-1.5">
              <h3 className="font-semibold text-xs text-[#2a3441] border-b border-[#e4e3de] pb-1.5">{strings.unverifiedClaims}</h3>
              <ul className="mt-2 list-disc list-inside space-y-1 text-xs text-[#56606a]">
                {analysis.unverifiedClaims.map((claim, index) => (
                  <li key={index} dir="auto">
                    {claim}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      <SignalList title={strings.signalsRequiringVerification} items={analysis.riskSignals} />
      <SignalList title={strings.positiveSignals} items={analysis.positiveSignals} />
      <SignalList title={strings.contradictions} items={analysis.contradictions} />
      <SignalList title={strings.missingInformation} items={analysis.missingInformation} />

      {(
        [
          { title: strings.reputationNotesHeading, note: analysis.reputationNotes },
          { title: strings.fraudRiskNotesHeading, note: analysis.fraudRiskNotes },
          { title: strings.consumerSatisfactionNotesHeading, note: analysis.consumerSatisfactionNotes },
        ] as const
      ).map(({ title, note }) => {
        if (!note || note.trim().length === 0) return null;
        return (
          <section key={title} className="bg-[#fafaf6] border border-[#e4e3de] rounded p-4 space-y-1">
            <h3 className="font-semibold text-xs text-[#2a3441]">{title}</h3>
            <p dir="auto" className="mt-1 text-xs text-[#56606a] leading-relaxed">{note}</p>
          </section>
        );
      })}
    </section>
  );
}
