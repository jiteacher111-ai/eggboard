// 에그보드 화면 렌더링과 이벤트 처리

const ui = {
  view: 'board',
  selected: new Set(),
  sort: 'number',
  buyer: '',
  marketCat: 'all',
  logSid: '',
  logKind: '',
  settingsTab: 'basic',
  modal: null,
};

const $ = (sel) => document.querySelector(sel);

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const coin = (n) => `${esc(state.settings.coin)} ${Number(n).toLocaleString('ko-KR')}`;
const label = (s) => `${s.number ? s.number + '번 ' : ''}${esc(s.name)}`;

function fmtTime(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function sortedStudents() {
  const list = [...state.students];
  const by = {
    number: (a, b) => (Number(a.number) || 999) - (Number(b.number) || 999) || a.name.localeCompare(b.name, 'ko'),
    name: (a, b) => a.name.localeCompare(b.name, 'ko'),
    balance: (a, b) => b.balance - a.balance,
    xp: (a, b) => b.pet.xp - a.pet.xp,
  };
  return list.sort(by[ui.sort] || by.number);
}

/* ---------- 공통 조각 ---------- */

function petHtml(pet, size = '') {
  const hungry = fullnessNow(pet) < 30;
  return `<span class="pet ${size} ${hungry ? 'hungry' : ''}">
    <span class="pet-body">${petEmoji(pet)}</span>
    ${pet.acc ? `<span class="pet-acc">${pet.acc}</span>` : ''}
    ${hungry ? '<span class="pet-hungry" title="배고파요">💧</span>' : ''}
  </span>`;
}

function petTitle(pet) {
  const idx = stageIndex(pet.xp);
  if (idx === 0) return '정체불명의 알';
  return `${speciesOf(pet).name} · ${STAGES[idx].name}`;
}

function xpProgress(pet) {
  const idx = stageIndex(pet.xp);
  const cur = STAGES[idx].xp;
  const next = STAGES[idx + 1];
  if (!next) return { pct: 100, text: `XP ${pet.xp} · 최종 단계!` };
  const pct = Math.round(((pet.xp - cur) / (next.xp - cur)) * 100);
  const verb = idx === 0 ? '부화' : '진화';
  return { pct, text: `XP ${pet.xp} / ${next.xp} · ${next.xp - pet.xp} 더 모으면 ${verb}!` };
}

function bar(pct, cls = '') {
  return `<div class="bar ${cls}"><div style="width:${Math.max(0, Math.min(100, pct))}%"></div></div>`;
}

/* ---------- 렌더링 ---------- */

function render() {
  $('#className').textContent = state.settings.className;
  document.title = `${state.settings.className} · 에그보드`;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === ui.view));
  const views = { board: renderBoard, pets: renderPets, market: renderMarket, log: renderLog, settings: renderSettings };
  $('#view').innerHTML = views[ui.view]();
  renderActionBar();
  renderModal();
}

function switchView(v) {
  ui.view = v;
  if (location.hash !== '#' + v) history.replaceState(null, '', '#' + v);
  window.scrollTo(0, 0);
  render();
}

function emptyState() {
  return `<div class="empty">
    <div class="empty-egg">🥚</div>
    <h2>아직 학생이 없어요</h2>
    <p>학생을 등록하면 한 명당 하나씩 알이 지급돼요.<br>칭찬과 보상으로 알을 부화시키고 키워 보세요!</p>
    <div class="row center">
      <button class="btn primary" onclick="ui.settingsTab='students';switchView('settings')">👩‍🎓 학생 등록하기</button>
      <button class="btn" onclick="loadSampleStudents()">예시 학생으로 체험하기</button>
    </div>
  </div>`;
}

/* 학급 보드 */

function renderBoard() {
  if (!state.students.length) return emptyState();
  const paid = state.students.filter(paidToday).length;
  return `
  <div class="toolbar">
    <button class="btn primary big" onclick="openWage()">💰 오늘 일급 지급</button>
    <span class="pill ${paid === state.students.length ? 'ok' : ''}">오늘 ${paid}/${state.students.length}명 지급</span>
    <div class="spacer"></div>
    <button class="btn ghost" onclick="selectAll()">전체 선택</button>
    <button class="btn ghost" onclick="clearSel()">선택 해제</button>
    <select onchange="ui.sort=this.value;render()" aria-label="정렬">
      ${[['number', '번호순'], ['name', '이름순'], ['balance', '잔액순'], ['xp', '펫 성장순']]
        .map(([v, t]) => `<option value="${v}" ${ui.sort === v ? 'selected' : ''}>${t}</option>`)
        .join('')}
    </select>
  </div>
  <p class="hint">학생 카드를 눌러 선택한 뒤 아래에서 보상/차감을 고르세요. ⓘ 를 누르면 학생의 펫과 가방을 볼 수 있어요.</p>
  <div class="grid">${sortedStudents().map(cardHtml).join('')}</div>`;
}

function cardHtml(s) {
  const job = getJob(s.jobId);
  return `<div class="card ${ui.selected.has(s.id) ? 'selected' : ''}" data-sid="${s.id}" onclick="toggleSel('${s.id}')">
    <button class="info" title="학생 상세" onclick="event.stopPropagation();openStudent('${s.id}')">ⓘ</button>
    ${paidToday(s) ? '<span class="paid" title="오늘 일급 지급됨">💰</span>' : ''}
    <div class="num">${esc(s.number || '')}</div>
    ${petHtml(s.pet)}
    <div class="name">${esc(s.name)}</div>
    <div class="job">${job ? `${esc(job.emoji)} ${esc(job.name)}` : '&nbsp;'}</div>
    <div class="bal ${s.balance < 0 ? 'neg' : ''}">${coin(s.balance)}</div>
  </div>`;
}

