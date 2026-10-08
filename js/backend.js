// 데이터 계층. 체험 모드(localBackend)와 온라인 모드(teacherBackend / studentBackend)가
// 같은 이름의 비동기 함수를 제공하고, 화면(app.js)은 api.* 만 호출한다.
// 모든 함수는 실패하면 한국어 메시지를 담은 Error 를 던진다.

const CONFIG = window.EGGBOARD_CONFIG || {};
const ONLINE = Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
const sb = ONLINE && window.supabase ? window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey) : null;
const STUDENT_CODE_KEY = 'eggboard:student-code';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 헷갈리는 0/O, 1/I 제외

function genCode(len = 6) {
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => CODE_CHARS[n % CODE_CHARS.length]).join('');
}

function fail(message) {
  throw new Error(message);
}

/* ---------- 체험 모드: 이 브라우저에만 저장 ---------- */

const localBackend = {
  async load() {},

  async reward(ids, amt, note) {
    ids.forEach((id) => {
      const s = getStudent(id);
      if (s) changeBalance(s, amt, amt > 0 ? 'bonus' : 'penalty', note || (amt > 0 ? '추가 보상' : '차감'));
    });
    save();
  },
  async payWage(ids) {
    return payWage(ids);
  },
  async undo(logId) {
    if (!undoLog(logId)) fail('되돌릴 수 없는 기록이에요.');
  },
  async setBalance(sid, value) {
    const s = getStudent(sid);
    const diff = value - s.balance;
    if (!diff) return;
    s.balance = value;
    addLog(s, diff > 0 ? 'bonus' : 'penalty', diff, '교사 직접 수정');
    save();
  },
  async buy(sid, itemId) {
    const err = buyItem(getStudent(sid), state.items.find((x) => x.id === itemId));
    if (err) fail(err);
  },
  async useItem(sid, invId) {
    const inv = getStudent(sid).inventory.find((x) => x.uid === invId);
    useInventory(getStudent(sid), invId);
    return inv?.type === 'coupon' ? 'coupon' : inv?.type;
  },
  async resolveCoupon() {},
  async pet(sid) {
    if (!petPet(getStudent(sid))) fail('오늘은 이미 쓰다듬었어요. 내일 또 만나요!');
  },
  async renamePet(sid, name) {
    getStudent(sid).pet.name = name;
    save();
  },

  async saveSettings() {
    save();
  },
  async saveJobs() {
    save();
  },
  async saveReasons() {
    save();
  },

  async addStudents(rows) {
    rows.forEach((r) => state.students.push(newStudent(r.name, r.number)));
    save();
  },
  async updateStudent(id, patch) {
    Object.assign(getStudent(id), patch);
    save();
  },
  async deleteStudent(id) {
    state.students = state.students.filter((x) => x.id !== id);
    save();
  },
  async resetPet(id) {
    getStudent(id).pet = newPet();
    save();
  },
  async reissueCode() {},

  async addItem(item) {
    state.items.push({ id: uid(), ...item });
    save();
  },
  async updateItem(id, patch) {
    Object.assign(state.items.find((x) => x.id === id), patch);
    save();
  },
  async deleteItem(id) {
    state.items = state.items.filter((x) => x.id !== id);
    save();
  },

  async resetBalances() {
    state.students.forEach((s) => {
      s.balance = 0;
      s.earned = 0;
      s.inventory = [];
      s.pet.acc = null;
    });
    state.log = [];
    state.wageDays = {};
    save();
  },
  async resetAll() {
    state = defaultState();
    save();
  },
  async importState(data) {
    state = normalizeState(data);
    save();
  },
};

/* ---------- 온라인 모드 공통 ---------- */

function check({ data, error }) {
  if (error) {
    console.error(error);
    fail(error.code === '23505' ? '이미 있는 값이에요. 다시 시도해 주세요.' : error.message || '서버 오류가 났어요.');
  }
  return data;
}

async function rpc(name, args) {
  return check(await sb.rpc(name, args));
}

function petFromRow(r) {
  return {
    species: r.pet_species,
    name: r.pet_name || '',
    xp: r.xp,
    fullness: r.fullness,
    fedAt: Date.parse(r.fed_at),
    pettedOn: r.petted_on || '',
    acc: r.acc || null,
  };
}

function invFromRow(r) {
  return {
    uid: r.id,
    itemId: r.item_id,
    sid: r.student_id,
    type: r.type,
    emoji: r.emoji,
    name: r.name,
    xp: r.xp,
    food: r.food,
    status: r.status || 'owned',
    requestedAt: r.requested_at ? Date.parse(r.requested_at) : 0,
  };
}

