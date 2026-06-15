/* 신호수 알림 화면 (스마트폰 전용)
   관리자가 '도크 종료'를 누르면 → 이 화면에 큰 카드 + 소리 + 진동으로 알림.
   관리자 인증 없음. common.js의 socket / onState / srvNow / act 사용.
   '확인'은 서버 공유 상태 — 한 명이 확인하면 모든 신호수 화면에 반영(getState().recentEnds[].acked).
   목록 갱신은 상태 수신 또는 강조(fresh) 만료 시에만 다시 그려서 펄스 애니메이션이 끊기지 않게 한다. */
/* global socket, onState, srvNow, act */

const FRESH_MS = 120 * 1000; // 종료 후 이 시간 동안 '방금 종료'로 크게 강조
const MAX_CARDS = 15;        // 화면에 보여줄 최근 종료 개수

let cur = null;
let seenSeq = null;          // 알림 기준선: 화면을 처음 열 때 들어있던 건은 울리지 않음
let lastRenderKey = '';      // 목록을 다시 그릴지 판단하는 키
let soundOn = localStorage.getItem('sigSound') !== 'off';

/* ─────────── 확인(ack): 서버 공유 ─────────── */
// 낙관적으로 즉시 반영 후 서버에 전송 → 서버가 모든 신호수 화면에 브로드캐스트
function setAck(seq, acked) {
  if (cur && cur.recentEnds) {
    const it = cur.recentEnds.find((e) => e.seq === seq);
    if (it) it.acked = acked;
  }
  render();
  act('signal:ack', { seq, acked });
}

/* ─────────── 소리 / 진동 ─────────── */
let audioCtx = null;
function unlockAudio() {
  try {
    if (!audioCtx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) audioCtx = new AC(); }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) { /* 무시 */ }
}
function chime() {
  if (!soundOn) return;
  unlockAudio();
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime;
  [880, 1175, 1568].forEach((f, i) => { // 3음 상승 차임
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    o.connect(g); g.connect(audioCtx.destination);
    const s = t0 + i * 0.15;
    g.gain.setValueAtTime(0.0001, s);
    g.gain.exponentialRampToValueAtTime(0.6, s + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, s + 0.28);
    o.start(s); o.stop(s + 0.3);
  });
}
function buzz() { try { if (navigator.vibrate) navigator.vibrate([220, 90, 220, 90, 340]); } catch (e) { /* 무시 */ } }
function alertNew() { chime(); buzz(); }

/* 화면 꺼짐 방지(지원 브라우저) — 사용자 탭 이후 호출 */
let wakeLock = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* 무시 */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });

/* ─────────── 시간 표기 ─────────── */
function ago(ts) {
  const s = Math.max(0, Math.round((srvNow() - ts) / 1000));
  if (s < 5) return '방금';
  if (s < 60) return s + '초 전';
  const m = Math.floor(s / 60);
  if (m < 60) return m + '분 전';
  const h = Math.floor(m / 60);
  return h + '시간 ' + (m % 60) + '분 전';
}
function clockText() {
  const d = new Date(srvNow());
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((x) => String(x).padStart(2, '0')).join(':');
}

/* ─────────── 새 종료 감지 → 알림 ─────────── */
function detectNew(s) {
  const ends = (s && s.recentEnds) || [];
  const maxSeq = ends.reduce((m, e) => Math.max(m, e.seq), 0);
  if (seenSeq === null || maxSeq < seenSeq) { seenSeq = maxSeq; return; } // 최초 로드 / 하루 리셋 → 기준선만 갱신
  if (maxSeq > seenSeq) { seenSeq = maxSeq; alertNew(); }
}

/* ─────────── 렌더 ─────────── */
function render() {
  document.getElementById('clock').textContent = clockText();

  const now = srvNow();
  const ends = (cur && cur.recentEnds) ? cur.recentEnds : [];
  const configured = !!(cur && cur.configured);

  // 다시 그릴지 판단: 연결상태 + 각 종료의 (seq + 확인/강조 상태)
  const key = (!cur ? 'n' : configured ? 'c' : 'x') + '#' +
    ends.slice(0, MAX_CARDS).map((e) =>
      e.seq + (e.acked ? 'a' : now - e.ts < FRESH_MS ? 'f' : 'o')).join('|');
  if (key === lastRenderKey) {
    document.querySelectorAll('[data-ago]').forEach((el) => { el.textContent = ago(+el.dataset.ago); });
    return;
  }
  lastRenderKey = key;
  rebuild(ends, configured, now);
}