function toggleSel(id) {
  ui.selected.has(id) ? ui.selected.delete(id) : ui.selected.add(id);
  document.querySelector(`.card[data-sid="${id}"]`)?.classList.toggle('selected', ui.selected.has(id));
  renderActionBar();
}

function selectAll() {
  state.students.forEach((s) => ui.selected.add(s.id));
  render();
}

function clearSel() {
  ui.selected.clear();
  render();
}

function renderActionBar() {
  const bar = $('#actionbar');
  const n = ui.selected.size;
  const show = ui.view === 'board' && n > 0;
  bar.classList.toggle('hidden', !show);
  document.body.classList.toggle('has-actionbar', show);
  if (!show) return;
  const chips = (kind, sign) =>
    state.reasons[kind]
      .map((r) => `<button class="chip ${kind}" onclick="applyReward(${sign},${r.amt},'${r.id}')">${sign > 0 ? '+' : '−'}${r.amt} ${esc(r.name)}</button>`)
      .join('');
  bar.innerHTML = `
    <div class="ab-head"><b>${n}명 선택</b><button class="btn ghost sm" onclick="clearSel()">✕ 선택 해제</button></div>
    <div class="chips"><span class="chip-label">보상</span>${chips('bonus', 1)}</div>
    <div class="chips"><span class="chip-label">차감</span>${chips('penalty', -1)}</div>
    <div class="custom">
      <input id="customAmt" type="number" min="1" placeholder="금액" inputmode="numeric">
      <input id="customReason" placeholder="사유 (선택)">
      <button class="btn good" onclick="applyCustom(1)">+ 보상</button>
      <button class="btn bad" onclick="applyCustom(-1)">− 차감</button>
    </div>`;
}

function applyCustom(sign) {
  const amt = Math.abs(Math.round(Number($('#customAmt').value)));
  if (!amt) return toast('금액을 입력해 주세요.', 'bad');
  applyReward(sign, amt, null, $('#customReason').value.trim());
}

function applyReward(sign, amt, reasonId, customNote) {
  const ids = [...ui.selected];
  if (!ids.length) return;
  const kind = sign > 0 ? 'bonus' : 'penalty';
  const reason = state.reasons[kind].find((r) => r.id === reasonId);
  const note = reason ? reason.name : customNote || (sign > 0 ? '추가 보상' : '차감');
  ids.forEach((id) => {
    const s = getStudent(id);
    if (s) changeBalance(s, sign * amt, kind, note);
  });
  save();
  ui.selected.clear();
  render();
  flashCards(ids, `${sign > 0 ? '+' : '−'}${amt}`, sign > 0 ? 'up' : 'down');
  toast(`${ids.length}명에게 ${sign > 0 ? '+' : '−'}${amt} ${state.settings.currency} · ${note}`, sign > 0 ? 'good' : 'bad');
  showEvolutions();
}

function flashCards(ids, text, cls) {
  ids.forEach((id) => {
    const card = document.querySelector(`.card[data-sid="${id}"]`);
    if (!card) return;
    const el = document.createElement('span');
    el.className = `float ${cls}`;
    el.textContent = text;
    card.appendChild(el);
    card.classList.add(`bump-${cls}`);
    setTimeout(() => {
      el.remove();
      card.classList.remove(`bump-${cls}`);
    }, 1200);
  });
}

/* 일급 지급 */

function openWage() {
  ui.modal = { type: 'wage', checked: new Set(state.students.filter((s) => !paidToday(s)).map((s) => s.id)) };
  renderModal();
}

function wageModal() {
  const m = ui.modal;
  const list = sortedStudents();
  const total = list.filter((s) => m.checked.has(s.id)).reduce((t, s) => t + wageOf(s), 0);
  return `
  <div class="m-head"><h2>💰 오늘의 일급 지급 <small>${todayKey()}</small></h2><button class="x" onclick="closeModal()">✕</button></div>
  <p class="hint">결석한 학생은 체크를 해제하세요. 직업이 있는 학생은 직업 일급, 없으면 기본 일급(${coin(state.settings.baseWage)})을 받아요.</p>
  <div class="row">
    <button class="btn ghost sm" onclick="wageCheckAll(true)">모두 체크</button>
    <button class="btn ghost sm" onclick="wageCheckAll(false)">모두 해제</button>
  </div>
  <div class="wage-list">
    ${list
      .map((s) => {
        const job = getJob(s.jobId);
        return `<label class="wage-row ${paidToday(s) ? 'done' : ''}">
          <input type="checkbox" ${m.checked.has(s.id) ? 'checked' : ''} onchange="wageCheck('${s.id}',this.checked)">
          <span class="wr-name">${label(s)}</span>
          <span class="wr-job">${job ? `${esc(job.emoji)} ${esc(job.name)}` : '기본'}</span>
          ${paidToday(s) ? '<span class="pill ok">오늘 지급됨</span>' : ''}
          <span class="wr-amt">+${wageOf(s)}</span>
        </label>`;
      })
      .join('')}
  </div>
  <div class="m-foot">
    <span>${m.checked.size}명 · 총 ${coin(total)}</span>
    <button class="btn primary" ${m.checked.size ? '' : 'disabled'} onclick="confirmWage()">지급하기</button>
  </div>`;
}

