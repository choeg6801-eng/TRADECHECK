// 이메일 알림 — Resend(https://resend.com) API 사용. RESEND_API_KEY 가 없으면 보내지 않고 건너뜁니다.
//   RESEND_API_KEY=re_...           Resend 대시보드에서 발급
//   ALERT_FROM="Trade Checker <alert@내도메인>"   Resend에서 인증한 도메인의 주소
//   SITE_URL=https://내도메인         메일 속 링크용
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const emailEnabled = () => Boolean(process.env.RESEND_API_KEY && process.env.ALERT_FROM);

export async function sendEmail({ to, subject, html }) {
  if (!emailEnabled()) return { skipped: true };
  const res = await fetch(process.env.RESEND_API_BASE || 'https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.ALERT_FROM, to: [to], subject, html }),
  });
  if (!res.ok) throw new Error(`email ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return { sent: true };
}

const ORDER = ['A', 'B', 'C', 'D', 'F'];

// 등급 변동 요약 메일 (한 사람에게 한 통)
export function gradeChangeEmail(items) {
  const site = (process.env.SITE_URL || '').replace(/\/$/, '');
  const worse = items.filter((i) => ORDER.indexOf(i.last_grade) > ORDER.indexOf(i.prev_grade));
  const subject = worse.length
    ? `[Trade Checker] 관심 거래처 ${worse.length}곳의 등급이 낮아졌습니다`
    : `[Trade Checker] 관심 거래처 ${items.length}곳의 등급이 바뀌었습니다`;
  const rows = items.map((i) => {
    const down = ORDER.indexOf(i.last_grade) > ORDER.indexOf(i.prev_grade);
    const link = site && i.last_report_id ? `${site}/app/#/report/${i.last_report_id}` : '';
    return `<tr><td style="padding:10px 12px;border-bottom:1px solid #eef1f4">${esc(i.company_name)}<br><span style="color:#6b7685;font-size:12px">${esc(i.country || '')}</span></td>
      <td style="padding:10px 12px;border-bottom:1px solid #eef1f4;font-weight:700;color:${down ? '#C2531F' : '#1D5BD6'}">${esc(i.prev_grade)} → ${esc(i.last_grade)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #eef1f4">${link ? `<a href="${esc(link)}">리포트 보기</a>` : ''}</td></tr>`;
  }).join('');
  const html = `<div style="font-family:system-ui,sans-serif;color:#0B1A2E;max-width:560px">
    <h2 style="font-size:18px">관심 거래처 등급 변동 알림</h2>
    <p style="color:#3B4757">오늘 자동 재평가에서 아래 거래처의 무역 안전 등급이 바뀌었습니다. 등급이 낮아진 거래처는 출고 전에 결제 조건을 다시 확인하세요.</p>
    <table style="border-collapse:collapse;width:100%;font-size:14px">${rows}</table>
    <p style="color:#8a95a5;font-size:12px;margin-top:20px">무역 안전 등급은 참고 지표입니다. 알림을 끄려면 관심 거래처에서 해당 회사를 삭제하세요.</p></div>`;
  return { subject, html };
}
