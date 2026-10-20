// 샘플 모드에서 '목록에 없는 회사'를 조회했을 때 만드는 가상 리포트의 재료.
// 회사명·웹사이트·법인 형태·선택한 국가에서 국가와 업종을 추론해, 국가-도시-법인형태-도메인-업종-품목-법원이 서로 맞도록 만듭니다.
// 실제 회사 정보가 아닙니다. 리포트에는 '가상 데이터'라고 표시됩니다.
import { countryCodeFrom } from '../countries.js';

// 국가별 정보: 한국어 이름, 도시, 도메인 끝, 기본 법인 형태, 법원 이름(도시 자리에 {city})
export const COUNTRY_INFO = {
  US: { ko: '미국', cities: ['Los Angeles', 'Houston', 'New York', 'Chicago', 'Atlanta'], tld: 'com', suffix: 'Inc.', court: 'Superior Court ({city})' },
  DE: { ko: '독일', cities: ['Hamburg', 'Frankfurt am Main', 'Munich', 'Düsseldorf', 'Stuttgart'], tld: 'de', suffix: 'GmbH', court: 'Landgericht {city}' },
  GB: { ko: '영국', cities: ['London', 'Manchester', 'Birmingham'], tld: 'co.uk', suffix: 'Ltd', court: 'High Court of Justice ({city})' },
  FR: { ko: '프랑스', cities: ['Paris', 'Lyon', 'Marseille'], tld: 'fr', suffix: 'SAS', court: 'Tribunal de commerce de {city}' },
  IT: { ko: '이탈리아', cities: ['Milan', 'Turin', 'Bologna'], tld: 'it', suffix: 'S.r.l.', court: 'Tribunale di {city}' },
  ES: { ko: '스페인', cities: ['Madrid', 'Barcelona', 'Valencia'], tld: 'es', suffix: 'S.L.', court: 'Juzgado de lo Mercantil de {city}' },
  NL: { ko: '네덜란드', cities: ['Rotterdam', 'Amsterdam', 'Eindhoven'], tld: 'nl', suffix: 'B.V.', court: 'Rechtbank {city}' },
  CH: { ko: '스위스', cities: ['Zürich', 'Basel', 'Geneva'], tld: 'ch', suffix: 'AG', court: 'Handelsgericht {city}' },
  PL: { ko: '폴란드', cities: ['Warsaw', 'Wrocław', 'Poznań'], tld: 'pl', suffix: 'Sp. z o.o.', court: 'Sąd Okręgowy ({city})' },
  TR: { ko: '튀르키예', cities: ['Istanbul', 'Izmir', 'Bursa'], tld: 'com.tr', suffix: 'A.Ş.', court: '{city} Ticaret Mahkemesi' },
  AE: { ko: '아랍에미리트', cities: ['Dubai', 'Sharjah', 'Abu Dhabi'], tld: 'ae', suffix: 'LLC', court: '{city} Courts' },
  SA: { ko: '사우디아라비아', cities: ['Riyadh', 'Jeddah', 'Dammam'], tld: 'sa', suffix: 'Co.', court: '{city} Commercial Court' },
  EG: { ko: '이집트', cities: ['Cairo', 'Alexandria'], tld: 'com.eg', suffix: 'S.A.E.', court: '{city} Economic Court' },
  IN: { ko: '인도', cities: ['Mumbai', 'Chennai', 'New Delhi', 'Pune'], tld: 'in', suffix: 'Pvt Ltd', court: '{city} High Court' },
  VN: { ko: '베트남', cities: ['Ho Chi Minh City', 'Hanoi', 'Hai Phong'], tld: 'com.vn', suffix: 'Co., Ltd', court: "People's Court of {city}" },
  ID: { ko: '인도네시아', cities: ['Jakarta', 'Surabaya', 'Bandung'], tld: 'co.id', suffix: 'PT', prefix: true, court: '{city} District Court' },
  TH: { ko: '태국', cities: ['Bangkok', 'Chonburi'], tld: 'co.th', suffix: 'Co., Ltd.', court: 'Central Intellectual Property and International Trade Court ({city})' },
  MY: { ko: '말레이시아', cities: ['Kuala Lumpur', 'Penang', 'Johor Bahru'], tld: 'com.my', suffix: 'Sdn. Bhd.', court: 'High Court of Malaya ({city})' },
  SG: { ko: '싱가포르', cities: ['Singapore'], tld: 'com.sg', suffix: 'Pte. Ltd.', court: 'Singapore High Court' },
  JP: { ko: '일본', cities: ['Osaka', 'Tokyo', 'Nagoya'], tld: 'co.jp', suffix: 'Co., Ltd.', court: '{city} District Court' },
  CN: { ko: '중국', cities: ['Shanghai', 'Shenzhen', 'Guangzhou', 'Ningbo'], tld: 'com.cn', suffix: 'Co., Ltd.', court: '{city} Intermediate People’s Court' },
  HK: { ko: '홍콩', cities: ['Hong Kong'], tld: 'com.hk', suffix: 'Limited', court: 'High Court of Hong Kong' },
  MX: { ko: '멕시코', cities: ['Monterrey', 'Mexico City', 'Guadalajara'], tld: 'com.mx', suffix: 'S.A. de C.V.', court: 'Juzgado de Distrito ({city})' },
  BR: { ko: '브라질', cities: ['São Paulo', 'Curitiba', 'Rio de Janeiro'], tld: 'com.br', suffix: 'Ltda.', court: 'Tribunal de Justiça ({city})' },
  CA: { ko: '캐나다', cities: ['Toronto', 'Vancouver', 'Montreal'], tld: 'ca', suffix: 'Inc.', court: 'Superior Court ({city})' },
  AU: { ko: '호주', cities: ['Sydney', 'Melbourne'], tld: 'com.au', suffix: 'Pty Ltd', court: 'Federal Court of Australia ({city})' },
  IE: { ko: '아일랜드', cities: ['Dublin', 'Cork', 'Galway'], tld: 'ie', suffix: 'Ltd', court: 'High Court ({city})' },
  SE: { ko: '스웨덴', cities: ['Stockholm', 'Gothenburg'], tld: 'se', suffix: 'AB', court: '{city} tingsrätt' },
  NG: { ko: '나이지리아', cities: ['Lagos', 'Abuja'], tld: 'com.ng', suffix: 'Ltd', court: 'Federal High Court, {city}' },
  KR: { ko: '대한민국', cities: ['Seoul', 'Busan', 'Incheon'], tld: 'co.kr', suffix: 'Co., Ltd.', court: '{city} District Court' },
  XX: { ko: '국가 미확인', cities: [''], tld: '', suffix: '', court: '현지 법원' },
  ZA: { ko: '남아프리카공화국', cities: ['Johannesburg', 'Cape Town', 'Durban'], tld: 'co.za', suffix: '(Pty) Ltd', court: 'High Court ({city})' },
};
// 이름을 모르는 회사의 국가를 정할 때 쓰는 후보 (수출 상대국 위주)
const DEFAULT_POOL = ['US', 'VN', 'AE', 'DE', 'IN', 'MX', 'ID', 'TR', 'SA', 'PL', 'NL', 'TH', 'JP', 'CN', 'BR', 'GB'];

