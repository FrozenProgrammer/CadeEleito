'use strict';
// Mapa: malhas do IBGE convertidas em caminhos SVG compactos e partido mais
// votado por município/UF (TSE — "votacao_partido_munzona_2026").

const path = require('path');
const { CACHE_DIR, FONTES, CARGOS, UFS, UF_POR_SIGLA, UF_POR_IBGE, LIMITES } = require('./config');
const { lerJson, escreverJson, idadeMs, Lru, criarDeduplicador, erroHttp } = require('./util');
const { obterJson, listarZipRemoto, abrirEntradaRemota, lerLinhasCsv, camposCsv } = require('./net');
const { municipios } = require('./tse');

const DIR = path.join(CACHE_DIR, 'mapa-v1');
const dedup = criarDeduplicador();
const memoria = new Lru(80);

// ---------------------------------------------------------------------------
// Geometria.

function projetar(features) {
  // Projeção equiretangular corrigida pela latitude média: simples e fiel em escala estadual.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const aneis = f => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates);
  for (const f of features) for (const poly of aneis(f)) for (const ring of poly) for (const [x, y] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const k = Math.cos((((minY + maxY) / 2) * Math.PI) / 180);
  const largura = 1000;
  const escala = largura / ((maxX - minX) * k);
  const altura = Math.round((maxY - minY) * escala);
  const px = x => ((x - minX) * k * escala).toFixed(1);
  const py = y => ((maxY - y) * escala).toFixed(1);
  const caminhos = features.map(f => {
    let d = '';
    let sx = 0, sy = 0, n = 0;
    for (const poly of aneis(f)) for (const ring of poly) {
      let ultimo = '';
      ring.forEach(([x, y], i) => {
        const p = `${px(x)} ${py(y)}`;
        if (p === ultimo) return; // remove pontos repetidos após arredondamento
        d += (i === 0 ? 'M' : 'L') + p;
        ultimo = p;
        sx += x; sy += y; n++;
      });
      d += 'Z';
    }
    return { id: String(f.properties?.codarea || ''), d, cx: Number(px(sx / n)), cy: Number(py(sy / n)) };
  });
  return { viewBox: `0 0 ${largura} ${altura}`, caminhos };
}

async function malhaBrasil() {
  const file = path.join(DIR, 'brasil.json');
  const m = memoria.get(file);
  if (m) return m;
  return dedup(file, async () => {
    let dados = lerJson(file);
    if (!dados) {
      const geo = await obterJson(FONTES.malhaBrasil);
      const { viewBox, caminhos } = projetar(geo.features || []);
      dados = {
        viewBox,
        ufs: caminhos.map(c => { const u = UF_POR_IBGE.get(c.id); return u ? { uf: u.sigla, nome: u.nome, d: c.d, cx: c.cx, cy: c.cy } : null; }).filter(Boolean),
      };
      if (dados.ufs.length !== 27) throw new Error('Malha do Brasil incompleta.');
      escreverJson(file, dados);
    }
    return memoria.set(file, dados);
  });
}

async function malhaUf(uf) {
  const info = UF_POR_SIGLA.get(uf);
  if (!info) throw erroHttp(400, 'UF inválida.');
  const file = path.join(DIR, `uf-${uf}.json`);
  const m = memoria.get(file);
  if (m) return m;
  return dedup(file, async () => {
    let dados = lerJson(file);
    if (!dados) {
      const geo = await obterJson(FONTES.malhaUf(info.ibge));
      const { viewBox, caminhos } = projetar(geo.features || []);
      const { porIbge } = await municipios();
      dados = {
        uf,
        viewBox,
        municipios: caminhos.map(c => { const mu = porIbge.get(c.id); return mu ? { cd: mu.cd, nm: mu.nm, d: c.d } : null; }).filter(Boolean),
      };
      if (!dados.municipios.length) throw new Error('Malha municipal vazia.');
      escreverJson(file, dados);
    }
    return memoria.set(file, dados);
  });
}

// ---------------------------------------------------------------------------
// Votos por partido e município.

// Lê uma entrada (_BR = Presidente; _UF = cargos estaduais) e agrega por município.
async function votosPartidoEntrada(sufixo) {
  const file = path.join(DIR, `partidos-${sufixo}.json`);
  const m = memoria.get(file);
  if (m) return m;
  return dedup(file, async () => {
    let dados = idadeMs(file) < LIMITES.dadosAbertosTtlMs ? lerJson(file) : null;
    if (!dados) {
      try {
        const entradas = await listarZipRemoto(FONTES.partidoMunZona);
        const ent = entradas.find(e => e.nome.toUpperCase().endsWith(`_${sufixo}.CSV`));
        if (!ent) throw erroHttp(404, 'Votação por partido ainda não publicada pelo TSE.');
        const agg = {};
        let ix = null, max = 0;
        await lerLinhasCsv(await abrirEntradaRemota(FONTES.partidoMunZona, ent), h => {
          const i = n => h.indexOf(n);
          ix = { turno: i('NR_TURNO'), uf: i('SG_UF'), mun: i('CD_MUNICIPIO'), cargo: i('CD_CARGO'), sigla: i('SG_PARTIDO'), leg: i('QT_TOTAL_VOTOS_LEG_VALIDOS'), nom: i('QT_VOTOS_NOMINAIS_VALIDOS') };
          if (Object.values(ix).some(v => v < 0)) throw new Error('Layout inesperado em votação por partido.');
          max = Math.max(...Object.values(ix));
        }, linha => {
          const f = camposCsv(linha, max);
          const votos = (Number(f[ix.leg]) || 0) + (Number(f[ix.nom]) || 0);
          if (!votos) return;
          const k = `${f[ix.turno]}|${Number(f[ix.cargo])}|${f[ix.uf]}|${String(f[ix.mun]).padStart(5, '0')}`;
          const porPartido = (agg[k] ||= {});
          porPartido[f[ix.sigla]] = (porPartido[f[ix.sigla]] || 0) + votos;
        });
        dados = agg;
        escreverJson(file, dados);
      } catch (err) {
        dados = lerJson(file);
        if (!dados) throw err;
      }
    }
    return memoria.set(file, dados);
  });
}

function lider(porPartido) {
  let total = 0, top = null, segundo = null;
  for (const [sigla, votos] of Object.entries(porPartido)) {
    total += votos;
    if (!top || votos > top.votos) { segundo = top; top = { sigla, votos }; } else if (!segundo || votos > segundo.votos) segundo = { sigla, votos };
  }
  if (!top) return null;
  // Três partidos mais votados: [sigla, % dos válidos] (usado no tooltip do mapa quando não há dados por candidato).
  const top3 = Object.entries(porPartido).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s, v]) => [s, Math.round((v / total) * 1000) / 10]);
  return { sigla: top.sigla, votos: top.votos, percentual: total ? (top.votos / total) * 100 : 0, segundo: segundo?.sigla || '', margem: total && segundo ? ((top.votos - segundo.votos) / total) * 100 : 100, validos: total, top3 };
}

