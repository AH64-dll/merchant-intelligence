import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { CitedBrief } from './CitedBrief';

describe('CitedBrief bilingual fallback rendering', () => {
  it('renders complete Arabic questions and identity reasons when locale is ar and brief is null', () => {
    const html = renderToStaticMarkup(
      createElement(CitedBrief, {
        brief: null,
        state: 'INSUFFICIENT_DATA',
        identifiers: [],
        evidence: [],
        locale: 'ar',
      }),
    );

    expect(html).toContain('الصورة الحالية');
    expect(html).toContain('ما الذي نعرفه عن هوية المتجر؟');
    expect(html).toContain('المعرفات المتاحة لا تكفي لتأكيد الهوية.');
    expect(html).toContain('ما الذي تقوله المصادر عن التعامل؟');
    expect(html).toContain('الأدلة غير كافية: لا توجد أدلة غير مكررة كافية لتكوين صورة عن التعامل مع هذا التاجر.');
  });

  it('renders complete English questions and identity reasons when locale is en and brief is null', () => {
    const html = renderToStaticMarkup(
      createElement(CitedBrief, {
        brief: null,
        state: 'INSUFFICIENT_DATA',
        identifiers: [],
        evidence: [],
        locale: 'en',
      }),
    );

    expect(html).toContain('Current picture');
    expect(html).toContain('What do we know about vendor identity?');
    expect(html).toContain('Available identifiers are insufficient to confirm identity.');
    expect(html).not.toContain('المعرفات المتاحة لا تكفي لتأكيد الهوية.');
    expect(html).toContain('What do sources say about dealing with the vendor?');
    expect(html).toContain('Insufficient evidence: There is not enough non-duplicate evidence to form a picture of dealings with this vendor.');
  });
});
