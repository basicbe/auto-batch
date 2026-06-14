/* 공용 보드: 작업자가 본인 이름으로 다음 자리를 찾는 큰 화면.
   카드가 적으므로 1초마다 통째로 다시 그린다(카운트다운/복귀강조 자동 반영). */
/* global onState, srvNow, fmt */

let cur = null;

function render() {
  const s = cur;
  const board = document.getElementById('board');
  const stat = document.getElementById('stat');
  const now = srvNow();

  // 시계
  const d = new Date(now);
  document.getElementById('clock').textContent =
    [d.getHours(), d.getMinutes(), d.getSeconds()].map((x) => String(x).padStart(2, '0')).join(':');

  if (!s || !s.configured) {
    board.innerHTML = '<div class="text-slate-500 text-xl">세팅 전입니다.</div>';
    stat.textContent = '';
    return;
  }
  stat.innerHTML = `가동 ${s.stats.active} · 휴게중 ${s.stats.onBreak} · 대기도크 ${s.stats.waiting}`;

  // 최근에 배정/변경된 작업자가 맨 위로 (동률이면 이름순)
  const ws = [...s.workers].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) || (a.name || '').localeCompare(b.name || '', 'ko'));
  board.innerHTML = '';
  ws.forEach((w) => board.appendChild(card(w, now)));
}

function card(w, now) {
  const el = document.createElement('div');
  const returning = w.returningUntil && now < w.returningUntil;

  if (w.status === 'break') {
    el.className = 'rounded-2xl bg-slate-800 border border-slate-700 px-5 py-4';
    el.innerHTML = `<div class="text-2xl font-bold">${w.name}</div>
      <div class="text-slate-400 mt-1">휴게 중 · 배정까지 <b class="text-slate-200">${fmt((w.assignAt - now) / 1000)}</b></div>`;
  } else if (w.status === 'ready') {
    el.className = 'rounded-2xl bg-slate-800 border border-slate-700 px-5 py-4';
    el.innerHTML = `<div class="text-2xl font-bold">${w.name}</div>
      <div class="text-slate-400 mt-1">복귀 준비됨 · 빈 도크 대기</div>`;
  } else if (returning) {
    el.className = 'rounded-2xl bg-emerald-500 text-slate-900 px-5 py-4 shadow-lg ring-2 ring-emerald-300';
    el.innerHTML = `<div class="text-2xl font-bold">${w.name}</div>
      <div class="flex items-baseline gap-2 mt-1">
        <span class="text-4xl font-black font-mono">${w.dockId}</span>
        <span class="text-sm font-semibold">로 이동</span>
      </div>`;
  } else {
    el.className = 'rounded-2xl bg-slate-800/60 border border-slate-700 px-5 py-4';
    el.innerHTML = `<div class="text-2xl font-bold text-slate-200">${w.name}</div>
      <div class="mt-1"><span class="text-2xl font-mono font-bold text-slate-100">${w.dockId || '—'}</span>
      <span class="text-slate-400 text-sm ml-1">작업중</span></div>`;
  }
  return el;
}

onState((s) => { cur = s; render(); });
setInterval(render, 1000);
