// Gráfico de barras horizontais (série única), feito em HTML + CSSOM para ser
// responsivo e compatível com a CSP estrita. Inclui eixo em % dos votos válidos,
// rótulo de valor na ponta, tooltip ao passar o mouse/foco e visão em tabela.

import { h, limpar, numero, pct } from './dom.js';

function passoBonito(max) {
  for (const p of [1, 2, 5, 10, 20, 25]) if (max / p <= 5) return p;
  return 25;
}

let tooltip = null;
function obterTooltip() {
  if (!tooltip) {
    tooltip = h('div', { class: 'tooltip', role: 'status', hidden: true });
    document.body.append(tooltip);
  }
  return tooltip;
}
// `conteudo`: lista de linhas de texto (a primeira em destaque) ou um elemento pronto.
export function mostrarTooltip(evento, conteudo) {
  const t = obterTooltip();
  if (conteudo instanceof Node) limpar(t, conteudo);
  else limpar(t, conteudo.map((l, i) => h(i === 0 ? 'strong' : 'span', { text: l })));
  t.hidden = false;
  const r = t.getBoundingClientRect();
  let x, y;
  if (evento.type === 'focus' || evento.clientX === undefined) {
    const alvo = evento.currentTarget.getBoundingClientRect();
    x = alvo.left + alvo.width / 2; y = alvo.top;
  } else { x = evento.clientX; y = evento.clientY; }
  const left = Math.min(window.innerWidth - r.width - 8, Math.max(8, x - r.width / 2));
  const top = y - r.height - 14 < 8 ? y + 18 : y - r.height - 14;
  Object.assign(t.style, { left: `${left + window.scrollX}px`, top: `${top + window.scrollY}px` });
}
export function esconderTooltip() { if (tooltip) tooltip.hidden = true; }

// itens: [{ rotulo, detalhe, votos, percentual, destaque }]
export function barras(itens, { titulo, rotuloColuna = 'Nome' } = {}) {
  if (!itens.length) return h('div', { class: 'vazio', text: 'Sem votos para exibir neste recorte.' });
  const maxPct = Math.max(...itens.map(i => i.percentual), 1);
  const passo = passoBonito(maxPct);
  const escala = Math.min(100, Math.ceil(maxPct / passo) * passo);
  const ticks = [];
  for (let v = 0; v <= escala + 1e-9; v += passo) ticks.push(v);

  const grade = h('div', { class: 'barras-grade', 'aria-hidden': 'true' },
    ticks.map(v => h('span', { class: 'barras-tick', style: { left: `${(v / escala) * 100}%` } }, h('span', { text: `${v}%` }))));

  const linhas = itens.map(it => {
    const largura = Math.max(0.4, (it.percentual / escala) * 100);
    const dica = [it.rotulo, it.detalhe, `${numero(it.votos)} votos · ${pct(it.percentual)} dos válidos`].filter(Boolean);
    const barra = h('div', { class: `barra${it.destaque ? ' barra-destaque' : ''}`, style: { width: `${largura}%` } });
    const valor = h('span', { class: 'barra-valor', text: pct(it.percentual) });
    const trilho = h('div', { class: 'barra-trilho' }, barra, valor);
    // O rótulo fica sempre logo após a ponta, na cor de texto (a área à direita do trilho é
    // reservada para ele). Texto branco dentro da barra azul não atinge o contraste mínimo (WCAG AA).
    valor.style.left = `${largura}%`;
    return h('div', {
      class: 'barras-linha', tabindex: '0', role: 'listitem', 'aria-label': dica.join(', '),
      onmousemove: e => mostrarTooltip(e, dica), onmouseleave: esconderTooltip, onfocus: e => mostrarTooltip(e, dica), onblur: esconderTooltip,
    },
    h('div', { class: 'barras-rotulo' }, h('strong', { text: it.rotulo }), it.detalhe ? h('small', { text: it.detalhe }) : null),
    trilho);
  });

  const tabela = h('details', { class: 'tabela-dados' },
    h('summary', { text: 'Ver como tabela' }),
    h('table', {},
      titulo ? h('caption', { class: 'sr-only', text: titulo }) : null,
      h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: rotuloColuna }), h('th', { scope: 'col', class: 'num', text: 'Votos' }), h('th', { scope: 'col', class: 'num', text: '% válidos' }))),
      h('tbody', {}, itens.map(it => h('tr', {}, h('td', { text: it.detalhe ? `${it.rotulo} (${it.detalhe})` : it.rotulo }), h('td', { class: 'num', text: numero(it.votos) }), h('td', { class: 'num', text: pct(it.percentual) })))),
    ));

  return h('div', { class: 'barras' },
    h('div', { class: 'barras-corpo' }, h('div', { class: 'barras-area' }, grade, h('div', { role: 'list', 'aria-label': titulo || 'Gráfico de barras' }, linhas))),
    tabela);
}
