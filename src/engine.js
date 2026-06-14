// 자동 배치 엔진
//
// 핵심 규칙: "도크가 끝난 순서대로"(FIFO)
//   - 작업 끝난 도크는 freedAt(끝난 시각)을 달고 '대기열'에 들어간다.
//   - 작업자는 휴게 시작 후 ASSIGN_DELAY_SEC(기본 8분)가 지나면 '복귀 준비(ready)' 상태가 된다.
//   - 매칭: 가장 오래된 대기 도크 ↔ 가장 먼저 준비된 작업자. 둘 다 있으면 계속 짝지어 배정.
//   - 같은 도크로 다시 가도 막지 않는다(요구사항).
//
// 상태는 메모리에 들고, 변경 때마다 db.save로 영속화한다. 서버가 죽었다 살아나도
// 휴게 시작시각이 저장돼 있어 남은 타이머를 다시 건다(이미 지난 건 즉시 배정).

const config = require('./config');
const db = require('./db');

let state = null;
let broadcast = () => {};
let sweepStarted = false;
const timers = new Map(); // workerId -> setTimeout 핸들

function setBroadcast(fn) { broadcast = fn; }

// ---- 상태 생성/로드 ----

function freshState() {
  const docks = {};
  config.DOCK_DEFS.forEach(([id, zone], i) => {
    docks[id] = { id, zone, order: i, active: false, status: 'inactive', workerId: null, freedAt: null };
  });
  return { configured: false, startedAt: null, docks, workers: {}, events: [], seq: 0 };
}

async function init() {
  const loaded = await db.load();
  state = (loaded && loaded.docks) ? loaded : freshState();

  // config가 바뀌었을 수 있으니 누락 도크 보강
  config.DOCK_DEFS.forEach(([id, zone], i) => {
    if (!state.docks[id]) state.docks[id] = { id, zone, order: i, active: false, status: 'inactive', workerId: null, freedAt: null };
  });
  for (const w of Object.values(state.workers)) {
    if (w.returningUntil === undefined) w.returningUntil = null;
  }

  // 진행 중이던 휴게 타이머 복구
  for (const w of Object.values(state.workers)) {
    if (w.status === 'break') scheduleAssign(w.id);
  }
  markReadyDue(); // 다운타임 동안 이미 8분 넘은 작업자 즉시 처리

  if (!sweepStarted) {
    setInterval(markReadyDue, config.SWEEP_INTERVAL_MS);
    sweepStarted = true;
  }
  emit();
}

// ---- 조회용 뷰 (클라이언트로 보낼 형태) ----

function getState() {
  const docks = Object.values(state.docks)
    .sort((a, b) => a.order - b.order)
    .map((d) => ({
      id: d.id, zone: d.zone, order: d.order, active: d.active, status: d.status,
      workerId: d.workerId,
      worker: d.workerId && state.workers[d.workerId] ? state.workers[d.workerId].name : null,
      freedAt: d.freedAt,
    }));

  const workers = Object.values(state.workers)
    .map((w) => ({
      id: w.id, name: w.name, status: w.status, dockId: w.dockId,
      breakStartedAt: w.breakStartedAt || null,
      assignAt: w.breakStartedAt ? w.breakStartedAt + config.ASSIGN_DELAY_SEC * 1000 : null,
      returnAt: w.breakStartedAt ? w.breakStartedAt + config.BREAK_DELAY_SEC * 1000 : null,
      returningUntil: w.returningUntil || null,
    }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));

  return {
    configured: state.configured,
    startedAt: state.startedAt,
    serverNow: Date.now(),
    assignDelaySec: config.ASSIGN_DELAY_SEC,
    breakDelaySec: config.BREAK_DELAY_SEC,
    docks,
    workers,
    stats: {
      total: docks.length,
      active: docks.filter((d) => d.active).length,
      inactive: docks.filter((d) => !d.active).length,
      working: docks.filter((d) => d.status === 'working').length,
      waiting: docks.filter((d) => d.status === 'waiting').length,
      onBreak: workers.filter((w) => w.status === 'break').length,
      ready: workers.filter((w) => w.status === 'ready').length,
    },
  };
}

