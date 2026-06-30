import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const basicAuth = req.headers.get('authorization');

  if (basicAuth) {
    const authValue = basicAuth.split(' ')[1];
    const [user, pwd] = atob(authValue).split(':');

    // 👇 ユーザー名「admin」、パスワード「team2026」に設定しています。
    // 必要に応じてお好きな文字に書き換えてください。
    if (user === 'admin' && pwd === 'team2026') {
      return NextResponse.next();
    }
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Secure Area"',
    },
  });
}

// サイト全体にBasic認証を適用する設定
export const config = {
  matcher: '/:path*',
};