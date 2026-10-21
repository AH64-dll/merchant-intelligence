import type { JSX } from 'react';
import { ChevronDown, ExternalLink } from 'lucide-react';

import type { EvidenceItem, SourceRefView } from '@/lib/types';
import { checkStatusLabel as getCheckStatusLabel } from '@/lib/labels';
import { t, type Locale } from '@/lib/i18n';
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

export function checkStatusLabel(status: string | null | undefined, locale: Locale = 'ar'): string {
  return getCheckStatusLabel(status, locale);
}

const ACCESS_KIND_LABELS: Record<string, { ar: string; en: string }> = {
  web: { ar: 'ويب', en: 'Web' },
  whois: { ar: 'سجل تقني (Whois)', en: 'Whois technical registry' },
  offline: { ar: 'أرشيف غير متصل', en: 'Offline archive' },
  unknown: { ar: 'غير محدد', en: 'Unspecified' },
};

function accessKindLabel(kind: string | undefined, locale: Locale = 'ar'): string {
  if (!kind) return locale === 'en' ? 'Unspecified' : 'غير محدد';
  const item = ACCESS_KIND_LABELS[kind];
  if (item) return locale === 'en' ? item.en : item.ar;
  return kind.replace(/_/g, ' ');
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
  locale?: Locale;
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
    } else if (ev.url) {
      items.push({
        webUrl: ev.url,
        rawUrl: ev.url,
      });
    }
  }

  const seen = new Set<string>();
  const deduped: SourceCitationItem[] = [];

  for (const item of items) {
    const key = item.sourceId
      ? `id:${item.sourceId}`
      : item.webUrl
        ? `url:${item.webUrl}`
        : item.rawUrl
          ? `raw:${item.rawUrl}`
          : `note:${item.locatorNote}`;

    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(item);
    }
  }

  return deduped;
}

function citationKey(citation: SourceCitationItem): string {
  if (citation.sourceId !== undefined) return `src-${citation.sourceId}`;
  if (citation.webUrl) return `url-${citation.webUrl}`;
  if (citation.rawUrl) return `raw-${citation.rawUrl}`;
  return `note-${citation.locatorNote ?? 'anon'}`;
}

function linkTextForCitation(citation: SourceCitationItem, safeUrl: string): string {
  if (citation.sourceLabel && citation.sourceLabel.trim().length > 0) {
    return citation.sourceLabel.trim();
  }
  if (citation.locatorNote && citation.locatorNote.trim().length > 0) {
    return citation.locatorNote.trim();
  }
  try {
    const parsed = new URL(safeUrl);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return safeUrl;
  }
}

/**
 * Maps a stored locator_note to a localized label when the pipeline wrote a
 * known constant (deep-resolve pass); falls back to the raw note text.
 */
function locatorNoteLabel(note: string | null | undefined, strings: ReturnType<typeof t>): string | null {
  if (!note || note.trim().length === 0) return null;
  const n = note.trim();
  if (n === 'Vendor page — the specific post is not publicly linkable') return strings.sourceVendorPage;
  if (n === 'Original post no longer reachable') return strings.sourceUnreachable;
  if (n.startsWith('Redirect resolved to site root')) return strings.sourceVendorPage;
  return n;
}

/**
 * SourceCitations component: renders every available web citation without a cap.
 * Uses safeHttpUrl from display.ts, opens external links in a new tab with rel="noopener noreferrer",
 * and displays non-web/null locators with the required localized fallback and details disclosure.
 */
export function SourceCitations(props: SourceCitationsProps): JSX.Element {
  const locale = props.locale ?? 'ar';
  const strings = t(locale);
  const citations = resolveCitationItems(props);
  const className = props.className ?? '';

  if (citations.length === 0) {
    return (
      <div className={`text-xs text-[#7a8085] ${className}`} dir="auto">
        <span>{strings.noWebLinkAvailable}</span>
      </div>
    );
  }

  return (
    <div className={`space-y-1 ${className}`} dir="auto">
      <ul className="flex flex-wrap gap-x-3 gap-y-1.5 list-none p-0 m-0 text-xs">
        {citations.map((citation) => {
          const safeUrl = safeHttpUrl(citation.webUrl ?? citation.rawUrl);
          if (safeUrl !== null) {
            const linkText = linkTextForCitation(citation, safeUrl);
            return (
              <li key={citationKey(citation)} className="inline-flex items-center gap-1.5 flex-wrap">
                <a
                  href={safeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[#4a7c7e] hover:underline underline-offset-2"
                  dir="ltr"
                >
                  <span dir="auto">{linkText}</span>
                  <ExternalLink size={11} aria-hidden="true" />
                </a>
                {citation.checkStatus ? (
                  <span className="text-[#56606a] text-[11px]" dir="auto">
                    {strings.lastVerifiedPrefix.replace('{status}', checkStatusLabel(citation.checkStatus, locale))}
                  </span>
                ) : null}
                {locatorNoteLabel(citation.locatorNote, strings) ? (
                  <span className="inline-flex items-center rounded-full border border-[#e4e3de] bg-[#f5f3ef] px-2 py-0.5 text-[11px] text-[#56606a]" dir="auto">
                    {locatorNoteLabel(citation.locatorNote, strings)}
                  </span>
                ) : null}
              </li>
            );
          }

          return (
            <li key={citationKey(citation)} className="inline-flex items-center gap-1.5 flex-wrap text-[#56606a]">
              <span>{strings.noWebLinkAvailable}</span>
              {citation.locatorNote || citation.accessKind || citation.rawUrl ? (
                <details className="inline-block text-[11px] group">
                  <summary className="cursor-pointer text-[#7a8085] hover:text-[#2a3441] min-h-[44px] inline-flex items-center gap-1">
                    <ChevronDown size={12} className="transition-transform group-open:rotate-180 text-[#7a8085] shrink-0" aria-hidden="true" />
                    <span>{strings.sourceMetadata}</span>
                  </summary>
                  <div className="mt-0.5 p-2 bg-[#fdfcf9] border border-[#e4e3de] rounded text-[11px] space-y-0.5">
                    {citation.accessKind ? <div>{strings.accessKindPrefix}{accessKindLabel(citation.accessKind, locale)}</div> : null}
                    {citation.locatorNote ? <div>{strings.notePrefix}{citation.locatorNote}</div> : null}
                    {citation.rawUrl ? (
                      <div>
                        {strings.locatorPrefix}<span dir="ltr" className="ltr-isolate wrap-anywhere">{citation.rawUrl}</span>
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
