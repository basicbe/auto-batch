// 소켓 통합 테스트: 실행 중인 서버(ASSIGN_DELAY_SEC=2 권장)에 붙어
// 세팅 → 종료 → 자동배정 → 수동 맞교환을 실제 소켓 경유로 검증한다.
const { io } = require('socket.io-client');

const sock = io('http://localhost:3000');
const states = [];
const results = [];
const check = (c, l) => results.push({ ok: !!c, l });
const emit = (ev, p) => new Promise((r) => sock.emit(ev, p, r));
const last = () => states[states.length - 1];
const W = (name) => last().workers.find((w) => w.name === name);

sock.on('state', (s) => states.push(s));

sock.on('connect', async () => {
  await emit('setup:save', {
    active: ['B22', 'B23', 'B24'],
    roster: [
      { dockId: 'B22', workerName: '김' },
      { dockId: 'B23', workerName: '이' },
      { dockId: 'B24', workerName: '박' },
    ],
  });
  check(last().stats.active === 3, '세팅: 가동 3 (소켓)');

  await emit('dock:end', { dockId: 'B22' });
  check(W('김').status === 'break', '종료: 김 휴게 시작 (소켓)');
  check(last().stats.waiting === 1, '종료: B22 대기열 진입');

  // ASSIGN_DELAY_SEC=2 → 2.6초 후 배정 완료 확인
  setTimeout(async () => {
    const kim = W('김');
    check(kim.status === 'working' && kim.dockId === 'B22', '자동배정: 김 → B22 (소켓 경유)');

    // 수동 맞교환: 박(B24) ↔ 이(B23)
    const r = await emit('worker:reassign', { workerId: W('박').id, dockId: 'B23' });
    check(r && r.ok, '수동변경 ack ok');
    check(W('박').dockId === 'B23' && W('이').dockId === 'B24', '수동 맞교환: 박↔이');

    report();
  }, 2600);
});

function report() {
  let pass = 0;
  for (const r of results) { console.log((r.ok ? '✓' : '✗') + ' ' + r.l); if (r.ok) pass++; }
  console.log(`\n${pass}/${results.length} 통과`);
  sock.close();
  process.exit(pass === results.length ? 0 : 1);
}

setTimeout(() => { console.log('타임아웃'); report(); }, 9000);
