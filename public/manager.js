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
    document.getElementById('queue').classList.add('hidden');
    return;
  }
  notice.classList.add('hidden');

  const fastBadge = s.fastMode
    ? ' · <b class="text-orange-600">⚡ 빠른배정 중</b>'
    : ` · 배정 ${s.assignDelaySec}s / 휴게 ${s.breakDelaySec}s`;
  const noTruckBadge = s.stats.noTruck ? ` · 미접안 <b class="text-rose-600">${s.stats.noTruck}</b>` : '';
  const readyBadge = s.stats.ready ? ` · 대기인력 <b class="text-indigo-600">${s.stats.ready}</b>` : '';
  const cmdBadge = s.stats.commandos ? ` · 특공대 <b class="text-violet-600">${s.stats.commandoIn}/${s.stats.commandos}</b>` : '';
  document.getElementById('summary').innerHTML =
    `가동 <b>${s.stats.active}</b> · 비가동 <b>${s.stats.inactive}</b> · ` +
    `작업중 <b>${s.stats.working}</b> · 대기 <b class="text-amber-600">${s.stats.waiting}</b>${noTruckBadge}${readyBadge} · ` +
    `휴게중 <b class="text-blue-600">${s.stats.onBreak}</b>${cmdBadge}${fastBadge}`;

  // 대기 도크 배정 순서 (가장 오래된 = 다음 배정). 미접안은 제외 목록으로 따로.
  const qEl = document.getElementById('queue');
  const qDocks = s.docks.filter((d) => d.active && d.status === 'waiting' && !d.noTruck)
    .sort((a, b) => (a.freedAt - b.freedAt) || (a.order - b.order));
  const held = s.docks.filter((d) => d.active && d.status === 'waiting' && d.noTruck).map((d) => d.id);
  if (!qDocks.length && !held.length) {
    qEl.classList.add('hidden');
  } else {
    qEl.classList.remove('hidden');
    const order = qDocks.map((d, i) =>
      `<span class="inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-mono">${i + 1}.${d.id}${d.temps && d.temps.length ? '🛠' : ''}</span>`).join(' ');
    const heldStr = held.length ? ` <span class="text-rose-500 ml-1">· 미접안 ${held.join(', ')}</span>` : '';
    qEl.innerHTML = `<span class="text-slate-400">다음 배정 순서 ▶ </span>${order || '<span class="text-slate-400">대기 도크 없음</span>'}${heldStr}`;
  }

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
    const waiting = zones[zone].filter((d) => d.active && d.status === 'waiting').length;
    const on = zone === selectedZone;
    const b = document.createElement('button');
    b.className = 'zone-tab flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ' +
      (on ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700');
    b.dataset.zone = zone;
    b.innerHTML = `<span>${zone}</span>` + (waiting
      ? `<span class="text-[11px] font-bold leading-none px-1.5 py-0.5 rounded-full ${on ? 'bg-amber-100 text-amber-700' : 'bg-amber-500 text-white'}">${waiting}</span>`
      : '');
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

  // 특공대 패널 (명단 있을 때만)
  const cmds = s.commandos || [];
  document.getElementById('commandoTitle').classList.toggle('hidden', cmds.length === 0);
  const cmdWrap = document.getElementById('commandos');
  cmdWrap.innerHTML = '';
  const deployTargets = s.docks.filter((d) => d.active && d.status === 'waiting' && (d.temps ? d.temps.length : 0) < 2);
  cmds.forEach((c) => cmdWrap.appendChild(commandoCard(c, deployTargets)));
}

