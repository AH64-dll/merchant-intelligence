import type { JSX } from 'react';

import type { Identifier } from '@/lib/types';
import {
  identifierKindLabel,
  roleLabel,
} from '@/lib/labels';
import type { IdentifierKind } from '@/lib/types';
import type { Locale } from '@/lib/i18n';
import { safeHttpUrl } from './display';

/**
 * Actionable value for contact identifiers. The anchor target uses the
 * normalized value; the visible text is always the original stored value.
 * Phones, emails, and URLs are isolated ltr; addresses use dir="auto" so mixed
 * text/numbers do not invert.
 */
function IdentifierValue({ identifier }: { identifier: Identifier }): JSX.Element {
  const { kind, value, normalizedValue } = identifier;
  if (kind === 'phone' || kind === 'whatsapp') {
    return (
      <a href={`tel:${normalizedValue}`} className="underline underline-offset-2 text-[#4a7c7e] hover:text-[#2a3441]" dir="ltr">
        {value}
      </a>
    );
  }
  if (kind === 'email') {
    return (
      <a href={`mailto:${normalizedValue}`} className="underline underline-offset-2 text-[#4a7c7e] hover:text-[#2a3441]" dir="ltr">
        {value}
      </a>
    );
  }
  if (kind === 'website') {
    const safeUrl = safeHttpUrl(normalizedValue);
    if (safeUrl !== null) {
      return (
        <a
          href={safeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 text-[#4a7c7e] hover:text-[#2a3441]"
          dir="ltr"
        >
          {value}
        </a>
      );
    }
  }
  if (kind === 'address') {
    return (
      <span dir="auto" className="wrap-anywhere">
        <bdi>{value}</bdi>
      </span>
    );
  }
  return (
    <span dir="ltr" className="ltr-isolate wrap-anywhere">
      <bdi>{value}</bdi>
    </span>
  );
}

/**
 * Identifier list grouped by kind. Quarantined / non-displayable values are
 * hidden (identifier-policy); raw originals are shown with role labels —
 * never normalized values or confidence percentages.
 */
export function IdentifierList({
  identifiers,
  locale = 'ar',
}: {
  identifiers: Identifier[];
  locale?: Locale;
}): JSX.Element | null {
  const displayable = identifiers.filter((identifier) => identifier.displayable);
  if (displayable.length === 0) return null;
  const byKind: Partial<Record<IdentifierKind, Identifier[]>> = {};
  for (const identifier of displayable) {
    (byKind[identifier.kind] ??= []).push(identifier);
  }
  const kinds = (Object.keys(byKind) as IdentifierKind[]).sort((a, b) =>
    identifierKindLabel(a, locale).localeCompare(identifierKindLabel(b, locale), locale),
  );
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {kinds.map((kind) => (
        <section key={kind} className="bg-[#fdfcf9] border border-[#e4e3de] rounded p-3.5 space-y-1.5">
          <h3 className="font-semibold text-xs text-[#2a3441] flex items-center gap-1.5 border-b border-[#e4e3de] pb-1.5">
            {identifierKindLabel(kind, locale)}
          </h3>
          <ul className="mt-1 space-y-1 list-none p-0 text-xs">
            {byKind[kind]!.map((identifier) => (
              <li
                key={identifier.id}
                className="text-xs [overflow-wrap:anywhere] text-[#56606a]"
              >
                <IdentifierValue identifier={identifier} />
                <span dir="auto" className="text-[#7a8085]"> — {roleLabel(identifier.role, locale)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
