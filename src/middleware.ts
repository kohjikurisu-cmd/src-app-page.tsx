import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const authorization = request.headers.get('authorization');

  if (!authorization) {
    return new NextResponse('Authentication required', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="Secure Area"',
      },
    });
  }

  try {
    const authValue = authorization.split(' ')[1];
    const [user, pwd] = atob(authValue).split(':');

    // ユーザー名「admin」、パスワード「team2026」で認証
    if (user === 'admin' && pwd === 'admin2026') {
      return NextResponse.next();
    }
  } catch (e) {
    // デコードエラーなどの場合は再度認証を求める
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Secure Area"',
    },
  });
}

// ⚠️ すべてのページ（トップページ含む）に確実に適用する設定
export const config = {
  matcher: [
    /*
     * 次のパスを除くすべてのリクエストパスにマッチさせます:
     * - api (APIルート)
     * - _next/static (静的ファイル)
     * - _next/image (画像最適化ファイル)
     * - favicon.ico (ファビコン)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};