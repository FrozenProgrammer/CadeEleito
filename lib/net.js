'use strict';
// Acesso de rede às fontes oficiais (TSE / IBGE), restrito a hosts permitidos.
// Inclui leitura de ZIP remoto via HTTP Range: só a entrada necessária é baixada.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Readable, Transform } = require('stream');
const { StringDecoder } = require('string_decoder');
const { HOSTS_PERMITIDOS, LIMITES, APP_VERSION } = require('./config');
const { garantirDir, tmpAo } = require('./util');

const USER_AGENT = `BR-Eleicoes-2026/${APP_VERSION} (+painel independente de dados abertos)`;

async function fetchSeguro(url, { headers = {}, timeoutMs = 30_000, profundidade = 0 } = {}) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !HOSTS_PERMITIDOS.has(u.hostname)) throw new Error(`Host não permitido: ${u.hostname}`);
  if (profundidade > 3) throw new Error('Redirecionamentos demais.');
  const res = await fetch(u, {
    headers: { 'User-Agent': USER_AGENT, ...headers },
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
    try { await res.body?.cancel(); } catch { /* ignora */ }
    return fetchSeguro(new URL(res.headers.get('location'), u).href, { headers, timeoutMs, profundidade: profundidade + 1 });
  }
  return res;
}

async function lerCorpoLimitado(res, max) {
  const declarado = Number(res.headers.get('content-length') || 0);
  if (declarado > max) throw new Error('Resposta excede o limite permitido.');
  const partes = [];
  let total = 0;
  for await (const chunk of res.body) {
    total += chunk.length;
    if (total > max) throw new Error('Resposta excede o limite permitido.');
    partes.push(chunk);
  }
  return Buffer.concat(partes.map(c => Buffer.from(c)));
}

// Respostas transitórias da CDN do TSE (inclusive 304 espúrio sem requisição condicional).
const TRANSITORIOS = new Set([304, 408, 425, 429, 500, 502, 503, 504]);

async function obterBuffer(url, opts = {}) {
  for (let tentativa = 1; ; tentativa++) {
    try {
      return await obterBufferUmaVez(url, tentativa > 1 ? { ...opts, headers: { ...opts.headers, 'Cache-Control': 'no-cache' } } : opts);
    } catch (err) {
      const transitorio = err.transitorio || err.name === 'TimeoutError' || err.cause?.code === 'ECONNRESET' || err.message === 'fetch failed';
      if (!transitorio || tentativa >= 3) throw err;
      await new Promise(r => setTimeout(r, 400 * tentativa ** 2));
    }
  }
}

async function obterBufferUmaVez(url, opts) {
  const res = await fetchSeguro(url, opts);
  if (res.status === 404 || res.status === 403) {
    try { await res.body?.cancel(); } catch { /* ignora */ }
    const e = new Error(`Arquivo não publicado pelo TSE (HTTP ${res.status}).`);
    e.statusCode = 404;
    throw e;
  }
  if (res.status !== 200 && res.status !== 206) {
    try { await res.body?.cancel(); } catch { /* ignora */ }
    const e = new Error(`HTTP ${res.status} ao consultar ${new URL(url).hostname}`);
    e.transitorio = TRANSITORIOS.has(res.status);
    throw e;
  }
  return lerCorpoLimitado(res, opts.max || LIMITES.respostaTseMaxBytes);
}

async function obterJson(url, opts) {
  return JSON.parse((await obterBuffer(url, opts)).toString('utf8'));
}

async function obterFaixa(url, inicio, fim) {
  const res = await fetchSeguro(url, { headers: { Range: `bytes=${inicio}-${fim}` } });
  if (res.status !== 206) {
    try { await res.body?.cancel(); } catch { /* ignora */ }
    throw new Error(`O servidor não aceitou leitura parcial (HTTP ${res.status}).`);
  }
  return lerCorpoLimitado(res, fim - inicio + 1 + 1024);
}

async function baixarArquivo(url, destino) {
  garantirDir(path.dirname(destino));
  const res = await fetchSeguro(url, { timeoutMs: 30 * 60_000 });
  if (res.status !== 200) {
    try { await res.body?.cancel(); } catch { /* ignora */ }
    throw new Error(`HTTP ${res.status} ao baixar ${url}`);
  }
  const tmp = tmpAo(destino);
  let total = 0;
  const limite = LIMITES.downloadMaxBytes;
  try {
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(tmp);
      const origem = Readable.fromWeb(res.body);
      origem.on('data', c => { total += c.length; if (total > limite) origem.destroy(new Error('Download excede o limite permitido.')); });
      origem.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      origem.pipe(out);
    });
    fs.renameSync(tmp, destino);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* ignora */ }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// ZIP (local ou remoto). Suporta ZIP64 para arquivos grandes do TSE.

