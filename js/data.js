// 에그보드 기본 데이터: 펫 종류, 성장 단계, 기본 상품/직업/보상 사유

// 각 펫은 알(🥚)에서 시작해 4단계로 진화한다. forms[i]는 STAGES[i + 1]의 모습.
const PET_SPECIES = [
  { id: 'dragon', name: '드래곤', forms: ['🦎', '🐊', '🐲', '🐉'] },
  { id: 'bird', name: '공작새', forms: ['🐣', '🐥', '🐓', '🦚'] },
  { id: 'cat', name: '사자', forms: ['🐱', '🐈', '🐯', '🦁'] },
  { id: 'dog', name: '늑대', forms: ['🐶', '🐕', '🦮', '🐺'] },
  { id: 'sea', name: '고래', forms: ['🐟', '🐠', '🐬', '🐳'] },
  { id: 'bug', name: '나비', forms: ['🐛', '🐞', '🐝', '🦋'] },
  { id: 'horse', name: '유니콘', forms: ['🐴', '🐎', '🦓', '🦄'] },
];

const STAGES = [
  { name: '알', xp: 0 },
  { name: '아기', xp: 30 },
  { name: '꼬마', xp: 100 },
  { name: '청소년', xp: 250 },
  { name: '전설', xp: 500 },
];

// 하루에 줄어드는 포만감
const HUNGER_PER_DAY = 15;
// 쓰다듬기(하루 1회)로 얻는 경험치
const PET_XP = 2;

const ITEM_TYPES = {
  food: { label: '펫 먹이', icon: '🍎', action: '먹이기' },
  acc: { label: '펫 꾸미기', icon: '🎀', action: '착용' },
  coupon: { label: '학급 쿠폰', icon: '🎟️', action: '사용' },
};

const LOG_KINDS = {
  wage: { label: '일급', icon: '💰' },
  bonus: { label: '보상', icon: '⭐' },
  penalty: { label: '차감', icon: '⚠️' },
  buy: { label: '구매', icon: '🛒' },
  use: { label: '사용', icon: '🎒' },
};

const DEFAULT_JOBS = [
  { name: '반장', emoji: '🎖️', wage: 15 },
  { name: '은행원', emoji: '🏦', wage: 15 },
  { name: '우유 배달부', emoji: '🥛', wage: 12 },
  { name: '칠판 지킴이', emoji: '🧽', wage: 12 },
  { name: '식물 관리사', emoji: '🪴', wage: 12 },
  { name: '정리 반장', emoji: '🧹', wage: 12 },
  { name: '전등 관리자', emoji: '💡', wage: 10 },
  { name: '우체부', emoji: '📮', wage: 10 },
];

const DEFAULT_REASONS = {
  bonus: [
    { name: '발표 왕', amt: 3 },
    { name: '친구 도움', amt: 5 },
    { name: '숙제 완료', amt: 2 },
    { name: '청소 열심히', amt: 3 },
    { name: '바른 자세', amt: 2 },
    { name: '모둠 활동 우수', amt: 5 },
  ],
  penalty: [
    { name: '지각', amt: 3 },
    { name: '숙제 미제출', amt: 2 },
    { name: '수업 방해', amt: 3 },
    { name: '정리 안 함', amt: 2 },
  ],
};

// stock: null 이면 무제한
const DEFAULT_ITEMS = [
  { type: 'food', emoji: '🍎', name: '사과', price: 5, stock: null, xp: 10, food: 20, desc: '펫 경험치 +10' },
  { type: 'food', emoji: '🍖', name: '고기', price: 12, stock: null, xp: 25, food: 40, desc: '펫 경험치 +25' },
  { type: 'food', emoji: '🍰', name: '케이크', price: 25, stock: null, xp: 60, food: 60, desc: '펫 경험치 +60' },
  { type: 'food', emoji: '🧪', name: '성장 물약', price: 50, stock: null, xp: 150, food: 10, desc: '펫 경험치 +150' },
  { type: 'acc', emoji: '🎀', name: '리본', price: 15, stock: null, xp: 0, food: 0, desc: '펫에게 리본 달아주기' },
  { type: 'acc', emoji: '🎩', name: '신사 모자', price: 20, stock: null, xp: 0, food: 0, desc: '멋쟁이 펫' },
  { type: 'acc', emoji: '🕶️', name: '선글라스', price: 25, stock: null, xp: 0, food: 0, desc: '힙한 펫' },
  { type: 'acc', emoji: '👑', name: '왕관', price: 60, stock: null, xp: 0, food: 0, desc: '우리 반 최고의 펫' },
  { type: 'coupon', emoji: '🪑', name: '자리 선택권', price: 40, stock: 2, xp: 0, food: 0, desc: '다음 자리 바꾸기 때 원하는 자리 선택' },
  { type: 'coupon', emoji: '🍱', name: '급식 먼저 먹기', price: 20, stock: 3, xp: 0, food: 0, desc: '하루 동안 급식 1번으로' },
  { type: 'coupon', emoji: '🎵', name: '음악 선곡권', price: 15, stock: null, xp: 0, food: 0, desc: '쉬는 시간 노래 1곡 선곡' },
  { type: 'coupon', emoji: '📝', name: '숙제 면제권', price: 60, stock: 1, xp: 0, food: 0, desc: '숙제 1회 면제' },
];