// Partido mais votado em cada município da UF (ou em cada UF, se uf = null e cargo = Presidente).
async function lideres(cargoId, turno, uf) {
  const cargo = CARGOS[cargoId];
  if (!cargo.eleicoes[turno]) throw erroHttp(400, `Não houve ${turno}º turno para ${cargo.nome}.`);
  const dados = await votosPartidoEntrada(cargo.nacional ? 'BR' : uf);
  const prefixo = `${turno}|${Number(cargo.codigo)}|`;
  const porLocal = {};
  if (!uf) {
    // Visão nacional: soma por UF.
    const porUf = {};
    for (const [k, partidos] of Object.entries(dados)) {
      if (!k.startsWith(prefixo)) continue;
      const sg = k.split('|')[2];
      const alvo = (porUf[sg] ||= {});
      for (const [p, v] of Object.entries(partidos)) alvo[p] = (alvo[p] || 0) + v;
    }
    for (const u of UFS) if (porUf[u.sigla]) porLocal[u.sigla] = lider(porUf[u.sigla]);
  } else {
    const pre = `${prefixo}${uf}|`;
    for (const [k, partidos] of Object.entries(dados)) if (k.startsWith(pre)) porLocal[k.slice(pre.length)] = lider(partidos);
  }
  // Ranking por número de municípios/UFs liderados (para a legenda do mapa).
  const contagem = {};
  for (const l of Object.values(porLocal)) if (l) contagem[l.sigla] = (contagem[l.sigla] || 0) + 1;
  const ranking = Object.entries(contagem).sort((a, b) => b[1] - a[1]).map(([sigla, locais]) => ({ sigla, locais }));
  return { cargo: cargoId, turno, uf: uf || 'BR', lideres: porLocal, ranking };
}

module.exports = { malhaBrasil, malhaUf, lideres };
