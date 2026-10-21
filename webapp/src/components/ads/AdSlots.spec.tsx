import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import path from 'node:path';

import { AdBottomBanner } from './AdBottomBanner';
import { AdSidebarBanner } from './AdSidebarBanner';
import { AdSlot } from './AdSlot';
import { AdSenseScript } from './AdSenseScript';
import { ConsentBanner } from './ConsentBanner';
import PrivacyPage from '../../../app/[locale]/privacy/page';
import { normalizePublisherId, areAdsEnabled, getAdSenseConfig, canDisplayAdsOnPage } from '@/lib/ads';

const ORIGINAL_ENV = { ...process.env };

describe('Google AdSense Components and Config', () => {
  beforeEach(() => {
    // Reset env vars before each test
    delete process.env.NEXT_PUBLIC_ENABLE_ADS;
    delete process.env.NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT_ID;
    delete process.env.NEXT_PUBLIC_ADSENSE_SLOT_BOTTOM;
    delete process.env.NEXT_PUBLIC_ADSENSE_SLOT_SIDEBAR;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe('AdBottomBanner', () => {
    it('renders null (nothing at all) when ads are disabled', () => {
      process.env.NEXT_PUBLIC_ENABLE_ADS = '0';
      process.env.NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT_ID = 'ca-pub-1234567890123456';
      process.env.NEXT_PUBLIC_ADSENSE_SLOT_BOTTOM = '1111111111';

      const html = renderToStaticMarkup(<AdBottomBanner />);
      expect(html).toBe('');
    });

    it('renders null when publisher client ID is missing', () => {
      process.env.NEXT_PUBLIC_ENABLE_ADS = '1';
      delete process.env.NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT_ID;
      process.env.NEXT_PUBLIC_ADSENSE_SLOT_BOTTOM = '1111111111';

      const html = renderToStaticMarkup(<AdBottomBanner />);
      expect(html).toBe('');
    });

    it('renders null when slot ID is missing', () => {
      process.env.NEXT_PUBLIC_ENABLE_ADS = '1';
      process.env.NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT_ID = 'ca-pub-1234567890123456';
      delete process.env.NEXT_PUBLIC_ADSENSE_SLOT_BOTTOM;

      const html = renderToStaticMarkup(<AdBottomBanner />);
      expect(html).toBe('');
    });

    it('renders exactly one ins.adsbygoogle with configured client, slot, and reserved-height container when enabled', () => {
      process.env.NEXT_PUBLIC_ENABLE_ADS = 'true';
      process.env.NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT_ID = 'ca-pub-1234567890123456';
      process.env.NEXT_PUBLIC_ADSENSE_SLOT_BOTTOM = '9999999999';

      const html = renderToStaticMarkup(<AdBottomBanner />);

      // Must have the .ad-slot class
      expect(html).toContain('class="ad-slot');

      // Must reserve height: ~280px on mobile, ~130px on desktop
      expect(html).toContain('min-h-[280px]');
      expect(html).toContain('sm:min-h-[130px]');

      // Must have distinct styling from content cards (dashed border + ad label + palette)
      expect(html).toContain('border-dashed');
      expect(html).toContain('border-[#e4e3de]');
      expect(html).toContain('bg-[#fdfcf9]');
      expect(html).not.toContain('border-black');
      expect(html).toContain('«إعلان»');
      // Must contain unfilled collapse rule
      expect(html).toContain(".ad-slot:has(ins[data-ad-status='unfilled'])");

      // Must render exactly one ins.adsbygoogle
      const insMatches = html.match(/<ins /g);
      expect(insMatches).toHaveLength(1);
      expect(html).toContain('class="adsbygoogle"');
      expect(html).toContain('data-ad-client="ca-pub-1234567890123456"');
      expect(html).toContain('data-ad-slot="9999999999"');
      expect(html).toContain('data-ad-format="horizontal"');
      expect(html).toContain('data-full-width-responsive="true"');
    });

    it('allows prop overrides for testing or explicit placement', () => {
      const html = renderToStaticMarkup(
        <AdBottomBanner
          enabled={true}
          clientId="pub-9876543210987654"
          slotId="5555555555"
          locale="en"
        />
      );

      expect(html).toContain('data-ad-client="ca-pub-9876543210987654"');
      expect(html).toContain('data-ad-slot="5555555555"');
      expect(html).toContain('“Ad”');
    });
  });

  describe('AdSidebarBanner', () => {
    it('renders null when disabled', () => {
      const html = renderToStaticMarkup(
        <AdSidebarBanner
          enabled={false}
          clientId="ca-pub-1234567890123456"
          slotId="2222222222"
        />
      );
      expect(html).toBe('');
    });

    it('renders exactly one ins.adsbygoogle with rectangle format and ~300px reserved height container when enabled', () => {
      process.env.NEXT_PUBLIC_ENABLE_ADS = '1';
      process.env.NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT_ID = 'ca-pub-1234567890123456';
      process.env.NEXT_PUBLIC_ADSENSE_SLOT_SIDEBAR = '2222222222';

      const html = renderToStaticMarkup(<AdSidebarBanner />);

      expect(html).toContain('class="ad-slot');
      expect(html).toContain('min-h-[250px]');
      expect(html).toContain('max-w-[300px]');
      expect(html).toContain('border-dashed');

      const insMatches = html.match(/<ins /g);
      expect(insMatches).toHaveLength(1);
      expect(html).toContain('data-ad-client="ca-pub-1234567890123456"');
      expect(html).toContain('data-ad-slot="2222222222"');
      expect(html).toContain('data-ad-format="rectangle"');
    });
  });

  describe('AdSlot (Base component)', () => {
    it('collapses unfilled ads via CSS rule', () => {
      const html = renderToStaticMarkup(
        <AdSlot
          enabled={true}
          clientId="ca-pub-1111111111111111"
          slotId="3333333333"
          format="horizontal"
          reservedHeightClass="min-h-[130px]"
        />
      );

      expect(html).toContain(".ad-slot:has(ins[data-ad-status='unfilled'])");
      expect(html).toContain('display: none !important');
    });

    it('supports custom label', () => {
      const html = renderToStaticMarkup(
        <AdSlot
          enabled={true}
          clientId="ca-pub-1111111111111111"
          slotId="3333333333"
          format="horizontal"
          reservedHeightClass="min-h-[130px]"
          label="إعلان تجاري مدعوم"
        />
      );

      expect(html).toContain('إعلان تجاري مدعوم');
    });
  });

  describe('AdSenseScript', () => {
    it('renders null when disabled or missing client ID', () => {
      expect(renderToStaticMarkup(<AdSenseScript enabled={false} clientId="ca-pub-1" />)).toBe('');
      expect(renderToStaticMarkup(<AdSenseScript enabled={true} clientId="" />)).toBe('');
    });

    it('renders Consent Mode v2 default denied snippet and AdSense script loader when enabled', () => {
      const html = renderToStaticMarkup(
        <AdSenseScript enabled={true} clientId="pub-1234567890123456" />
      );

      expect(html).toContain('gtag');
      expect(html).toContain("'ad_storage':'denied'");
      expect(html).toContain("'ad_user_data':'denied'");
      expect(html).toContain("'ad_personalization':'denied'");
      expect(html).toContain('pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456');
    });
  });
  describe('ConsentBanner', () => {
    it('renders cookie notice and action buttons in SSR pending state', () => {
      const html = renderToStaticMarkup(<ConsentBanner locale="ar" />);
      expect(html).toContain('ملفات تعريف الارتباط');
      expect(html).toContain('موافق');
      expect(html).toContain('رفض');
      expect(html).toContain('bg-[#fdfcf9]');
      expect(html).toContain('bg-[#4a7c7e]');
      expect(html).not.toContain('border-black');
      expect(html).not.toContain('bg-black');
    });

    it('renders English text when locale is en', () => {
      const html = renderToStaticMarkup(<ConsentBanner locale="en" />);
      expect(html).toContain('Privacy and cookie notice');
      expect(html).toContain('Accept');
      expect(html).toContain('Reject');
    });
  });


  describe('ads.ts library functions', () => {
    it('areAdsEnabled correctly checks boolean-like strings', () => {
      process.env.NEXT_PUBLIC_ENABLE_ADS = '1';
      expect(areAdsEnabled()).toBe(true);
      process.env.NEXT_PUBLIC_ENABLE_ADS = 'true';
      expect(areAdsEnabled()).toBe(true);
      process.env.NEXT_PUBLIC_ENABLE_ADS = 'yes';
      expect(areAdsEnabled()).toBe(true);
      process.env.NEXT_PUBLIC_ENABLE_ADS = '0';
      expect(areAdsEnabled()).toBe(false);
      process.env.NEXT_PUBLIC_ENABLE_ADS = 'false';
      expect(areAdsEnabled()).toBe(false);
      delete process.env.NEXT_PUBLIC_ENABLE_ADS;
      expect(areAdsEnabled()).toBe(false);
    });

    it('normalizePublisherId canonicalizes client IDs to ca-pub- prefix', () => {
      expect(normalizePublisherId('ca-pub-12345')).toBe('ca-pub-12345');
      expect(normalizePublisherId('pub-12345')).toBe('ca-pub-12345');
      expect(normalizePublisherId('12345')).toBe('ca-pub-12345');
    });

    it('getAdSenseConfig extracts all 4 env variables', () => {
      process.env.NEXT_PUBLIC_ENABLE_ADS = '1';
      process.env.NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT_ID = 'pub-999';
      process.env.NEXT_PUBLIC_ADSENSE_SLOT_BOTTOM = 'bottom-1';
      process.env.NEXT_PUBLIC_ADSENSE_SLOT_SIDEBAR = 'side-2';

      const config = getAdSenseConfig();
      expect(config.enabled).toBe(true);
      expect(config.clientId).toBe('ca-pub-999');
      expect(config.slots.bottom).toBe('bottom-1');
      expect(config.slots.sidebar).toBe('side-2');
    });

    it('canDisplayAdsOnPage respects brand safety adverse claim policy', () => {
      expect(canDisplayAdsOnPage()).toBe(true);
      expect(canDisplayAdsOnPage({ hasAdverseClaims: false, hasOfficialWarning: false })).toBe(true);
      expect(canDisplayAdsOnPage({ hasAdverseClaims: true })).toBe(false);
      expect(canDisplayAdsOnPage({ hasOfficialWarning: true })).toBe(false);
      expect(canDisplayAdsOnPage({ isHighRisk: true })).toBe(false);
    });
  });

  describe('Static Assets & Configuration Integrity', () => {
    it('public/ads.txt exists with canonical AdSense format', () => {
      const adsTxtPath = path.resolve(__dirname, '../../../public/ads.txt');
      expect(fs.existsSync(adsTxtPath)).toBe(true);

      const content = fs.readFileSync(adsTxtPath, 'utf8');
      expect(content).toContain('google.com');
      expect(content).toContain('DIRECT');
      expect(content).toContain('f08c47fec0942fa0');
      expect(content).toMatch(/google\.com,\s*pub-[A-Za-z0-9]+,\s*DIRECT,\s*f08c47fec0942fa0/);
    });

    it('.env.example documents all four required variables with safe defaults', () => {
      const envPath = path.resolve(__dirname, '../../../.env.example');
      expect(fs.existsSync(envPath)).toBe(true);

      const content = fs.readFileSync(envPath, 'utf8');
      expect(content).toContain('NEXT_PUBLIC_ENABLE_ADS=0');
      expect(content).toContain('NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT_ID=');
      expect(content).toContain('NEXT_PUBLIC_ADSENSE_SLOT_BOTTOM=');
      expect(content).toContain('NEXT_PUBLIC_ADSENSE_SLOT_SIDEBAR=');
    });
    it('app/[locale]/privacy/page.tsx exists and covers required policy sections', () => {
      const privacyPath = path.resolve(__dirname, '../../../app/[locale]/privacy/page.tsx');
      expect(fs.existsSync(privacyPath)).toBe(true);
      const content = fs.readFileSync(privacyPath, 'utf8');
      // Policy language: evidence is never advertising; ads are labelled; no
      // AdSense/opt-out mechanics disclosed to the reader.
      expect(content).toContain('mi_lang');
      expect(content).toContain('No Ads Embedded Within Evidence or Reviews');
      expect(content).toContain('Future Advertising Transparency');
      expect(content).toContain('حظر الإعلانات داخل الأدلة والتقييمات');
      expect(content).toContain('سياسة جمع الأدلة والشفافية الإعلانية');
      expect(content).not.toContain('Google AdSense');
      expect(content).not.toContain('adssettings.google.com');
      expect(content).not.toContain('aboutads.info');
      expect(content).not.toContain('mi_ad_consent');
    });

    it('renders /privacy page in Arabic with all required disclosure sections', async () => {
      const jsx = await PrivacyPage({ params: Promise.resolve({ locale: 'ar' }) });
      const html = renderToStaticMarkup(jsx);
      expect(html).toContain('class="page-heading"');
      expect(html).toContain('report-section method-item');
      expect(html).toContain('سياسة الخصوصية والشفافية التوثيقية');
      expect(html).toContain('طبيعة الخدمة والبيانات المنشورة');
      expect(html).toContain('ملفات تعريف الارتباط والتفضيلات التقنية');
      expect(html).toContain('سياسة جمع الأدلة والشفافية الإعلانية');
      expect(html).toContain('حظر الإعلانات داخل الأدلة والتقييمات');
      expect(html).toContain('إخلاء المسؤولية وعدم الضمان');
    });

    it('renders /privacy page in English with all required disclosure sections', async () => {
      const jsx = await PrivacyPage({ params: Promise.resolve({ locale: 'en' }) });
      const html = renderToStaticMarkup(jsx);
      expect(html).toContain('class="page-heading"');
      expect(html).toContain('report-section method-item');
      expect(html).toContain('Privacy Policy &amp; Evidence Transparency');
      expect(html).toContain('Nature of the Service &amp; Published Data');
      expect(html).toContain('Cookies &amp; Technical Preferences');
      expect(html).toContain('Evidence Collection &amp; Ad Transparency Policy');
      expect(html).toContain('No Ads Embedded Within Evidence or Reviews');
      expect(html).toContain('Non-Guarantee &amp; Non-Judgement Disclaimer');
    });
  });
});
