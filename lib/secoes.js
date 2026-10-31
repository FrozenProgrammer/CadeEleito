'use strict';
// Votação por seção eleitoral (TSE — dados abertos "votacao_secao_2026_<UF>").
//
// Preparação (uma vez por UF):
//   1. o CSV da UF é lido em fluxo direto do ZIP do TSE (HTTP Range, sem gravar o ZIP);
//   2. as linhas são particionadas em arquivos temporários por município + zona;
//   3. cada partição vira um índice compacto gzip: turno -> seção -> cargo -> votável -> votos.
// O gerador (scripts/gerar.js) junta esses índices nos arquivos estáticos do site.

const fs = require('fs');
const path = require('path');
const { CACHE_DIR, FONTES, CARGOS, UF_POR_SIGLA } = require('./config');
const { garantirDir, lerJson, escreverJson, escreverJsonGz, Lru, copiar } = require('./util');
const { listarZipRemoto, infoZipRemoto, abrirEntradaRemota, lerLinhasCsv, camposCsv } = require('./net');

const DIR = path.join(CACHE_DIR, 'secoes-v1');
const memoriaZonas = new Lru(48);
const memoriaManifestos = new Map();

// "Fonte" = unidade de preparação: 'BR' (Presidente, arquivo nacional) ou a sigla da UF
// (Governador, Senador e Deputados, arquivo estadual).
const fonteDe = (cargoId, uf) => (CARGOS[cargoId].nacional ? 'BR' : uf);
const dirFonte = fonte => path.join(DIR, fonte === 'BR' ? '_BR' : fonte);
const arquivoManifesto = fonte => path.join(dirFonte(fonte), '_pronto.json');
const arquivoZona = (fonte, uf, mun, zona) => path.join(DIR, uf, mun, `${zona}${fonte === 'BR' ? '-br' : ''}.json.gz`);

function manifesto(fonte) {
  if (memoriaManifestos.has(fonte)) return memoriaManifestos.get(fonte);
  const m = lerJson(arquivoManifesto(fonte));
  if (m) memoriaManifestos.set(fonte, m);
  return m;
}
const pronto = fonte => !!manifesto(fonte);

// ---------------------------------------------------------------------------
// Preparação.

