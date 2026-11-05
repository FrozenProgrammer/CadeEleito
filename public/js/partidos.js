// Cor de cada partido (identidade visual usual da legenda). O mapa usa a cor do partido do
// candidato como base da escala de densidade (css/app.css: .dens-1 … .dens-9 a partir de --partido)
// e, no mapa "quem venceu", pinta cada município com a cor do partido do mais votado.
// As siglas são comparadas sem acento e em maiúsculas (UNIÃO = UNIAO, PCdoB = PCDOB).

const CORES = {
  PT: '#E30613',
  PCDOB: '#9E0B0F',
  PSB: '#FF4D00',
  PSOL: '#6A1B9A',
  PDT: '#800020',
  SOLIDARIEDADE: '#F37021',
  AVANTE: '#FF6600',
  NOVO: '#FF5A00',
  PL: '#002776',
  PP: '#00AEEF',
  UNIAO: '#0080FF',
  REPUBLICANOS: '#0052CC',
  PSD: '#1E56A0',
  PSDB: '#003399',
  PODE: '#00B4D8',
  PRD: '#2B4C7E',
  MDB: '#009739',
  PV: '#2E7D32',
  REDE: '#8BC34A',
  MISSAO: '#1A1A1A',
  CIDADANIA: '#E91E63',
  // Demais partidos de 2026 (cores aproximadas das logomarcas).
  DC: '#D4A017',          // Democracia Cristã: amarelo do logotipo
  MOBILIZA: '#00897B',    // Mobiliza (ex-PMN): verde-azulado
  AGIR: '#7B1FA2',        // Agir (ex-PTC): roxo
  DEMOCRATA: '#3F51B5',   // Democrata: anil
  UP: '#B71C1C',          // Unidade Popular: vermelho-escuro
  PCO: '#8B0000',         // PCO: vermelho-sangue
  PSTU: '#D32F2F',        // PSTU: vermelho
  PCB: '#A30000',         // PCB: vermelho
  PRTB: '#558B2F',        // PRTB: verde-oliva
};
export const COR_PADRAO = '#6B7280'; // partido sem cor conhecida: cinza

const chave = sigla => String(sigla || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z]/g, '').toUpperCase();

export function corPartido(sigla) {
  return CORES[chave(sigla)] || COR_PADRAO;
}

// Cartão do candidato: as duas cores principais da logomarca (aproximadas). A 1ª é a "cor do
// partido" no cartão (moldura da foto, barra dos votos); a faixa do topo fica metade de cada.
// Pode ser diferente da cor do mapa (Missão: amarelo e preto no cartão, preto no mapa).
const DUPLAS = {
  PT: ['#E30613', '#FFFFFF'],
  PCDOB: ['#C4161C', '#FFD200'],
  PSB: ['#FF4D00', '#FFC300'],
  PSOL: ['#6A1B9A', '#FFD200'],
  PDT: ['#C8102E', '#1E3A8A'],
  SOLIDARIEDADE: ['#F37021', '#1F3C88'],
  AVANTE: ['#FF6600', '#00539F'],
  NOVO: ['#FF5A00', '#1F1F1F'],
  PL: ['#002776', '#FFCC00'],
  PP: ['#00AEEF', '#0B2D6B'],
  UNIAO: ['#0080FF', '#FFD100'],
  REPUBLICANOS: ['#0052CC', '#7AC143'],
  PSD: ['#1E56A0', '#F5A800'],
  PSDB: ['#003399', '#FFCC00'],
  PODE: ['#00B4D8', '#13294B'],
  PRD: ['#2B4C7E', '#F2B705'],
  MDB: ['#009739', '#FEDD00'],
  PV: ['#2E7D32', '#FFD200'],
  REDE: ['#3BA55C', '#F57C00'],
  MISSAO: ['#FFD400', '#111111'],
  CIDADANIA: ['#E91E63', '#2D2A6E'],
  DC: ['#00519E', '#F2C200'],
  MOBILIZA: ['#00897B', '#F9A825'],
  AGIR: ['#7B1FA2', '#FFC107'],
  DEMOCRATA: ['#3F51B5', '#FFC107'],
  UP: ['#B71C1C', '#FFD600'],
  PCO: ['#8B0000', '#FFD600'],
  PSTU: ['#D32F2F', '#111111'],
  PCB: ['#A30000', '#FFD600'],
  PRTB: ['#558B2F', '#FFD600'],
};

// Luminância relativa (WCAG) e contraste entre duas cores #rrggbb.
const lum = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contraste = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

// Fundo do cartão e trilho neutro da barra em cada tema (os mesmos de .cartao-social no CSS).
export const FUNDO_CARTAO = { escuro: '#0f1a2e', claro: '#f4f8fb' };
export const TRILHO_NEUTRO = { escuro: '#2b3a57', claro: '#c9d1da' };

// Cores do cartão:
//  • faixa: c1 | c2; no tema claro, uma 2ª cor quase branca (o branco do PT) sumiria no fundo e
//    vira c1 (faixa inteira na cor do partido);
//  • número: fundo = a mais escura das duas; o algarismo na outra se ela tiver contraste de texto,
//    senão branco ou preto;
//  • barra de votos: trilho = a 2ª cor se for escura (o preto da Missão), senão o cinza do tema
//    (trilho = null); preenchimento = c1, ou c2 se c1 quase não aparecer sobre o trilho (o azul-
//    escuro do PL no tema escuro vira o amarelo), calculado para cada tema.
export function paletaCartao(sigla) {
  const cor = corPartido(sigla);
  const [c1, c2] = DUPLAS[chave(sigla)] || [cor, cor === COR_PADRAO ? '#374151' : '#FFFFFF'];
  const [escura, clara] = lum(c1) <= lum(c2) ? [c1, c2] : [c2, c1];
  const numTexto = contraste(clara, escura) >= 4.5 ? clara : contraste('#FFFFFF', escura) >= contraste('#000000', escura) ? '#FFFFFF' : '#000000';
  const trilho = c2 !== c1 && lum(c2) < 0.06 ? c2 : null;
  const barra = tema => {
    const t = trilho || TRILHO_NEUTRO[tema];
    return contraste(c1, t) >= 2 || contraste(c2, t) <= contraste(c1, t) ? c1 : c2;
  };
  return {
    c1, c2, numFundo: escura, numTexto, trilho,
    faixa2: { escuro: c2, claro: contraste(c2, FUNDO_CARTAO.claro) < 1.25 ? c1 : c2 },
    barra: { escuro: barra('escuro'), claro: barra('claro') },
  };
}
