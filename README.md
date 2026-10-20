# Trade Checker

해외영업팀을 위한 B2B 바이어 신용 검증 서비스입니다.
회사명·이메일·URL을 입력하면 무역 안전 등급(A·B·C·D·F)과 결제 조건 가이드를 보여 줍니다.

- **화면**: 순수 HTML·CSS·JavaScript (빌드 과정 없음)
- **서버**: `api/` 폴더의 Vercel 서버리스 함수 (외부 패키지 없음, Node 18+)
- **회원·DB**: Supabase (Auth + Postgres, 행 단위 보안 RLS 적용)
- **결제**: 토스페이먼츠 결제위젯 v2 + 서버 승인 API
- **데이터**: 기본은 샘플 데이터. `DATA_PROVIDER=live` 로 바꾸면 실데이터(법인 등록부·도메인 무료, 제재 명단·신용평가·통관은 키를 넣은 것만)로 조회합니다. → [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md)

## 지금 바로 동작하는 기능

| 기능 | 설명 |
|---|---|
| 랜딩 페이지 `/` | 소개·요금제, **가입 없이 바로 체험**(바이어·금액·조건을 고르면 위험 노출액 계산), 모바일 하단 고정 버튼 |
| 회원가입·로그인 `/login.html` | 이메일 인증, 비밀번호 재설정 포함 |
| 바이어 조회 `/app/` | 동명 법인 후보 선택 → A~F 등급 리포트 |
| 리포트 | 위험 신호, 통관 추이 차트, 소송·파산, 결제 조건 가이드, 영문 협상 문구 복사, PDF 저장(인쇄) |
| **거래 조건 계산기** | 거래 금액과 바이어가 요청한 결제 조건을 넣으면 '못 받을 수 있는 금액(위험 노출액)'과 권장 조건을 비교 |
| **품의서 문구 복사** | 결재 문서에 붙여 넣을 한국어 보고 문구 자동 작성 (등급·근거·계산기 결과 포함) |
| **왜 이 등급?** | 위험 점수 구간 막대와 점수를 올린 항목을 보여 주는 등급 산정 근거 |
| 조회 기록 · **바이어 비교** | 등급 필터·검색, 최대 3곳을 체크해 한 화면에서 비교 |
| 관심 거래처 | 등록·다시 확인. Team 요금제는 매일 자동 재평가 후 등급 변동 표시 + **메일 알림**(설정 시) |
| **Team 좌석** | 소유자 포함 5명. 이메일로 초대 → 상대가 직접 '초대 수락'해야 합류. 팀 한도 공유, 조회 기록 '팀 전체' 보기 |
| **공유 링크** | 리포트를 로그인 없이 볼 수 있는 읽기 전용 링크(14일, 언제든 끄기 가능) — 팀장·재무팀 결재용 |
| **CSV 내보내기** | 조회 기록을 엑셀에서 여는 CSV로 저장 |
| 요금제·결제 | 단건 ₩9,900 / Starter ₩49,000 / Team ₩199,000 (월, 부가세 별도), 연간 20% 할인, Team 14일 무료 체험, **추가 조회 10건 묶음**(Starter ₩30,000 · Team ₩20,000) |
| 요금제 변경 | Starter ↔ Team 으로 바꾸면 남은 기간을 금액 비율대로 새 요금제에 더해 줌 |
| 결제 안전장치 | 결제 상태가 '완료'일 때만 반영, 가상계좌는 입금 후 웹훅으로 반영, 승인 응답을 놓쳐도 재확인으로 복구 |
| 조회 한도 | 가입 시 무료 3건, Starter 월 20건, Team 월 150건, 크레딧 별도. 조회 실패 시 자동 환불, 1분 12건 속도 제한 |

환경변수가 하나도 없으면 **데모 모드**로 동작합니다. 로그인 없이 샘플 데이터로 모든 화면을 체험할 수 있어, 배포 직후 바로 확인해 볼 수 있습니다.

## 출시 순서

### 1. GitHub에 올리기
이 폴더의 내용을 저장소에 그대로 올립니다. (`index.html` 이 저장소 맨 위에 있어야 합니다)

### 2. Vercel 배포 (데모 모드로 먼저 확인)
Vercel → Add New → Project → 저장소 Import → Framework Preset `Other` → Deploy.
배포 주소의 `/app/` 에서 데모 모드가 동작하면 성공입니다.

> 상업적 서비스는 Vercel **Pro 플랜**이 필요합니다. (Hobby 플랜은 비상업적 개인 용도 한정)