function wageCheck(id, on) {
  on ? ui.modal.checked.add(id) : ui.modal.checked.delete(id);
  renderModal();
}

function wageCheckAll(on) {
  ui.modal.checked = new Set(on ? state.students.map((s) => s.id) : []);
  renderModal();
}

function confirmWage() {
  const ids = [...ui.modal.checked];
  const again = ids.filter((id) => paidToday(getStudent(id))).length;
  if (again && !confirm(`${again}명은 오늘 이미 일급을 받았어요. 한 번 더 지급할까요?`)) return;
  const total = payWage(ids);
  ui.modal = null;
  render();
  flashCards(ids, '💰', 'up');
  toast(`${ids.length}명에게 일급 ${coin(total)} 지급 완료!`, 'good');
  showEvolutions();
}

/* 펫 마을 */

function renderPets() {
  if (!state.students.length) return emptyState();
  const list = [...state.students].sort((a, b) => b.pet.xp - a.pet.xp);
  return `
  <section class="panel rules">
    <h2>🐣 펫 키우기 규칙</h2>
    <ul>
      <li>모든 학생은 <b>정체불명의 알</b>을 하나씩 받아요. 어떤 펫이 나올지는 부화할 때까지 비밀!</li>
      <li>${state.settings.rewardXp ? `보상으로 받은 ${esc(state.settings.currency)}만큼 펫 경험치가 올라요.` : '마켓에서 먹이를 사서 먹이면 경험치가 올라요.'} 마켓의 <b>먹이</b>를 먹이면 더 빨리 자라요.</li>
      <li>하루 한 번 <b>쓰다듬기</b>로 경험치 +${PET_XP}. 먹이를 오래 안 주면 배가 고파져요 💧</li>
      <li>성장 단계: ${STAGES.map((s) => `${s.name}(${s.xp})`).join(' → ')}</li>
    </ul>
    <div class="species">${PET_SPECIES.map((p) => `<span title="${esc(p.name)}">🥚→${p.forms.join('→')}</span>`).join('')}</div>
  </section>
  <div class="grid pets-grid">
    ${list
      .map((s, i) => {
        const pr = xpProgress(s.pet);
        return `<div class="card pet-card" onclick="openStudent('${s.id}')">
          ${i < 3 && s.pet.xp > 0 ? `<span class="rank">${['🥇', '🥈', '🥉'][i]}</span>` : ''}
          ${petHtml(s.pet, 'lg')}
          <div class="pet-name">${esc(s.pet.name || '이름 없음')}</div>
          <div class="muted">${petTitle(s.pet)}</div>
          ${bar(pr.pct)}
          <div class="name sm">${label(s)}</div>
        </div>`;
      })
      .join('')}
  </div>`;
}

/* 학생 상세 */

function openStudent(id) {
  ui.modal = { type: 'student', id };
  renderModal();
}

function studentModal() {
  const s = getStudent(ui.modal.id);
  if (!s) return '';
  const pet = s.pet;
  const pr = xpProgress(pet);
  const full = fullnessNow(pet);
  const petted = pet.pettedOn === todayKey();
  const groups = {};
  s.inventory.forEach((inv) => {
    const key = `${inv.type}|${inv.emoji}|${inv.name}`;
    (groups[key] = groups[key] || []).push(inv);
  });
  const recent = state.log.filter((e) => e.sid === s.id).slice(0, 8);
  return `
  <div class="m-head"><h2>${label(s)}</h2><button class="x" onclick="closeModal()">✕</button></div>
  <div class="m-body two">
    <section class="pet-panel">
      <div class="pet-stage" onclick="doPet('${s.id}')" title="쓰다듬기">${petHtml(pet, 'xl')}</div>
      <input class="pet-name-input" value="${esc(pet.name)}" placeholder="펫 이름 짓기 ✏️" maxlength="12" onchange="renamePet('${s.id}',this.value)">
      <div class="muted">${petTitle(pet)}</div>
      <div class="stat"><span>성장</span>${bar(pr.pct)}<small>${pr.text}</small></div>
      <div class="stat"><span>포만감</span>${bar(full, full < 30 ? 'warn' : 'food')}<small>${full}/100 ${full < 30 ? '· 배고파요!' : ''}</small></div>
      <button class="btn ${petted ? '' : 'primary'}" ${petted ? 'disabled' : ''} onclick="doPet('${s.id}')">${petted ? '오늘은 이미 쓰다듬었어요' : `🤚 쓰다듬기 (+${PET_XP} XP)`}</button>
    </section>
    <section>
      <div class="wallet">
        <div class="big-bal ${s.balance < 0 ? 'neg' : ''}">${coin(s.balance)}</div>
        <small class="muted">누적 획득 ${coin(s.earned)} · 일급 ${coin(wageOf(s))}${paidToday(s) ? ' (오늘 지급됨)' : ''}</small>
      </div>
      <div class="row quick">
        ${[1, 3, 5].map((n) => `<button class="btn good sm" onclick="quickReward('${s.id}',${n})">+${n}</button>`).join('')}
        ${[1, 3, 5].map((n) => `<button class="btn bad sm" onclick="quickReward('${s.id}',-${n})">−${n}</button>`).join('')}
      </div>
      <h3>🎒 가방 <small class="muted">${s.inventory.length}개</small></h3>
      <div class="inv">
        ${
          Object.values(groups)
            .map((g) => {
              const it = g[0];
              const t = ITEM_TYPES[it.type] || ITEM_TYPES.coupon;
              const wearing = it.type === 'acc' && pet.acc === it.emoji;
              return `<div class="inv-item">
                <span class="inv-emoji">${esc(it.emoji)}</span>
                <span class="inv-name">${esc(it.name)}${g.length > 1 ? ` <b>×${g.length}</b>` : ''}${it.type === 'food' ? `<small class="muted"> +${it.xp}XP</small>` : ''}</span>
                <button class="btn sm ${wearing ? '' : 'primary'}" onclick="useItem('${s.id}','${it.uid}')">${wearing ? '벗기' : t.action}</button>
              </div>`;
            })
            .join('') || '<p class="muted">가방이 비어 있어요.</p>'
        }
      </div>
      <button class="btn" onclick="goShop('${s.id}')">🛒 마켓에서 쇼핑하기</button>
      <h3>📜 최근 기록</h3>
      <ul class="mini-log">
        ${recent.map((e) => `<li class="${e.undone ? 'undone' : ''}"><span>${LOG_KINDS[e.kind].icon} ${esc(e.note)}</span><span class="${e.amt > 0 ? 'plus' : e.amt < 0 ? 'minus' : ''}">${e.amt ? (e.amt > 0 ? '+' : '') + e.amt : ''}</span></li>`).join('') || '<li class="muted">기록이 없어요.</li>'}
      </ul>
    </section>
  </div>`;
}