// 웹사이트 끝 → 국가
const TLD = { kr: 'KR', 'co.kr': 'KR', 'co.uk': 'GB', uk: 'GB', de: 'DE', fr: 'FR', it: 'IT', es: 'ES', nl: 'NL', ch: 'CH', pl: 'PL', 'com.tr': 'TR', tr: 'TR', ae: 'AE', sa: 'SA', 'com.sa': 'SA', eg: 'EG', 'com.eg': 'EG', in: 'IN', 'co.in': 'IN', vn: 'VN', 'com.vn': 'VN', id: 'ID', 'co.id': 'ID', th: 'TH', 'co.th': 'TH', my: 'MY', 'com.my': 'MY', sg: 'SG', 'com.sg': 'SG', jp: 'JP', 'co.jp': 'JP', cn: 'CN', 'com.cn': 'CN', hk: 'HK', 'com.hk': 'HK', mx: 'MX', 'com.mx': 'MX', br: 'BR', 'com.br': 'BR', ca: 'CA', au: 'AU', 'com.au': 'AU', ie: 'IE', se: 'SE', ng: 'NG', 'com.ng': 'NG', za: 'ZA', 'co.za': 'ZA' };

// 법인 형태 → 국가 (회사명 끝에 붙은 경우)
const LEGAL = [
  [/\bgmbh\b|\bag\b|\baktiengesellschaft\b|\bkg\b/i, 'DE'], [/\bs\.?p\.?a\.?$|\bs\.?r\.?l\.?$|societa per azioni/i, 'IT'], [/\bsas\b|\bsarl\b|\bs\.a\.s\.?$/i, 'FR'],
  [/s\.?\s?a\.?\s?de\s?c\.?\s?v\.?/i, 'MX'], [/\bpvt\.?\s*ltd\b|\bprivate limited\b/i, 'IN'], [/^pt\.?\s|\btbk\b/i, 'ID'], [/\bfze\b|\bfzco\b|\bfz-llc\b|\bl\.l\.c\b/i, 'AE'],
  [/\bplc\b/i, 'GB'], [/\bb\.?v\.?$|\bn\.?v\.?$/i, 'NL'], [/\ba\.ş\.?$|\ba\.s\.$/i, 'TR'], [/sp\.?\s*z\s*o\.?\s*o\.?/i, 'PL'], [/\bltda\.?$/i, 'BR'], [/\bjsc\b/i, 'VN'],
  [/\bk\.?k\.?$|kabushiki/i, 'JP'], [/\bpte\.?\s*ltd/i, 'SG'], [/\bsdn\.?\s*bhd/i, 'MY'], [/\bpty\.?\s*ltd/i, 'AU'], [/\bs\.?l\.?$/i, 'ES'], [/\bab$/i, 'SE'],
  [/\binc\.?$|\bcorp\.?$|\bcorporation$|\bllc$/i, 'US'],
];
// 여러 나라에서 쓰는 법인 형태 → 그중에서 고름
const LEGAL_POOL = [
  [/co\.?,?\s*ltd\.?$/i, ['VN', 'TH', 'CN', 'JP']],
  [/\bltd\.?$|\blimited$/i, ['GB', 'HK', 'NG', 'IE']],
  [/\bs\.?a\.?$/i, ['ES', 'FR', 'BR']],
  [/\bse$/i, ['DE', 'FR', 'NL']],
  [/\bn\.?v\.?$/i, ['NL']],
];

