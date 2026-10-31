import { handleApi } from './app';
import { D1Store, allowLogin, type StorageEnv } from './storage';
import { checkOrigin } from './security';
import { HttpError } from './validation';
interface Env extends StorageEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
}
export async function apiRequest(request: Request, env: StorageEnv): Promise<Response> {
  try {
    checkOrigin(request);
    if (
      request.method === 'POST' &&
      new URL(request.url).pathname === '/api/login' &&
      !(await allowLogin(env, request.headers.get('CF-Connecting-IP') || 'local'))
    )
      return Response.json(
        { error: '登入嘗試過多，請於 10 分鐘後重試' },
        { status: 429, headers: { 'Retry-After': '600' } },
      );
    for (let attempt = 0; attempt < 12; attempt++) {
      let deferred: (() => Promise<{ mode: 'mock' | 'live'; text: string }>) | undefined;
      const response = await handleApi(request.clone(), {
        env,
        store: new D1Store(env),
        deferAi: (fn) => {
          deferred = fn;
        },
      });
      if (response.headers.get('X-D1-Retry') === '1' && attempt < 11) {
        await new Promise((resolve) =>
          setTimeout(resolve, 10 + crypto.getRandomValues(new Uint8Array(1))[0] * (attempt + 1)),
        );
        continue;
      }
      if (deferred && response.ok) return Response.json(await deferred());
      return response;
    }
    return Response.json({ error: '資料忙碌，請稍後重試' }, { status: 409 });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof HttpError ? error.message : 'D1 暫時無法使用，請確認綁定與 migration',
      },
      { status: error instanceof HttpError ? error.status : 503 },
    );
  }
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const response = url.pathname.startsWith('/api/')
      ? await apiRequest(request, env)
      : await env.ASSETS.fetch(request);
    const secured = new Response(response.body, response);
    secured.headers.set('X-Content-Type-Options', 'nosniff');
    secured.headers.set('Referrer-Policy', 'same-origin');
    const custom =
      /^\/api\/(?:sessions|lessons)\/[\w-]+\/slides\/[\w-]+\/html$/.test(url.pathname) &&
      response.headers.get('Content-Type')?.startsWith('text/html');
    secured.headers.set('X-Frame-Options', custom ? 'SAMEORIGIN' : 'DENY');
    secured.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    secured.headers.set(
      'Content-Security-Policy',
      custom
        ? "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"
        : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    );
    if (url.protocol === 'https:')
      secured.headers.set('Strict-Transport-Security', 'max-age=31536000');
    if (url.pathname.startsWith('/api/')) secured.headers.set('Cache-Control', 'no-store');
    return secured;
  },
};