function quickReward(id, amt) {
  const s = getStudent(id);
  const kind = amt > 0 ? 'bonus' : 'penalty';
  const real = changeBalance(s, amt, kind, amt > 0 ? '추가 보상' : '차감');
  save();
  render();
  toast(`${s.name}: ${real > 0 ? '+' : ''}${real} ${state.settings.currency}`, amt > 0 ? 'good' : 'bad');
  showEvolutions();
}

function doPet(id) {
  const s = getStudent(id);
  if (!petPet(s)) return toast('오늘은 이미 쓰다듬었어요. 내일 또 만나요!');
  render();
  const stage = document.querySelector('.pet-stage');
  if (stage) {
    const h = document.createElement('span');
    h.className = 'heart';
    h.textContent = '💖';
    stage.appendChild(h);
    setTimeout(() => h.remove(), 1000);
  }
  toast(`${s.pet.name || s.name + '의 펫'}이(가) 좋아해요! +${PET_XP} XP`, 'good');
  showEvolutions();
}

function renamePet(id, name) {
  getStudent(id).pet.name = name.trim().slice(0, 12);
  save();
  render();
}

function useItem(sid, invUid) {
  const s = getStudent(sid);
  const inv = s.inventory.find((x) => x.uid === invUid);
  if (!inv) return;
  if (inv.type === 'coupon' && !confirm(`${inv.emoji} ${inv.name} 쿠폰을 사용할까요? 사용하면 사라져요.`)) return;
  useInventory(s, invUid);
  render();
  if (inv.type === 'food') toast(`${inv.emoji} 냠냠! +${inv.xp} XP`, 'good');
  if (inv.type === 'coupon') toast(`${s.name}: ${inv.emoji} ${inv.name} 사용 완료`, 'good');
  showEvolutions();
}

function goShop(id) {
  ui.buyer = id;
  ui.modal = null;
  switchView('market');
}

/* 진화 축하 */

function showEvolutions() {
  if (!pendingEvolutions.length) return;
  const evs = pendingEvolutions;
  pendingEvolutions = [];
  ui.modal = { type: 'evolve', evs };
  renderModal();
}

function evolveModal() {
  return `
  <div class="evolve">
    <div class="confetti">🎉</div>
    ${ui.modal.evs
      .map((ev) => {
        const s = getStudent(ev.sid);
        if (!s) return '';
        const hatched = ev.to === 1;
        return `<div class="ev-item">
          ${petHtml(s.pet, 'xl')}
          <h2>${hatched ? `${esc(s.name)}의 알이 부화했어요!` : `${esc(s.pet.name || s.name + '의 펫')}이(가) 진화했어요!`}</h2>
          <p>${petTitle(s.pet)}</p>
        </div>`;
      })
      .join('')}
    <button class="btn primary big" onclick="closeModal()">축하해요! 🎊</button>
  </div>`;
}

/* 학급 마켓 */

