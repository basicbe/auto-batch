/* 모든 화면 공통: 소켓 연결, 서버 시계 보정, 카운트다운 헬퍼 */
/* global io */

const socket = io();
let lastState = null;
let clockOffset = 0; // serverNow - clientNow
const stateListeners = [];

socket.on('state', (s) => {
  lastState = s;
  clockOffset = s.serverNow - Date.now();
  stateListeners.forEach((fn) => { try { fn(s); } catch (e) { console.error(e); } });
});
socket.on('connect_error', (e) => console.warn('소켓 오류:', e.message));

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

// 1초마다 data-count-to(남은시간)/data-count-from(경과시간) 엘리먼트 갱신 → 셀렉트/버튼 안 건드림
function startCountdowns() {
  setInterval(() => {
    const now = srvNow();
    document.querySelectorAll('[data-count-to]').forEach((el) => {
      el.textContent = fmt((+el.dataset.countTo - now) / 1000);
    });
    document.querySelectorAll('[data-count-from]').forEach((el) => {
      el.textContent = fmt((now - +el.dataset.countFrom) / 1000);
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
  let pw = localStorage.getItem('mgrpw') || '';
  let done = false;
  socket.on('connect', () => { if (pw) socket.emit('auth', pw, () => {}); }); // 재연결 시 자동 재인증

  function proceed() { removeGate(); if (!done) { done = true; onReady(); } }
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
