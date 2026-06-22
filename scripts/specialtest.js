// 차 없는 도크(noTruck) + 대기로 빼기(standby) 로직 검증 (소켓/DB 없이).
// 항상 파일 모드로 격리. 주의: data/state.json을 초기화한다(개발용).

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = (name) => engine.getState().workers.find((w) => w.name === name);
const D = (id) => engine.getState().docks.find((d) => d.id === id);
const C = (name) => engine.getState().commandos.find((c) => c.name === name);
const setup3 = () => engine.setup({
  active: ['B22', 'B23', 'B24'],
  roster: [{ dockId: 'B22', workerName: '김' }, { dockId: 'B23', workerName: '이' }, { dockId: 'B24', workerName: '박' }],
});

(async () => {
  engine.setBroadcast(() => {});
  await engine.init();
  engine.reset();

  // ── 시나리오 1: noTruck 도크는 배정 제외, 해제하면 제 순서로 복귀 ──
  setup3();
  engine.endWork('B22');           // 김 휴게, B22 대기(가장 오래)
  await sleep(40);
  engine.endWork('B23');           // 이 휴게, B23 대기
  engine.setNoTruck('B22', true);  // B22 차 없음 → 배정 제외

  await sleep(1300);               // 1초 배정 지연 경과 → 김·이 각자 타이머로 ready
  assert(D('B22').noTruck && D('B22').status === 'waiting' && !D('B22').workerId, 'B22 차없음·대기·빈자리 유지(배정 제외)');
  assert(W('김').dockId === 'B23' && W('김').status === 'working', '김 → B23(차 있는 도크로, B22가 더 오래됐어도 스킵)');
  assert(W('이').status === 'ready', '이는 갈 차-도크 없어 대기 풀(ready)');

  engine.setNoTruck('B22', false); // 차 도착 → 배정 재개
  await sleep(50);
  assert(D('B22').status === 'working' && D('B22').workerId && !D('B22').noTruck, 'B22 차 도착 후 배정 재개');
  assert(W('이').dockId === 'B22', '대기 풀의 이 → 차 온 B22로 배정');

  // ── 시나리오 2: 대기로 빼기 → ready 풀, 도돌이표 없음, 차 오는 도크로 이동 ──
  engine.reset();
  setup3();
  const kimId = W('김').id;
  engine.pullToStandby(kimId);     // 김을 대기 풀로 (B22 차없음으로 잠금)
  assert(W('김').status === 'ready' && !W('김').dockId, '김 대기 풀(ready)로');
  assert(D('B22').status === 'waiting' && D('B22').noTruck && !D('B22').workerId, 'B22 대기+차없음으로 잠김');
  await sleep(50);
  assert(W('김').status === 'ready' && D('B22').workerId === null, '김이 B22로 도로 안 꽂힘(도돌이표 방지)');

  engine.endWork('B23');           // B23 차 있는 대기도크 발생 → tryMatch가 김을 B23으로
  await sleep(50);
  assert(W('김').dockId === 'B23' && W('김').status === 'working', '대기 풀의 김 → 차 있는 B23으로 배정');

  // ── 시나리오 3: freedAt(원래 대기시간) 배정 중에도 보존 ──
  engine.reset();
  engine.setup({ active: ['B22', 'B23'], roster: [{ dockId: 'B22', workerName: '김' }, { dockId: 'B23', workerName: '이' }] });
  engine.endWork('B22');           // B22 대기 (freedAt = T)
  const tFreed = D('B22').freedAt;
  await sleep(1300);               // 김 ready → B22로 재배정(유일 대기도크)
  assert(D('B22').status === 'working' && D('B22').workerId, 'B22 재배정 완료');
  assert(D('B22').freedAt === tFreed, 'freedAt 배정 후에도 보존(원래 대기시간 기억)');

  // ── 시나리오 4: 그냥 이동(자리 변경)도 대기시간 보존 + 떠난 도크 자동 '차 없음' ──
  // 이어서 사용: B22 working(김, freedAt=tFreed 보존됨), B23 working(이)
  engine.endWork('B23');                  // 이 휴게, B23 대기(목적지로 쓸 빈 도크)
  engine.manualAssign(W('김').id, 'B23'); // 김: B22 → B23 (이 ready 되기 전 즉시)
  assert(D('B22').status === 'waiting' && D('B22').freedAt === tFreed, '이동해도 떠난 B22의 원래 대기시간 보존');
  assert(D('B22').noTruck === true, '이동 시 떠난 도크 자동 차 없음(도돌이표 방지)');
  assert(W('김').dockId === 'B23' && !D('B23').noTruck, '김 → B23(차 있는 도크, noTruck 해제)');
  await sleep(1300);                       // 이 ready → B22는 noTruck이라 안 꽂힘
  assert(W('이').status === 'ready' && D('B22').workerId === null, '대기시간 보존돼도 차 없음이라 복귀자 안 꽂힘');

  // ── 시나리오 5: 특공대 투입 → 복귀자 배정되면 자동 교대(handover) ──
  engine.reset();
  engine.setup({ active: ['B22', 'B23', 'B24'], commandos: ['특공A'], roster: [
    { dockId: 'B22', workerName: '김' }, { dockId: 'B23', workerName: '이' }, { dockId: 'B24', workerName: '박' }] });
  engine.endWork('B22');                    // 김 휴게, B22 대기
  engine.deployCommando(C('특공A').id, 'B22'); // 특공A가 B22 메꿈
  assert(D('B22').temps[0] && D('B22').temps[0].name === '특공A', 'B22에 특공A 투입 오버레이');
  assert(C('특공A').status === 'in' && C('특공A').dockId === 'B22', '특공A 투입중 상태');
  await sleep(1300);                        // 김 복귀 → B22 배정 → 교대로 특공 빠짐
  assert(W('김').dockId === 'B22' && W('김').status === 'working', '김 B22 복귀 배정');
  assert(D('B22').temps.length === 0 && C('특공A').status === 'idle', '복귀자 배정 시 특공대 자동 교대(빠짐)');

  // ── 시나리오 6: 특공대 작업종료 = 일반 작업 종료(대기열 + 대기시간 초기화, 미접안 아님) ──
  engine.reset();
  engine.setup({ active: ['B22', 'B23', 'B24'], commandos: ['특공A'], roster: [
    { dockId: 'B22', workerName: '김' }, { dockId: 'B23', workerName: '이' }, { dockId: 'B24', workerName: '박' }] });
  engine.endWork('B22');
  const tF6 = D('B22').freedAt;
  engine.deployCommando(C('특공A').id, 'B22');
  engine.commandoFinish('B22');             // 도크 작업종료 (도크별)
  assert(D('B22').temps.length === 0 && D('B22').noTruck === false, '작업종료 → 오버레이 제거 + 미접안 아님');
  assert(D('B22').status === 'waiting' && D('B22').freedAt >= tF6, '작업종료 = 작업 종료(대기열 + 대기시간 초기화)');
  assert(C('특공A').status === 'idle', '특공A 대기로 복귀');
  await sleep(1300);                        // 김 ready → 일반 대기 도크라 배정됨
  assert(W('김').dockId === 'B22' && W('김').status === 'working', '작업종료 도크는 일반 대기 → 복귀자 배정됨');

  // ── 시나리오 7: 한 도크 최대 2명 + 빼기(한 명) + 투입 검증 ──
  engine.reset();
  engine.setup({ active: ['B22', 'B23'], commandos: ['특공A', '특공B', '특공C'], roster: [
    { dockId: 'B22', workerName: '김' }, { dockId: 'B23', workerName: '이' }] });
  // 작업중 도크(B22)에도 거들러 투입 가능 — 작업자/배정은 그대로, 오버레이만 추가
  engine.deployCommando(C('특공A').id, 'B22');
  assert(D('B22').status === 'working' && D('B22').workerId && D('B22').temps.length === 1,
    '작업중 도크에 특공대 거들기 투입(작업자 유지 + 오버레이 추가)');
  engine.recallCommando(C('특공A').id);     // 도로 빼기
  assert(C('특공A').status === 'idle' && C('특공A').lastDockId === 'B22', '빼면 전위치(B22) 기록');
  engine.endWork('B23');                    // B23 대기로
  engine.deployCommando(C('특공A').id, 'B23');
  engine.deployCommando(C('특공B').id, 'B23');
  assert(D('B23').temps.length === 2, '한 도크에 특공대 2명까지 투입');
  let threw2 = false;
  try { engine.deployCommando(C('특공C').id, 'B23'); } catch { threw2 = true; } // 3번째 거부
  assert(threw2, '3번째 특공대 투입 거부(최대 2명)');
  engine.recallCommando(C('특공A').id);
  assert(D('B23').temps.length === 1 && C('특공A').status === 'idle', '빼기: 한 명만 빠지고 나머지 유지');

  engine.reset();
  report();
})();

function report() {
  let pass = 0;
  for (const r of results) { console.log((r.ok ? '✓' : '✗') + ' ' + r.label); if (r.ok) pass++; }
  console.log(`\n${pass}/${results.length} 통과`);
  process.exit(pass === results.length ? 0 : 1);
}
