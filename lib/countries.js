// 국가 코드(ISO 3166-1 alpha-2) ↔ 한국어 이름. 수출 거래가 많은 국가 위주.
export const COUNTRIES = {
  US: '미국', CN: '중국', JP: '일본', VN: '베트남', HK: '홍콩', TW: '대만', IN: '인도', ID: '인도네시아', TH: '태국', MY: '말레이시아',
  SG: '싱가포르', PH: '필리핀', AU: '호주', NZ: '뉴질랜드', CA: '캐나다', MX: '멕시코', BR: '브라질', CL: '칠레', PE: '페루', CO: '콜롬비아', AR: '아르헨티나',
  DE: '독일', GB: '영국', FR: '프랑스', IT: '이탈리아', ES: '스페인', NL: '네덜란드', BE: '벨기에', CH: '스위스', AT: '오스트리아', PL: '폴란드',
  CZ: '체코', HU: '헝가리', SE: '스웨덴', NO: '노르웨이', DK: '덴마크', FI: '핀란드', IE: '아일랜드', PT: '포르투갈', GR: '그리스', RO: '루마니아',
  TR: '튀르키예', RU: '러시아', UA: '우크라이나', KZ: '카자흐스탄', UZ: '우즈베키스탄', AE: '아랍에미리트', SA: '사우디아라비아', QA: '카타르', KW: '쿠웨이트',
  IL: '이스라엘', IR: '이란', IQ: '이라크', JO: '요르단', EG: '이집트', NG: '나이지리아', ZA: '남아프리카공화국', KE: '케냐', MA: '모로코', GH: '가나',
  PK: '파키스탄', BD: '방글라데시', LK: '스리랑카', MM: '미얀마', KH: '캄보디아', MN: '몽골', KR: '대한민국',
};

const ALIASES = {
  uae: 'AE', usa: 'US', uk: 'GB', 'united states': 'US', 'united kingdom': 'GB', england: 'GB', dubai: 'AE', korea: 'KR',
  germany: 'DE', china: 'CN', japan: 'JP', vietnam: 'VN', india: 'IN', turkey: 'TR', turkiye: 'TR', 'saudi arabia': 'SA', ksa: 'SA',
  netherlands: 'NL', holland: 'NL', france: 'FR', italy: 'IT', spain: 'ES', mexico: 'MX', brazil: 'BR', indonesia: 'ID', egypt: 'EG', nigeria: 'NG',
  poland: 'PL', switzerland: 'CH', canada: 'CA', australia: 'AU', singapore: 'SG', 'hong kong': 'HK', thailand: 'TH', malaysia: 'MY', philippines: 'PH',
  '두바이': 'AE', '사우디': 'SA', '네덜란드': 'NL', '터키': 'TR',
};

export const countryName = (cc) => (cc ? COUNTRIES[String(cc).toUpperCase()] || String(cc).toUpperCase() : '국가 미확인');

export function countryCodeFrom(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (/^[A-Za-z]{2}$/.test(s) && COUNTRIES[s.toUpperCase()]) return s.toUpperCase();
  const low = s.toLowerCase();
  if (ALIASES[low]) return ALIASES[low];
  const hit = Object.entries(COUNTRIES).find(([, ko]) => ko === s);
  return hit ? hit[0] : null;
}
