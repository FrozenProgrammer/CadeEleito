// Cálculo dos resultados a partir dos votos por seção.
// Usado no navegador e também pelo gerador (scripts/gerar.js), para que os
// totais pré-calculados e os calculados na hora sigam exatamente as mesmas regras.

export const BRANCO = '95';
export const NULOS = new Set(['96', '97', '98']);

// Soma votos de seções de um ou mais arquivos de zona.
// alvos: [{ dados (arquivo da zona), secoes?: Set<number>, locais?: Set<number>, aceita?: (seção, dadosDaSeção) => boolean }]
// Retorna { votos: Map<votável, qtd>, secoes: número de seções somadas }.
export function somarSecoes(alvos, turno, codigoCargo) {
  const cargo = String(Number(codigoCargo));
  const votos = new Map();
  let secoes = 0;
  for (const alvo of alvos) {
    const porSecao = alvo.dados?.[turno];
    if (!porSecao) continue;
    for (const s in porSecao) {
      if (alvo.secoes && !alvo.secoes.has(Number(s))) continue;
      const sec = porSecao[s];
      if (alvo.locais && !alvo.locais.has(sec.l)) continue;
      if (alvo.aceita && !alvo.aceita(Number(s), sec)) continue;
      const vc = sec.c[cargo];
      if (!vc) continue;
      secoes++;
      for (const v in vc) votos.set(v, (votos.get(v) || 0) + vc[v]);
    }
  }
  return { votos, secoes };
}

// meta = { c: { número: [nome, partido, válido(0|1), situação, eleito(0|1), nomeCompleto] },
//          p: { número: [sigla, nome, legendaVálida(0|1)] } }
// votos: Map ou objeto { votável: qtd }
// Cada seção pertence a um único local: o do boletim de urna, se ele existe no cadastro de locais;
// senão, o do cadastro. O cadastro sozinho não basta (lista ~1.800 seções em dois locais, por
// transferência/agregação) e o boletim sozinho também não (em ~1,5% das seções traz um número de
// local ausente do cadastro). Assim locais e bairros somam exatamente o município.
// Retorna (zona, seção, dadosDaSeção) => número do local dono.
export function donoDasSecoes(locais) {
  const existe = new Set(locais.map(l => `${l.z}|${l.n}`));
  const cadastro = new Map();
  for (const l of locais) for (const s of l.secoes) if (!cadastro.has(`${l.z}|${s}`)) cadastro.set(`${l.z}|${s}`, l.n);
  return (zona, secao, sec) => (existe.has(`${zona}|${sec.l}`) ? sec.l : cadastro.get(`${zona}|${secao}`));
}

// Mapa dentro do município: votos válidos e votos de cada candidato por local de votação.
// zonas: Map(zona -> { maj, prop }) com os votos por seção; combos: [{ id, turno, codigo, proporcional }].
// Retorna { maj, prop }, cada um { l: ['zona|local', ...], c: { 'turno|cargo': { v: [válidos por local],
// n: { número: [índice, votos, índice, votos, ...] } } } } (votos zerados são omitidos).
export function votosPorLocal(locais, zonas, combos, metas) {
  const chaves = locais.map(l => `${l.z}|${l.n}`);
  const indice = new Map(chaves.map((k, i) => [k, i]));
  const dono = donoDasSecoes(locais);
  const saida = { maj: { l: chaves, c: {} }, prop: { l: chaves, c: {} } };
  for (const c of combos) {
    const porLocal = locais.map(() => ({}));
    for (const [zona, d] of zonas) {
      const porSecao = (c.proporcional ? d.prop : d.maj)?.[c.turno];
      if (!porSecao) continue;
      for (const s in porSecao) {
        const sec = porSecao[s];
        const vc = sec.c[c.codigo];
        if (!vc) continue;
        const i = indice.get(`${zona}|${dono(zona, Number(s), sec)}`);
        if (i === undefined) continue;
        const alvo = porLocal[i];
        for (const v in vc) alvo[v] = (alvo[v] || 0) + vc[v];
      }
    }
    const validos = [], n = {};
    porLocal.forEach((v, i) => {
      const r = montarResultado(v, c.proporcional, metas[`${c.turno}|${c.id}`]);
      validos.push(r.totais.validos);
      for (const cand of r.candidatos) if (cand.votos) (n[cand.numero] ||= []).push(i, cand.votos);
    });
    if (validos.some(Boolean)) saida[c.proporcional ? 'prop' : 'maj'].c[`${c.turno}|${c.id}`] = { v: validos, n };
  }
  return saida;
}

export function montarResultado(votos, proporcional, meta, secoes = 0) {
  const candidatos = [];
  const partidos = new Map();
  let brancos = 0, nulos = 0, legenda = 0, nominais = 0, anulados = 0;
  const somaPartido = (num, q) => {
    const info = meta.p[num];
    const sigla = info ? info[0] : num;
    const p = partidos.get(sigla) || { sigla, numero: num, nome: info ? info[1] : sigla, votos: 0 };
    p.votos += q;
    partidos.set(sigla, p);
  };
  const entradas = votos instanceof Map ? votos.entries() : Object.entries(votos);
  for (const [v, q] of entradas) {
    if (v === BRANCO) { brancos += q; continue; }
    if (NULOS.has(v)) { nulos += q; continue; }
    if (proporcional && v.length === 2) { // voto de legenda
      const p = meta.p[v];
      if (p && p[2]) { legenda += q; somaPartido(v, q); } else anulados += q;
      continue;
    }
    const c = meta.c[v];
    if (!c) { nulos += q; continue; } // número sem candidato na urna = nulo técnico
    if (!c[2]) { anulados += q; continue; } // candidatura anulada/indeferida
    nominais += q;
    candidatos.push({ numero: v, nome: c[0], nomeCompleto: c[5] || '', partido: c[1], votos: q, situacao: c[3] || '', eleito: !!c[4] });
    somaPartido(v.slice(0, 2), q);
  }
  return finalizar({
    candidatos,
    partidos: [...partidos.values()],
    totais: { validos: nominais + legenda, nominais, legenda, brancos, nulos, anulados, comparecimento: nominais + legenda + brancos + nulos + anulados, secoesTotalizadas: secoes, secoes },
    final: true,
  });
}

export function finalizar(r) {
  const validos = r.totais.validos || r.candidatos.reduce((a, x) => a + x.votos, 0);
  r.totais.validos = validos;
  const pct = x => (validos ? (x.votos / validos) * 100 : 0);
  r.candidatos.sort((a, b) => b.votos - a.votos || a.nome.localeCompare(b.nome, 'pt-BR'));
  r.candidatos.forEach((x, i) => { x.percentual = pct(x); x.posicao = i + 1; });
  r.partidos = r.partidos.filter(p => p.votos > 0).sort((a, b) => b.votos - a.votos || a.sigla.localeCompare(b.sigla, 'pt-BR'));
  r.partidos.forEach(p => { p.percentual = pct(p); });
  return r;
}

// Partido mais votado (usado no mapa).
export function lider(porPartido) {
  let total = 0, top = null, segundo = null;
  for (const [sigla, votos] of Object.entries(porPartido)) {
    total += votos;
    if (!top || votos > top.votos) { segundo = top; top = { sigla, votos }; } else if (!segundo || votos > segundo.votos) segundo = { sigla, votos };
  }
  if (!top) return null;
  return { sigla: top.sigla, votos: top.votos, percentual: total ? (top.votos / total) * 100 : 0, segundo: segundo?.sigla || '', margem: total && segundo ? ((top.votos - segundo.votos) / total) * 100 : 100, validos: total };
}

export function normalizar(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