// ---- 명령 ----

// 하루 세팅: active = 가동 도크 id 배열, roster = [{dockId, workerName}]
function setup({ active, roster } = {}) {
  if (!Array.isArray(active) || active.length === 0) throw new Error('가동 도크를 1개 이상 선택하세요');
  for (const id of [...timers.keys()]) clearTimer(id);

  state = freshState();
  state.configured = true;
  state.startedAt = Date.now();

  active.forEach((id) => {
    const d = state.docks[id];
    if (d) { d.active = true; d.status = 'waiting'; d.freedAt = Date.now(); }
  });

  let n = 1;
  (roster || []).forEach(({ dockId, workerName }) => {
    const name = (workerName || '').trim();
    if (!name) return;
    const d = state.docks[dockId];
    if (!d || !d.active) return;
    const id = 'w' + (n++);
    state.workers[id] = { id, name, status: 'working', dockId, breakStartedAt: null, readyAt: null, returningUntil: null };
    d.status = 'working'; d.workerId = id; d.freedAt = null;
  });

  logEvent('setup', { active: active.length, workers: Object.keys(state.workers).length });
  persistAndEmit();
}

// 도크 작업 종료 → 그 작업자 휴게 시작, 도크는 대기열로
function endWork(dockId) {
  ensureConfigured();
  const d = state.docks[dockId];
  if (!d) throw new Error('없는 도크: ' + dockId);
  if (d.status !== 'working' || !d.workerId) throw new Error(dockId + ' 은(는) 지금 작업 중이 아닙니다');

  const w = state.workers[d.workerId];
  d.status = 'waiting'; d.freedAt = Date.now(); d.workerId = null;
  w.status = 'break'; w.dockId = null; w.breakStartedAt = Date.now(); w.readyAt = null; w.returningUntil = null;

  scheduleAssign(w.id);
  logEvent('end', { dockId, workerId: w.id, worker: w.name });
  tryMatch(); // 이미 복귀 준비된 작업자가 있으면 이 도크를 바로 가져갈 수 있음
  persistAndEmit();
}

// 관리자 수동 자리 변경(자동 배정 결과 보정).
// 대상 작업자는 '작업 중(배정 완료)' 이어야 함. 대상 도크가 비어있으면 이동, 차 있으면 맞교환.
function manualAssign(workerId, dockId) {
  ensureConfigured();
  const w = state.workers[workerId];
  const d = state.docks[dockId];
  if (!w) throw new Error('없는 작업자');
  if (!d) throw new Error('없는 도크');
  if (!d.active) throw new Error('비가동 도크에는 배정할 수 없습니다');
  if (w.status !== 'working' || !w.dockId) throw new Error('작업 중인 작업자만 자리 변경이 가능합니다(휴게 중이면 배정 후에 변경)');
  if (d.id === w.dockId) return;

  const oldDock = state.docks[w.dockId];
  if (d.status === 'working' && d.workerId) {
    // 맞교환
    const w2 = state.workers[d.workerId];
    oldDock.workerId = w2.id; w2.dockId = oldDock.id;
    d.workerId = w.id; w.dockId = d.id;
    w.returningUntil = null; w2.returningUntil = null;
    logEvent('swap', { a: w.name, b: w2.name, dockA: d.id, dockB: oldDock.id });
  } else {
    // 빈(대기) 도크로 이동 → 원래 자리는 대기열로
    oldDock.status = 'waiting'; oldDock.freedAt = Date.now(); oldDock.workerId = null;
    d.status = 'working'; d.workerId = w.id; d.freedAt = null;
    w.dockId = d.id; w.returningUntil = null;
    logEvent('move', { worker: w.name, from: oldDock.id, to: d.id });
  }
  tryMatch();
  persistAndEmit();
}

