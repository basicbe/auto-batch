/* 관리 현황판: 도크 종료 입력, 현황, 수동 자리변경 */
/* global onState, act, startCountdowns, srvNow, fmt */

let cur = null;
let selectedZone = null; // 현황판에서 보고 있는 구역(1번/2번 대형)
let selectedTab = 'docks'; // 상단 탭: 'docks'(작업종료) | 'commandos'(특공대) | 'breaks'(휴게중)

function render(s) {
  cur = s;
  const notice = document.getElementById('notice');
  if (!s.configured) {
    notice.classList.remove('hidden');
    notice.innerHTML = '아직 세팅 전입니다. <a class="underline" href="/setup.html">세팅하러 가기 →</a>';
    document.getElementById('mainTabs').innerHTML = '';
    document.getElementById('zoneTabs').innerHTML = '';
    document.getElementById('grid').innerHTML = '';
    document.getElementById('breaks').innerHTML = '';
    document.getElementById('summary').textContent = '';
    document.getElementById('queue').classList.add('hidden');
    return;
  }
  notice.classList.add('hidden');

  // 요약 칩: 숫자는 잉크색으로 통일, 상태 색은 라벨 옆 점·아이콘이 담당(라벨이 항상 붙어 색만으로 구분하지 않음).
  // 점 색 4종(작업중 emerald-600 / 대기 amber-600 / 휴게중 blue-500 / 대기인력 indigo-600)은
  // 색각이상 구분(CVD)·대비 검증을 통과한 세트 — 하나만 바꾸지 말고 세트로 재검토할 것.
  const chip = (label, val, dot) =>
    `<span class="inline-flex items-center gap-1.5 bg-white rounded-lg shadow-sm px-2.5 py-1.5">`
    + (dot ? `<span class="w-2 h-2 rounded-full shrink-0 ${dot}"></span>` : '')
    + `<span class="text-xs text-slate-500">${label}</span><span class="text-sm font-semibold text-slate-800">${val}</span></span>`;
  document.getElementById('summary').innerHTML = [
    chip('가동', `${s.stats.active}/${s.stats.total}`),
    chip('작업중', s.stats.working, 'bg-emerald-600'),
    chip('대기', s.stats.waiting, 'bg-amber-600'),
    s.stats.noTruck ? `<span class="inline-flex items-center gap-1.5 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5"><span class="text-xs font-medium text-rose-700">🚫 미접안</span><span class="text-sm font-semibold text-rose-700">${s.stats.noTruck}</span></span>` : '',
    chip('휴게중', s.stats.onBreak, 'bg-blue-500'),
    s.stats.ready ? chip('대기인력', s.stats.ready, 'bg-indigo-600') : '',
    s.stats.commandos ? `<span class="inline-flex items-center gap-1.5 bg-white rounded-lg shadow-sm px-2.5 py-1.5"><span class="text-xs text-violet-700">🛠 특공대</span><span class="text-sm font-semibold text-slate-800">${s.stats.commandoIn}/${s.stats.commandos}</span></span>` : '',
    `<button id="timingBtn" title="배정/휴게 시간 변경" class="inline-flex items-center bg-white rounded-lg shadow-sm px-2.5 py-1.5 text-xs text-slate-500 hover:text-blue-700 hover:shadow">⏱ 배정&nbsp;<b class="text-sm font-semibold text-slate-800">${fmt(s.assignDelaySec)}</b>&nbsp;· 휴게&nbsp;<b class="text-sm font-semibold text-slate-800">${fmt(s.breakDelaySec)}</b>&nbsp;✎</button>`,
    s.fastMode ? '<span class="inline-flex items-center bg-orange-500 text-white rounded-lg px-2.5 py-1.5 text-xs font-semibold">⚡ 빠른배정 중</span>' : '',
  ].filter(Boolean).join('');

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
    b.className = 'zone-tab flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors ' +
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

  // 특공대 패널
  const cmds = s.commandos || [];
  const cmdWrap = document.getElementById('commandos');
  cmdWrap.innerHTML = cmds.length ? '' : '<div class="text-slate-400 text-sm">등록된 특공대가 없습니다 (세팅에서 추가)</div>';
  const deployTargets = s.docks.filter((d) => d.active && (d.status === 'waiting' || d.status === 'working') && (d.temps ? d.temps.length : 0) < 2);
  cmds.forEach((c) => cmdWrap.appendChild(commandoCard(c, deployTargets)));

  renderMainTabs(s, out.length);
}

