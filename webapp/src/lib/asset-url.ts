/**
 * URL prefix for runtime-fetched static assets (/data/*.json).
 *
 * When the site is deployed under a basePath (GitHub Pages project site),
 * browser `fetch('/data/…')` must include the prefix; Link/router already
 * prepend it automatically, raw fetch does not.
 */
export function assetUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  return `${base}${path}`;
}
