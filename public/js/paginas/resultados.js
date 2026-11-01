// Página "Resultados" (inicial): busca do candidato, cartão com os números dele no recorte
// escolhido nos filtros (pronto para compartilhar nas redes) e, abaixo, o mapa de densidade.

import { h, limpar, numero, pct, titulo, situacao, icone, fotoCandidato, urlFoto } from '../dom.js';
import { estado, urlPara } from '../estado.js';
import { acoesCompartilhar } from '../compartilhar.js';
import { criarCarregador, rodapeFonte, candidatoDoFiltro, partesRecorte } from './comum.js';
import { criarPaginaMapa } from './mapa.js';
import { feminino, cargoDe, eleitoDe, situacaoDe } from '../genero.js';

// Situação do TSE: "Eleito", "Eleito por QP", "Eleito por média" (nunca "Não eleito"/"Suplente").
const eleito = s => /^eleit/i.test(s || '');
const selo = c => h('span', { class: 'selo-eleito', text: eleitoDe(c) }); // Eleito / Eleita

// Logo "lupa no mapa" (o mesmo do título), para o cartão sair com a marca no print.
const logo = () => h('svg:svg', { class: 'social-logo', viewBox: '0 0 64 64', 'aria-hidden': 'true' },
  h('svg:circle', { cx: '27', cy: '27', r: '17', class: 'lg-s1', 'stroke-width': '6' }),
  h('svg:path', { d: 'M40 40 55 55', class: 'lg-s1', 'stroke-width': '8', 'stroke-linecap': 'round' }),
  h('svg:path', { d: 'M27 15.5a8 8 0 0 1 8 8c0 6.2-8 13.5-8 13.5s-8-7.3-8-13.5a8 8 0 0 1 8-8zM27 20.5a3 3 0 1 0 0 6a3 3 0 1 0 0-6z', 'fill-rule': 'evenodd', class: 'lg-f2' }));

function metrica(valor, rotulo) {
  return h('div', { class: 'social-metrica' }, h('strong', { text: valor }), h('span', { text: rotulo }));
}

// Cartão do candidato no recorte. Sem votos no recorte, mostra zero (também é informação).
// Os textos concordam com o gênero da pessoa (Deputada, Eleita…: ver js/genero.js).
function cartaoCandidato(c, d) {
  const cargo = cargoDe(d.cargo.nome, c);
  const linha = d.candidatos.find(x => x.numero === c.numero);
  const lider = d.candidatos[0];
  const local = partesRecorte(d.escopo).join(' › ');
  const sit = linha?.situacao || c.situacao || '';
  const info = {
    nome: titulo(c.nome), numero: c.numero, partido: c.partido, cargo, uf: c.uf, situacao: sit, eleito: eleito(sit), eleitoTexto: eleitoDe(c).toUpperCase(),
    local, votos: linha?.votos || 0, percentual: linha?.percentual || 0, posicao: linha?.posicao || 0, total: d.candidatos.length, turno: d.turno,
    url: new URL(urlPara('resultados'), location.href).href, foto: urlFoto(c),
  };
  const dif = linha && lider && lider !== linha ? lider.votos - linha.votos : null;
  const cartao = h('section', { class: 'cartao-social', 'aria-label': `Cartão de ${info.nome}` },
    h('div', { class: 'social-topo' },
      h('span', { class: 'social-marca' }, logo(), 'Cadê o eleito?'),
      h('span', { class: 'social-eleicao', text: `Eleições 2026 · ${d.turno}º turno` })),
    h('div', { class: 'social-cand' },
      h('div', { class: 'destaque-num', text: c.numero }),
      h('div', { class: 'social-nome' },
        h('span', { class: 'destaque-sobre', text: [c.partido, cargo, c.uf !== 'BR' ? c.uf : ''].filter(Boolean).join(' · ') }),
        h('h3', {}, info.nome, info.eleito ? selo(c) : null),
        sit ? h('p', { text: situacaoDe(situacao(sit), c) }) : null),
      fotoCandidato(c, 'social-foto')),
    h('div', { class: 'social-local' }, icone('mapa'),
      h('div', {}, h('span', { class: 'social-rotulo', text: 'Onde' }), h('strong', { text: local }),
        d.escopo.endereco ? h('small', { text: titulo(d.escopo.endereco) }) : null)),
    h('div', { class: 'social-metricas' },
      metrica(numero(info.votos), 'votos'),
      metrica(pct(info.percentual), 'dos votos válidos'),
      metrica(linha ? `${linha.posicao}º` : '—', `de ${numero(d.candidatos.length)} candidatos`),
      linha ? (dif !== null ? metrica(numero(dif), `votos atrás de ${titulo(lider.nome)}`) : metrica('1º', feminino(c) ? 'mais votada aqui' : 'mais votado aqui')) : null),
    h('p', { class: 'social-fonte', text: 'Dados oficiais do TSE' }));
  return [cartao, acoesCompartilhar(info)];
}

export function criarPaginaResultados(raiz) {
  const conteudo = h('div', { class: 'pagina-conteudo' });
  const areaMapa = h('div', { class: 'resultados-mapa', hidden: true });
  const fonte = h('div', { class: 'resultados-fonte' });
  limpar(raiz, conteudo, areaMapa, fonte);
  const mapa = criarPaginaMapa(areaMapa);
  const carregar = criarCarregador(conteudo, d => {
    const c = candidatoDoFiltro(d);
    limpar(conteudo, c ? cartaoCandidato(c, d) : null);
    // A fonte dos dados fica abaixo do mapa.
    limpar(fonte, c ? rodapeFonte(d) : null);
  });
  return {
    carregar() {
      // Sem candidato: a página é só a busca (o cartão e o mapa aparecem depois de escolher).
      areaMapa.hidden = !estado.cand;
      if (!estado.cand) { limpar(conteudo); limpar(fonte); return; }
      carregar();
      mapa.carregar();
    },
  };
}
