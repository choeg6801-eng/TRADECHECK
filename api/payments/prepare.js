// 결제 준비: 서버가 금액을 정해 주문을 저장하고 orderId 를 돌려줍니다.
// 브라우저가 금액을 바꿔도 승인 단계에서 이 저장값과 비교해 막습니다.
import { route, body, env, isLive, requireUser, db, HttpError } from '../../lib/server/core.js';
import { PRODUCTS, productAmount, canBuy } from '../../lib/products.js';
import { loadAccount } from '../../lib/server/account.js';

function newOrderId() {
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
  return `TC-${Date.now().toString(36)}-${rand}`; // 영문·숫자·하이픈, 6~64자
}

export default route(['POST'], async (req) => {
  if (!isLive()) throw new HttpError(400, '결제는 Supabase와 토스페이먼츠 키를 설정한 뒤 사용할 수 있습니다.');
  const c = env();
  if (!c.tossClientKey || !c.tossSecretKey) throw new HttpError(400, '토스페이먼츠 키가 설정되지 않았습니다.');
  const user = await requireUser(req);
  const { productId } = await body(req);
  const product = Object.hasOwn(PRODUCTS, String(productId)) ? PRODUCTS[productId] : null;
  if (!product) throw new HttpError(400, '알 수 없는 상품입니다.');
  const acc = await loadAccount(user);
  if (product.kind === 'plan' && acc.summary.role === 'member') throw new HttpError(409, `팀 요금제는 소유자(${acc.owner.email || '팀 소유자'})가 결제합니다. 추가 조회 묶음은 구매할 수 있습니다.`);
  if (!canBuy(productId, acc.summary.plan)) throw new HttpError(409, '현재 요금제에서는 구매할 수 없는 상품입니다.');
  if (product.requires && acc.summary.isTrial) throw new HttpError(409, '추가 조회 묶음은 유료 요금제에서 살 수 있습니다. 체험 중에는 체험 한도를 이용해 주세요.');

  const amount = productAmount(productId);
  const orderId = newOrderId();
  await db('POST', 'orders', { body: { id: orderId, user_id: user.id, product_id: productId, amount, status: 'ready' } });

  return {
    orderId,
    amount,
    orderName: product.name,
    customerKey: user.id,
    customerEmail: user.email || undefined,
    clientKey: c.tossClientKey,
  };
});
