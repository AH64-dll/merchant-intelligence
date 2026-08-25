import type { ReactNode } from 'react';

import type { ClaimItem } from '@/lib/types';

const CLAIM_SENTIMENT_LABELS: Record<ClaimItem['sentiment'], string> = {
  positive: 'إيجابي',
  negative: 'سلبي',
  neutral: 'محايد',
};

export function ClaimsTable({ claims }: { claims: ClaimItem[] }): ReactNode {
  if (claims.length === 0) {
    return null;
  }
  return (
    <table className="border-collapse w-full text-sm [overflow-wrap:anywhere]">
      <thead>
        <tr>
          <th scope="col" className="border border-black p-1 text-right">النوع</th>
          <th scope="col" className="border border-black p-1 text-right">التوجه</th>
          <th scope="col" className="border border-black p-1 text-right">الملخص</th>
          <th scope="col" className="border border-black p-1 text-right">مصادر مستقلة</th>
          <th scope="col" className="border border-black p-1 text-right">مرات الذكر</th>
        </tr>
      </thead>
      <tbody>
        {claims.map((claim) => (
          <tr key={claim.id}>
            <td dir="auto" className="border border-black p-1">{claim.claimType}</td>
            <td className="border border-black p-1">{CLAIM_SENTIMENT_LABELS[claim.sentiment]}</td>
            <td dir="auto" className="border border-black p-1">{claim.summary}</td>
            <td className="border border-black p-1">{claim.independentSourceCount}</td>
            <td className="border border-black p-1">{claim.mentionCount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
