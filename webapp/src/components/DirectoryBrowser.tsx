'use client';

import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Building2, Info, Scale } from 'lucide-react';

import {
  DirectoryQueryValidationError,
  MerchantDirectoryProjection,
  normalizeDirectoryQuery,
} from '@/lib/directory';
import { directoryPageInput } from '@/lib/directory-page';
import type { Locale } from '@/lib/i18n';
import type { MerchantDirectoryQuery, MerchantDirectoryResult } from '@/lib/types';
import { assetUrl } from '@/lib/asset-url';
import { DirectoryPageShell } from './DirectoryPageShell';
type LoadState = 'loading' | 'ready' | 'error';

function paramsRecord(searchParams: URLSearchParams): Record<string, string | string[]> {
  const record: Record<string, string | string[]> = {};
  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key);
    record[key] = values.length === 1 ? values[0] : values;
  }
  return record;
}

/**
 * Client-side directory: fetches the serialized MerchantDirectoryProjection
 * once, then runs the identical select() for filters + pagination in the
 * browser. Filter form navigations are plain GETs — each lands on the same
 * static HTML and re-runs this component with new query params.
 */
export function DirectoryBrowser({
  view,
  locale,
  title,
  intro,
  emptyState,
  listLabel,
  extra,
}: {
  view: 'all' | 'positive-evidence';
  locale: Locale;
  title: string;
  intro: ReactNode;
  emptyState: ReactNode;
  listLabel: string;
  extra?: ReactNode;
}) {
  const isEn = locale === 'en';
  const [state, setState] = useState<LoadState>('loading');
  const [projection, setProjection] = useState<MerchantDirectoryProjection | null>(null);
  const searchParams = useSearchParams();

  useEffect(() => {
    let cancelled = false;
    fetch(assetUrl('/data/directory.json'))
      .then((response) => {
        if (!response.ok) throw new Error(`directory ${response.status}`);
        return response.json();
      })
      .then((data) => {
        if (!cancelled) {
          setProjection(MerchantDirectoryProjection.fromJSON(data));
          setState('ready');
        }
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const computed = useMemo((): {
    result: MerchantDirectoryResult | null;
    invalidQuery: boolean;
    activeFilters: MerchantDirectoryQuery | null;
  } => {
    if (projection === null) return { result: null, invalidQuery: false, activeFilters: null };
    try {
      const input = directoryPageInput(paramsRecord(searchParams), view);
      const query = normalizeDirectoryQuery(input);
      return { result: projection.select(input), invalidQuery: false, activeFilters: query };
    } catch (error) {
      if (error instanceof DirectoryQueryValidationError) {
        return { result: null, invalidQuery: true, activeFilters: null };
      }
      throw error;
    }
  }, [projection, searchParams, view]);

  if (state === 'error') {
    return (
      <div className="page-merchants flex w-full flex-col gap-6 py-4">
        <div className="page-heading">
          <div className="eyebrow">
            <span />
            {view === 'all'
              ? (isEn ? 'DIRECTORY INDEX' : 'فهرس الدليل')
              : (isEn ? 'POSITIVE EVIDENCE' : 'أدلة إيجابية')}
          </div>
          <h1 dir="auto">
            {view === 'all' ? <Building2 size={27} /> : <Scale size={27} />}
            {title}
          </h1>
          <div className="page-intro">{typeof intro === 'string' ? <p dir="auto">{intro}</p> : intro}</div>
        </div>
        <div className="data-notice" role="alert">
          <Info size={18} />
          <div>
            <strong>{isEn ? 'Directory Data Unavailable' : 'بيانات الدليل غير متاحة'}</strong>
            <p>
              {isEn
                ? 'Directory data failed to load. Check your connection and retry.'
                : 'تعذّر تحميل بيانات الدليل. تحقق من الاتصال وأعد المحاولة.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (state === 'loading' || (computed.result === null && !computed.invalidQuery)) {
    return (
      <div className="page-merchants flex w-full flex-col gap-6 py-4" aria-busy="true">
        <div className="page-heading">
          <div className="eyebrow">
            <span />
            {view === 'all'
              ? (isEn ? 'DIRECTORY INDEX' : 'فهرس الدليل')
              : (isEn ? 'POSITIVE EVIDENCE' : 'أدلة إيجابية')}
          </div>
          <h1 dir="auto">
            {view === 'all' ? <Building2 size={27} /> : <Scale size={27} />}
            {title}
          </h1>
          <div className="page-intro">{typeof intro === 'string' ? <p dir="auto">{intro}</p> : intro}</div>
        </div>
        <div className="index-panel">
          <div className="index-toolbar">
            <h2>
              {view === 'all' ? <Building2 size={18} /> : <Scale size={18} />}
              {listLabel}
              <span className="unavailable-count">—</span>
            </h2>
          </div>
          <div className="directory-empty p-8 text-center">
            <p style={{ color: 'var(--muted)' }}>
              {isEn ? 'Loading directory…' : 'جارٍ تحميل الدليل…'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (computed.invalidQuery || computed.result === null || computed.activeFilters === null) {
    return (
      <div className="page-merchants flex w-full flex-col gap-6 py-4">
        <div className="page-heading">
          <div className="eyebrow">
            <span />
            {view === 'all'
              ? (isEn ? 'DIRECTORY INDEX' : 'فهرس الدليل')
              : (isEn ? 'POSITIVE EVIDENCE' : 'أدلة إيجابية')}
          </div>
          <h1 dir="auto">
            {view === 'all' ? <Building2 size={27} /> : <Scale size={27} />}
            {title}
          </h1>
          <div className="page-intro">{typeof intro === 'string' ? <p dir="auto">{intro}</p> : intro}</div>
        </div>
        <div className="data-notice" role="alert">
          <Info size={18} />
          <div>
            <strong>{isEn ? 'Invalid Filter or Page' : 'قيمة الترشيح غير صالحة'}</strong>
            <p>
              {isEn
                ? 'The filter or page value in the address is invalid.'
                : 'قيمة الترشيح أو الصفحة في العنوان غير صالحة.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <DirectoryPageShell
      title={title}
      intro={intro}
      basePath={`/${locale}${view === 'all' ? '/merchants' : '/merchants/positive-evidence'}`}
      result={computed.result}
      view={view}
      activeFilters={computed.activeFilters}
      emptyState={emptyState}
      cardKind={view === 'all' ? 'summary' : 'positive'}
      listLabel={listLabel}
      extra={extra}
      locale={locale}
    />
  );
}
