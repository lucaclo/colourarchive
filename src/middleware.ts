import { defineMiddleware } from 'astro:middleware';
import { WRITE_METHODS, writeAllowed, isJsonish, badJson } from './lib/api-guard';

// Every write to /api: from this app only, and a body that isn't JSON gets a
// plain 400 instead of the parser's own message as a 500. See lib/api-guard.ts.
export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url } = context;
  if (!url.pathname.startsWith('/api/') || !WRITE_METHODS.has(request.method)) return next();

  if (!writeAllowed(request.headers, url.origin)) {
    return json({ ok: false, error: 'Not from this app' }, 403);
  }
  if (isJsonish(request.headers.get('content-type')) && badJson(await request.clone().text())) {
    return json({ ok: false, error: 'Not valid JSON' }, 400);
  }
  return next();
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
