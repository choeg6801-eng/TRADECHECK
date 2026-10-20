// 랜딩 페이지 체험 섹션: 가입 없이 샘플 바이어로 등급·위험 노출액을 바로 확인
import { buildReport, simulateDeal, TERMS } from '/lib/engine.js';
import * as sample from '/lib/providers/sample.js';

const PREVIEW = Boolean(window.TC_PREVIEW);
const appSearch = (q) => (PREVIEW ? '#/search?q=' : '/app/#/search?q=') + encodeURIComponent(q);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = (n) => 'USD ' + Math.round(n).toLocaleString('en-US');
const LABEL = { A: '안정', B: '양호', C: '주의', D: '위험', F: '경보' };

const BUYERS = [
  { id: 'helvetia-ch', short: 'Helvetia AG', country: '스위스' },
  { id: 'kestrel-nl', short: 'Kestrel BV', country: '네덜란드' },
  { id: 'nw-global-ae', short: 'Northwind LLC', country: 'UAE' },
  { id: 'brightline', short: 'Brightline Co.', country: '영국' },
];
const REQS = ['tt60', 'adv30', 'lc', 'adv100'];

const root = document.getElementById('try');
if (root) {
  const st = { buyer: 'nw-global-ae', amount: 100000, term: 'tt60', reports: {} };
  const $ = (s) => root.querySelector(s);

  $('#tryBuyers').innerHTML = BUYERS.map((b) => `<button type="button" class="tt-chip" data-b="${b.id}" aria-pressed="false">${esc(b.short)}<small>${esc(b.country)}</small></button>`).join('');
  $('#tryTerms').innerHTML = REQS.map((t) => `<button type="button" class="tt-chip" data-t="${t}" aria-pressed="false">${esc(TERMS[t].label)}</button>`).join('');

  async function report(id) {
    if (!st.reports[id]) st.reports[id] = buildReport(await sample.getProfile(id), { providerLabel: sample.PROVIDER_LABEL });
    return st.reports[id];
  }

  async function render() {
    root.querySelectorAll('[data-b]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.b === st.buyer)));
    root.querySelectorAll('[data-t]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.t === st.term)));
    $('#tryAmtOut').textContent = usd(st.amount);
    const r = await report(st.buyer);
    const d = simulateDeal(r.grade, st.amount, st.term);
    const max = Math.max(d.requested.exposure, d.recommended?.exposure || 0, 1);
    const tone = d.tone === 'ok' ? 'ok' : d.tone;
    $('#tryOut').innerHTML = `
      <div class="tt-head">
        <span class="tt-grade g-${r.grade}" role="img" aria-label="${r.grade}등급 ${LABEL[r.grade]}"><b aria-hidden="true">${r.grade}</b><small aria-hidden="true">${LABEL[r.grade]}</small></span>
        <div style="min-width:0"><strong class="tt-name">${esc(r.company.name)}</strong><span class="tt-sum">${esc(r.summary)}</span></div>
      </div>
      <div class="tt-verdict ${tone}">${esc(d.verdict)}</div>
      <div class="tt-row"><span>바이어 요청 · ${esc(d.requested.label)}</span><b class="${d.acceptable ? '' : 'bad'}">${usd(d.requested.exposure)}</b></div>
      <div class="tt-bar"><span style="width:${(d.requested.exposure / max) * 100}%;background:${d.acceptable ? '#8FB3F5' : '#D9583E'}"></span></div>
      ${d.recommended ? `<div class="tt-row"><span>권장 · ${esc(d.recommended.label)}</span><b>${usd(d.recommended.exposure)}</b></div>
      <div class="tt-bar"><span style="width:${(d.recommended.exposure / max) * 100}%;background:#1D5BD6"></span></div>` : ''}
      <p class="tt-note">위험 노출액 = 선적 후 받지 못한 채 남는 금액${d.saved > 0 && d.recommended ? ` · 권장 조건으로 <b>${usd(d.saved)}</b> 줄일 수 있습니다` : ''}</p>
      <a class="tt-go" href="${appSearch(r.company.name)}">전체 리포트 보기 →</a>`;
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-b]');
    const t = e.target.closest('[data-t]');
    if (b) { st.buyer = b.dataset.b; render(); }
    if (t) { st.term = t.dataset.t; render(); }
  });
  $('#tryAmt').addEventListener('input', (e) => { st.amount = Number(e.target.value); render(); });
  render();
}

// 히어로 검색창: 미리보기 파일에서는 같은 파일 안의 앱 화면으로 이동
const heroForm = document.querySelector('form[action="/app/"]');
if (heroForm && PREVIEW) {
  heroForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = heroForm.querySelector('input[name=q]').value.trim();
    if (q.length >= 2) location.hash = '#/search?q=' + encodeURIComponent(q);
  });
}

// 모바일 하단 고정 버튼: 첫 화면을 지나면 나타남
const sticky = document.getElementById('stickyCta');
const hero = document.getElementById('top');
if (sticky && hero && 'IntersectionObserver' in window) {
  new IntersectionObserver(([en]) => sticky.classList.toggle('show', !en.isIntersecting), { threshold: 0 }).observe(hero);
}
