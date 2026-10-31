import type { UploadedFile, User } from '../shared/types';
import { database, instance, MAX_FILE_BYTES, type StorageEnv } from './storage';
import { assert, str } from './validation';

export function decodeFile(body: Record<string, unknown>): {
  name: string;
  mime: string;
  bytes: Uint8Array;
} {
  const name = str(body.name, '檔名', 160, 1).replace(/[\\/\x00-\x1f]/g, '_');
  const mime = str(body.mime, '檔案類型', 80, 1);
  assert(
    ['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain'].includes(mime),
    '只接受 PNG、JPEG、WebP、PDF 或純文字',
  );
  const encoded = str(body.base64, '檔案內容', Math.ceil(MAX_FILE_BYTES / 3) * 4 + 4, 1);
  assert(/^[A-Za-z0-9+/]*={0,2}$/.test(encoded), '檔案內容不是有效的 Base64');
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  } catch {
    assert(false, '檔案內容無法解碼');
  }
  assert(bytes.length > 0 && bytes.length <= MAX_FILE_BYTES, '單檔上限為 1 MiB', 413);
  const starts = (...signature: number[]) => signature.every((v, i) => bytes[i] === v);
  if (mime === 'application/pdf') assert(starts(37, 80, 68, 70, 45), 'PDF 檔案內容不正確');
  if (mime === 'image/png') assert(starts(137, 80, 78, 71, 13, 10, 26, 10), 'PNG 檔案內容不正確');
  if (mime === 'image/jpeg') assert(starts(255, 216, 255), 'JPEG 檔案內容不正確');
  if (mime === 'image/webp')
    assert(
      starts(82, 73, 70, 70) && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP',
      'WebP 檔案內容不正確',
    );
  if (mime === 'text/plain') {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      assert(false, '純文字需要使用 UTF-8 編碼');
    }
  }
  return { name, mime, bytes };
}
export async function uploadFile(
  env: StorageEnv,
  sessionId: string,
  activityId: string,
  user: User,
  body: Record<string, unknown>,
): Promise<UploadedFile> {
  const { name, mime, bytes } = decodeFile(body);
  const file: UploadedFile = {
    id: crypto.randomUUID(),
    sessionId,
    activityId,
    userId: user.id,
    seat: user.seat!,
    name,
    mime,
    size: bytes.length,
    createdAt: new Date().toISOString(),
  };
  const maxBytes = Math.min(300, Math.max(1, Number(env.FILE_TOTAL_MB) || 100)) * 1024 * 1024;
  const r = await database(env)
    .prepare(
      `INSERT INTO kit_files(instance_id,id,session_id,user_id,metadata,bytes,data)
    SELECT ?,?,?,?,?,?,? WHERE (SELECT COALESCE(SUM(bytes),0) FROM kit_files WHERE instance_id=?) + ? <= ?
    AND (SELECT COUNT(*) FROM kit_files WHERE instance_id=? AND session_id=? AND user_id=?) < 10`,
    )
    .bind(
      instance(env),
      file.id,
      sessionId,
      user.id,
      JSON.stringify(file),
      bytes.length,
      bytes.buffer,
      instance(env),
      bytes.length,
      maxBytes,
      instance(env),
      sessionId,
      user.id,
    )
    .run();
  assert(
    r.meta.changes === 1,
    '附件空間已達上限，或此座號在本場次已有 10 個附件；請先下載並清理',
    413,
  );
  return file;
}
export async function listFiles(
  env: StorageEnv,
  sessionId: string,
  user: User,
): Promise<UploadedFile[]> {
  const r = await database(env)
    .prepare(
      'SELECT metadata FROM kit_files WHERE instance_id=? AND session_id=? AND (?=1 OR user_id=?) ORDER BY id',
    )
    .bind(instance(env), sessionId, user.role === 'teacher' ? 1 : 0, user.id)
    .all<{ metadata: string }>();
  return r.results.map((row) => JSON.parse(row.metadata));
}
export async function fileMetadata(env: StorageEnv, id: string): Promise<UploadedFile> {
  const r = await database(env)
    .prepare('SELECT metadata FROM kit_files WHERE instance_id=? AND id=?')
    .bind(instance(env), id)
    .first<{ metadata: string }>();
  assert(r, '找不到附件', 404);
  return JSON.parse(r.metadata);
}
export async function downloadFile(env: StorageEnv, file: UploadedFile): Promise<Response> {
  const r = await database(env)
    .prepare('SELECT data FROM kit_files WHERE instance_id=? AND id=?')
    .bind(instance(env), file.id)
    .first<{ data: number[] | ArrayBuffer }>();
  assert(r, '找不到附件', 404);
  const bytes = r.data instanceof ArrayBuffer ? new Uint8Array(r.data) : new Uint8Array(r.data);
  return new Response(bytes.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
export async function removeFile(env: StorageEnv, id: string): Promise<void> {
  await database(env)
    .prepare('DELETE FROM kit_files WHERE instance_id=? AND id=?')
    .bind(instance(env), id)
    .run();
}
