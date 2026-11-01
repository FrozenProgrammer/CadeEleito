// Página Typography: 10 combinações de fontes (títulos + texto) aplicadas à abertura do site, ao
// cartão do candidato e a um título de seção com tabela, para comparar e escolher.
// Os dados das amostras são fictícios. As fontes estão em css/tipografia.css.

import { h, limpar } from '../dom.js';

const OPCOES = [
  { titulo: 'Instrument Serif', texto: 'Inter', peso: 400, nota: 'Elegante e contida, títulos finos e altos.' },
  { titulo: 'Newsreader', texto: 'Inter', peso: 600, nota: 'Jornal clássico, feita para leitura de notícias.', atual: true },
  { titulo: 'Playfair Display', texto: 'Source Sans 3', peso: 700, nota: 'Revista: alto contraste, sofisticada.' },
  { titulo: 'Fraunces', texto: 'Inter', peso: 600, nota: 'Editorial moderno, com personalidade.' },
  { titulo: 'DM Serif Display', texto: 'DM Sans', peso: 400, nota: 'Manchete marcante com interface limpa.' },
  { titulo: 'Space Grotesk', texto: 'Space Grotesk', peso: 600, nota: 'Só sem serifa: cara de jornalismo de dados.' },
  { titulo: 'IBM Plex Serif', texto: 'IBM Plex Sans', peso: 600, nota: 'Institucional e técnica, cara de relatório.' },
  { titulo: 'Lora', texto: 'Work Sans', peso: 600, nota: 'Acolhedora, menos formal.' },
  { titulo: 'Oswald', texto: 'Roboto', peso: 600, nota: 'Plantão de notícias: caixa-alta condensada.', caixa: 'uppercase', esp: '.02em' },
  { titulo: 'Source Serif 4', texto: 'Source Sans 3', peso: 600, nota: 'Sóbria e neutra, muito legível.' },
];

const pilha = nome => `"${nome}", ${/Sans|Grotesk|Oswald|Roboto|Inter/.test(nome) ? 'system-ui, sans-serif' : 'Georgia, serif'}`;

function amostra(o) {
  const el = h('div', { class: 'tipo-amostra' },
    h('div', { class: 'tipo-heroi' },
      h('p', { class: 't-chapeu', text: 'Eleições 2026' }),
      h('p', { class: 't-titulo', text: 'Cadê o eleito?' }),
      h('p', { class: 't-lema', text: 'Descubra quantos votos da sua cidade foram para quem prometeu resolver tudo, menos os problemas reais.' })),
    h('div', { class: 'tipo-cartao' },
      h('div', { class: 'tipo-cand' },
        h('span', { class: 'tipo-num', text: '1234' }),
        h('div', {}, h('small', { text: 'Partido · Deputado Federal · SP' }), h('p', { class: 't-titulo', text: 'Maria Exemplo' }))),
      h('div', { class: 'tipo-metricas' },
        h('div', {}, h('strong', { text: '1.234.567' }), h('span', { text: 'votos' })),
        h('div', {}, h('strong', { text: '12,34%' }), h('span', { text: 'dos votos válidos' })),
        h('div', {}, h('strong', { text: '3º' }), h('span', { text: 'de 42 candidatos' })))),
    h('div', { class: 'tipo-secao' },
      h('p', { class: 't-titulo', text: 'Votos por município' }),
      h('table', {},
        h('thead', {}, h('tr', {}, h('th', { text: 'Município' }), h('th', { class: 'num', text: 'Votos' }), h('th', { class: 'num', text: '%' }))),
        h('tbody', {},
          [['Cidade A', '98.765', '18,02%'], ['Cidade B', '7.410', '9,87%'], ['Cidade C', '612', '1,05%']].map(([m, v, p]) =>
            h('tr', {}, h('td', { text: m }), h('td', { class: 'num', text: v }), h('td', { class: 'num', text: p })))))));
  // CSSOM (permitido pela CSP): as fontes da opção valem só dentro desta amostra.
  el.style.setProperty('--t-titulo', pilha(o.titulo));
  el.style.setProperty('--t-texto', pilha(o.texto));
  el.style.setProperty('--t-peso', String(o.peso));
  if (o.caixa) el.style.setProperty('--t-caixa', o.caixa);
  if (o.esp) el.style.setProperty('--t-esp', o.esp);
  return el;
}

export function criarPaginaTipografia(raiz) {
  let montada = false;
  return {
    carregar() {
      if (montada) return;
      montada = true;
      limpar(raiz, h('div', { class: 'pagina-conteudo' },
        h('div', { class: 'cartao tipo-intro' },
          h('h2', { text: 'Typography' }),
          h('p', { text: '10 combinações de fontes aplicadas ao título, ao cartão do candidato e às tabelas do site. Dados fictícios.' })),
        h('div', { class: 'tipo-grade' }, OPCOES.map((o, i) => h('article', { class: 'cartao tipo-opcao', 'aria-label': `Opção ${i + 1}: ${o.titulo} e ${o.texto}` },
          h('div', { class: 'tipo-cabecalho' },
            h('span', { class: 'etiqueta', text: `Opção ${i + 1}` }),
            h('h2', {}, `${o.titulo} + ${o.texto}`, o.atual ? h('span', { class: 'tipo-atual', text: ' · em uso' }) : null),
            h('p', { text: `${o.nota} Títulos com peso ${o.peso}.` })),
          amostra(o))))));
    },
  };
}
