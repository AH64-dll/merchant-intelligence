import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { MerchantDb } from './db';
import { SearchIndex } from './search';

const DB_PATH = fileURLToPath(new URL('../../data/merchants.db', import.meta.url));

interface CoverageTestSample {
  field: string;
  query: string;
  expectedMerchantId: string;
  description: string;
}

let db: MerchantDb;
let index: SearchIndex;

beforeAll(() => {
  db = new MerchantDb(DB_PATH);
  index = SearchIndex.fromDb(db);
});

describe('100% Search Coverage Proof — per-field reachable verification', () => {
  const SAMPLES: CoverageTestSample[] = [
    {
      field: 'canonical_name',
      query: 'Sigma Computer',
      expectedMerchantId: '3da82768-832c-4bf5-80c1-6cf3059cf5c5',
      description: 'Canonical merchant name exact lookup',
    },
    {
      field: 'normalized_name',
      query: 'sigma computer',
      expectedMerchantId: '3da82768-832c-4bf5-80c1-6cf3059cf5c5',
      description: 'Normalized lowercased name lookup',
    },
    {
      field: 'aliases',
      query: 'تو بي',
      expectedMerchantId: '4fa441a7-25b7-4710-9da0-689241c9fd2d',
      description: 'Stored Arabic brand alias for 2B Egypt',
    },
    {
      field: 'merchant_identifiers:phone',
      query: '01000000000',
      expectedMerchantId: 'af8ba37c-a7ac-4bb5-bd84-4bbe02a3547b',
      description: 'Phone identifier in local 01... format',
    },
    {
      field: 'merchant_identifiers:whatsapp',
      query: '01000016942',
      expectedMerchantId: 'c25a5a60-e885-4916-85aa-9618d9097d18',
      description: 'WhatsApp identifier in local mobile format',
    },
    {
      field: 'merchant_identifiers:email',
      query: 'ahmed226887@gmail.com',
      expectedMerchantId: '98e83f64-7837-4173-b7df-0fb2dce03c9c',
      description: 'Contact email identifier',
    },
    {
      field: 'merchant_identifiers:website_domain',
      query: 'castle.eg',
      expectedMerchantId: 'cf7cff2f-381d-4c6c-af00-13b9bcf93d3d',
      description: 'Official website bare domain identifier',
    },
    {
      field: 'merchant_identifiers:facebook',
      query: 'facebook.com/MTIholding',
      expectedMerchantId: '9af176b0-b896-4494-bcfb-d1ef85166ba5',
      description: 'Facebook platform profile URL identifier',
    },
    {
      field: 'merchant_identifiers:instagram',
      query: '2begypt',
      expectedMerchantId: '4fa441a7-25b7-4710-9da0-689241c9fd2d',
      description: 'Instagram handle identifier',
    },
    {
      field: 'merchant_identifiers:tiktok',
      query: 'compumarts',
      expectedMerchantId: '534350dd-ec1f-41bc-b430-6ef5277947da',
      description: 'TikTok account handle identifier',
    },
    {
      field: 'merchant_identifiers:google_maps',
      query: 'g.page/ikelvinatorr',
      expectedMerchantId: 'b08b8b97-922f-4063-bdee-eaa06a534f7e',
      description: 'Google Maps shortlink identifier',
    },
    {
      field: 'merchant_identifiers:marketplace',
      query: 'ahw.store',
      expectedMerchantId: '12b6cf33-4408-419d-a80a-d44bbe55e321',
      description: 'Marketplace online storefront identifier',
    },
    {
      field: 'merchant_identifiers:commercial_register',
      query: '15021',
      expectedMerchantId: '48420ec2-2aa1-4ceb-95fd-bfeb2b16f605',
      description: 'Official commercial register number identifier',
    },
    {
      field: 'merchant_identifiers:recorded_address',
      query: 'Smouha Club Main Gate',
      expectedMerchantId: 'ceb4836a-9897-4805-a975-64215ca0d0a2',
      description: 'Physical recorded branch/store address identifier',
    },
    {
      field: 'categories',
      query: 'Consumer Electronics & IT Retailer',
      expectedMerchantId: '4fa441a7-25b7-4710-9da0-689241c9fd2d',
      description: 'Merchant business category taxonomy string',
    },
    {
      field: 'claims',
      query: 'MiniCash',
      expectedMerchantId: '0abffb14-4754-4d4a-8ec7-78a5732a9264',
      description: 'Documented merchant claim text',
    },
    {
      field: 'evidence_snippets_summaries',
      query: 'والبلايستيشن',
      expectedMerchantId: '4fa441a7-25b7-4710-9da0-689241c9fd2d',
      description: 'Evidence excerpt and summary text keyword',
    },
    {
      field: 'source_urls_labels',
      query: 'FindHealthClinics',
      expectedMerchantId: 'dfd12b2a-e57c-4391-8f89-2a6d7be12c5e',
      description: 'Public source label attribution text',
    },
  ];

  it('proves that a merchant is reachable by a value sampled from every single field', () => {
    console.log('\n================== PER-FIELD SEARCH COVERAGE PROOF ==================');
    console.log(
      'Field'.padEnd(38) +
      ' | ' +
      'Query'.padEnd(30) +
      ' | ' +
      'Expected Merchant ID'.padEnd(36) +
      ' | ' +
      'Match Kind'.padEnd(16) +
      ' | Status'
    );
    console.log('-'.repeat(135));

    for (const sample of SAMPLES) {
      const res = index.search(sample.query);
      const hit = res.hits.find((h) => h.merchant.id === sample.expectedMerchantId);
      const matchKind = hit ? hit.match.kind : 'NOT_FOUND';
      const status = hit ? 'PASS' : 'FAIL';

      console.log(
        sample.field.padEnd(38) +
        ' | ' +
        sample.query.padEnd(30) +
        ' | ' +
        sample.expectedMerchantId.padEnd(36) +
        ' | ' +
        matchKind.padEnd(16) +
        ' | ' +
        status
      );

      expect(hit, `Field ${sample.field} with query "${sample.query}" must find merchant ${sample.expectedMerchantId}`).toBeDefined();
      expect(hit?.merchant.id).toBe(sample.expectedMerchantId);
    }
    console.log('====================================================================\n');
  });
});