function renderMarket() {
  if (!state.students.length) return emptyState();
  const buyer = getStudent(ui.buyer);
  const cats = [['all', '전체', '🛍️'], ...Object.entries(ITEM_TYPES).map(([k, v]) => [k, v.label, v.icon])];
  const items = state.items.filter((it) => ui.marketCat === 'all' || it.type === ui.marketCat);
  return `
  <div class="toolbar">
    <label class="buyer">구매자
      <select onchange="ui.buyer=this.value;render()">
        <option value="">— 학생 선택 —</option>
        ${sortedStudents().map((s) => `<option value="${s.id}" ${s.id === ui.buyer ? 'selected' : ''}>${label(s)} (${s.balance})</option>`).join('')}
      </select>
    </label>
    ${buyer ? `<span class="buyer-bal">${petHtml(buyer.pet)} 잔액 <b>${coin(buyer.balance)}</b></span><button class="btn ghost sm" onclick="openStudent('${buyer.id}')">🎒 가방 보기</button>` : '<span class="muted">먼저 구매할 학생을 고르세요.</span>'}
  </div>
  <div class="cats">
    ${cats.map(([k, t, i]) => `<button class="chip ${ui.marketCat === k ? 'on' : ''}" onclick="ui.marketCat='${k}';render()">${i} ${t}</button>`).join('')}
  </div>
  <div class="grid shop">
    ${
      items
        .map((it) => {
          const soldOut = it.stock !== null && it.stock <= 0;
          const poor = buyer && buyer.balance < it.price;
          return `<div class="card item ${soldOut ? 'soldout' : ''}">
            <span class="tag">${ITEM_TYPES[it.type]?.label || ''}</span>
            <div class="item-emoji">${esc(it.emoji)}</div>
            <div class="name">${esc(it.name)}</div>
            <div class="muted desc">${esc(it.desc)}</div>
            <div class="price">${coin(it.price)}</div>
            <div class="muted sm">${it.stock === null ? '재고 무제한' : soldOut ? '품절' : `남은 수량 ${it.stock}개`}</div>
            <button class="btn primary" ${!buyer || soldOut || poor ? 'disabled' : ''} onclick="buy('${it.id}')">${soldOut ? '품절' : poor ? '잔액 부족' : '구매'}</button>
          </div>`;
        })
        .join('') || '<p class="muted">상품이 없어요. 설정 → 마켓 상품에서 추가하세요.</p>'
    }
  </div>`;
}

function buy(itemId) {
  const s = getStudent(ui.buyer);
  const it = state.items.find((x) => x.id === itemId);
  if (!s || !it) return;
  if (!confirm(`${s.name} 학생이 ${it.emoji} ${it.name}을(를) ${it.price} ${state.settings.currency}에 살까요?`)) return;
  const err = buyItem(s, it);
  if (err) return toast(err, 'bad');
  render();
  toast(`${s.name}: ${it.emoji} ${it.name} 구매 완료! 가방에 들어갔어요.`, 'good');
}

/* 기록 */

function filteredLog() {
  return state.log.filter((e) => (!ui.logSid || e.sid === ui.logSid) && (!ui.logKind || e.kind === ui.logKind));
}

function renderLog() {
  const list = filteredLog().slice(0, 300);
  return `
  <div class="toolbar">
    <select onchange="ui.logSid=this.value;render()">
      <option value="">전체 학생</option>
      ${sortedStudents().map((s) => `<option value="${s.id}" ${s.id === ui.logSid ? 'selected' : ''}>${label(s)}</option>`).join('')}
    </select>
    <select onchange="ui.logKind=this.value;render()">
      <option value="">전체 종류</option>
      ${Object.entries(LOG_KINDS).map(([k, v]) => `<option value="${k}" ${k === ui.logKind ? 'selected' : ''}>${v.icon} ${v.label}</option>`).join('')}
    </select>
    <div class="spacer"></div>
    <button class="btn ghost" onclick="exportCsv()">⬇️ CSV 내보내기</button>
  </div>
  <div class="panel">
    <table class="log">
      <thead><tr><th>시간</th><th>학생</th><th>종류</th><th>내용</th><th class="r">금액</th><th></th></tr></thead>
      <tbody>
        ${
          list
            .map(
              (e) => `<tr class="${e.undone ? 'undone' : ''}">
              <td>${fmtTime(e.ts)}</td>
              <td>${esc(getStudent(e.sid)?.name || e.name)}</td>
              <td>${LOG_KINDS[e.kind].icon} ${LOG_KINDS[e.kind].label}</td>
              <td>${esc(e.note)}${e.xp ? ` <small class="muted">+${e.xp}XP</small>` : ''}</td>
              <td class="r ${e.amt > 0 ? 'plus' : e.amt < 0 ? 'minus' : ''}">${e.amt ? (e.amt > 0 ? '+' : '') + e.amt : '-'}</td>
              <td class="r">${e.undone ? '<small>취소됨</small>' : UNDOABLE.includes(e.kind) ? `<button class="btn ghost sm" onclick="undo('${e.id}')">되돌리기</button>` : ''}</td>
            </tr>`,
            )
            .join('') || '<tr><td colspan="6" class="muted center">기록이 없어요.</td></tr>'
        }
      </tbody>
    </table>
  </div>`;
}

function undo(id) {
  if (!confirm('이 기록을 되돌릴까요? 잔액과 펫 경험치가 원래대로 돌아가요.')) return;
  if (undoLog(id)) {
    render();
    toast('되돌렸어요.');
  }
}

function exportCsv() {
  const rows = [['시간', '번호', '학생', '종류', '내용', '금액', '경험치', '취소']];
  filteredLog().forEach((e) => {
    const s = getStudent(e.sid);
    rows.push([new Date(e.ts).toLocaleString('ko-KR'), s?.number || '', s?.name || e.name, LOG_KINDS[e.kind].label, e.note, e.amt, e.xp || 0, e.undone ? 'Y' : '']);
  });
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  download(`에그보드_기록_${todayKey()}.csv`, '﻿' + csv, 'text/csv');
}

/* ---------- 설정 ---------- */

