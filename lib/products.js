// 요금제·상품 정의 — 브라우저와 서버가 같은 파일을 씁니다.
// 금액은 공급가(부가세 별도) 기준이며, 실제 결제 금액은 부가세 10%를 더한 값입니다.

export const VAT_RATE = 0.1;

export const PLANS = {
  free: { id: 'free', label: '무료', monthlyQuota: 0, seats: 1, watchLimit: 3, alerts: false },
  starter: { id: 'starter', label: 'Starter', monthlyQuota: 20, seats: 1, watchLimit: 10, alerts: false },
  team: { id: 'team', label: 'Team', monthlyQuota: 150, seats: 5, watchLimit: 50, alerts: true },
};

export const FREE_SIGNUP_CREDITS = 3;

export const PRODUCTS = {
  single: { id: 'single', name: 'Trade Checker 단건 리포트 1건', supply: 9900, kind: 'credit', credits: 1 },
  // 구독자 추가 조회 묶음 (요금제 한도를 다 쓴 뒤 사용, 다음 달로 이월됨)
  addon10_starter: { id: 'addon10_starter', name: 'Trade Checker 추가 조회 10건 (Starter)', supply: 30000, kind: 'credit', credits: 10, requires: ['starter', 'team'] },
  addon10_team: { id: 'addon10_team', name: 'Trade Checker 추가 조회 10건 (Team)', supply: 20000, kind: 'credit', credits: 10, requires: ['team'] },
  starter_month: { id: 'starter_month', name: 'Trade Checker Starter 1개월', supply: 49000, kind: 'plan', plan: 'starter', days: 30 },
  starter_year: { id: 'starter_year', name: 'Trade Checker Starter 12개월', supply: 39000 * 12, kind: 'plan', plan: 'starter', days: 365 },
  team_month: { id: 'team_month', name: 'Trade Checker Team 1개월', supply: 199000, kind: 'plan', plan: 'team', days: 30 },
  team_year: { id: 'team_year', name: 'Trade Checker Team 12개월', supply: 159000 * 12, kind: 'plan', plan: 'team', days: 365 },
};

export function amountWithVat(supply) {
  return Math.round(supply * (1 + VAT_RATE));
}

export function productAmount(productId) {
  const p = PRODUCTS[productId];
  if (!p) return null;
  return amountWithVat(p.supply);
}

export function won(n) {
  return '₩' + Number(n).toLocaleString('ko-KR');
}

// 현재 요금제(effectivePlan)로 살 수 있는 상품인지
export function canBuy(productId, effectivePlan) {
  const p = PRODUCTS[productId];
  if (!p) return false;
  return !p.requires || p.requires.includes(effectivePlan);
}
