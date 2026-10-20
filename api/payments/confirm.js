// 결제 승인: 토스 결제창에서 돌아온 paymentKey·orderId·amount 를 검증하고 승인 API 를 호출합니다.
// 승인 응답의 상태가 DONE 일 때만 이용권을 반영합니다. (가상계좌는 입금 후 웹훅으로 반영)
import { route, body, isLive, requireUser, db, enc, HttpError } from '../../lib/server/core.js';
import { confirmPayment, getPaymentByOrder, settle } from '../../lib/server/toss.js';

export default route(['POST'], async (req) => {
  if (!isLive()) throw new HttpError(400, '데모 모드에서는 결제를 승인할 수 없습니다.');
  const user = await requireUser(req);
  const { paymentKey, orderId, amount } = await body(req);
  if (typeof paymentKey !== 'string' || typeof orderId !== 'string' || amount == null || paymentKey.length > 200 || orderId.length > 64) {
    throw new HttpError(400, '결제 정보가 올바르지 않습니다.');
  }

  const rows = await db('GET', `orders?id=eq.${enc(orderId)}&user_id=eq.${enc(user.id)}&select=*`);
  if (!rows.length) throw new HttpError(404, '주문을 찾을 수 없습니다.');
  const order = rows[0];
  if (order.status === 'paid') return { ok: true, already: true, productId: order.product_id };
  if (order.status === 'waiting') {
    // 가상계좌 발급 후 다시 들어온 경우: 현재 상태를 토스에서 확인
    const look = await getPaymentByOrder(orderId).catch(() => null);
    if (look?.ok) {
      const out = await settle(order, look.data);
      if (out.state === 'paid') return { ok: true, productId: order.product_id, receiptUrl: out.receiptUrl };
      if (out.state === 'waiting') return { ok: true, waiting: true, productId: order.product_id, virtualAccount: out.virtualAccount };
    }
    return { ok: true, waiting: true, productId: order.product_id };
  }
  if (Number(amount) !== order.amount) {
    await db('PATCH', `orders?id=eq.${enc(orderId)}&status=neq.paid`, { body: { status: 'failed', error: 'amount_mismatch' } });
    throw new HttpError(400, '결제 금액이 주문 금액과 다릅니다. 결제가 승인되지 않았습니다.');
  }

  let res;
  try { res = await confirmPayment(paymentKey, orderId, order.amount); }
  catch { res = { ok: false, data: { code: 'NETWORK', message: '결제사 응답이 늦습니다.' } }; }

  // 승인 요청이 실패해도 이미 승인된 결제일 수 있음(재시도·시간 초과) → 주문번호로 실제 상태 확인
  if (!res.ok) {
    const look = await getPaymentByOrder(orderId).catch(() => null);
    if (look?.ok && ['DONE', 'WAITING_FOR_DEPOSIT'].includes(look.data?.status)) res = look;
    else {
      await db('PATCH', `orders?id=eq.${enc(orderId)}&status=neq.paid`, { body: { status: 'failed', error: `${res.data.code || res.status}: ${res.data.message || ''}`.slice(0, 500) } });
      throw new HttpError(400, res.data.message || '결제 승인에 실패했습니다.', { code: res.data.code });
    }
  }

  let out;
  try { out = await settle(order, res.data); }
  catch { throw new HttpError(500, '결제는 승인되었지만 이용권 반영이 늦어지고 있습니다. 잠시 후 이 화면을 새로고침하거나 고객센터로 문의해 주세요.'); }
  if (out.state === 'paid') return { ok: true, productId: order.product_id, receiptUrl: out.receiptUrl };
  if (out.state === 'waiting') return { ok: true, waiting: true, productId: order.product_id, virtualAccount: out.virtualAccount };
  throw new HttpError(400, '결제가 완료되지 않았습니다. 결제 상태: ' + (out.status || out.state));
});
