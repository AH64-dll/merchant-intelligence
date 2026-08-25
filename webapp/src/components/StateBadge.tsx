import type { JSX } from 'react';
import type { MerchantState } from '@/lib/types';
import { STATE_LABELS } from '@/lib/labels';

export function StateBadge({ state }: { state: MerchantState }): JSX.Element {
  return <span dir="auto">[{STATE_LABELS[state]}]</span>;
}
