import { describe, expect, it } from 'vitest';
import { publicDetail } from './public-api';
import { getDb } from './singletons';

const FORBIDDEN_KEYS = new Set([
  'identityConfidence',
  'identity_confidence',
  'reliabilityBand',
  'reliability_band',
  'internalState',
  'internal_state',
  'evidenceConfidence',
  'evidence_confidence',
  'payload_json',
  'result_json',
  'raw_json',
  'trustScore',
  'trust_score',
]);

function scanForbiddenKeys(obj: unknown, path = ''): string[] {
  const violations: string[] = [];
  if (obj === null || typeof obj !== 'object') {
    return violations;
  }
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      violations.push(...scanForbiddenKeys(obj[i], `${path}[${i}]`));
    }
    return violations;
  }
  for (const [key, value] of Object.entries(obj)) {
    const currentPath = path ? `${path}.${key}` : key;
    if (FORBIDDEN_KEYS.has(key)) {
      violations.push(`Forbidden key '${key}' found at ${currentPath}`);
    }
    violations.push(...scanForbiddenKeys(value, currentPath));
  }
  return violations;
}

describe('publicDetail (static API shard projection)', () => {
  it('projects only displayable fields and strictly respects interpretation boundary', () => {
    const db = getDb();
    const snapshot = db.getSnapshotInfo();
    const merchants = db.getIndexData().merchants;
    expect(merchants.length).toBeGreaterThan(0);

    // Test across several merchants to ensure full coverage of analysis/brief/evidence shapes
    for (const merchant of merchants.slice(0, 5)) {
      const detail = db.getMerchantDetail(merchant.id);
      expect(detail).not.toBeNull();
      const data = publicDetail(detail!, snapshot);

      // Ensure expected top-level keys
      expect(data).toHaveProperty('merchant');
      expect(data).toHaveProperty('identifiers');
      expect(data).toHaveProperty('aliases');
      expect(data).toHaveProperty('evidence');
      expect(data).toHaveProperty('claims');
      expect(data).toHaveProperty('analysis');
      expect(data).toHaveProperty('sentiment');
      expect(data).toHaveProperty('related');
      expect(data).toHaveProperty('duplicateEvidenceCount');
      expect(data).toHaveProperty('duplicateChildrenCount');
      expect(data).toHaveProperty('sourceOnlyCount');
      expect(data).toHaveProperty('brief');
      expect(data).toHaveProperty('snapshot');

      // Merchant object whitelisting verification
      expect(data.merchant).toHaveProperty('id');
      expect(data.merchant).toHaveProperty('canonicalName');
      expect(data.merchant).not.toHaveProperty('identityConfidence');
      expect(data.merchant).not.toHaveProperty('identity_confidence');
      expect(data.merchant).not.toHaveProperty('state');

      // Evidence whitelisting verification
      for (const ev of data.evidence) {
        expect(ev).not.toHaveProperty('confidence');
        expect(ev).not.toHaveProperty('reliabilityBand');
        expect(ev).not.toHaveProperty('reliability_band');
      }

      // Related whitelisting verification
      for (const rel of data.related) {
        expect(rel).not.toHaveProperty('confidence');
      }

      // Identifiers whitelisting verification
      for (const ident of data.identifiers) {
        expect(ident).not.toHaveProperty('confidence');
      }

      // Deep scan the whole JSON response for any forbidden key leak
      const violations = scanForbiddenKeys(data);
      expect(violations).toEqual([]);
    }
  });

  it('publicDetail output is JSON-serializable (shard-safe)', () => {
    const db = getDb();
    const snapshot = db.getSnapshotInfo();
    const first = db.getIndexData().merchants[0];
    const detail = db.getMerchantDetail(first.id);
    expect(detail).not.toBeNull();
    const roundTrip = JSON.parse(JSON.stringify(publicDetail(detail!, snapshot)));
    expect(roundTrip.merchant.id).toBe(first.id);
  });
});
