'use strict';
// Resultados oficiais do TSE (arquivos EA20 da divulgação), configuração de
// municípios (EA12), eleições (EA11) e cadastro de candidatos (dados abertos).

const fs = require('fs');
const path = require('path');
const { CACHE_DIR, TSE_BASE, FONTES, CARGOS, UF_POR_SIGLA, LIMITES } = require('./config');
const { lerJson, escreverJson, idadeMs, Lru, criarDeduplicador, normalizar, erroHttp, copiar } = require('./util');
const { obterJson, baixarArquivo, listarZipLocal, abrirEntradaLocal, lerLinhasCsv, camposCsv } = require('./net');

const dedup = criarDeduplicador();
const memoria = new Lru(LIMITES.cacheMemoriaItens);

const numero = v => Number(String(v ?? '0').replace(',', '.')) || 0;
const valido = dvt => { const s = String(dvt || '').trim(); return s === '' || /^válido/i.test(s); };

// ---------------------------------------------------------------------------
// Eleições disponíveis (EA11) — usado para saber onde houve 2º turno.

const ELEICOES_FILE = path.join(CACHE_DIR, 'eleicoes-v1.json');
async function configEleicoes() {
  const m = memoria.get('eleicoes');
  if (m) return m;
  return dedup('eleicoes', async () => {
    let dados = idadeMs(ELEICOES_FILE) < 24 * 60 * 60_000 ? lerJson(ELEICOES_FILE) : null;
    if (!dados) {
      try {
        const raw = await obterJson(FONTES.eleicoes);
        const pleito = (raw.pl || []).find(p => p.c === 'ele2026' && (p.e || []).some(e => e.cd === '6257'));
        const todas = (raw.pl || []).flatMap(p => p.e || []);
        const abr = cd => (todas.find(e => e.cd === cd)?.abr || []).map(a => String(a.cd).toUpperCase());
        dados = {
          dataPrimeiroTurno: pleito?.dt || '04/10/2026',
          segundoTurnoPresidente: abr('6258').length > 0,
          segundoTurnoGovernador: abr('6260').filter(uf => UF_POR_SIGLA.has(uf)),
        };
        escreverJson(ELEICOES_FILE, dados);
      } catch (err) {
        dados = lerJson(ELEICOES_FILE);
        if (!dados) throw err;
      }
    }
    memoria.set('eleicoes', dados);
    return dados;
  });
}

// ---------------------------------------------------------------------------
// Municípios e zonas (EA12).

const MUN_FILE = path.join(CACHE_DIR, 'municipios-v3.json');
async function municipios() {
  const m = memoria.get('municipios');
  if (m) return m;
  return dedup('municipios', async () => {
    let lista = lerJson(MUN_FILE);
    if (!lista) {
      const raw = await obterJson(FONTES.municipios);
      lista = [];
      for (const abr of raw.abr || []) {
        const uf = String(abr.cd || '').toUpperCase();
        if (!UF_POR_SIGLA.has(uf)) continue;
        for (const mu of abr.mu || []) {
          const zonas = [...new Set((mu.z || []).map(z => parseInt(z, 10)).filter(Number.isFinite))].sort((a, b) => a - b);
          lista.push({ uf, cd: String(mu.cd).padStart(5, '0'), cdi: String(mu.cdi || ''), nm: mu.nm, capital: mu.c === 's', zonas });
        }
      }
      if (lista.length < 5000) throw new Error(`EA12 retornou apenas ${lista.length} municípios.`);
      lista.sort((a, b) => a.nm.localeCompare(b.nm, 'pt-BR'));
      escreverJson(MUN_FILE, lista);
    }
    const porChave = new Map(lista.map(x => [`${x.uf}|${x.cd}`, x]));
    const porIbge = new Map(lista.map(x => [x.cdi, x]));
    const r = { lista, porChave, porIbge };
    memoria.set('municipios', r);
    return r;
  });
}
async function municipio(uf, cd) {
  const m = (await municipios()).porChave.get(`${uf}|${cd}`);
  if (!m) throw erroHttp(400, 'Município não encontrado.');
  return m;
}

// ---------------------------------------------------------------------------
// Resultados EA20.

function eleicaoDe(cargoId, turno) {
  const c = CARGOS[cargoId];
  const ele = c?.eleicoes[turno];
  if (!ele) throw erroHttp(400, `Não houve ${turno}º turno para ${c ? c.nome : 'este cargo'}.`);
  return ele;
}

function urlEa20({ cargoId, turno, uf, mun, zona }) {
  const ele = eleicaoDe(cargoId, turno);
  const cargo = CARGOS[cargoId].codigo;
  const abr = uf ? uf.toLowerCase() : 'br';
  let stem = abr;
  if (mun) stem += mun;
  if (zona) stem += `-z${String(zona).padStart(4, '0')}`;
  return { url: `${TSE_BASE}/${ele}/dados/${abr}/${stem}-c${cargo}-e${ele.padStart(6, '0')}-u.json`, arquivo: `${ele}/${stem}-c${cargo}.json` };
}

