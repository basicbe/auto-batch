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
  return {
    configured: false, startedAt: null,
    mealStart: config.MEAL_START_DEFAULT, mealEnd: config.MEAL_END_DEFAULT,
    docks, workers: {}, events: [], acks: {}, seq: 0,
  };
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
  if (!state.acks) state.acks = {}; // 구버전 저장 상태 보강

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
      assignAt: w.breakStartedAt ? w.breakStartedAt + assignDelaySecFor(w.breakStartedAt, state.startedAt, currentMealEndMin()) * 1000 : null,
      returnAt: w.breakStartedAt ? w.breakStartedAt + config.BREAK_DELAY_SEC * 1000 : null,
      returningUntil: w.returningUntil || null,
      lastDockId: w.lastDockId || null,
      updatedAt: w.updatedAt || 0,
    }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));

  return {
    configured: state.configured,
    startedAt: state.startedAt,
    serverNow: Date.now(),
    assignDelaySec: config.ASSIGN_DELAY_SEC,
    breakDelaySec: config.BREAK_DELAY_SEC,
    fastMode: isFastWindow(Date.now(), state.startedAt, currentMealEndMin()),
    mealStart: state.mealStart || config.MEAL_START_DEFAULT,
    mealEnd: state.mealEnd || config.MEAL_END_DEFAULT,
    fastMealStart: minToHHMM(currentMealEndMin()),
    fastMealEnd: minToHHMM(currentMealEndMin() + config.FAST_AFTER_MEAL_MIN),
    docks,
    workers,
    recentEnds: recentEndEvents(), // 신호수 화면용: 최근 종료된 도크(최신 먼저)
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

// 신호수 화면용: 최근 '종료' 이벤트를 최신 순으로 최대 limit개. 도크 번호만 필요.
function recentEndEvents(limit = 20) {
  const evs = state.events || [];
  const out = [];
  for (let i = evs.length - 1; i >= 0 && out.length < limit; i--) {
    const e = evs[i];
    if (e.type !== 'end') continue;
    out.push({ seq: e.seq, ts: e.ts, dockId: e.dockId, acked: !!(state.acks && state.acks[e.seq]) });
  }
  return out;
}

// ---- 명령 ----

// 하루 세팅: active = 가동 도크 id 배열, roster = [{dockId, workerName}]
function setup({ active, roster, startedAt, mealStart, mealEnd } = {}) {
  if (!Array.isArray(active) || active.length === 0) throw new Error('가동 도크를 1개 이상 선택하세요');

  // 휴게/복귀대기 중인 작업자는 세팅 폼에 안 보이므로 보존(인원 변경 시 사라지지 않게).
  // 단, 새 명단에 같은 이름이 있으면 그쪽을 우선(중복 방지).
  const prev = state;
  const rosterNames = new Set((roster || []).map((r) => (r.workerName || '').trim()).filter(Boolean));
  const preserved = (prev && prev.workers ? Object.values(prev.workers) : [])
    .filter((w) => (w.status === 'break' || w.status === 'ready') && !rosterNames.has(w.name));
  // 이전에 대기 중이던 도크의 freedAt(끝난 시각) 보존 → 대기시간·FIFO 순서 유지
  const prevFreed = {};
  if (prev && prev.docks) {
    Object.values(prev.docks).forEach((d) => { if (d.status === 'waiting' && d.freedAt) prevFreed[d.id] = d.freedAt; });
  }
  const keepStartedAt = prev && prev.configured ? prev.startedAt : null; // 진행 중이면 시작시각 유지
  const keepMealStart = prev && prev.configured ? prev.mealStart : null;
  const keepMealEnd = prev && prev.configured ? prev.mealEnd : null;

  for (const id of [...timers.keys()]) clearTimer(id);

  state = freshState();
  state.configured = true;
  const sa = Number(startedAt);
  state.startedAt = Number.isFinite(sa) ? sa : (keepStartedAt || Date.now()); // 세팅에서 지정한 시작 시각 우선
  state.mealStart = hhmmToMin(mealStart) != null ? mealStart : (keepMealStart || config.MEAL_START_DEFAULT);
  state.mealEnd = hhmmToMin(mealEnd) != null ? mealEnd : (keepMealEnd || config.MEAL_END_DEFAULT); // 밥 끝 시각 → 직후 1시간 빠른배정

  active.forEach((id) => {
    const d = state.docks[id];
    if (d) { d.active = true; d.status = 'waiting'; d.freedAt = prevFreed[id] || Date.now(); }
  });

  let n = 1;
  (roster || []).forEach(({ dockId, workerName }) => {
    const name = (workerName || '').trim();
    if (!name) return;
    const d = state.docks[dockId];
    if (!d || !d.active) return;
    const id = 'w' + (n++);
    state.workers[id] = { id, name, status: 'working', dockId, breakStartedAt: null, readyAt: null, returningUntil: null, lastDockId: null, updatedAt: Date.now() };
    d.status = 'working'; d.workerId = id; d.freedAt = null;
  });

  // 보존된 휴게/복귀대기 작업자 복원 (새 id로, 휴게 타이머 다시 걸기)
  preserved.forEach((w) => {
    const id = 'w' + (n++);
    state.workers[id] = { ...w, id };
    if (w.status === 'break') scheduleAssign(id);
  });
  tryMatch(); // 복귀 준비된 보존 작업자가 빈 도크 잡도록

  logEvent('setup', { active: active.length, workers: Object.keys(state.workers).length, preserved: preserved.length });
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
  w.status = 'break'; w.dockId = null; w.breakStartedAt = Date.now(); w.readyAt = null; w.returningUntil = null; w.lastDockId = dockId; w.updatedAt = Date.now();

  scheduleAssign(w.id);
  logEvent('end', { dockId, workerId: w.id, worker: w.name });
  tryMatch(); // 이미 복귀 준비된 작업자가 있으면 이 도크를 바로 가져갈 수 있음
  persistAndEmit();
}

// 도크 종료를 잘못 눌렀을 때 되돌리기: 휴게 중인 작업자를 방금 나온 도크로 복귀.
// 작업자가 아직 '휴게'(재배정 전)이고 그 도크가 여전히 대기(빈)일 때만 가능.
// 잘못 기록된 종료 이벤트와 신호수 확인표시도 지워 신호수 화면에서 사라지게 한다.
function undoEnd(workerId) {
  ensureConfigured();
  const w = state.workers[workerId];
  if (!w) throw new Error('없는 작업자');
  if (w.status !== 'break') throw new Error('휴게 시작 직후에만 되돌릴 수 있어요(이미 배정이 진행됨 — 자리 변경을 쓰세요)');
  const d = w.lastDockId && state.docks[w.lastDockId];
  if (!d) throw new Error('되돌릴 도크를 찾을 수 없습니다');
  if (d.status !== 'waiting' || d.workerId) throw new Error(d.id + ' 에 이미 다른 작업자가 들어가 되돌릴 수 없습니다(자리 변경을 쓰세요)');

  clearTimer(w.id);
  d.status = 'working'; d.workerId = w.id; d.freedAt = null;
  w.status = 'working'; w.dockId = d.id; w.breakStartedAt = null; w.readyAt = null; w.returningUntil = null; w.lastDockId = null; w.updatedAt = Date.now();

  // 가장 최근의 잘못된 종료 이벤트 + 그 확인표시 제거
  for (let i = state.events.length - 1; i >= 0; i--) {
    const e = state.events[i];
    if (e.type === 'end' && e.workerId === w.id && e.dockId === d.id) {
      if (state.acks) delete state.acks[e.seq];
      state.events.splice(i, 1);
      break;
    }
  }
  logEvent('undo_end', { dockId: d.id, workerId: w.id, worker: w.name });
  persistAndEmit();
}

// 신호수 화면의 '확인'/'되돌리기' — 서버 공유 상태(state.acks[seq]). seq = 종료 이벤트 번호.
// 읽기 화면용이라 관리자 인증 없이 허용. 존재하는 종료 이벤트만 허용(임의 키 주입 방지).
function ackEnd(seq, acked = true) {
  const n = Number(seq);
  if (!Number.isFinite(n)) throw new Error('잘못된 seq');
  if (!state.acks) state.acks = {};
  const exists = (state.events || []).some((e) => e.type === 'end' && e.seq === n);
  if (!exists) return; // 목록에서 사라진 이벤트면 조용히 무시
  if (acked) state.acks[n] = Date.now();
  else delete state.acks[n];
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
    w.updatedAt = Date.now(); w2.updatedAt = Date.now();
    logEvent('swap', { a: w.name, b: w2.name, dockA: d.id, dockB: oldDock.id });
  } else {
    // 빈(대기) 도크로 이동 → 원래 자리는 대기열로
    oldDock.status = 'waiting'; oldDock.freedAt = Date.now(); oldDock.workerId = null;
    d.status = 'working'; d.workerId = w.id; d.freedAt = null;
    w.dockId = d.id; w.returningUntil = null; w.updatedAt = Date.now();
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

// 시:분(KST) 유틸
function hhmmToMin(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  return m ? (Number(m[1]) % 24) * 60 + Number(m[2]) : null;
}
function minToHHMM(min) {
  const x = ((Math.round(min) % 1440) + 1440) % 1440;
  return String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0');
}
function kstMinutesOfDay(t) {
  const d = new Date(t + config.TZ_OFFSET_HOURS * 3600 * 1000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}
// min(분)이 [start, start+len) 안에 있나 — 자정 넘김 처리
function inDailyRange(min, start, len) {
  if (start == null) return false;
  return ((((min - start) % 1440) + 1440) % 1440) < len;
}
function currentMealEndMin() {
  const m = hhmmToMin(state && state.mealEnd);
  return m != null ? m : hhmmToMin(config.MEAL_END_DEFAULT);
}

// 빠른 배정 윈도우: ① 작업 시작 1시간 이내, 또는 ② 밥시간 직후 1시간(KST). mealEndMin = 밥 끝나는 시각(분).
function isFastWindow(t, startedAt, mealEndMin) {
  if (startedAt && t - startedAt < config.FAST_AFTER_START_MIN * 60 * 1000) return true;
  return inDailyRange(kstMinutesOfDay(t), mealEndMin, config.FAST_AFTER_MEAL_MIN);
}
function assignDelaySecFor(t, startedAt, mealEndMin) {
  return isFastWindow(t, startedAt, mealEndMin) ? config.FAST_ASSIGN_DELAY_SEC : config.ASSIGN_DELAY_SEC;
}

function scheduleAssign(workerId) {
  clearTimer(workerId);
  const w = state.workers[workerId];
  if (!w || w.status !== 'break') return;
  const ms = Math.max(0, w.breakStartedAt + assignDelaySecFor(w.breakStartedAt, state.startedAt, currentMealEndMin()) * 1000 - Date.now());
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
  const due = w.breakStartedAt + assignDelaySecFor(w.breakStartedAt, state.startedAt, currentMealEndMin()) * 1000;
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
    if (w.status !== 'break') continue;
    const due = w.breakStartedAt + assignDelaySecFor(w.breakStartedAt, state.startedAt, currentMealEndMin()) * 1000;
    if (now >= due) {
      w.status = 'ready';
      w.readyAt = due;
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
  // "→ 이동" 강조 유지: 빠른배정이면 배정 후 FAST_HIGHLIGHT_SEC(기본 2분), 아니면 복귀 예정(휴게 시작+10분)까지
  worker.returningUntil = bs
    ? (isFastWindow(bs, state.startedAt, currentMealEndMin()) ? Date.now() + config.FAST_HIGHLIGHT_SEC * 1000 : bs + config.BREAK_DELAY_SEC * 1000)
    : null;
  worker.breakStartedAt = null; worker.readyAt = null; worker.lastDockId = null; worker.updatedAt = Date.now();
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

module.exports = { init, setBroadcast, getState, setup, endWork, undoEnd, manualAssign, reset, ackEnd, isFastWindow, assignDelaySecFor, hhmmToMin };
