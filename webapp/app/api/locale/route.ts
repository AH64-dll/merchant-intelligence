import { NextResponse } from 'next/server';
import { LOCALE_COOKIE, type Locale } from '@/lib/i18n';

export async function POST(request: Request): Promise<NextResponse> {
  const form = await request.formData();
  const lang = String(form.get('lang') ?? 'ar');
  const locale: Locale = lang === 'en' ? 'en' : 'ar';
  const response = NextResponse.redirect(new URL('/', request.url), { status: 303 });
  response.cookies.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
  return response;
}
