// 검증: ① 빠른 배정 윈도우(첫 1시간 / KST 새벽 1~2시), ② 세팅 변경 시 휴게 작업자 보존.
delete process.env.DATABASE_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.ASSIGN_DELAY_SEC = '480';
process.env.FAST_ASSIGN_DELAY_SEC = '4';
process.env.FAST_AFTER_START_MIN = '60';
process.env.FAST_AM_HOUR = '1';
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
  // --- ① 윈도우 판정 ---
  check(engine.isFastWindow(NOON + 5 * M, NOON) === true, '시작 5분 뒤 → 빠른윈도우(첫1시간)');
  check(engine.isFastWindow(NOON + 90 * M, NOON) === false, '시작 90분 뒤(낮) → 평소');
  check(engine.isFastWindow(AM_0130, DAY_AGO) === true, 'KST 01:30 → 빠른윈도우');
  check(engine.isFastWindow(AM_0230, DAY_AGO) === false, 'KST 02:30 → 평소');
  check(engine.assignDelaySecFor(NOON + 5 * M, NOON) === 4, '빠른윈도우 지연 = 4초');
  check(engine.assignDelaySecFor(NOON + 90 * M, NOON) === 480, '평소 지연 = 480초');

  // --- ② 세팅 변경 시 휴게 작업자 보존 ---
  engine.setBroadcast(() => {});
  await engine.init();
  engine.reset();
  engine.setup({
    active: ['B22', 'B23', 'B24'],
    roster: [{ dockId: 'B22', workerName: '김' }, { dockId: 'B23', workerName: '이' }, { dockId: 'B24', workerName: '박' }],
  });
  engine.endWork('B22'); // 김 → 휴게 (B22는 비어 폼에 안 보임)
  check(engine.getState().workers.find((w) => w.name === '김').status === 'break', '김 휴게중');

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

  engine.reset();
  report();
})();

function report() {
  let pass = 0;
  for (const r of results) { console.log((r.ok ? '✓' : '✗') + ' ' + r.l); if (r.ok) pass++; }
  console.log(`\n${pass}/${results.length} 통과`);
  process.exit(pass === results.length ? 0 : 1);
}
