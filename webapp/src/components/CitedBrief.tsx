import type { JSX } from 'react';
import { Scale } from 'lucide-react';

import { PLACEHOLDER_SUMMARY, type BriefView, type EvidenceItem, type Identifier, type MerchantState } from '@/lib/types';
import { assessIdentity, assessReputation } from '@/lib/assessment';
import { t, type Locale } from '@/lib/i18n';
import { SourceCitations } from './SourceCitations';
import { formatDate } from './display';

export interface CitedBriefProps {
  id?: string;
  brief: BriefView | null;
  state: MerchantState;
  identifiers: Identifier[];
  evidence: EvidenceItem[];
  relatedRelations?: readonly string[];
  locale?: Locale;
}

interface BriefBullet {
  heading?: string;
  text: string;
  evidenceIds: string[];
}

function extractBulletsFromPayload(payload: unknown, headings: { identity: string; reputation: string; risk: string }): BriefBullet[] {
  if (!payload) return [];

  if (typeof payload === 'object' && payload !== null) {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.bullets)) {
      return obj.bullets
        .map((b): BriefBullet | null => {
          if (typeof b === 'string' && b.trim().length > 0) {
            if (b.trim().toLowerCase() === PLACEHOLDER_SUMMARY.toLowerCase()) return null;
            return { text: b.trim(), evidenceIds: [] };
          }
          if (typeof b === 'object' && b !== null) {
            const bulletObj = b as Record<string, unknown>;
            const text = typeof bulletObj.text === 'string' ? bulletObj.text.trim() : '';
            if (text.length === 0 || text.toLowerCase() === PLACEHOLDER_SUMMARY.toLowerCase()) return null;
            const heading =
              typeof bulletObj.heading === 'string' && bulletObj.heading.trim().length > 0
                ? bulletObj.heading.trim()
                : undefined;
            const evidenceIds = Array.isArray(bulletObj.evidence_ids)
              ? (bulletObj.evidence_ids.filter((id) => typeof id === 'string') as string[])
              : Array.isArray(bulletObj.evidenceIds)
                ? (bulletObj.evidenceIds.filter((id) => typeof id === 'string') as string[])
                : [];
            return { heading, text, evidenceIds };
          }
          return null;
        })
        .filter((b): b is BriefBullet => b !== null);
    }

    const textBullets: BriefBullet[] = [];
    if (typeof obj.identity_summary === 'string' && obj.identity_summary.trim().length > 0) {
      textBullets.push({
        heading: headings.identity,
        text: obj.identity_summary.trim(),
        evidenceIds: [],
      });
    }
    if (typeof obj.reputation_summary === 'string' && obj.reputation_summary.trim().length > 0) {
      textBullets.push({
        heading: headings.reputation,
        text: obj.reputation_summary.trim(),
        evidenceIds: [],
      });
    }
    if (typeof obj.risk_summary === 'string' && obj.risk_summary.trim().length > 0) {
      textBullets.push({
        heading: headings.risk,
        text: obj.risk_summary.trim(),
        evidenceIds: [],
      });
    }
    if (textBullets.length > 0) return textBullets;

    if (
      typeof obj.summary === 'string' &&
      obj.summary.trim().length > 0 &&
      obj.summary.trim().toLowerCase() !== PLACEHOLDER_SUMMARY.toLowerCase()
    ) {
      return [{ text: obj.summary.trim(), evidenceIds: [] }];
    }
  }

  return [];
}

/**
 * CitedBrief component: renders concise text bullets from the merchant brief when present,
 * or deterministic neutral fallback wording from assessIdentity / assessReputation when absent.
 * Separates identity certainty from observations about dealing with the seller, and shows evidence-id citations via SourceCitations.
 */
export function CitedBrief({
  id = 'overview',
  brief,
  state,
  identifiers,
  evidence,
  relatedRelations = [],
  locale = 'ar',
}: CitedBriefProps): JSX.Element {
  const strings = t(locale);
  const extractedBullets = brief !== null ? extractBulletsFromPayload(brief.payload, { identity: strings.briefIdentityHeading, reputation: strings.briefReputationHeading, risk: strings.briefRiskHeading }) : [];

  const bullets: BriefBullet[] =
    extractedBullets.length > 0
      ? extractedBullets
      : (() => {
          const identity = assessIdentity(state, identifiers, relatedRelations, locale);
          const reputation = assessReputation(state, evidence, locale);
          const identityQuestion =
            locale === 'en'
              ? 'What do we know about vendor identity?'
              : 'ما الذي نعرفه عن هوية المتجر؟';
          const identityText =
            identity.reasons.length > 0
              ? identity.reasons.join(' ')
              : locale === 'en'
                ? 'Available identifiers are insufficient to confirm identity.'
                : 'المعرفات المتاحة لا تكفي لتأكيد الهوية.';
          const dealingQuestion =
            locale === 'en'
              ? 'What do sources say about dealing with the vendor?'
              : 'ما الذي تقوله المصادر عن التعامل؟';
          const dealingText = `${reputation.headline}: ${reputation.explanation}`;
          return [
            { heading: identityQuestion, text: identityText, evidenceIds: [] },
            { heading: dealingQuestion, text: dealingText, evidenceIds: [] },
          ];
        })();

  return (
    <section id={id} aria-labelledby="current-picture-heading" className="report-section">
      <h2>
        <Scale size={21} aria-hidden="true" />
        <span id="current-picture-heading">{strings.currentPictureHeading}</span>
      </h2>
      <div className="mt-4 bg-[#fdfcf9] border border-[#e4e3de] rounded p-4 sm:p-5 space-y-4">
        <ul className="space-y-4 p-0 list-none m-0">
          {bullets.map((bullet, index) => (
            <li key={index} className="border-b border-[#e4e3de] pb-4 last:border-b-0 last:pb-0 space-y-1.5">
              {bullet.heading ? (
                <h3 className="font-medium text-sm text-[#2a3441] flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#4a7c7e] flex-shrink-0" aria-hidden="true" />
                  <span>{bullet.heading}</span>
                </h3>
              ) : null}
              <p dir="auto" className="text-sm leading-relaxed text-[#3d4a5c]">
                {bullet.text}
              </p>
              {bullet.evidenceIds.length > 0 ? (
                <div className="mt-2 pt-1">
                  <SourceCitations
                    evidenceIds={bullet.evidenceIds}
                    allEvidence={evidence}
                    locale={locale}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        {brief ? (
          <p className="text-xs text-[#7a8085] pt-2 border-t border-[#e4e3de]" dir="auto">
            {strings.briefGeneratedAt}{formatDate(brief.generatedAt, locale)}
          </p>
        ) : null}
      </div>
    </section>
  );
}