function studentFromRow(r, invRows = []) {
  return {
    id: r.id,
    name: r.name,
    number: r.number,
    code: r.code || '',
    jobId: r.job_id || '',
    balance: r.balance ?? 0,
    earned: r.earned ?? 0,
    pet: petFromRow(r),
    inventory: invRows.filter((v) => v.student_id === r.id).map(invFromRow),
  };
}

const itemFromRow = (r) => ({
  id: r.id,
  type: r.type,
  emoji: r.emoji,
  name: r.name,
  price: r.price,
  stock: r.stock,
  xp: r.xp,
  food: r.food,
  desc: r.description,
  sort: r.sort,
});

const logFromRow = (r) => ({
  id: r.id,
  ts: Date.parse(r.ts),
  sid: r.student_id,
  name: r.name,
  kind: r.kind,
  amt: r.amt,
  xp: r.xp,
  note: r.note,
  undone: r.undone,
});

function itemToRow(it) {
  const row = {};
  const map = { type: 'type', emoji: 'emoji', name: 'name', price: 'price', stock: 'stock', xp: 'xp', food: 'food', desc: 'description', sort: 'sort' };
  Object.entries(it).forEach(([k, v]) => map[k] && (row[map[k]] = v));
  return row;
}

/* ---------- 온라인 모드: 교사 ---------- */

const teacherBackend = {
  classId: null,

  async load() {
    let cls = check(await sb.from('classes').select('*').maybeSingle());
    if (!cls) cls = await this.createClass();
    this.classId = cls.id;
    const [st, it, inv, lg] = await Promise.all([
      sb.from('students').select('*').eq('class_id', cls.id),
      sb.from('items').select('*').eq('class_id', cls.id).order('sort').order('created_at'),
      sb.from('inventory').select('*').eq('class_id', cls.id).order('bought_at'),
      sb.from('logs').select('*').eq('class_id', cls.id).order('ts', { ascending: false }).limit(1000),
    ]);
    const d = defaultState();
    const invRows = check(inv);
    const log = check(lg).map(logFromRow);
    const wageDays = {};
    log.forEach((e) => {
      if (e.kind !== 'wage' || e.undone || !e.sid) return;
      (wageDays[todayKey(new Date(e.ts))] ||= []).push(e.sid);
    });
    state = {
      version: 1,
      settings: { ...d.settings, ...cls.settings },
      jobs: cls.jobs || [],
      reasons: { ...d.reasons, ...cls.reasons },
      students: check(st).map((r) => studentFromRow(r, invRows)),
      items: check(it).map(itemFromRow),
      log,
      wageDays,
    };
  },

  async createClass() {
    const d = defaultState();
    const cls = check(await sb.from('classes').insert({ settings: d.settings, jobs: d.jobs, reasons: d.reasons }).select().single());
    await this.insertDefaultItems(cls.id);
    return cls;
  },

  async insertDefaultItems(classId) {
    check(await sb.from('items').insert(DEFAULT_ITEMS.map((it, i) => ({ ...itemToRow(it), sort: i, class_id: classId }))));
  },

  reward: (ids, amt, note) => rpc('teacher_reward', { p_ids: ids, p_amt: amt, p_note: note || '' }),
  payWage: (ids) => rpc('teacher_pay_wage', { p_ids: ids }),
  undo: (logId) => rpc('teacher_undo', { p_log: logId }),
  setBalance: (sid, value) => rpc('teacher_set_balance', { p_sid: sid, p_value: value }),
  buy: (sid, itemId) => rpc('teacher_buy', { p_sid: sid, p_item: itemId }),
  useItem: (sid, invId) => rpc('teacher_use', { p_sid: sid, p_inv: invId }),
  resolveCoupon: (invId, approve) => rpc('teacher_resolve_coupon', { p_inv: invId, p_approve: approve }),
  pet: (sid) => rpc('teacher_pet', { p_sid: sid }),
  async renamePet(sid, name) {
    check(await sb.from('students').update({ pet_name: name }).eq('id', sid));
  },

  async saveSettings() {
    check(await sb.from('classes').update({ settings: state.settings }).eq('id', this.classId));
  },
  async saveJobs() {
    check(await sb.from('classes').update({ jobs: state.jobs }).eq('id', this.classId));
  },
  async saveReasons() {
    check(await sb.from('classes').update({ reasons: state.reasons }).eq('id', this.classId));
  },

  async addStudents(rows) {
    const make = () =>
      rows.map((r) => ({ class_id: this.classId, name: r.name, number: r.number, code: genCode(), pet_species: randomSpecies() }));
    const res = await sb.from('students').insert(make());
    // 코드가 우연히 겹치면(아주 드묾) 한 번 더 새 코드로 시도
    check(res.error?.code === '23505' ? await sb.from('students').insert(make()) : res);
  },
  async updateStudent(id, patch) {
    const row = {};
    if ('name' in patch) row.name = patch.name;
    if ('number' in patch) row.number = patch.number;
    if ('jobId' in patch) row.job_id = patch.jobId;
    check(await sb.from('students').update(row).eq('id', id));
  },
  async deleteStudent(id) {
    check(await sb.from('students').delete().eq('id', id));
  },
  async resetPet(id) {
    check(
      await sb
        .from('students')
        .update({ pet_species: randomSpecies(), pet_name: '', xp: 0, fullness: 70, fed_at: new Date().toISOString(), petted_on: null, acc: null })
        .eq('id', id),
    );
  },
  async reissueCode(id) {
    const res = await sb.from('students').update({ code: genCode() }).eq('id', id);
    check(res.error?.code === '23505' ? await sb.from('students').update({ code: genCode() }).eq('id', id) : res);
  },

  async addItem(item) {
    check(await sb.from('items').insert({ ...itemToRow(item), class_id: this.classId, sort: state.items.length }));
  },
  async updateItem(id, patch) {
    check(await sb.from('items').update(itemToRow(patch)).eq('id', id));
  },
  async deleteItem(id) {
    check(await sb.from('items').delete().eq('id', id));
  },

  async resetBalances() {
    check(await sb.from('inventory').delete().eq('class_id', this.classId));
    check(await sb.from('logs').delete().eq('class_id', this.classId));
    check(await sb.from('students').update({ balance: 0, earned: 0, acc: null }).eq('class_id', this.classId));
  },
  async resetAll() {
    const d = defaultState();
    check(await sb.from('students').delete().eq('class_id', this.classId));
    check(await sb.from('items').delete().eq('class_id', this.classId));
    check(await sb.from('logs').delete().eq('class_id', this.classId));
    check(await sb.from('classes').update({ settings: d.settings, jobs: d.jobs, reasons: d.reasons }).eq('id', this.classId));
    await this.insertDefaultItems(this.classId);
  },
  async importState() {
    fail('온라인 모드에서는 백업 불러오기를 지원하지 않아요.');
  },
};