function reset() {
  for (const id of [...timers.keys()]) clearTimer(id);
  state = freshState();
  persistAndEmit();
}

// ---- 내부 로직 ----

function scheduleAssign(workerId) {
  clearTimer(workerId);
  const w = state.workers[workerId];
  if (!w || w.status !== 'break') return;
  const ms = Math.max(0, w.breakStartedAt + config.ASSIGN_DELAY_SEC * 1000 - Date.now());
  timers.set(workerId, setTimeout(() => markReady(workerId), ms));
}

function clearTimer(workerId) {
  const t = timers.get(workerId);
  if (t) { clearTimeout(t); timers.delete(workerId); }
}

// 한 작업자의 휴게 타이머 만료 → 복귀 준비
function markReady(workerId) {
  const w = state.workers[workerId];
  if (!w || w.status !== 'break') return;
  const due = w.breakStartedAt + config.ASSIGN_DELAY_SEC * 1000;
  if (Date.now() < due - 200) { scheduleAssign(workerId); return; } // 너무 이름 → 다시 예약
  w.status = 'ready'; w.readyAt = due;
  clearTimer(workerId);
  tryMatch();
  persistAndEmit();
}

// 안전망: 8분 지났는데 아직 처리 안 된 작업자들을 한 번에 준비 처리
function markReadyDue() {
  const now = Date.now();
  let changed = false;
  for (const w of Object.values(state.workers)) {
    if (w.status === 'break' && now >= w.breakStartedAt + config.ASSIGN_DELAY_SEC * 1000) {
      w.status = 'ready';
      w.readyAt = w.breakStartedAt + config.ASSIGN_DELAY_SEC * 1000;
      clearTimer(w.id);
      changed = true;
    }
  }
  if (tryMatch()) changed = true;
  if (changed) persistAndEmit();
  return changed;
}

// 대기 도크 ↔ 준비된 작업자를 끝난 순서(FIFO)대로 매칭
function tryMatch() {
  let changed = false;
  for (;;) {
    const dock = Object.values(state.docks)
      .filter((d) => d.status === 'waiting')
      .sort((a, b) => (a.freedAt - b.freedAt) || (a.order - b.order))[0];
    const worker = Object.values(state.workers)
      .filter((w) => w.status === 'ready')
      .sort((a, b) => a.readyAt - b.readyAt)[0];
    if (!dock || !worker) break;
    assign(worker, dock);
    changed = true;
  }
  return changed;
}

function assign(worker, dock) {
  const bs = worker.breakStartedAt;
  dock.status = 'working'; dock.workerId = worker.id; dock.freedAt = null;
  worker.dockId = dock.id; worker.status = 'working';
  // 배정은 8분에 났지만 실제 복귀는 10분 → 그 사이 "복귀중"으로 표시
  worker.returningUntil = bs ? bs + config.BREAK_DELAY_SEC * 1000 : null;
  worker.breakStartedAt = null; worker.readyAt = null;
  clearTimer(worker.id);
  logEvent('assign', { dockId: dock.id, workerId: worker.id, worker: worker.name });
}

// ---- 유틸 ----

function ensureConfigured() { if (!state.configured) throw new Error('먼저 세팅을 완료하세요'); }

function logEvent(type, data) {
  state.seq = (state.seq || 0) + 1;
  state.events.push({ seq: state.seq, ts: Date.now(), type, ...data });
  if (state.events.length > 2000) state.events.splice(0, state.events.length - 2000);
}

function persistAndEmit() { db.save(state); emit(); }
function emit() { try { broadcast(getState()); } catch (e) { console.error('[engine] emit 실패:', e.message); } }

module.exports = { init, setBroadcast, getState, setup, endWork, manualAssign, reset };
