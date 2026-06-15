/* 관리 현황판: 도크 종료 입력, 현황, 수동 자리변경 */
/* global onState, act, startCountdowns, srvNow, fmt */

let cur = null;
let selectedZone = null; // 현황판에서 보고 있는 구역(1번/2번 대형)

function render(s) {
  cur = s;
  const notice = document.getElementById('notice');
  if (!s.configured) {
    notice.classList.remove('hidden');
    notice.innerHTML = '아직 세팅 전입니다. <a class="underline" href="/setup.html">세팅하러 가기 →</a>';
    document.getElementById('zoneTabs').innerHTML = '';
    document.getElementById('grid').innerHTML = '';
    document.getElementById('breaks').innerHTML = '';
    document.getElementById('summary').textContent = '';
    return;
  }
  notice.classList.add('hidden');

  const fastBadge = s.fastMode
    ? ' · <b class="text-orange-600">⚡ 빠른배정 중</b>'
    : ` · 배정 ${s.assignDelaySec}s / 휴게 ${s.breakDelaySec}s`;
  document.getElementById('summary').innerHTML =
    `가동 <b>${s.stats.active}</b> · 비가동 <b>${s.stats.inactive}</b> · ` +
    `작업중 <b>${s.stats.working}</b> · 대기 <b class="text-amber-600">${s.stats.waiting}</b> · ` +
    `휴게중 <b class="text-blue-600">${s.stats.onBreak}</b>${fastBadge}`;

  // 다른 도크로 보낼 때 쓸 옵션(가동 도크들)
  const activeDocks = s.docks.filter((d) => d.active);

  // 구역(1번/2번 대형) 탭 — 선택한 구역의 도크만 표시
  const zones = {};
  s.docks.forEach((d) => { (zones[d.zone] = zones[d.zone] || []).push(d); });
  const zoneNames = Object.keys(zones).sort();
  if (!selectedZone || !zones[selectedZone]) selectedZone = zoneNames[0];

  const tabs = document.getElementById('zoneTabs');
  tabs.innerHTML = '';
  zoneNames.forEach((zone) => {
    const b = document.createElement('button');
    b.className = 'zone-tab px-4 py-1.5 rounded-lg text-sm font-medium ' +
      (zone === selectedZone ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-600 hover:bg-slate-300');
    b.textContent = zone;
    b.dataset.zone = zone;
    tabs.appendChild(b);
  });

  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  const z = document.createElement('div');
  z.className = 'grid gap-2';
  z.style.gridTemplateColumns = 'repeat(auto-fill, minmax(130px, 1fr))'; // 320px에서도 한 줄 2개+
  (zones[selectedZone] || []).forEach((d) => z.appendChild(dockCard(d, activeDocks)));
  grid.appendChild(z);

  const breaks = document.getElementById('breaks');
  const out = s.workers
    .filter((w) => w.status === 'break' || w.status === 'ready')
    .sort((a, b) => (a.assignAt || 0) - (b.assignAt || 0)); // 배정까지 남은 시간 짧은 순(위로)
  breaks.innerHTML = out.length ? '' : '<div class="text-slate-400 text-sm">휴게 중인 작업자 없음</div>';
  out.forEach((w) => breaks.appendChild(breakCard(w)));
}

function dockCard(d, activeDocks) {
  const el = document.createElement('div');
  if (!d.active) {
    el.className = 'rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-slate-400';
    el.innerHTML = `<div class="font-mono font-bold">${d.id}</div><div class="text-xs">비가동</div>`;
    return el;
  }
  if (d.status === 'waiting') {
    el.className = 'rounded-xl border border-amber-300 bg-amber-50 px-3 py-2';
    el.innerHTML = `<div class="flex justify-between"><span class="font-mono font-bold">${d.id}</span>
      <span class="text-xs text-amber-700">대기 <b data-count-from="${d.freedAt}">${fmt((srvNow() - d.freedAt) / 1000)}</b></span></div>
      <div class="text-xs text-amber-600 mt-1">작업자 기다리는 중</div>`;
    return el;
  }
  // working
  el.className = 'rounded-xl border border-emerald-300 bg-white px-3 py-2 shadow-sm';
  const others = activeDocks.filter((x) => x.id !== d.id)
    .map((x) => `<option value="${x.id}">${x.id} ${x.status === 'working' ? '(교대)' : x.status === 'waiting' ? '(빈자리)' : ''}</option>`).join('');
  el.innerHTML = `
    <div class="flex justify-between items-center">
      <span class="font-mono font-bold">${d.id}</span>
      <span class="text-[11px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">작업중</span>
    </div>
    <div class="text-sm font-medium mt-0.5 truncate">${d.worker || '—'}</div>
    <button class="end-btn mt-2 w-full text-sm py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700" data-dock="${d.id}">종료</button>
    <select class="reassign mt-1 w-full text-xs border rounded-lg px-1 py-1 text-slate-500" data-worker="${d.workerId}">
      <option value="">자리 변경…</option>${others}
    </select>`;
  return el;
}

function breakCard(w) {
  const el = document.createElement('div');
  if (w.status === 'ready') {
    el.className = 'rounded-xl bg-white border border-slate-200 px-3 py-2 shadow-sm';
    el.innerHTML = `<div class="font-medium">${w.name}</div><div class="text-xs text-slate-500">복귀 준비됨 · 빈 도크 대기</div>`;
    return el;
  }
  el.className = 'rounded-xl bg-blue-50 border border-blue-200 px-3 py-2';
  el.innerHTML = `<div class="flex justify-between items-center">
      <span class="font-medium">${w.name}</span>
      <span class="text-xs text-blue-700">배정까지 <b data-count-to="${w.assignAt}">${fmt((w.assignAt - srvNow()) / 1000)}</b></span>
    </div>
    <div class="text-xs text-blue-500 mt-0.5">휴게 중</div>`;
  return el;
}

// 이벤트 위임 (그리드는 자주 다시 그려지므로)
document.getElementById('grid').addEventListener('click', async (e) => {
  const btn = e.target.closest('.end-btn');
  if (!btn) return;
  btn.disabled = true;
  const r = await act('dock:end', { dockId: btn.dataset.dock });
  if (!r.ok) { alert('오류: ' + r.error); btn.disabled = false; }
});

document.getElementById('grid').addEventListener('change', async (e) => {
  const sel = e.target.closest('.reassign');
  if (!sel || !sel.value) return;
  const r = await act('worker:reassign', { workerId: sel.dataset.worker, dockId: sel.value });
  if (!r.ok) alert('오류: ' + r.error);
  sel.value = '';
});

// 구역 탭 클릭 → 그 구역만 보기
document.getElementById('zoneTabs').addEventListener('click', (e) => {
  const b = e.target.closest('.zone-tab');
  if (!b) return;
  selectedZone = b.dataset.zone;
  if (cur) render(cur);
});

document.getElementById('reset').addEventListener('click', async () => {
  if (!confirm('오늘 배치를 모두 초기화할까요? (작업자/도크 상태가 비워집니다)')) return;
  await act('day:reset', {});
});

ensureManagerAuth(() => {
  onState(render);
  startCountdowns();
});
