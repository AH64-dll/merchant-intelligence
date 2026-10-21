'use client';

import { useState, useRef, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X, ArrowLeft, ArrowRight, Building2, Phone, Link2 } from 'lucide-react';
import { t, type Locale } from '@/lib/i18n';

type SearchType = 'all' | 'name' | 'phone' | 'link';

export interface SearchBoxProps {
  defaultValue?: string;
  initial?: string;
  locale?: Locale;
  compact?: boolean;
  onSearch?: (q: string) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  autoFocus?: boolean;
}

export function SearchBox({
  defaultValue,
  initial,
  locale = 'ar',
  compact = false,
  onSearch,
  inputRef,
  autoFocus,
}: SearchBoxProps) {
  const targetInitial = initial ?? defaultValue ?? '';
  const [prevInitial, setPrevInitial] = useState(targetInitial);
  const [value, setValue] = useState(targetInitial);
  const [type, setType] = useState<SearchType>('all');
  const [error, setError] = useState(false);
  const ownRef = useRef<HTMLInputElement>(null);
  const ref = inputRef || ownRef;
  const router = useRouter();
  const strings = t(locale);
  const isEn = locale === 'en';

  if (targetInitial !== prevInitial) {
    setPrevInitial(targetInitial);
    setValue(targetInitial);
  }

  const placeholder =
    type === 'name'
      ? isEn
        ? 'Enter the vendor name…'
        : 'اكتب اسم التاجر الذي تبحث عنه…'
      : type === 'phone'
        ? isEn
          ? 'Enter a phone number with country code…'
          : 'أدخل رقم الهاتف مع رمز الدولة…'
        : type === 'link'
          ? isEn
            ? 'Paste a page URL or username…'
            : 'الصق رابط الصفحة أو اسم المستخدم…'
          : strings.searchPlaceholder;

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    const trimmed = value.trim();
    if (!trimmed) {
      e.preventDefault();
      setError(true);
      ref.current?.focus();
      return;
    }
    setError(false);
    if (onSearch) {
      e.preventDefault();
      onSearch(trimmed);
      return;
    }
    if (router) {
      e.preventDefault();
      router.push(`/${locale}/search?q=${encodeURIComponent(trimmed)}`);
    }
  }

  return (
    <div className={`search-block ${compact ? 'compact' : ''}`}>
      <form
        action={`/${locale}/search`}
        method="get"
        role="search"
        className={`search-form ${error ? 'has-error' : ''}`}
        onSubmit={handleSubmit}
      >
        <label htmlFor="merchant-search" className="sr-only">
          {strings.searchLabel}
        </label>
        <Search className="search-leading" size={23} aria-hidden="true" />
        <input
          ref={ref}
          id="merchant-search"
          name="q"
          type="search"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(false);
          }}
          placeholder={placeholder}
          aria-label={strings.searchLabel}
          aria-invalid={error}
          aria-describedby={error ? 'search-error' : 'merchant-search-hint'}
          maxLength={300}
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          autoFocus={autoFocus}
          inputMode={type === 'phone' ? 'tel' : 'search'}
          dir={value && /^[+\d]|https?:|www\./i.test(value) ? 'ltr' : undefined}
        />
        {value ? (
          <button
            className="clear-input"
            type="button"
            onClick={() => {
              setValue('');
              setError(false);
              ref.current?.focus();
            }}
            aria-label={isEn ? 'Clear search query' : 'مسح عبارة البحث'}
          >
            <X size={16} aria-hidden="true" />
          </button>
        ) : null}
        <button className="search-submit" type="submit">
          <span>{strings.searchButton}</span>
          {locale === 'ar' ? (
            <ArrowLeft size={16} aria-hidden="true" />
          ) : (
            <ArrowRight size={16} aria-hidden="true" />
          )}
        </button>
      </form>
      <p id="merchant-search-hint" className="sr-only">
        {strings.searchHint}
      </p>
      {error ? (
        <p id="search-error" className="input-error" role="alert">
          {isEn
            ? 'Enter a name, phone number, or URL to search.'
            : 'أدخل اسمًا أو رقم هاتف أو رابطًا للبحث.'}
        </p>
      ) : null}
      {!compact ? (
        <div className="search-under">
          <div className="search-types">
            <span className="search-by">
              {isEn ? 'SEARCH BY' : 'يمكنك البحث باستخدام'}
            </span>
            <button
              type="button"
              className={type === 'name' ? 'selected' : ''}
              aria-pressed={type === 'name'}
              onClick={() => {
                setType(type === 'name' ? 'all' : 'name');
                ref.current?.focus();
              }}
            >
              <Building2 size={13} aria-hidden="true" />
              {isEn ? 'Vendor name' : 'اسم التاجر'}
            </button>
            <button
              type="button"
              className={type === 'phone' ? 'selected' : ''}
              aria-pressed={type === 'phone'}
              onClick={() => {
                setType(type === 'phone' ? 'all' : 'phone');
                ref.current?.focus();
              }}
            >
              <Phone size={13} aria-hidden="true" />
              {isEn ? 'Phone number' : 'رقم الهاتف'}
            </button>
            <button
              type="button"
              className={type === 'link' ? 'selected' : ''}
              aria-pressed={type === 'link'}
              onClick={() => {
                setType(type === 'link' ? 'all' : 'link');
                ref.current?.focus();
              }}
            >
              <Link2 size={13} aria-hidden="true" />
              {isEn ? 'Link or identifier' : 'رابط أو معرّف'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
