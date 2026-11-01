// Concordância de gênero com a pessoa candidata. O gênero vem do registro no TSE (DS_GENERO),
// declarado pela própria pessoa: mulheres trans aparecem como "FEMININO" (ex.: Erika Hilton) e
// ficam Candidata, Deputada, Eleita. Sem gênero informado ("não divulgável"), vale a forma usual
// (masculina genérica), como nos textos do próprio TSE.

export const feminino = c => c?.genero === 'F';

// Cargo no feminino. "Presidente" serve aos dois gêneros (a presidente).
const CARGO_F = {
  Governador: 'Governadora', Senador: 'Senadora',
  'Deputado Federal': 'Deputada Federal', 'Deputado Estadual': 'Deputada Estadual', 'Deputado Distrital': 'Deputada Distrital',
  'Dep. Federal': 'Dep. Federal', 'Dep. Estadual': 'Dep. Estadual', 'Dep. Distrital': 'Dep. Distrital',
};
export const cargoDe = (nome, c) => (feminino(c) && CARGO_F[nome]) || nome;

// "candidato" / "candidata" (minúsculas; use a função com maiúscula no início de frase).
export const candidatoDe = c => (feminino(c) ? 'candidata' : 'candidato');
export const CandidatoDe = c => (feminino(c) ? 'Candidata' : 'Candidato');
export const eleitoDe = c => (feminino(c) ? 'Eleita' : 'Eleito');
// "este candidato" / "esta candidata"
export const esteCandidato = c => (feminino(c) ? 'esta candidata' : 'este candidato');
// "o candidato" / "a candidata"
export const oCandidato = c => (feminino(c) ? 'a candidata' : 'o candidato');

// Situação do TSE ("Eleito por média", "Não eleito"…) já formatada, concordando com a pessoa.
export function situacaoDe(texto, c) {
  if (!feminino(c)) return texto;
  return String(texto).replace(/\b([Ee])leito\b/g, '$1leita').replace(/\bELEITO\b/g, 'ELEITA');
}
