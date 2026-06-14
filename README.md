# 물류 도크 작업자 자동 배치 (MVP)

작업자 배치를 카톡 수동 → 자동으로. 관리자는 끝난 도크의 **"종료"만 누르면**, 휴게(기본 10분)
후 복귀하는 작업자에게 시스템이 **끝난 순서(FIFO)** 대로 다음 도크를 자동 배정하고, 공용 보드에 띄운다.

## 빠른 시작

```bash
npm install
npm start            # http://localhost:3000  (배정 8분 / 휴게 10분)
```

데모로 빠르게 보고 싶으면(배정 8초 / 휴게 12초):

```bash
npm run demo
```

엔진 로직만 빠르게 검증:

```bash
npm run smoke
```

## 화면 (모두 실시간 동기화)

| 경로 | 화면 | 용도 |
|---|---|---|
| `/` | 홈 | 화면 이동 |
| `/setup.html` | **세팅** | 가동 도크 선택 + 도크별 시작 작업자 입력 (작업 시작 전) |
| `/manager.html` | **관리 현황판** | 도크 "종료" 입력, 전체 현황, 수동 자리 변경 — 관리자(폰/태블릿) |
| `/board.html` | **공용 보드** | 작업자가 본인 이름 옆 도크 확인 — 현장 큰 화면 |

> 같은 WiFi면 다른 폰/태블릿에서 `http://<이 PC의 IP>:3000` 으로 접속. 외부 접속은 Cloudflare Tunnel 등으로.

## 동작 규칙

- 도크 18개: 2번 대형(B22–B26·B28–B31), 1번 대형(B32–B38·B40·B41). B27·B39 없음.
- 매일 가동 도크를 고른다(보통 16개). **작업자 수 = 가동 도크 수.**
- 관리자가 도크 **"종료"** → 그 작업자 휴게 시작(타이머) + 그 도크는 대기열로.
- 휴게 시작 **8분** 뒤(`ASSIGN_DELAY_SEC`) 그 작업자에게 **가장 오래된 대기 도크**를 자동 배정.
- 실제 휴게 **10분**(`BREAK_DELAY_SEC`) 동안 배정~복귀 사이는 보드에 "→ B29" 로 강조.
- 같은 도크로 다시 가도 막지 않음. 관리자는 자동 배정을 **수동으로 변경/맞교환** 가능.
- 서버가 재시작돼도 휴게 시작시각이 저장돼 있어 타이머를 다시 걸고, 이미 지난 건 즉시 배정.

## 구조

```
src/
  config.js   도크 목록 · 타이밍(환경변수로 조정)
  db.js       상태 저장 (지금은 JSON 파일 → 나중에 Supabase로 교체)
  engine.js   FIFO 배정 엔진 · 타이머 · 재시작 복구
  server.js   Express + Socket.IO
public/       세팅/관리/보드 화면 (Tailwind CDN + 바닐라 JS)
```

## Supabase 연결

DB 코드는 이미 들어가 있다(`src/db.js`). `.env` 에 값만 채우면 자동으로 Supabase 를 쓰고, 없으면 JSON 파일로 동작한다.

**방법 A (권장) — supabase-js (URL + service_role 키)**
1. [supabase.com](https://supabase.com) 에서 프로젝트 생성.
2. 대시보드 → **Project Settings → API** 에서 **Project URL** 과 **service_role(secret) 키** 복사.
   - ⚠️ `anon` 이 아니라 **service_role(비밀)** 키. 백엔드 전용 — 프론트엔드/공개 금지.
3. `.env` 에 넣기:
   ```
   SUPABASE_URL=https://[REF].supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJ...
   ```
4. **테이블 1회 생성** (supabase-js 는 테이블 생성을 못 함) — 대시보드 → **SQL Editor** 에 `supabase/schema.sql` 붙여넣고 실행:
   ```sql
   create table if not exists app_state (id int primary key, state jsonb not null, updated_at timestamptz not null default now());
   alter table app_state enable row level security;
   ```
5. 확인 후 실행:
   ```bash
   npm run db:test     # → ✓ Supabase 연결 성공
   npm start           # → 콘솔에 "DB: Supabase (supabase-js)" 표시
   ```

**방법 B (대안) — Postgres 직접연결**
`.env` 에 `DATABASE_URL=` 연결 문자열([Connect] → Connection string). 이 방식은 테이블을 앱이 **자동 생성**(SQL 단계 불필요)하지만, Direct 연결은 IPv6 기본이라 IPv4 전용망이면 Session pooler 문자열을 써야 한다.

> 상태는 jsonb 한 행(`app_state`)에 저장 — 단일 서버 운영엔 단순/충분. SSL 은 앱이 자동 처리.

## 관리자 비밀번호 (접근 제한)

`MANAGER_PASSWORD` 를 설정하면 **관리 현황판·세팅 화면에 로그인**이 걸린다(공용 보드는 그대로 공개 — 보기 전용이라 안전). 비우면 인증 없이 동작(로컬 개발용).

```bash
MANAGER_PASSWORD=원하는비밀번호 npm start
```

배포 시엔 `.env` 가 아니라 **호스팅의 환경변수**로 설정한다. HTTPS(배포 환경)에선 비밀번호가 암호화되어 전송된다. 한 번 입력하면 그 기기에 저장되어 다시 안 묻는다.

## 다음 단계

- 화면을 React + Vite로 이전(원하면). 현재는 무빌드 바닐라 + Tailwind CDN.
- 휴게 초과 표시, 통계(도크 가동률·작업자별 횟수), 작업자 개인 폰 알림 등.
