import type { AnalysisPayload, Merchant, SentimentCounts } from './types';

export interface Verdict {
  label: string;
  tone: 'good' | 'mixed' | 'warn' | 'bad' | 'unknown';
  reason: string;
}

function sentimentFallback(sentiment: SentimentCounts): string {
  return `إيجابي: ${sentiment.positive} · سلبي: ${sentiment.negative} · محايد: ${sentiment.neutral}`;
}

function noteOr(notes: string[], fallback: string): string {
  for (const note of notes) {
    if (note.trim().length > 0) {
      return note;
    }
  }
  return fallback;
}

export function deriveVerdict(merchant: Merchant, sentiment: SentimentCounts, analysis: AnalysisPayload | null): Verdict {
  const fallback = sentimentFallback(sentiment);
  if (analysis === null || merchant.state === 'INSUFFICIENT_DATA') {
    return { label: 'بيانات غير كافية', tone: 'unknown', reason: fallback };
  }
  const reputationNotes = analysis.reputationNotes;
  const fraudRiskNotes = analysis.fraudRiskNotes;
  const firstRiskSignal = analysis.riskSignals.length > 0 ? analysis.riskSignals[0] : '';

  switch (merchant.state) {
    case 'OFFICIAL_WARNING':
      return { label: 'تحذير رسمي', tone: 'bad', reason: noteOr([fraudRiskNotes], fallback) };
    case 'HIGH_RISK_SIGNALS':
      return { label: 'إشارات خطورة عالية', tone: 'bad', reason: noteOr([firstRiskSignal, fraudRiskNotes], fallback) };
    case 'MIXED_REPUTATION':
      return { label: 'سمعة متضاربة', tone: 'mixed', reason: noteOr([reputationNotes], fallback) };
    case 'REQUIRES_MANUAL_REVIEW':
      return { label: 'يحتاج مراجعة يدوية', tone: 'warn', reason: noteOr([reputationNotes], fallback) };
    case 'VERIFIED_HIGH_CONFIDENCE':
      if (sentiment.positive > sentiment.negative) {
        return { label: 'موثوق — ثقة عالية', tone: 'good', reason: noteOr([reputationNotes], fallback) };
      }
      return { label: 'هوية موثوقة مع شكاوى', tone: 'mixed', reason: noteOr([reputationNotes], fallback) };
    case 'VERIFIED_MODERATE_CONFIDENCE':
      if (sentiment.positive > sentiment.negative) {
        return { label: 'جيد — ثقة متوسطة', tone: 'good', reason: noteOr([reputationNotes], fallback) };
      }
      return { label: 'ثقة متوسطة مع شكاوى', tone: 'warn', reason: noteOr([reputationNotes], fallback) };
    case 'IDENTITY_UNCERTAIN':
      return { label: 'هوية غير مؤكدة', tone: 'unknown', reason: fallback };
  }
}
