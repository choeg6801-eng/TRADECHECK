// 로컬 미리보기 서버 — 설치 없이 `node dev-server.mjs` 로 실행합니다. (Node 18 이상)
// 정적 파일과 api/ 함수를 Vercel 과 같은 방식으로 돌려 줍니다.
// 환경변수가 없으면 데모 모드, SUPABASE_URL 등이 있으면 실서비스 모드로 동작합니다.
//   예) SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... node dev-server.mjs
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);

// .env.local 이 있으면 읽기
const envFile = path.join(root, '.env.local');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '');
  }
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8' };

async function serveApi(req, res, pathname) {
  const rel = pathname.replace(/^\/api\//, '').replace(/\/$/, '');
  const file = path.join(root, 'api', rel + '.js');
  if (!file.startsWith(path.join(root, 'api')) || !existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end('{"error":"not found"}');
  }
  const mod = await import(pathToFileURL(file).href + '?t=' + (process.env.DEV_RELOAD ? Date.now() : 0));
  return mod.default(req, res);
}

async function serveStatic(res, pathname) {
  let p = decodeURIComponent(pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(root, p);
  if (!(file === root || file.startsWith(root + path.sep)) || /\/(\.|lib\/server\/|supabase\/|tests\/|tools\/)/.test(p)) { res.writeHead(404); return res.end('not found'); }
  try {
    const s = await stat(file);
    if (s.isDirectory()) return serveStatic(res, p + '/');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
}

http
  .createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    try {
      if (pathname.startsWith('/api/')) await serveApi(req, res, pathname);
      else await serveStatic(res, pathname);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.writeHead(500);
      res.end('server error');
    }
  })
  .listen(port, () => {
    const live = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY;
    console.log(`Trade Checker → http://localhost:${port}  (${live ? '실서비스 모드' : '데모 모드'})`);
  });
