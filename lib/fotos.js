'use strict';
// Fotos dos candidatos (TSE — "foto_cand2026_{UF|BR}_div.zip"): uma JPG pequena (~5 KB) por
// candidatura, nomeada pelo sequencial do candidato, o mesmo id usado na busca. O ZIP é baixado
// uma vez, as fotos ficam em cache e o gerador copia cada uma para dist/img/c/{id}.jpg.

const fs = require('fs');
const path = require('path');
const { CACHE_DIR, FONTES, LIMITES } = require('./config');
const { idadeMs, garantirDir } = require('./util');
const { baixarArquivo, listarZipLocal, abrirEntradaLocal } = require('./net');

const DIR = path.join(CACHE_DIR, 'fotos-v1');
const ARQUIVO = /F[A-Z]{2}(\d{6,14})_div\.jpe?g$/i;
const MAX_FOTO = 512 * 1024; // foto de candidatura tem poucos KB; acima disso é descartada

async function garantirFotos(sigla) {
  const dir = path.join(DIR, sigla);
  const pronto = path.join(dir, '_pronto');
  if (idadeMs(pronto) < LIMITES.dadosAbertosTtlMs) return;
  garantirDir(dir);
  const zip = path.join(DIR, `${sigla}.zip`);
  try {
    await baixarArquivo(FONTES.fotos(sigla), zip);
  } catch (err) {
    if (fs.existsSync(pronto)) { console.warn(`Fotos ${sigla}: usando cópia local (${err.message}).`); return; }
    throw err;
  }
  let n = 0;
  for (const e of await listarZipLocal(zip)) {
    const m = ARQUIVO.exec(e.nome);
    if (!m || e.tam > MAX_FOTO) continue;
    const partes = [];
    for await (const c of abrirEntradaLocal(zip, e)) partes.push(c);
    const buf = Buffer.concat(partes);
    // Só JPEG de verdade (assinatura FF D8 FF): o arquivo vai ser servido como imagem.
    if (buf.length > MAX_FOTO || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) continue;
    fs.writeFileSync(path.join(dir, `${m[1]}.jpg`), buf);
    n++;
  }
  fs.rmSync(zip, { force: true });
  fs.writeFileSync(pronto, new Date().toISOString());
  console.log(`Fotos ${sigla}: ${n} fotos.`);
}

// Caminho da foto em cache (ou null). id = sequencial do candidato; sigla = UF ou "BR".
function arquivoFoto(sigla, id) {
  if (!/^[A-Z]{2}$/.test(sigla) || !/^\d{6,14}$/.test(String(id))) return null;
  const f = path.join(DIR, sigla, `${id}.jpg`);
  return fs.existsSync(f) ? f : null;
}

module.exports = { garantirFotos, arquivoFoto };