function renderSettings() {
  const tabs = [
    ['basic', '🏫 기본'],
    ['students', '👩‍🎓 학생'],
    ['jobs', '💼 직업·일급'],
    ['reasons', '⭐ 보상 사유'],
    ['items', '🛒 마켓 상품'],
    ['backup', '💾 백업'],
  ];
  const body = {
    basic: settingsBasic,
    students: settingsStudents,
    jobs: settingsJobs,
    reasons: settingsReasons,
    items: settingsItems,
    backup: settingsBackup,
  }[ui.settingsTab]();
  return `<div class="cats">${tabs.map(([k, t]) => `<button class="chip ${ui.settingsTab === k ? 'on' : ''}" onclick="ui.settingsTab='${k}';render()">${t}</button>`).join('')}</div>
  <div class="panel settings">${body}</div>`;
}

function setSetting(key, value) {
  state.settings[key] = value;
  save();
  render();
}

function settingsBasic() {
  const st = state.settings;
  return `
  <h2>기본 설정</h2>
  <div class="form">
    <label>학급 이름 <input value="${esc(st.className)}" onchange="setSetting('className',this.value.trim()||'우리 반')"></label>
    <label>화폐 이름 <input value="${esc(st.currency)}" onchange="setSetting('currency',this.value.trim()||'코인')"></label>
    <label>화폐 아이콘 <input value="${esc(st.coin)}" maxlength="4" onchange="setSetting('coin',this.value.trim()||'🪙')"></label>
    <label>기본 일급 <small class="muted">(직업 없는 학생)</small><input type="number" min="0" value="${st.baseWage}" onchange="setSetting('baseWage',Math.max(0,Number(this.value)||0))"></label>
    <label class="check"><input type="checkbox" ${st.allowNegative ? 'checked' : ''} onchange="setSetting('allowNegative',this.checked)"> 잔액이 마이너스(빚)가 될 수 있음 <small class="muted">— 끄면 차감 시 0에서 멈춰요</small></label>
    <label class="check"><input type="checkbox" ${st.rewardXp ? 'checked' : ''} onchange="setSetting('rewardXp',this.checked)"> 받은 ${esc(st.currency)}만큼 펫 경험치도 함께 올리기</label>
  </div>`;
}

function settingsStudents() {
  return `
  <h2>학생 관리 <small class="muted">${state.students.length}명</small></h2>
  <div class="bulk">
    <textarea id="bulkNames" rows="4" placeholder="한 줄에 한 명씩 입력하세요.&#10;1 김하늘&#10;2 이바다&#10;(번호 없이 이름만 써도 돼요)"></textarea>
    <button class="btn primary" onclick="addStudents()">학생 추가</button>
  </div>
  <table class="edit">
    <thead><tr><th>번호</th><th>이름</th><th>직업</th><th>잔액</th><th>펫</th><th></th></tr></thead>
    <tbody>
    ${sortedByNumber()
      .map(
        (s) => `<tr>
        <td><input class="w-num" value="${esc(s.number)}" onchange="updStudent('${s.id}','number',this.value.trim())"></td>
        <td><input value="${esc(s.name)}" onchange="updStudent('${s.id}','name',this.value.trim())"></td>
        <td><select onchange="updStudent('${s.id}','jobId',this.value)">
          <option value="">— 없음 (기본 ${state.settings.baseWage}) —</option>
          ${state.jobs.map((j) => `<option value="${j.id}" ${s.jobId === j.id ? 'selected' : ''}>${esc(j.emoji)} ${esc(j.name)} (${j.wage})</option>`).join('')}
        </select></td>
        <td><input class="w-num" type="number" value="${s.balance}" title="직접 수정" onchange="setBalance('${s.id}',this.value)"></td>
        <td>${petEmoji(s.pet)} <button class="btn ghost sm" onclick="resetPet('${s.id}')">새 알</button></td>
        <td><button class="btn ghost sm danger" onclick="removeStudent('${s.id}')">삭제</button></td>
      </tr>`,
      )
      .join('')}
    </tbody>
  </table>`;
}

function sortedByNumber() {
  const prev = ui.sort;
  ui.sort = 'number';
  const list = sortedStudents();
  ui.sort = prev;
  return list;
}

function parseNames(text) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = l.match(/^(\d+)[\s.,)번]*(.+)$/);
      return m ? { number: m[1], name: m[2].trim() } : { number: '', name: l };
    });
}

function addStudents() {
  const rows = parseNames($('#bulkNames').value);
  if (!rows.length) return toast('이름을 입력해 주세요.', 'bad');
  let next = Math.max(0, ...state.students.map((s) => Number(s.number) || 0));
  rows.forEach((r) => state.students.push(newStudent(r.name, r.number || String(++next))));
  save();
  render();
  toast(`${rows.length}명을 추가했어요. 모두에게 알 🥚 지급!`, 'good');
}

function loadSampleStudents() {
  const names = ['김하늘', '이바다', '박구름', '최별', '정햇살', '강솔', '조은비', '윤나래', '장보람', '임새벽', '한결', '오로라'];
  names.forEach((n, i) => state.students.push(newStudent(n, String(i + 1))));
  state.students.slice(0, state.jobs.length).forEach((s, i) => (s.jobId = state.jobs[i].id));
  save();
  switchView('board');
  toast('예시 학생 12명을 추가했어요.', 'good');
}

function updStudent(id, field, value) {
  const s = getStudent(id);
  if (!s || (field === 'name' && !value)) return render();
  s[field] = value;
  save();
}

