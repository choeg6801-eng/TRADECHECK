// 실제 데이터 업체 연결용 틀 — 이 파일을 복사해 업체별 공급자를 만드세요.
// 여러 업체(통관·법원·신용)를 조합해도 됩니다. 결과만 sample.js 상단의 Profile 형식으로 맞추면
// 등급 엔진, 화면, DB는 그대로 동작합니다.
//
// 연결 후보 예시 (계약 조건·커버리지는 각 업체에 직접 확인하세요)
//   - 기업 식별·등기: 각국 법인 등기 공개 API, 기업정보 데이터 업체
//   - 통관 이력: 수출입 통관(B/L) 데이터 업체
//   - 신용평가: 글로벌 기업 신용평가 업체, 무역보험 기관의 해외 바이어 신용조사
//   - 법원·파산: 국가별 법원 공개 기록, 파산 공고
//
// API 키는 Vercel 환경변수로 넣고 process.env 로 읽으세요. 키를 코드에 적지 마세요.

export const PROVIDER_ID = 'template';
export const PROVIDER_LABEL = '실데이터 (연결 예정)';

export async function searchCompanies(query) {
  // 예: const res = await fetch(`https://api.example.com/companies?q=${encodeURIComponent(query)}`,
  //       { headers: { Authorization: `Bearer ${process.env.EXAMPLE_API_KEY}` } });
  //     const data = await res.json();
  //     return data.items.map((x) => ({ id: x.id, name: x.name, country: x.country_name, countryCode: x.country,
  //       industry: x.industry, city: x.city, domain: x.website }));
  throw new Error('template 공급자는 아직 구현되지 않았습니다. DATA_PROVIDER=sample 로 두거나 구현을 채워 주세요.');
}

export async function getProfile(id) {
  // 업체별 응답을 모아 Profile 형식으로 변환해 돌려주세요.
  // 데이터를 받지 못한 영역은 coverage 의 해당 값을 false 로 두면 리포트에 '정보 제한'으로 표시됩니다.
  throw new Error('template 공급자는 아직 구현되지 않았습니다.');
}