// 도시 이름 → 국가
const CITY = {};
for (const [cc, info] of Object.entries(COUNTRY_INFO)) for (const c of info.cities) CITY[c.toLowerCase()] = cc;
Object.assign(CITY, { mumbai: 'IN', bombay: 'IN', saigon: 'VN', jeddah: 'SA', istanbul: 'TR', lagos: 'NG', cairo: 'EG', shenzhen: 'CN', osaka: 'JP', tokyo: 'JP', rotterdam: 'NL' });

// 업종별 대표 품목과 주로 들여오는 나라
// 잘 알려진 제조사에 붙이는 업종 이름
export const MAKER_KO = { medical: '의료기기 제조', pharma: '제약', electric: '전기·자동화 설비 제조', defense: '방위산업·항공우주', chemical: '화학 제조', steel: '철강 제조', auto: '자동차·부품 제조', electronics: '전자 제조' };
export const FREE_MAIL = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'mail.com', 'qq.com', '163.com', '126.com', 'yandex.ru', 'naver.com', 'daum.net', 'gmx.com', 'proton.me', 'protonmail.com', 'icloud.com', 'live.com'];
export const INDUSTRY_INFO = {
  medical: { ko: '의료기기 유통', products: ['체외진단 시약·키트', '수술용 소모품', '초음파 프로브', '카테터·튜브류', '환자 모니터 부품'], partners: ['대한민국', '독일', '미국', '일본'] },
  pharma: { ko: '의약품 유통', products: ['원료의약품(API)', '주사제 바이알', '의약품 포장재', '일반의약품 완제품'], partners: ['대한민국', '인도', '독일', '스위스'] },
  electric: { ko: '전기·전력 설비 유통', products: ['배전반·차단기', '전력 케이블', '변압기 부품', '산업용 배터리'], partners: ['대한민국', '중국', '독일'] },
  defense: { ko: '방산·항공 부품 조달', products: ['정밀 가공 부품', '특수 합금 소재', '항공 전자 커넥터'], partners: ['대한민국', '미국', '프랑스'] },
  chemical: { ko: '화학·수지 유통', products: ['PE 레진', 'PP 레진', '합성고무', '산업용 용제'], partners: ['대한민국', '사우디아라비아', '중국'] },
  steel: { ko: '철강·금속 유통', products: ['열연 강판', '스테인리스 코일', '강관', '알루미늄 판재'], partners: ['대한민국', '중국', '일본'] },
  auto: { ko: '자동차 부품 유통', products: ['브레이크 패드', '와이어 하네스', '자동차 램프', '엔진 필터'], partners: ['대한민국', '일본', '독일'] },
  electronics: { ko: '전자부품 유통', products: ['PCB 기판', '커넥터', '디스플레이 모듈', '전원 공급장치'], partners: ['대한민국', '대만', '중국'] },
  cosmetics: { ko: '화장품 유통', products: ['기초 화장품', '마스크팩', '선크림', '화장품 용기'], partners: ['대한민국', '프랑스', '일본'] },
  food: { ko: '식품 수입', products: ['라면·즉석식품', '소스·조미료', '음료', '김·해조류'], partners: ['대한민국', '태국', '베트남'] },
  textile: { ko: '섬유·의류 수입', products: ['기능성 원단', '니트 의류', '원사'], partners: ['대한민국', '베트남', '중국'] },
  machinery: { ko: '기계·설비 수입', products: ['CNC 공작기계', '유압 부품', '산업용 펌프', '컨베이어 부품'], partners: ['대한민국', '독일', '일본'] },
  logistics: { ko: '물류·중개', products: ['포장재', '팔레트', '혼재 화물'], partners: ['대한민국', '중국'] },
  construction: { ko: '건자재 수입', products: ['단열재', '창호 부품', '타일', '배관 자재'], partners: ['대한민국', '중국', '튀르키예'] },
  general: { ko: '종합 무역', products: ['생활용품', '가전 소모품', '주방용품', '포장재'], partners: ['대한민국', '중국', '베트남'] },
};
const KEYWORDS = [
  ['medical', /medic|medtech|health|surgic|dental|diagnost|devices?|ortho|clinic|hospital|stryker|medtronic|philips|healthineers|의료/],
  ['pharma', /pharm|drug|biotech|\bbio|laborator|therapeut|life ?science|vaccin|pfizer|novartis|sanofi|bayer|roche|제약/],
  ['defense', /defen[cs]e|aerospace|arms|military|ordnance|lockheed|rheinmetall|bae systems|leonardo|thales|방산|방위/],
  ['electric', /electric|power|energy|cable|switchgear|solar|battery|abb\b|schneider|eaton|siemens|전기|전력/],
  ['chemical', /chem|polymer|plastic|resin|petro|rubber|화학/],
  ['steel', /steel|metal|alloy|iron|alumin|mining|minerals|철강/],
  ['auto', /auto|motor|vehicle|car parts|tyre|tire|자동차/],
  ['electronics', /electronic|semicon|component|digital|tech\b|technolog|display|전자/],
  ['cosmetics', /cosmet|beauty|skin|화장품/],
  ['food', /food|agro|coffee|beverage|snack|grocery|식품/],
  ['textile', /textile|fabric|garment|apparel|fashion|섬유|의류/],
  ['machinery', /machin|maschinen|equipment|engineering|industrial|tools?\b|werkzeug|기계/],
  ['logistics', /logistic|shipping|freight|cargo|물류/],
  ['construction', /construct|building|cement|건자재|건설/],
];

