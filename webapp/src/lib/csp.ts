/**
 * Shared Content-Security-Policy, consumed by next.config.ts (header emission
 * for non-export hosting) and app/layout.tsx (meta tag for static export).
 * Kept as plain TypeScript so the app bundle can inline it.
 *
 * Next injects inline bootstrap/hydration scripts and inline critical CSS, so
 * a nonce-less CSP needs 'unsafe-inline'. `eval` is only required by the dev
 * overlay/React refresh, never by a production bundle.
 */
const ADSENSE_SCRIPT = [
  'https://pagead2.googlesyndication.com',
  'https://*.googlesyndication.com',
  'https://*.google.com',
  'https://*.gstatic.com',
];
const ADSENSE_FRAME = [
  'https://googleads.g.doubleclick.net',
  'https://*.googlesyndication.com',
  'https://*.doubleclick.net',
  'https://*.google.com',
];
const ADSENSE_CONNECT = [
  'https://pagead2.googlesyndication.com',
  'https://*.googlesyndication.com',
  'https://*.doubleclick.net',
  'https://*.google.com',
];

const isDevelopment = process.env.NODE_ENV === 'development';
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ''} ${ADSENSE_SCRIPT.join(' ')}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${ADSENSE_CONNECT.join(' ')}`,
  `frame-src 'self' ${ADSENSE_FRAME.join(' ')}`,
  "media-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