function commandoCard(c, targets) {
  const el = document.createElement('div');
  if (c.status === 'in') {
    el.className = 'rounded-xl bg-violet-50 border border-violet-300 px-3 py-2';
    el.innerHTML = `<div class="flex justify-between items-center">
        <span class="font-medium">🛠 ${c.name}</span>
        <span class="text-xs text-violet-700 font-mono font-bold">${c.dockId}</span>
      </div>
      <button class="cmd-recall mt-1 w-full text-[11px] px-2 py-1 rounded-lg bg-white border border-violet-300 text-violet-600 hover:bg-violet-50" data-commando="${c.id}">빼기</button>`;
    return el;
  }
  // idle — 투입할 도크 선택 (도크당 최대 2명, 1명 차 있으면 표시)
  const opts = targets.map((d) => `<option value="${d.id}">${d.id}${d.temps && d.temps.length ? ' (1명)' : ''}</option>`).join('');
  el.className = 'rounded-xl bg-white border border-violet-200 px-3 py-2 shadow-sm';
  el.innerHTML = `<div class="font-medium">🛠 ${c.name}</div>
    <select class="cmd-deploy mt-1 w-full text-xs border rounded-lg px-1 py-1 text-slate-500" data-commando="${c.id}">
      <option value="">투입할 도크…</option>${opts}
    </select>`;
  return el;
}

// 되돌리기 대상: 이 도크에서 방금 나와 아직 휴게 중인 작업자(가장 최근). — 대기 도크 카드용
function undoWorkerForDock(dockId) {
  if (!cur || !cur.workers) return null;
  return cur.workers
    .filter((w) => w.status === 'break' && w.lastDockId === dockId)
    .sort((a, b) => (b.breakStartedAt || 0) - (a.breakStartedAt || 0))[0] || null;
}
// 이 작업자를 되돌릴 수 있나: 방금 나온 도크가 아직 대기(빈)인지. — 휴게 카드용
function undoDockForWorker(w) {
  if (!cur || !cur.docks || !w || w.status !== 'break' || !w.lastDockId) return null;
  const d = cur.docks.find((x) => x.id === w.lastDockId);
  return (d && d.status === 'waiting' && !d.workerId) ? d : null;
}