function setBalance(id, value) {
  const s = getStudent(id);
  const v = Math.round(Number(value));
  if (!s || Number.isNaN(v) || v === s.balance) return;
  const diff = v - s.balance;
  s.balance = v;
  addLog(s, diff > 0 ? 'bonus' : 'penalty', diff, '교사 직접 수정');
  save();
  toast(`${s.name}의 잔액을 ${v}(으)로 바꿨어요.`);
}

function resetPet(id) {
  const s = getStudent(id);
  if (!confirm(`${s.name}의 펫을 새 알로 바꿀까요? 지금 펫의 경험치는 사라져요.`)) return;
  s.pet = newPet();
  save();
  render();
}

function removeStudent(id) {
  const s = getStudent(id);
  if (!confirm(`${s.name} 학생을 삭제할까요? 잔액, 펫, 가방이 모두 사라져요.`)) return;
  state.students = state.students.filter((x) => x.id !== id);
  ui.selected.delete(id);
  save();
  render();
}

/* 목록 편집 공통: jobs, items, reasons.bonus, reasons.penalty */

function listOf(coll) {
  return coll === 'bonus' || coll === 'penalty' ? state.reasons[coll] : state[coll];
}

function upd(coll, id, field, value, type) {
  const o = listOf(coll).find((x) => x.id === id);
  if (!o) return;
  if (type === 'num') value = Math.max(0, Math.round(Number(value)) || 0);
  if (type === 'stock') value = value === '' ? null : Math.max(0, Math.round(Number(value)) || 0);
  o[field] = value;
  save();
  if (field === 'type') render();
}

function addRow(coll) {
  const blank = {
    jobs: { name: '새 직업', emoji: '🧑‍🔧', wage: state.settings.baseWage },
    bonus: { name: '새 보상', amt: 1 },
    penalty: { name: '새 차감', amt: 1 },
    items: { type: 'coupon', emoji: '🎁', name: '새 상품', price: 10, stock: null, xp: 0, food: 0, desc: '' },
  }[coll];
  listOf(coll).push({ id: uid(), ...blank });
  save();
  render();
}

function delRow(coll, id) {
  if (!confirm('삭제할까요?')) return;
  const list = listOf(coll);
  list.splice(
    list.findIndex((x) => x.id === id),
    1,
  );
  if (coll === 'jobs') state.students.forEach((s) => s.jobId === id && (s.jobId = ''));
  save();
  render();
}

function settingsJobs() {
  return `
  <h2>1인 1역 직업과 일급</h2>
  <p class="hint">학생에게 직업을 정해 주면 매일 직업별 일급을 받아요. 직업이 없는 학생은 기본 일급(${coin(state.settings.baseWage)})을 받아요. 학생별 직업은 '학생' 탭에서 정해요.</p>
  <table class="edit">
    <thead><tr><th>아이콘</th><th>직업 이름</th><th>일급</th><th>담당 학생</th><th></th></tr></thead>
    <tbody>
    ${state.jobs
      .map(
        (j) => `<tr>
        <td><input class="w-emoji" value="${esc(j.emoji)}" onchange="upd('jobs','${j.id}','emoji',this.value)"></td>
        <td><input value="${esc(j.name)}" onchange="upd('jobs','${j.id}','name',this.value)"></td>
        <td><input class="w-num" type="number" min="0" value="${j.wage}" onchange="upd('jobs','${j.id}','wage',this.value,'num')"></td>
        <td class="muted">${state.students.filter((s) => s.jobId === j.id).map((s) => esc(s.name)).join(', ') || '-'}</td>
        <td><button class="btn ghost sm danger" onclick="delRow('jobs','${j.id}')">삭제</button></td>
      </tr>`,
      )
      .join('')}
    </tbody>
  </table>
  <button class="btn" onclick="addRow('jobs')">+ 직업 추가</button>`;
}

function settingsReasons() {
  const table = (coll, title) => `
    <h3>${title}</h3>
    <table class="edit">
      <thead><tr><th>사유</th><th>금액</th><th></th></tr></thead>
      <tbody>
      ${state.reasons[coll]
        .map(
          (r) => `<tr>
          <td><input value="${esc(r.name)}" onchange="upd('${coll}','${r.id}','name',this.value)"></td>
          <td><input class="w-num" type="number" min="1" value="${r.amt}" onchange="upd('${coll}','${r.id}','amt',this.value,'num')"></td>
          <td><button class="btn ghost sm danger" onclick="delRow('${coll}','${r.id}')">삭제</button></td>
        </tr>`,
        )
        .join('')}
      </tbody>
    </table>
    <button class="btn" onclick="addRow('${coll}')">+ 추가</button>`;
  return `
  <h2>보상·차감 사유</h2>
  <p class="hint">학급 보드에서 학생을 선택하면 이 버튼들이 나타나요. 금액은 양수로 입력하세요.</p>
  <div class="two">${`<div>${table('bonus', '⭐ 보상 (+)')}</div><div>${table('penalty', '⚠️ 차감 (−)')}</div>`}</div>`;
}

