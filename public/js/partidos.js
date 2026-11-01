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