const RESULT_DIR = path.join(CACHE_DIR, 'resultados-v3');
async function ea20Bruto(q) {
  const { url, arquivo } = urlEa20(q);
  const file = path.join(RESULT_DIR, arquivo);
  const emMem = memoria.get(file);
  if (emMem && (emMem.final || Date.now() - emMem.ts < LIMITES.resultadoParcialTtlMs)) return emMem.raw;
  return dedup(file, async () => {
    let raw = lerJson(file);
    const final = r => r && (r.tf === 's' || r.and === 'f');
    if (!raw || (!final(raw) && idadeMs(file) > LIMITES.resultadoParcialTtlMs)) {
      try {
        raw = await obterJson(url);
        escreverJson(file, raw);
      } catch (err) {
        if (!raw) throw err; // sem cache: propaga; com cache parcial: serve o último conhecido
      }
    }
    memoria.set(file, { raw, final: final(raw), ts: Date.now() });
    return raw;
  });
}

// Converte um EA20 em resultado normalizado.
function normalizarEa20(raw, cargoId) {
  const codigo = Number(CARGOS[cargoId].codigo);
  const carg = (raw.carg || []).find(c => Number(c.cd) === codigo) || (raw.carg || [])[0] || {};
  const candidatos = [];
  const partidos = new Map();
  for (const agr of carg.agr || []) {
    for (const par of agr.par || []) {
      const sigla = par.sg || '';
      let votosPartido = 0;
      for (const c of par.cand || []) {
        if (!valido(c.dvt)) continue;
        const votos = numero(c.vap);
        votosPartido += votos;
        candidatos.push({
          numero: String(c.n),
          nome: c.nmu || c.nm || '',
          nomeCompleto: c.nm || '',
          partido: sigla,
          votos,
          situacao: c.st || '',
          eleito: c.e === 's',
        });
      }
      if (valido(par.dvt)) votosPartido += numero(par.tvtl);
      const p = partidos.get(sigla) || { sigla, numero: String(par.n || ''), nome: par.nm || sigla, votos: 0 };
      p.votos += votosPartido;
      partidos.set(sigla, p);
    }
  }
  const v = raw.v || {}, e = raw.e || {}, s = raw.s || {};
  return finalizar({
    candidatos,
    partidos: [...partidos.values()],
    totais: {
      eleitorado: numero(e.te),
      comparecimento: numero(e.c),
      abstencao: numero(e.a),
      validos: numero(v.vv),
      nominais: numero(v.vnom),
      legenda: numero(v.vl),
      brancos: numero(v.vb),
      nulos: numero(v.tvn),
      secoesTotalizadas: numero(s.st),
      secoes: numero(s.ts),
    },
    final: raw.tf === 's' || raw.and === 'f',
    atualizacao: [raw.dg, raw.hg].filter(Boolean).join(' '),
  });
}

function finalizar(r) {
  const validos = r.totais.validos || r.candidatos.reduce((a, x) => a + x.votos, 0);
  r.totais.validos = validos;
  const pct = x => (validos ? (x.votos / validos) * 100 : 0);
  r.candidatos.sort((a, b) => b.votos - a.votos || a.nome.localeCompare(b.nome, 'pt-BR'));
  r.candidatos.forEach((x, i) => { x.percentual = pct(x); x.posicao = i + 1; });
  r.partidos = r.partidos.filter(p => p.votos > 0).sort((a, b) => b.votos - a.votos || a.sigla.localeCompare(b.sigla, 'pt-BR'));
  r.partidos.forEach(p => { p.percentual = pct(p); });
  return r;
}

async function resultadoEa20(q) {
  const raw = await ea20Bruto(q);
  return normalizarEa20(raw, q.cargoId);
}

// Metadados (nome, partido, validade) dos candidatos de uma UF, a partir do EA20 da UF.
async function metadadosCandidatos(cargoId, turno, uf) {
  const raw = await ea20Bruto({ cargoId, turno, uf: CARGOS[cargoId].nacional ? null : uf });
  const codigo = Number(CARGOS[cargoId].codigo);
  const carg = (raw.carg || []).find(c => Number(c.cd) === codigo) || (raw.carg || [])[0] || {};
  const candidatos = new Map();
  const partidos = new Map();
  for (const agr of carg.agr || []) for (const par of agr.par || []) {
    partidos.set(String(par.n), { sigla: par.sg || '', nome: par.nm || '', legendaValida: valido(par.dvt) });
    for (const c of par.cand || []) {
      candidatos.set(String(c.n), { nome: c.nmu || c.nm || '', nomeCompleto: c.nm || '', partido: par.sg || '', valido: valido(c.dvt), situacao: c.st || '', eleito: c.e === 's' });
    }
  }
  return { candidatos, partidos };
}

