import type { JSX } from 'react';

import type { EvidenceItem, SourceRefView } from '@/lib/types';
import { safeHttpUrl } from './display';

/**
 * Descriptive check-status labels. These report source accessibility and reachability
 * as factual check results — never credibility, trustworthiness, or quality judgments.
 */
export const CHECK_STATUS_LABELS: Record<string, string> = {
  reachable: 'يمكن الوصول',
  redirected: 'تم التوجيه',
  not_found: 'غير موجود',
  access_limited: 'وصول محدود',
  server_error: 'خطأ في الخادم',
  network_error: 'تعذر الاتصال بالشبكة',
  not_checked: 'لم يتم التحقق بعد',
};

export function checkStatusLabel(status: string | null | undefined): string {
  if (!status || status === 'not_checked') return 'لم يتم التحقق بعد';
  return CHECK_STATUS_LABELS[status] ?? status;
}

export interface SourceCitationItem {
  sourceId?: number;
  webUrl: string | null;
  sourceLabel?: string;
  locatorNote?: string;
  accessKind?: 'web' | 'whois' | 'offline' | 'unknown' | string;
  checkStatus?: string | null;
  rawUrl?: string;
}

export interface SourceCitationsProps {
  citations?: SourceRefView[];
  evidence?: EvidenceItem | EvidenceItem[];
  evidenceIds?: string[];
  allEvidence?: EvidenceItem[];
  className?: string;
}

function resolveCitationItems(props: SourceCitationsProps): SourceCitationItem[] {
  const items: SourceCitationItem[] = [];

  if (props.citations && props.citations.length > 0) {
    for (const c of props.citations) {
      items.push({
        sourceId: c.sourceId,
        webUrl: c.webUrl,
        sourceLabel: c.sourceLabel,
        locatorNote: c.locatorNote,
        accessKind: c.accessKind,
        checkStatus: c.checkStatus,
      });
    }
  }

  const evidenceList: EvidenceItem[] = [];
  if (props.evidence) {
    if (Array.isArray(props.evidence)) {
      evidenceList.push(...props.evidence);
    } else {
      evidenceList.push(props.evidence);
    }
  }

  if (props.evidenceIds && props.evidenceIds.length > 0 && props.allEvidence) {
    const idSet = new Set(props.evidenceIds);
    for (const ev of props.allEvidence) {
      if (idSet.has(ev.id)) {
        evidenceList.push(ev);
      }
    }
  }

  for (const ev of evidenceList) {
    if (ev.citations && ev.citations.length > 0) {
      for (const c of ev.citations) {
        items.push({
          sourceId: c.sourceId,
          webUrl: c.webUrl,
          sourceLabel: c.sourceLabel,
          locatorNote: c.locatorNote,
          accessKind: c.accessKind,
          checkStatus: c.checkStatus,
        });
      }
    } else if (ev.url && ev.url.trim().length > 0) {
      const safe = safeHttpUrl(ev.url);
      items.push({
        webUrl: safe,
        sourceLabel: '',
        locatorNote: ev.url,
        accessKind: ev.url.startsWith('whois:') ? 'whois' : 'unknown',
        checkStatus: null,
        rawUrl: ev.url,
      });
    }
  }

  // Deduplicate citations by canonical URL or key
  const uniqueItems: SourceCitationItem[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const key = item.webUrl
      ? `url:${item.webUrl}`
      : item.sourceId
        ? `id:${item.sourceId}`
        : item.rawUrl
          ? `raw:${item.rawUrl}`
          : `note:${item.locatorNote ?? ''}`;

    if (seen.has(key)) continue;
    seen.add(key);
    uniqueItems.push(item);
  }

  return uniqueItems;
}

function linkTextForCitation(citation: SourceCitationItem, safeUrl: string): string {
  const label = citation.sourceLabel?.trim();
  if (label && label.length > 0) {
    return label;
  }
  try {
    const parsed = new URL(safeUrl);
    const host = parsed.hostname.replace(/^www\./, '');
    return host || 'المصدر الأصلي';
  } catch {
    return 'المصدر الأصلي';
  }
}

/**
 * SourceCitations component: renders every available web citation without a cap.
 * Uses safeHttpUrl from display.ts, opens external links in a new tab with rel="noopener noreferrer",
 * and displays non-web/null locators with the required Arabic fallback and details disclosure.
 */
export function SourceCitations(props: SourceCitationsProps): JSX.Element {
  const citations = resolveCitationItems(props);
  const className = props.className ?? '';

  if (citations.length === 0) {
    return (
      <div className={`text-xs text-neutral-600 ${className}`} dir="auto">
        <span>لا يتوفر رابط ويب قابل للفتح في السجل</span>
      </div>
    );
  }

  return (
    <div className={`space-y-1 ${className}`} dir="auto">
      <ul className="flex flex-wrap gap-x-3 gap-y-1.5 list-none p-0 m-0 text-xs">
        {citations.map((citation, index) => {
          const safeUrl = safeHttpUrl(citation.webUrl ?? citation.rawUrl);
          if (safeUrl !== null) {
            const linkText = linkTextForCitation(citation, safeUrl);
            return (
              <li key={index} className="inline-flex items-center gap-1.5 flex-wrap">
                <a
                  href={safeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-blue-800"
                  dir="ltr"
                >
                  <span dir="auto">{linkText}</span>
                </a>
                {citation.checkStatus ? (
                  <span className="text-neutral-500 text-[11px]" dir="auto">
                    (آخر تحقق: {checkStatusLabel(citation.checkStatus)})
                  </span>
                ) : null}
              </li>
            );
          }

          return (
            <li key={index} className="inline-flex items-center gap-1.5 flex-wrap text-neutral-700">
              <span>لا يتوفر رابط ويب قابل للفتح في السجل</span>
              {citation.locatorNote || citation.accessKind || citation.rawUrl ? (
                <details className="inline-block text-[11px]">
                  <summary className="cursor-pointer text-neutral-600 min-h-[24px] inline-flex items-center">
                    بيانات المصدر
                  </summary>
                  <div className="mt-0.5 p-1.5 bg-neutral-50 border border-neutral-200 rounded text-[11px] space-y-0.5">
                    {citation.accessKind ? <div>نوع الوصول: {citation.accessKind}</div> : null}
                    {citation.locatorNote ? <div>ملاحظة: {citation.locatorNote}</div> : null}
                    {citation.rawUrl ? (
                      <div>
                        المحدد: <span dir="ltr" className="ltr-isolate wrap-anywhere">{citation.rawUrl}</span>
                      </div>
                    ) : null}
                  </div>
                </details>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