// 잘 알려진 실제 기업: 샘플 모드에서도 국가·업종은 맞게 보여 주고, 위험 정보는 만들어 내지 않음
export const KNOWN = {
  medtronic: { name: 'Medtronic plc', cc: 'IE', ind: 'medical', city: 'Dublin', domain: 'medtronic.com' }, 'siemens healthineers': { name: 'Siemens Healthineers AG', cc: 'DE', ind: 'medical', city: 'Erlangen', domain: 'siemens-healthineers.com' },
  stryker: { name: 'Stryker Corporation', cc: 'US', ind: 'medical', city: 'Kalamazoo', domain: 'stryker.com' }, philips: { name: 'Koninklijke Philips N.V.', cc: 'NL', ind: 'medical', city: 'Amsterdam', domain: 'philips.com' },
  'boston scientific': { name: 'Boston Scientific Corporation', cc: 'US', ind: 'medical', city: 'Marlborough', domain: 'bostonscientific.com' }, olympus: { name: 'Olympus Corporation', cc: 'JP', ind: 'medical', city: 'Tokyo', domain: 'olympus.com' },
  pfizer: { name: 'Pfizer Inc.', cc: 'US', ind: 'pharma', city: 'New York', domain: 'pfizer.com' }, novartis: { name: 'Novartis AG', cc: 'CH', ind: 'pharma', city: 'Basel', domain: 'novartis.com' },
  bayer: { name: 'Bayer AG', cc: 'DE', ind: 'pharma', city: 'Leverkusen', domain: 'bayer.com' }, sanofi: { name: 'Sanofi', cc: 'FR', ind: 'pharma', city: 'Paris', domain: 'sanofi.com' },
  roche: { name: 'Roche Holding AG', cc: 'CH', ind: 'pharma', city: 'Basel', domain: 'roche.com' }, schneider: { name: 'Schneider Electric SE', cc: 'FR', ind: 'electric', city: 'Rueil-Malmaison', domain: 'se.com' },
  abb: { name: 'ABB Ltd', cc: 'CH', ind: 'electric', city: 'Zürich', domain: 'abb.com' }, siemens: { name: 'Siemens AG', cc: 'DE', ind: 'electric', city: 'Munich', domain: 'siemens.com' },
  eaton: { name: 'Eaton Corporation plc', cc: 'IE', ind: 'electric', city: 'Dublin', domain: 'eaton.com' }, lockheed: { name: 'Lockheed Martin Corporation', cc: 'US', ind: 'defense', city: 'Bethesda', domain: 'lockheedmartin.com' },
  'bae systems': { name: 'BAE Systems plc', cc: 'GB', ind: 'defense', city: 'London', domain: 'baesystems.com' }, rheinmetall: { name: 'Rheinmetall AG', cc: 'DE', ind: 'defense', city: 'Düsseldorf', domain: 'rheinmetall.com' },
  leonardo: { name: 'Leonardo S.p.A.', cc: 'IT', ind: 'defense', city: 'Rome', domain: 'leonardo.com' }, thales: { name: 'Thales S.A.', cc: 'FR', ind: 'defense', city: 'Paris', domain: 'thalesgroup.com' },
  boeing: { name: 'The Boeing Company', cc: 'US', ind: 'defense', city: 'Arlington', domain: 'boeing.com' }, airbus: { name: 'Airbus SE', cc: 'NL', ind: 'defense', city: 'Leiden', domain: 'airbus.com' },
  apple: { name: 'Apple Inc.', cc: 'US', ind: 'electronics', city: 'Cupertino', domain: 'apple.com' },
  sony: { name: 'Sony Group Corporation', cc: 'JP', ind: 'electronics', city: 'Tokyo', domain: 'sony.com' }, toyota: { name: 'Toyota Motor Corporation', cc: 'JP', ind: 'auto', city: 'Toyota City', domain: 'toyota-global.com' },
  bosch: { name: 'Robert Bosch GmbH', cc: 'DE', ind: 'auto', city: 'Gerlingen', domain: 'bosch.com' }, basf: { name: 'BASF SE', cc: 'DE', ind: 'chemical', city: 'Ludwigshafen', domain: 'basf.com' },
};