// Mesmos metadados em formato compacto, como o navegador usa (public/js/calculo.js):
// c: número -> [nome, partido, válido, situação, eleito, nomeCompleto]; p: número -> [sigla, nome, legendaVálida].
async function metaCompacta(cargoId, turno, uf) {
  const m = await metadadosCandidatos(cargoId, turno, uf);
  const c = {}, p = {};
  for (const [n, x] of m.candidatos) c[n] = [x.nome, x.partido, x.valido ? 1 : 0, x.situacao, x.eleito ? 1 : 0, x.nomeCompleto];
  for (const [n, x] of m.partidos) p[n] = [x.sigla, x.nome, x.legendaValida ? 1 : 0];
  return { c, p };
}

// ---------------------------------------------------------------------------
// Cadastro de candidatos (consulta_cand_2026) para a busca por nome/número.

const CAND_ZIP = path.join(CACHE_DIR, 'consulta_cand_2026.zip');
const CAND_INDEX = path.join(CACHE_DIR, 'candidatos-v2.json');
const CARGO_ID_POR_CODIGO = new Map(Object.entries(CARGOS).map(([id, c]) => [Number(c.codigo), id]));

async function construirCandidatos() {
  if (!fs.existsSync(CAND_ZIP) || idadeMs(CAND_ZIP) > LIMITES.dadosAbertosTtlMs) {
    try {
      console.log('Baixando cadastro oficial de candidatos 2026 (TSE)...');
      await baixarArquivo(FONTES.candidatos, CAND_ZIP);
    } catch (err) {
      if (!fs.existsSync(CAND_ZIP)) throw err;
      console.warn('Não foi possível atualizar o cadastro de candidatos; usando cópia local.', err.message);
    }
  }
  const entradas = (await listarZipLocal(CAND_ZIP)).filter(e => /\.csv$/i.test(e.nome));
  // O arquivo _BRASIL contém todas as UFs; preferi-lo evita duplicidade.
  const usar = entradas.filter(e => /_BRASIL\.csv$/i.test(e.nome));
  const lista = usar.length ? usar : entradas;
  const mapa = new Map();
  for (const ent of lista) {
    let idx = null;
    await lerLinhasCsv(abrirEntradaLocal(CAND_ZIP, ent), h => {
      const i = n => h.indexOf(n);
      idx = { sq: i('SQ_CANDIDATO'), nr: i('NR_CANDIDATO'), nm: i('NM_CANDIDATO'), urna: i('NM_URNA_CANDIDATO'), cargo: i('CD_CARGO'), uf: i('SG_UF'), partido: i('SG_PARTIDO'), sit: i('DS_SIT_TOT_TURNO'), turno: i('NR_TURNO') };
    }, linha => {
      const f = camposCsv(linha);
      const cargoId = CARGO_ID_POR_CODIGO.get(Number(f[idx.cargo]));
      if (!cargoId) return;
      const sq = f[idx.sq];
      const turno = Number(f[idx.turno]) || 1;
      const atual = mapa.get(sq);
      const sit = idx.sit >= 0 ? f[idx.sit] : '';
      if (atual) {
        if (turno === 2) { atual.turno2 = true; if (sit && sit !== '#NULO') atual.situacao = copiar(sit); }
        return;
      }
      mapa.set(sq, {
        id: copiar(sq),
        nome: copiar((f[idx.urna] || f[idx.nm] || '').trim()),
        nomeCompleto: copiar((f[idx.nm] || '').trim()),
        numero: copiar(String(f[idx.nr]).trim()),
        cargo: cargoId,
        uf: CARGOS[cargoId].nacional ? 'BR' : String(f[idx.uf]).toUpperCase(),
        partido: idx.partido >= 0 ? copiar(f[idx.partido]) : '',
        situacao: sit && sit !== '#NULO' ? copiar(sit) : '',
        turno2: turno === 2,
      });
    });
  }
  const out = [...mapa.values()].filter(x => x.nome && x.numero).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  if (out.length < 100) throw new Error(`Cadastro de candidatos retornou apenas ${out.length} registros.`);
  escreverJson(CAND_INDEX, out);
  return out;
}

async function candidatos() {
  const m = memoria.get('candidatos');
  if (m) return m;
  return dedup('candidatos', async () => {
    let lista = idadeMs(CAND_INDEX) < LIMITES.dadosAbertosTtlMs ? lerJson(CAND_INDEX) : null;
    if (!lista) {
      try { lista = await construirCandidatos(); } catch (err) { lista = lerJson(CAND_INDEX); if (!lista) throw err; }
    }
    // Pré-calcula a chave de busca normalizada.
    const idx = lista.map(c => ({ c, k: `${normalizar(c.nome)} | ${normalizar(c.nomeCompleto)} | ${c.numero}` }));
    const r = { lista, idx };
    memoria.set('candidatos', r);
    return r;
  });
}

module.exports = { configEleicoes, municipios, municipio, resultadoEa20, metadadosCandidatos, metaCompacta, candidatos, eleicaoDe, finalizar };
