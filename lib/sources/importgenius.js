// ImportGenius API — 수입 통관(선하증권 B/L) 기록 (유료, Enterprise 요금제 또는 API 추가 계약)
// 안내: https://www.importgenius.com/api
// 접근 토큰과 필드 목록은 계약 시 영업 담당자가 제공합니다. 공개 문서가 없어 아래는 연결 틀입니다.
// 대안: S&P Global Panjiva, Volza, 한국무역협회(KITA) 해외 바이어 통관 데이터
//
// 해야 할 일 (계약 후)
//   1. IMPORTGENIUS_TOKEN, IMPORTGENIUS_API_BASE 환경변수 입력
//   2. 아래 shipments() 안에서 회사명으로 최근 12개월 선적 목록을 받아 오기
//   3. 결과를 { monthly: number[12], lastShipmentDaysAgo, topProducts, partnerCountries } 로 변환
//      (monthly 는 11개월 전 → 이번 달 순서의 선적 건수)
import { SourceError } from './http.js';

export const enabled = () => Boolean(process.env.IMPORTGENIUS_TOKEN && process.env.IMPORTGENIUS_API_BASE);

export async function shipments(/* { name, countryCode } */) {
  if (!enabled()) throw new SourceError('ImportGenius', 'not_configured', '토큰 없음');
  throw new SourceError('ImportGenius', 'not_configured', '계약 후 필드 매핑이 필요합니다 (lib/sources/importgenius.js)');
}

// 선적 목록 → 엔진 형식 변환 도우미. rows = [{ date: 'YYYY-MM-DD', product, originCountry }]
export function toCustoms(rows, now = new Date()) {
  const monthly = new Array(12).fill(0);
  let latest = null;
  const products = {};
  const partners = {};
  for (const r of rows) {
    const d = new Date(r.date);
    if (isNaN(d)) continue;
    const diff = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
    if (diff >= 0 && diff < 12) monthly[11 - diff]++;
    if (!latest || d > latest) latest = d;
    if (r.product) products[r.product] = (products[r.product] || 0) + 1;
    if (r.originCountry) partners[r.originCountry] = (partners[r.originCountry] || 0) + 1;
  }
  const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
  return {
    monthly,
    lastShipmentDaysAgo: latest ? Math.floor((now - latest) / 86400000) : null,
    topProducts: top(products),
    partnerCountries: top(partners),
  };
}
