// 에그보드 화면 렌더링과 이벤트 처리
// role: 'teacher'(교사) | 'student'(학생, 개인 코드 접속) | null(로그인 전)
// api : backend.js 의 localBackend / teacherBackend / studentBackend 중 하나

const ui = {
  view: 'board',
  selected: new Set(),
  sort: 'number',
  buyer: '',
  marketCat: 'all',
  marketTab: 'shop',
  logSid: '',
  logKind: '',
  settingsTab: 'basic',
  loginTab: 'student',
  modal: null,
};

let role = null;
let api = null;
let busy = false;
let pendingEvolutions = [];

const TEACHER_TABS = [
  ['board', '🏫 학급 보드'],
  ['pets', '🐣 펫 마을'],
  ['market', '🛒 학급 마켓'],
  ['log', '📜 기록'],
  ['settings', '⚙️ 설정'],
];
const STUDENT_TABS = [
  ['me', '🐣 내 펫'],
  ['pets', '🏡 펫 마을'],
  ['market', '🛒 마켓'],
  ['log', '📜 내 기록'],
];

const $ = (sel) => document.querySelector(sel);

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const coin = (n) => `${esc(state.settings.coin)} ${Number(n).toLocaleString('ko-KR')}`;
const label = (s) => `${s.number ? esc(s.number) + '번 ' : ''}${esc(s.name)}`;
const isStudent = () => role === 'student';
const findStudent = (id) => (isStudent() ? (state.me.id === id ? state.me : null) : getStudent(id));
const pendingRequests = () =>
  isStudent() ? [] : state.students.flatMap((s) => s.inventory.filter((v) => v.status === 'requested').map((v) => ({ s, v })));

