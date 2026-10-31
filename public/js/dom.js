// Utilitários de DOM e formatação. Todo texto é inserido via textContent
// (nunca innerHTML com dados), o que elimina XSS por construção.

const SVG_NS = 'http://www.w3.org/2000/svg';

export function h(tag, attrs = {}, ...filhos) {
  const svg = tag.startsWith('svg:');
  const el = svg ? document.createElementNS(SVG_NS, tag.slice(4)) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'style') Object.assign(el.style, v); // CSSOM: permitido pela CSP
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const f of filhos.flat(Infinity)) {
    if (f === null || f === undefined || f === false) continue;
    el.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
  return el;
}

export const $ = (sel, raiz = document) => raiz.querySelector(sel);

export function limpar(el, ...filhos) {
  el.replaceChildren(...filhos.flat(Infinity).filter(Boolean));
  return el;
}

const fmtInt = new Intl.NumberFormat('pt-BR');
const fmtPct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtCompacto = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
export const numero = n => fmtInt.format(Number(n || 0));
export const pct = n => `${fmtPct.format(Number(n || 0))}%`;
export const compacto = n => fmtCompacto.format(Number(n || 0));

// "JOSÉ DA SILVA" -> "José da Silva"
const MINUSCULAS = new Set(['da', 'de', 'do', 'das', 'dos', 'e', 'di', 'du']);
export function titulo(s) {
  return String(s || '')
    .toLocaleLowerCase('pt-BR')
    .split(/(\s+|-)/)
    .map((p, i) => (i > 0 && MINUSCULAS.has(p) ? p : p.charAt(0).toLocaleUpperCase('pt-BR') + p.slice(1)))
    .join('');
}

// Situação da candidatura: "ELEITO POR QP" -> "Eleito por QP", "NÃO ELEITO" -> "Não eleito".
export function situacao(s) {
  const t = String(s || '').toLocaleLowerCase('pt-BR');
  return (t.charAt(0).toLocaleUpperCase('pt-BR') + t.slice(1)).replace(/\bqp\b/g, 'QP');
}

// Foto oficial do candidato (TSE), servida pelo próprio site (img/c/{id}.jpg). Sem foto
// publicada, mostra as iniciais. A foto é decorativa: o nome sempre aparece ao lado.
export const urlFoto = c => (c?.foto && /^\d{6,14}$/.test(String(c.id)) ? `img/c/${c.id}.jpg` : null);
export function fotoCandidato(c, cls = 'foto') {
  const url = urlFoto(c);
  if (url) return h('img', { class: cls, src: url, alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' });
  const iniciais = String(c?.nome || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();
  return h('span', { class: `${cls} foto-vazia`, 'aria-hidden': 'true', text: iniciais });
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// Ícones de linha simples (SVG) usados na interface.
const ICONES = {
  busca: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm9 16-4.35-4.35',
  fechar: 'M6 6l12 12M18 6 6 18',
  mapa: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zm0 0v14m6-12v14',
  voltar: 'M15 18l-6-6 6-6',
  info: 'M12 8h.01M11 12h1v5h1M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z',
  relogio: 'M12 7v5l3 2M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z',
  alerta: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  tabela: 'M3 5h18v14H3zM3 10h18M9 10v9',
  link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1m2 5a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
};
export function icone(nome, cls = 'icone') {
  return h('svg:svg', { class: cls, viewBox: '0 0 24 24', 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
    h('svg:path', { d: ICONES[nome] || '' }));
}
