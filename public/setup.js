/* 세팅 화면: 도크 토글 + 작업자 명단 입력 → setup:save */
/* global onState, act */

let docks = [];
let built = false;

// 타임스탬프 → datetime-local 입력값(브라우저 로컬시간 = 관리자 폰 기준)
function toLocalInput(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 밥 끝 시각 → 빠른배정 구간(직후 1시간) 표시
function updateFastHint() {
  const me = document.getElementById('mealEnd').value;
  const m = /^(\d{1,2}):(\d{2})$/.exec(me || '');
  const hint = document.getElementById('fastWindowHint');
  if (!m) { hint.textContent = '—'; return; }
  const start = (Number(m[1]) % 24) * 60 + Number(m[2]);
  const end = (start + 60) % 1440;
  const fmt = (x) => String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0');
  hint.textContent = `${me} ~ ${fmt(end)}`;
}

function build(s) {
  docks = s.docks;
  const zones = {};
  docks.forEach((d) => { (zones[d.zone] = zones[d.zone] || []).push(d); });

  const root = document.getElementById('zones');
  root.innerHTML = '';
  Object.keys(zones).forEach((zone) => {
    const col = document.createElement('div');
    col.className = 'bg-white rounded-2xl shadow p-4';
    col.innerHTML = `<h2 class="font-semibold mb-3">${zone}</h2>`;
    zones[zone].forEach((d) => {
      const active = d.active || !s.configured; // 첫 세팅 전엔 전부 가동 기본
      const name = d.worker || '';
      const row = document.createElement('div');
      row.className = 'flex items-center gap-2 py-1';
      row.innerHTML = `
        <input type="checkbox" class="dock-on w-4 h-4" data-id="${d.id}" ${active ? 'checked' : ''} />
        <span class="w-12 font-mono font-semibold">${d.id}</span>
        <input type="text" class="dock-name flex-1 border rounded-lg px-2 py-1 text-sm" data-id="${d.id}" placeholder="작업자 이름" value="${name}" />
      `;
      col.appendChild(row);
    });
    root.appendChild(col);
  });

  root.querySelectorAll('.dock-on').forEach((cb) => cb.addEventListener('change', syncRows));
  syncRows();

  // 작업 시작 시각 미리 채우기 (진행 중이면 기존 값, 아니면 지금)
  document.getElementById('startAt').value = toLocalInput(s.startedAt || Date.now());

  // 밥시간 미리 채우기 + 빠른배정 구간 표시
  document.getElementById('mealStart').value = s.mealStart || '00:00';
  document.getElementById('mealEnd').value = s.mealEnd || '01:00';
  document.getElementById('mealEnd').addEventListener('input', updateFastHint);
  updateFastHint();

  built = true;
}

function syncRows() {
  let on = 0;
  document.querySelectorAll('.dock-on').forEach((cb) => {
    const name = document.querySelector(`.dock-name[data-id="${cb.dataset.id}"]`);
    name.disabled = !cb.checked;
    name.classList.toggle('bg-slate-100', !cb.checked);
    name.classList.toggle('text-slate-400', !cb.checked);
    if (cb.checked) on++;
  });
  document.getElementById('liveCount').textContent = `가동 ${on}개 / 비가동 ${18 - on}개`;
}

document.getElementById('allOn').addEventListener('click', () => {
  document.querySelectorAll('.dock-on').forEach((cb) => (cb.checked = true));
  syncRows();
});

document.getElementById('fillNums').addEventListener('click', () => {
  let n = 1;
  document.querySelectorAll('.dock-on').forEach((cb) => {
    if (cb.checked) document.querySelector(`.dock-name[data-id="${cb.dataset.id}"]`).value = '작업자' + (n++);
  });
});

document.getElementById('save').addEventListener('click', async () => {
  const active = [];
  const roster = [];
  document.querySelectorAll('.dock-on').forEach((cb) => {
    if (!cb.checked) return;
    active.push(cb.dataset.id);
    const name = document.querySelector(`.dock-name[data-id="${cb.dataset.id}"]`).value.trim();
    if (name) roster.push({ dockId: cb.dataset.id, workerName: name });
  });
  const msg = document.getElementById('msg');
  if (!active.length) { msg.textContent = '가동 도크를 1개 이상 선택하세요'; msg.className = 'text-sm text-red-600'; return; }

  const startVal = document.getElementById('startAt').value;
  const startedAt = startVal ? new Date(startVal).getTime() : Date.now();
  const mealStart = document.getElementById('mealStart').value || '00:00';
  const mealEnd = document.getElementById('mealEnd').value || '01:00';
  const r = await act('setup:save', { active, roster, startedAt, mealStart, mealEnd });
  if (r.ok) {
    msg.textContent = `저장됨! 가동 ${active.length}개, 작업자 ${roster.length}명. 관리 현황판으로 이동합니다…`;
    msg.className = 'text-sm text-green-600';
    setTimeout(() => (location.href = '/manager.html'), 900);
  } else {
    msg.textContent = '오류: ' + r.error;
    msg.className = 'text-sm text-red-600';
  }
});

// 최초 1회만 그린다(입력 중 덮어쓰기 방지). 관리자 인증 후 진입.
ensureManagerAuth(() => {
  onState((s) => { if (!built) build(s); });
});
