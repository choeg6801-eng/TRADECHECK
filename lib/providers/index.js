// 데이터 공급자 선택 — 환경변수 DATA_PROVIDER 로 고릅니다. (기본값: sample)
//   sample: 가상 바이어 21곳 · live: 실데이터(GLEIF·RDAP 무료 + 키를 넣은 유료 출처)
// 실제 업체를 붙이려면 template.js 를 복사해 구현하고 아래 PROVIDERS 에 등록하세요.
import * as sample from './sample.js';
import * as template from './template.js';
import * as live from './live.js';

const PROVIDERS = { sample, template, live };

export function getProvider() {
  // 대소문자·앞뒤 공백·따옴표를 무시 ("LIVE", " live", "\"live\"" 모두 live 로)
  const id = String(process.env.DATA_PROVIDER || 'sample').trim().replace(/^["']|["']$/g, '').trim().toLowerCase() || 'sample';
  const p = PROVIDERS[id];
  if (!p) throw new Error(`알 수 없는 DATA_PROVIDER: ${id}`);
  return p;
}
