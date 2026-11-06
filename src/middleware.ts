import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;
  const supabase = createServerClient(url, key, { cookies: { getAll: () => request.cookies.getAll(), setAll: (values) => { values.forEach(({ name, value }) => request.cookies.set(name, value)); response = NextResponse.next({ request }); values.forEach(({ name, value, options }) => response.cookies.set(name, value, options)); } } });
  const { data: { user } } = await supabase.auth.getUser();
  const allowed = (process.env.ALLOWED_USER_IDS ?? '').split(',').map(x => x.trim()).filter(Boolean);
  const isAllowed = !!user && allowed.includes(user.id);
  if (!isAllowed && request.nextUrl.pathname !== '/login') return NextResponse.redirect(new URL(user ? '/login?denied=1' : '/login', request.url));
  if (isAllowed && request.nextUrl.pathname === '/login') return NextResponse.redirect(new URL('/', request.url));
  return response;
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'] };
