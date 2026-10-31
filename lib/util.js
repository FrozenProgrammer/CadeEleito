'use strict';
// Utilitários: arquivos atômicos, cache em memória (LRU), normalização de texto.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

function garantirDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function tmpAo(file) {
  return `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
}

function escreverAtomico(file, conteudo) {
  garantirDir(path.dirname(file));
  const tmp = tmpAo(file);
  fs.writeFileSync(tmp, conteudo);
  fs.renameSync(tmp, file);
}

function escreverJson(file, obj) {
  escreverAtomico(file, JSON.stringify(obj));
}

function escreverJsonGz(file, obj) {
  escreverAtomico(file, zlib.gzipSync(JSON.stringify(obj), { level: 6 }));
}

// Lê JSON (ou JSON gzip). Retorna null se não existir; remove arquivos corrompidos.
function lerJson(file) {
  let buf;
  try { buf = fs.readFileSync(file); } catch { return null; }
  try {
    if (file.endsWith('.gz')) buf = zlib.gunzipSync(buf);
    return JSON.parse(buf.toString('utf8'));
  } catch (err) {
    console.warn('Cache inválido removido:', file, err.message);
    try { fs.unlinkSync(file); } catch { /* ignora */ }
    return null;
  }
}

function idadeMs(file) {
  try { return Date.now() - fs.statSync(file).mtimeMs; } catch { return Infinity; }
}

// Cache LRU simples baseado em Map (ordem de inserção).
class Lru {
  constructor(max) { this.max = max; this.map = new Map(); }
  get(k) {
    if (!this.map.has(k)) return undefined;
    const v = this.map.get(k);
    this.map.delete(k); this.map.set(k, v);
    return v;
  }
  set(k, v) {
    this.map.delete(k); this.map.set(k, v);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
    return v;
  }
  delete(k) { this.map.delete(k); }
  get size() { return this.map.size; }
}

// Deduplica operações assíncronas simultâneas com a mesma chave.
function criarDeduplicador() {
  const emAndamento = new Map();
  return function dedup(chave, fn) {
    if (emAndamento.has(chave)) return emAndamento.get(chave);
    const p = Promise.resolve().then(fn).finally(() => emAndamento.delete(chave));
    emAndamento.set(chave, p);
    return p;
  };
}

function normalizar(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Cópia "plana" de uma string. Substrings em V8 podem referenciar o texto original
// inteiro (um bloco de ~64 KB do CSV); guardar só a cópia libera esse bloco.
function copiar(s) {
  return s ? Buffer.from(String(s), 'utf8').toString('utf8') : '';
}

function erroHttp(status, mensagem) {
  const e = new Error(mensagem);
  e.statusCode = status;
  return e;
}

module.exports = { copiar, garantirDir, escreverAtomico, escreverJson, escreverJsonGz, lerJson, idadeMs, Lru, criarDeduplicador, normalizar, erroHttp, tmpAo };
