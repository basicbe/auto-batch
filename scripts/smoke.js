// 엔진 로직 빠른 검증 (소켓/브라우저/DB 없이).
// 항상 파일 모드로 격리 — 실수로 Supabase 상태를 건드리지 않게 DATABASE_URL 제거.
// 주의: data/state.json을 초기화한다(개발용).

delete process.env.DATABASE_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_ANON_KEY;
process.env.ASSIGN_DELAY_SEC = '1';
process.env.FAST_ASSIGN_DELAY_SEC = '1'; // 첫1시간 빠른윈도우에 걸려도 동일하게
process.env.BREAK_DELAY_SEC = '2';

const engine = require('../src/engine');
const results = [];
const assert = (cond, label) => results.push({ ok: !!cond, label });

(async () => {
  engine.setBroadcast(() => {});
  await engine.init();
  engine.reset();

  // 3개 가동, 3명 배치
  engine.setup({
    active: ['B22', 'B23', 'B24'],
    roster: [
      { dockId: 'B22', workerName: '김' },
      { dockId: 'B23', workerName: '이' },
      { dockId: 'B24', workerName: '박' },
    ],
  });

  let s = engine.getState();
  const W = (name) => engine.getState().workers.find((w) => w.name === name);
  assert(s.stats.active === 3, '가동 도크 3개');
  assert(s.stats.working === 3, '시작 시 3개 모두 작업중');
  assert(W('김').dockId === 'B22', '김 시작 위치 B22');

  // 김(B22), 이(B23) 순서로 종료 → 둘 다 휴게, 대기열 [B22, B23]
  engine.endWork('B22');
  setTimeout(() => engine.endWork('B23'), 60);
  assert(W('김').status === 'break', '김 휴게 시작');

  // 1.3초 후: 8분(=1초) 지나 배정 완료되었는지 확인
  setTimeout(() => {
    const kim = W('김'), lee = W('이'), park = W('박');
    assert(kim.status === 'working', '김 재배정되어 작업중');
    assert(lee.status === 'working', '이 재배정되어 작업중');
    // FIFO: 가장 먼저 끝난 도크(B22)가 가장 먼저 복귀한 작업자(김)에게
    assert(kim.dockId === 'B22', '김 → B22 (가장 오래된 대기도크)');
    assert(lee.dockId === 'B23', '이 → B23');
    assert(park.dockId === 'B24', '박 그대로 B24');
    assert(kim.returningUntil && Date.now() < kim.returningUntil, '김 "복귀중" 표시 구간');

    console.log('\n배정 결과: ' + [kim, lee, park].map((w) => `${w.name}→${w.dockId}`).join(', ') + '\n');
    engine.reset();
    report();
  }, 1300);
})();

function report() {
  let pass = 0;
  for (const r of results) { console.log((r.ok ? '✓' : '✗') + ' ' + r.label); if (r.ok) pass++; }
  console.log(`\n${pass}/${results.length} 통과`);
  process.exit(pass === results.length ? 0 : 1);
}
