// 관리자 인증 검증: 비번 설정된 서버(MANAGER_PASSWORD)에 붙어
// 인증 없이는 제어가 거부되고, 맞는 비번 후엔 허용되는지 확인.
const { io } = require('socket.io-client');

const PW = process.env.TEST_PW || 'test1234';
const sock = io('http://localhost:3000');
const results = [];
const check = (c, l) => results.push({ ok: !!c, l });
const emit = (ev, p) => new Promise((r) => sock.emit(ev, p, r));

sock.on('connect', async () => {
  let r = await emit('dock:end', { dockId: 'B22' });
  check(r && r.ok === false, '인증 없이 제어(dock:end) 거부됨');

  r = await emit('auth', 'wrongpw');
  check(r && r.ok === false, '틀린 비밀번호 거부됨');

  r = await emit('auth', PW);
  check(r && r.ok === true, '맞는 비밀번호로 인증 성공');

  r = await emit('setup:save', { active: ['B22', 'B23'], roster: [{ dockId: 'B22', workerName: '테스트' }] });
  check(r && r.ok === true, '인증 후 제어(setup:save) 성공');

  await emit('day:reset', {}); // 정리
  report();
});

function report() {
  let pass = 0;
  for (const r of results) { console.log((r.ok ? '✓' : '✗') + ' ' + r.l); if (r.ok) pass++; }
  console.log(`\n${pass}/${results.length} 통과`);
  sock.close();
  process.exit(pass === results.length ? 0 : 1);
}
setTimeout(() => { console.log('타임아웃'); report(); }, 8000);