function dockCard(d, activeDocks) {
  const el = document.createElement('div');
  // 모든 카드 공통: 같은 최소 높이 + 세로 flex → 상태와 무관하게 균일한 타일 크기
  const base = 'flex flex-col min-h-[150px] rounded-xl px-3 py-2.5 ';
  if (!d.active) {
    el.className = base + 'border border-dashed border-slate-300 bg-slate-50 text-slate-400';
    el.innerHTML = `<div class="font-mono font-bold">${d.id}</div><div class="text-xs mt-0.5">비가동</div>`;
    return el;
  }
  if (d.status === 'waiting') {
    const uw = undoWorkerForDock(d.id);
    const nt = d.noTruck;
    const tmps = d.temps || [];
    const tone = nt ? 'text-rose-700' : tmps.length ? 'text-violet-700' : 'text-amber-700';
    let cls, statusLine, btns;
    if (tmps.length) { // 특공대가 메꾸는 중 (최대 2명)
      cls = nt ? 'border border-rose-300 bg-rose-50' : 'border border-violet-300 bg-violet-50';
      const cmdRows = tmps.map((t) => `
          <div class="flex items-center justify-between gap-1">
            <span class="text-xs text-violet-700 truncate">🛠 특공대 ${t.name}</span>
            <button class="cmd-recall text-[11px] px-2 py-0.5 rounded bg-white border border-violet-300 text-violet-600 hover:bg-violet-50 shrink-0" data-commando="${t.id}">빼기</button>
          </div>`).join('');
      statusLine = (nt ? '<div class="text-xs text-rose-600 mt-1">🚫 미접안 · 배정 제외</div>' : '')
        + '<div class="mt-1 flex flex-col gap-0.5">' + cmdRows + '</div>';
      // 마무리(특공대가 일 끝냄) + 미접안 토글(거의 끝난 도크는 잠가서 복귀자 배정/교대 방지 → 다른 도크 먼저)
      btns = `<div class="mt-auto flex flex-col gap-1">
           <button class="cmd-finish w-full text-xs py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700" data-dock="${d.id}">마무리</button>
           <button class="notruck-btn w-full text-xs py-1.5 rounded-lg ${nt ? 'bg-rose-600 text-white hover:bg-rose-700' : 'bg-white border border-rose-300 text-rose-600 hover:bg-rose-50'}" data-dock="${d.id}" data-val="${nt ? '0' : '1'}">${nt ? '🚚 차 도착 — 배정 재개' : '🚫 미접안'}</button>
         </div>`;
    } else if (nt) { // 미접안
      cls = 'border border-rose-300 bg-rose-50';
      statusLine = '<div class="text-xs text-rose-600 mt-1">🚫 미접안 · 배정 제외</div>';
      btns = `<button class="notruck-btn mt-auto w-full text-xs py-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700" data-dock="${d.id}" data-val="0">🚚 차 도착 — 배정 재개</button>`;
    } else { // 일반 대기
      cls = 'border border-amber-300 bg-amber-50';
      statusLine = `<div class="text-xs text-amber-600 mt-1">${uw ? uw.name + ' 휴게 시작' : '작업자 기다리는 중'}</div>`;
      btns = `<div class="mt-auto flex flex-col gap-1">
           ${uw ? `<button class="undo-btn w-full text-xs py-1.5 rounded-lg bg-white border border-amber-400 text-amber-700 hover:bg-amber-100" data-worker="${uw.id}">↩ 종료 취소</button>` : ''}
           <button class="notruck-btn w-full text-xs py-1.5 rounded-lg bg-white border border-rose-300 text-rose-600 hover:bg-rose-50" data-dock="${d.id}" data-val="1">🚫 미접안</button>
         </div>`;
    }
    el.className = base + cls;
    el.innerHTML = `<div class="flex justify-between items-center"><span class="font-mono font-bold">${d.id}</span>
      <span class="text-xs ${tone}">대기 <b data-count-from="${d.freedAt}">${fmt((srvNow() - d.freedAt) / 1000)}</b></span></div>
      ${statusLine}
      ${btns}`;
    return el;
  }
  // working — 종료 버튼/자리변경은 mt-auto로 카드 하단에 고정
  const nt = d.noTruck;
  el.className = base + (nt ? 'border border-rose-300 bg-rose-50/50 shadow-sm' : 'border border-emerald-300 bg-white shadow-sm');
  const others = activeDocks.filter((x) => x.id !== d.id)
    .map((x) => `<option value="${x.id}">${x.id} ${x.status === 'working' ? '(교대)' : x.status === 'waiting' ? '(빈자리)' : ''}</option>`).join('');
  const statusBadge = nt
    ? '<span class="text-[11px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">🚫 미접안</span>'
    : '<span class="text-[11px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">작업중</span>';
  el.innerHTML = `
    <div class="flex justify-between items-center">
      <span class="font-mono font-bold">${d.id}</span>
      ${statusBadge}
    </div>
    <div class="text-sm font-medium mt-0.5 truncate">${d.worker || '—'}</div>
    <button class="end-btn mt-auto w-full text-sm py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700" data-dock="${d.id}">종료</button>
    <select class="reassign mt-1 w-full text-xs border rounded-lg px-1 py-1 text-slate-500" data-worker="${d.workerId}">
      <option value="">자리 변경…</option>${others}
    </select>
    <div class="flex gap-1 mt-1">
      <button class="notruck-btn flex-1 text-[11px] py-1 rounded-lg ${nt ? 'bg-rose-600 text-white hover:bg-rose-700' : 'bg-white border border-rose-300 text-rose-600 hover:bg-rose-50'}" data-dock="${d.id}" data-val="${nt ? '0' : '1'}">${nt ? '차 도착' : '미접안'}</button>
      <button class="standby-btn flex-1 text-[11px] py-1 rounded-lg bg-white border border-indigo-300 text-indigo-600 hover:bg-indigo-50" data-worker="${d.workerId}">배정 대기</button>
    </div>`;
  return el;
}

