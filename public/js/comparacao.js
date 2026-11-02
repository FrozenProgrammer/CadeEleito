// Comparação de dois candidatos (cand e cand2 na URL).
//  • Mesmo estado (ou um deles é Presidente, que tem votos em todo recorte): os dois usam os mesmos
//    filtros e o mapa mostra o "duelo" (quem teve o maior % em cada área).
//  • Estados diferentes: o recorte segue um dos dois (foco; '2' = o 2º) e o outro aparece com o total
//    do estado dele. O mapa mostra só o candidato do foco.

import { estado, contexto } from './estado.js';
import { corPartido } from './partidos.js';

// Candidatos já carregados (o da URL pode ainda estar chegando).
export const candidatoA = () => (contexto.candidato && contexto.candidato.id === estado.cand ? contexto.candidato : null);
export const candidatoB = () => (estado.cand2 && contexto.candidato2 && contexto.candidato2.id === estado.cand2 ? contexto.candidato2 : null);

export const compativeis = (a, b) => !!a && !!b && (a.uf === b.uf || a.uf === 'BR' || b.uf === 'BR');

// Os dois no mesmo recorte (mapa do duelo, cartões lado a lado com os mesmos filtros).
export function emDuelo() {
  const a = candidatoA(), b = candidatoB();
  return compativeis(a, b) ? [a, b] : null;
}

// Candidato que define o recorte (cargo e estado dos filtros).
export function candidatoPrincipal() {
  const a = candidatoA(), b = candidatoB();
  return estado.foco === '2' && b && !compativeis(a, b) ? b : a;
}

// ---------------------------------------------------------------------------
// Cores: a do partido de cada um. Se ficarem parecidas (mesmo partido, ou dois azuis), o 2º usa a
// cor de contraste mais distante da do 1º, para o mapa do duelo continuar legível.

function oklab(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const r = lin(n >> 16), g = lin((n >> 8) & 255), b = lin(n & 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
// Distância de matiz e saturação (sem a luminosidade: a escala do mapa já varia a luminosidade).
function distancia(x, y) {
  const [, a1, b1] = oklab(x), [, a2, b2] = oklab(y);
  return Math.hypot(a1 - a2, b1 - b2);
}
const CONTRASTE = ['#E8590C', '#0B7285', '#7048E8', '#2B8A3E', '#C2255C'];
const PARECIDAS = 0.09;

export function coresDuelo(a, b) {
  const ca = corPartido(a?.partido);
  let cb = corPartido(b?.partido);
  if (distancia(ca, cb) < PARECIDAS) cb = CONTRASTE.reduce((m, c) => (distancia(c, ca) > distancia(m, ca) ? c : m));
  return [ca, cb];
}
