import type { JSX } from 'react';

import type { Identifier, IdentifierKind } from '@/lib/types';
import { IDENTIFIER_KIND_LABELS } from '@/lib/labels';

export function IdentifierList({ identifiers }: { identifiers: Identifier[] }): JSX.Element | null {
  if (identifiers.length === 0) {
    return null;
  }
  const byKind = new Map<IdentifierKind, Identifier[]>();
  for (const identifier of identifiers) {
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
                key={`${identifier.value}:${index}`}
                dir="auto"
                className="font-mono text-sm [overflow-wrap:anywhere]"
              >
                {identifier.value}
                {identifier.confidence > 0 ? ` (${Math.round(identifier.confidence * 100)}%)` : ''}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
