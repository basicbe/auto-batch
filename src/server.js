const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const engine = require('./engine');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 관리자 비밀번호: 설정하면 종료/배정/세팅 등 제어 동작에 인증 필요. 비우면 인증 없이 동작(로컬).
const MANAGER_PASSWORD = process.env.MANAGER_PASSWORD || '';

app.use(express.static(path.join(__dirname, '..', 'public')));

// 상태가 바뀔 때마다 모든 화면에 push
engine.setBroadcast((s) => io.emit('state', s));

io.on('connection', (socket) => {
  socket.data.authed = !MANAGER_PASSWORD; // 비번 미설정이면 누구나 허용
  const sendHello = () => socket.emit('hello', { authRequired: !!MANAGER_PASSWORD, authed: socket.data.authed });
  sendHello();
  socket.emit('state', engine.getState()); // 접속 즉시 현재 상태 전달

  socket.on('auth', (pw, ack) => {
    socket.data.authed = !MANAGER_PASSWORD || pw === MANAGER_PASSWORD;
    sendHello();
    if (typeof ack === 'function') ack({ ok: socket.data.authed });
  });

  // 제어 동작(보드 제외)은 인증 필요
  socket.on('setup:save', (p, ack) => guarded(socket, ack, () => engine.setup(p)));
  socket.on('dock:end', (p, ack) => guarded(socket, ack, () => engine.endWork(p && p.dockId)));
  socket.on('worker:reassign', (p, ack) => guarded(socket, ack, () => engine.manualAssign(p && p.workerId, p && p.dockId)));
  socket.on('day:reset', (_p, ack) => guarded(socket, ack, () => engine.reset()));
});

function respond(ack, fn) {
  try {
    fn();
    if (typeof ack === 'function') ack({ ok: true });
  } catch (e) {
    if (typeof ack === 'function') ack({ ok: false, error: e.message });
  }
}

function guarded(socket, ack, fn) {
  if (!socket.data.authed) {
    if (typeof ack === 'function') ack({ ok: false, error: '관리자 인증이 필요합니다(비밀번호)' });
    return;
  }
  respond(ack, fn);
}

const PORT = process.env.PORT || 3000;

// 정상 종료(Ctrl+C / SIGTERM) 시 대기 중인 DB 쓰기를 마무리하고 내려간다.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log('\n종료 중… 저장 마무리');
    Promise.race([db.flush(), new Promise((r) => setTimeout(r, 3000))]).finally(() => process.exit(0));
  });
}

engine.init()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`auto-batch 실행 중 → http://localhost:${PORT}`);
      const dbLabel = db.mode === 'supabase' ? 'Supabase (supabase-js)'
        : db.mode === 'pg' ? 'Supabase/Postgres (pg)' : 'JSON 파일';
      console.log(`DB: ${dbLabel} · 배정 ${process.env.ASSIGN_DELAY_SEC || 480}s / 휴게 ${process.env.BREAK_DELAY_SEC || 600}s`);
    });
  })
  .catch((e) => { console.error('초기화 실패:', e.message); process.exit(1); });
