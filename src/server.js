const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const engine = require('./engine');
const db = require('./db');
const config = require('./config');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 관리자 비밀번호: 설정하면 종료/배정/세팅 등 제어 동작에 인증 필요. 비우면 인증 없이 동작(로컬).
const MANAGER_PASSWORD = process.env.MANAGER_PASSWORD || '';

app.use(express.static(path.join(__dirname, '..', 'public')));

// 상태가 바뀔 때마다 모든 화면에 push
engine.setBroadcast((s) => io.emit('state', s));

io.on('connection', (socket) => {
  // 비번 미설정이면 누구나 허용. 핸드셰이크에 동봉된 비밀번호(auth.mgrpw)가 맞으면 즉시 인증
  // → 재연결 시 auth 왕복 없이 바로 제어 가능(클라이언트 common.js 참조).
  socket.data.authed = !MANAGER_PASSWORD
    || (socket.handshake.auth && socket.handshake.auth.mgrpw) === MANAGER_PASSWORD;
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
  socket.on('worker:undo-end', (p, ack) => guarded(socket, ack, () => engine.undoEnd(p && p.workerId)));
  socket.on('dock:no-truck', (p, ack) => guarded(socket, ack, () => engine.setNoTruck(p && p.dockId, p && p.value)));
  socket.on('worker:standby', (p, ack) => guarded(socket, ack, () => engine.pullToStandby(p && p.workerId)));
  socket.on('commando:deploy', (p, ack) => guarded(socket, ack, () => engine.deployCommando(p && p.commandoId, p && p.dockId)));
  socket.on('commando:recall', (p, ack) => guarded(socket, ack, () => engine.recallCommando(p && p.commandoId)));
  socket.on('commando:finish', (p, ack) => guarded(socket, ack, () => engine.commandoFinish(p && p.dockId)));
  socket.on('day:reset', (_p, ack) => guarded(socket, ack, () => engine.reset()));
  socket.on('timing:set', (p, ack) => guarded(socket, ack, () => engine.setTiming(p)));

  // 신호수 '확인'은 인증 없이 허용(읽기 화면용 공유 표시 — 한 명이 확인하면 전 화면 반영)
  socket.on('signal:ack', (p, ack) => respond(ack, () => engine.ackEnd(p && p.seq, p && p.acked)));

  // 화면 복귀 시 연결 생존 확인용 no-op 응답(클라이언트 reviveSocket)
  socket.on('hb', (ack) => { if (typeof ack === 'function') ack(); });
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
      console.log(`DB: ${dbLabel} · 기본 배정 ${config.ASSIGN_DELAY_SEC}s / 휴게 ${config.BREAK_DELAY_SEC}s (관리 화면에서 변경 가능)`);
    });
  })
  .catch((e) => { console.error('초기화 실패:', e.message); process.exit(1); });
