// 토스페이먼츠 서버 호출 + 결제 반영 공통 로직
// 원칙: 브라우저나 웹훅이 보낸 값은 믿지 않고, 토스 API에서 결제 상태를 직접 확인한 뒤에만 이용권을 반영합니다.
import { env, db, rpc, enc } from './core.js';
import { PRODUCTS } from '../products.js';

// 은행 코드 → 이름 (토스페이먼츠 은행 코드)
const BANKS = { '02': 'KDB산업', '03': 'IBK기업', '04': 'KB국민', '07': '수협', '11': 'NH농협', '12': '단위농협', '20': '우리', '23': 'SC제일', '27': '씨티', '31': 'iM뱅크(대구)', '32': '부산', '34': '광주', '35': '제주', '37': '전북', '39': '경남', '45': '새마을금고', '48': '신협', '50': '저축은행', '64': '산림조합', '71': '우체국', '81': '하나', '88': '신한', '89': '케이뱅크', '90': '카카오뱅크', '92': '토스뱅크' };
export const bankName = (code) => BANKS[String(code || '')] || (code ? `은행 코드 ${code}` : '');

const auth = () => 'Basic ' + Buffer.from(`${env().tossSecretKey}:`).toString('base64');

async function toss(path, { method = 'GET', body, idem } = {}) {
  const res = await fetch(`${env().tossApiBase}${path}`, {
    method,
    headers: { Authorization: auth(), 'Content-Type': 'application/json', ...(idem ? { 'Idempotency-Key': idem } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export const confirmPayment = (paymentKey, orderId, amount) =>
  toss('/v1/payments/confirm', { method: 'POST', body: { paymentKey, orderId, amount }, idem: orderId });
export const getPaymentByOrder = (orderId) => toss(`/v1/payments/orders/${encodeURIComponent(orderId)}`);

// 토스가 돌려준 결제 정보로 주문을 처리: DONE 이고 금액·주문번호가 맞을 때만 이용권 반영
// 이미 반영된 주문이 토스에서 취소·환불되면 이용권·크레딧을 회수
export async function revokeIfCanceled(order, payment) {
  if (!payment || payment.orderId !== order.id) return { state: 'ignored' };
  if (payment.status === 'CANCELED') {
    await rpc('revoke_paid_order', { p_order_id: order.id, p_reason: 'CANCELED' });
    return { state: 'revoked' };
  }
  if (payment.status === 'PARTIAL_CANCELED') {
    // 부분 환불은 회수 범위를 사람이 정해야 하므로 표시만 남김
    await db('PATCH', `orders?id=eq.${enc(order.id)}`, { body: { error: 'PARTIAL_CANCELED: 이용권 조정 필요' } });
    return { state: 'review' };
  }
  return { state: 'unchanged' };
}

export async function settle(order, payment) {
  if (!payment || payment.orderId !== order.id || Number(payment.totalAmount) !== order.amount) {
    await db('PATCH', `orders?id=eq.${enc(order.id)}&status=neq.paid`, { body: { status: 'failed', error: 'verify_mismatch' } });
    return { state: 'failed' };
  }
  if (payment.status === 'WAITING_FOR_DEPOSIT') {
    await db('PATCH', `orders?id=eq.${enc(order.id)}&status=neq.paid`, { body: { status: 'waiting', payment_key: payment.paymentKey || null, method: payment.method || null } });
    const va = payment.virtualAccount;
    return { state: 'waiting', virtualAccount: va ? { bank: bankName(va.bankCode || va.bank), accountNumber: va.accountNumber, dueDate: va.dueDate, holder: va.customerName || '' } : null };
  }
  if (payment.status !== 'DONE') {
    if (['CANCELED', 'ABORTED', 'EXPIRED', 'PARTIAL_CANCELED'].includes(payment.status)) {
      await db('PATCH', `orders?id=eq.${enc(order.id)}&status=neq.paid`, { body: { status: payment.status === 'CANCELED' ? 'canceled' : 'failed', error: payment.status } });
    }
    return { state: 'pending', status: payment.status };
  }
  const product = PRODUCTS[order.product_id];
  const applied = await rpc('apply_paid_order', {
    p_order_id: order.id,
    p_payment_key: payment.paymentKey,
    p_method: payment.method || null,
    p_raw: { status: payment.status, method: payment.method, approvedAt: payment.approvedAt, totalAmount: payment.totalAmount, receipt: payment.receipt?.url || null },
    p_kind: product.kind,
    p_plan: product.plan || null,
    p_days: product.days || 0,
    p_credits: product.credits || 0,
  });
  if (!applied?.ok) throw new Error('apply_failed');
  return { state: 'paid', receiptUrl: payment.receipt?.url || null };
}
