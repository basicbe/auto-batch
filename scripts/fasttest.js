// 검증: ① 빠른 배정 윈도우(첫 1시간 / KST 새벽 1~2시), ② 세팅 변경 시 휴게 작업자 보존.
delete process.env.DATABASE_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.ASSIGN_DELAY_SEC = '480';
process.env.FAST_ASSIGN_DELAY_SEC = '1';
process.env.FAST_HIGHLIGHT_SEC = '120';
process.env.FAST_AFTER_START_MIN = '60';
process.env.FAST_AFTER_MEAL_MIN = '60';
process.env.MEAL_END = '01:00';
process.env.TZ_OFFSET_HOURS = '9';

const engine = require('../src/engine');
const results = [];
const check = (c, l) => results.push({ ok: !!c, l });

// 고정 시각 (KST 기준 의미를 UTC 타임스탬프로)
const NOON = Date.UTC(2024, 0, 1, 3, 0, 0);       // KST 12:00
const AM_0130 = Date.UTC(2024, 0, 1, 16, 30, 0);  // KST 다음날 01:30
const AM_0230 = Date.UTC(2024, 0, 1, 17, 30, 0);  // KST 다음날 02:30
const DAY_AGO = NOON - 24 * 3600 * 1000;
const M = 60 * 1000;

(async () => {
  // --- ① 윈도우 판정 (밥 끝 01:00 → 빠른배정 01:00~02:00) ---
  const ME = 60; // 밥 끝 시각(분) = 01:00
  check(engine.isFastWindow(NOON + 5 * M, NOON, ME) === true, '시작 5분 뒤 → 빠른윈도우(첫1시간)');
  check(engine.isFastWindow(NOON + 90 * M, NOON, ME) === false, '시작 90분 뒤(낮) → 평소');
  check(engine.isFastWindow(AM_0130, DAY_AGO, ME) === true, '밥 직후 01:30 → 빠른윈도우');
  check(engine.isFastWindow(AM_0230, DAY_AGO, ME) === false, '밥 1시간 지난 02:30 → 평소');
  check(engine.assignDelaySecFor(NOON + 5 * M, NOON, ME) === 1, '빠른윈도우 지연 = 설정값(1초)');
  check(engine.assignDelaySecFor(NOON + 90 * M, NOON, ME) === 480, '평소 지연 = 480초');

  // --- ② 세팅 변경 시 휴게 작업자 보존 ---
  engine.setBroadcast(() => {});
  await engine.init();
  engine.reset();
  engine.setup({
    active: ['B22', 'B23', 'B24'],
    roster: [{ dockId: 'B22', workerName: '김' }, { dockId: 'B23', workerName: '이' }, { dockId: 'B24', workerName: '박' }],
  });
  engine.endWork('B22'); // 김 → 휴게 (B22는 비어 폼에 안 보임)
  const before = engine.getState();
  check(before.workers.find((w) => w.name === '김').status === 'break', '김 휴게중');
  const b22Before = before.docks.find((d) => d.id === 'B22').freedAt;

  // 인원 변경: 김 빠진 명단으로 다시 세팅 (B22는 비워둠)
  engine.setup({
    active: ['B22', 'B23', 'B24'],
    roster: [{ dockId: 'B23', workerName: '이' }, { dockId: 'B24', workerName: '박' }],
  });
  const s = engine.getState();
  const kim = s.workers.find((w) => w.name === '김');
  check(!!kim, '세팅 변경 후에도 김(휴게중) 보존됨 ★');
  check(kim && kim.status === 'break', '김 여전히 휴게 상태 유지');
  check(s.workers.length === 3, '작업자 3명 유지(이·박·김)');
  const b22After = s.docks.find((d) => d.id === 'B22').freedAt;
  check(!!b22Before && b22After === b22Before, '세팅 변경 후 B22 대기시간(freedAt) 유지 ★');

  // --- ③ 세팅에서 시작 시각 지정 ---
  engine.reset();
  const customStart = Date.UTC(2024, 5, 1, 0, 0, 0);
  engine.setup({ active: ['B22'], roster: [{ dockId: 'B22', workerName: '홍' }], startedAt: customStart });
  check(engine.getState().startedAt === customStart, '세팅에서 지정한 시작 시각이 반영됨 ★');

  // --- ④ 빠른배정 시 "→ 이동" 강조 ≈ 2분(FAST_HIGHLIGHT_SEC) ---
  engine.reset();
  engine.setup({ active: ['B22', 'B23'], roster: [{ dockId: 'B22', workerName: '강' }, { dockId: 'B23', workerName: '윤' }], startedAt: Date.now() });
  engine.endWork('B22'); // 강 → 휴게 (첫1시간=빠른윈도우, 1초 뒤 배정)
  await new Promise((r) => setTimeout(r, 1200));
  const kang = engine.getState().workers.find((w) => w.name === '강');
  check(kang && kang.status === 'working', '빠른배정으로 강 재배정됨');
  const remain = (kang && kang.returningUntil ? kang.returningUntil : 0) - Date.now();
  check(Math.abs(remain - 120000) < 8000, `빠른배정 강조 ≈ 2분 유지 (실제 ${Math.round(remain / 1000)}초) ★`);

  // --- ⑤ 밥시간 바꾸면 빠른배정 구간도 따라 이동 ---
  engine.reset();
  engine.setup({ active: ['B22'], roster: [{ dockId: 'B22', workerName: '한' }], startedAt: Date.UTC(2020, 0, 1, 3, 0, 0), mealStart: '12:00', mealEnd: '13:00' });
  const meMin = engine.hhmmToMin(engine.getState().mealEnd);
  check(engine.getState().mealEnd === '13:00', '밥시간(끝) 13:00 으로 저장됨 ★');
  check(engine.isFastWindow(Date.UTC(2020, 0, 1, 4, 30, 0), null, meMin) === true, '밥 직후 13:30 → 빠른배정 ★');
  check(engine.isFastWindow(Date.UTC(2020, 0, 1, 5, 30, 0), null, meMin) === false, '밥 1시간 뒤 14:30 → 평소');

  engine.reset();
  report();
})();

function report() {
  let pass = 0;
  for (const r of results) { console.log((r.ok ? '✓' : '✗') + ' ' + r.l); if (r.ok) pass++; }
  console.log(`\n${pass}/${results.length} 통과`);
  process.exit(pass === results.length ? 0 : 1);
}
