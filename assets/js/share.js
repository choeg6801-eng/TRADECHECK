// 공유 링크로 연 리포트 (로그인 없이 읽기 전용)
const view = document.getElementById('view');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LABEL = { A: '안정', B: '양호', C: '주의', D: '위험', F: '경보' };
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const safeUrl = (u) => (/^https:\/\//.test(String(u || '')) ? u : '');

async function load() {
  const t = new URLSearchParams(location.search).get('t') || '';
  try {
    const res = await fetch('/api/share?t=' + encodeURIComponent(t));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '리포트를 불러오지 못했습니다.');
    render(data.report, data.expiresAt);
  } catch (e) {
    view.innerHTML = `<section class="card pad" style="display:flex;flex-direction:column;gap:12px"><h1 style="font-size:22px">리포트를 열 수 없습니다</h1><p class="muted" style="margin:0">${esc(e.message)} 공유한 분께 새 링크를 요청해 주세요.</p><a class="btn btn-primary" style="align-self:flex-start" href="/">Trade Checker 알아보기</a></section>`;
  }
}

function render(r, expiresAt) {
  const pb = document.getElementById('sharePrint');
  if (pb) { pb.hidden = false; pb.onclick = () => window.print(); }
  document.title = `${r.company.name} · ${r.grade}등급 · Trade Checker`;
  const c = r.company;
  const groups = {};
  r.signals.forEach((s) => (groups[s.group] = groups[s.group] || []).push(s));
  const cov = r.coverage;
  view.innerHTML = `
    <div class="notice no-print">공유받은 읽기 전용 리포트입니다 · 링크 만료 ${esc(fmt(expiresAt))}</div>
    <section class="card pad" style="display:flex;flex-direction:column;gap:14px">
      <div class="report-id">
        <span class="grade grade-${esc(r.grade)}" style="width:84px;height:84px;font-size:49px" role="img" aria-label="${esc(r.grade)}등급 ${LABEL[r.grade] || ''}"><b aria-hidden="true">${esc(r.grade)}</b><small aria-hidden="true">${LABEL[r.grade] || ''}</small></span>
        <div style="min-width:0;display:flex;flex-direction:column;gap:6px">
          <h1 style="font-size:clamp(22px,2.6vw,30px)">${esc(c.name)}</h1>
          <span class="muted" style="font-size:14px">${[c.country, c.city, c.industry, c.founded ? `설립 ${c.founded}` : '', c.domain, c.lei ? `LEI ${c.lei}` : ''].filter(Boolean).map(esc).join(' · ')}</span>
          <span style="font-size:15px">${esc(r.summary)}</span>
          ${cov ? `<span class="muted" style="font-size:13px">데이터 충실도 ${cov.covered}/${cov.total} · ${cov.items.map((i) => `${i.ok ? '✓' : '–'} ${esc(i.label)}`).join('  ')}</span>` : ''}
        </div>
      </div>
    </section>
    ${r.capped ? `<div class="notice warn">확인하지 못한 영역(${esc(r.coverage.missing.join(', '))})이 있어 ${esc(r.capped.from)}등급에서 ${esc(r.capped.to)}등급으로 보수적으로 표시했습니다.</div>` : ''}
    <section class="guide">
      <span class="mono" style="font-size:12px;color:#9DBBF7">결제 조건 가이드 · ${esc(r.grade)}등급</span>
      <h2>${esc(r.guide.primary)}</h2>
      <div class="grid-2" style="gap:24px">
        <div><strong style="display:block;margin-bottom:8px">권장 조건</strong><ul>${r.guide.terms.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>
        <div><strong style="display:block;margin-bottom:8px">대안 · 함께 확인할 것</strong><ul>${r.guide.alternatives.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>
      </div>
    </section>
    <section class="card pad">
      <div class="sec-title">항목별 확인 결과 <span class="muted" style="font-size:13px;font-weight:500">위험 점수 ${esc(r.riskPoints)}점</span></div>
      ${Object.entries(groups).map(([g, list]) => `<div style="margin-bottom:6px"><div class="muted" style="font-size:12.5px;font-weight:600;margin:10px 0 2px">${esc(g)}</div>${list.map((s) => `<div class="signal"><span class="dot ${esc(s.level)}" aria-hidden="true"></span><span>${esc(s.label)}</span><span class="v ${esc(s.level)}">${esc(s.value)}</span>${s.detail || safeUrl(s.link) ? `<span class="d">${esc(s.detail || '')}${safeUrl(s.link) ? ` <a href="${esc(safeUrl(s.link))}" target="_blank" rel="noopener noreferrer">근거 보기 ↗</a>` : ''}</span>` : ''}</div>`).join('')}</div>`).join('')}
    </section>
    <section class="card pad">
      <div class="sec-title">데이터 출처</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">${r.sources.map((s) => `<span class="badge ${s.status === '조회됨' ? '' : 'gray'}">${esc(s.name)} · ${esc(s.status)}</span>`).join('')}</div>
      <p class="muted" style="font-size:13px;margin:14px 0 0">조회 ${esc(fmt(r.createdAt))} · 데이터: ${esc(r.dataMode)} · 엔진 ${esc(r.engineVersion)}<br>${esc(r.disclaimer)}</p>
    </section>
    <section class="card pad no-print" style="display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap">
      <span><strong>우리 회사 바이어도 확인해 보세요</strong><br><span class="muted" style="font-size:14px">가입하면 리포트 3건 무료 · 카드 등록 없음</span></span>
      <a class="btn btn-primary" href="/login.html?mode=signup">무료로 시작</a>
    </section>`;
}

load();