// 상단 탭(작업종료/특공대/휴게중) 렌더 + 선택 패널만 표시
function renderMainTabs(s, breakCount) {
  const cmds = s.commandos || [];
  const TABS = [
    { key: 'docks', label: '작업종료', icon: '🚚', badge: s.stats.waiting, tone: 'amber' },
    { key: 'commandos', label: '특공대', icon: '🛠', badge: cmds.length ? `${s.stats.commandoIn}/${s.stats.commandos}` : 0, tone: 'violet' },
    { key: 'breaks', label: '휴게중', icon: '☕', badge: breakCount, tone: 'blue' },
  ];
  // [활성 탭 배경/글씨, 활성 배지, 활성 시 하단 강조선]
  const TONE = {
    amber: { on: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200', badge: 'bg-amber-500 text-white' },
    violet: { on: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200', badge: 'bg-violet-500 text-white' },
    blue: { on: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200', badge: 'bg-blue-500 text-white' },
  };
  const tabsEl = document.getElementById('mainTabs');
  tabsEl.innerHTML = '';
  TABS.forEach((t) => {
    const on = t.key === selectedTab;
    const c = TONE[t.tone];
    const b = document.createElement('button');
    // min-w-0 + whitespace-nowrap: 좁은 화면(320px)에서 한글 라벨이 글자단위 세로 줄바꿈되는 것 방지
    // 좁은 화면은 글씨↓·아이콘 숨김·패딩↓ 로 3개가 한 줄에 들어가게, 넓어지면(sm) 키움
    b.className = 'main-tab flex-1 min-w-0 flex items-center justify-center gap-1 sm:gap-1.5 px-1.5 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-bold whitespace-nowrap transition-colors ' +
      (on ? c.on : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50');
    b.dataset.tab = t.key;
    b.innerHTML =
      `<span class="hidden sm:inline text-base leading-none ${on ? '' : 'grayscale opacity-60'}">${t.icon}</span>` +
      `<span>${t.label}</span>` +
      (t.badge
        ? `<span class="text-[10px] sm:text-[11px] font-bold leading-none px-1.5 py-0.5 rounded-full ${on ? c.badge : 'bg-slate-200 text-slate-500'}">${t.badge}</span>`
        : '');
    tabsEl.appendChild(b);
  });
  document.getElementById('panel-docks').classList.toggle('hidden', selectedTab !== 'docks');
  document.getElementById('panel-commandos').classList.toggle('hidden', selectedTab !== 'commandos');
  document.getElementById('panel-breaks').classList.toggle('hidden', selectedTab !== 'breaks');
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
  // idle — 투입할 도크 선택 (대기/작업중 도크, 도크당 최대 2명)
  const opts = targets.map((d) => {
    const tag = d.status === 'working' ? ' · 작업중' : (d.noTruck ? ' · 미접안' : '');
    const cnt = d.temps && d.temps.length ? ` · 🛠${d.temps.length}` : '';
    return `<option value="${d.id}">${d.id}${tag}${cnt}</option>`;
  }).join('');
  const prev = c.lastDockId ? `<span class="text-[11px] font-normal text-slate-400">전위치 ${c.lastDockId}</span>` : '';
  el.className = 'rounded-xl bg-white border border-violet-200 px-3 py-2 shadow-sm';
  el.innerHTML = `<div class="font-medium flex items-center justify-between gap-1"><span>🛠 ${c.name}</span>${prev}</div>
    <select class="cmd-deploy mt-1 w-full text-xs border rounded-lg px-1 py-1 text-slate-500" data-commando="${c.id}">
      <option value="">투입할 도크…</option>${opts}
    </select>`;
  return el;
}

// 종료 취소 가능 시간: 종료 후 undoWindowSec(기본 1분) 이내만. 지난 시각(ms)을 넘기면 버튼 자체를 안 그린다.
function undoDeadline(w) {
  return (w.breakStartedAt || 0) + ((cur && cur.undoWindowSec) || 60) * 1000;
}
// 되돌리기 대상: 이 도크에서 방금 나와 아직 휴게 중인 작업자(가장 최근). — 대기 도크 카드용
function undoWorkerForDock(dockId) {
  if (!cur || !cur.workers) return null;
  return cur.workers
    .filter((w) => w.status === 'break' && w.lastDockId === dockId && srvNow() < undoDeadline(w))
    .sort((a, b) => (b.breakStartedAt || 0) - (a.breakStartedAt || 0))[0] || null;
}
// 이 작업자를 되돌릴 수 있나: 방금 나온 도크가 아직 대기(빈)인지 + 1분 이내인지. — 휴게 카드용
function undoDockForWorker(w) {
  if (!cur || !cur.docks || !w || w.status !== 'break' || !w.lastDockId) return null;
  if (srvNow() >= undoDeadline(w)) return null;
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
      // 작업종료(특공대가 일 끝냄) + 미접안 토글(거의 끝난 도크는 잠가서 복귀자 배정/교대 방지 → 다른 도크 먼저)
      btns = `<div class="mt-auto flex flex-col gap-1">
           <button class="cmd-finish w-full text-xs py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700" data-dock="${d.id}">작업종료</button>
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
           ${uw ? `<button class="undo-btn w-full text-xs py-1.5 rounded-lg bg-white border border-amber-400 text-amber-700 hover:bg-amber-100" data-worker="${uw.id}" data-hide-at="${undoDeadline(uw)}">↩ 종료 취소</button>` : ''}
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
  const tmps = d.temps || [];
  el.className = base + (nt ? 'border border-rose-300 bg-rose-50/50 shadow-sm' : 'border border-emerald-300 bg-white shadow-sm');
  const others = activeDocks.filter((x) => x.id !== d.id)
    .map((x) => `<option value="${x.id}">${x.id} ${x.status === 'working' ? '(교대)' : x.status === 'waiting' ? '(빈자리)' : ''}</option>`).join('');
  const statusBadge = nt
    ? '<span class="text-[11px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">🚫 미접안</span>'
    : '<span class="text-[11px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">작업중</span>';
  // 작업중 도크에 거들러 들어온 특공대(있으면) — 각자 빼기 가능
  const cmdRows = tmps.length ? '<div class="mt-1 flex flex-col gap-0.5">' + tmps.map((t) => `
        <div class="flex items-center justify-between gap-1">
          <span class="text-xs text-violet-700 truncate">🛠 ${t.name}</span>
          <button class="cmd-recall text-[11px] px-2 py-0.5 rounded bg-white border border-violet-300 text-violet-600 hover:bg-violet-50 shrink-0" data-commando="${t.id}">빼기</button>
        </div>`).join('') + '</div>' : '';
  el.innerHTML = `
    <div class="flex justify-between items-center">
      <span class="font-mono font-bold">${d.id}</span>
      ${statusBadge}
    </div>
    <div class="text-sm font-medium mt-0.5 truncate">${d.worker || '—'}</div>
    ${cmdRows}
    <button class="end-btn mt-auto w-full text-sm py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700" data-dock="${d.id}">작업종료</button>
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
      ${ud ? `<button class="undo-btn text-xs px-2 py-1 rounded-lg bg-white border border-blue-300 text-blue-700 hover:bg-blue-100" data-worker="${w.id}" data-hide-at="${undoDeadline(w)}">↩ 종료 취소 (${ud.id})</button>` : ''}
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
  if (cf) { await cmdBtn(cf, 'commando:finish', { dockId: cf.dataset.dock }, '이 도크 작업을 종료할까요? (대기열로 들어갑니다)'); return; }
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

// 특공대 패널: 투입(select)·빼기 (작업종료는 도크 카드에서)
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

// 상단 탭 클릭 → 해당 패널만 보기
document.getElementById('mainTabs').addEventListener('click', (e) => {
  const b = e.target.closest('.main-tab');
  if (!b) return;
  selectedTab = b.dataset.tab;
  if (cur) render(cur);
});

// 구역 탭 클릭 → 그 구역만 보기
document.getElementById('zoneTabs').addEventListener('click', (e) => {
  const b = e.target.closest('.zone-tab');
  if (!b) return;
  selectedZone = b.dataset.zone;
  if (cur) render(cur);
});

/* ── 배정/휴게 시간 변경 모달 (요약줄의 "배정 …/휴게 …" 클릭) ── */
// "6:30" 같은 분:초 또는 "390" 같은 초 입력을 초로 변환. 못 읽으면 null.
function parseDur(v) {
  const t = String(v || '').trim();
  const m = /^(\d{1,3}):([0-5]?\d)$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  return /^\d+$/.test(t) ? Number(t) : null;
}
function openTimingDialog() {
  if (!cur || document.getElementById('timingDlg')) return;
  const g = document.createElement('div');
  g.id = 'timingDlg';
  g.className = 'fixed inset-0 z-40 bg-slate-900/50 flex items-center justify-center p-4';
  g.innerHTML = `<div class="bg-white rounded-2xl shadow-xl p-5 w-72">
      <div class="font-bold mb-3">⏱ 배정/휴게 시간</div>
      <label class="block text-xs text-slate-500 mb-1">배정까지 (분:초 또는 초)</label>
      <input id="tAssign" class="w-full border border-slate-300 rounded-lg px-3 py-2 mb-3" value="${fmt(cur.assignDelaySec)}">
      <label class="block text-xs text-slate-500 mb-1">휴게 · 복귀 예정 (분:초 또는 초)</label>
      <input id="tBreak" class="w-full border border-slate-300 rounded-lg px-3 py-2" value="${fmt(cur.breakDelaySec)}">
      <div id="tErr" class="text-xs text-red-600 h-4 my-1"></div>
      <div class="flex gap-2">
        <button id="tCancel" class="flex-1 py-2 rounded-lg bg-slate-100 hover:bg-slate-200">취소</button>
        <button id="tSave" class="flex-1 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700">저장</button>
      </div>
    </div>`;
  document.body.appendChild(g);
  const close = () => g.remove();
  g.addEventListener('click', (e) => { if (e.target === g) close(); });
  g.querySelector('#tCancel').onclick = close;
  g.querySelector('#tSave').onclick = async () => {
    const a = parseDur(g.querySelector('#tAssign').value);
    const b = parseDur(g.querySelector('#tBreak').value);
    const err = g.querySelector('#tErr');
    if (a == null || b == null) { err.textContent = '"6:30" 또는 초 단위 숫자(390)로 입력하세요'; return; }
    const r = await act('timing:set', { assignDelaySec: a, breakDelaySec: b });
    if (r.ok) close(); else err.textContent = r.error;
  };
}
document.getElementById('summary').addEventListener('click', (e) => {
  if (e.target.closest('#timingBtn')) openTimingDialog();
});

document.getElementById('reset').addEventListener('click', async () => {
  if (!confirm('오늘 배치를 모두 초기화할까요? (작업자/도크 상태가 비워집니다)')) return;
  await act('day:reset', {});
});

ensureManagerAuth(() => {
  onState(render);
  startCountdowns();
});
