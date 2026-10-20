// 토스페이먼츠 웹훅: 가상계좌 입금 완료·결제 취소(환불) 등 상태가 바뀌면 호출됩니다.
// 토스 개발자센터 → 웹훅 → URL `https://내도메인/api/payments/webhook` 등록 (이벤트: PAYMENT_STATUS_CHANGED, DEPOSIT_CALLBACK)
// 본문은 믿지 않고 주문번호만 꺼내, 토스 API에서 결제 상태를 다시 조회해 처리합니다.
// 토스 조회가 실패하면 500 을 돌려 토스가 웹훅을 다시 보내게 합니다.
import { route, body, isLive, db, enc, HttpError } from '../../lib/server/core.js';
import { getPaymentByOrder, settle, revokeIfCanceled } from '../../lib/server/toss.js';

export default route(['POST'], async (req) => {
  if (!isLive()) return { ok: true, skipped: 'demo' };
  const b = await body(req).catch(() => ({}));
  const orderId = String(b?.data?.orderId || b?.orderId || '');
  if (!/^TC-[A-Za-z0-9-]{4,60}$/.test(orderId)) return { ok: true, ignored: true };
  const rows = await db('GET', `orders?id=eq.${enc(orderId)}&select=*`);
  if (!rows.length || rows[0].status === 'canceled') return { ok: true };
  const look = await getPaymentByOrder(orderId).catch(() => null);
  if (!look?.ok) throw new HttpError(503, 'payment lookup failed'); // 토스가 다시 보내도록
  const order = rows[0];
  if (order.status === 'paid') return { ok: true, ...(await revokeIfCanceled(order, look.data)) };
  const out = await settle(order, look.data);
  return { ok: true, state: out.state };
});
