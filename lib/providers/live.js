// 실데이터 공급자 — 여러 공개·유료 출처를 동시에 조회해 하나의 Profile 로 합칩니다.
//   DATA_PROVIDER=live 로 켭니다. 키가 없는 출처는 건너뛰고, 리포트에 '미연결'로 표시됩니다.
//
//   출처                      영역                       비용        필요한 환경변수
//   GLEIF (LEI 등록부)         법인 실재·설립일·상태       무료        없음
//   RDAP (도메인 등록 정보)     웹사이트 개설 시기          무료        없음
//   OpenSanctions             제재·수출통제·사기 명단      유료(상업)  OPENSANCTIONS_API_KEY
//   Creditsafe                신용점수·소송·파산          유료        CREDITSAFE_USERNAME / PASSWORD
//   ImportGenius 등           통관(B/L) 실적              유료        IMPORTGENIUS_TOKEN (매핑 필요)
//
// 후보 id 형식
//   lei:<LEI>~d=<도메인>            GLEIF 에서 찾은 법인
//   cs:<connectId>~c=<국가>~lei=…  Creditsafe 에서 찾은 법인
//   q:<JSON>                       등기에서 찾지 못한 회사 (이름·도메인·국가만으로 조회)
import * as gleif from '../sources/gleif.js';
import * as rdap from '../sources/rdap.js';
import * as sanctions from '../sources/opensanctions.js';
import * as creditsafe from '../sources/creditsafe.js';
import * as importgenius from '../sources/importgenius.js';
import { cached } from '../server/cache.js';
import { countryName, countryCodeFrom } from '../countries.js';

export const PROVIDER_ID = 'live';
export const PROVIDER_LABEL = '실데이터';

const LEGAL = /\b(llc|l\.l\.c|ltd|limited|inc|incorporated|corp|corporation|co|company|gmbh|ag|bv|nv|sa|sas|sarl|spa|srl|plc|fze|fzco|fz|llp|pte|pty|jsc|ooo|as|ab|oy|kk|tbk|pt|sdn|bhd|trading|group|holding|holdings|international|intl|the)\b\.?/g;
const fold = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ');
// 느슨한 이름(법인 형태·흔한 단어 제거) — 도메인과 회사명 연관성 확인에만 사용
export const normName = (s) => fold(s).replace(LEGAL, ' ').replace(/[^a-z0-9가-힣]+/g, ' ').trim();
// 엄격한 이름(문장부호만 정리, 법인 형태 유지) — 서로 다른 출처의 회사를 '같은 회사'로 맞출 때 사용
//   "ACME GLOBAL TRADING L.L.C" = "Acme Global Trading LLC",  "Sun Trading LLC" ≠ "Sun Holdings Ltd"
export const strictName = (s) => fold(s).replace(/\./g, '').replace(/[^a-z0-9가-힣]+/g, ' ').trim();
const compactNo = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const LEI_RE = /^[A-Z0-9]{20}$/;
const CS_RE = /^[A-Za-z0-9_-]{1,64}$/;
const CC_RE = /^[A-Z]{2}$/;
const cleanCc = (v) => (typeof v === 'string' && CC_RE.test(v.toUpperCase()) ? v.toUpperCase() : null);
const cleanName = (v) => (typeof v === 'string' ? v.trim().slice(0, 160) : '');
const cleanDomain = (v) => (typeof v === 'string' && v ? rdap.extractDomain(v) : null);
const dec = (v) => { try { return decodeURIComponent(v); } catch { return null; } };

