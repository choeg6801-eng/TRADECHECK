// 국가 코드(ISO 3166-1 alpha-2) ↔ 한국어 이름 · 영문 이름 · 별칭
export const COUNTRIES = {
  US: '미국', CN: '중국', JP: '일본', VN: '베트남', HK: '홍콩', TW: '대만', IN: '인도', ID: '인도네시아', TH: '태국', MY: '말레이시아',
  SG: '싱가포르', PH: '필리핀', AU: '호주', NZ: '뉴질랜드', CA: '캐나다', MX: '멕시코', BR: '브라질', CL: '칠레', PE: '페루', CO: '콜롬비아', AR: '아르헨티나',
  DE: '독일', GB: '영국', FR: '프랑스', IT: '이탈리아', ES: '스페인', NL: '네덜란드', BE: '벨기에', CH: '스위스', AT: '오스트리아', PL: '폴란드',
  CZ: '체코', HU: '헝가리', SE: '스웨덴', NO: '노르웨이', DK: '덴마크', FI: '핀란드', IE: '아일랜드', PT: '포르투갈', GR: '그리스', RO: '루마니아',
  TR: '튀르키예', RU: '러시아', UA: '우크라이나', KZ: '카자흐스탄', UZ: '우즈베키스탄', AE: '아랍에미리트', SA: '사우디아라비아', QA: '카타르', KW: '쿠웨이트',
  IL: '이스라엘', IR: '이란', IQ: '이라크', JO: '요르단', EG: '이집트', NG: '나이지리아', ZA: '남아프리카공화국', KE: '케냐', MA: '모로코', GH: '가나',
  PK: '파키스탄', BD: '방글라데시', LK: '스리랑카', MM: '미얀마', KH: '캄보디아', MN: '몽골', KR: '대한민국',
  LU: '룩셈부르크', LI: '리히텐슈타인', MC: '모나코', MT: '몰타', CY: '키프로스', IS: '아이슬란드', EE: '에스토니아', LV: '라트비아', LT: '리투아니아',
  SK: '슬로바키아', SI: '슬로베니아', HR: '크로아티아', RS: '세르비아', BG: '불가리아', BY: '벨라루스', GE: '조지아', AZ: '아제르바이잔', AM: '아르메니아',
  OM: '오만', BH: '바레인', LB: '레바논', SY: '시리아', YE: '예멘', AF: '아프가니스탄', NP: '네팔', LA: '라오스', BN: '브루나이', MO: '마카오', KP: '북한',
  DZ: '알제리', TN: '튀니지', LY: '리비아', ET: '에티오피아', TZ: '탄자니아', UG: '우간다', AO: '앙골라', CI: '코트디부아르', SN: '세네갈', CM: '카메룬',
  VE: '베네수엘라', EC: '에콰도르', BO: '볼리비아', PY: '파라과이', UY: '우루과이', PA: '파나마', CR: '코스타리카', GT: '과테말라', DO: '도미니카공화국', CU: '쿠바',
  KY: '케이맨제도', VG: '영국령 버진아일랜드', BM: '버뮤다', JE: '저지섬', GG: '건지섬', IM: '맨섬', BS: '바하마', MH: '마셜제도',
};

// 영문 국가명·흔한 별칭 → 코드
const ALIASES = {
  'united states': 'US', usa: 'US', us: 'US', america: 'US', 'united kingdom': 'GB', uk: 'GB', britain: 'GB', 'great britain': 'GB', england: 'GB',
  uae: 'AE', 'united arab emirates': 'AE', emirates: 'AE', dubai: 'AE', 'abu dhabi': 'AE', korea: 'KR', 'south korea': 'KR',
  germany: 'DE', deutschland: 'DE', china: 'CN', prc: 'CN', japan: 'JP', vietnam: 'VN', 'viet nam': 'VN', india: 'IN', turkey: 'TR', turkiye: 'TR', 'türkiye': 'TR',
  'saudi arabia': 'SA', saudi: 'SA', ksa: 'SA', netherlands: 'NL', holland: 'NL', 'the netherlands': 'NL', france: 'FR', italy: 'IT', spain: 'ES', mexico: 'MX',
  brazil: 'BR', indonesia: 'ID', egypt: 'EG', nigeria: 'NG', poland: 'PL', switzerland: 'CH', canada: 'CA', australia: 'AU', singapore: 'SG',
  'hong kong': 'HK', hongkong: 'HK', taiwan: 'TW', thailand: 'TH', malaysia: 'MY', philippines: 'PH', ireland: 'IE', belgium: 'BE', austria: 'AT',
  sweden: 'SE', norway: 'NO', denmark: 'DK', finland: 'FI', portugal: 'PT', greece: 'GR', romania: 'RO', russia: 'RU', 'russian federation': 'RU', ukraine: 'UA',
  israel: 'IL', iran: 'IR', iraq: 'IQ', jordan: 'JO', qatar: 'QA', kuwait: 'KW', oman: 'OM', bahrain: 'BH', pakistan: 'PK', bangladesh: 'BD',
  'sri lanka': 'LK', myanmar: 'MM', cambodia: 'KH', 'south africa': 'ZA', kenya: 'KE', morocco: 'MA', ghana: 'GH', chile: 'CL', peru: 'PE', colombia: 'CO',
  argentina: 'AR', 'new zealand': 'NZ', 'czech republic': 'CZ', czechia: 'CZ', hungary: 'HU', kazakhstan: 'KZ', uzbekistan: 'UZ', luxembourg: 'LU',
  // 국가 형용사 (회사명 속 "Turkish Steel", "German Tools" 등)
  american: 'US', british: 'GB', german: 'DE', french: 'FR', italian: 'IT', spanish: 'ES', dutch: 'NL', swiss: 'CH', polish: 'PL', turkish: 'TR',
  emirati: 'AE', egyptian: 'EG', indian: 'IN', vietnamese: 'VN', indonesian: 'ID', thai: 'TH', malaysian: 'MY', singaporean: 'SG', japanese: 'JP',
  chinese: 'CN', mexican: 'MX', brazilian: 'BR', canadian: 'CA', australian: 'AU', irish: 'IE', swedish: 'SE', nigerian: 'NG', 'south african': 'ZA',
  '두바이': 'AE', '사우디': 'SA', '네덜란드': 'NL', '터키': 'TR', '한국': 'KR', '미합중국': 'US', '영국령버진아일랜드': 'VG',
};

export const countryName = (cc) => (cc ? COUNTRIES[String(cc).toUpperCase()] || String(cc).toUpperCase() : '국가 미확인');

export function countryCodeFrom(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (/^[A-Za-z]{2}$/.test(s) && COUNTRIES[s.toUpperCase()]) return s.toUpperCase();
  const low = s.toLowerCase().replace(/\.$/, '');
  if (ALIASES[low]) return ALIASES[low];
  const hit = Object.entries(COUNTRIES).find(([, ko]) => ko === s);
  return hit ? hit[0] : null;
}
