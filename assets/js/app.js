// Trade Checker 앱 — 조회, 리포트(거래 조건 계산기·품의서 문구), 조회 기록·비교, 관심 거래처, 요금제·결제
import { loadConfig, api, ApiError, getSession, signOut, demoStore } from '/assets/js/client.js';
import { buildReport, simulateDeal, approvalMemo, TERMS, GRADES } from '/lib/engine.js';
import * as sample from '/lib/providers/sample.js';
import { COUNTRIES } from '/lib/countries.js';
import { PRODUCTS, productAmount, won, VAT_RATE } from '/lib/products.js';

const PREVIEW = Boolean(window.TC_PREVIEW); // 미리보기 단일 HTML 파일에서만 true
const view = document.getElementById('view');
const state = { cfg: null, live: false, me: null };

// ---------------- 공통 도구 ----------------
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString('ko-KR') : '');
const usd = (n) => 'USD ' + Math.round(Number(n) || 0).toLocaleString('en-US');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GRADE_LABEL = { A: '안정', B: '양호', C: '주의', D: '위험', F: '경보' };
// 실데이터 여부: 서버가 live 공급자를 쓰거나, 미리보기 파일에서 '실데이터'를 고른 경우
const MODE_KEY = 'tc.datamode';
const OS_KEY = 'tc.oskey';
const previewLive = () => PREVIEW && Boolean(window.TC_LIVE) && store(MODE_KEY) === 'live';
const realData = () => state.cfg?.dataProviderId === 'live' || previewLive();
function applyPreviewKeys() {
  if (!PREVIEW || !window.process) return;
  const k = store(OS_KEY);
  if (k) window.process.env.OPENSANCTIONS_API_KEY = k; else delete window.process.env.OPENSANCTIONS_API_KEY;
}
const previewSources = () => ({ registry: true, domain: true, sanctions: Boolean(store(OS_KEY)), credit: false, customs: false });

function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key) || 'null');
    localStorage.setItem(key, JSON.stringify(value));
  } catch { return null; }
  return value;
}

function toast(msg) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch {}
  // 클립보드 API를 못 쓰는 환경(일부 사내 브라우저 등)을 위한 대체 동작
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  ta.remove();
  return ok;
}

function gradeBox(g, size = 64, label = true) {
  return `<span class="grade grade-${esc(g)}" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.58)}px" role="img" aria-label="${esc(g)}등급 ${GRADE_LABEL[g] || ''}"><b aria-hidden="true">${esc(g)}</b>${label ? `<small aria-hidden="true">${GRADE_LABEL[g] || ''}</small>` : ''}</span>`;
}

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/search';
  const [path, qs] = raw.split('?');
  return { parts: path.split('/').filter(Boolean), params: new URLSearchParams(qs || '') };
}

function handleError(err) {
  if (err instanceof ApiError && err.status === 401) {
    signOut();
    location.replace('/login.html?next=' + encodeURIComponent('/app/' + location.hash));
    return true;
  }
  return false;
}

