// Tooltip compartilhado (mapa): segue o mouse ou, no teclado, o elemento focado.
// Feito para ser barato a cada movimento do mouse: o conteúdo só é trocado quando muda a área,
// o tamanho é medido uma vez por conteúdo e a posição é aplicada no máximo uma vez por quadro
// (requestAnimationFrame), com transform em position: fixed (sem recalcular o layout da página).
// É só visual (aria-hidden): as áreas do mapa já têm o mesmo texto no aria-label.

import { h, limpar } from './dom.js';

let tooltip = null, conteudoAtual = null, tamanho = null, quadro = 0, x = 0, y = 0;

function obterTooltip() {
  if (!tooltip) {
    tooltip = h('div', { class: 'tooltip', 'aria-hidden': 'true', hidden: true });
    document.body.append(tooltip);
  }
  return tooltip;
}

function posicionar() {
  quadro = 0;
  if (!tooltip || tooltip.hidden) return;
  if (!tamanho) { const r = tooltip.getBoundingClientRect(); tamanho = [r.width, r.height]; }
  const [w, alt] = tamanho;
  const left = Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2));
  const top = y - alt - 14 < 8 ? y + 18 : y - alt - 14;
  tooltip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}

// `conteudo`: elemento pronto (reaproveitado entre movimentos) ou lista de linhas de texto.
export function mostrarTooltip(evento, conteudo) {
  const t = obterTooltip();
  if (conteudo !== conteudoAtual) {
    conteudoAtual = conteudo;
    if (conteudo instanceof Node) limpar(t, conteudo);
    else limpar(t, conteudo.map((l, i) => h(i === 0 ? 'strong' : 'span', { text: l })));
    tamanho = null;
  }
  t.hidden = false;
  if (evento.clientX === undefined || evento.type === 'focusin' || evento.type === 'focus') {
    const r = evento.target.getBoundingClientRect();
    x = r.left + r.width / 2; y = r.top;
  } else { x = evento.clientX; y = evento.clientY; }
  if (!quadro) quadro = requestAnimationFrame(posicionar);
}

export function esconderTooltip() {
  if (tooltip) tooltip.hidden = true;
  if (quadro) { cancelAnimationFrame(quadro); quadro = 0; }
}
