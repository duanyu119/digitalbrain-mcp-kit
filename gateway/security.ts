import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
export type AppEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };
export type AuthProps = { userId: string; scopes: string[] };
export async function hash(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(n => n.toString(16).padStart(2,'0')).join('');
}
export async function activeUser(env: Env, userId: string) {
  return env.DB.prepare('SELECT id FROM users WHERE id=? AND active=1 AND expires_at>?').bind(userId, Math.floor(Date.now()/1000)).first<{id: string}>();
}
export async function keyUser(env: Env, key: string) {
  if (!/^db_[A-Za-z0-9_-]{43}$/.test(key)) return null;
  return env.DB.prepare('SELECT id FROM users WHERE key_hash=? AND active=1 AND expires_at>?').bind(await hash(key), Math.floor(Date.now()/1000)).first<{id: string}>();
}
export async function boundedBody(request: Pick<Request, 'headers' | 'body'>, maxBytes = 16384) {
  if (Number(request.headers.get('content-length') || 0) > maxBytes) throw new Error('BODY_TOO_LARGE');
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new Error('BODY_TOO_LARGE'); }
    parts.push(value);
  }
  const body = new Uint8Array(size); let offset = 0;
  for (const part of parts) { body.set(part, offset); offset += part.byteLength; }
  return body;
}
export const escapeHtml = (v: string) => v.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function html(body: string, headers: Record<string,string> = {}) {
  return new Response(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>DigitalBrain Research MCP</title><style>body{font:17px/1.7 system-ui;background:#f7f7f3;color:#173734;max-width:640px;margin:10vh auto;padding:24px}h1{font-size:28px}input,button{font:inherit;padding:12px;box-sizing:border-box}input[type=password]{width:100%;margin:12px 0}button{background:#173734;color:white;border:0;border-radius:8px}small{color:#567}code{overflow-wrap:anywhere}</style>${body}</html>`, {headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...headers}});
}