function setActiveNav(name) {
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const on = a.dataset.nav === name;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

// 리포트 목록·단건 불러오기 (데모: 브라우저 저장소 / 실서비스: 서버)
async function listReports(scope = 'mine') {
  if (state.live) {
    const r = await api('reports?scope=' + scope);
    state.teamSize = r.teamSize || 1;
    return r.reports;
  }
  return demoStore.reports().map((r) => ({ id: r.id, company_name: r.company.name, country: r.company.country, grade: r.grade, created_at: r.createdAt }));
}
async function getReport(id) {
  if (state.live) {
    const d = await api('reports?id=' + encodeURIComponent(id));
    return { ...d.report, _owner: d.owner, _share: d.share };
  }
  return demoStore.report(id);
}

// ---------------- 요금제·사용량 ----------------
async function refreshMe() {
  if (!state.live) {
    state.me = { plan: 'free', planLabel: '데모', monthlyQuota: 0, periodRemaining: 0, credits: Infinity, watchLimit: 10, alerts: false, demo: true };
  } else {
    try {
      const r = await api('me');
      state.me = { ...r.profile, orders: r.orders, invite: r.invite || null };
    } catch (e) {
      if (handleError(e)) return;
      state.me = null;
    }
  }
  renderUsage();
}

function renderUsage() {
  const me = state.me;
  const chip = document.getElementById('planchip');
  const box = document.getElementById('usage');
  if (!me) { chip.textContent = ''; box.innerHTML = ''; return; }
  if (me.demo) {
    chip.innerHTML = `<span class="badge gray">데모</span><span class="hide-sm">${previewLive() ? '실데이터로 조회 중' : `${esc(state.cfg.dataProvider || '샘플 데이터')}로 체험 중`}</span>`;
    box.innerHTML = `<strong style="color:var(--ink)">데모 모드</strong><span>${previewLive() ? '공개 출처(법인 등록부·도메인)로 실제 회사를 조회합니다. 조회 화면에서 샘플 데이터로 되돌릴 수 있습니다.' : realData() ? '연결된 실데이터로 조회합니다. 회원·결제는 Supabase 연결 후 켜집니다.' : '샘플 데이터로 모든 기능을 무제한 체험할 수 있습니다.'}</span><span>검색창 바로가기 <span class="kbd">/</span></span>`;
    return;
  }
  const left = (me.monthlyQuota ? me.periodRemaining : 0) + me.credits;
  chip.innerHTML = `<span class="badge">${esc(me.planLabel)}</span><span>남은 조회 <strong>${left}</strong>건</span><span class="hide-sm muted">${esc(me.email || '')}</span>`;
  const pct = me.monthlyQuota ? Math.round((me.periodUsed / me.monthlyQuota) * 100) : 0;
  box.innerHTML = `
    <strong style="color:var(--ink)">${esc(me.planLabel)} 요금제</strong>
    ${me.monthlyQuota ? `<span>이번 주기 ${me.periodUsed} / ${me.monthlyQuota}건</span><div class="meter" aria-hidden="true"><span style="width:${pct}%"></span></div>` : ''}
    <span>단건 크레딧 ${me.credits}건</span>
    ${me.planExpiresAt ? `<span>${fmtDay(me.planExpiresAt)}까지</span>` : ''}
    <a class="btn btn-soft btn-sm" href="#/billing">요금제 보기</a>`;
}

// ---------------- 비교 바구니 ----------------
const CMP_KEY = 'tc.compare';
const cmpIds = () => (store(CMP_KEY) || []).slice(0, 3);
function setCmp(ids) { store(CMP_KEY, ids.slice(0, 3)); renderCmpBar(); }
function toggleCmp(id) {
  const ids = cmpIds();
  if (ids.includes(id)) { setCmp(ids.filter((x) => x !== id)); return false; }
  if (ids.length >= 3) { toast('비교는 최대 3곳까지 담을 수 있습니다.'); return null; }
  setCmp([...ids, id]);
  return true;
}
function renderCmpBar() {
  const bar = document.getElementById('cmpbar');
  if (!bar) return;
  const ids = cmpIds();
  const page = parseHash().parts[0];
  // 조회 기록·비교 화면에는 자체 버튼이 있으므로 떠 있는 막대를 숨깁니다
  bar.hidden = ids.length === 0 || page === 'compare' || page === 'history' || (PREVIEW && !location.hash.startsWith('#/'));
  document.body.classList.toggle('has-cmpbar', !bar.hidden);
  bar.innerHTML = `<span>비교함 <b>${ids.length}</b>/3</span><span style="display:flex;gap:6px"><button class="btn btn-sm" style="background:transparent;color:#C9D6EE" type="button" id="cmpClear">비우기</button><a class="btn btn-primary btn-sm" href="#/compare?ids=${ids.map(encodeURIComponent).join(',')}" ${ids.length < 2 ? 'aria-disabled="true" style="opacity:.55;pointer-events:none"' : ''}>${ids.length < 2 ? '1곳 더 담기' : '비교하기'}</a></span>`;
  const clear = document.getElementById('cmpClear');
  if (clear) clear.onclick = () => setCmp([]);
}

// ---------------- 바이어 조회 ----------------
const SAMPLES = [
  ['Northwind Global Trading LLC', 'Northwind', 'C'],
  ['Helvetia Industrial Supply AG', 'Helvetia', 'A'],
  ['Kestrel Imports BV', 'Kestrel', 'B'],
  ['Sahara Polymer Trading', 'Sahara', 'D'],
  ['Brightline Import Co.', 'Brightline', 'F'],
];

// 실데이터 체험용 실제 기업 (GLEIF 등록 확인, 2026-10)
const REAL_SAMPLES = [
  ['의료기기', [['Medtronic', 'Medtronic plc'], ['Siemens Healthineers', 'Siemens Healthineers AG'], ['Stryker', 'Stryker Corporation'], ['Philips', 'Koninklijke Philips N.V.']]],
  ['제약', [['Pfizer', 'Pfizer Inc.'], ['Novartis', 'Novartis AG'], ['Bayer', 'Bayer Aktiengesellschaft'], ['Sanofi', 'Sanofi']]],
  ['전기', [['Schneider Electric', 'Schneider Electric SE'], ['ABB', 'ABB Ltd'], ['Siemens', 'Siemens Aktiengesellschaft']]],
  ['방위', [['Lockheed Martin', 'Lockheed Martin Corporation'], ['BAE Systems', 'BAE Systems plc'], ['Rheinmetall', 'Rheinmetall Aktiengesellschaft'], ['Leonardo', 'Leonardo Societa per azioni']]],
];
function realSampleChips() {
  return `<div class="real-samples">${REAL_SAMPLES.map(([ind, list]) => `<div class="chips"><span class="muted" style="min-width:56px">${ind}</span>${list.map(([short, q]) => `<button type="button" class="chip" data-q="${esc(q)}">${esc(short)}</button>`).join('')}</div>`).join('')}</div>`;
}

function sourceChips() {
  const s = previewLive() ? previewSources() : state.cfg.sources || {};
  const items = [['registry', '법인 등록부'], ['domain', '도메인'], ['sanctions', '제재 명단'], ['credit', '신용평가'], ['customs', '통관']];
  return `<div class="chips"><span class="muted">연결된 데이터</span>${items.map(([k, l]) => `<span class="chip static ${s[k] ? 'on' : 'off'}">${s[k] ? '●' : '○'} ${l}</span>`).join('')}</div>`;
}

function viewSearch(params) {
  setActiveNav('search');
  const q = params.get('q') || '';
  view.innerHTML = `
    ${inviteBanner()}
    <section class="search-hero">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><span class="eyebrow">바이어 신용 검증</span>${PREVIEW && window.TC_LIVE ? `<div class="seg" role="group" aria-label="데이터 선택"><button type="button" data-mode="sample" aria-pressed="${!previewLive()}">샘플 데이터</button><button type="button" data-mode="live" aria-pressed="${previewLive()}">실데이터</button></div>` : ''}</div>
      <h1>어떤 바이어를 확인할까요?</h1>
      <p class="muted" style="margin:0">${realData() ? '영문 회사명, 바이어 이메일 주소, 웹사이트 주소 중 하나를 입력하세요. 국가를 고르면 더 정확하게 찾습니다.' : '영문 회사명, 사업자등록번호, 웹사이트 주소 중 아는 것 하나만 입력하세요. 철자가 조금 달라도 찾아 드립니다.'}</p>
      <form class="searchbox with-country" id="searchForm" role="search">
        <label class="sr" for="q">바이어 회사명, 이메일, 사업자번호 또는 URL</label>
        <input id="q" name="q" type="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${realData() ? '예: Siemens AG 또는 buyer@company.ae' : '예: Northwind Global Trading LLC'}" value="${esc(q)}" required minlength="2">
        ${true ? `<label class="sr" for="qc">바이어 국가</label><select id="qc" class="country-select"><option value="">국가 (선택)</option>${Object.entries(COUNTRIES).filter(([k]) => !['KR', 'KP'].includes(k)).sort((a, b) => a[1].localeCompare(b[1], 'ko')).map(([k, v]) => `<option value="${k}" ${params.get('c') === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>` : ''}
        <button class="btn btn-primary" type="submit">안전 등급 조회</button>
      </form>
      ${previewLive() ? `<details class="oskey"><summary>제재 명단 API 키 넣기 (선택)</summary><div><p class="muted" style="margin:0 0 8px;font-size:13px">OpenSanctions API 키를 넣으면 제재·수출통제·사기 명단도 확인합니다. 키는 이 브라우저에만 저장됩니다. 실제 서비스에서는 서버 환경변수에 넣습니다.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><input class="input" id="osKey" type="password" autocomplete="off" placeholder="API 키" value="${esc(store(OS_KEY) || '')}" style="flex:1 1 220px;min-width:0"><button class="btn btn-soft btn-sm" type="button" id="osSave">저장</button></div></div></details>` : ''}
      ${realData() && !state.live ? realSampleChips() : ''}
      ${realData() ? sourceChips() : `<div class="chips"><span class="muted">샘플 바이어로 체험</span>${SAMPLES.map(([full, short, g]) => `<button type="button" class="chip" data-q="${esc(full)}">${esc(short)} <span class="muted">· ${g}</span></button>`).join('')}</div>`}
    </section>
    <div id="result"></div>
    <section class="tips" aria-label="이렇게 쓰면 좋아요">
      <div class="tip"><span class="ic" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 3v18M17 7H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span><span><b>거래 금액을 넣어 보세요</b>리포트에서 금액과 바이어가 요청한 조건을 넣으면 못 받을 수 있는 금액이 계산됩니다.</span></div>
      <div class="tip"><span class="ic" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 3h9l4 4v14H6V3Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 12h7M9 16h5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span><span><b>품의서 문구 한 번에</b>결재 올릴 때 붙여 넣을 보고 문구를 자동으로 만들어 드립니다.</span></div>
      <div class="tip"><span class="ic" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 6h7v12H4zM13 6h7v12h-7z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg></span><span><b>바이어끼리 비교</b>후보 바이어를 최대 3곳까지 나란히 놓고 고를 수 있습니다.</span></div>
    </section>
    <section class="card pad">
      <div class="sec-title">최근 조회 <a href="#/history" style="font-size:14px;font-weight:600">전체 보기</a></div>
      <div class="rows" id="recent"><p class="muted" style="margin:0">불러오는 중…</p></div>
    </section>`;
  bindInvite();
  const input = document.getElementById('q');
  document.getElementById('searchForm').onsubmit = (e) => { e.preventDefault(); runSearch(input.value.trim()); };
  view.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { store(MODE_KEY, b.dataset.mode); renderUsage(); viewSearch(new URLSearchParams()); }));
  const osSave = document.getElementById('osSave');
  if (osSave) osSave.onclick = () => { const v = document.getElementById('osKey').value.trim(); store(OS_KEY, v || null); applyPreviewKeys(); toast(v ? '제재 명단 검색을 켰습니다' : '키를 지웠습니다'); viewSearch(new URLSearchParams()); };
  document.getElementById('qc')?.addEventListener('change', () => input.value.trim().length >= 2 && runSearch(input.value.trim()));
  view.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => { input.value = b.dataset.q; runSearch(b.dataset.q); }));
  if (!q && matchMedia('(hover: hover)').matches) input.focus();
  renderRecent();
  if (q) runSearch(q, null, null, false); // 링크로 열린 검색은 후보만 보여 주고 차감하지 않음
}

async function renderRecent() {
  const box = document.getElementById('recent');
  if (!box) return;
  try {
    const list = await listReports();
    box.innerHTML = list.length ? list.slice(0, 5).map(rowHtml).join('') : '<p class="muted" style="margin:0">아직 조회한 바이어가 없습니다. 위의 샘플 바이어를 눌러 보세요.</p>';
  } catch (e) {
    if (!handleError(e)) box.innerHTML = `<p class="muted" style="margin:0">${esc(e.message)}</p>`;
  }
}

function rowHtml(r) {
  return `<a class="rowlink" href="#/report/${esc(r.id)}">${gradeBox(r.grade, 44, false)}<span style="min-width:0"><span class="name" style="display:block">${esc(r.company_name)}</span><span class="meta">${esc(r.country || '')}</span></span><span class="meta">${fmtDate(r.created_at)}</span></a>`;
}

function loadingHtml(name) {
  const steps = realData() ? ['법인 등록부 확인', '도메인 개설 시기', '제재·수출통제 명단', '신용·소송·파산', '결제 조건 처방'] : ['법인 식별', '관세 통관 기록', '현지 법원·파산 공고', '글로벌 신용평가', '결제 조건 처방'];
  return `<section class="card loading" aria-busy="true" aria-live="polite"><strong>${esc(name)} 분석 중…</strong>${steps
    .map((s, i) => `<div class="row"><span style="width:150px;flex:0 0 auto">${s}</span><span class="bar"><span style="animation-delay:${i * 0.22}s"></span></span></div>`)
    .join('')}</section>`;
}

async function runSearch(query, companyId = null, label = null, autoPick = true) {
  const out = document.getElementById('result');
  if (!out) return;
  if (!companyId && (!query || query.length < 2)) { out.innerHTML = '<div class="notice warn">회사명, 사업자번호 또는 URL을 2자 이상 입력해 주세요.</div>'; return; }
  out.innerHTML = loadingHtml(label || query);
  out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  const started = Date.now();
  try {
    let result;
    if (previewLive()) {
      applyPreviewKeys();
      const L = window.TC_LIVE;
      let id = companyId;
      if (!id) {
        const country = document.getElementById('qc')?.value || '';
        const cands = await L.searchCompanies(query, { country });
        if (cands.length > 1) result = { candidates: cands };
        else id = cands[0].id;
      }
      if (id) {
        const profile = await L.getProfile(id);
        if (!profile) throw new Error('회사 정보를 불러오지 못했습니다.');
        const report = buildReport(profile, { providerLabel: '실데이터 (공개 출처 · 미리보기)', id: 'demo-' + Date.now().toString(36) });
        report.query = query;
        demoStore.saveReport(report);
        result = { report };
      }
    } else if (state.live || realData()) {
      const country = document.getElementById('qc')?.value || '';
      result = await api('search', { method: 'POST', body: { query, companyId, country, autoPick } });
      if (result.report && !state.live) { result.report.query = query; demoStore.saveReport(result.report); }
    } else {
      let id = companyId;
      if (!id) {
        const cands = await sample.searchCompanies(query, { country: document.getElementById('qc')?.value || '' });
        if (!cands.length) throw new Error('일치하는 회사를 찾지 못했습니다. 영문 회사명이나 웹사이트 주소로 다시 검색해 보세요.');
        if (cands.length > 1) result = { candidates: cands };
        else id = cands[0].id;
      }
      if (id) {
        const profile = await sample.getProfile(id);
        const report = buildReport(profile, { providerLabel: sample.PROVIDER_LABEL, id: 'demo-' + Date.now().toString(36) });
        report.query = query;
        demoStore.saveReport(report);
        result = { report };
      }
    }
    const wait = 1400 - (Date.now() - started);
    if (wait > 0) await sleep(wait);
    if (result.candidates) {
      out.innerHTML = `<section class="card pad"><div class="sec-title" style="flex-wrap:wrap">${realData() ? '어느 회사인지 골라 주세요' : `일치하는 회사가 ${result.candidates.length}곳 있습니다`} <span class="muted" style="font-size:13px;font-weight:500">국가·도시·도메인을 확인하고 고르세요 (선택 후 1건 차감)</span></div><div class="candidates">${result.candidates
        .map((c) => `<button type="button" class="candidate" data-id="${esc(c.id)}" data-name="${esc(c.name)}"><span style="min-width:0"><strong style="display:block">${esc(c.name)}</strong><span class="muted" style="font-size:13.5px">${[c.country, c.city, c.industry].filter(Boolean).map(esc).join(' · ')}${c.domain ? `<br>${esc(c.domain)}` : ''}</span></span><span class="btn btn-soft btn-sm" aria-hidden="true">선택</span></button>`)
        .join('')}</div></section>`;
      out.querySelectorAll('.candidate').forEach((b) => (b.onclick = () => runSearch(query, b.dataset.id, b.dataset.name)));
      out.querySelector('.candidate')?.focus();
      return;
    }
    if (state.live) refreshMe();
    location.hash = '#/report/' + result.report.id;
  } catch (e) {
    if (handleError(e)) return;
    const quota = e instanceof ApiError && e.status === 402;
    out.innerHTML = `<div class="notice ${quota ? 'warn' : 'danger'}" role="alert">${esc(e.message)}${quota ? ' <a href="#/billing">요금제 보기 →</a>' : ''}</div>`;
  }
}

// ---------------- 리포트 ----------------
const DEAL_KEY = 'tc.deal';

async function viewReport(id) {
  setActiveNav('history');
  view.innerHTML = '<section class="card pad">리포트를 불러오는 중…</section>';
  let r;
  try {
    r = await getReport(id);
    if (!r) throw new Error('리포트를 찾을 수 없습니다. 이 브라우저에서 조회한 기록만 볼 수 있습니다.');
  } catch (e) {
    if (!handleError(e)) view.innerHTML = `<div class="notice danger">${esc(e.message)} <a href="#/search">조회하러 가기</a></div>`;
    return;
  }
  const c = r.company;
  const groups = {};
  r.signals.forEach((s) => (groups[s.group] = groups[s.group] || []).push(s));
  const email = `Subject: ${r.guide.emailSubject}\n\n${r.guide.emailBody}`;
  const deal = store(DEAL_KEY) || { amount: 50000, term: 'tt60' };
  const inCmp = cmpIds().includes(r.id);

  view.innerHTML = `
    <div class="print-only" style="font-size:12px;color:#566273;margin-bottom:8px">Trade Checker 바이어 신용 검증 리포트 · 조회 ${esc(fmtDate(r.createdAt))} · 리포트 번호 ${esc(r.id)}</div>
    <section class="card pad" style="display:flex;flex-direction:column;gap:18px">
      <div class="report-id">
        ${gradeBox(r.grade, 84)}
        <div style="min-width:0;display:flex;flex-direction:column;gap:6px">
          <h1 style="font-size:clamp(22px,2.6vw,30px)">${esc(c.name)}</h1>
          <span class="muted" style="font-size:14px">${[c.country, c.city, c.industry, c.founded ? `설립 ${c.founded}` : '', c.domain, c.lei ? `LEI ${c.lei}` : ''].filter(Boolean).map(esc).join(' · ')}</span>
          <span style="font-size:15px">${esc(r.summary)}</span>
          ${r._owner && !r._owner.mine ? `<span class="badge gray" style="align-self:flex-start">팀원 ${esc(r._owner.email || '')}님이 조회</span>` : ''}
          ${r.coverage ? coverageMeter(r.coverage) : ''}
        </div>
      </div>
      <div class="actbar report-actions">
        <button class="btn btn-primary btn-sm" id="actMemo" type="button">품의서 문구 복사</button>
        <button class="btn btn-ghost btn-sm" id="actPdf" type="button">PDF로 저장</button>
        <button class="btn btn-ghost btn-sm" id="actShare" type="button">${r._share ? '공유 링크 복사' : '공유 링크 만들기'}</button>
        <button class="btn btn-ghost btn-sm" id="actWatch" type="button">관심 거래처 추가</button>
        <button class="btn btn-ghost btn-sm" id="actCmp" type="button" aria-pressed="${inCmp}">${inCmp ? '비교함에서 빼기' : '비교함에 담기'}</button>
        <button class="btn btn-soft btn-sm" id="actAgain" type="button">다시 조회</button>
      </div>
    </section>
    ${c.generated ? `<div class="notice warn" role="note"><b>가상 리포트입니다.</b> ${c.knownCompany ? '실제 기업 이름이지만, 샘플 모드라 아래 수치(통관·신용 등)는 실제 정보가 아닙니다.' : '샘플 목록에 없는 회사라, 입력한 이름·국가·업종에 맞춰 만든 예시 데이터입니다.'} 실제 정보는 실데이터 연결(DATA_PROVIDER=live) 후 확인하세요.</div>` : ''}
    ${PREVIEW && r.sources.some((s) => s.state === 'fail') ? `<div class="notice danger" role="note"><b>일부 출처에 연결하지 못했습니다.</b> 이 파일을 내 컴퓨터에서 직접 열면 브라우저 보안 정책(CORS)이나 회사 방화벽 때문에 막힐 수 있습니다. Vercel에 배포해 <code>DATA_PROVIDER=live</code>로 두면 서버에서 조회하므로 이 제한이 없습니다.</div>` : ''}
    ${r.capped ? `<div class="notice warn" role="note"><b>정보가 부족해 등급을 보수적으로 매겼습니다.</b> 확인한 항목만 보면 ${esc(r.capped.from)}등급이지만, ${esc(r.coverage.missing.join(' · '))} 정보를 확인하지 못해 ${esc(r.capped.to)}등급으로 표시합니다. 바이어에게 사업자등록증·은행 확인서를 요청하거나 무역보험공사 신용조사로 보완하세요.</div>` : ''}

    <section class="card pad">
      <div class="sec-title" style="flex-wrap:wrap">거래 조건 계산기 <span class="muted" style="font-size:13px;font-weight:500">바이어 요청 조건으로 진행하면 얼마를 못 받을 수 있을까?</span></div>
      <div class="sim">
        <div class="sim-in">
          <div class="field"><label for="dealAmt">거래 예정 금액</label><div class="money"><span>USD</span><input class="input" id="dealAmt" inputmode="numeric" autocomplete="off" value="${Number(deal.amount).toLocaleString('en-US')}"></div></div>
          <div class="presets" aria-label="금액 빠른 선택">${[10000, 50000, 100000, 300000].map((v) => `<button type="button" data-amt="${v}">${v >= 1000 ? v / 1000 + 'K' : v}</button>`).join('')}</div>
          <div class="field"><label for="dealTerm">바이어가 요청한 결제 조건</label><select class="input" id="dealTerm">${Object.entries(TERMS).map(([k, t]) => `<option value="${k}" ${k === deal.term ? 'selected' : ''}>${t.label}</option>`).join('')}</select></div>
        </div>
        <div class="expo" id="dealOut" aria-live="polite"></div>
      </div>
    </section>

    <section class="guide">
      <span class="mono" style="font-size:12px;color:#9DBBF7">결제 조건 가이드 · ${esc(r.grade)}등급</span>
      <h2>${esc(r.guide.primary)}</h2>
      <div class="grid-2" style="gap:24px">
        <div><strong style="display:block;margin-bottom:8px">권장 조건</strong><ul>${r.guide.terms.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>
        <div><strong style="display:block;margin-bottom:8px">대안 · 함께 확인할 것</strong><ul>${r.guide.alternatives.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>
      </div>
      <div class="email">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap"><strong>바이어에게 보낼 영문 문구</strong><button class="btn btn-sm no-print" style="background:#fff;color:#0B1A2E" id="actCopy" type="button">문구 복사</button></div>
        <p><b>Subject:</b> ${esc(r.guide.emailSubject)}<br><br>${esc(r.guide.emailBody)}</p>
      </div>
    </section>

    <section class="card pad">
      <div class="sec-title">왜 ${esc(r.grade)}등급인가요? <span class="muted" style="font-size:13px;font-weight:500">위험 점수 ${r.riskPoints}점</span></div>
      ${scaleHtml(r)}
    </section>

    <div class="grid-2">
      <section class="card pad">
        <div class="sec-title">항목별 확인 결과</div>
        ${Object.entries(groups)
          .map(([g, list]) => `<div style="margin-bottom:6px"><div class="muted" style="font-size:12.5px;font-weight:600;margin:10px 0 2px">${esc(g)}</div>${list
            .map((s) => `<div class="signal"><span class="dot ${esc(s.level)}" aria-hidden="true"></span><span>${esc(s.label)}</span><span class="v ${esc(s.level)}">${esc(s.value)}</span>${s.detail || s.link ? `<span class="d">${esc(s.detail || '')}${s.link && /^https:\/\//.test(s.link) ? ` <a href="${esc(s.link)}" target="_blank" rel="noopener">근거 보기 ↗</a>` : ''}</span>` : ''}</div>`)
            .join('')}</div>`)
          .join('')}
      </section>
      <div style="display:flex;flex-direction:column;gap:20px;min-width:0">
        <section class="card pad">
          <div class="sec-title">관세 통관 이력 <span class="muted" style="font-size:13px;font-weight:500">${r.customs ? `최근 12개월 ${r.customs.total12m}건` : '정보 제한'}</span></div>
          ${r.customs ? customsChart(r.customs) + `<p class="muted" style="font-size:13.5px;margin:12px 0 0">주요 품목: ${esc(r.customs.topProducts.join(', ') || '-')}<br>거래 국가: ${esc(r.customs.partnerCountries.join(', ') || '-')}</p>` : '<p class="muted">해당 국가의 통관 데이터가 제한적입니다.</p>'}
        </section>
        <section class="card pad">
          <div class="sec-title">법적 분쟁 · 파산</div>
          ${r.courts.length || r.insolvency.length ? `<ul class="list-plain">${r.courts
            .map((x) => `<li><span>${esc(x.year)} · ${x.kind === 'payment' ? '대금 청구' : '계약 분쟁'} (${esc(x.role)})<br><span class="muted" style="font-size:12.5px">${esc(x.court)}</span></span><span style="text-align:right;flex:0 0 auto"><span class="badge ${x.status === 'open' ? 'danger' : 'gray'}">${x.status === 'open' ? '진행 중' : '종결'}</span><br><span class="muted" style="font-size:12.5px">${usd(x.amountUSD)}</span></span></li>`)
            .join('')}${r.insolvency
            .map((x) => `<li><span>${esc(x.year)} · ${x.kind === 'bankruptcy' ? '파산' : '회생'} 절차</span><span class="badge ${x.status === 'active' ? 'danger' : 'gray'}">${x.status === 'active' ? '진행 중' : '종결'}</span></li>`)
            .join('')}</ul>` : r.coverage && !r.coverage.items.find((i) => i.key === 'courts').ok ? '<p class="muted" style="margin:0">소송·파산 기록은 신용평가 데이터가 연결되면 확인됩니다. 지금은 정보 제한 상태입니다.</p>' : '<p class="muted" style="margin:0">확인된 소송·파산 기록이 없습니다.</p>'}
        </section>
      </div>
    </div>

    <section class="card pad">
      <div class="sec-title">데이터 출처</div>
      ${r.sources.some((s) => s.state) ? `<ul class="list-plain src-list">${r.sources.map((s) => `<li><span>${esc(s.name)}${s.detail ? `<br><span class="muted" style="font-size:12.5px">${esc(s.detail)}</span>` : ''}</span><span style="text-align:right;flex:0 0 auto"><span class="badge ${s.state === 'ok' ? '' : s.state === 'fail' ? 'danger' : 'gray'}">${esc(s.status)}</span>${s.cachedAt ? `<br><span class="muted" style="font-size:12px">${esc(fmtDay(s.cachedAt))} 기준</span>` : ''}</span></li>`).join('')}</ul>` : `<div style="display:flex;flex-wrap:wrap;gap:8px">${r.sources.map((s) => `<span class="badge ${s.status === '조회됨' ? '' : 'gray'}">${esc(s.name)} · ${esc(s.status)}</span>`).join('')}</div>`}
      <p class="muted" style="font-size:13px;margin:14px 0 0">조회 ${esc(fmtDate(r.createdAt))} · 데이터: ${esc(r.dataMode)} · 엔진 ${esc(r.engineVersion)}<br>${esc(r.disclaimer)}</p>
    </section>`;

  // 거래 조건 계산기
  const amtEl = document.getElementById('dealAmt');
  const termEl = document.getElementById('dealTerm');
  const out = document.getElementById('dealOut');
  let current = null;
  const recalc = () => {
    const amount = Number(String(amtEl.value).replace(/[^\d]/g, '')) || 0;
    current = simulateDeal(r.grade, amount, termEl.value);
    store(DEAL_KEY, { amount, term: termEl.value });
    const max = Math.max(current.requested.exposure, current.recommended?.exposure || 0, 1);
    const toneCls = current.tone === 'ok' ? '' : current.tone;
    out.innerHTML = `
      <div class="notice ${toneCls}">${esc(current.verdict)}</div>
      <div class="expo-row"><div class="top"><span>바이어 요청 · ${esc(current.requested.label)}</span><b style="color:${current.acceptable ? 'var(--ink)' : '#B4321F'}">${usd(current.requested.exposure)}</b></div><div class="expo-bar" role="img" aria-label="요청 조건 위험 노출 ${usd(current.requested.exposure)}"><span style="width:${(current.requested.exposure / max) * 100}%;background:${current.acceptable ? '#8FB3F5' : '#D9583E'}"></span></div></div>
      ${current.recommended ? `<div class="expo-row"><div class="top"><span>권장 · ${esc(current.recommended.label)}</span><b>${usd(current.recommended.exposure)}</b></div><div class="expo-bar" role="img" aria-label="권장 조건 위험 노출 ${usd(current.recommended.exposure)}"><span style="width:${(current.recommended.exposure / max) * 100}%;background:#1D5BD6"></span></div></div>` : ''}
      ${current.saved > 0 && current.recommended ? `<div class="saved"><span>권장 조건으로 바꾸면 위험 노출이</span><b>${usd(current.saved)}</b><span>줄어듭니다${current.recommended.prepay ? ` · 선적 전 수령액 ${usd(current.recommended.prepay)}` : ''}</span></div>` : ''}
      <p class="muted" style="font-size:12.5px;margin:0">위험 노출액 = 선적 후에도 받지 못한 상태로 남는 금액. 신용장은 은행이 지급을 보증하므로 0으로 계산합니다.</p>`;
  };
  amtEl.addEventListener('input', () => {
    const digits = amtEl.value.replace(/[^\d]/g, '').slice(0, 10);
    amtEl.value = digits ? Number(digits).toLocaleString('en-US') : '';
    recalc();
  });
  termEl.onchange = recalc;
  view.querySelectorAll('[data-amt]').forEach((b) => (b.onclick = () => { amtEl.value = Number(b.dataset.amt).toLocaleString('en-US'); recalc(); }));
  recalc();

  document.getElementById('actPdf').onclick = () => window.print();
  document.getElementById('actShare').onclick = async (ev) => {
    const btn = ev.currentTarget;
    if (!state.live) { toast('공유 링크는 로그인하는 실서비스에서 만들 수 있습니다. 지금은 PDF로 저장해 공유하세요.'); return; }
    btn.disabled = true;
    try {
      const d = await api('share', { method: 'POST', body: { reportId: r.id } });
      r._share = { token: d.token, expiresAt: d.expiresAt };
      const url = location.origin + d.path;
      const ok = await copyText(url);
      btn.textContent = '공유 링크 복사';
      shareNote(url, d.expiresAt, ok);
    } catch (e) {
      if (!handleError(e)) toast(e.message);
    } finally { btn.disabled = false; }
  };
  if (r._share) setTimeout(() => shareNote(location.origin + '/share.html?t=' + r._share.token, r._share.expiresAt, false), 0);
  function shareNote(url, expiresAt, copied) {
    let box = document.getElementById('shareNote');
    if (!box) { box = document.createElement('div'); box.id = 'shareNote'; box.className = 'notice no-print'; view.querySelector('.report-actions').after(box); }
    box.innerHTML = `${copied ? '<b>링크를 복사했습니다.</b> ' : '<b>공유 중인 링크가 있습니다.</b> '}로그인 없이 볼 수 있는 읽기 전용 링크입니다 · ${esc(fmtDay(expiresAt))}까지 유효 (신용평가 원자료는 링크에서 가려짐)<br><span style="word-break:break-all;font-size:13px">${esc(url)}</span> <button type="button" class="btn btn-ghost btn-sm" id="shareOff" style="margin-left:6px">링크 끄기</button>`;
    document.getElementById('shareOff').onclick = async () => {
      try { await api('share?id=' + encodeURIComponent(r.id), { method: 'DELETE' }); r._share = null; box.remove(); document.getElementById('actShare').textContent = '공유 링크 만들기'; toast('공유 링크를 껐습니다. 이전 링크로는 더 이상 열 수 없습니다.'); }
      catch (e) { if (!handleError(e)) toast(e.message); }
    };
  }
  document.getElementById('actMemo').onclick = async () => {
    const ok = await copyText(approvalMemo(r, current));
    toast(ok ? '품의서 문구를 복사했습니다. 결재 문서에 붙여 넣으세요.' : '복사하지 못했습니다.');
  };
  document.getElementById('actCopy').onclick = async () => toast((await copyText(email)) ? '영문 문구를 복사했습니다.' : '복사하지 못했습니다. 직접 선택해 복사해 주세요.');
  document.getElementById('actCmp').onclick = (ev) => {
    const res = toggleCmp(r.id);
    if (res === null) return;
    ev.currentTarget.textContent = res ? '비교함에서 빼기' : '비교함에 담기';
    ev.currentTarget.setAttribute('aria-pressed', String(res));
    toast(res ? '비교함에 담았습니다.' : '비교함에서 뺐습니다.');
  };
  document.getElementById('actAgain').onclick = () => {
    location.hash = '#/search';
    setTimeout(() => runSearch(c.name, c.id, c.name), 0);
  };
  document.getElementById('actWatch').onclick = async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    try {
      if (state.live) {
        const res = await api('watchlist', { method: 'POST', body: { reportId: r.id } });
        toast(res.already ? '이미 관심 거래처에 있습니다.' : '관심 거래처에 추가했습니다.');
      } else {
        const list = demoStore.watch();
        if (list.some((w) => w.company_id === c.id)) toast('이미 관심 거래처에 있습니다.');
        else {
          list.unshift({ id: 'w-' + Date.now().toString(36), company_id: c.id, company_name: c.name, country: c.country, last_grade: r.grade, last_report_id: r.id, checked_at: new Date().toISOString() });
          demoStore.saveWatch(list);
          toast('관심 거래처에 추가했습니다.');
        }
      }
    } catch (e) {
      if (!handleError(e)) toast(e.message);
    } finally {
      btn.disabled = false;
    }
  };
}

function coverageMeter(cv) {
  return `<div class="cov cov-${esc(cv.level)}" title="확인된 영역 ${cv.covered}/${cv.total}"><span class="cov-label">데이터 충실도</span><span class="cov-bar" aria-hidden="true">${cv.items.map((i) => `<i class="${i.ok ? 'ok' : ''}"></i>`).join('')}</span><span class="cov-num">${cv.covered}/${cv.total}</span><span class="cov-items">${cv.items.map((i) => `<span class="${i.ok ? 'ok' : 'no'}">${i.ok ? '✓' : '–'} ${esc(i.label)}</span>`).join('')}</span></div>`;
}

function scaleHtml(r) {
  const t = r.thresholds || { A: 8, B: 24, C: 44, D: 69 };
  const max = Math.max(t.D + 21, r.riskPoints + 6);
  const bounds = [['A', 0, t.A], ['B', t.A, t.B], ['C', t.B, t.C], ['D', t.C, t.D], ['F', t.D, max]];
  const cols = bounds.map(([, a, b]) => `${b - a}fr`).join(' ');
  const pos = Math.min((r.riskPoints / max) * 100, 99);
  const colors = { A: '#1D5BD6', B: '#8FB3F5', C: '#F0C88A', D: '#D9583E', F: '#6E1D12' };
  const contrib = r.signals.filter((s) => s.points > 0).sort((a, b) => b.points - a.points);
  const top = contrib[0]?.points || 1;
  return `
    <div class="scale" role="img" aria-label="위험 점수 ${r.riskPoints}점, ${r.grade}등급 구간">
      <span class="pin" style="left:${pos}%">${r.riskPoints}점</span>
      <div class="zones" style="grid-template-columns:${cols}">${bounds.map(([g]) => `<span style="background:${colors[g]}"></span>`).join('')}</div>
      <div class="labels" style="grid-template-columns:${cols}">${bounds.map(([g]) => `<span style="${g === r.grade ? 'color:var(--ink);font-weight:700' : ''}">${g}</span>`).join('')}</div>
    </div>
    ${contrib.length ? `<p class="muted" style="font-size:13.5px;margin:12px 0 0">점수를 올린 항목</p><ul class="contrib">${contrib
      .map((s) => `<li><span>${esc(s.label)} <span class="muted">· ${esc(s.value)}</span></span><span class="b"><span style="width:${(s.points / top) * 100}%"></span></span><span class="p">+${s.points}</span></li>`)
      .join('')}</ul>` : '<p class="muted" style="font-size:14px;margin:12px 0 0">점수를 올린 위험 항목이 없습니다.</p>'}
    ${r.grade === 'F' && r.signals.some((s) => s.key === 'sanctions' && s.level === 'danger') ? '<p class="notice danger" style="margin:12px 0 0">제재·수출통제 명단과 일치해 점수와 관계없이 F등급으로 고정했습니다.</p>' : r.grade === 'F' && r.signals.some((s) => (s.key === 'fraud' || s.key === 'impersonation') && s.level === 'danger') ? '<p class="notice danger" style="margin:12px 0 0">사기·사칭 이력이 확인되어 점수와 관계없이 F등급으로 고정했습니다.</p>' : ''}`;
}

function customsChart(cu) {
  const w = 480, h = 150, pad = 22, max = Math.max(...cu.monthly, 1);
  const bw = (w - pad * 2) / 12;
  const bars = cu.monthly
    .map((v, i) => {
      const bh = Math.round((v / max) * (h - 44));
      const x = pad + i * bw + 4;
      const y = h - 24 - bh;
      return `<rect x="${x}" y="${y}" width="${bw - 8}" height="${Math.max(bh, v ? 2 : 0)}" rx="3" fill="${i >= 9 ? '#1D5BD6' : '#8FB3F5'}"><title>${esc(cu.months[i])}: ${v}건</title></rect>${i % 2 === 1 || i === 11 ? `<text x="${x + (bw - 8) / 2}" y="${h - 8}" text-anchor="middle" font-size="10" fill="#566273">${esc(cu.months[i])}</text>` : ''}`;
    })
    .join('');
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="최근 12개월 월별 통관 건수, 합계 ${cu.total12m}건">${bars}<line x1="${pad}" y1="${h - 24}" x2="${w - pad}" y2="${h - 24}" stroke="#DDE2E8"/></svg>`;
}

// ---------------- 조회 기록 + 비교 선택 ----------------
async function viewHistory(params) {
  setActiveNav('history');
  let grade = params.get('grade') || 'all';
  const scope = params.get('scope') === 'team' ? 'team' : 'mine';
  let text = '';
  view.innerHTML = `<section class="card pad">
      <div class="sec-title" style="flex-wrap:wrap">조회 기록 <span class="muted" style="font-size:13px;font-weight:500">체크해서 최대 3곳을 나란히 비교할 수 있습니다</span><span style="flex:1"></span><span id="scopeBox"></span><button class="btn btn-ghost btn-sm" id="csvGo" type="button">CSV 내보내기</button></div>
      <div class="filters" role="group" aria-label="등급 필터"><span id="gradeChips" style="display:flex;flex-wrap:wrap;gap:6px"></span><label class="sr" for="hq">회사명 검색</label><input class="input" id="hq" type="search" placeholder="회사명·국가로 찾기"></div>
      <div class="rows" id="hist">불러오는 중…</div>
      <div style="display:flex;justify-content:flex-end;margin-top:14px"><button class="btn btn-primary" id="compareGo" type="button" disabled>선택한 바이어 비교</button></div>
    </section>`;
  let list;
  try { list = await listReports(scope); } catch (e) {
    if (!handleError(e)) document.getElementById('hist').innerHTML = `<div class="notice danger">${esc(e.message)}</div>`;
    return;
  }
  if (state.live && (state.teamSize || 1) > 1) {
    document.getElementById('scopeBox').innerHTML = `<div class="seg" role="group" aria-label="보기 범위"><button type="button" data-scope="mine" aria-pressed="${scope === 'mine'}">내 조회</button><button type="button" data-scope="team" aria-pressed="${scope === 'team'}">팀 전체 ${state.teamSize}명</button></div>`;
    view.querySelectorAll('[data-scope]').forEach((b) => (b.onclick = () => { location.hash = '#/history' + (b.dataset.scope === 'team' ? '?scope=team' : ''); }));
  }
  document.getElementById('csvGo').onclick = () => {
    const rows = list.filter((r) => (grade === 'all' || r.grade === grade) && (!text || `${r.company_name} ${r.country}`.toLowerCase().includes(text)));
    if (!rows.length) { toast('내보낼 기록이 없습니다.'); return; }
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/^[=+\-@\t\r]/, "'$&")}"`;
    const head = ['조회일시', '회사명', '국가', '등급', '조회자', '리포트 번호'];
    const lines = rows.map((r) => [fmtDate(r.created_at), r.company_name, r.country, r.grade, r.author || '나', r.id].map(cell).join(','));
    const blob = new Blob(['\ufeff' + [head.map(cell).join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `trade-checker-조회기록-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const chipsEl = document.getElementById('gradeChips');
  const histEl = document.getElementById('hist');
  const go = document.getElementById('compareGo');
  const counts = list.reduce((m, r) => ((m[r.grade] = (m[r.grade] || 0) + 1), m), {});
  const draw = () => {
    chipsEl.innerHTML = [['all', `전체 ${list.length}`], ...['A', 'B', 'C', 'D', 'F'].filter((g) => counts[g]).map((g) => [g, `${g} ${counts[g]}`])]
      .map(([g, l]) => `<button type="button" class="chip ${grade === g ? 'on' : ''}" data-g="${g}" aria-pressed="${grade === g}">${l}</button>`).join('');
    chipsEl.querySelectorAll('[data-g]').forEach((b) => (b.onclick = () => { grade = b.dataset.g; draw(); }));
    const picked = cmpIds();
    const shown = list.filter((r) => (grade === 'all' || r.grade === grade) && (!text || `${r.company_name} ${r.country}`.toLowerCase().includes(text)));
    histEl.innerHTML = !list.length
      ? '<div class="empty"><span>아직 조회한 바이어가 없습니다.</span><a class="btn btn-primary" href="#/search">첫 바이어 조회하기</a></div>'
      : !shown.length ? '<p class="muted">조건에 맞는 기록이 없습니다.</p>'
      : shown.map((r) => `<div class="listrow">
          <label class="pick"><input type="checkbox" data-pick="${esc(r.id)}" ${picked.includes(r.id) ? 'checked' : ''} aria-label="${esc(r.company_name)} 비교에 담기"></label>
          ${gradeBox(r.grade, 44, false)}
          <a class="body" href="#/report/${esc(r.id)}"><span class="name">${esc(r.company_name)}</span><span class="meta">${esc(r.country || '')} · ${fmtDate(r.created_at)}${r.author ? ` · ${esc(r.author)}` : ''}</span></a>
          <span class="go" aria-hidden="true">›</span>
        </div>`).join('');
    histEl.querySelectorAll('[data-pick]').forEach((cb) => (cb.onchange = () => {
      const res = toggleCmp(cb.dataset.pick);
      if (res === null) cb.checked = false;
      sync();
    }));
    sync();
  };
  const sync = () => {
    const n = cmpIds().length;
    go.disabled = n < 2;
    go.textContent = n < 2 ? `2곳 이상 선택하세요 (${n}/3)` : `선택한 ${n}곳 비교하기`;
  };
  go.onclick = () => { location.hash = '#/compare?ids=' + cmpIds().map(encodeURIComponent).join(','); };
  document.getElementById('hq').oninput = (e) => { text = e.target.value.trim().toLowerCase(); draw(); };
  draw();
}

// ---------------- 바이어 비교 ----------------
async function viewCompare(params) {
  setActiveNav('history');
  const ids = (params.get('ids') || '').split(',').filter(Boolean).slice(0, 3);
  view.innerHTML = '<section class="card pad">비교 리포트를 불러오는 중…</section>';
  let reports;
  try {
    reports = (await Promise.all(ids.map((id) => getReport(id).catch(() => null)))).filter(Boolean);
  } catch (e) { if (!handleError(e)) view.innerHTML = `<div class="notice danger">${esc(e.message)}</div>`; return; }
  if (reports.length < 2) {
    view.innerHTML = '<section class="card pad empty"><span>비교하려면 조회 기록에서 2곳 이상 선택해 주세요.</span><a class="btn btn-primary" href="#/history">조회 기록으로</a></section>';
    return;
  }
  const order = ['A', 'B', 'C', 'D', 'F'];
  const best = Math.min(...reports.map((r) => order.indexOf(r.grade) * 1000 + r.riskPoints));
  const isBest = (r) => order.indexOf(r.grade) * 1000 + r.riskPoints === best;
  const sig = (r, key) => r.signals.find((s) => s.key === key)?.value ?? '-';
  const rows = [
    ['권장 결제 조건', (r) => esc(r.guide.primary)],
    ['위험 점수', (r) => `${r.riskPoints}점`],
    ['국가 · 업종', (r) => `${esc(r.company.country)} · ${esc(r.company.industry || '-')}`],
    ['설립 연도', (r) => esc(sig(r, 'age'))],
    ['최근 12개월 통관', (r) => esc(sig(r, 'customs'))],
    ['진행 중 대금 소송', (r) => esc(sig(r, 'courts-open'))],
    ['파산·회생', (r) => esc(sig(r, 'insolvency'))],
    ['신용 점수', (r) => esc(sig(r, 'credit'))],
    ['사기·사칭', (r) => esc(r.signals.find((s) => s.group === '무역 사기' && s.level !== 'ok')?.value || '없음')],
  ];
  view.innerHTML = `
    <section class="card pad">
      <div class="sec-title" style="flex-wrap:wrap">바이어 비교 <span class="muted" style="font-size:13px;font-weight:500">가장 위험이 낮은 바이어를 파란색으로 표시했습니다</span></div>
      ${reports.length > 2 ? '<p class="cmp-hint">옆으로 밀어 다른 바이어 보기 →</p>' : ''}
      <div class="cmp-wrap" tabindex="0" aria-label="바이어 비교표, 옆으로 밀어 볼 수 있습니다">
        <table class="cmp">
          <thead><tr><th scope="col"><span class="sr">항목</span></th>${reports.map((r) => `<th scope="col" class="${isBest(r) ? 'best' : ''}"><div class="hd">${gradeBox(r.grade, 52)}<a href="#/report/${esc(r.id)}" style="color:var(--ink);font-weight:700;text-decoration:none">${esc(r.company.name)}</a>${isBest(r) ? '<span class="badge" style="align-self:flex-start">가장 안전</span>' : ''}</div></th>`).join('')}</tr></thead>
          <tbody>${rows.map(([label, fn]) => `<tr><th scope="row">${label}</th>${reports.map((r) => `<td class="${isBest(r) ? 'best' : ''}">${fn(r)}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between;margin-top:16px">
        <a class="btn btn-ghost" href="#/history">다른 바이어 고르기</a>
        <button class="btn btn-primary" type="button" id="cmpCopy">비교 결과 복사</button>
      </div>
    </section>`;
  document.getElementById('cmpCopy').onclick = async () => {
    const text = ['[바이어 비교]', ...reports.map((r) => `- ${r.company.name} (${r.company.country}): ${r.grade}등급, 위험 점수 ${r.riskPoints}, 권장 ${r.guide.primary}`)].join('\n');
    toast((await copyText(text)) ? '비교 결과를 복사했습니다.' : '복사하지 못했습니다.');
  };
}

// ---------------- 관심 거래처 ----------------
async function viewWatch() {
  setActiveNav('watchlist');
  view.innerHTML = '<section class="card pad" id="watch">불러오는 중…</section>';
  let items, limit;
  try {
    if (state.live) ({ items, limit } = await api('watchlist'));
    else { items = demoStore.watch(); limit = state.me?.watchLimit || 10; }
  } catch (e) {
    if (!handleError(e)) document.getElementById('watch').innerHTML = `<div class="notice danger">${esc(e.message)}</div>`;
    return;
  }
  const alerts = state.me?.alerts;
  document.getElementById('watch').innerHTML = `
    <div class="sec-title">관심 거래처 <span class="muted" style="font-size:13px;font-weight:500">${items.length} / ${limit}곳</span></div>
    <div class="notice" style="margin-bottom:12px">${alerts ? '매일 자동으로 다시 평가해 등급이 바뀌면 표시합니다.' : 'Team 요금제는 매일 자동으로 다시 평가해 등급 변동을 알려 드립니다. 지금은 <b>다시 확인</b> 버튼으로 직접 확인할 수 있습니다.'}</div>
    <div class="rows">${items.length ? items.map((w) => `
      <div class="listrow" style="grid-template-columns:44px minmax(0,1fr)">
        ${gradeBox(w.last_grade || '-', 44, false)}
        <div style="min-width:0;display:flex;flex-direction:column;gap:8px">
          <span><span class="name" style="display:block">${esc(w.company_name)}</span>
            <span class="meta">${esc(w.country || '')} · 확인 ${fmtDate(w.checked_at)}</span>
            ${w.prev_grade && w.changed_at ? `<span class="badge warn" style="margin-top:4px">등급 변동 ${esc(w.prev_grade)} → ${esc(w.last_grade)}</span>` : ''}</span>
          <span style="display:flex;gap:6px;flex-wrap:wrap">
            ${w.last_report_id ? `<a class="btn btn-ghost btn-sm" href="#/report/${esc(w.last_report_id)}">리포트</a>` : ''}
            <button class="btn btn-soft btn-sm" data-recheck="${esc(w.id)}" type="button">다시 확인</button>
            <button class="btn btn-ghost btn-sm" data-del="${esc(w.id)}" type="button" aria-label="${esc(w.company_name)} 삭제">삭제</button>
          </span>
        </div>
      </div>`).join('') : '<div class="empty"><span>리포트 화면에서 <b>관심 거래처 추가</b>를 누르면 여기에 모입니다.</span><a class="btn btn-primary" href="#/search">바이어 조회하기</a></div>'}</div>`;

  view.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    if (!confirm('관심 거래처에서 삭제할까요?')) return;
    try {
      if (state.live) await api('watchlist?id=' + encodeURIComponent(b.dataset.del), { method: 'DELETE' });
      else demoStore.saveWatch(demoStore.watch().filter((x) => x.id !== b.dataset.del));
      viewWatch();
    } catch (e) { if (!handleError(e)) toast(e.message); }
  }));
  view.querySelectorAll('[data-recheck]').forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try {
      if (state.live) {
        const { item } = await api('watchlist', { method: 'POST', body: { action: 'recheck', id: b.dataset.recheck } });
        if (item.error) toast('지금은 이 회사 정보를 다시 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
        else toast(item.recent ? '방금 확인한 거래처입니다. 등급은 그대로입니다.' : item.changed ? `등급이 ${item.prev_grade} → ${item.last_grade}(으)로 바뀌었습니다.` : '등급 변동이 없습니다.');
      } else {
        const list = demoStore.watch();
        const w = list.find((x) => x.id === b.dataset.recheck);
        let report;
        if (!/^(lei|cs|q):/.test(w.company_id)) report = buildReport(await sample.getProfile(w.company_id), { providerLabel: sample.PROVIDER_LABEL, id: 'demo-' + Date.now().toString(36) });
        else if (PREVIEW && window.TC_LIVE) {
          applyPreviewKeys();
          const prof = await window.TC_LIVE.getProfile(w.company_id);
          if (!prof) throw new Error('지금은 이 회사 정보를 다시 불러오지 못했습니다.');
          report = buildReport(prof, { providerLabel: '실데이터 (공개 출처 · 미리보기)', id: 'demo-' + Date.now().toString(36) });
        } else report = (await api('search', { method: 'POST', body: { companyId: w.company_id, autoPick: true } })).report;
        demoStore.saveReport(report);
        const changed = report.grade !== w.last_grade;
        if (changed) { w.prev_grade = w.last_grade; w.changed_at = new Date().toISOString(); }
        w.last_grade = report.grade; w.last_report_id = report.id; w.checked_at = new Date().toISOString();
        demoStore.saveWatch(list);
        toast(changed ? `등급이 ${w.prev_grade} → ${w.last_grade}(으)로 바뀌었습니다.` : '등급 변동이 없습니다.');
      }
      viewWatch();
    } catch (e) { if (!handleError(e)) toast(e.message); b.disabled = false; }
  }));
}

// ---------------- 요금제·결제 ----------------
let tossScript = null;
function loadToss() {
  if (window.TossPayments) return Promise.resolve();
  if (!tossScript) {
    tossScript = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://js.tosspayments.com/v2/standard';
      s.onload = resolve;
      s.onerror = () => { tossScript = null; reject(new Error('결제 모듈을 불러오지 못했습니다. 네트워크를 확인해 주세요.')); };
      document.head.appendChild(s);
    });
  }
  return tossScript;
}

function viewBilling(params) {
  setActiveNav('billing');
  let cycle = (params.get('product') || '').endsWith('_year') ? 'year' : 'month';
  let selected = Object.hasOwn(PRODUCTS, params.get('product') || '') ? params.get('product') : null;
  const me = state.me || {};
  const canPay = state.live && Boolean(state.cfg.tossClientKey);

  const render = () => {
    const starter = `starter_${cycle}`, team = `team_${cycle}`;
    const perMonth = (id) => won(Math.round(PRODUCTS[id].supply / (cycle === 'year' ? 12 : 1)));
    view.innerHTML = `
      <section class="card pad" style="display:flex;flex-wrap:wrap;gap:20px;justify-content:space-between;align-items:center">
        <div style="display:flex;flex-direction:column;gap:6px">
          <span class="muted" style="font-size:13px">현재 요금제</span>
          <strong style="font-size:22px">${esc(me.planLabel || '무료')}${me.planExpiresAt ? ` <span class="muted" style="font-size:14px;font-weight:500">· ${fmtDay(me.planExpiresAt)}까지</span>` : ''}</strong>
          <span class="muted" style="font-size:14px">${me.demo ? '데모 모드에서는 결제 없이 모든 기능을 체험할 수 있습니다.' : `${me.monthlyQuota ? `이번 주기 남은 조회 ${me.periodRemaining}건 · ` : ''}단건 크레딧 ${me.credits ?? 0}건`}</span>
        </div>
        ${state.live && !me.trialUsed && me.plan === 'free' ? '<button class="btn btn-dark" id="trial" type="button">Team 14일 무료 체험 시작</button>' : ''}
      </section>

      ${inviteBanner()}
      ${me.role === 'member' ? `<div class="notice"><b>${esc(me.teamOwnerEmail || '팀 소유자')}님의 Team 요금제를 함께 쓰고 있습니다.</b> 조회 한도와 관심 거래처 한도는 팀 요금제 기준이며, 요금제 결제는 소유자가 합니다.</div>` : ''}
      ${!canPay ? `<div class="notice warn">${state.live ? '토스페이먼츠 키(TOSS_CLIENT_KEY, TOSS_SECRET_KEY)를 설정하면 이 화면에서 바로 결제할 수 있습니다.' : '데모 모드입니다. Supabase와 토스페이먼츠 키를 연결하면 실제 결제가 동작합니다.'}</div>` : ''}

      <section style="display:flex;flex-direction:column;gap:16px">
        <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px">
          <h1 style="font-size:24px">요금제 선택</h1>
          <div class="toggle" role="group" aria-label="결제 주기"><button type="button" data-cycle="month" class="${cycle === 'month' ? 'on' : ''}" aria-pressed="${cycle === 'month'}">월간</button><button type="button" data-cycle="year" class="${cycle === 'year' ? 'on' : ''}" aria-pressed="${cycle === 'year'}">연간 · 20% 할인</button></div>
        </div>
        <div class="plans">
          ${planCard(starter, 'Starter', perMonth(starter), cycle, ['월 20건 바이어 조회', '사용자 1명', '거래 조건 계산기 · 품의서 문구', '결재용 PDF 리포트'])}
          ${planCard(team, 'Team', perMonth(team), cycle, ['월 150건 바이어 조회', '사용자 5명', '거래처 50곳 등급 변동 알림', '바이어 비교 · 팀 공유'], true)}
          ${planCard('single', '단건 리포트', won(PRODUCTS.single.supply), 'once', ['구독 없이 1건 조회', '안전 등급 + 결제 가이드', 'PDF 리포트 포함'])}
        </div>
        ${me.isTrial ? '<p class="muted" style="font-size:13px;margin:0">체험 중에는 추가 조회 묶음을 살 수 없습니다. 유료 요금제로 바꾸면 구매할 수 있습니다.</p>' : ''}
        ${!me.isTrial && (me.demo || me.plan === 'starter' || me.plan === 'team') ? `<div class="addons">
          <div><strong>한도를 다 썼다면 · 추가 조회 10건 묶음</strong><br><span class="muted" style="font-size:13px">구독 중인 요금제에서만 살 수 있고, 다음 달로 이월됩니다.</span></div>
          <div class="addon-btns">
            ${me.demo || me.plan === 'starter' ? `<button type="button" class="btn btn-ghost btn-sm" data-product="addon10_starter">Starter · ${won(PRODUCTS.addon10_starter.supply)} (건당 ₩3,000)</button>` : ''}
            ${me.demo || me.plan === 'team' ? `<button type="button" class="btn btn-ghost btn-sm" data-product="addon10_team">Team · ${won(PRODUCTS.addon10_team.supply)} (건당 ₩2,000)</button>` : ''}
          </div></div>` : ''}
        <p class="muted" style="font-size:13px;margin:0">표시 금액은 부가세 별도입니다. Enterprise(맞춤 조회량·API 연동)는 도입 상담으로 안내해 드립니다.</p>
      </section>

      <section class="card pad" id="teamBox" ${me.demo || me.plan === 'team' || me.role === 'member' || me.role === 'stale' ? '' : 'hidden'}></section>

      <section class="card pad checkout" id="checkout" ${selected ? '' : 'hidden'}>
        <div class="sec-title" style="margin:0">결제하기</div>
        <div id="sum"></div>
        <div id="payment-method"></div>
        <div id="agreement"></div>
        <div id="payMsg" class="notice danger" hidden></div>
        <button class="btn btn-primary btn-block" id="payBtn" type="button" ${canPay ? '' : 'disabled'}>${canPay ? '결제하기' : '데모 모드에서는 결제할 수 없습니다'}</button>
      </section>`;

    view.querySelectorAll('[data-cycle]').forEach((b) => (b.onclick = () => {
      cycle = b.dataset.cycle;
      if (selected && selected !== 'single') selected = selected.replace(/_(month|year)$/, '_' + cycle);
      render();
    }));
    view.querySelectorAll('[data-product]').forEach((b) => (b.onclick = () => { selected = b.dataset.product; render(); document.getElementById('checkout').scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
    const trial = document.getElementById('trial');
    if (trial) trial.onclick = async () => {
      trial.disabled = true;
      try { await api('trial', { method: 'POST' }); await refreshMe(); toast('Team 14일 무료 체험이 시작되었습니다.'); viewBilling(new URLSearchParams()); }
      catch (e) { if (!handleError(e)) toast(e.message); trial.disabled = false; }
    };
    bindInvite();
    renderTeam();
    if (selected) setupCheckout(selected, canPay);
  };

  function planCard(id, title, price, kind, features, featured = false) {
    const unit = kind === 'once' ? '/ 건' : '/ 월';
    if (me.role === 'member' && kind !== 'once') return `<div class="plan" aria-disabled="true" style="opacity:.6"><strong style="font-size:18px">${title}</strong><span class="price">${price}<span class="muted" style="font-size:14px;font-weight:500"> ${unit}</span></span><span class="muted" style="font-size:13px">팀 소유자가 관리합니다</span></div>`;
    const note = kind === 'year' ? `연 ${won(PRODUCTS[id].supply)} 일시 결제` : kind === 'month' ? '30일 이용권' : '결제 즉시 1건 추가';
    return `<button type="button" class="plan ${selected === id ? 'selected' : ''}" data-product="${id}" aria-pressed="${selected === id}">
      <span style="display:flex;justify-content:space-between;align-items:center"><strong style="font-size:18px">${title}</strong>${featured ? '<span class="badge">추천</span>' : ''}</span>
      <span class="price">${price}<span class="muted" style="font-size:14px;font-weight:500"> ${unit}</span></span>
      <span class="muted" style="font-size:13px">${note}</span>
      <ul>${features.map((f) => `<li>✓ ${f}</li>`).join('')}</ul>
    </button>`;
  }

  render();
}

// ---------------- 팀 (Team 좌석 5명) ----------------
function inviteBanner() {
  const inv = state.me?.invite;
  if (!inv) return '';
  return `<div class="notice" role="note" style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between"><span><b>${esc(inv.ownerEmail || '팀')}님이 Team에 초대했습니다.</b> 수락하면 팀의 조회 한도를 함께 쓰고 서로의 조회 기록을 볼 수 있습니다.</span><span style="display:flex;gap:6px"><button class="btn btn-ghost btn-sm" type="button" id="inviteDecline">거절</button><button class="btn btn-primary btn-sm" type="button" id="inviteAccept">초대 수락</button></span></div>`;
}
function bindInvite() {
  const d = document.getElementById('inviteDecline');
  if (d) d.onclick = async () => {
    if (!confirm('이 팀 초대를 거절할까요?')) return;
    try { await api('team', { method: 'POST', body: { action: 'decline' } }); state.me.invite = null; route(); }
    catch (e) { if (!handleError(e)) toast(e.message); }
  };
  const b = document.getElementById('inviteAccept');
  if (!b) return;
  b.onclick = async () => {
    b.disabled = true;
    try { await api('team', { method: 'POST', body: { action: 'accept' } }); await refreshMe(); toast('팀에 합류했습니다.'); route(); }
    catch (e) { if (!handleError(e)) toast(e.message); b.disabled = false; }
  };
}

async function renderTeam() {
  const box = document.getElementById('teamBox');
  if (!box || box.hidden) return;
  const me = state.me || {};
  if (me.demo) {
    box.innerHTML = `<div class="sec-title">팀원 관리 <span class="muted" style="font-size:13px;font-weight:500">Team 요금제 · 소유자 포함 5명</span></div>
      <p class="muted" style="margin:0 0 12px;font-size:14px">팀원을 이메일로 초대하면 팀의 월 150건 한도를 함께 쓰고, 조회 기록을 '팀 전체'로 모아 볼 수 있습니다. 초대받은 사람이 로그인해 '초대 수락'을 누르면 합류합니다.</p>
      <div class="team-invite"><input class="input" type="email" placeholder="동료 이메일 (실서비스에서 사용)" disabled><button class="btn btn-primary btn-sm" type="button" disabled>초대</button></div>`;
    return;
  }
  box.innerHTML = '<p class="muted" style="margin:0">팀 정보를 불러오는 중…</p>';
  let t;
  try { t = await api('team'); } catch (e) { if (!handleError(e)) box.innerHTML = `<div class="notice danger">${esc(e.message)}</div>`; return; }
  if (t.role === 'member' || t.role === 'stale') {
    const note = t.role === 'member' ? '' : t.active ? '<p class="muted" style="margin:0 0 12px;font-size:13.5px">지금은 본인 요금제를 쓰고 있어 팀 한도·팀 기록 공유가 잠시 멈춰 있습니다. 본인 요금제가 끝나면 다시 팀 요금제를 씁니다.</p>' : '<p class="muted" style="margin:0 0 12px;font-size:13.5px">팀 소유자의 Team 요금제가 끝나 지금은 개인 계정으로 쓰고 있습니다. 다른 팀에 합류하려면 먼저 나가 주세요.</p>';
    box.innerHTML = `<div class="sec-title">내 팀</div><p style="margin:0 0 8px">${esc(t.ownerEmail || '팀 소유자')}님의 팀에 속해 있습니다.${t.active ? '' : ' <span class="badge warn">팀 요금제 만료</span>'}</p>${note}<button class="btn btn-ghost btn-sm" id="teamLeave" type="button">팀에서 나가기</button>`;
    document.getElementById('teamLeave').onclick = async () => {
      if (!confirm('팀에서 나가면 팀 조회 한도와 팀원 기록을 더 이상 볼 수 없습니다. 나갈까요?')) return;
      try { await api('team', { method: 'POST', body: { action: 'leave' } }); await refreshMe(); toast('팀에서 나왔습니다.'); viewBilling(new URLSearchParams()); }
      catch (e) { if (!handleError(e)) toast(e.message); }
    };
    return;
  }
  const used = 1 + t.members.length + t.invites.length;
  box.innerHTML = `<div class="sec-title">팀원 관리 <span class="muted" style="font-size:13px;font-weight:500">${used} / ${t.seats}석 사용</span></div>
    <ul class="list-plain">
      <li><span>${esc(me.email || '')} <span class="badge">소유자</span></span></li>
      ${t.members.map((m) => `<li><span>${esc(m.email || '')}<br><span class="muted" style="font-size:12.5px">${esc(fmtDay(m.created_at))} 가입</span></span><button class="btn btn-ghost btn-sm" type="button" data-rm-member="${esc(m.id)}">내보내기</button></li>`).join('')}
      ${t.invites.map((i) => `<li><span>${esc(i.email)}<br><span class="muted" style="font-size:12.5px">초대 대기 · 상대가 수락하면 합류</span></span><button class="btn btn-ghost btn-sm" type="button" data-rm-invite="${esc(i.id)}">초대 취소</button></li>`).join('')}
    </ul>
    ${used < t.seats ? `<form class="team-invite" id="teamInvite"><label class="sr" for="inviteEmail">초대할 이메일</label><input class="input" id="inviteEmail" type="email" required placeholder="동료 이메일"><button class="btn btn-primary btn-sm" type="submit">초대</button></form>` : '<p class="muted" style="margin:12px 0 0;font-size:13.5px">좌석이 모두 찼습니다. 더 필요하면 Enterprise 상담을 이용하세요.</p>'}
    <p class="muted" style="font-size:12.5px;margin:12px 0 0">동료에게 같은 이메일로 가입·로그인한 뒤 화면 위쪽의 '초대 수락'을 누르라고 알려 주세요. (메일 알림을 설정하면 초대 메일도 함께 갑니다)</p>`;
  const form = document.getElementById('teamInvite');
  if (form) form.onsubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById('inviteEmail').value.trim();
    try { await api('team', { method: 'POST', body: { action: 'invite', email } }); toast(`${email} 님을 초대했습니다.`); renderTeam(); }
    catch (err) { if (!handleError(err)) toast(err.message); }
  };
  box.querySelectorAll('[data-rm-member],[data-rm-invite]').forEach((b) => (b.onclick = async () => {
    const isMember = Boolean(b.dataset.rmMember);
    if (isMember && !confirm('이 팀원을 내보낼까요? 팀원의 조회 기록은 본인 계정에 남습니다.')) return;
    try { await api('team?' + (isMember ? 'member=' + encodeURIComponent(b.dataset.rmMember) : 'invite=' + encodeURIComponent(b.dataset.rmInvite)), { method: 'DELETE' }); renderTeam(); }
    catch (err) { if (!handleError(err)) toast(err.message); }
  }));
}

let widgets = null;
async function setupCheckout(productId, canPay) {
  const p = PRODUCTS[productId];
  const amount = productAmount(productId);
  const vat = amount - p.supply;
  document.getElementById('sum').innerHTML = `
    <div class="sumrow"><span>${esc(p.name)}</span><span>${won(p.supply)}</span></div>
    <div class="sumrow"><span class="muted">부가세 (${Math.round(VAT_RATE * 100)}%)</span><span class="muted">${won(vat)}</span></div>
    <div class="sumrow total"><span>결제 금액</span><span>${won(amount)}</span></div>
    ${p.kind === 'plan' && state.me?.planExpiresAt && state.me.plan !== p.plan ? `<p class="muted" style="font-size:13px;margin:8px 0 0">지금 쓰는 ${esc(state.me.planLabel)} 요금제의 남은 기간은 금액 비율대로 새 요금제 기간에 더해 드립니다. (무료 체험 기간 제외)</p>` : ''}
    ${p.kind === 'plan' && state.me?.planExpiresAt && state.me.plan === p.plan ? `<p class="muted" style="font-size:13px;margin:8px 0 0">현재 이용 기간(${esc(fmtDay(state.me.planExpiresAt))}) 뒤로 이어서 연장됩니다.</p>` : ''}`;
  if (!canPay) return;
  const msg = document.getElementById('payMsg');
  const btn = document.getElementById('payBtn');
  btn.disabled = true;
  try {
    await loadToss();
    const session = getSession();
    const toss = window.TossPayments(state.cfg.tossClientKey);
    widgets = toss.widgets({ customerKey: session.user.id });
    await widgets.setAmount({ currency: 'KRW', value: amount });
    await Promise.all([
      widgets.renderPaymentMethods({ selector: '#payment-method', variantKey: 'DEFAULT' }),
      widgets.renderAgreement({ selector: '#agreement', variantKey: 'AGREEMENT' }),
    ]);
    btn.disabled = false;
  } catch (e) {
    msg.hidden = false;
    msg.textContent = e.message || '결제 모듈을 준비하지 못했습니다.';
    return;
  }
  btn.onclick = async () => {
    btn.disabled = true;
    msg.hidden = true;
    try {
      const order = await api('payments/prepare', { method: 'POST', body: { productId } });
      if (order.amount !== amount) throw new Error('결제 금액이 변경되었습니다. 새로고침 후 다시 시도해 주세요.');
      await widgets.requestPayment({
        orderId: order.orderId,
        orderName: order.orderName,
        successUrl: location.origin + '/app/pay-success.html',
        failUrl: location.origin + '/app/pay-fail.html',
        customerEmail: order.customerEmail,
      });
    } catch (e) {
      if (handleError(e)) return;
      msg.hidden = false;
      msg.textContent = e.message || '결제를 시작하지 못했습니다.';
      btn.disabled = false;
    }
  };
}

async function viewPaymentResult() {
  setActiveNav('billing');
  let info = null;
  try { info = JSON.parse(sessionStorage.getItem('tc.pay') || 'null'); } catch {}
  if (!info) { location.hash = '#/billing'; return; }
  const clear = () => { try { sessionStorage.removeItem('tc.pay'); } catch {} };
  if (info.status !== 'success') {
    clear();
    view.innerHTML = `<section class="card pad" style="display:flex;flex-direction:column;gap:14px"><h1 style="font-size:24px">결제가 완료되지 않았습니다</h1><p class="muted" style="margin:0">${esc(info.message || '결제가 취소되었거나 실패했습니다.')}${info.code ? ` (${esc(info.code)})` : ''}</p><a class="btn btn-primary" style="align-self:flex-start" href="#/billing">요금제로 돌아가기</a></section>`;
    return;
  }
  view.innerHTML = '<section class="card pad">결제를 승인하고 있습니다… 창을 닫지 마세요.</section>';
  try {
    const r = await api('payments/confirm', { method: 'POST', body: { paymentKey: info.paymentKey, orderId: info.orderId, amount: info.amount } });
    clear(); // 성공했을 때만 지움 — 실패하면 새로고침으로 다시 확인할 수 있음
    await refreshMe();
    const p = PRODUCTS[r.productId];
    if (r.waiting) {
      const va = r.virtualAccount;
      view.innerHTML = `<section class="card pad" style="display:flex;flex-direction:column;gap:14px"><span class="badge warn" style="align-self:flex-start">입금 대기</span><h1 style="font-size:24px">입금이 확인되면 ${esc(p?.name || '이용권')}이 자동으로 적용됩니다</h1>${va ? `<p style="margin:0;font-size:17px"><b>${esc(va.bank || '')} ${esc(va.accountNumber)}</b>${va.holder ? ` (예금주 ${esc(va.holder)})` : ''}</p><p class="muted" style="margin:0">입금 기한 ${esc(fmtDate(va.dueDate))} · 금액을 정확히 입금해 주세요</p>` : ''}<p class="muted" style="margin:0">주문번호 ${esc(info.orderId)} · ${won(info.amount)}</p><a class="btn btn-primary" style="align-self:flex-start" href="#/search">바이어 조회하러 가기</a></section>`;
      return;
    }
    view.innerHTML = `<section class="card pad" style="display:flex;flex-direction:column;gap:14px"><span class="badge" style="align-self:flex-start">결제 완료</span><h1 style="font-size:26px">${esc(p?.name || '이용권')}이 적용되었습니다</h1><p class="muted" style="margin:0">주문번호 ${esc(info.orderId)} · ${won(info.amount)}</p><div style="display:flex;gap:8px;flex-wrap:wrap">${r.receiptUrl && /^https:\/\//.test(r.receiptUrl) ? `<a class="btn btn-ghost" href="${esc(r.receiptUrl)}" target="_blank" rel="noopener">영수증 보기</a>` : ''}<a class="btn btn-primary" href="#/search">바이어 조회하러 가기</a></div></section>`;
  } catch (e) {
    if (handleError(e)) return;
    const retry = e instanceof ApiError && e.status >= 500;
    if (!retry) clear();
    view.innerHTML = `<section class="card pad" style="display:flex;flex-direction:column;gap:14px"><h1 style="font-size:24px">${retry ? '결제 확인이 늦어지고 있습니다' : '결제 승인에 실패했습니다'}</h1><p class="muted" style="margin:0">${esc(e.message)}</p><div style="display:flex;gap:8px;flex-wrap:wrap">${retry ? '<button class="btn btn-primary" type="button" id="payRetry">다시 확인</button>' : ''}<a class="btn ${retry ? 'btn-ghost' : 'btn-primary'}" href="#/billing">요금제로 돌아가기</a></div></section>`;
    const b = document.getElementById('payRetry');
    if (b) b.onclick = () => viewPaymentResult();
  }
}

// ---------------- 라우터 ----------------
function route() {
  // 미리보기 파일: '#/…' 이면 앱, 그 외(#how 등)는 랜딩 페이지를 보여 줍니다.
  if (PREVIEW) {
    const inApp = location.hash.startsWith('#/');
    document.getElementById('landing').hidden = inApp;
    document.getElementById('appShell').hidden = !inApp;
    if (!inApp) {
      const target = location.hash && document.getElementById(location.hash.slice(1));
      if (target) target.scrollIntoView();
      else window.scrollTo(0, 0);
      return;
    }
  }
  const { parts, params } = parseHash();
  window.scrollTo(0, 0);
  renderCmpBar();
  switch (parts[0]) {
    case 'report': return viewReport(parts[1]);
    case 'history': return viewHistory(params);
    case 'compare': return viewCompare(params);
    case 'watchlist': return viewWatch();
    case 'billing': return viewBilling(params);
    case 'payment': return viewPaymentResult();
    default: return viewSearch(params);
  }
}

async function init() {
  state.cfg = await loadConfig();
  state.live = state.cfg.mode === 'live';
  if (state.live && !getSession()) {
    location.replace('/login.html?next=' + encodeURIComponent('/app/' + location.hash));
    return;
  }
  document.getElementById('demoBanner').hidden = state.live;
  applyPreviewKeys();
  if (!PREVIEW && !state.live && realData()) document.getElementById('demoBanner').innerHTML = '<b>데모 모드</b> · 로그인 없이 <b>실데이터</b>로 조회 중입니다. 조회 기록은 이 브라우저에만 저장됩니다.';
  const logout = document.getElementById('logout');
  logout.hidden = !state.live;
  logout.onclick = async () => { await signOut(); location.replace('/login.html'); };

  // 랜딩 페이지 검색창에서 넘어온 ?q= 처리
  const q = new URLSearchParams(location.search).get('q');
  if (q) history.replaceState(null, '', location.pathname + '#/search?q=' + encodeURIComponent(q));

  // '/' 키로 검색창 바로가기
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
    e.preventDefault();
    if (parseHash().parts[0] !== 'search' || (PREVIEW && !location.hash.startsWith('#/'))) location.hash = '#/search';
    setTimeout(() => document.getElementById('q')?.focus(), 30);
  });

  await refreshMe();
  window.addEventListener('hashchange', route);
  route();
}

init();
