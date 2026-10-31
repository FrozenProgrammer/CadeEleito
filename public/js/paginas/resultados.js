// Página "Resultados": votos do recorte para o cargo escolhido e, se houver,
// o destaque do candidato buscado.

import { h, limpar, numero, pct, titulo, situacao, icone, debounce } from '../dom.js';
import { normalizar } from '../calculo.js';
import { criarCarregador, cabecalhoRecorte, rodapeFonte, candidatoDoFiltro } from './comum.js';

const POR_PAGINA = 25;

// Situação do TSE: "Eleito", "Eleito por QP", "Eleito por média" (nunca "Não eleito"/"Suplente").
const eleito = c => /^eleit/i.test(c.situacao || '');
const selo = () => h('span', { class: 'selo-eleito', text: 'Eleito' });

function kpi(rotulo, valor, detalhe) {
  return h('div', { class: 'kpi' }, h('span', { class: 'kpi-rotulo', text: rotulo }), h('strong', { class: 'kpi-valor', text: valor }), detalhe ? h('span', { class: 'kpi-detalhe', text: detalhe }) : null);
}

function indicadores(d) {
  const t = d.totais;
  const totalVotos = t.validos + t.brancos + t.nulos + (t.anulados || 0);
  const base = t.comparecimento || totalVotos;
  const itens = [kpi('Votos válidos', numero(t.validos), base ? `${pct((t.validos / base) * 100)} dos votos` : null)];
  itens.push(kpi('Brancos', numero(t.brancos), base ? pct((t.brancos / base) * 100) : null));
  itens.push(kpi('Nulos', numero(t.nulos), base ? pct((t.nulos / base) * 100) : null));
  if (t.comparecimento) itens.push(kpi('Comparecimento', numero(t.comparecimento), t.eleitorado ? `${pct((t.comparecimento / t.eleitorado) * 100)} de ${numero(t.eleitorado)} eleitores` : null));
  else if (t.eleitorado) itens.push(kpi('Eleitores aptos', numero(t.eleitorado), `${numero(totalVotos)} votos registrados`));
  if (t.abstencao) itens.push(kpi('Abstenção', numero(t.abstencao), t.eleitorado ? pct((t.abstencao / t.eleitorado) * 100) : null));
  itens.push(kpi('Seções', numero(t.secoesTotalizadas), t.secoes && t.secoes !== t.secoesTotalizadas ? `de ${numero(t.secoes)}` : 'totalizadas'));
  return h('section', { class: 'kpis', 'aria-label': 'Totais do recorte' }, itens);
}

function destaqueCandidato(c, d) {
  const linha = d.candidatos.find(x => x.numero === c.numero);
  const lider = d.candidatos[0];
  if (!linha) {
    return h('section', { class: 'destaque destaque-vazio' },
      h('div', { class: 'destaque-num', text: c.numero }),
      h('div', {}, h('h3', { text: titulo(c.nome) }), h('p', { text: `${c.partido} · Nenhum voto registrado para este candidato neste recorte${d.turno === 2 ? ' (ou não disputou o 2º turno)' : ''}.` })));
  }
  const dif = lider && lider !== linha ? lider.votos - linha.votos : null;
  return h('section', { class: 'destaque', 'aria-label': 'Candidato selecionado' },
    h('div', { class: 'destaque-num', text: linha.numero }),
    h('div', { class: 'destaque-info' },
      h('span', { class: 'destaque-sobre', text: `${linha.partido} · ${d.cargo.nome}` }),
      h('h3', {}, titulo(linha.nome), eleito(linha) ? selo() : null),
      h('p', { text: linha.situacao ? situacao(linha.situacao) : '' })),
    h('div', { class: 'destaque-metricas' },
      h('div', {}, h('strong', { text: numero(linha.votos) }), h('span', { text: 'votos no recorte' })),
      h('div', {}, h('strong', { text: pct(linha.percentual) }), h('span', { text: 'dos votos válidos' })),
      h('div', {}, h('strong', { text: `${linha.posicao}º` }), h('span', { text: `de ${d.candidatos.length} candidatos` })),
      dif !== null ? h('div', {}, h('strong', { text: numero(dif) }), h('span', { text: `atrás de ${titulo(lider.nome)}` })) : h('div', {}, h('strong', { text: '1º' }), h('span', { text: 'mais votado no recorte' }))));
}

