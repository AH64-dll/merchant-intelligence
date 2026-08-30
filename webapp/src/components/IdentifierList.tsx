import type { JSX } from 'react';

import type { Identifier } from '@/lib/types';
import { IDENTIFIER_KIND_LABELS, ROLE_LABELS } from '@/lib/labels';
import type { IdentifierKind } from '@/lib/types';

/**
 * Actionable value for contact identifiers. The anchor target uses the
 * normalized value; the visible text is always the original stored value,
 * isolated ltr so mixed-direction raw text cannot corrupt the layout.
 */
function IdentifierValue({ identifier }: { identifier: Identifier }): JSX.Element {
  const { kind, value, normalizedValue } = identifier;
  if (kind === 'phone' || kind === 'whatsapp') {
    return (
      <a href={`tel:${normalizedValue}`} className="underline" dir="ltr">
        {value}
      </a>
    );
  }
  if (kind === 'email') {
    return (
      <a href={`mailto:${normalizedValue}`} className="underline" dir="ltr">
        {value}
      </a>
    );
  }
  if (kind === 'website' && normalizedValue.startsWith('http')) {
    return (
      <a
        href={normalizedValue}
        target="_blank"
        rel="noopener noreferrer"
        className="underline"
        dir="ltr"
      >
        {value}
      </a>
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
export function IdentifierList({ identifiers }: { identifiers: Identifier[] }): JSX.Element | null {
  const displayable = identifiers.filter((identifier) => identifier.displayable);
  if (displayable.length === 0) return null;
  const byKind: Partial<Record<IdentifierKind, Identifier[]>> = {};
  for (const identifier of displayable) {
    (byKind[identifier.kind] ??= []).push(identifier);
  }
  const kinds = (Object.keys(byKind) as IdentifierKind[]).sort((a, b) =>
    IDENTIFIER_KIND_LABELS[a].localeCompare(IDENTIFIER_KIND_LABELS[b], 'ar'),
  );
  return (
    <div className="space-y-4">
      {kinds.map((kind) => (
        <section key={kind}>
          <h3 className="font-bold">{IDENTIFIER_KIND_LABELS[kind]}</h3>
          <ul className="mt-1 space-y-1">
            {byKind[kind]!.map((identifier) => (
              <li
                key={identifier.id}
                className="text-sm [overflow-wrap:anywhere]"
              >
                <IdentifierValue identifier={identifier} />
                <span dir="auto"> — {ROLE_LABELS[identifier.role]}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
