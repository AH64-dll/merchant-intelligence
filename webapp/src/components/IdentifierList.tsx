import type { JSX } from 'react';

import type { Identifier, IdentifierKind } from '@/lib/types';
import { IDENTIFIER_KIND_LABELS } from '@/lib/labels';
import { ROLE_LABELS } from '@/lib/labels';

/** Actionable original value rendering for phones/emails/URLs. */
function IdentifierValue({ identifier }: { identifier: Identifier }): JSX.Element {
  const { kind, normalizedValue } = identifier;
  if (kind === 'phone' || kind === 'whatsapp') {
    return <a href={`tel:${normalizedValue}`} className="underline" dir="ltr">{identifier.value}</a>;
  }
  if (kind === 'email') {
    return <a href={`mailto:${normalizedValue}`} className="underline" dir="ltr">{identifier.value}</a>;
  }
  if (kind === 'website' && normalizedValue.startsWith('http')) {
    return (
      <a href={normalizedValue} target="_blank" rel="noopener noreferrer" className="underline" dir="ltr">
        {identifier.value}
      </a>
    );
  }
  return <span dir="ltr">{identifier.value}</span>;
}

export function IdentifierList({ identifiers }: { identifiers: Identifier[] }): JSX.Element | null {
  const displayable = identifiers.filter((identifier) => identifier.displayable);
  if (displayable.length === 0) {
    return null;
  }
  const byKind = new Map<IdentifierKind, Identifier[]>();
  for (const identifier of displayable) {
    const values = byKind.get(identifier.kind);
    if (values === undefined) {
      byKind.set(identifier.kind, [identifier]);
    } else {
      values.push(identifier);
    }
  }
  const groups = [...byKind.entries()].sort((a, b) =>
    IDENTIFIER_KIND_LABELS[a[0]].localeCompare(IDENTIFIER_KIND_LABELS[b[0]], 'ar'),
  );
  return (
    <div className="space-y-3">
      {groups.map(([kind, entries]) => (
        <section key={kind}>
          <h3 className="font-bold">{IDENTIFIER_KIND_LABELS[kind]}</h3>
          <ul className="space-y-1">
            {entries.map((identifier, index) => (
              <li
                key={`${identifier.id}:${index}`}
                className="font-mono text-sm [overflow-wrap:anywhere]"
              >
                <IdentifierValue identifier={identifier} />
                <span dir="auto" className="font-sans"> — {ROLE_LABELS[identifier.role]}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