export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// 회사명(원문)·웹사이트·선택 국가에서 국가와 업종 추론
export function infer({ name, domain, country }) {
  const low = String(name || '').toLowerCase();
  const dom = String(domain || '').toLowerCase().replace(/^www\./, '');
  const known = Object.entries(KNOWN).find(([, v]) => dom && v.domain === dom)
    || Object.entries(KNOWN).sort((a, b) => b[0].length - a[0].length).find(([k]) => new RegExp(`(^|[^a-z])${k}([^a-z]|$)`).test(low));
  let cc = country && COUNTRY_INFO[country] ? country : null;
  let how = cc ? 'selected' : null;
  // 이름 속 국가명 ("Pfizer Korea", "Siemens Mexico", "Bayer Vietnam") → 현지 법인으로 봄
  if (!cc) {
    const words = low.replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length && !cc; i++) {
      for (const w of [words.slice(i, i + 2).join(' '), words[i]]) {
        const c = countryCodeFrom(w);
        if (c && COUNTRY_INFO[c] && w.length > 2) { cc = c; how = 'name-country'; break; }
      }
    }
  }
  if (!cc && domain) {
    const parts = domain.split('.');
    const t2 = parts.slice(-2).join('.');
    cc = TLD[t2] || TLD[parts[parts.length - 1]] || null;
    if (cc) how = 'domain';
  }
  if (!cc && known) { cc = known[1].cc; how = 'known'; }
  if (!cc) { const l = LEGAL.find(([re]) => re.test(String(name || '').trim())); if (l) { cc = l[1]; how = 'legal'; } }
  if (!cc) { const l = LEGAL_POOL.find(([re]) => re.test(String(name || '').trim())); if (l) { cc = l[1][hash(low) % l[1].length]; how = 'legal'; } }
  if (!cc) { const c = Object.keys(CITY).find((k) => new RegExp(`(^|\\s)${k}(\\s|$)`).test(low)); if (c) { cc = CITY[c]; how = 'city'; } }
  if (!cc || !COUNTRY_INFO[cc]) { cc = DEFAULT_POOL[hash(low) % DEFAULT_POOL.length]; how = how || 'guess'; }
  let ind = known ? known[1].ind : null;
  if (!ind) { const k = KEYWORDS.find(([, re]) => re.test(low)); ind = k ? k[0] : 'general'; }
  // 이름에 그 나라 도시가 들어 있으면 그 도시로
  const cityHit = (COUNTRY_INFO[cc]?.cities || []).find((c) => low.includes(c.toLowerCase()));
  const k = known ? known[1] : null;
  return { cc, ind, known: Boolean(known), how, city: (k && k.cc === cc && k.city) || cityHit || null, domain: k && k.cc === cc ? k.domain : null, knownName: k ? k.name : null, knownKey: known ? known[0] : null };
}

// 원문 이름 다듬기: 전부 소문자면 단어 첫 글자만 대문자로, 법인 형태가 없으면 그 나라 형태를 붙임
export function displayName(raw, cc) {
  let n = String(raw || '').trim().replace(/\s+/g, ' ');
  if (n === n.toLowerCase()) n = n.replace(/(^|[\s-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  const hasLegal = LEGAL.some(([re]) => re.test(n)) || LEGAL_POOL.some(([re]) => re.test(n)) || /\b(ltd|limited|co\.?,? ltd|company|corp|inc|group|holdings?|sa|s\.a|nv|n\.v|ag|se|plc|spa|s\.p\.a|oy|asa|a\/s|kgaa|co|est|llp)\.?$/i.test(n);
  if (hasLegal) return n;
  const info = COUNTRY_INFO[cc];
  return info.prefix ? `${info.suffix} ${n}` : `${n} ${info.suffix}`;
}
