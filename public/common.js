/* 모든 화면 공통: 소켓 연결, 서버 시계 보정, 카운트다운 헬퍼 */
/* global io */

// 웹소켓 우선(실패 시 폴링 폴백) + 짧은 재시도 간격 → 재연결 왕복 최소화.
// auth: 저장된 관리자 비밀번호를 핸드셰이크에 동봉해 재연결 때 인증 왕복을 없앤다(서버가 handshake.auth로 확인).
const socket = io({
  transports: ['websocket', 'polling'],
  tryAllTransports: true,
  reconnectionDelay: 300,
  reconnectionDelayMax: 2000,
  auth: (cb) => cb({ mgrpw: localStorage.getItem('mgrpw') || '' }),
});
let lastState = null;
let clockOffset = 0; // serverNow - clientNow
const stateListeners = [];

/* ── 연결 상태 오버레이 ──
   연결/재연결 중에는 "연결 중" 화면을 덮어 빈 화면을 잘못 누르는 것을 막는다.
   (배포판에서 연결 전 빈 화면을 누르면 인증 전이라 "관리자 비밀번호 오류"가 떴던 문제 방지.)
   - 인증 없는 화면(보드/신호수): 첫 state 도착 = 준비 완료 → 해제.
   - 인증 화면(관리/세팅): 인증이 끝나거나 비번 게이트가 뜰 때 해제(ensureManagerAuth에서). */
let _authManaged = false; // ensureManagerAuth를 쓰는 페이지면 true (인증까지 끝나야 화면 오픈)
let _connEl = null;
function showConnecting(msg) {
  if (!document.body) { document.addEventListener('DOMContentLoaded', () => showConnecting(msg), { once: true }); return; }
  if (!_connEl) {
    _connEl = document.createElement('div');
    _connEl.id = 'connOverlay';
    _connEl.style.cssText = 'position:fixed;inset:0;background:#0f172a;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;z-index:10000;font-family:sans-serif;color:#e2e8f0;touch-action:none;overscroll-behavior:none';
    _connEl.innerHTML = '<div style="width:46px;height:46px;border:4px solid #334155;border-top-color:#38bdf8;border-radius:50%;animation:connspin .8s linear infinite"></div>'
      + '<div id="connMsg" style="font-size:18px;font-weight:600">연결 중…</div>'
      + '<style>@keyframes connspin{to{transform:rotate(360deg)}}</style>';
    // 모바일에서 오버레이 위 스크롤 제스처가 뒤 페이지를 고무줄처럼 끌어 오버레이가 움직여 보이는 것 방지
    _connEl.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    document.body.appendChild(_connEl);
  }
  const m = _connEl.querySelector('#connMsg');
  if (m) m.textContent = msg || '연결 중…';
  _connEl.style.display = 'flex';
}
function hideConnecting() { if (_connEl) _connEl.style.display = 'none'; }

showConnecting(); // 로드 즉시 (소켓은 아직 연결 전)
socket.on('disconnect', () => showConnecting('연결이 끊겼습니다 · 재연결 중…'));

socket.on('state', (s) => {
  lastState = s;
  clockOffset = s.serverNow - Date.now();
  if (!_authManaged) hideConnecting(); // 인증 없는 화면: 첫 상태 도착 = 준비 완료
  stateListeners.forEach((fn) => { try { fn(s); } catch (e) { console.error(e); } });
});
socket.on('connect_error', (e) => { console.warn('소켓 오류:', e.message); showConnecting('서버에 연결 중…'); });

/* ── 화면 복귀 시 즉시 재연결 ──
   백그라운드에 다녀오면 다음 재시도 예약(백오프 최대 2초)을 기다리지 않고 바로 붙는다.
   연결된 것으로 보여도 얼려진 사이 죽었을 수 있어, 2초 내 응답 없으면 끊고 새로 연결. */
function reviveSocket() {
  if (socket.disconnected) { socket.connect(); return; }
  socket.timeout(2000).emit('hb', (err) => { if (err) { socket.disconnect(); socket.connect(); } });
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reviveSocket(); });
window.addEventListener('pageshow', reviveSocket);
window.addEventListener('online', reviveSocket);

