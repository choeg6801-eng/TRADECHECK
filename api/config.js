// 브라우저가 쓰는 공개 설정. (비밀키는 절대 내보내지 않습니다)
import { env, isLive, route } from '../lib/server/core.js';
import { getProvider } from '../lib/providers/index.js';

export default route(['GET'], async () => {
  const c = env();
  let providerLabel = '샘플 데이터';
  let providerId = 'sample';
  let providerError = null;
  try { const p = getProvider(); providerLabel = p.PROVIDER_LABEL; providerId = p.PROVIDER_ID; } catch (err) { providerError = err.message; }
  const e = process.env;
  return {
    mode: isLive() ? 'live' : 'demo',
    supabaseUrl: isLive() ? c.supabaseUrl : null,
    supabaseAnonKey: isLive() ? c.anonKey : null,
    tossClientKey: isLive() && c.tossClientKey ? c.tossClientKey : null,
    dataProvider: providerLabel,
    dataProviderId: providerId,
    // 설정 확인용: 서버가 읽은 DATA_PROVIDER 값 (비밀 정보 아님)
    dataProviderSetting: process.env.DATA_PROVIDER == null ? '(설정 안 됨)' : JSON.stringify(process.env.DATA_PROVIDER),
    ...(providerError ? { dataProviderError: providerError } : {}),
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