/* ---------- 온라인 모드: 학생 (개인 코드) ---------- */

const studentBackend = {
  code: '',

  async load() {
    const d = await rpc('student_login', { p_code: this.code });
    const me = studentFromRow(d.me, d.inventory);
    const today = todayKey();
    state = {
      settings: { ...defaultState().settings, ...d.settings },
      jobs: d.jobs || [],
      items: d.items.map(itemFromRow),
      me,
      // 반 친구 목록(잔액 없음). 펫 마을에서 사용
      students: d.classmates.map((r) => ({ id: r.id, name: r.name, number: r.number, pet: petFromRow(r), inventory: [] })),
      log: d.logs.map(logFromRow),
      wageDays: { [today]: d.paid_today ? [me.id] : [] },
      reasons: { bonus: [], penalty: [] },
    };
  },

  buy: (sid, itemId) => rpc('student_buy', { p_code: studentBackend.code, p_item: itemId }),
  useItem: (sid, invId) => rpc('student_use', { p_code: studentBackend.code, p_inv: invId }),
  cancelRequest: (sid, invId) => rpc('student_cancel_request', { p_code: studentBackend.code, p_inv: invId }),
  pet: () => rpc('student_pet', { p_code: studentBackend.code }),
  renamePet: (sid, name) => rpc('student_rename_pet', { p_code: studentBackend.code, p_name: name }),
};

/* ---------- 로그인 ---------- */

const auth = {
  async studentLogin(code) {
    studentBackend.code = code.trim().toUpperCase();
    await studentBackend.load();
    try {
      localStorage.setItem(STUDENT_CODE_KEY, studentBackend.code);
    } catch (e) {}
  },
  async teacherLogin(email, password) {
    check(await sb.auth.signInWithPassword({ email, password }));
    await teacherBackend.load();
  },
  async teacherSignUp(email, password) {
    const data = check(await sb.auth.signUp({ email, password }));
    if (!data.session) return false; // 이메일 인증이 필요한 설정
    await teacherBackend.load();
    return true;
  },
  async logout() {
    try {
      localStorage.removeItem(STUDENT_CODE_KEY);
    } catch (e) {}
    studentBackend.code = '';
    if (sb) await sb.auth.signOut();
  },
  // 저장된 로그인 상태를 되살린다. 'teacher' | 'student' | null
  async restore() {
    let code = '';
    try {
      code = localStorage.getItem(STUDENT_CODE_KEY) || '';
    } catch (e) {}
    if (code) {
      try {
        studentBackend.code = code;
        await studentBackend.load();
        return 'student';
      } catch (e) {
        await this.logout();
        return null;
      }
    }
    const { data } = await sb.auth.getSession();
    if (!data.session) return null;
    await teacherBackend.load();
    return 'teacher';
  },
  async teacherEmail() {
    const { data } = await sb.auth.getUser();
    return data.user?.email || '';
  },
};
