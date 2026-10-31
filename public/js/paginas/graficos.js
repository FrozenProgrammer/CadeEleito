// Página "Gráficos": 5 candidatos e 5 partidos mais votados no recorte.

import { h, limpar, numero, pct, titulo } from '../dom.js';
import { barras } from '../grafico.js';
import { criarCarregador, cabecalhoRecorte, rodapeFonte, candidatoDoFiltro } from './comum.js';

function cartaoGrafico(tituloTexto, subtitulo, conteudo) {
  return h('section', { class: 'cartao cartao-grafico' },
    h('div', { class: 'cartao-topo' }, h('div', {}, h('h3', { text: tituloTexto }), h('p', { class: 'cartao-sub', text: subtitulo }))),
    conteudo);
}

export function criarPaginaGraficos(raiz) {
  const conteudo = h('div', { class: 'pagina-conteudo' });
  limpar(raiz, conteudo);
  const carregar = criarCarregador(conteudo, d => {
    const sel = candidatoDoFiltro(d);
    const topCand = d.candidatos.slice(0, 5).map(c => ({ rotulo: titulo(c.nome), detalhe: `${c.partido} · ${c.numero}`, votos: c.votos, percentual: c.percentual, destaque: sel && sel.numero === c.numero }));
    const topPart = d.partidos.slice(0, 5).map(p => ({ rotulo: p.sigla, detalhe: titulo(p.nome), votos: p.votos, percentual: p.percentual }));
    const somaTop = d.candidatos.slice(0, 5).reduce((a, c) => a + c.votos, 0);
    const notaPartido = d.cargo.proporcional
      ? 'Soma dos votos nominais dos candidatos do partido e dos votos de legenda.'
      : 'Soma dos votos dos candidatos de cada partido.';
    limpar(conteudo,
      cabecalhoRecorte(d, `${numero(d.totais.validos)} votos válidos no recorte · os 5 mais votados somam ${pct(d.totais.validos ? (somaTop / d.totais.validos) * 100 : 0)}`),
      h('div', { class: 'grade-graficos' },
        cartaoGrafico('5 candidatos mais votados', 'Percentual dos votos válidos do recorte.', barras(topCand, { titulo: '5 candidatos mais votados', rotuloColuna: 'Candidato' })),
        cartaoGrafico('5 partidos mais votados', notaPartido, barras(topPart, { titulo: '5 partidos mais votados', rotuloColuna: 'Partido' }))),
      rodapeFonte(d));
  });
  return { carregar };
}
