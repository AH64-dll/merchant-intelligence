import type { NextConfig } from 'next';

import { CONTENT_SECURITY_POLICY } from './src/lib/csp';

// Referenced by scripts/export-headers.ts to emit public/_headers at build
// time; imported here so the constant stays the single source of truth.
export { CONTENT_SECURITY_POLICY };

const nextConfig: NextConfig = {
  output: 'export',
  // Stop advertising the framework version on every response.
  poweredByHeader: false,
  // Directory-style URLs (…/ar/merchants/index.html) resolve cleanly on every
  // static host: GitHub Pages, Cloudflare Pages, Netlify, S3.
  trailingSlash: true,
  // next/image has no optimization server under static export.
  images: { unoptimized: true },
  // Optional project-site path prefix (e.g. GitHub Pages without a custom
  // domain): set NEXT_PUBLIC_BASE_PATH=/repo-name at build time.
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? '',
};
export default nextConfig;