function fmtTime(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function sortedStudents(sort = ui.sort) {
  const by = {
    number: (a, b) => (Number(a.number) || 999) - (Number(b.number) || 999) || a.name.localeCompare(b.name, 'ko'),
    name: (a, b) => a.name.localeCompare(b.name, 'ko'),
    balance: (a, b) => b.balance - a.balance,
    xp: (a, b) => b.pet.xp - a.pet.xp,
  };
  return [...state.students].sort(by[sort] || by.number);
}

/* ---------- 서버 호출 공통 처리 ---------- */

function petStages() {
  const list = isStudent() ? [state.me] : state.students;
  return new Map(list.map((s) => [s.id, stageIndex(s.pet.xp)]));
}

function collectEvolutions(before) {
  (isStudent() ? [state.me] : state.students).forEach((s) => {
    const was = before.get(s.id);
    const now = stageIndex(s.pet.xp);
    if (was !== undefined && now > was) pendingEvolutions.push({ sid: s.id, to: now });
  });
}

// 데이터를 바꾸는 동작: 실행 → 최신 데이터 다시 불러오기 → 화면 갱신 → 진화 축하
async function act(fn) {
  if (busy) return { ok: false };
  busy = true;
  document.body.classList.add('busy');
  const before = petStages();
  let res = { ok: true };
  try {
    res.value = await fn();
    await api.load();
  } catch (e) {
    console.error(e);
    res = { ok: false };
    toast(e.message || '문제가 생겼어요.', 'bad');
    await api.load().catch(() => {});
  } finally {
    busy = false;
    document.body.classList.remove('busy');
  }
  collectEvolutions(before);
  render();
  showEvolutions();
  return res;
}

// 설정 표 편집처럼 입력 중인 화면을 다시 그리지 않고 조용히 저장
async function persist(fn, rerender = false) {
  try {
    await fn();
    if (rerender) render();
  } catch (e) {
    toast(e.message || '저장하지 못했어요.', 'bad');
    await api.load().catch(() => {});
    render();
  }
}

/* ---------- 공통 조각 ---------- */

function petHtml(pet, size = '') {
  const hungry = fullnessNow(pet) < 30;
  return `<span class="pet ${size} ${hungry ? 'hungry' : ''}">
    <span class="pet-body">${petEmoji(pet)}</span>
    ${pet.acc ? `<span class="pet-acc">${esc(pet.acc)}</span>` : ''}
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

function tabsFor() {
  if (!role) return [];
  return isStudent() ? STUDENT_TABS : TEACHER_TABS;
}

function render() {
  const className = state.settings.className;
  $('#className').textContent = role ? className : '에그보드';
  document.title = role ? `${className} · 에그보드` : '에그보드 · 학급 경영';

  const reqs = pendingRequests().length;
  $('#tabs').innerHTML = tabsFor()
    .map(
      ([v, t]) =>
        `<button class="${ui.view === v ? 'active' : ''}" onclick="switchView('${v}')">${t}${v === 'market' && reqs ? ` <span class="badge">${reqs}</span>` : ''}</button>`,
    )
    .join('');
  $('#userBox').innerHTML = userBoxHtml();

  const views = {
    board: renderBoard,
    pets: renderPets,
    market: isStudent() ? renderStudentMarket : renderMarket,
    log: isStudent() ? renderStudentLog : renderLog,
    settings: renderSettings,
    me: renderMe,
  };
  $('#view').innerHTML = role ? (views[ui.view] || views[tabsFor()[0][0]])() : renderLogin();
  renderActionBar();
  renderModal();
}

function userBoxHtml() {
  if (!ONLINE) return '<span class="pill" title="Supabase를 연결하면 학생이 각자 기기에서 접속할 수 있어요">💻 체험 모드 · 이 브라우저에만 저장</span>';
  if (isStudent()) return `<span class="pill">🙋 ${label(state.me)}</span><button class="btn ghost sm" onclick="logout()">나가기</button>`;
  if (role === 'teacher') return `<span class="pill">🧑‍🏫 선생님</span><button class="btn ghost sm" onclick="logout()">로그아웃</button>`;
  return '';
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

/* ---------- 로그인 ---------- */

function renderLogin() {
  if (!sb) {
    return `<div class="empty"><div class="empty-egg">⚠️</div><h2>서버에 연결할 수 없어요</h2>
      <p>인터넷 연결을 확인하고 새로고침해 주세요.</p></div>`;
  }
  const codeFromUrl = new URLSearchParams(location.search).get('code') || '';
  const tab = (k, t) => `<button class="${ui.loginTab === k ? 'active' : ''}" onclick="ui.loginTab='${k}';render()">${t}</button>`;
  return `<div class="login">
    <div class="login-card">
      <div class="empty-egg">🥚</div>
      <h1>에그보드</h1>
      <div class="login-tabs">${tab('student', '🙋 학생')}${tab('teacher', '🧑‍🏫 선생님')}</div>
      ${
        ui.loginTab === 'student'
          ? `<form onsubmit="event.preventDefault();loginStudent()">
              <p class="muted">선생님께 받은 <b>나의 코드</b>를 입력하세요.</p>
              <input id="codeInput" class="code-input" value="${esc(codeFromUrl)}" placeholder="예: K7QX3M" maxlength="12" autocomplete="off" autocapitalize="characters" spellcheck="false" required>
              <button class="btn primary big" type="submit">들어가기</button>
            </form>`
          : `<form onsubmit="event.preventDefault();loginTeacher(false)">
              <input id="emailInput" type="email" placeholder="이메일" autocomplete="username" required>
              <input id="pwInput" type="password" placeholder="비밀번호 (6자 이상)" autocomplete="current-password" minlength="6" required>
              <button class="btn primary big" type="submit">로그인</button>
              <button class="btn ghost" type="button" onclick="loginTeacher(true)">처음이에요 · 교사 계정 만들기</button>
            </form>`
      }
    </div>
  </div>`;
}

async function loginStudent() {
  const code = $('#codeInput').value.trim();
  if (!code || busy) return;
  busy = true;
  try {
    await auth.studentLogin(code);
    role = 'student';
    api = studentBackend;
    ui.view = 'me';
    history.replaceState(null, '', location.pathname + '#me');
    render();
    toast(`${state.me.name}, 반가워요! 👋`, 'good');
  } catch (e) {
    toast(e.message, 'bad');
  } finally {
    busy = false;
  }
}

async function loginTeacher(signUp) {
  const email = $('#emailInput').value.trim();
  const pw = $('#pwInput').value;
  if (!email || pw.length < 6) return toast('이메일과 6자 이상의 비밀번호를 입력해 주세요.', 'bad');
  if (busy) return;
  busy = true;
  try {
    if (signUp) {
      const ready = await auth.teacherSignUp(email, pw);
      if (!ready) {
        toast('가입 확인 메일을 보냈어요. 메일의 링크를 누른 뒤 로그인해 주세요.', 'good');
        return;
      }
    } else {
      await auth.teacherLogin(email, pw);
    }
    role = 'teacher';
    api = teacherBackend;
    ui.view = 'board';
    render();
  } catch (e) {
    toast(e.message === 'Invalid login credentials' ? '이메일 또는 비밀번호가 맞지 않아요.' : e.message, 'bad');
  } finally {
    busy = false;
  }
}

async function logout() {
  await auth.logout();
  role = null;
  api = null;
  ui.modal = null;
  ui.selected.clear();
  state = defaultState();
  history.replaceState(null, '', location.pathname);
  render();
}

/* ---------- 교사: 학급 보드 ---------- */

function renderBoard() {
  if (!state.students.length) return emptyState();
  const paid = state.students.filter(paidToday).length;
  const reqs = pendingRequests().length;
  return `
  <div class="toolbar">
    <button class="btn primary big" onclick="openWage()">💰 오늘 일급 지급</button>
    <span class="pill ${paid === state.students.length ? 'ok' : ''}">오늘 ${paid}/${state.students.length}명 지급</span>
    ${reqs ? `<button class="pill warn" onclick="ui.marketTab='requests';switchView('market')">📬 쿠폰 사용 요청 ${reqs}건</button>` : ''}
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
  const actionBar = $('#actionbar');
  const n = ui.selected.size;
  const show = role === 'teacher' && ui.view === 'board' && n > 0;
  actionBar.classList.toggle('hidden', !show);
  document.body.classList.toggle('has-actionbar', show);
  if (!show) return;
  const chips = (kind, sign) =>
    state.reasons[kind]
      .map((r) => `<button class="chip ${kind}" onclick="applyReward(${sign},${r.amt},'${r.id}')">${sign > 0 ? '+' : '−'}${r.amt} ${esc(r.name)}</button>`)
      .join('');
  actionBar.innerHTML = `
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

async function applyReward(sign, amt, reasonId, customNote) {
  const ids = [...ui.selected];
  if (!ids.length) return;
  const kind = sign > 0 ? 'bonus' : 'penalty';
  const reason = state.reasons[kind].find((r) => r.id === reasonId);
  const note = reason ? reason.name : customNote || (sign > 0 ? '추가 보상' : '차감');
  ui.selected.clear();
  const res = await act(() => api.reward(ids, sign * amt, note));
  if (!res.ok) return;
  flashCards(ids, `${sign > 0 ? '+' : '−'}${amt}`, sign > 0 ? 'up' : 'down');
  toast(`${ids.length}명에게 ${sign > 0 ? '+' : '−'}${amt} ${state.settings.currency} · ${note}`, sign > 0 ? 'good' : 'bad');
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

async function confirmWage() {
  const ids = [...ui.modal.checked];
  const again = ids.filter((id) => paidToday(getStudent(id))).length;
  if (again && !confirm(`${again}명은 오늘 이미 일급을 받았어요. 한 번 더 지급할까요?`)) return;
  ui.modal = null;
  const res = await act(() => api.payWage(ids));
  if (!res.ok) return;
  flashCards(ids, '💰', 'up');
  toast(`${ids.length}명에게 일급 ${coin(res.value)} 지급 완료!`, 'good');
}

/* ---------- 펫 마을 (교사·학생 공용) ---------- */

function renderPets() {
  if (!state.students.length) return emptyState();
  const list = [...state.students].sort((a, b) => b.pet.xp - a.pet.xp);
  const myId = isStudent() ? state.me.id : '';
  return `
  <details class="panel rules">
    <summary><h2>🐣 펫 키우기 규칙</h2></summary>
    <ul>
      <li>모든 학생은 <b>정체불명의 알</b>을 하나씩 받아요. 어떤 펫이 나올지는 부화할 때까지 비밀!</li>
      <li>${state.settings.rewardXp ? `보상으로 받은 ${esc(state.settings.currency)}만큼 펫 경험치가 올라요.` : '마켓에서 먹이를 사서 먹이면 경험치가 올라요.'} 마켓의 <b>먹이</b>를 먹이면 더 빨리 자라요.</li>
      <li>하루 한 번 <b>쓰다듬기</b>로 경험치 +${PET_XP}. 먹이를 오래 안 주면 배가 고파져요 💧</li>
      <li>성장 단계: ${STAGES.map((s) => `${s.name}(${s.xp})`).join(' → ')}</li>
    </ul>
    <div class="species">${PET_SPECIES.map((p) => `<span title="${esc(p.name)}">🥚→${p.forms.join('→')}</span>`).join('')}</div>
  </details>
  <div class="grid pets-grid">
    ${list
      .map((s, i) => {
        const pr = xpProgress(s.pet);
        const click = isStudent() ? (s.id === myId ? `switchView('me')` : '') : `openStudent('${s.id}')`;
        return `<div class="card pet-card ${s.id === myId ? 'mine' : ''}" ${click ? `onclick="${click}"` : ''}>
          ${i < 3 && s.pet.xp > 0 ? `<span class="rank">${['🥇', '🥈', '🥉'][i]}</span>` : ''}
          ${s.id === myId ? '<span class="me-tag">나</span>' : ''}
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

/* ---------- 학생 상세 (교사 모달 · 학생 '내 펫' 화면 공용) ---------- */

function openStudent(id) {
  ui.modal = { type: 'student', id };
  renderModal();
}

function studentModal() {
  const s = getStudent(ui.modal.id);
  if (!s) return '';
  return `<div class="m-head"><h2>${label(s)}</h2><button class="x" onclick="closeModal()">✕</button></div>
    <div class="m-body">${studentDetailHtml(s)}</div>`;
}

function renderMe() {
  const s = state.me;
  return `<div class="me-head">
      <h2>안녕, ${esc(s.name)}! 👋</h2>
      ${state.settings.marketOpen ? '' : '<span class="pill">🔒 지금은 마켓이 닫혀 있어요</span>'}
      <button class="btn ghost sm" onclick="refreshNow()">🔄 새로고침</button>
    </div>
    <div class="panel">${studentDetailHtml(s)}</div>`;
}

function couponButtons(s, it) {
  if (isStudent()) {
    return it.status === 'requested'
      ? `<span class="pill warn">선생님 확인 중</span><button class="btn ghost sm" onclick="cancelRequest('${s.id}','${it.uid}')">요청 취소</button>`
      : `<button class="btn sm primary" onclick="useItem('${s.id}','${it.uid}')">사용 요청</button>`;
  }
  return it.status === 'requested'
    ? `<span class="pill warn">사용 요청</span><button class="btn sm good" onclick="resolveCoupon('${it.uid}',true)">승인</button><button class="btn sm ghost" onclick="resolveCoupon('${it.uid}',false)">거절</button>`
    : `<button class="btn sm primary" onclick="useItem('${s.id}','${it.uid}')">사용</button>`;
}

function studentDetailHtml(s) {
  const pet = s.pet;
  const pr = xpProgress(pet);
  const full = fullnessNow(pet);
  const petted = pet.pettedOn === todayKey();
  const groups = {};
  s.inventory.forEach((inv) => {
    const key = `${inv.type}|${inv.emoji}|${inv.name}|${inv.status || 'owned'}`;
    (groups[key] ||= []).push(inv);
  });
  const recent = (isStudent() ? state.log : state.log.filter((e) => e.sid === s.id)).slice(0, 8);
  return `
  <div class="two">
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
        <small class="muted">누적 획득 ${coin(s.earned)} · 일급 ${coin(wageOf(s))}${paidToday(s) ? ' (오늘 받음)' : ''}</small>
      </div>
      ${
        isStudent()
          ? ''
          : `<div class="row quick">
        ${[1, 3, 5].map((n) => `<button class="btn good sm" onclick="quickReward('${s.id}',${n})">+${n}</button>`).join('')}
        ${[1, 3, 5].map((n) => `<button class="btn bad sm" onclick="quickReward('${s.id}',-${n})">−${n}</button>`).join('')}
      </div>`
      }
      <h3>🎒 가방 <small class="muted">${s.inventory.length}개</small></h3>
      <div class="inv">
        ${
          Object.values(groups)
            .map((g) => {
              const it = g[0];
              const wearing = it.type === 'acc' && pet.acc === it.emoji;
              let actions;
              if (it.type === 'food') actions = `<button class="btn sm primary" onclick="useItem('${s.id}','${it.uid}')">먹이기</button>`;
              else if (it.type === 'acc')
                actions = `<button class="btn sm ${wearing ? '' : 'primary'}" onclick="useItem('${s.id}','${it.uid}')">${wearing ? '벗기' : '착용'}</button>`;
              else actions = couponButtons(s, it);
              return `<div class="inv-item">
                <span class="inv-emoji">${esc(it.emoji)}</span>
                <span class="inv-name">${esc(it.name)}${g.length > 1 ? ` <b>×${g.length}</b>` : ''}${it.type === 'food' ? `<small class="muted"> +${it.xp}XP</small>` : ''}</span>
                ${actions}
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

async function quickReward(id, amt) {
  const s = getStudent(id);
  const before = s.balance;
  const res = await act(() => api.reward([id], amt, amt > 0 ? '추가 보상' : '차감'));
  if (!res.ok) return;
  const real = getStudent(id).balance - before;
  toast(`${s.name}: ${real > 0 ? '+' : ''}${real} ${state.settings.currency}`, amt > 0 ? 'good' : 'bad');
}

async function doPet(id) {
  const res = await act(() => api.pet(id));
  if (!res.ok) return;
  const s = findStudent(id);
  document.querySelectorAll('.pet-stage').forEach((stage) => {
    const h = document.createElement('span');
    h.className = 'heart';
    h.textContent = '💖';
    stage.appendChild(h);
    setTimeout(() => h.remove(), 1000);
  });
  toast(`${s.pet.name || s.name + '의 펫'}이(가) 좋아해요! +${PET_XP} XP`, 'good');
}

function renamePet(id, name) {
  act(() => api.renamePet(id, name.trim().slice(0, 12)));
}

async function useItem(sid, invUid) {
  const inv = findStudent(sid).inventory.find((x) => x.uid === invUid);
  if (!inv) return;
  if (inv.type === 'coupon') {
    const msg = isStudent()
      ? `${inv.emoji} ${inv.name} 쿠폰 사용을 선생님께 요청할까요?`
      : `${inv.emoji} ${inv.name} 쿠폰을 사용 처리할까요? 사용하면 사라져요.`;
    if (!confirm(msg)) return;
  }
  const res = await act(() => api.useItem(sid, invUid));
  if (!res.ok) return;
  if (inv.type === 'food') toast(`${inv.emoji} 냠냠! +${inv.xp} XP`, 'good');
  if (res.value === 'requested') toast(`${inv.emoji} ${inv.name} 사용을 요청했어요. 선생님이 확인하면 사용돼요.`, 'good');
  else if (inv.type === 'coupon') toast(`${inv.emoji} ${inv.name} 사용 완료`, 'good');
}

async function cancelRequest(sid, invUid) {
  const res = await act(() => api.cancelRequest(sid, invUid));
  if (res.ok) toast('요청을 취소했어요.');
}

async function resolveCoupon(invUid, approve) {
  const res = await act(() => api.resolveCoupon(invUid, approve));
  if (res.ok) toast(approve ? '쿠폰 사용을 승인했어요.' : '요청을 거절했어요. 쿠폰은 학생 가방으로 돌아가요.', approve ? 'good' : '');
}

function goShop(id) {
  ui.buyer = id;
  ui.modal = null;
  ui.marketTab = 'shop';
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
        const s = findStudent(ev.sid);
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

/* ---------- 학급 마켓 ---------- */

function itemCardHtml(it, buyer) {
  const soldOut = it.stock !== null && it.stock <= 0;
  const poor = buyer && buyer.balance < it.price;
  const closed = isStudent() && !state.settings.marketOpen;
  return `<div class="card item ${soldOut ? 'soldout' : ''}">
    <span class="tag">${ITEM_TYPES[it.type]?.label || ''}</span>
    <div class="item-emoji">${esc(it.emoji)}</div>
    <div class="name">${esc(it.name)}</div>
    <div class="muted desc">${esc(it.desc)}</div>
    <div class="price">${coin(it.price)}</div>
    <div class="muted sm">${it.stock === null ? '재고 무제한' : soldOut ? '품절' : `남은 수량 ${it.stock}개`}</div>
    <button class="btn primary" ${!buyer || soldOut || poor || closed ? 'disabled' : ''} onclick="buy('${it.id}')">${soldOut ? '품절' : closed ? '마켓 닫힘' : poor ? '잔액 부족' : '구매'}</button>
  </div>`;
}

function shopHtml(buyer) {
  const cats = [['all', '전체', '🛍️'], ...Object.entries(ITEM_TYPES).map(([k, v]) => [k, v.label, v.icon])];
  const items = state.items.filter((it) => ui.marketCat === 'all' || it.type === ui.marketCat);
  return `
  <div class="cats">
    ${cats.map(([k, t, i]) => `<button class="chip ${ui.marketCat === k ? 'on' : ''}" onclick="ui.marketCat='${k}';render()">${i} ${t}</button>`).join('')}
  </div>
  <div class="grid shop">
    ${items.map((it) => itemCardHtml(it, buyer)).join('') || '<p class="muted">상품이 없어요.</p>'}
  </div>`;
}

function renderStudentMarket() {
  const me = state.me;
  return `
  <div class="toolbar">
    <span class="buyer-bal">${petHtml(me.pet)} 내 잔액 <b>${coin(me.balance)}</b></span>
    <div class="spacer"></div>
    <button class="btn ghost sm" onclick="switchView('me')">🎒 내 가방</button>
  </div>
  ${state.settings.marketOpen ? '' : '<div class="notice">🔒 지금은 마켓이 닫혀 있어요. 선생님이 마켓을 열면 살 수 있어요.</div>'}
  ${shopHtml(me)}`;
}

function renderMarket() {
  if (!state.students.length) return emptyState();
  const reqs = pendingRequests().length;
  const tabs = [
    ['shop', '🛍️ 진열대'],
    ['manage', '🛠️ 상품 관리'],
    ['requests', `📬 쿠폰 요청${reqs ? ` <span class="badge">${reqs}</span>` : ''}`],
    ['sales', '🧾 판매 내역'],
  ];
  const body = { shop: marketShop, manage: marketManage, requests: marketRequests, sales: marketSales }[ui.marketTab]();
  return `
  <div class="toolbar">
    <div class="cats tight">${tabs.map(([k, t]) => `<button class="chip ${ui.marketTab === k ? 'on' : ''}" onclick="ui.marketTab='${k}';render()">${t}</button>`).join('')}</div>
    <div class="spacer"></div>
    <label class="switch"><input type="checkbox" ${state.settings.marketOpen ? 'checked' : ''} onchange="setMarketOpen(this.checked)"> <span>${state.settings.marketOpen ? '🟢 마켓 열림' : '🔴 마켓 닫힘'}</span></label>
  </div>
  ${body}`;
}

function setMarketOpen(open) {
  state.settings.marketOpen = open;
  act(() => api.saveSettings()).then((r) => r.ok && toast(open ? '마켓을 열었어요. 학생들이 직접 살 수 있어요.' : '마켓을 닫았어요. 학생들은 구경만 할 수 있어요.'));
}

function marketShop() {
  const buyer = getStudent(ui.buyer);
  return `
  <p class="hint">학생은 자기 기기에서 직접 살 수 있고, 여기서는 선생님이 학생 대신 살 수 있어요. 마켓을 닫아도 선생님은 대신 구매할 수 있어요.</p>
  <div class="toolbar">
    <label class="buyer">구매자
      <select onchange="ui.buyer=this.value;render()">
        <option value="">— 학생 선택 —</option>
        ${sortedStudents('number').map((s) => `<option value="${s.id}" ${s.id === ui.buyer ? 'selected' : ''}>${label(s)} (${s.balance})</option>`).join('')}
      </select>
    </label>
    ${buyer ? `<span class="buyer-bal">${petHtml(buyer.pet)} 잔액 <b>${coin(buyer.balance)}</b></span><button class="btn ghost sm" onclick="openStudent('${buyer.id}')">🎒 가방 보기</button>` : '<span class="muted">먼저 구매할 학생을 고르세요.</span>'}
  </div>
  ${shopHtml(buyer)}`;
}

async function buy(itemId) {
  const s = isStudent() ? state.me : getStudent(ui.buyer);
  const it = state.items.find((x) => x.id === itemId);
  if (!s || !it) return;
  const who = isStudent() ? '' : `${s.name} 학생이 `;
  if (!confirm(`${who}${it.emoji} ${it.name}을(를) ${it.price} ${state.settings.currency}에 살까요?`)) return;
  const res = await act(() => api.buy(s.id, it.id));
  if (res.ok) toast(`${isStudent() ? '' : s.name + ': '}${it.emoji} ${it.name} 구매 완료! 가방에 들어갔어요.`, 'good');
}

function marketManage() {
  return `
  <div class="panel">
  <h2>상품 관리</h2>
  <p class="hint">재고를 비워 두면 무제한이에요. <b>펫 먹이</b>는 경험치/포만감을, <b>펫 꾸미기</b>는 펫에게 씌울 수 있는 아이템, <b>학급 쿠폰</b>은 학생이 사용을 요청하면 선생님이 승인하는 특권이에요.</p>
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
  <button class="btn" onclick="addRow('items')">+ 상품 추가</button>
  </div>`;
}

function marketRequests() {
  const reqs = pendingRequests().sort((a, b) => a.v.requestedAt - b.v.requestedAt);
  return `<div class="panel">
    <h2>📬 쿠폰 사용 요청</h2>
    <p class="hint">학생이 가방에서 쿠폰 '사용 요청'을 누르면 여기에 나타나요. 승인하면 쿠폰이 사용 처리되고, 거절하면 학생 가방으로 돌아가요.</p>
    ${
      reqs.length
        ? `<div class="inv">${reqs
            .map(
              ({ s, v }) => `<div class="inv-item">
            <span class="inv-emoji">${esc(v.emoji)}</span>
            <span class="inv-name"><b>${label(s)}</b> · ${esc(v.name)} ${v.requestedAt ? `<small class="muted">${fmtTime(v.requestedAt)}</small>` : ''}</span>
            <button class="btn sm good" onclick="resolveCoupon('${v.uid}',true)">승인</button>
            <button class="btn sm ghost" onclick="resolveCoupon('${v.uid}',false)">거절</button>
          </div>`,
            )
            .join('')}</div>`
        : '<p class="muted">기다리는 요청이 없어요.</p>'
    }
  </div>`;
}

function marketSales() {
  const sales = state.log.filter((e) => e.kind === 'buy' || (e.kind === 'use' && e.note.endsWith('쿠폰 사용')));
  const buys = sales.filter((e) => e.kind === 'buy');
  const total = buys.reduce((t, e) => t - e.amt, 0);
  return `<div class="panel">
    <h2>🧾 판매 내역</h2>
    <p class="hint">총 ${buys.length}건 판매 · ${coin(total)}</p>
    <table class="log">
      <thead><tr><th>시간</th><th>학생</th><th>내용</th><th class="r">금액</th></tr></thead>
      <tbody>
        ${
          sales
            .slice(0, 300)
            .map(
              (e) => `<tr><td>${fmtTime(e.ts)}</td><td>${esc(getStudent(e.sid)?.name || e.name)}</td>
              <td>${e.kind === 'buy' ? '🛒 구매' : '🎟️ 사용'} ${esc(e.note)}</td>
              <td class="r ${e.amt < 0 ? 'minus' : ''}">${e.amt || '-'}</td></tr>`,
            )
            .join('') || '<tr><td colspan="4" class="muted center">판매 내역이 없어요.</td></tr>'
        }
      </tbody>
    </table>
  </div>`;
}

/* ---------- 기록 ---------- */

function filteredLog() {
  return state.log.filter((e) => (!ui.logSid || e.sid === ui.logSid) && (!ui.logKind || e.kind === ui.logKind));
}

function logRowHtml(e, withStudent, withUndo) {
  return `<tr class="${e.undone ? 'undone' : ''}">
    <td>${fmtTime(e.ts)}</td>
    ${withStudent ? `<td>${esc(getStudent(e.sid)?.name || e.name)}</td>` : ''}
    <td>${LOG_KINDS[e.kind].icon} ${LOG_KINDS[e.kind].label}</td>
    <td>${esc(e.note)}${e.xp ? ` <small class="muted">+${e.xp}XP</small>` : ''}</td>
    <td class="r ${e.amt > 0 ? 'plus' : e.amt < 0 ? 'minus' : ''}">${e.amt ? (e.amt > 0 ? '+' : '') + e.amt : '-'}</td>
    ${withUndo ? `<td class="r">${e.undone ? '<small>취소됨</small>' : UNDOABLE.includes(e.kind) ? `<button class="btn ghost sm" onclick="undo('${e.id}')">되돌리기</button>` : ''}</td>` : ''}
  </tr>`;
}

function renderLog() {
  const list = filteredLog().slice(0, 300);
  return `
  <div class="toolbar">
    <select onchange="ui.logSid=this.value;render()">
      <option value="">전체 학생</option>
      ${sortedStudents('number').map((s) => `<option value="${s.id}" ${s.id === ui.logSid ? 'selected' : ''}>${label(s)}</option>`).join('')}
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
      <tbody>${list.map((e) => logRowHtml(e, true, true)).join('') || '<tr><td colspan="6" class="muted center">기록이 없어요.</td></tr>'}</tbody>
    </table>
  </div>`;
}

function renderStudentLog() {
  return `<div class="panel">
    <h2>📜 내 기록 <small class="muted">최근 50개</small></h2>
    <table class="log">
      <thead><tr><th>시간</th><th>종류</th><th>내용</th><th class="r">금액</th></tr></thead>
      <tbody>${state.log.map((e) => logRowHtml(e, false, false)).join('') || '<tr><td colspan="4" class="muted center">기록이 없어요.</td></tr>'}</tbody>
    </table>
  </div>`;
}

async function undo(id) {
  if (!confirm('이 기록을 되돌릴까요? 잔액과 펫 경험치가 원래대로 돌아가요.')) return;
  const res = await act(() => api.undo(id));
  if (res.ok) toast('되돌렸어요.');
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

/* ---------- 설정 (교사) ---------- */

function renderSettings() {
  const tabs = [
    ['basic', '🏫 기본'],
    ['students', '👩‍🎓 학생·코드'],
    ['jobs', '💼 직업·일급'],
    ['reasons', '⭐ 보상 사유'],
    ['backup', '💾 백업'],
  ];
  const body = {
    basic: settingsBasic,
    students: settingsStudents,
    jobs: settingsJobs,
    reasons: settingsReasons,
    backup: settingsBackup,
  }[ui.settingsTab]();
  return `<div class="cats">${tabs.map(([k, t]) => `<button class="chip ${ui.settingsTab === k ? 'on' : ''}" onclick="ui.settingsTab='${k}';render()">${t}</button>`).join('')}</div>
  <p class="hint">🛒 마켓 상품은 <a href="#market" onclick="event.preventDefault();ui.marketTab='manage';switchView('market')">학급 마켓 → 상품 관리</a>에서 관리해요.</p>
  <div class="panel settings">${body}</div>`;
}

function setSetting(key, value) {
  state.settings[key] = value;
  act(() => api.saveSettings());
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
  ${
    ONLINE
      ? `<div class="notice"><span>🔑 학생마다 <b>개인 코드</b>가 자동으로 만들어져요. 학생은 이 사이트에서 코드를 입력해 자기 펫·가방·마켓에 들어올 수 있어요.</span>
          <button class="btn sm primary" onclick="openCodes()">🖨️ 코드표 인쇄</button></div>`
      : `<div class="notice"><span>💡 지금은 체험 모드라 학생 개인 코드 접속을 쓸 수 없어요. README의 <b>온라인 모드(Supabase) 설정</b>을 마치면 학생마다 코드가 발급돼요.</span></div>`
  }
  <table class="edit">
    <thead><tr><th>번호</th><th>이름</th>${ONLINE ? '<th>개인 코드</th>' : ''}<th>직업</th><th>잔액</th><th>펫</th><th></th></tr></thead>
    <tbody>
    ${sortedStudents('number')
      .map(
        (s) => `<tr>
        <td><input class="w-num" value="${esc(s.number)}" onchange="updStudent('${s.id}','number',this.value.trim())"></td>
        <td><input value="${esc(s.name)}" onchange="updStudent('${s.id}','name',this.value.trim())"></td>
        ${ONLINE ? `<td class="nowrap"><code class="code">${esc(s.code)}</code> <button class="btn ghost sm" title="코드가 친구에게 알려졌을 때" onclick="reissueCode('${s.id}')">재발급</button></td>` : ''}
        <td><select onchange="updStudent('${s.id}','jobId',this.value)">
          <option value="">— 없음 (기본 ${state.settings.baseWage}) —</option>
          ${state.jobs.map((j) => `<option value="${j.id}" ${s.jobId === j.id ? 'selected' : ''}>${esc(j.emoji)} ${esc(j.name)} (${j.wage})</option>`).join('')}
        </select></td>
        <td><input class="w-num" type="number" value="${s.balance}" title="직접 수정" onchange="setBalance('${s.id}',this.value)"></td>
        <td class="nowrap">${petEmoji(s.pet)} <button class="btn ghost sm" onclick="resetPet('${s.id}')">새 알</button></td>
        <td><button class="btn ghost sm danger" onclick="removeStudent('${s.id}')">삭제</button></td>
      </tr>`,
      )
      .join('')}
    </tbody>
  </table>`;
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

async function addStudents() {
  const rows = parseNames($('#bulkNames').value);
  if (!rows.length) return toast('이름을 입력해 주세요.', 'bad');
  let next = Math.max(0, ...state.students.map((s) => Number(s.number) || 0));
  rows.forEach((r) => (r.number ||= String(++next)));
  const res = await act(() => api.addStudents(rows));
  if (res.ok) toast(`${rows.length}명을 추가했어요. 모두에게 알 🥚 지급!`, 'good');
}

async function loadSampleStudents() {
  const names = ['김하늘', '이바다', '박구름', '최별', '정햇살', '강솔', '조은비', '윤나래', '장보람', '임새벽', '한결', '오로라'];
  const res = await act(() => api.addStudents(names.map((name, i) => ({ name, number: String(i + 1) }))));
  if (!res.ok) return;
  await act(async () => {
    for (const [i, s] of sortedStudents('number').slice(0, state.jobs.length).entries()) {
      await api.updateStudent(s.id, { jobId: state.jobs[i].id });
    }
  });
  switchView('board');
  toast('예시 학생 12명을 추가했어요.', 'good');
}

function updStudent(id, field, value) {
  const s = getStudent(id);
  if (!s || (field === 'name' && !value)) return render();
  s[field] = value;
  persist(() => api.updateStudent(id, { [field]: value }), field === 'jobId');
}

async function setBalance(id, value) {
  const s = getStudent(id);
  const v = Math.round(Number(value));
  if (!s || Number.isNaN(v) || v === s.balance) return;
  const res = await act(() => api.setBalance(id, v));
  if (res.ok) toast(`${s.name}의 잔액을 ${v}(으)로 바꿨어요.`);
}

async function resetPet(id) {
  const s = getStudent(id);
  if (!confirm(`${s.name}의 펫을 새 알로 바꿀까요? 지금 펫의 경험치는 사라져요.`)) return;
  await act(() => api.resetPet(id));
}

async function reissueCode(id) {
  const s = getStudent(id);
  if (!confirm(`${s.name}의 코드를 새로 만들까요? 예전 코드(${s.code})로는 더 이상 들어올 수 없어요.`)) return;
  const res = await act(() => api.reissueCode(id));
  if (res.ok) toast(`${s.name}의 새 코드: ${getStudent(id).code}`, 'good');
}

async function removeStudent(id) {
  const s = getStudent(id);
  if (!confirm(`${s.name} 학생을 삭제할까요? 잔액, 펫, 가방이 모두 사라져요.`)) return;
  ui.selected.delete(id);
  await act(() => api.deleteStudent(id));
}

/* 코드표 인쇄 */

function openCodes() {
  ui.modal = { type: 'codes' };
  renderModal();
}

function codesModal() {
  const url = location.origin + location.pathname;
  return `
  <div class="m-head no-print"><h2>🖨️ 학생 코드표</h2>
    <div class="row"><button class="btn primary" onclick="window.print()">인쇄하기</button><button class="x" onclick="closeModal()">✕</button></div>
  </div>
  <p class="hint no-print">잘라서 학생에게 나눠 주세요. 학생은 아래 주소에 들어가 '학생' 탭에서 코드를 입력하면 돼요.</p>
  <div class="code-cards">
    ${sortedStudents('number')
      .map(
        (s) => `<div class="code-card">
        <div class="cc-class">${esc(state.settings.className)} · 에그보드</div>
        <div class="cc-name">${label(s)}</div>
        <div class="cc-code">${esc(s.code)}</div>
        <div class="cc-url">${esc(url)}</div>
      </div>`,
      )
      .join('')}
  </div>`;
}

/* 목록 편집 공통: jobs, items, reasons.bonus, reasons.penalty */

function listOf(coll) {
  return coll === 'bonus' || coll === 'penalty' ? state.reasons[coll] : state[coll];
}

function saveColl(coll, id, patch) {
  if (coll === 'jobs') return api.saveJobs();
  if (coll === 'items') return api.updateItem(id, patch);
  return api.saveReasons();
}

function upd(coll, id, field, value, type) {
  const o = listOf(coll).find((x) => x.id === id);
  if (!o) return;
  if (type === 'num') value = Math.max(0, Math.round(Number(value)) || 0);
  if (type === 'stock') value = value === '' ? null : Math.max(0, Math.round(Number(value)) || 0);
  o[field] = value;
  persist(() => saveColl(coll, id, { [field]: value }), field === 'type');
}

function addRow(coll) {
  const blank = {
    jobs: { name: '새 직업', emoji: '🧑‍🔧', wage: state.settings.baseWage },
    bonus: { name: '새 보상', amt: 1 },
    penalty: { name: '새 차감', amt: 1 },
    items: { type: 'coupon', emoji: '🎁', name: '새 상품', price: 10, stock: null, xp: 0, food: 0, desc: '' },
  }[coll];
  if (coll === 'items') return act(() => api.addItem(blank));
  listOf(coll).push({ id: uid(), ...blank });
  act(() => saveColl(coll));
}

function delRow(coll, id) {
  if (!confirm('삭제할까요?')) return;
  if (coll === 'items') return act(() => api.deleteItem(id));
  const list = listOf(coll);
  list.splice(
    list.findIndex((x) => x.id === id),
    1,
  );
  act(async () => {
    await saveColl(coll);
    if (coll === 'jobs') {
      for (const s of state.students.filter((x) => x.jobId === id)) await api.updateStudent(s.id, { jobId: '' });
    }
  });
}

function settingsJobs() {
  return `
  <h2>1인 1역 직업과 일급</h2>
  <p class="hint">학생에게 직업을 정해 주면 매일 직업별 일급을 받아요. 직업이 없는 학생은 기본 일급(${coin(state.settings.baseWage)})을 받아요. 학생별 직업은 '학생·코드' 탭에서 정해요.</p>
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
  <div class="two"><div>${table('bonus', '⭐ 보상 (+)')}</div><div>${table('penalty', '⚠️ 차감 (−)')}</div></div>`;
}

function settingsBackup() {
  return `
  <h2>백업과 초기화</h2>
  ${
    ONLINE
      ? '<p class="hint">온라인 모드에서는 데이터가 Supabase 서버에 저장돼요. 기록 보관용으로 백업 파일을 저장해 둘 수 있어요.</p>'
      : '<p class="hint">체험 모드에서는 모든 데이터가 <b>이 브라우저</b>에만 저장돼요. 다른 컴퓨터로 옮기거나 혹시 모를 상황에 대비해 주기적으로 백업 파일을 저장하세요.</p>'
  }
  <div class="row">
    <button class="btn primary" onclick="exportJson()">💾 백업 파일 저장</button>
    ${ONLINE ? '' : '<label class="btn">📂 백업 파일 불러오기<input type="file" accept="application/json,.json" hidden onchange="importJson(this.files[0])"></label>'}
  </div>
  <h3>새 학기 / 초기화</h3>
  <div class="row">
    <button class="btn" onclick="resetBalances()">모든 학생 잔액·가방·기록만 초기화</button>
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
  reader.onload = async () => {
    let data;
    try {
      data = JSON.parse(reader.result);
      if (!data || !Array.isArray(data.students)) throw new Error('형식 오류');
    } catch (e) {
      return toast('올바른 에그보드 백업 파일이 아니에요.', 'bad');
    }
    if (!confirm(`백업(학생 ${data.students.length}명)을 불러올까요? 현재 데이터는 덮어써져요.`)) return;
    ui.selected.clear();
    const res = await act(() => api.importState(data));
    if (res.ok) toast('백업을 불러왔어요.', 'good');
  };
  reader.readAsText(file);
}

async function resetBalances() {
  if (!confirm('모든 학생의 잔액, 가방, 기록을 지울까요? (학생 명단, 펫, 상품은 유지)')) return;
  const res = await act(() => api.resetBalances());
  if (res.ok) toast('초기화했어요.');
}

async function resetAll() {
  if (!confirm('정말 모든 데이터(학생, 상품, 기록)를 지울까요? 되돌릴 수 없어요.')) return;
  if (!confirm('마지막 확인: 백업은 하셨나요? 전체 초기화합니다.')) return;
  ui.selected.clear();
  await act(() => api.resetAll());
  switchView('board');
}

/* ---------- 모달·토스트 ---------- */

function renderModal() {
  const wrap = $('#modal');
  const m = ui.modal;
  const builders = { wage: wageModal, student: studentModal, evolve: evolveModal, codes: codesModal };
  const html = m && role ? builders[m.type]() : '';
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

/* ---------- 자동 새로고침 (온라인 모드) ---------- */

async function refreshNow() {
  const before = petStages();
  try {
    await api.load();
  } catch (e) {
    if (isStudent()) {
      toast(e.message, 'bad');
      return logout();
    }
    return;
  }
  // 학생 화면에서는 선생님이 준 보상으로 펫이 자라면 바로 축하해 준다
  if (isStudent()) collectEvolutions(before);
  render();
  showEvolutions();
}

function autoRefresh() {
  if (!ONLINE || !role || busy || ui.modal || ui.selected.size || document.visibilityState !== 'visible') return;
  if (ui.view === 'settings' || (ui.view === 'market' && ui.marketTab === 'manage')) return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
  refreshNow();
}

/* ---------- 시작 ---------- */

async function boot() {
  if (!ONLINE) {
    role = 'teacher';
    api = localBackend;
    window.addEventListener('storage', (e) => {
      if (e.key === STORE_KEY) {
        state = loadState();
        render();
      }
    });
  } else if (sb) {
    state = defaultState();
    try {
      role = await auth.restore();
    } catch (e) {
      console.error(e);
      toast(e.message || '불러오지 못했어요.', 'bad');
      role = null;
    }
    api = role === 'student' ? studentBackend : role === 'teacher' ? teacherBackend : null;
    setInterval(autoRefresh, 15000);
    window.addEventListener('focus', autoRefresh);
  }
  const initial = location.hash.slice(1);
  ui.view = tabsFor().some(([v]) => v === initial) ? initial : tabsFor()[0]?.[0] || 'board';
  render();
}

$('#modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal') closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ui.modal) closeModal();
});

boot();