function rebuild(ends, configured, now) {
  const list = document.getElementById('list');
  const sub = document.getElementById('subhead');

  if (!cur) { sub.textContent = ''; list.innerHTML = empty('연결 중…', ''); return; }
  if (!configured) { sub.textContent = ''; list.innerHTML = empty('세팅 전입니다', '관리자가 세팅을 마치면 시작됩니다'); return; }
  if (!ends.length) { sub.textContent = '도크가 완료되면 여기에 표시됩니다'; list.innerHTML = empty('🅿️ 대기 중', '아직 완료된 도크가 없습니다'); return; }

  const pending = ends.filter((e) => !e.acked).length;
  sub.textContent = pending ? `🔔 확인 대기 ${pending}곳` : `최근 완료 ${ends.length}건 · 모두 확인됨 ✓`;

  list.innerHTML = '';
  ends.slice(0, MAX_CARDS).forEach((e) => list.appendChild(card(e, now)));
}

function empty(title, desc) {
  return `<div class="text-center py-24 text-slate-600">
    <div class="text-2xl font-bold">${title}</div>
    ${desc ? `<div class="text-sm text-slate-700 mt-2">${desc}</div>` : ''}</div>`;
}

function card(e, now) {
  const el = document.createElement('div');

  if (e.acked) { // ── 확인 완료: 차분하게 + ✓ (↺ 되돌리기 가능)
    el.className = 'rounded-2xl bg-slate-800/50 border border-slate-700/60 px-4 py-3 flex items-center gap-2.5 opacity-75';
    el.innerHTML = `
      <span class="text-emerald-400 text-xl leading-none">✓</span>
      <span class="text-3xl font-black font-mono leading-none text-slate-300">${e.dockId}</span>
      <span class="text-sm text-slate-500">확인됨</span>
      <span class="ml-auto text-sm text-slate-600" data-ago="${e.ts}">${ago(e.ts)}</span>
      <button class="unack-btn text-slate-500 hover:text-slate-300 text-xl px-1 leading-none" data-seq="${e.seq}" title="되돌리기">↺</button>`;
    return el;
  }

  // ── 미확인: 큰 노란 카드 + 확인 버튼 (최근 120초면 펄스)
  const fresh = now - e.ts < FRESH_MS;
  el.className = (fresh ? 'fresh ' : '') + 'rounded-3xl bg-amber-400 text-slate-950 px-5 py-4 ring-2 ring-amber-300';
  el.innerHTML = `
    <div class="text-right text-sm font-bold mb-1" data-ago="${e.ts}">${ago(e.ts)}</div>
    <div class="flex items-end gap-2.5">
      <span class="text-7xl font-black font-mono leading-none tracking-tight">${e.dockId}</span>
      <span class="text-4xl font-black pb-1">완료</span>
    </div>
    <button class="ack-btn mt-3 w-full py-3 rounded-2xl bg-slate-950 text-amber-400 text-lg font-extrabold active:scale-95 transition" data-seq="${e.seq}">확인</button>`;
  return el;
}

/* ─────────── 버튼 / 연결 ─────────── */
function updateSoundBtn() {
  const b = document.getElementById('soundBtn');
  b.textContent = soundOn ? '🔔' : '🔕';
  b.classList.toggle('opacity-40', !soundOn);
}
document.getElementById('soundBtn').addEventListener('click', () => {
  soundOn = !soundOn;
  localStorage.setItem('sigSound', soundOn ? 'on' : 'off');
  updateSoundBtn();
  if (soundOn) { unlockAudio(); chime(); }
});

// 확인 / 되돌리기 (목록은 자주 다시 그려지므로 이벤트 위임)
document.getElementById('list').addEventListener('click', (e) => {
  const ackBtn = e.target.closest('.ack-btn');
  if (ackBtn) { setAck(+ackBtn.dataset.seq, true); return; }
  const unBtn = e.target.closest('.unack-btn');
  if (unBtn) setAck(+unBtn.dataset.seq, false);
});

document.getElementById('startBtn').addEventListener('click', () => {
  unlockAudio();
  buzz();
  if (soundOn) setTimeout(chime, 60); // 소리/진동 동작 확인
  keepAwake();
  const s = document.getElementById('start');
  if (s) s.remove();
});

function setConn(ok) {
  const el = document.getElementById('conn');
  el.className = 'w-2.5 h-2.5 rounded-full ' + (ok ? 'bg-emerald-400' : 'bg-rose-500');
  el.title = ok ? '연결됨' : '연결 끊김 — 재연결 중';
}
socket.on('connect', () => setConn(true));
socket.on('disconnect', () => setConn(false));
socket.on('connect_error', () => setConn(false));

/* ─────────── 시작 ─────────── */
updateSoundBtn();
setConn(socket.connected);
onState((s) => { cur = s; detectNew(s); render(); });
setInterval(render, 1000);
