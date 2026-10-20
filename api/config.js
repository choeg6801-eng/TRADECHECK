// 브라우저가 쓰는 공개 설정. (비밀키는 절대 내보내지 않습니다)
import { env, isLive, route } from '../lib/server/core.js';
import { getProvider } from '../lib/providers/index.js';

export default route(['GET'], async () => {
  const c = env();
  let providerLabel = '샘플 데이터';
  let providerId = 'sample';
  try { const p = getProvider(); providerLabel = p.PROVIDER_LABEL; providerId = p.PROVIDER_ID; } catch {}
  const e = process.env;
  return {
    mode: isLive() ? 'live' : 'demo',
    supabaseUrl: isLive() ? c.supabaseUrl : null,
    supabaseAnonKey: isLive() ? c.anonKey : null,
    tossClientKey: isLive() && c.tossClientKey ? c.tossClientKey : null,
    dataProvider: providerLabel,
    dataProviderId: providerId,
    // 어떤 출처가 연결되었는지만 알려 줍니다 (키 값은 내보내지 않음)
    sources: providerId === 'live' ? {
      registry: e.GLEIF_DISABLED !== '1',
      domain: e.RDAP_DISABLED !== '1',
      // 유료 출처는 로그인하는 실서비스 모드에서만 씀
      sanctions: isLive() && Boolean(e.OPENSANCTIONS_API_KEY),
      credit: isLive() && Boolean(e.CREDITSAFE_USERNAME && e.CREDITSAFE_PASSWORD),
      customs: isLive() && Boolean(e.IMPORTGENIUS_TOKEN && e.IMPORTGENIUS_API_BASE),
    } : null,
  };
});
