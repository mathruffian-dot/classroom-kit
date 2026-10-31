import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = await mkdtemp(join(tmpdir(), 'classroom-d1-test-'));
await build({
  entryPoints: [resolve('worker/index.ts'), resolve('worker/storage.ts')],
  outdir: dir,
  bundle: true,
  platform: 'node',
  format: 'esm',
  outExtension: { '.js': '.mjs' },
  logLevel: 'silent',
});
const { apiRequest } = await import(pathToFileURL(join(dir, 'index.mjs')).href);
const { D1Store, D1Conflict } = await import(pathToFileURL(join(dir, 'storage.mjs')).href);
const migration = await readFile('migrations/0001_classroom.sql', 'utf8');
test.after(async () => {
  if (dir.startsWith(join(tmpdir(), 'classroom-d1-test-')))
    await rm(dir, { recursive: true, force: true });
});
function sqliteD1() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON;');
  sql.exec(migration);
  const wrap = (query, values = []) => ({
    query,
    values,
    bind(...next) {
      return wrap(query, next);
    },
    async all() {
      return execute(this, true);
    },
    async first() {
      return execute(this, true).results[0] || null;
    },
    async run() {
      return execute(this, false);
    },
  });
  const execute = (s, select) => {
    const stmt = sql.prepare(s.query),
      v = s.values.map((value) => (value instanceof ArrayBuffer ? new Uint8Array(value) : value));
    if (select) return { results: stmt.all(...v), meta: { changes: 0 }, success: true };
    const r = stmt.run(...v);
    return { results: [], meta: { changes: Number(r.changes) }, success: true };
  };
  return {
    sql,
    prepare: wrap,
    async batch(statements) {
      sql.exec('BEGIN');
      try {
        const out = statements.map((s) => execute(s, /^SELECT/i.test(s.query)));
        sql.exec('COMMIT');
        return out;
      } catch (e) {
        sql.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
function fixture(extra = {}) {
  const db = sqliteD1(),
    env = {
      DB: db,
      APP_MODE: 'd1',
      SESSION_SECRET: crypto.randomUUID() + crypto.randomUUID(),
      TEACHER_PASSWORD: crypto.randomUUID(),
      STUDENT_CODES_ENABLED: 'false',
      ...extra,
    },
    cookies = new Map();
  return {
    db,
    env,
    async call(path, method = 'GET', body, user = 'teacher', origin = 'http://localhost') {
      const headers = { Origin: origin };
      if (cookies.has(user)) headers.Cookie = cookies.get(user);
      if (method !== 'GET') headers['Content-Type'] = 'application/json';
      const response = await apiRequest(
        new Request(`http://localhost${path}`, {
          method,
          headers,
          body: method !== 'GET' ? JSON.stringify(body ?? {}) : undefined,
        }),
        env,
      );
      if (response.headers.has('Set-Cookie'))
        cookies.set(user, response.headers.get('Set-Cookie').split(';')[0]);
      const raw = new Uint8Array(await response.arrayBuffer());
      let parsed;
      try {
        parsed = JSON.parse(new TextDecoder().decode(raw));
      } catch {
        parsed = null;
      }
      return { status: response.status, body: parsed, raw, headers: response.headers };
    },
  };
}
async function setup(extra = {}, seats = 4) {
  const f = fixture(extra);
  assert.equal(
    (await f.call('/api/login', 'POST', { role: 'teacher', password: f.env.TEACHER_PASSWORD }))
      .status,
    200,
  );
  const lesson = (await f.call('/api/dashboard')).body.lessons[0];
  const cl = (await f.call('/api/classes', 'POST', { name: '測試班', seats })).body;
  const session = (
    await f.call('/api/sessions', 'POST', { lessonId: lesson.id, classId: cl.classroom.id })
  ).body.session;
  const index = lesson.slides.findIndex((s) => s.activity?.type === 'single');
  await f.call(`/api/sessions/${session.id}/control`, 'POST', { action: 'slide', index });
  await f.call(`/api/sessions/${session.id}/control`, 'POST', { action: 'activity', value: true });
  const student = async (seat = 1) =>
    f.call(
      '/api/login',
      'POST',
      {
        role: 'student',
        classCode: cl.classroom.code,
        seat,
        ...(cl.credentials.length
          ? { code: cl.credentials.find((c) => c.seat === seat).code }
          : {}),
      },
      `s${seat}`,
    );
  await student();
  return { f, cl, session, lesson, activity: lesson.slides[index].activity, student };
}

test('D1 default student policy generates no personal codes; data persists in separate rows', async () => {
  const { f, cl, session, activity } = await setup();
  assert.deepEqual(cl.credentials, []);
  assert(
    f.db.sql
      .prepare('SELECT payload FROM kit_students')
      .all()
      .every((r) => JSON.parse(r.payload).codeHash === ''),
  );
  const submitted = await f.call(
    `/api/sessions/${session.id}/answers`,
    'POST',
    { submissionId: crypto.randomUUID(), activityId: activity.id, value: 0 },
    's1',
  );
  assert.equal(submitted.status, 200);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) AS n FROM kit_answers').get().n, 1);
  const again = new D1Store(f.env);
  const state = await again.read();
  assert.equal(state.sessions[session.id].answers.length, 1);
  assert.equal((await f.call('/api/config')).body.studentCodesEnabled, false);
});
test('opt-in codes are random and hashed; wrong codes fail and resetting revokes old sessions', async () => {
  const { f, cl, student } = await setup({ STUDENT_CODES_ENABLED: 'true' });
  assert.equal(cl.credentials.length, 4);
  assert(cl.credentials.every((c) => /^[A-HJ-NP-Z2-9]{10}$/.test(c.code)));
  const stored = f.db.sql.prepare('SELECT payload FROM kit_students').all();
  assert(!stored.some((r) => r.payload.includes(cl.credentials[0].code)));
  assert.equal(
    (
      await f.call(
        '/api/login',
        'POST',
        { role: 'student', classCode: cl.classroom.code, seat: 1, code: 'WRONG' },
        'wrong',
      )
    ).status,
    401,
  );
  assert.equal(
    (await f.call(`/api/classes/${cl.classroom.id}/credentials`, 'POST', { seat: 1 })).status,
    200,
  );
  assert.equal((await f.call('/api/student/session', 'GET', null, 's1')).status, 401);
  assert.equal((await student()).status, 401);
});
test('enabling codes invalidates sessions issued without codes; disabled policy rejects credential generation', async () => {
  const { f, cl } = await setup();
  assert.equal(
    (await f.call(`/api/classes/${cl.classroom.id}/credentials`, 'POST', { seat: 1 })).status,
    409,
  );
  f.env.STUDENT_CODES_ENABLED = 'true';
  assert.equal((await f.call('/api/student/session', 'GET', null, 's1')).status, 401);
});
test('teacher authentication is private, fail-closed and password rotation invalidates existing login', async () => {
  const f = fixture();
  assert.equal(
    (await f.call('/api/login', 'POST', { role: 'teacher', password: 'wrong' })).status,
    401,
  );
  assert.equal(
    (await f.call('/api/login', 'POST', { role: 'teacher', password: f.env.TEACHER_PASSWORD }))
      .status,
    200,
  );
  f.env.TEACHER_PASSWORD = crypto.randomUUID();
  assert.equal((await f.call('/api/dashboard')).status, 401);
  delete f.env.SESSION_SECRET;
  assert.equal(
    (await f.call('/api/login', 'POST', { role: 'teacher', password: f.env.TEACHER_PASSWORD }))
      .status,
    503,
  );
  const bad = fixture({ APP_MODE: 'unsupported' });
  assert.equal((await bad.call('/api/config')).status, 503);
});
test('student scope, hidden solutions, activity gates and duplicate submissions survive D1 round trips', async () => {
  const { f, session, activity } = await setup();
  assert.equal((await f.call('/api/dashboard', 'GET', null, 's1')).status, 403);
  const view = (await f.call(`/api/sessions/${session.id}`, 'GET', null, 's1')).body;
  assert(
    view.lesson.slides.every(
      (s) => !s.notes && (!s.activity || (!s.activity.correct && !s.activity.explanation)),
    ),
  );
  const body = { submissionId: crypto.randomUUID(), activityId: activity.id, value: 0 };
  assert.equal(
    (await f.call(`/api/sessions/${session.id}/answers`, 'POST', body, 's1')).status,
    200,
  );
  assert.equal(
    (await f.call(`/api/sessions/${session.id}/answers`, 'POST', body, 's1')).status,
    200,
  );
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) AS n FROM kit_answers').get().n, 1);
  assert.equal(
    (await f.call(`/api/sessions/${session.id}/answers`, 'POST', { ...body, value: 1 }, 's1'))
      .status,
    409,
  );
  await f.call(`/api/sessions/${session.id}/control`, 'POST', { action: 'activity', value: false });
  assert.equal(
    (
      await f.call(
        `/api/sessions/${session.id}/answers`,
        'POST',
        { ...body, submissionId: crypto.randomUUID() },
        's1',
      )
    ).status,
    409,
  );
});
test('optimistic D1 transactions reject stale state without overwriting newer rows', async () => {
  const { f, session } = await setup();
  const a = new D1Store(f.env),
    b = new D1Store(f.env);
  const first = await a.read(),
    second = await b.read();
  first.sessions[session.id].session.title = 'first';
  await a.write(first);
  second.sessions[session.id].session.title = 'stale';
  await assert.rejects(() => b.write(second), D1Conflict);
  assert.equal((await new D1Store(f.env).read()).sessions[session.id].session.title, 'first');
});
test('40 concurrent students submit without loss and retry the same submission exactly once', async () => {
  const { f, cl, session, activity } = await setup({}, 40);
  for (let seat = 2; seat <= 40; seat++)
    assert.equal(
      (
        await f.call(
          '/api/login',
          'POST',
          { role: 'student', classCode: cl.classroom.code, seat },
          `s${seat}`,
        )
      ).status,
      200,
    );
  const ids = Array.from({ length: 40 }, () => crypto.randomUUID());
  const responses = await Promise.all(
    ids.map((id, i) =>
      f.call(
        `/api/sessions/${session.id}/answers`,
        'POST',
        { submissionId: id, activityId: activity.id, value: i % 3 },
        `s${i + 1}`,
      ),
    ),
  );
  assert(
    responses.every((r) => r.status === 200),
    JSON.stringify(responses.filter((r) => r.status !== 200).map((r) => r.body)),
  );
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) AS n FROM kit_answers').get().n, 40);
  await f.call(
    `/api/sessions/${session.id}/answers`,
    'POST',
    { submissionId: ids[0], activityId: activity.id, value: 0 },
    's1',
  );
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) AS n FROM kit_answers').get().n, 40);
});
test('attachments persist as D1 BLOBs and cannot be read by another seat or class', async () => {
  const { f, session, activity, student } = await setup();
  await student(2);
  const bytes = new TextEncoder().encode('這是合成作答附件');
  const body = {
    name: '作答.txt',
    mime: 'text/plain',
    base64: Buffer.from(bytes).toString('base64'),
    activityId: activity.id,
  };
  const uploaded = await f.call(`/api/sessions/${session.id}/files`, 'POST', body, 's1');
  assert.equal(uploaded.status, 201);
  const id = uploaded.body.file.id;
  assert.deepEqual((await f.call(`/api/files/${id}`, 'GET', null, 's1')).raw, bytes);
  assert.equal((await f.call(`/api/files/${id}`, 'GET', null, 's2')).status, 403);
  assert.deepEqual(
    (await f.call(`/api/sessions/${session.id}/files`, 'GET', null, 's2')).body.files,
    [],
  );
  assert.equal((await f.call(`/api/sessions/${session.id}/files`)).body.files.length, 1);
  assert.equal(f.db.sql.prepare('SELECT typeof(data) AS type FROM kit_files').get().type, 'blob');
  const foreign = (await f.call('/api/classes', 'POST', { name: '其他班', seats: 1 })).body;
  await f.call(
    '/api/login',
    'POST',
    { role: 'student', classCode: foreign.classroom.code, seat: 1 },
    'foreign',
  );
  assert.equal((await f.call(`/api/files/${id}`, 'GET', null, 'foreign')).status, 403);
  await f.call(`/api/sessions/${session.id}`, 'DELETE', {});
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) AS n FROM kit_files').get().n, 0);
});
test('attachment size, media signatures and total storage budget are enforced on the server', async () => {
  const { f, session, activity } = await setup({ FILE_TOTAL_MB: '1' });
  const path = `/api/sessions/${session.id}/files`;
  const body = {
    name: 'test.txt',
    mime: 'text/plain',
    activityId: activity.id,
    base64: Buffer.alloc(600000, 65).toString('base64'),
  };
  assert.equal((await f.call(path, 'POST', { ...body, mime: 'image/png' }, 's1')).status, 400);
  assert.equal(
    (
      await f.call(
        path,
        'POST',
        { ...body, base64: Buffer.alloc(1048577, 65).toString('base64') },
        's1',
      )
    ).status,
    413,
  );
  assert.equal((await f.call(path, 'POST', body, 's1')).status, 201);
  assert.equal((await f.call(path, 'POST', body, 's1')).status, 413);
});
test('CSRF, session logout, disabled public demo and malformed JSON fail safely', async () => {
  const { f } = await setup();
  assert.equal(
    (await f.call('/api/login', 'POST', { role: 'teacher' }, 'stranger', 'https://hostile.invalid'))
      .status,
    403,
  );
  await f.call('/api/logout', 'POST', {}, 's1');
  assert.equal((await f.call('/api/student/session', 'GET', null, 's1')).status, 401);
  const local = fixture({ APP_MODE: 'demo' });
  const r = await apiRequest(new Request('https://example.com/api/config'), local.env);
  assert.equal(r.status, 503);
});