function encodeQ(obj) { return 'q:' + encodeURIComponent(JSON.stringify(obj)); }
export function parseId(id) {
  if (typeof id !== 'string' || id.length > 1000) return null;
  if (id.startsWith('q:')) {
    let o;
    try { o = JSON.parse(dec(id.slice(2)) ?? 'x'); } catch { return null; }
    if (!o || typeof o !== 'object') return null;
    const name = cleanName(o.n);
    if (!strictName(name)) return null;
    return { kind: 'q', name, domain: cleanDomain(o.d), countryCode: cleanCc(o.c) };
  }
  const [head, ...rest] = id.split('~');
  const opts = {};
  for (const part of rest) {
    const i = part.indexOf('=');
    if (i < 1) return null;
    const v = dec(part.slice(i + 1));
    if (v === null) return null;
    opts[part.slice(0, i)] = v;
  }
  const common = { domain: cleanDomain(opts.d), name: cleanName(opts.n) || null, countryCode: cleanCc(opts.c) };
  if (head.startsWith('lei:')) {
    const lei = head.slice(4);
    return LEI_RE.test(lei) ? { kind: 'lei', lei, ...common } : null;
  }
  if (head.startsWith('cs:')) {
    const csId = head.slice(3);
    if (!CS_RE.test(csId)) return null;
    return { kind: 'cs', csId, lei: LEI_RE.test(opts.lei || '') ? opts.lei : null, ...common };
  }
  return null;
}
const withOpts = (head, o) => [head, ...Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`)].join('~');

// 사용자가 입력한 문자열 해석: "Northwind Global, AE" · "buyer@northwind.ae" · "northwind.ae/de" · LEI 20자리
export function parseQuery(query, country) {
  let q = String(query || '').trim().slice(0, 200);
  let cc = countryCodeFrom(country);
  // 웹사이트·이메일이면 그대로 도메인으로 해석 (주소 뒤의 /de 같은 경로를 국가로 읽지 않음)
  const domain = /[.@]/.test(q) && !/\s/.test(q) ? rdap.extractDomain(q) : null;
  if (!domain) {
    const m = q.match(/^(.*?)[,(]\s*([A-Za-z가-힣 ]{2,})\)?\s*$/);
    if (!cc && m && countryCodeFrom(m[2])) { cc = countryCodeFrom(m[2]); q = m[1].trim(); }
  }
  const compact = q.replace(/\s/g, '').toUpperCase();
  const lei = LEI_RE.test(compact) ? compact : null;
  const name = domain ? domain.split('.')[0].replace(/-/g, ' ') : q;
  return { name, domain, lei, countryCode: cc };
}

const deadlineFrom = () => Date.now() + Number((typeof process !== 'undefined' && process.env?.LIVE_DEADLINE_MS) || 20000);

export async function searchCompanies(query, { country, allowPaid = true } = {}) {
  const p = parseQuery(query, country);
  const deadline = deadlineFrom();
  if (p.lei) {
    const c = await gleif.getByLei(p.lei, { deadline }).catch(() => null);
    if (c) return [leiCandidate(c, p.domain)];
  }
  if (!strictName(p.name)) return [];
  const [g, cs] = await Promise.allSettled([
    gleif.enabled() ? cached('gleif', JSON.stringify(['s', p.name.toLowerCase()]), () => gleif.search(p.name, { limit: 6, deadline })).then((r) => r.value) : [],
    allowPaid && creditsafe.enabled() && p.countryCode
      ? cached('creditsafe', JSON.stringify(['s', strictName(p.name), p.countryCode, p.domain || '']), () => creditsafe.search({ name: p.name, countryCode: p.countryCode, website: p.domain }, { deadline })).then((r) => r.value)
      : [],
  ]);
  let leis = g.status === 'fulfilled' ? g.value : [];
  if (p.countryCode) leis = leis.filter((c) => c.countryCode === p.countryCode);
  const css = cs.status === 'fulfilled' ? cs.value : [];

  const out = [];
  const used = new Set();
  for (const c of css) {
    const match = leis.find((l) => (l.regNo && c.regNo && compactNo(l.regNo) === compactNo(c.regNo)) || strictName(l.name) === strictName(c.name));
    if (match) used.add(match.lei);
    if (!CS_RE.test(String(c.connectId))) continue;
    out.push({
      id: withOpts(`cs:${c.connectId}`, { c: c.countryCode || p.countryCode, lei: match?.lei, d: p.domain, n: c.name }),
      name: c.name, country: countryName(c.countryCode || p.countryCode), countryCode: c.countryCode || p.countryCode,
      industry: [c.regNo && `등록번호 ${c.regNo}`, c.status].filter(Boolean).join(' · ') || '신용평가 등록 법인',
      city: c.city || '', domain: p.domain || '',
    });
  }
  for (const l of leis) if (!used.has(l.lei)) out.push(leiCandidate(l, p.domain));
  const list = out.slice(0, 6);
  // 이름이 비슷한 다른 회사가 잡힐 수 있어, 등기 후보가 있어도 '등기 없이 조회'를 함께 보여 사용자가 직접 고르게 합니다.
  list.push({
    id: encodeQ({ n: p.name, d: p.domain, c: p.countryCode }),
    name: p.domain ? `${p.domain} (입력한 웹사이트)` : `${p.name} (입력한 이름)`,
    country: p.countryCode ? countryName(p.countryCode) : '국가 미지정',
    countryCode: p.countryCode || '',
    industry: list.length ? '목록에 없으면 선택 — 등기 정보 없이 제재·도메인만 확인' : '공개 등기에서 찾지 못함 — 제재·도메인 정보로 확인',
    city: '', domain: p.domain || '',
  });
  return list;
}

function leiCandidate(c, domain) {
  return {
    id: withOpts(`lei:${c.lei}`, { d: domain, n: c.name, c: c.countryCode }),
    name: c.name,
    country: countryName(c.countryCode), countryCode: c.countryCode || '',
    industry: `LEI ${c.lei.slice(0, 4)}…${c.lei.slice(-4)} · ${c.entityStatus === 'ACTIVE' ? '활성 법인' : '비활성 법인'}`,
    city: c.city || '', domain: domain || '',
  };
}

const STATUS = { ok: '조회됨', none: '해당 기록 없음', off: '미연결', fail: '조회 실패', na: '해당 없음' };

// allowPaid=false 이면 유료 출처(제재 명단·신용평가·통관)를 부르지 않습니다. (로그인 없는 데모 등)
export async function getProfile(id, { now = new Date(), allowPaid = true } = {}) {
  const ref = parseId(id);
  if (!ref) return null;
  const deadline = deadlineFrom();
  const sources = [];
  const note = (name, status, detail, cachedAt) => sources.push({ name, status: STATUS[status], state: status, detail: detail || '', cachedAt: cachedAt || null });
  const paidOff = '로그인 후 실서비스에서 확인합니다';

  // 1) 법인 기본 정보
  let reg = null;
  if (ref.kind === 'lei' || ref.lei) {
    try {
      const r = await cached('gleif', JSON.stringify(['l', ref.lei]), () => gleif.getByLei(ref.lei, { deadline }));
      reg = r.value;
      note('GLEIF 법인 등록부', reg ? 'ok' : 'none', reg ? `LEI ${reg.lei}` : '', r.cachedAt);
    } catch (e) { note('GLEIF 법인 등록부', 'fail', e.message); }
  } else note('GLEIF 법인 등록부', 'none', 'LEI 미보유 (중소기업은 흔함)');

  const name = reg?.name || ref.name || '';
  if (!strictName(name)) return null;
  const countryCode = reg?.countryCode || ref.countryCode || null;
  const domain = ref.domain || null;
  const freeMail = domain ? rdap.isFreeMail(domain) : false;
  const keyOf = (src) => JSON.stringify([src, strictName(name), countryCode || '', compactNo(reg?.regNo), domain || '']);

  // 2) 나머지 출처 동시 조회 (전체 시간 제한 안에서)
  const csTask = allowPaid && creditsafe.enabled()
    ? (async () => {
        let csId = ref.csId;
        if (!csId && countryCode) {
          const found = await creditsafe.search({ name, countryCode, regNo: reg?.regNo, website: domain }, { deadline });
          const byNo = reg?.regNo ? found.find((f) => f.regNo && compactNo(f.regNo) === compactNo(reg.regNo)) : null;
          csId = (byNo || found.find((f) => strictName(f.name) === strictName(name)))?.connectId || null;
        }
        if (!csId || !CS_RE.test(String(csId))) return { value: null };
        return cached('creditsafe', JSON.stringify(['r', csId]), () => creditsafe.report(csId, { deadline }));
      })()
    : Promise.resolve('off');
  const [dom, sanc, cs, cust] = await Promise.allSettled([
    domain && !freeMail && rdap.enabled() ? cached('rdap', domain, () => rdap.lookup(domain, { deadline })) : Promise.resolve('na'),
    allowPaid && sanctions.enabled()
      ? cached('sanctions', keyOf('s'), () => sanctions.screenCompany({ name, countryCode, regNo: reg?.regNo, website: domain }, { deadline }))
      : Promise.resolve('off'),
    csTask,
    allowPaid && importgenius.enabled() ? cached('customs', keyOf('c'), () => importgenius.shipments({ name, countryCode })) : Promise.resolve('off'),
  ]);

  // 도메인 (나이는 지금 기준으로 계산)
  let domainInfo = null;
  if (freeMail) { domainInfo = { domain, freeMail: true, ageDays: null }; note('도메인 등록 정보(RDAP)', 'ok', `${domain}은 무료 메일 주소`); }
  else if (dom.status === 'fulfilled' && dom.value !== 'na') {
    const v = dom.value.value || {};
    domainInfo = { ...v, freeMail: false, ageDays: rdap.ageDaysOf(v.registeredAt, now) };
    if (v.notRegistered) note('도메인 등록 정보(RDAP)', 'ok', `${domain} · 등록되지 않은 도메인`, dom.value.cachedAt);
    else if (v.notFound) note('도메인 등록 정보(RDAP)', 'none', `${domain} · 이 국가 도메인은 등록 정보가 공개되지 않음`, dom.value.cachedAt);
    else note('도메인 등록 정보(RDAP)', v.registeredAt ? 'ok' : 'none', v.registeredAt ? `${domain} · ${String(v.registeredAt).slice(0, 10)} 등록` : '등록일 비공개', dom.value.cachedAt);
  } else if (dom.status === 'rejected') note('도메인 등록 정보(RDAP)', 'fail', dom.reason?.message);
  else note('도메인 등록 정보(RDAP)', 'na', '웹사이트·이메일을 입력하면 확인합니다');

  // 제재·사기 명단
  let sanctionHits = null;
  if (sanc.status === 'fulfilled' && sanc.value !== 'off') {
    sanctionHits = Array.isArray(sanc.value.value) ? sanc.value.value : [];
    note('제재·수출통제 명단(OpenSanctions)', sanctionHits.length ? 'ok' : 'none', sanctionHits.length ? `${sanctionHits.length}건 일치` : '일치 없음', sanc.value.cachedAt);
  } else if (sanc.status === 'rejected') note('제재·수출통제 명단(OpenSanctions)', 'fail', sanc.reason?.message);
  else note('제재·수출통제 명단(OpenSanctions)', 'off', !allowPaid && sanctions.enabled() ? paidOff : 'OPENSANCTIONS_API_KEY 필요');

  // 신용·소송·파산
  let credit = null;
  if (cs.status === 'fulfilled' && cs.value !== 'off') {
    credit = cs.value.value;
    note('신용평가(Creditsafe)', credit ? 'ok' : 'none', credit ? '' : '신용평가 DB에서 찾지 못함', cs.value.cachedAt);
  } else if (cs.status === 'rejected') note('신용평가(Creditsafe)', 'fail', cs.reason?.message);
  else note('신용평가(Creditsafe)', 'off', !allowPaid && creditsafe.enabled() ? paidOff : '계약 후 연결');

  // 통관
  let customs = null;
  if (cust.status === 'fulfilled' && cust.value !== 'off') { customs = cust.value.value; note('통관 기록', customs ? 'ok' : 'none', '', cust.value.cachedAt); }
  else if (cust.status === 'rejected') note('통관 기록', cust.reason?.kind === 'not_configured' ? 'off' : 'fail', cust.reason?.message);
  else note('통관 기록', 'off', '통관 데이터 계약 후 연결');

  const legalOk = Boolean(credit);
  const nameTokens = normName(name).split(' ').filter((t) => t.length >= 4);
  const domLabel = domain ? domain.replace(/\.[a-z.]+$/, '').replace(/[^a-z0-9]/g, '') : '';
  const domainMatches = domain && !freeMail && !domainInfo?.notRegistered && nameTokens.some((t) => domLabel.includes(t)) ? true : null;

  return {
    company: {
      id,
      name,
      country: countryName(countryCode),
      countryCode: countryCode || '',
      industry: '',
      city: reg?.city || '',
      founded: credit?.founded || reg?.founded || null,
      regNo: reg?.regNo || '',
      domain: domain || '',
      lei: reg?.lei || null,
    },
    identity: { domainMatchesCompany: domainMatches, addressVerified: reg || credit ? true : null, impersonates: null },
    registry: reg ? { lei: reg.lei, entityStatus: reg.entityStatus, registrationStatus: reg.registrationStatus } : null,
    domainInfo,
    sanctions: sanctionHits,
    customs,
    courts: [],
    insolvency: [],
    legal: legalOk ? { filings: credit.legalCount, insolvencies: credit.insolvencyCount } : null,
    credit: { score: credit?.score ?? null, provider: credit ? 'Creditsafe' : '' },
    fraud: (sanctionHits || []).filter((h) => h.severity === 'fraud').map((h) => ({ year: now.getFullYear(), kind: 'reported', note: `${h.name} — 공개 명단 일치 (${(h.datasets || []).slice(0, 2).join(', ')})`, source: h.url })),
    coverage: {
      identity: Boolean(reg || credit),
      sanctions: sanctionHits !== null,
      customs: customs !== null,
      courts: legalOk && credit.legalCount !== null,
      insolvency: legalOk && credit.insolvencyCount !== null,
      credit: credit?.score != null,
    },
    sourcesUsed: sources,
  };
}
