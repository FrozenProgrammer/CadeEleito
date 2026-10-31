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
