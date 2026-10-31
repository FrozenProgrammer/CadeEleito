'use strict';
// Configuração do gerador do site estático BR Eleições 2026.
// Pode ser ajustada por variáveis de ambiente (veja README.md).

const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const env = process.env;
const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

const APP_VERSION = '4.0.0';

const CACHE_DIR = env.BR_ELEICOES_CACHE_DIR
  ? path.resolve(env.BR_ELEICOES_CACHE_DIR)
  : path.join(ROOT, '.cache-brazil-eleicoes-2026');

// Fontes oficiais.
const TSE_RESULTADOS = 'https://resultados.tse.jus.br/oficial';
const TSE_BASE = `${TSE_RESULTADOS}/ele2026`;
const TSE_CDN = 'https://cdn.tse.jus.br/estatistica/sead/odsele';
const FONTES = {
  eleicoes: `${TSE_RESULTADOS}/comum/config/ele-c.json`,
  municipios: `${TSE_BASE}/6259/config/mun-e006259-cm.json`,
  candidatos: `${TSE_CDN}/consulta_cand/consulta_cand_2026.zip`,
  fotos: sigla => `https://cdn.tse.jus.br/estatistica/sead/eleicoes/eleicoes2026/fotos/foto_cand2026_${sigla}_div.zip`,
  locais: `${TSE_CDN}/eleitorado_locais_votacao/eleitorado_local_votacao_2026.zip`,
  secao: uf => `${TSE_CDN}/votacao_secao/votacao_secao_2026_${uf}.zip`,
  malhaBrasil: 'https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application/vnd.geo+json&intrarregiao=UF&qualidade=minima',
  malhaUf: codIbge => `https://servicodados.ibge.gov.br/api/v3/malhas/estados/${codIbge}?formato=application/vnd.geo+json&intrarregiao=municipio&qualidade=minima`,
};
// Somente estes hosts podem ser consultados pelo servidor (inclusive em redirecionamentos).
const HOSTS_PERMITIDOS = new Set(['resultados.tse.jus.br', 'cdn.tse.jus.br', 'servicodados.ibge.gov.br']);

const UFS = [
  ['AC', 'Acre', '12'], ['AL', 'Alagoas', '27'], ['AP', 'Amapá', '16'], ['AM', 'Amazonas', '13'],
  ['BA', 'Bahia', '29'], ['CE', 'Ceará', '23'], ['DF', 'Distrito Federal', '53'], ['ES', 'Espírito Santo', '32'],
  ['GO', 'Goiás', '52'], ['MA', 'Maranhão', '21'], ['MT', 'Mato Grosso', '51'], ['MS', 'Mato Grosso do Sul', '50'],
  ['MG', 'Minas Gerais', '31'], ['PA', 'Pará', '15'], ['PB', 'Paraíba', '25'], ['PR', 'Paraná', '41'],
  ['PE', 'Pernambuco', '26'], ['PI', 'Piauí', '22'], ['RJ', 'Rio de Janeiro', '33'], ['RN', 'Rio Grande do Norte', '24'],
  ['RS', 'Rio Grande do Sul', '43'], ['RO', 'Rondônia', '11'], ['RR', 'Roraima', '14'], ['SC', 'Santa Catarina', '42'],
  ['SP', 'São Paulo', '35'], ['SE', 'Sergipe', '28'], ['TO', 'Tocantins', '17'],
].map(([sigla, nome, ibge]) => ({ sigla, nome, ibge }));
const UF_POR_SIGLA = new Map(UFS.map(u => [u.sigla, u]));
const UF_POR_IBGE = new Map(UFS.map(u => [u.ibge, u]));

// Cargos disputados em 2026. `eleicoes` mapeia turno -> código da eleição no TSE.
const CARGOS = {
  presidente: { codigo: '0001', nome: 'Presidente', eleicoes: { 1: '6257', 2: '6258' }, nacional: true, proporcional: false },
  governador: { codigo: '0003', nome: 'Governador', eleicoes: { 1: '6259', 2: '6260' }, nacional: false, proporcional: false },
  senador: { codigo: '0005', nome: 'Senador', eleicoes: { 1: '6259' }, nacional: false, proporcional: false },
  deputado_federal: { codigo: '0006', nome: 'Deputado Federal', eleicoes: { 1: '6259' }, nacional: false, proporcional: true },
  deputado_estadual: { codigo: '0007', nome: 'Deputado Estadual', eleicoes: { 1: '6259' }, nacional: false, proporcional: true, exceto: ['DF'] },
  deputado_distrital: { codigo: '0008', nome: 'Deputado Distrital', eleicoes: { 1: '6259' }, nacional: false, proporcional: true, somente: ['DF'] },
};
const CARGO_POR_CODIGO = new Map(Object.entries(CARGOS).map(([id, c]) => [Number(c.codigo), { id, ...c }]));

module.exports = {
  ROOT,
  APP_VERSION,
  CACHE_DIR,
  PUBLIC_DIR: path.join(ROOT, 'public'),
  TSE_BASE,
  FONTES,
  HOSTS_PERMITIDOS,
  UFS,
  UF_POR_SIGLA,
  UF_POR_IBGE,
  CARGOS,
  CARGO_POR_CODIGO,
  LIMITES: {
    downloadMaxBytes: num(env.BR_ELEICOES_MAX_DOWNLOAD_BYTES, 4 * 1024 * 1024 * 1024),
    respostaTseMaxBytes: 40 * 1024 * 1024,
    // Resultados ainda em totalização são revalidados após este intervalo.
    resultadoParcialTtlMs: num(env.BR_ELEICOES_PARTIAL_TTL_MS, 60_000),
    // Arquivos de dados abertos (candidatos, locais, partidos) são revalidados após este intervalo.
    dadosAbertosTtlMs: num(env.BR_ELEICOES_OPEN_DATA_TTL_MS, 7 * 24 * 60 * 60 * 1000),
    cacheMemoriaItens: num(env.BR_ELEICOES_MEMORY_CACHE_ITEMS, 400),
  },
};