function breakCard(w) {
  const el = document.createElement('div');
  if (w.status === 'ready') {
    el.className = 'rounded-xl bg-white border border-slate-200 px-3 py-2 shadow-sm';
    el.innerHTML = `<div class="font-medium">${w.name}</div><div class="text-xs text-slate-500">복귀 준비됨 · 빈 도크 대기</div>`;
    return el;
  }
  const ud = undoDockForWorker(w);
  el.className = 'rounded-xl bg-blue-50 border border-blue-200 px-3 py-2';
  el.innerHTML = `<div class="flex justify-between items-center">
      <span class="font-medium">${w.name}</span>
      <span class="text-xs text-blue-700">배정까지 <b data-count-to="${w.assignAt}">${fmt((w.assignAt - srvNow()) / 1000)}</b></span>
    </div>
    <div class="flex items-center justify-between gap-2 mt-0.5">
      <span class="text-xs text-blue-500">휴게 중</span>
      ${ud ? `<button class="undo-btn text-xs px-2 py-1 rounded-lg bg-white border border-blue-300 text-blue-700 hover:bg-blue-100" data-worker="${w.id}">↩ 종료 취소 (${ud.id})</button>` : ''}
    </div>`;
  return el;
}

// 이벤트 위임 (그리드는 자주 다시 그려지므로)
document.getElementById('grid').addEventListener('click', async (e) => {
  const undo = e.target.closest('.undo-btn');
  if (undo) { await doUndo(undo); return; }
  const nt = e.target.closest('.notruck-btn');
  if (nt) {
    nt.disabled = true;
    const r = await act('dock:no-truck', { dockId: nt.dataset.dock, value: nt.dataset.val === '1' });
    if (!r.ok) { alert('오류: ' + r.error); nt.disabled = false; }
    return;
  }
  const sb = e.target.closest('.standby-btn');
  if (sb) {
    if (!confirm('이 작업자를 배정 대기로 뺄까요? (차 오는 도크로 순서대로 다시 배정됩니다)')) return;
    sb.disabled = true;
    const r = await act('worker:standby', { workerId: sb.dataset.worker });
    if (!r.ok) { alert('오류: ' + r.error); sb.disabled = false; }
    return;
  }
  const cr = e.target.closest('.cmd-recall');
  if (cr) { await cmdBtn(cr, 'commando:recall', { commandoId: cr.dataset.commando }); return; }
  const cf = e.target.closest('.cmd-finish');
  if (cf) { await cmdBtn(cf, 'commando:finish', { dockId: cf.dataset.dock }, '이 도크 일을 마무리할까요? (작업 종료처럼 대기열로 들어갑니다)'); return; }
  const btn = e.target.closest('.end-btn');
  if (!btn) return;
  btn.disabled = true;
  const r = await act('dock:end', { dockId: btn.dataset.dock });
  if (!r.ok) { alert('오류: ' + r.error); btn.disabled = false; }
});

// 휴게·복귀 패널의 '종료 취소'
document.getElementById('breaks').addEventListener('click', async (e) => {
  const undo = e.target.closest('.undo-btn');
  if (undo) await doUndo(undo);
});

// 잘못 누른 도크 종료 되돌리기 (작업자를 방금 나온 도크로 복귀)
async function doUndo(btn) {
  btn.disabled = true;
  const r = await act('worker:undo-end', { workerId: btn.dataset.worker });
  if (!r.ok) { alert('되돌리기 실패: ' + r.error); btn.disabled = false; }
}

// 특공대 버튼 공용 처리 (도크 카드·특공대 패널 양쪽에서 사용)
async function cmdBtn(btn, ev, payload, confirmMsg) {
  if (confirmMsg && !confirm(confirmMsg)) return;
  btn.disabled = true;
  const r = await act(ev, payload);
  if (!r.ok) { alert('오류: ' + r.error); btn.disabled = false; }
}

// 특공대 패널: 투입(select)·빼기 (마무리는 도크 카드에서)
document.getElementById('commandos').addEventListener('click', async (e) => {
  const recall = e.target.closest('.cmd-recall');
  if (recall) { await cmdBtn(recall, 'commando:recall', { commandoId: recall.dataset.commando }); return; }
});
document.getElementById('commandos').addEventListener('change', async (e) => {
  const dep = e.target.closest('.cmd-deploy');
  if (!dep || !dep.value) return;
  const r = await act('commando:deploy', { commandoId: dep.dataset.commando, dockId: dep.value });
  if (!r.ok) alert('오류: ' + r.error);
  dep.value = '';
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
