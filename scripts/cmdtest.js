// 특공대 소켓 통합 테스트: 실행 중인 서버(ASSIGN_DELAY 길게 권장)에 붙어
// 세팅(특공대 명단) → 투입 → 작업종료를 실제 소켓 경유로 검증한다.
const { io } = require('socket.io-client');

const PORT = process.env.PORT || 3000;
const sock = io('http://localhost:' + PORT);
const states = [];
const results = [];
const check = (c, l) => results.push({ ok: !!c, l });
const emit = (ev, p) => new Promise((r) => sock.emit(ev, p, r));
const last = () => states[states.length - 1];
const C = (name) => last().commandos.find((c) => c.name === name);
const D = (id) => last().docks.find((d) => d.id === id);

sock.on('state', (s) => states.push(s));

sock.on('connect', async () => {
  await emit('setup:save', {
    active: ['B22', 'B23', 'B24'],
    commandos: ['특공A', '특공B'],
    roster: [
      { dockId: 'B22', workerName: '김' },
      { dockId: 'B23', workerName: '이' },
      { dockId: 'B24', workerName: '박' },
    ],
  });
  check(last().commandos.length === 2, '세팅: 특공대 2명 등록 (소켓)');
  check(last().stats.commandos === 2, 'stats.commandos = 2');

  await emit('dock:end', { dockId: 'B22' });   // 김 휴게, B22 대기
  const r1 = await emit('commando:deploy', { commandoId: C('특공A').id, dockId: 'B22' });
  check(r1 && r1.ok, '투입 ack ok');
  check(D('B22').temps[0] && D('B22').temps[0].name === '특공A', '투입: B22 특공A 오버레이 (소켓)');
  check(C('특공A').status === 'in' && C('특공A').dockId === 'B22', '특공A 투입중');

  const r2 = await emit('commando:finish', { dockId: 'B22' });
  check(r2 && r2.ok, '작업종료 ack ok');
  check(D('B22').temps.length === 0 && D('B22').status === 'waiting' && !D('B22').noTruck, '작업종료: 오버레이 제거 + 작업종료 방식(미접안 아님) (소켓)');
  check(C('특공A').status === 'idle', '특공A 대기로 복귀');

  // 한 도크에 2명 투입
  await emit('dock:end', { dockId: 'B23' });
  await emit('commando:deploy', { commandoId: C('특공A').id, dockId: 'B23' });
  await emit('commando:deploy', { commandoId: C('특공B').id, dockId: 'B23' });
  check(D('B23').temps.length === 2, '한 도크 특공대 2명 투입 (소켓)');

  report();
});

function report() {
  let pass = 0;
  for (const r of results) { console.log((r.ok ? '✓' : '✗') + ' ' + r.l); if (r.ok) pass++; }
  console.log(`\n${pass}/${results.length} 통과`);
  sock.close();
  process.exit(pass === results.length ? 0 : 1);
}

setTimeout(() => { console.log('타임아웃'); report(); }, 9000);
