'use strict';
// Divisão do município em áreas de locais de votação (diagrama de Voronoi).
//
// O TSE não publica limites geográficos de seções nem de zonas eleitorais: só a posição de cada
// local de votação. A divisão usual (a mesma de outros mapas eleitorais) é atribuir cada ponto do
// município ao local de votação mais próximo. As seções de um local ficam no mesmo prédio, então
// a menor área possível é a do local; a área de uma zona é a união das áreas dos seus locais.
//
// Entrada: locais com x, y (coordenadas do mapa da UF) e o caminho SVG do município.
// Saída: { c: [[[índices dos locais], 'M x y L ... Z'], ...], f: 'M x y L x y M ...' }
//   c = uma célula por posição distinta (locais no mesmo endereço dividem a célula);
//   f = fronteiras entre zonas diferentes (segmentos entre células de zonas distintas).
// As células cobrem o retângulo do município; o navegador recorta pelo contorno (clip-path).

const r2 = n => Math.round(n * 100) / 100;

function caixa(d) {
  const n = String(d).match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i + 1 < n.length; i += 2) {
    if (n[i] < x0) x0 = n[i]; if (n[i] > x1) x1 = n[i];
    if (n[i + 1] < y0) y0 = n[i + 1]; if (n[i + 1] > y1) y1 = n[i + 1];
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

// Recorta o polígono convexo `poli` pelo semiplano dos pontos mais perto de A do que de B.
// Cada vértice guarda em [2] o vizinho que gerou a aresta que COMEÇA nele (-1 = borda do retângulo).
function recortar(poli, ax, ay, bx, by, vizinho) {
  const mx = (ax + bx) / 2, my = (ay + by) / 2, dx = bx - ax, dy = by - ay;
  const lado = p => (p[0] - mx) * dx + (p[1] - my) * dy;
  const out = [];
  for (let i = 0; i < poli.length; i++) {
    const P = poli[i], Q = poli[(i + 1) % poli.length];
    const sp = lado(P), sq = lado(Q);
    if (sp <= 0) out.push(P);
    if ((sp < 0 && sq > 0) || (sp > 0 && sq < 0)) {
      const t = sp / (sp - sq);
      const I = [P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])];
      // Saindo: a nova aresta (I -> próximo ponto de entrada) fica sobre a mediatriz.
      I[2] = sp <= 0 ? vizinho : P[2];
      out.push(I);
    }
  }
  return out;
}

function dividirMunicipio(locais, caminho) {
  const c = caixa(caminho);
  if (!Number.isFinite(c.w) || c.w <= 0) return null;
  const folga = Math.max(c.w, c.h) * 0.08;
  // Posições distintas dentro (ou perto) do município; locais no mesmo ponto dividem a célula.
  const porPosicao = new Map();
  locais.forEach((l, i) => {
    if (!Number.isFinite(l.x) || !Number.isFinite(l.y)) return;
    if (l.x < c.x0 - folga || l.x > c.x1 + folga || l.y < c.y0 - folga || l.y > c.y1 + folga) return;
    const k = `${l.x}|${l.y}`;
    if (!porPosicao.has(k)) porPosicao.set(k, { x: l.x, y: l.y, l: [] });
    porPosicao.get(k).l.push(i);
  });
  const sitios = [...porPosicao.values()];
  if (!sitios.length) return null;
  // Zona de cada célula: a da maioria dos seus locais.
  for (const s of sitios) {
    const cont = new Map();
    for (const i of s.l) cont.set(locais[i].z, (cont.get(locais[i].z) || 0) + 1);
    s.z = [...cont].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  }
  const m = Math.max(c.w, c.h) * 0.12;
  const X0 = c.x0 - m, Y0 = c.y0 - m, X1 = c.x1 + m, Y1 = c.y1 + m;
  const celulas = sitios.map((s, i) => {
    let poli = [[X0, Y0, -1], [X1, Y0, -1], [X1, Y1, -1], [X0, Y1, -1]];
    // Vizinhos do mais perto ao mais longe; um ponto a mais de 2 × (maior distância do sítio a um
    // vértice da célula) não pode mais cortar a célula: para aí (resultado exato).
    const outros = sitios.map((o, j) => [j, (o.x - s.x) ** 2 + (o.y - s.y) ** 2]).filter(([j]) => j !== i).sort((a, b) => a[1] - b[1]);
    for (const [j, d2] of outros) {
      let r2max = 0;
      for (const p of poli) r2max = Math.max(r2max, (p[0] - s.x) ** 2 + (p[1] - s.y) ** 2);
      if (d2 > 4 * r2max) break;
      poli = recortar(poli, s.x, s.y, sitios[j].x, sitios[j].y, j);
      if (poli.length < 3) break;
    }
    return poli;
  });
  // Fronteiras entre zonas: arestas com vizinho de outra zona (cada uma uma vez: i < j).
  let f = '';
  celulas.forEach((poli, i) => {
    for (let k = 0; k < poli.length; k++) {
      const j = poli[k][2];
      if (j < 0 || j < i || sitios[j].z === sitios[i].z) continue;
      const P = poli[k], Q = poli[(k + 1) % poli.length];
      f += `M${r2(P[0])} ${r2(P[1])}L${r2(Q[0])} ${r2(Q[1])}`;
    }
  });
  const caminhoDe = poli => `M${poli.map(p => `${r2(p[0])} ${r2(p[1])}`).join('L')}Z`;
  return { c: sitios.map((s, i) => [s.l, caminhoDe(celulas[i])]), f };
}

module.exports = { dividirMunicipio };