### 3. Supabase 연결 (회원·DB)
1. [supabase.com](https://supabase.com) 에서 새 프로젝트를 만듭니다. 리전은 서울(Northeast Asia)을 권장합니다.
2. **SQL Editor** 에서 `supabase/migrations/` 의 파일을 **번호 순서대로**(0001 → 0002 → 0003 → 0004) 붙여 넣고 각각 **Run** 합니다. 여러 번 실행해도 안전합니다.
   - **Authentication → Sign In / Providers → Email 의 'Confirm email' 은 켜 두세요.** 무료 체험·팀 초대가 '이메일 인증을 마친 계정'만 쓸 수 있게 되어 있어, 끄면 남의 이메일로 가입해 초대를 가로챌 수 있습니다.
3. **Authentication → URL Configuration** 에서
   - Site URL: `https://내도메인`
   - Redirect URLs: `https://내도메인/login.html`
4. **Project Settings → API** 에서 URL, anon(또는 publishable) 키, service_role(또는 secret) 키를 복사합니다.

### 4. 토스페이먼츠 연결 (결제)
1. [토스페이먼츠 개발자센터](https://developers.tosspayments.com) 에 가입하고 **결제위젯 연동 키**(클라이언트 키 `test_gck_…`, 시크릿 키 `test_gsk_…`)를 확인합니다.
2. 테스트 키로 결제 흐름을 확인한 뒤, 가맹점 계약·심사가 끝나면 라이브 키(`live_…`)로 바꿉니다.
3. **웹훅 등록**: 개발자센터 → 웹훅 → `https://내도메인/api/payments/webhook` (이벤트 `PAYMENT_STATUS_CHANGED`, `DEPOSIT_CALLBACK`). 가상계좌 입금과 **환불(결제 취소) 시 이용권 회수**가 이 경로로 반영됩니다. 웹훅 본문은 믿지 않고 토스 API로 다시 확인한 뒤 반영합니다. (부분 환불은 주문에 표시만 남기므로 직접 조정하세요)

### 5. Vercel 환경변수 입력 → 재배포
Vercel → Project → Settings → Environment Variables 에 `.env.example` 의 항목을 채우고 **Redeploy** 합니다.
그러면 데모 모드가 꺼지고 실서비스 모드(회원가입·결제·DB 저장)로 바뀝니다.

### 6. (선택) 알림 메일
[Resend](https://resend.com) 에서 도메인을 인증하고 `RESEND_API_KEY`, `ALERT_FROM`, `SITE_URL` 을 넣으면 등급 변동 알림과 팀 초대 메일이 발송됩니다.

### 7. 공개 전 체크리스트
- [ ] `index.html` 하단 `[회사명] · [주소] · [대표 이메일]` 채우기
- [ ] 도입 상담 메일 주소 `sales@tradechecker.example` → 실제 주소로 바꾸기
- [ ] `terms.html`·`privacy.html` 초안의 [ ] 칸 채우기 + 법률 검토 (환불 조건, 국외 이전 고지 등)
- [ ] 사업자 정보 표시 (전자상거래법상 사업자등록번호·통신판매업 신고번호 등)
- [ ] 토스페이먼츠 라이브 키 교체, Vercel Pro 전환
- [ ] 실제 데이터 업체 연결 (아래 참고)
- [ ] 데이터 업체 계약서의 재판매(고객 표시) 권한 확인, 신용정보법 해당 여부 법률 검토

## 실제 데이터 연결하기
자세한 단계·비용·계약 시 확인사항은 **[docs/DATA_SOURCES.md](docs/DATA_SOURCES.md)** 에 있습니다.

1. Supabase SQL Editor에서 `supabase/migrations/0002_live_data.sql` 도 실행합니다. (유료 API 중복 호출을 막는 캐시)
2. Vercel 환경변수 `DATA_PROVIDER=live` → 재배포. 법인 등록부(GLEIF)·도메인(RDAP)은 키 없이 바로 동작합니다.
3. `OPENSANCTIONS_API_KEY` 를 넣으면 제재·수출통제·사기 명단 검색이 켜집니다.
4. Creditsafe 계약 후 `CREDITSAFE_USERNAME`·`CREDITSAFE_PASSWORD` 를 넣고 `tools/creditsafe-schema.mjs` 로 필드를 확인합니다.
5. 확인하지 못한 영역이 많으면 등급 상한이 자동으로 걸립니다. (2개 이하 → 최고 C, 4개 이하 → 최고 B)

등급 기준(가중치·구간)은 `lib/engine.js` 의 `RULES` 한곳에서 조정합니다.

## 테스트 데이터
- **샘플 바이어 21곳** (`lib/providers/sample.js`): A 5 · B 6 · C 4 · D 3 · F 3곳. 회사명·한글 별칭·사업자번호·웹사이트로 검색할 수 있습니다.
- **정답표·테스트 시나리오**: `Trade-Checker-테스트데이터.xlsx` (검색·계산기·실서비스 테스트)
- **실서비스 시드 데이터**: `supabase/seed_test_data.sql` — 테스트 계정으로 가입한 뒤 파일 맨 위 이메일만 바꿔 SQL Editor에서 실행하면 조회 기록 8건, 관심 거래처 3곳(등급 변동 1건), 결제 내역 2건, Starter 요금제가 채워집니다. 여러 번 실행해도 중복되지 않습니다.

## 테스트
```bash
node tests/live-sources.test.mjs     # 실데이터 연결부 20개
bash tests/run-live-tests.sh         # 실서비스 API 29개 (로컬 Postgres 필요)
psql ... -f tests/sql_scenarios.sql  # DB 함수 시나리오 (요금제 환산·팀·환불)
python3 tests/team_ui_test.py        # 팀·공유·CSV 화면 (run-live-tests 의 서버가 떠 있을 때)
```

## 미리보기 파일 만들기 (배포 전 확인용)
```bash
node tools/build-preview.mjs      # → preview/trade-checker-preview.html
```
랜딩·앱·사진을 HTML 한 파일로 묶습니다. 서버 없이 더블클릭으로 열리며, 샘플 데이터로 모든 화면을 체험할 수 있습니다. (로그인·결제는 제외)

## 로컬에서 실행
```bash
node dev-server.mjs          # http://localhost:3000 (데모 모드)
```
`.env.example` 을 `.env.local` 로 복사해 값을 채우면 실서비스 모드로 실행됩니다.

## 폴더 구조
```
index.html            랜딩 페이지
login.html            로그인·회원가입·비밀번호 재설정
share.html            공유 링크로 연 읽기 전용 리포트
terms.html privacy.html  이용약관·개인정보처리방침 (초안)
app/                  서비스 화면 (조회·리포트·기록·관심 거래처·결제)
assets/               CSS, JS, 이미지
api/                  서버 함수 (Vercel이 자동 인식)
  search.js           조회 + 한도 차감(유료 데이터 호출 전) + 리포트 저장
  reports.js  me.js  watchlist.js  trial.js  config.js
  team.js             팀원 초대·수락·내보내기
  share.js            리포트 공유 링크
  payments/           prepare.js(주문 생성) · confirm.js(토스 승인) · webhook.js(입금·상태 변경)
  cron/recheck.js     관심 거래처 매일 재평가 + 메일 알림
lib/
  engine.js           등급 산정 엔진 (가중치 RULES)
  products.js         요금제·상품·가격
  providers/          데이터 공급자 (sample, live, template)
  sources/            실데이터 출처 (GLEIF, RDAP, OpenSanctions, Creditsafe, ImportGenius)
  countries.js        국가 코드 ↔ 한국어 이름
  server/             서버 공통 (Supabase 호출, 인증)
supabase/migrations/  DB 스키마·함수·보안 정책
tests/                통합·화면·반응형 점검 테스트 (실데이터: live-sources.test.mjs, live_ui_test.py)
docs/DATA_SOURCES.md  실데이터 도입 가이드
tools/build-preview.mjs  미리보기 단일 HTML 생성
```

## 보안 설계
- 결제 금액은 서버가 정하고 저장합니다. 승인할 때 저장된 금액과 비교해 위조를 막습니다.
- 조회 차감·결제 반영 함수는 서버(service role)만 실행할 수 있습니다. 브라우저에서는 호출할 수 없습니다.
- 브라우저는 RLS 정책으로 자기 데이터만 읽을 수 있습니다.
- 비밀키(service role, 토스 시크릿)는 서버 환경변수에만 있고, 화면으로 내려가지 않습니다.
- 결제는 토스 API가 '완료(DONE)'와 금액·주문번호 일치를 확인해 줄 때만 반영합니다. 웹훅도 토스에 다시 조회한 뒤 처리합니다.
- 팀 합류는 초대받은 사람이 인증된 이메일로 직접 수락해야만 이루어집니다. 팀 요금제가 끝나면 팀 기록 공유도 멈춥니다.
- 유료 데이터(제재 명단·신용평가)는 조회 건수를 차감한 뒤에만 부르고, 로그인 없는 데모에서는 부르지 않습니다.
- 로그인 후 돌아갈 주소는 같은 사이트 안으로만 허용합니다.

## 다음 단계로 추천하는 것
- **정기결제 자동 갱신**: 지금은 30일·365일 이용권 방식입니다. 자동 갱신은 토스페이먼츠 자동결제(빌링) 별도 계약이 필요합니다.
- **카카오 알림톡**: 메일 대신 알림톡으로 등급 변동을 보내려면 `lib/server/notify.js` 에 발송 함수를 추가하세요.
