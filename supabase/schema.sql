-- Supabase 스키마: 앱 상태를 jsonb 한 행에 저장하는 단일 테이블.
--
-- supabase-js (SUPABASE_URL + service_role 키) 모드에서는 REST API 가 테이블을 못 만들기 때문에
-- 이 SQL 을 Supabase 대시보드 → SQL Editor 에서 한 번 실행해야 한다.
-- (Postgres 직접연결 DATABASE_URL 모드에서는 앱이 자동 생성하므로 실행 불필요.)

create table if not exists app_state (
  id int primary key,                       -- 항상 1 (단일 행에 전체 상태 보관)
  state jsonb not null,                      -- 도크/작업자/이벤트 전체 상태
  updated_at timestamptz not null default now()
);

-- RLS 를 켜면 service_role(백엔드)만 접근, anon/authenticated 는 차단 → 안전.
alter table app_state enable row level security;