function settingsItems() {
  return `
  <h2>마켓 상품</h2>
  <p class="hint">재고를 비워 두면 무제한이에요. <b>펫 먹이</b>는 경험치/포만감을, <b>펫 꾸미기</b>는 펫에게 씌울 수 있는 아이템, <b>학급 쿠폰</b>은 사용하면 기록에 남는 특권이에요.</p>
  <div class="table-wrap">
  <table class="edit">
    <thead><tr><th>아이콘</th><th>이름</th><th>종류</th><th>가격</th><th>재고</th><th>XP</th><th>포만감</th><th>설명</th><th></th></tr></thead>
    <tbody>
    ${state.items
      .map(
        (it) => `<tr>
        <td><input class="w-emoji" value="${esc(it.emoji)}" onchange="upd('items','${it.id}','emoji',this.value)"></td>
        <td><input value="${esc(it.name)}" onchange="upd('items','${it.id}','name',this.value)"></td>
        <td><select onchange="upd('items','${it.id}','type',this.value)">
          ${Object.entries(ITEM_TYPES).map(([k, v]) => `<option value="${k}" ${it.type === k ? 'selected' : ''}>${v.icon} ${v.label}</option>`).join('')}
        </select></td>
        <td><input class="w-num" type="number" min="0" value="${it.price}" onchange="upd('items','${it.id}','price',this.value,'num')"></td>
        <td><input class="w-num" type="number" min="0" value="${it.stock ?? ''}" placeholder="∞" onchange="upd('items','${it.id}','stock',this.value,'stock')"></td>
        <td><input class="w-num" type="number" min="0" value="${it.xp || 0}" ${it.type === 'food' ? '' : 'disabled'} onchange="upd('items','${it.id}','xp',this.value,'num')"></td>
        <td><input class="w-num" type="number" min="0" value="${it.food || 0}" ${it.type === 'food' ? '' : 'disabled'} onchange="upd('items','${it.id}','food',this.value,'num')"></td>
        <td><input value="${esc(it.desc)}" onchange="upd('items','${it.id}','desc',this.value)"></td>
        <td><button class="btn ghost sm danger" onclick="delRow('items','${it.id}')">삭제</button></td>
      </tr>`,
      )
      .join('')}
    </tbody>
  </table>
  </div>
  <button class="btn" onclick="addRow('items')">+ 상품 추가</button>`;
}

function settingsBackup() {
  return `
  <h2>백업과 초기화</h2>
  <p class="hint">모든 데이터는 <b>이 브라우저</b>에만 저장돼요. 다른 컴퓨터로 옮기거나 혹시 모를 상황에 대비해 주기적으로 백업 파일을 저장하세요.</p>
  <div class="row">
    <button class="btn primary" onclick="exportJson()">💾 백업 파일 저장</button>
    <label class="btn">📂 백업 파일 불러오기<input type="file" accept="application/json,.json" hidden onchange="importJson(this.files[0])"></label>
  </div>
  <h3>새 학기 / 초기화</h3>
  <div class="row">
    <button class="btn" onclick="resetBalances()">모든 학생 잔액·기록만 초기화</button>
    <button class="btn danger" onclick="resetAll()">⚠️ 전체 초기화</button>
  </div>`;
}

function download(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportJson() {
  download(`에그보드_백업_${todayKey()}.json`, JSON.stringify(state, null, 2), 'application/json');
}

function importJson(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || !Array.isArray(data.students)) throw new Error('형식 오류');
      if (!confirm(`백업(학생 ${data.students.length}명)을 불러올까요? 현재 데이터는 덮어써져요.`)) return;
      state = normalizeState(data);
      ui.selected.clear();
      save();
      render();
      toast('백업을 불러왔어요.', 'good');
    } catch (e) {
      toast('올바른 에그보드 백업 파일이 아니에요.', 'bad');
    }
  };
  reader.readAsText(file);
}

function resetBalances() {
  if (!confirm('모든 학생의 잔액, 가방, 기록을 지울까요? (학생 명단, 펫, 상품은 유지)')) return;
  state.students.forEach((s) => {
    s.balance = 0;
    s.earned = 0;
    s.inventory = [];
    s.pet.acc = null;
  });
  state.log = [];
  state.wageDays = {};
  save();
  render();
  toast('초기화했어요.');
}

function resetAll() {
  if (!confirm('정말 모든 데이터를 지울까요? 되돌릴 수 없어요.')) return;
  if (!confirm('마지막 확인: 백업은 하셨나요? 전체 초기화합니다.')) return;
  state = defaultState();
  ui.selected.clear();
  save();
  switchView('board');
}

/* ---------- 모달·토스트 ---------- */

function renderModal() {
  const wrap = $('#modal');
  const m = ui.modal;
  const html = m ? { wage: wageModal, student: studentModal, evolve: evolveModal }[m.type]() : '';
  if (!html) {
    ui.modal = null;
    wrap.classList.add('hidden');
    return;
  }
  const card = $('#modalCard');
  const scroll = card.scrollTop;
  card.className = `modal-card ${m.type}`;
  card.innerHTML = html;
  card.scrollTop = scroll;
  wrap.classList.remove('hidden');
}

function closeModal() {
  ui.modal = null;
  render();
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  const box = $('#toasts');
  box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3000);
}

/* ---------- 시작 ---------- */

document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));
$('#modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal') closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ui.modal) closeModal();
});
window.addEventListener('storage', (e) => {
  if (e.key === STORE_KEY) {
    state = loadState();
    render();
  }
});

const initial = location.hash.slice(1);
if (['board', 'pets', 'market', 'log', 'settings'].includes(initial)) ui.view = initial;
render();
