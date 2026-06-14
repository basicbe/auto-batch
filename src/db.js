// 상태 영속화 계층 (백엔드 자동 선택)
//
//   - SUPABASE_URL + 키       → Supabase (supabase-js / REST). ★ 권장: 키는 service_role(비밀).
//   - DATABASE_URL            → Postgres 직접연결 (pg). 상시 서버용 대안.
//   - 둘 다 없으면            → JSON 파일 (개발/오프라인).
//
// 엔진은 load()/save() 만 쓰므로 백엔드가 바뀌어도 엔진 코드는 그대로다.
// load() 는 비동기(시작 시 1회 await), save() 는 논블로킹(직렬화 쓰기). 인메모리 상태가
// 런타임 source of truth, DB/파일은 영속화용.

const fs = require('fs');
const path = require('path');

// service_role(비밀) 키를 우선. 과거 이름(SUPABASE_ANON_KEY)도 폴백으로 허용.
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || '';

const mode =
  (process.env.SUPABASE_URL && SUPABASE_KEY) ? 'supabase'
    : process.env.DATABASE_URL ? 'pg'
      : 'file';

let writeChain = Promise.resolve(); // 쓰기 순서 보장(직렬화)

// ---------- 파일 백엔드 ----------
const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'state.json');

function fileLoad() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return null; }
}
function fileSave(state) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, DATA_FILE);
  } catch (e) { console.error('[db] 파일 save 실패:', e.message); }
}

// ---------- Supabase (supabase-js / REST) 백엔드 ----------
let sb = null;
function getClient() {
  if (!sb) {
    const { createClient } = require('@supabase/supabase-js');
    sb = createClient(process.env.SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return sb;
}
function isTableMissing(error) {
  const m = `${(error && error.message) || ''} ${(error && error.code) || ''}`;
  return /PGRST205|42P01|could not find the table|does not exist|schema cache/i.test(m);
}
async function sbLoad() {
  const { data, error } = await getClient().from('app_state').select('state').eq('id', 1).maybeSingle();
  if (error) {
    if (isTableMissing(error)) {
      const e = new Error("Supabase에 'app_state' 테이블이 없습니다. supabase/schema.sql 을 SQL Editor에서 실행하세요.");
      e.tableMissing = true;
      throw e;
    }
    throw new Error(error.message || String(error));
  }
  return data ? data.state : null;
}
function sbSave(state) {
  writeChain = writeChain
    .then(() => getClient().from('app_state').upsert({ id: 1, state, updated_at: new Date().toISOString() }))
    .then((res) => { if (res && res.error) console.error('[db] supabase save 실패:', res.error.message); })
    .catch((e) => console.error('[db] supabase save 실패:', e.message));
}

// ---------- Postgres 직접연결 (pg) 백엔드 ----------
let pool = null;
let ensured = false;
const SQL_CREATE = `create table if not exists app_state (
  id int primary key, state jsonb not null, updated_at timestamptz not null default now())`;
const SQL_SELECT = 'select state from app_state where id = 1';
const SQL_UPSERT = `insert into app_state (id, state, updated_at) values (1, $1::jsonb, now())
  on conflict (id) do update set state = excluded.state, updated_at = now()`;

function getPool() {
  if (!pool) {
    const { Pool } = require('pg');
    const ssl = process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false };
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl, max: 4, connectionTimeoutMillis: 10000 });
    pool.on('error', (e) => console.error('[db] pool 오류:', e.message));
  }
  return pool;
}
async function pgEnsure() { if (!ensured) { await getPool().query(SQL_CREATE); ensured = true; } }
async function pgLoad() {
  await pgEnsure();
  const r = await getPool().query(SQL_SELECT);
  return r.rows[0] ? r.rows[0].state : null;
}
function pgSave(state) {
  const json = JSON.stringify(state);
  writeChain = writeChain
    .then(pgEnsure)
    .then(() => getPool().query(SQL_UPSERT, [json]))
    .catch((e) => console.error('[db] pg save 실패:', e.message));
}

// ---------- 공개 API ----------
async function load() {
  if (mode === 'supabase') return sbLoad();
  if (mode === 'pg') return pgLoad();
  return fileLoad();
}
function save(state) {
  if (mode === 'supabase') return sbSave(state);
  if (mode === 'pg') return pgSave(state);
  return fileSave(state);
}

// 종료 시 호출: 대기 중인 비동기 쓰기를 마저 끝낸다.
async function flush() { try { await writeChain; } catch { /* 무시 */ } }

module.exports = { load, save, flush, mode, DATA_FILE };