function lerDiretorioCentral(cauda, lerFaixa, tamanhoTotal) {
  return (async () => {
    let eocd = -1;
    for (let i = cauda.length - 22; i >= 0; i--) if (cauda.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('ZIP inválido: diretório central não encontrado.');
    let qtd = cauda.readUInt16LE(eocd + 10);
    let cdTam = cauda.readUInt32LE(eocd + 12);
    let cdOff = cauda.readUInt32LE(eocd + 16);
    if (cdOff === 0xffffffff || cdTam === 0xffffffff || qtd === 0xffff) {
      // Localizador ZIP64 imediatamente antes do EOCD.
      const loc = eocd - 20;
      if (loc < 0 || cauda.readUInt32LE(loc) !== 0x07064b50) throw new Error('ZIP64 sem localizador.');
      const off64 = Number(cauda.readBigUInt64LE(loc + 8));
      const rec = await lerFaixa(off64, off64 + 55);
      if (rec.readUInt32LE(0) !== 0x06064b50) throw new Error('ZIP64 EOCD inválido.');
      qtd = Number(rec.readBigUInt64LE(32));
      cdTam = Number(rec.readBigUInt64LE(40));
      cdOff = Number(rec.readBigUInt64LE(48));
    }
    if (cdOff + cdTam > tamanhoTotal) throw new Error('ZIP inválido: diretório central fora do arquivo.');
    const cd = await lerFaixa(cdOff, cdOff + cdTam - 1);
    const entradas = [];
    let p = 0;
    for (let i = 0; i < qtd; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP inválido: entrada corrompida.');
      const metodo = cd.readUInt16LE(p + 10);
      let tamComp = cd.readUInt32LE(p + 20);
      let tam = cd.readUInt32LE(p + 24);
      const nl = cd.readUInt16LE(p + 28), el = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
      let offLocal = cd.readUInt32LE(p + 42);
      const nome = cd.subarray(p + 46, p + 46 + nl).toString('utf8');
      // Campo extra ZIP64 (id 0x0001) com os valores de 64 bits na ordem tam, tamComp, offset.
      let e = p + 46 + nl;
      const fimExtra = e + el;
      while (e + 4 <= fimExtra) {
        const id = cd.readUInt16LE(e), sz = cd.readUInt16LE(e + 2);
        if (id === 0x0001) {
          let q = e + 4;
          if (tam === 0xffffffff) { tam = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (tamComp === 0xffffffff) { tamComp = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (offLocal === 0xffffffff) { offLocal = Number(cd.readBigUInt64LE(q)); }
        }
        e += 4 + sz;
      }
      entradas.push({ nome, metodo, tamComp, tam, offLocal });
      p += 46 + nl + el + cl;
    }
    return entradas;
  })();
}

const cacheDiretorioRemoto = new Map();
async function listarZipRemoto(url) {
  const c = cacheDiretorioRemoto.get(url);
  if (c && Date.now() - c.ts < 60 * 60_000) return c.entradas;
  const res = await fetchSeguro(url, { headers: { Range: 'bytes=-65557' } });
  if (res.status !== 206) {
    try { await res.body?.cancel(); } catch { /* ignora */ }
    throw new Error(`Arquivo do TSE indisponível (HTTP ${res.status}).`);
  }
  const total = Number(String(res.headers.get('content-range') || '').split('/')[1]);
  const cauda = await lerCorpoLimitado(res, 70_000);
  const base = total - cauda.length;
  // As posições do ZIP são absolutas; leituras dentro da cauda são servidas localmente.
  const lerFaixa = (a, b) => (a >= base ? Promise.resolve(cauda.subarray(a - base, b - base + 1)) : obterFaixa(url, a, b));
  const entradas = await lerDiretorioCentral(cauda, lerFaixa, total);
  cacheDiretorioRemoto.set(url, { ts: Date.now(), entradas, tamanho: total, ultimaModificacao: res.headers.get('last-modified') || '' });
  return entradas;
}
function infoZipRemoto(url) {
  const c = cacheDiretorioRemoto.get(url);
  return c ? { tamanho: c.tamanho, ultimaModificacao: c.ultimaModificacao } : null;
}

function descompactador(metodo) {
  if (metodo === 8) return zlib.createInflateRaw();
  if (metodo === 0) return new Transform({ transform(c, _e, cb) { cb(null, c); } });
  throw new Error(`Método de compressão ZIP não suportado: ${metodo}`);
}

// Retorna um Readable com o conteúdo descompactado de uma entrada do ZIP remoto.
// `aoProgresso(bytesComprimidosLidos, total)` é chamado durante o download.
async function abrirEntradaRemota(url, entrada, aoProgresso) {
  const cab = await obterFaixa(url, entrada.offLocal, entrada.offLocal + 29);
  if (cab.readUInt32LE(0) !== 0x04034b50) throw new Error('ZIP: cabeçalho local inválido.');
  const inicio = entrada.offLocal + 30 + cab.readUInt16LE(26) + cab.readUInt16LE(28);
  const fim = inicio + entrada.tamComp - 1;
  const res = await fetchSeguro(url, { headers: { Range: `bytes=${inicio}-${fim}` }, timeoutMs: 60 * 60_000 });
  if (res.status !== 206) {
    try { await res.body?.cancel(); } catch { /* ignora */ }
    throw new Error(`Leitura parcial recusada (HTTP ${res.status}).`);
  }
  const origem = Readable.fromWeb(res.body);
  let lidos = 0;
  if (aoProgresso) origem.on('data', c => { lidos += c.length; aoProgresso(lidos, entrada.tamComp); });
  const saida = descompactador(entrada.metodo);
  origem.on('error', e => saida.destroy(e));
  return origem.pipe(saida);
}

// Abre uma entrada de um ZIP local (usado para o cadastro de candidatos em cache).
async function listarZipLocal(file) {
  const st = fs.statSync(file);
  const fd = fs.openSync(file, 'r');
  try {
    const lerFaixa = async (a, b) => { const buf = Buffer.alloc(b - a + 1); fs.readSync(fd, buf, 0, buf.length, a); return buf; };
    const tamCauda = Math.min(st.size, 65557);
    const cauda = await lerFaixa(st.size - tamCauda, st.size - 1);
    return await lerDiretorioCentral(cauda, lerFaixa, st.size);
  } finally { fs.closeSync(fd); }
}
function abrirEntradaLocal(file, entrada) {
  const fd = fs.openSync(file, 'r');
  const cab = Buffer.alloc(30);
  try { fs.readSync(fd, cab, 0, 30, entrada.offLocal); } finally { fs.closeSync(fd); }
  if (cab.readUInt32LE(0) !== 0x04034b50) throw new Error('ZIP: cabeçalho local inválido.');
  const inicio = entrada.offLocal + 30 + cab.readUInt16LE(26) + cab.readUInt16LE(28);
  const origem = fs.createReadStream(file, { start: inicio, end: inicio + entrada.tamComp - 1 });
  const saida = descompactador(entrada.metodo);
  origem.on('error', e => saida.destroy(e));
  return origem.pipe(saida);
}

// ---------------------------------------------------------------------------
// CSV do TSE: separador ';', aspas duplas, codificação Latin-1.

// Separa campos de uma linha. Para desempenho, para após `maxIndice` (se informado).
function camposCsv(linha, maxIndice = Infinity) {
  const out = [];
  let i = 0;
  const n = linha.length;
  while (i <= n && out.length <= maxIndice) {
    if (linha.charCodeAt(i) === 34) { // aspas
      let v = '';
      i++;
      for (;;) {
        const j = linha.indexOf('"', i);
        if (j < 0) { v += linha.slice(i); i = n + 1; break; }
        v += linha.slice(i, j);
        if (linha.charCodeAt(j + 1) === 34) { v += '"'; i = j + 2; continue; }
        i = j + 1;
        break;
      }
      out.push(v);
      i++; // pula ';'
    } else {
      let j = linha.indexOf(';', i);
      if (j < 0) j = n;
      out.push(linha.slice(i, j));
      i = j + 1;
    }
  }
  return out;
}

// Lê um stream CSV linha a linha. `aoCabecalho(campos)` recebe o cabeçalho;
// `aoLinha(linha)` recebe cada linha bruta (o chamador decide quantos campos extrair).
function lerLinhasCsv(stream, aoCabecalho, aoLinha) {
  return new Promise((resolve, reject) => {
    const dec = new StringDecoder('latin1');
    let resto = '';
    let cabecalho = false;
    const consumir = texto => {
      const dados = resto + texto;
      let ini = 0;
      for (;;) {
        const fim = dados.indexOf('\n', ini);
        if (fim < 0) break;
        let linha = dados.slice(ini, fim);
        ini = fim + 1;
        if (linha.endsWith('\r')) linha = linha.slice(0, -1);
        if (!linha) continue;
        if (!cabecalho) { cabecalho = true; aoCabecalho(camposCsv(linha.replace(/^﻿/, '')).map(x => x.trim())); continue; }
        aoLinha(linha);
      }
      resto = dados.slice(ini);
    };
    stream.on('data', c => { try { consumir(dec.write(c)); } catch (e) { stream.destroy(e); } });
    stream.on('end', () => {
      try { consumir(dec.end() + '\n'); resolve(); } catch (e) { reject(e); }
    });
    stream.on('error', reject);
  });
}

module.exports = { fetchSeguro, obterBuffer, obterJson, baixarArquivo, listarZipRemoto, infoZipRemoto, abrirEntradaRemota, listarZipLocal, abrirEntradaLocal, camposCsv, lerLinhasCsv };
