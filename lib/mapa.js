'use strict';
// Mapa: malhas do IBGE convertidas em caminhos SVG compactos.

const path = require('path');
const { CACHE_DIR, FONTES, UF_POR_SIGLA, UF_POR_IBGE } = require('./config');
const { lerJson, escreverJson, Lru, criarDeduplicador, erroHttp } = require('./util');
const { obterJson } = require('./net');
const { municipios } = require('./tse');

const DIR = path.join(CACHE_DIR, 'mapa-v2'); // v2: + parâmetros da projeção (para os locais de votação)
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
  return { viewBox: `0 0 ${largura} ${altura}`, caminhos, proj: { minX, maxY, k, escala } };
}

// Ponto (longitude, latitude) nas mesmas coordenadas do mapa da UF.
function projetarPonto(proj, lon, lat) {
  return [Math.round((lon - proj.minX) * proj.k * proj.escala * 10) / 10, Math.round((proj.maxY - lat) * proj.escala * 10) / 10];
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
      const { viewBox, caminhos, proj } = projetar(geo.features || []);
      const { porIbge } = await municipios();
      dados = {
        uf,
        viewBox,
        proj,
        municipios: caminhos.map(c => { const mu = porIbge.get(c.id); return mu ? { cd: mu.cd, nm: mu.nm, d: c.d } : null; }).filter(Boolean),
      };
      if (!dados.municipios.length) throw new Error('Malha municipal vazia.');
      escreverJson(file, dados);
    }
    return memoria.set(file, dados);
  });
}

module.exports = { malhaBrasil, malhaUf, projetarPonto };
