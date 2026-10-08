// 상태 저장소와 학급 화폐·펫 규칙(체험 모드). 이 모드에서는 모든 데이터가 브라우저 localStorage에 저장된다.
// 온라인 모드에서는 같은 규칙을 supabase/schema.sql 의 함수들이 서버에서 처리한다.

const STORE_KEY = 'eggboard:v1';
const MAX_LOG = 3000;
const DAY_MS = 24 * 60 * 60 * 1000;

const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function defaultState() {
  return {
    version: 1,
    settings: {
      className: '우리 반',
      currency: '코인',
      coin: '🪙',
      baseWage: 10,
      allowNegative: false,
      rewardXp: true,
      marketOpen: true,
    },
    students: [],
    jobs: DEFAULT_JOBS.map((j) => ({ id: uid(), ...j })),
    reasons: {
      bonus: DEFAULT_REASONS.bonus.map((r) => ({ id: uid(), ...r })),
      penalty: DEFAULT_REASONS.penalty.map((r) => ({ id: uid(), ...r })),
    },
    items: DEFAULT_ITEMS.map((it) => ({ id: uid(), ...it })),
    wageDays: {},
    log: [],
  };
}

function normalizeState(s) {
  const d = defaultState();
  return {
    ...d,
    ...s,
    settings: { ...d.settings, ...(s.settings || {}) },
    reasons: { ...d.reasons, ...(s.reasons || {}) },
    wageDays: s.wageDays || {},
    log: s.log || [],
    students: (s.students || []).map((st) => ({
      jobId: '',
      balance: 0,
      earned: 0,
      inventory: [],
      ...st,
      pet: { ...newPet(), ...(st.pet || {}) },
    })),
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return normalizeState(JSON.parse(raw));
  } catch (e) {
    console.error(e);
  }
  return defaultState();
}

let state = loadState();

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error(e);
    if (typeof toast === 'function') toast('저장에 실패했어요. 브라우저 저장공간을 확인해 주세요.', 'bad');
  }
}

/* ---------- 학생 ---------- */

const randomSpecies = () => PET_SPECIES[Math.floor(Math.random() * PET_SPECIES.length)].id;

function newPet() {
  return { species: randomSpecies(), name: '', xp: 0, fullness: 70, fedAt: Date.now(), pettedOn: '', acc: null };
}

function newStudent(name, number) {
  return { id: uid(), name, number, jobId: '', balance: 0, earned: 0, pet: newPet(), inventory: [] };
}

const getStudent = (id) => state.students.find((s) => s.id === id);
const getJob = (id) => state.jobs.find((j) => j.id === id);
const wageOf = (s) => (getJob(s.jobId) ? getJob(s.jobId).wage : state.settings.baseWage);
const paidToday = (s) => (state.wageDays[todayKey()] || []).includes(s.id);

/* ---------- 펫 ---------- */

const speciesOf = (pet) => PET_SPECIES.find((p) => p.id === pet.species) || PET_SPECIES[0];

function stageIndex(xp) {
  let idx = 0;
  STAGES.forEach((st, i) => {
    if (xp >= st.xp) idx = i;
  });
  return idx;
}

function petEmoji(pet) {
  const idx = stageIndex(pet.xp);
  return idx === 0 ? '🥚' : speciesOf(pet).forms[idx - 1];
}

function fullnessNow(pet) {
  const days = Math.floor((Date.now() - (pet.fedAt || Date.now())) / DAY_MS);
  return Math.max(0, Math.min(100, (pet.fullness ?? 70) - days * HUNGER_PER_DAY));
}

function gainXp(s, n) {
  s.pet.xp = Math.max(0, s.pet.xp + n);
  return n;
}

function petPet(s) {
  const today = todayKey();
  if (s.pet.pettedOn === today) return false;
  s.pet.pettedOn = today;
  gainXp(s, PET_XP);
  save();
  return true;
}

/* ---------- 화폐 ---------- */

function addLog(s, kind, amt, note, xp = 0) {
  state.log.unshift({ id: uid(), ts: Date.now(), sid: s.id, name: s.name, kind, amt, xp, note });
  if (state.log.length > MAX_LOG) state.log.length = MAX_LOG;
}

// 잔액을 바꾸고 실제로 반영된 금액을 돌려준다(마이너스 금지 설정 시 0에서 멈춤).
function changeBalance(s, amt, kind, note) {
  let real = amt;
  if (!state.settings.allowNegative && s.balance + amt < 0) real = -Math.max(0, s.balance);
  s.balance += real;
  let xp = 0;
  if (real > 0) {
    s.earned += real;
    if (state.settings.rewardXp) xp = gainXp(s, real);
  }
  addLog(s, kind, real, note, xp);
  return real;
}

function payWage(ids) {
  const day = todayKey();
  const paid = state.wageDays[day] || (state.wageDays[day] = []);
  let total = 0;
  ids.forEach((id) => {
    const s = getStudent(id);
    if (!s) return;
    const job = getJob(s.jobId);
    total += changeBalance(s, wageOf(s), 'wage', job ? `일급 (${job.name})` : '일급');
    if (!paid.includes(id)) paid.push(id);
  });
  save();
  return total;
}

const UNDOABLE = ['wage', 'bonus', 'penalty'];

function undoLog(entryId) {
  const e = state.log.find((x) => x.id === entryId);
  if (!e || e.undone || !UNDOABLE.includes(e.kind)) return false;
  const s = getStudent(e.sid);
  if (s) {
    s.balance -= e.amt;
    if (e.amt > 0) s.earned = Math.max(0, s.earned - e.amt);
    if (e.xp) s.pet.xp = Math.max(0, s.pet.xp - e.xp);
    if (e.kind === 'wage') {
      const day = todayKey(new Date(e.ts));
      state.wageDays[day] = (state.wageDays[day] || []).filter((id) => id !== s.id);
    }
  }
  e.undone = true;
  save();
  return true;
}

/* ---------- 마켓 ---------- */

function buyItem(s, item) {
  if (item.stock !== null && item.stock <= 0) return '품절된 상품이에요.';
  if (s.balance < item.price) return `${state.settings.currency}이(가) 부족해요.`;
  s.balance -= item.price;
  if (item.stock !== null) item.stock -= 1;
  s.inventory.push({
    uid: uid(),
    itemId: item.id,
    type: item.type,
    emoji: item.emoji,
    name: item.name,
    xp: item.xp || 0,
    food: item.food || 0,
    boughtAt: Date.now(),
  });
  addLog(s, 'buy', -item.price, `${item.emoji} ${item.name}`);
  save();
  return null;
}

function useInventory(s, invUid) {
  const inv = s.inventory.find((x) => x.uid === invUid);
  if (!inv) return;
  if (inv.type === 'acc') {
    s.pet.acc = s.pet.acc === inv.emoji ? null : inv.emoji;
    save();
    return;
  }
  s.inventory = s.inventory.filter((x) => x.uid !== invUid);
  if (inv.type === 'food') {
    s.pet.fullness = Math.min(100, fullnessNow(s.pet) + inv.food);
    s.pet.fedAt = Date.now();
    gainXp(s, inv.xp);
    addLog(s, 'use', 0, `${inv.emoji} ${inv.name} 먹이기`, inv.xp);
  } else {
    addLog(s, 'use', 0, `${inv.emoji} ${inv.name} 쿠폰 사용`);
  }
  save();
}
