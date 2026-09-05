import type { JSX } from 'react';

import type { BriefView, EvidenceItem, Identifier, MerchantState } from '@/lib/types';
import { assessIdentity, assessReputation } from '@/lib/assessment';
import { SourceCitations } from './SourceCitations';
import { formatDateAr } from './display';

export interface CitedBriefProps {
  brief: BriefView | null;
  state: MerchantState;
  identifiers: Identifier[];
  evidence: EvidenceItem[];
  relatedRelations?: readonly string[];
}

interface BriefBullet {
  heading?: string;
  text: string;
  evidenceIds: string[];
}

function extractBulletsFromPayload(payload: unknown): BriefBullet[] {
  if (!payload) return [];

  if (typeof payload === 'object' && payload !== null) {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.bullets)) {
      return obj.bullets
        .map((b): BriefBullet | null => {
          if (typeof b === 'string' && b.trim().length > 0) {
            return { text: b.trim(), evidenceIds: [] };
          }
          if (typeof b === 'object' && b !== null) {
            const bulletObj = b as Record<string, unknown>;
            const text = typeof bulletObj.text === 'string' ? bulletObj.text : typeof bulletObj.summary === 'string' ? bulletObj.summary : '';
            if (text.trim().length === 0) return null;
            const rawIds = Array.isArray(bulletObj.evidenceIds)
              ? bulletObj.evidenceIds
              : Array.isArray(bulletObj.evidence_ids)
                ? bulletObj.evidence_ids
                : [];
            const evidenceIds = rawIds.filter((id): id is string => typeof id === 'string');
            return {
              text: text.trim(),
              evidenceIds,
              heading: typeof bulletObj.heading === 'string' ? bulletObj.heading : undefined,
            };
          }
          return null;
        })
        .filter((b): b is BriefBullet => b !== null);
    }

    if (Array.isArray(payload)) {
      return (payload as unknown[])
        .map((item): BriefBullet | null => {
          if (typeof item === 'string' && item.trim().length > 0) {
            return { text: item.trim(), evidenceIds: [] };
          }
          if (typeof item === 'object' && item !== null) {
            const itemObj = item as Record<string, unknown>;
            const text = typeof itemObj.text === 'string' ? itemObj.text : '';
            if (text.trim().length === 0) return null;
            const rawIds = Array.isArray(itemObj.evidenceIds) ? itemObj.evidenceIds : [];
            const evidenceIds = rawIds.filter((id): id is string => typeof id === 'string');
            return { text: text.trim(), evidenceIds };
          }
          return null;
        })
        .filter((b): b is BriefBullet => b !== null);
    }

    if (typeof obj.summary === 'string' && obj.summary.trim().length > 0) {
      const rawIds = Array.isArray(obj.evidenceIds) ? obj.evidenceIds : [];
      return [
        {
          text: obj.summary.trim(),
          evidenceIds: rawIds.filter((id): id is string => typeof id === 'string'),
        },
      ];
    }
  }

  return [];
}

/**
 * CitedBrief component: renders concise Arabic text bullets from the merchant brief when present,
 * or deterministic neutral fallback wording from assessIdentity / assessReputation when absent.
 * Separates identity certainty from observations about dealing with the seller, and shows evidence-id citations via SourceCitations.
 */
export function CitedBrief({
  brief,
  state,
  identifiers,
  evidence,
  relatedRelations = [],
}: CitedBriefProps): JSX.Element {
  const extractedBullets = brief !== null ? extractBulletsFromPayload(brief.payload) : [];

  const bullets: BriefBullet[] =
    extractedBullets.length > 0
      ? extractedBullets
      : (() => {
          const identity = assessIdentity(state, identifiers, relatedRelations);
          const reputation = assessReputation(state, evidence);

          const list: BriefBullet[] = [];

          if (identity.reasons.length > 0) {
            list.push({
              heading: 'ما الذي نعرفه عن هوية المتجر؟',
              text: identity.reasons.join(' '),
              evidenceIds: [],
            });
          }

          list.push({
            heading: 'ما الذي تقوله المصادر عن التعامل؟',
            text: `${reputation.headline}: ${reputation.explanation}`,
            evidenceIds: reputation.evidenceIds,
          });

          if (reputation.caveat) {
            list.push({
              text: `تنبيه: ${reputation.caveat}`,
              evidenceIds: reputation.evidenceIds,
            });
          }

          return list;
        })();

  return (
    <section aria-labelledby="current-picture-heading" className="border border-black p-4 space-y-3">
      <h2 id="current-picture-heading" className="font-bold text-lg">
        الصورة الحالية
      </h2>
      <ul className="space-y-3 p-0 list-none">
        {bullets.map((bullet, index) => (
          <li key={index} className="border-b border-neutral-200 pb-3 last:border-b-0 space-y-1.5">
            {bullet.heading ? <h3 className="font-bold text-sm">{bullet.heading}</h3> : null}
            <p dir="auto" className="text-sm leading-relaxed">
              {bullet.text}
            </p>
            {bullet.evidenceIds.length > 0 ? (
              <div className="mt-1">
                <SourceCitations evidenceIds={bullet.evidenceIds} allEvidence={evidence} />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {brief ? (
        <p className="text-xs text-neutral-500 mt-2" dir="auto">
          تاريخ إعداد الملخص: {formatDateAr(brief.generatedAt)}
        </p>
      ) : null}
    </section>
  );
}