async function prepararFonte(fonte, aoProgresso = () => {}) {
  const url = FONTES.secao(fonte);
  const entradas = await listarZipRemoto(url);
  const ent = entradas.find(e => /\.csv$/i.test(e.nome));
  if (!ent) throw new Error(`CSV de votação por seção não encontrado para ${fonte}.`);
  const tmpDir = path.join(dirFonte(fonte), '.tmp');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  garantirDir(tmpDir);
  console.log(`Seções ${fonte}: lendo ${(ent.tamComp / 1048576).toFixed(0)} MB comprimidos do TSE...`);

  // Fase 1: particionar por município + zona.
  const buffers = new Map();
  let bytesBuffer = 0;
  const descarregar = chave => {
    const b = buffers.get(chave);
    if (!b || !b.length) return;
    fs.appendFileSync(path.join(tmpDir, `${chave}.txt`), b.join(''));
    bytesBuffer -= b.tam;
    buffers.set(chave, Object.assign([], { tam: 0 }));
  };
  const nomes = {};
  const zonasPorMun = {};
  let ix = null, max = 0, linhas = 0, ultimoAviso = 0;
  await lerLinhasCsv(await abrirEntradaRemota(url, ent, (lidos, total) => {
    const agora = Date.now();
    if (agora - ultimoAviso > 500) { ultimoAviso = agora; aoProgresso('Baixando e indexando votos por seção', (lidos / total) * 0.9); }
  }), h => {
    const i = n => h.indexOf(n);
    ix = { uf: i('SG_UF'), turno: i('NR_TURNO'), mun: i('CD_MUNICIPIO'), zona: i('NR_ZONA'), secao: i('NR_SECAO'), cargo: i('CD_CARGO'), votavel: i('NR_VOTAVEL'), nome: i('NM_VOTAVEL'), votos: i('QT_VOTOS'), local: i('NR_LOCAL_VOTACAO') };
    if (Object.values(ix).some(v => v < 0)) throw new Error('Layout inesperado no arquivo de votação por seção.');
    max = Math.max(...Object.values(ix));
  }, linha => {
    const f = camposCsv(linha, max);
    const ufInfo = UF_POR_SIGLA.get(f[ix.uf]);
    if (!ufInfo) return; // exterior (ZZ) não faz parte dos filtros
    const uf = ufInfo.sigla; // string própria (não é fatia do bloco do CSV)
    const mun = String(Number(f[ix.mun])).padStart(5, '0');
    const zona = Number(f[ix.zona]);
    const chave = `${uf}-${mun}-${zona}`;
    const cargo = Number(f[ix.cargo]);
    const votavel = Number(f[ix.votavel]);
    const nk = `${cargo}|${votavel}`;
    if (nomes[nk] === undefined) nomes[nk] = copiar(f[ix.nome]);
    // Só números: o registro não mantém referência ao bloco de texto do CSV.
    const reg = `${Number(f[ix.turno])};${Number(f[ix.secao])};${cargo};${votavel};${Number(f[ix.votos])};${Number(f[ix.local])}\n`;
    let b = buffers.get(chave);
    if (!b) {
      buffers.set(chave, b = Object.assign([], { tam: 0 }));
      (zonasPorMun[`${uf}|${mun}`] ||= []).push(zona);
    }
    b.push(reg);
    b.tam += reg.length;
    bytesBuffer += reg.length;
    if (b.tam > 128 * 1024) descarregar(chave);
    if (bytesBuffer > 24 * 1024 * 1024) for (const k of buffers.keys()) descarregar(k);
    linhas++;
  });
  for (const k of buffers.keys()) descarregar(k);
  buffers.clear();
  console.log(`Seções ${fonte}: ${linhas.toLocaleString('pt-BR')} linhas lidas. Compactando índices...`);

  // Fase 2: cada partição vira um índice gzip.
  const chaves = Object.entries(zonasPorMun).flatMap(([k, zs]) => zs.map(z => [...k.split('|'), z]));
  let feitos = 0;
  for (const [uf, mun, zona] of chaves) {
    const tmp = path.join(tmpDir, `${uf}-${mun}-${zona}.txt`);
    const turnos = {};
    const texto = fs.readFileSync(tmp, 'latin1');
    let ini = 0;
    for (;;) {
      const fim = texto.indexOf('\n', ini);
      if (fim < 0) break;
      const [t, s, c, v, q, l] = texto.slice(ini, fim).split(';');
      ini = fim + 1;
      const sec = ((turnos[t] ||= {})[s] ||= { l: Number(l), c: {} });
      const porCargo = (sec.c[c] ||= {});
      porCargo[v] = (porCargo[v] || 0) + Number(q);
    }
    escreverJsonGz(arquivoZona(fonte, uf, mun, zona), turnos);
    fs.unlinkSync(tmp);
    feitos++;
    if (feitos % 20 === 0) aoProgresso('Compactando índices por zona', 0.9 + (feitos / chaves.length) * 0.1);
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  for (const zs of Object.values(zonasPorMun)) zs.sort((a, b) => a - b);
  const info = infoZipRemoto(url) || {};
  const m = { fonte, geradoEm: new Date().toISOString(), url, fonteAtualizadaEm: info.ultimaModificacao || '', linhas, municipios: zonasPorMun, nomes };
  escreverJson(arquivoManifesto(fonte), m);
  memoriaManifestos.set(fonte, m);
  console.log(`Seções ${fonte}: pronto (${chaves.length} partições município/zona).`);
}

// ---------------------------------------------------------------------------
// Consulta.

function lerZona(fonte, uf, mun, zona) {
  const file = arquivoZona(fonte, uf, mun, zona);
  const m = memoriaZonas.get(file);
  if (m) return m;
  const dados = lerJson(file);
  if (!dados) return null;
  return memoriaZonas.set(file, dados);
}

module.exports = { fonteDe, pronto, prepararFonte, manifesto, lerZona };