function onState(fn) {
  stateListeners.push(fn);
  if (lastState) fn(lastState);
}

// 서버 기준 현재 시각(클라이언트 시계 오차 보정)
function srvNow() { return Date.now() + clockOffset; }

// 초 → "m:ss"
function fmt(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}

// 서버에 명령 보내고 결과(ok/error) 받기
function act(ev, payload) {
  return new Promise((res) => socket.emit(ev, payload, res));
}

// 1초마다 data-count-to(남은시간)/data-count-from(경과시간) 엘리먼트 갱신 → 셀렉트/버튼 안 건드림.
// 예외: data-hide-at(만료 시각 ms)이 지난 요소는 제거 — 상태 변경 없이도 제때 사라지게(예: 종료취소 버튼 1분).
function startCountdowns() {
  setInterval(() => {
    const now = srvNow();
    document.querySelectorAll('[data-count-to]').forEach((el) => {
      el.textContent = fmt((+el.dataset.countTo - now) / 1000);
    });
    document.querySelectorAll('[data-count-from]').forEach((el) => {
      el.textContent = fmt((now - +el.dataset.countFrom) / 1000);
    });
    document.querySelectorAll('[data-hide-at]').forEach((el) => {
      if (now >= +el.dataset.hideAt) el.remove();
    });
  }, 1000);
}

/* ── 관리자 인증 (manager/setup 화면에서만 사용; board 는 미사용) ── */
let _hello = null;
const _helloFns = [];
socket.on('hello', (h) => { _hello = h; _helloFns.forEach((fn) => fn(h)); });
function onHello(fn) { _helloFns.push(fn); if (_hello) fn(_hello); }

// onReady() 는 인증이 끝났을 때(또는 비번 미설정이면 즉시) 호출된다.
function ensureManagerAuth(onReady) {
  _authManaged = true; // 인증이 끝나기 전엔 '연결 중' 오버레이를 내리지 않음(인증 전 클릭 방지)
  let pw = localStorage.getItem('mgrpw') || '';
  let done = false;
  // 재연결 시 재인증은 핸드셰이크 auth(mgrpw)가 처리 — 별도 auth 왕복 불필요.

  function proceed() { hideConnecting(); removeGate(); if (!done) { done = true; onReady(); } }
  function decide(h) {
    if (!h.authRequired || h.authed) return proceed();
    if (pw) {
      socket.emit('auth', pw, (r) => {
        if (r && r.ok) proceed();
        else { pw = ''; localStorage.removeItem('mgrpw'); showGate(); }
      });
    } else showGate();
  }
  function showGate() {
    hideConnecting(); // 비번 입력 화면을 보여주기 위해 연결중 오버레이는 내림
    if (document.getElementById('authGate')) return;
    const g = document.createElement('div');
    g.id = 'authGate';
    g.style.cssText = 'position:fixed;inset:0;background:#0f172a;display:flex;align-items:center;justify-content:center;z-index:9999;font-family:sans-serif';
    g.innerHTML = '<div style="background:#fff;padding:24px;border-radius:16px;width:280px"><div style="font-weight:700;margin-bottom:12px">🔒 관리자 비밀번호</div><input id="authPw" type="password" placeholder="비밀번호" autocomplete="current-password" style="width:100%;box-sizing:border-box;padding:9px;border:1px solid #cbd5e1;border-radius:8px"/><div id="authErr" style="color:#dc2626;font-size:12px;height:16px;margin:4px 0"></div><button id="authBtn" style="width:100%;padding:9px;background:#2563eb;color:#fff;border:none;border-radius:8px;cursor:pointer">확인</button></div>';
    document.body.appendChild(g);
    const go = () => {
      const v = document.getElementById('authPw').value;
      socket.emit('auth', v, (r) => {
        if (r && r.ok) { pw = v; localStorage.setItem('mgrpw', v); proceed(); }
        else document.getElementById('authErr').textContent = '비밀번호가 틀렸습니다';
      });
    };
    document.getElementById('authBtn').onclick = go;
    document.getElementById('authPw').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    setTimeout(() => document.getElementById('authPw').focus(), 50);
  }
  function removeGate() { const g = document.getElementById('authGate'); if (g) g.remove(); }
  onHello(decide);
}