function tabelaCandidatos(d, numeroDestaque) {
  let filtro = '', limite = POR_PAGINA;
  const corpo = h('tbody');
  const mais = h('button', { type: 'button', class: 'botao-secundario' });
  const contador = h('span', { class: 'tabela-contador' });
  const max = d.candidatos[0]?.votos || 1;

  function render() {
    // Sem acento e sem caixa: "joao" encontra "JOÃO"; partido aceita parte da sigla.
    const f = normalizar(filtro);
    const lista = f ? d.candidatos.filter(c => normalizar(c.nome).includes(f) || c.numero.startsWith(f) || normalizar(c.partido).includes(f)) : d.candidatos;
    const visiveis = lista.slice(0, limite);
    limpar(corpo, visiveis.map(c => h('tr', { class: c.numero === numeroDestaque ? 'linha-destaque' : '' },
      h('td', { class: 'num pos', text: `${c.posicao}º` }),
      h('td', {}, h('div', { class: 'cand-celula' },
        h('span', { class: 'cand-numero', text: c.numero }),
        h('span', {}, h('span', { class: 'nome-linha' }, h('strong', { text: titulo(c.nome) }), eleito(c) ? selo() : null), h('small', { text: [c.partido, c.situacao && situacao(c.situacao)].filter(Boolean).join(' · ') })))),
      h('td', { class: 'num', text: numero(c.votos) }),
      h('td', { class: 'num col-pct' }, h('div', { class: 'pct-celula' },
        h('span', { text: pct(c.percentual) }),
        h('span', { class: 'mini-trilho', 'aria-hidden': 'true' }, h('span', { class: 'mini-barra', style: { width: `${Math.max(1, (c.votos / max) * 100)}%` } })))),
    )));
    if (!visiveis.length) corpo.append(h('tr', {}, h('td', { colspan: '4', class: 'vazio', text: 'Nenhum candidato corresponde à busca.' })));
    mais.hidden = lista.length <= limite;
    mais.textContent = `Mostrar mais ${Math.min(50, lista.length - limite)} de ${numero(lista.length - limite)} restantes`;
    contador.textContent = `${numero(lista.length)} candidato${lista.length === 1 ? '' : 's'}`;
  }
  mais.addEventListener('click', () => { limite += 50; render(); });
  const busca = h('input', { type: 'search', class: 'controle controle-pequeno', placeholder: 'Filtrar por nome, número ou partido', 'aria-label': 'Filtrar candidatos da tabela', oninput: debounce(e => { filtro = e.target.value.trim(); limite = POR_PAGINA; render(); }, 120) });
  render();
  return h('section', { class: 'cartao' },
    h('div', { class: 'cartao-topo' }, h('h3', { text: 'Votação por candidato' }), contador, d.candidatos.length > 15 ? busca : null),
    h('div', { class: 'tabela-rolagem' },
      h('table', { class: 'tabela' },
        h('thead', {}, h('tr', {}, h('th', { scope: 'col', class: 'num', text: '#' }), h('th', { scope: 'col', text: 'Candidato' }), h('th', { scope: 'col', class: 'num', text: 'Votos' }), h('th', { scope: 'col', class: 'num col-pct', text: '% válidos' }))),
        corpo)),
    mais);
}

export function criarPaginaResultados(raiz) {
  const conteudo = h('div', { class: 'pagina-conteudo' });
  limpar(raiz, conteudo);
  const carregar = criarCarregador(conteudo, d => {
    const c = candidatoDoFiltro(d);
    limpar(conteudo,
      cabecalhoRecorte(d),
      c ? destaqueCandidato(c, d) : null,
      indicadores(d),
      d.candidatos.length ? tabelaCandidatos(d, c?.numero) : h('div', { class: 'aviso' }, icone('info'), h('p', { text: 'Não há votos registrados para este cargo neste recorte.' })),
      rodapeFonte(d));
  });
  return { carregar };
}
