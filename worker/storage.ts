import { HttpError, assert } from './validation';
import type { State } from './app';

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  meta: { changes?: number; rows_read?: number; rows_written?: number };
  success: boolean;
}
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<D1Result>;
}
export interface D1Database {
  prepare(sql: string): D1Statement;
  batch<T = Record<string, unknown>>(statements: D1Statement[]): Promise<D1Result<T>[]>;
}
export interface StorageEnv {
  DB?: D1Database;
  APP_MODE?: string;
  APP_INSTANCE?: string;
  ALLOW_PUBLIC_DEMO?: string;
  SESSION_SECRET?: string;
  TEACHER_PASSWORD?: string;
  STUDENT_CODES_ENABLED?: string;
  FILE_TOTAL_MB?: string;
  POLL_INTERVAL_MS?: string;
  AI_BASE_URL?: string;
  AI_MODEL?: string;
  AI_API_KEY?: string;
  AI_DAILY_LIMIT?: string;
}
export interface Store<T> {
  read(): Promise<T | undefined>;
  write(value: T): Promise<void>;
}
export const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
export const MAX_RESTORE_BYTES = 9 * 1024 * 1024;
export const MAX_FILE_BYTES = 1024 * 1024;
export class D1Conflict extends HttpError {
  constructor() {
    super(409, '資料已更新，請重試');
  }
}
export function database(env: StorageEnv): D1Database {
  assert(env.DB, '尚未綁定 D1 DB，或尚未執行資料庫 migration', 503);
  return env.DB;
}
export function instance(env: StorageEnv): string {
  return env.APP_INSTANCE || 'default';
}
export function pollInterval(env: StorageEnv): number {
  return Math.max(5000, Math.min(60000, Number(env.POLL_INTERVAL_MS) || 10000));
}
const tables = [
  'kit_lessons',
  'kit_classes',
  'kit_students',
  'kit_sessions',
  'kit_answers',
  'kit_whiteboard',
  'kit_logins',
  'kit_ai_usage',
] as const;
type Table = (typeof tables)[number];
type Row = { table: Table; id: string; parent_id: string; payload: string };
type Cached = { revision: number; state: State };
const cache = new WeakMap<D1Database, Map<string, Cached>>();
const encoder = new TextEncoder();
function rows(state: State): Map<string, Row> {
  assert(
    encoder.encode(JSON.stringify(state)).byteLength <= MAX_SNAPSHOT_BYTES,
    '課堂資料超過 8 MiB，請匯出並清理舊場次',
    413,
  );
  const output = new Map<string, Row>();
  const add = (table: Table, id: string, value: unknown, parent = '') => {
    const payload = JSON.stringify(value);
    assert(
      encoder.encode(payload).byteLength < 1800000,
      '單項教材或課堂資料過大，請拆成較小單元',
      413,
    );
    output.set(`${table}:${id}`, { table, id, parent_id: parent, payload });
  };
  for (const [id, value] of Object.entries(state.lessons)) add('kit_lessons', id, value);
  for (const [id, value] of Object.entries(state.classes)) {
    const { students, ...metadata } = value;
    add('kit_classes', id, metadata);
    for (const student of students) add('kit_students', `${id}:${student.seat}`, student, id);
  }
  for (const [id, value] of Object.entries(state.sessions)) {
    const { answers, whiteboard, ...metadata } = value;
    add('kit_sessions', id, metadata, value.session.classId);
    for (const answer of answers) add('kit_answers', answer.id, answer, id);
    for (const [slideId, strokes] of Object.entries(whiteboard))
      strokes.forEach((stroke, order) =>
        add('kit_whiteboard', `${id}:${slideId}:${stroke.id}`, { slideId, order, stroke }, id),
      );
  }
  for (const [id, value] of Object.entries(state.logins)) add('kit_logins', id, value);
  for (const [id, value] of Object.entries(state.aiUsage)) add('kit_ai_usage', id, value);
  return output;
}
/** D1 is authoritative. The isolate cache only avoids rereading unchanged rows. */
export class D1Store implements Store<State> {
  private revision = 0;
  private previous = new Map<string, Row>();
  private db: D1Database;
  private id: string;
  constructor(private env: StorageEnv) {
    this.db = database(env);
    this.id = instance(env);
  }
  async read(): Promise<State | undefined> {
    const meta = await this.db
      .prepare('SELECT revision,secret FROM kit_meta WHERE instance_id=?')
      .bind(this.id)
      .first<{ revision: number; secret: string }>();
    if (!meta) {
      this.revision = 0;
      this.previous.clear();
      return undefined;
    }
    const hit = cache.get(this.db)?.get(this.id);
    let state: State;
    if (hit?.revision === meta.revision) {
      this.revision = hit.revision;
      state = structuredClone(hit.state);
    } else {
      const results = await this.db.batch([
        this.db.prepare('SELECT revision,secret FROM kit_meta WHERE instance_id=?').bind(this.id),
        ...tables.map((table) =>
          this.db
            .prepare(`SELECT id,parent_id,payload FROM ${table} WHERE instance_id=? ORDER BY id`)
            .bind(this.id),
        ),
      ]);
      const current = results[0].results[0] as unknown as { revision: number; secret: string };
      this.revision = current.revision;
      state = {
        version: 1,
        secret: current.secret,
        lessons: {},
        classes: {},
        sessions: {},
        logins: {},
        aiUsage: {},
      };
      for (let i = 0; i < tables.length; i++)
        for (const raw of results[i + 1].results) {
          const row = raw as unknown as { id: string; parent_id: string; payload: string };
          const value = JSON.parse(row.payload);
          switch (tables[i]) {
            case 'kit_lessons':
              state.lessons[row.id] = value;
              break;
            case 'kit_classes':
              state.classes[row.id] = { ...value, students: [] };
              break;
            case 'kit_students':
              state.classes[row.parent_id]?.students.push(value);
              break;
            case 'kit_sessions':
              state.sessions[row.id] = { ...value, answers: [], whiteboard: {} };
              break;
            case 'kit_answers':
              state.sessions[row.parent_id]?.answers.push(value);
              break;
            case 'kit_whiteboard': {
              const session = state.sessions[row.parent_id];
              if (session) (session.whiteboard[value.slideId] ||= []).push(value);
              break;
            }
            case 'kit_logins':
              state.logins[row.id] = value;
              break;
            case 'kit_ai_usage':
              state.aiUsage[row.id] = value;
              break;
          }
        }
      for (const session of Object.values(state.sessions)) {
        session.answers.sort(
          (a, b) => a.submittedAt.localeCompare(b.submittedAt) || a.id.localeCompare(b.id),
        );
        for (const slide of Object.keys(session.whiteboard)) {
          const values = session.whiteboard[slide] as unknown as {
            order: number;
            stroke: unknown;
          }[];
          session.whiteboard[slide] = values
            .sort((a, b) => a.order - b.order)
            .map((v) => v.stroke) as (typeof session.whiteboard)[string];
        }
      }
    }
    if (this.env.SESSION_SECRET) state.secret = this.env.SESSION_SECRET;
    this.previous = rows(state);
    this.remember(state);
    return state;
  }
  private remember(state: State) {
    if (!cache.has(this.db)) cache.set(this.db, new Map());
    cache.get(this.db)!.set(this.id, { revision: this.revision, state: structuredClone(state) });
  }
  async write(state: State): Promise<void> {
    const next = rows(state),
      token = crypto.randomUUID();
    const statements = [
      this.db
        .prepare('INSERT OR IGNORE INTO kit_meta(instance_id,revision) VALUES(?,0)')
        .bind(this.id),
      this.db
        .prepare(
          'UPDATE kit_meta SET revision=revision+1,write_token=?,secret=? WHERE instance_id=? AND revision=?',
        )
        .bind(token, this.env.APP_MODE === 'demo' ? state.secret : '', this.id, this.revision),
    ];
    const guard = 'EXISTS(SELECT 1 FROM kit_meta WHERE instance_id=? AND write_token=?)';
    // D1 batch is atomic. Every mutation is guarded by this transaction's CAS token.
    for (const [key, old] of this.previous)
      if (!next.has(key))
        statements.push(
          this.db
            .prepare(`DELETE FROM ${old.table} WHERE instance_id=? AND id=? AND ${guard}`)
            .bind(this.id, old.id, this.id, token),
        );
    for (const [key, row] of next)
      if (
        this.previous.get(key)?.payload !== row.payload ||
        this.previous.get(key)?.parent_id !== row.parent_id
      )
        statements.push(
          this.db
            .prepare(
              `INSERT INTO ${row.table}(instance_id,id,parent_id,payload) SELECT ?,?,?,? WHERE ${guard} ON CONFLICT(instance_id,id) DO UPDATE SET parent_id=excluded.parent_id,payload=excluded.payload`,
            )
            .bind(this.id, row.id, row.parent_id, row.payload, this.id, token),
        );
    const result = await this.db.batch(statements);
    if (!result[1].meta.changes) throw new D1Conflict();
    this.revision++;
    this.previous = next;
    this.remember(state);
  }
}
export async function allowLogin(env: StorageEnv, ip: string): Promise<boolean> {
  const { hash } = await import('./security');
  const key = await hash(ip, env.SESSION_SECRET || 'local-development-only');
  const window = Math.floor(Date.now() / 600000);
  const result = await database(env)
    .prepare(
      'INSERT INTO kit_login_limits(instance_id,ip_hash,window_start,attempts) VALUES(?,?,?,1) ON CONFLICT(instance_id,ip_hash) DO UPDATE SET attempts=CASE WHEN window_start=excluded.window_start THEN attempts+1 ELSE 1 END,window_start=excluded.window_start RETURNING attempts',
    )
    .bind(instance(env), key, window)
    .first<{ attempts: number }>();
  return !!result && result.attempts <= 200;
}
