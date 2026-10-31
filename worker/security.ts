import { assert } from './validation';
import type { StorageEnv } from './storage';
const encoder = new TextEncoder();
export async function hash(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return Array.from(
    new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}
export function randomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(
    crypto.getRandomValues(new Uint8Array(10)),
    (b) => alphabet[b % alphabet.length],
  ).join('');
}
export function codesEnabled(env: StorageEnv): boolean {
  return env.STUDENT_CODES_ENABLED === 'true';
}
export async function teacherPasswordValid(value: string, env: StorageEnv): Promise<boolean> {
  assert(
    env.TEACHER_PASSWORD && env.TEACHER_PASSWORD.length >= 12,
    '請先設定至少 12 字元的 TEACHER_PASSWORD Secret',
    503,
  );
  const a = await hash(value, env.SESSION_SECRET!),
    b = await hash(env.TEACHER_PASSWORD, env.SESSION_SECRET!);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
export function checkOrigin(request: Request): void {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    assert(
      request.headers.get('Origin') === new URL(request.url).origin,
      '來源驗證失敗，請從相同網站操作',
      403,
    );
    assert(
      request.method === 'DELETE' ||
        request.headers.get('Content-Type')?.split(';')[0] === 'application/json',
      '請使用 JSON 請求',
      415,
    );
  }
  assert(request.headers.get('Sec-Fetch-Site') !== 'cross-site', '不接受跨網站請求', 403);
}
export function demoAllowed(request: Request, env: StorageEnv): boolean {
  return (
    ['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname) ||
    env.ALLOW_PUBLIC_DEMO === 'true'
  );
}
