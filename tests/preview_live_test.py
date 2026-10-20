# 미리보기 파일의 '실데이터' 모드 점검. 외부 API 요청을 가짜 서버(tests/mock-data-sources.mjs, 54402)로 돌려 확인합니다.
#   node tests/mock-data-sources.mjs &  →  python3 tests/preview_live_test.py <미리보기.html> [스크린샷 폴더]
import sys, re
from playwright.sync_api import sync_playwright
FILE, OUT = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else '/tmp')
MOCK = 'http://127.0.0.1:54402'
MAP = [(r'^https://api\.gleif\.org/api/v1', '/gleif'), (r'^https://rdap\.org', '/rdap'), (r'^https://api\.opensanctions\.org', '/os')]
passed = 0
def ok(n):
    global passed; passed += 1; print('  ✓', n)
def proxy(route):
    url = route.request.url
    for pat, pre in MAP:
        if re.match(pat, url):
            r = route.fetch(url=re.sub(pat, MOCK + pre, url))
            return route.fulfill(response=r, headers={**r.headers, 'access-control-allow-origin': '*'})
    route.continue_()
with sync_playwright() as p:
    b = p.chromium.launch()
    for vp, tag in [((1280, 900), 'desktop'), ((390, 844), 'mobile')]:
        pg = b.new_page(viewport={'width': vp[0], 'height': vp[1]})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.route(re.compile(r'^https://(api\.gleif\.org|rdap\.org|api\.opensanctions\.org)/'), proxy)
        pg.goto('file://' + FILE + '#/search')
        pg.click('[data-mode=live]')
        pg.wait_for_selector('#qc')
        ok(f'[{tag}] 실데이터로 전환 → 국가 선택 표시')
        pg.fill('#q', 'acme global'); pg.click('#searchForm button[type=submit]')
        pg.wait_for_selector('.candidate', timeout=10000)
        assert pg.locator('.candidate').count() == 3
        pg.locator('.candidate').first.click()
        pg.wait_for_selector('.cov', timeout=10000)
        t = pg.inner_text('#view'); assert 'GLEIF' in t and '미리보기' in t and '제재·수출통제 명단' in t, t[:300]
        ok(f'[{tag}] 실데이터 리포트 (등록부 조회됨, 제재 명단은 키 없어 미연결)')
        pg.goto('file://' + FILE + '#/search')
        pg.click('.oskey summary'); pg.fill('#osKey', 'test-os-key'); pg.click('#osSave')
        pg.fill('#q', 'rogue arms'); pg.click('#searchForm button[type=submit]')
        pg.wait_for_selector('.candidate', timeout=10000); pg.locator('.candidate').first.click()
        pg.wait_for_selector('.cov', timeout=10000)
        assert '근거 보기' in pg.inner_text('#view'); ok(f'[{tag}] 키 저장 → 제재 일치 F등급')
        if tag == 'desktop': pg.screenshot(path=f'{OUT}/preview-live-sanction.png', full_page=True)
        pg.unroute_all(); pg.route(re.compile(r'^https://(api\.gleif\.org|rdap\.org|api\.opensanctions\.org)/'), lambda r: r.abort())
        pg.evaluate("Object.keys(localStorage).filter(k=>k.startsWith('tc.src.')).forEach(k=>localStorage.removeItem(k))")
        pg.goto('file://' + FILE + '#/search')
        pg.fill('#q', 'blocked company'); pg.click('#searchForm button[type=submit]')
        pg.wait_for_selector('.cov', timeout=20000)
        assert 'CORS' in pg.inner_text('#view'); ok(f'[{tag}] 연결이 막히면 원인 안내')
        sw = pg.evaluate('document.documentElement.scrollWidth'); assert sw <= vp[0], sw; ok(f'[{tag}] 가로 넘침 없음')
        pg.click('[data-mode=sample]') if pg.locator('[data-mode=sample]').count() else None
        assert not errs, errs; ok(f'[{tag}] 스크립트 오류 없음')
    b.close()
print(f'\n{passed}개 통과')
