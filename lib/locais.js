'use strict';
// Locais de votação e bairros (TSE — "Eleitorado por local de votação 2026").
// Lê via HTTP Range apenas o CSV da UF dentro do ZIP nacional e grava um índice
// compacto por município: locais (zona + número), bairro, endereço, coordenadas e seções.

const path = require('path');
const { CACHE_DIR, FONTES, LIMITES } = require('./config');
const { lerJson, escreverJson, idadeMs, Lru, criarDeduplicador, normalizar, erroHttp, copiar } = require('./util');
const { listarZipRemoto, abrirEntradaRemota, lerLinhasCsv, camposCsv } = require('./net');

const DIR = path.join(CACHE_DIR, 'locais-v3'); // v3: + latitude/longitude do local
const dedup = criarDeduplicador();
const memoria = new Lru(64);

const manifesto = uf => path.join(DIR, uf, '_pronto.json');
const arquivoMun = (uf, mun) => path.join(DIR, uf, `${mun}.json`);

async function prepararUf(uf) {
  const entradas = await listarZipRemoto(FONTES.locais);
  const ent = entradas.find(e => e.nome.toUpperCase().endsWith(`_${uf}.CSV`));
  if (!ent) throw new Error(`Arquivo de locais de votação de ${uf} não encontrado no ZIP do TSE.`);
  console.log(`Locais de votação ${uf}: lendo ${(ent.tamComp / 1048576).toFixed(1)} MB do TSE...`);
  let ix = null, max = 0;
  const porMun = new Map();
  await lerLinhasCsv(await abrirEntradaRemota(FONTES.locais, ent), h => {
    const i = n => h.indexOf(n);
    ix = { turno: i('NR_TURNO'), mun: i('CD_MUNICIPIO'), zona: i('NR_ZONA'), secao: i('NR_SECAO'), princ: i('NR_SECAO_PRINCIPAL'), local: i('NR_LOCAL_VOTACAO'), nome: i('NM_LOCAL_VOTACAO'), end: i('DS_ENDERECO'), bairro: i('NM_BAIRRO'), eleit: i('QT_ELEITOR_SECAO'), lat: i('NR_LATITUDE'), lon: i('NR_LONGITUDE') };
    if (Object.values(ix).some(v => v < 0)) throw new Error('Layout inesperado no arquivo de locais de votação.');
    max = Math.max(...Object.values(ix));
  }, linha => {
    const f = camposCsv(linha, max);
    const mun = String(Number(f[ix.mun])).padStart(5, '0');
    const zona = Number(f[ix.zona]), secao = Number(f[ix.secao]), local = Number(f[ix.local]);
    if (!Number.isFinite(zona) || !Number.isFinite(secao) || !Number.isFinite(local)) return;
    let m = porMun.get(mun);
    if (!m) porMun.set(mun, m = new Map());
    const k = `${zona}|${local}`;
    let l = m.get(k);
    if (!l) m.set(k, l = { z: zona, n: local, nome: copiar(f[ix.nome].trim()), end: copiar(f[ix.end].trim()), bairro: copiar(f[ix.bairro].trim()) || 'NÃO INFORMADO', secoes: new Map(), eleitores: 0 });
    // Coordenadas (vírgula decimal). Ausentes ou fora do Brasil (ex.: -1, 0) ficam de fora.
    if (l.lat === undefined) {
      const lat = Number(String(f[ix.lat]).replace(',', '.')), lon = Number(String(f[ix.lon]).replace(',', '.'));
      if (lat > -34 && lat < 6 && lon > -74 && lon < -28) { l.lat = Math.round(lat * 1e5) / 1e5; l.lon = Math.round(lon * 1e5) / 1e5; }
    }
    const turno = Number(f[ix.turno]) || 1;
    // Seções agregadas apontam para a principal; os votos são apurados na principal.
    const principal = Number(f[ix.princ]);
    // Eleitores aptos por seção (1º turno), somando as agregadas na principal.
    const s = principal > 0 ? principal : secao;
    const e = turno === 1 ? Number(f[ix.eleit]) || 0 : 0;
    l.secoes.set(s, (l.secoes.get(s) || 0) + e);
    l.eleitores += e;
  });
  for (const [mun, m] of porMun) {
    const locais = [...m.values()]
      .map(l => { const ss = [...l.secoes.keys()].sort((a, b) => a - b); return { ...l, secoes: ss, el: ss.map(x => l.secoes.get(x)) }; })
      .sort((a, b) => a.z - b.z || a.nome.localeCompare(b.nome, 'pt-BR'));
    const bairros = new Map();
    locais.forEach((l, i) => {
      const k = normalizar(l.bairro);
      let b = bairros.get(k);
      if (!b) bairros.set(k, b = { nome: l.bairro, locais: [], eleitores: 0, secoes: 0 });
      b.locais.push(i);
      b.eleitores += l.eleitores;
      b.secoes += l.secoes.length;
    });
    const listaBairros = [...bairros.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    escreverJson(arquivoMun(uf, mun), { uf, mun, locais, bairros: listaBairros });
  }
  escreverJson(manifesto(uf), { uf, geradoEm: new Date().toISOString(), municipios: porMun.size });
  console.log(`Locais de votação ${uf}: ${porMun.size} municípios indexados.`);
}

async function garantirUf(uf) {
  const idade = idadeMs(manifesto(uf));
  if (idade < LIMITES.dadosAbertosTtlMs) return;
  try {
    await dedup(`locais|${uf}`, () => prepararUf(uf));
  } catch (err) {
    if (idade === Infinity) throw err; // sem cópia local
    console.warn(`Não foi possível atualizar locais de ${uf}; usando cópia local.`, err.message);
  }
}

// Retorna { locais, bairros } do município.
async function locaisMunicipio(uf, mun) {
  const chave = `${uf}|${mun}`;
  const m = memoria.get(chave);
  if (m) return m;
  await garantirUf(uf);
  const dados = lerJson(arquivoMun(uf, mun));
  if (!dados) throw erroHttp(404, 'Não há locais de votação cadastrados para este município.');
  return memoria.set(chave, dados);
}

module.exports = { locaisMunicipio, garantirUf };
