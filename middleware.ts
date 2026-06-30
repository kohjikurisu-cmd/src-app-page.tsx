import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const basicAuth = req.headers.get('authorization');

  if (basicAuth) {
    const authValue = basicAuth.split(' ')[1];
    const [user, pwd] = atob(authValue).split(':');

    // 👇 ユーザー名「admin」、パスワード「team2026」にする場合の設定です。自由に変更してください！
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

// サイト全体（すべてのページ）にBasic認証を適用する設定
export const config = {
  matcher: '/:path*',
};