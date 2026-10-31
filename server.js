'use strict';
// Servidor local de pré-visualização do site gerado em dist/.
// Em produção ele NÃO é necessário: publique a pasta dist/ em qualquer hospedagem estática.

const http = require('http');
const fs = require('fs');
const path = require('path');
const cfg = require('./lib/config');

const DIST = path.join(cfg.ROOT, 'dist');
const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || '127.0.0.1';

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('A pasta dist/ ainda não existe. Gere o site primeiro:  npm run gerar -- AC   (ou: npm run gerar -- todos)');
  process.exit(1);
}

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.bin': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2',
};
// Mesmos cabeçalhos de segurança de public/_headers.
const SEGURANCA = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

const servidor = http.createServer((req, res) => {
  const fim = (status, texto) => { res.writeHead(status, { ...SEGURANCA, 'Content-Type': 'text/plain; charset=utf-8' }); res.end(texto); };
  if (req.method !== 'GET' && req.method !== 'HEAD') return fim(405, 'Método não permitido.');
  let rota;
  try { rota = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { return fim(400, 'Endereço inválido.'); }
  // Caracteres de controle (ex.: %00) fariam o fs lançar erro síncrono e derrubar o servidor.
  if (/[\u0000-\u001f\u007f]/.test(rota)) return fim(400, 'Endereço inválido.');
  if (rota.endsWith('/')) rota += 'index.html';
  const arquivo = path.resolve(DIST, '.' + rota);
  const tipo = TIPOS[path.extname(arquivo).toLowerCase()];
  // Bloqueia saída da pasta dist/, arquivos ocultos e extensões não previstas.
  if (!arquivo.startsWith(DIST + path.sep) || /(^|[\\/])\./.test(path.relative(DIST, arquivo)) || !tipo) return fim(404, 'Não encontrado.');
  fs.readFile(arquivo, (err, corpo) => {
    if (err) return fim(404, 'Não encontrado.');
    res.writeHead(200, { ...SEGURANCA, 'Content-Type': tipo, 'Content-Length': corpo.length, 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : corpo);
  });
});

// Última barreira: um pedido com erro inesperado não derruba a pré-visualização.
servidor.on('clientError', (_err, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); });

servidor.on('error', err => {
  if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
    console.error(`Não foi possível usar a porta ${PORT} (${err.code}). Use outra, por exemplo:\n  PowerShell:  $env:PORT=3000; npm start\n  Bash:        PORT=3000 npm start`);
    process.exit(1);
  }
  throw err;
});
servidor.listen(PORT, HOST, () => console.log(`Pré-visualização do site estático: http://${HOST}:${PORT}/`));
