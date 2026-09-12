import { NextResponse } from 'next/server';
import { LOCALE_COOKIE, type Locale } from '@/lib/i18n';

export async function POST(request: Request): Promise<NextResponse> {
  let locale: Locale = 'ar';
  try {
    const form = await request.formData();
    locale = String(form.get('lang') ?? 'ar') === 'en' ? 'en' : 'ar';
  } catch {
    // A non-form content type cannot carry a locale switch; keep the default.
  }
  // A relative Location keeps the redirect on this origin: the request URL
  // (and its client-supplied Host header) must never choose the target.
  const response = new NextResponse(null, { status: 303, headers: { location: '/' } });
  response.cookies.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    httpOnly: true,
    secure: true,
  });
  return response;
}
