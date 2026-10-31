// Segurança do servidor de pré-visualização (server.js): só serve dist/, com os cabeçalhos certos.
// Os caminhos são enviados crus (http.request), sem a normalização que o fetch faria.
// Rodar: npm test

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temSite = fs.existsSync(path.join(RAIZ, 'dist', 'index.html'));
const opts = { skip: temSite ? false : 'dist/ não existe (rode npm run gerar)' };
let servidor, porta;

const portaLivre = () => new Promise(res => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

function pedir(caminho, { metodo = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: porta, path: caminho, method: metodo }, res => {
      const partes = [];
      res.on('data', c => partes.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, corpo: Buffer.concat(partes).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

before(async () => {
  if (!temSite) return;
  porta = await portaLivre();
  servidor = spawn(process.execPath, ['server.js'], { cwd: RAIZ, env: { ...process.env, PORT: String(porta), HOST: '127.0.0.1' }, stdio: 'pipe' });
  await new Promise((resolve, reject) => {
    servidor.stdout.on('data', d => { if (String(d).includes('http://')) resolve(); });
    servidor.on('exit', c => reject(new Error(`servidor saiu (${c})`)));
    setTimeout(() => reject(new Error('servidor não subiu')), 10_000);
  });
});
after(() => servidor?.kill());

test('página inicial com cabeçalhos de segurança', opts, async () => {
  const r = await pedir('/');
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /text\/html/);
  const csp = r.headers['content-security-policy'];
  for (const diretiva of ["default-src 'self'", "script-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'none'"]) assert.ok(csp.includes(diretiva), diretiva);
  assert.ok(!/unsafe-inline|unsafe-eval|\*/.test(csp), 'CSP sem unsafe-inline/eval/curingas');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['x-frame-options'], 'DENY');
  assert.ok(r.headers['referrer-policy']);
});

test('não sai de dist/ (travessia de diretório em todas as codificações)', opts, async () => {
  const ataques = [
    '/../package.json', '/..%2fpackage.json', '/%2e%2e/package.json', '/%2e%2e%2fserver.js', '/..%5cserver.js',
    '/js/../../server.js', '/js/%2e%2e/%2e%2e/lib/config.js', '/%252e%252e/server.js', '/..\\server.js',
    '/dados/..%2f..%2f..%2fpackage.json', '//etc/passwd', '/C:/Windows/win.ini', '/%00', '/index.html%00.png',
  ];
  for (const a of ataques) {
    const r = await pedir(a);
    assert.ok([400, 404].includes(r.status), `${a} -> ${r.status}`);
    assert.ok(!/"scripts"|require\(|\[fonts\]|root:/.test(r.corpo), `${a} vazou conteúdo`);
  }
});

test('arquivos ocultos, extensões não previstas e métodos de escrita são recusados', opts, async () => {
  assert.equal((await pedir('/.htaccess')).status, 404);
  assert.equal((await pedir('/js/.segredo.js')).status, 404);
  assert.equal((await pedir('/_headers')).status, 404, 'arquivo sem extensão conhecida');
  assert.equal((await pedir('/index.html', { metodo: 'POST' })).status, 405);
  assert.equal((await pedir('/index.html', { metodo: 'PUT' })).status, 405);
  assert.equal((await pedir('/index.html', { metodo: 'DELETE' })).status, 405);
  const head = await pedir('/index.html', { metodo: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.corpo, '');
  assert.equal((await pedir('/%E0%A4%A')).status, 400, 'URL malformada');
});

test('tipos de conteúdo corretos (nosniff exige isso)', opts, async () => {
  assert.match((await pedir('/js/app.js')).headers['content-type'], /text\/javascript/);
  assert.match((await pedir('/css/app.css')).headers['content-type'], /text\/css/);
  assert.match((await pedir('/dados/indice.bin')).headers['content-type'], /application\/octet-stream/);
  assert.match((await pedir('/favicon.svg')).headers['content-type'], /image\/svg\+xml/);
});

test('_headers, .htaccess, meta CSP e servidor usam a mesma política', () => {
  const ler = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
  const extrair = (texto, re) => (texto.match(re) || [])[1];
  const headers = extrair(ler('public/_headers'), /Content-Security-Policy: (.+)/);
  const htaccess = extrair(ler('public/.htaccess'), /Content-Security-Policy "([^"]+)"/);
  const server = extrair(ler('server.js'), /'Content-Security-Policy': "([^"]+)"/);
  const meta = extrair(ler('public/index.html'), /http-equiv="Content-Security-Policy" content="([^"]+)"/);
  assert.equal(htaccess, headers);
  assert.equal(server, headers);
  // frame-ancestors não vale em <meta>; o resto deve ser igual.
  assert.equal(meta, headers.replace(/; frame-ancestors 'none'/, ''));
  // Nenhum script inline ou recurso externo no HTML.
  const html = ler('public/index.html');
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html), 'sem <script> inline');
  assert.ok(!/\son[a-z]+=/.test(html), 'sem atributos on*= inline');
  assert.ok(!/(src|href)="(https?:)?\/\//.test(html), 'sem recursos de outros domínios');
  assert.ok(!/style="/.test(html), 'sem style inline (CSP style-src self)');
});
