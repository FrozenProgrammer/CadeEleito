// Camada de dados do site estático. Lê os arquivos pré-calculados de dados/
// (JSON comprimido com gzip) e responde às mesmas consultas que as páginas usam.
// Não há servidor de aplicação: tudo é calculado no navegador, em milissegundos.

import { somarSecoes, montarResultado, normalizar } from './calculo.js';

const BASE = new URL('../dados/', import.meta.url);
const arquivos = new Map();

export class ErroApi extends Error {
  constructor(msg, status) { super(msg); this.status = status; }
}

async function descompactar(bytes) {
  // Arquivos começam com a assinatura gzip (1f 8b); se o servidor já tiver descompactado, usa direto.
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return new TextDecoder().decode(bytes);
  if (typeof DecompressionStream === 'undefined') throw new ErroApi('Seu navegador é antigo demais para este site. Atualize-o para a versão mais recente.', 0);
  const fluxo = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(fluxo).text();
}

// Os arquivos de dados levam a versão da publicação na URL (?v=...): o navegador pode guardá-los
// por muito tempo e, a cada nova publicação, busca automaticamente os novos.
let versao = null;
function carregar(rel, mensagem404) {
  if (arquivos.has(rel)) return arquivos.get(rel);
  const p = (async () => {
    const url = new URL(rel, BASE);
    if (rel === 'indice.bin') url.searchParams.set('t', String(Math.floor(Date.now() / 60_000))); // sempre atual (cache de 1 min)
    else {
      versao ||= (await carregar('indice.bin')).geradoEm;
      url.searchParams.set('v', versao);
    }
    let r;
    try { r = await fetch(url); } catch { throw new ErroApi('Sem conexão. Verifique sua internet e tente novamente.', 0); }
    if (r.status === 404) throw new ErroApi(mensagem404 || 'Dados não encontrados.', 404);
    if (!r.ok) throw new ErroApi(`Erro ${r.status} ao carregar os dados.`, r.status);
    return JSON.parse(await descompactar(new Uint8Array(await r.arrayBuffer())));
  })();
  arquivos.set(rel, p);
  p.catch(() => arquivos.delete(rel)); // permite tentar de novo após falha
  if (arquivos.size > 160) arquivos.delete(arquivos.keys().next().value);
  return p;
}

const indice = () => carregar('indice.bin');
const UF_OK = /^[A-Z]{2}$/, MUN_OK = /^\d{5}$/;
// Só as 27 UFs do índice (formato válido não basta: "XX" viraria um pedido 404 inútil).
async function arquivoUf(uf) {
  if (!UF_OK.test(uf) || !(await indice()).ufs.some(u => u.sigla === uf)) throw new ErroApi('UF inválida.', 400);
  return carregar(`uf/${uf}.bin`);
}
const SEM_DETALHE = 'O detalhamento por bairro, local de votação e seção deste estado não está incluído nesta publicação.';

async function arquivoMun(uf, mun) {
  if (!UF_OK.test(uf) || !MUN_OK.test(mun)) throw new ErroApi('Município inválido.', 400);
  const ix = await indice();
  if (!ix.detalhadas.includes(uf)) throw new ErroApi(SEM_DETALHE, 404);
  return carregar(`m/${uf}/${mun}.bin`, 'Município sem dados nesta publicação.');
}
// Zona: arquivo dos cargos majoritários ou (sufixo -p) dos proporcionais, bem maior.
const arquivoZona = (uf, mun, zona, proporcional) => carregar(`s/${uf}/${mun}/${zona}${proporcional ? '-p' : ''}.bin`, 'Zona sem votos registrados nesta publicação.');
// Resultado oficial da UF + metadados dos candidatos de um cargo/turno.
const arquivoCargo = (uf, turno, cargoId) => carregar(`uf/${uf}/${turno}-${cargoId}.bin`, 'Cargo sem dados nesta publicação.');

// ---------------------------------------------------------------------------

const erro = msg => { throw new ErroApi(msg, 400); };

async function validar(p) {
  const ix = await indice();
  const turno = Number(p.turno || 1);
  if (turno !== 1 && turno !== 2) erro('Turno inválido.');
  let cargoId = String(p.cargo || 'presidente');
  const uf = String(p.uf || '').toUpperCase();
  if (uf && !ix.ufs.some(u => u.sigla === uf)) erro('UF inválida.');
  if (uf === 'DF' && cargoId === 'deputado_estadual') cargoId = 'deputado_distrital';
  if (uf && uf !== 'DF' && cargoId === 'deputado_distrital') cargoId = 'deputado_estadual';
  const cargo = ix.cargos.find(c => c.id === cargoId) || erro('Cargo inválido.');
  if (!uf && !cargo.nacional) erro(`Selecione um estado para consultar ${cargo.nome}.`);
  if (!cargo.turnos.includes(turno) || (turno === 2 && cargoId === 'presidente' && !ix.segundoTurnoPresidente)) erro(`Não houve ${turno}º turno para ${cargo.nome}.`);
  if (turno === 2 && cargoId === 'governador' && !ix.segundoTurnoGovernador.includes(uf)) erro(`Não houve 2º turno para Governador em ${ix.ufs.find(u => u.sigla === uf).nome}.`);

  const q = { turno, cargo, uf: uf || null, ufNome: uf ? ix.ufs.find(u => u.sigla === uf).nome : 'Brasil', mun: null, municipio: null, zona: null, bairro: null, local: null, secao: null };
  if (p.mun) {
    if (!uf) erro('Município inválido.');
    q.municipio = (await arquivoUf(uf)).municipios.find(m => m.cd === String(p.mun)) || erro('Município não encontrado.');
    q.mun = q.municipio.cd;
  }
  if (p.zona) {
    const z = Number(p.zona);
    if (!q.municipio || !q.municipio.zonas.includes(z)) erro('Zona inválida para este município.');
    q.zona = z;
  }
  if (p.bairro) { if (!q.mun) erro('Bairro inválido.'); q.bairro = String(p.bairro).slice(0, 150); }
  for (const campo of ['local', 'secao']) {
    if (!p[campo]) continue;
    if (!q.zona || !/^\d{1,5}$/.test(String(p[campo]))) erro(`${campo === 'local' ? 'Local de votação' : 'Seção'} exige zona válida.`);
    q[campo] = Number(p[campo]);
  }
  if (q.secao && q.local) q.local = null;
  q.nivel = q.secao ? 'secao' : q.local ? 'local' : q.bairro ? 'bairro' : q.zona ? 'zona' : q.mun ? 'municipio' : q.uf ? 'uf' : 'brasil';
  return q;
}

function envelope(q, r, extra, fonte) {
  const partes = [q.ufNome];
  if (q.municipio) partes.push(q.municipio.nm);
  if (q.zona) partes.push(`Zona ${q.zona}`);
  if (q.bairro) partes.push(`Bairro ${extra.bairroNome || q.bairro}`);
  if (q.local) partes.push(extra.localNome || `Local ${q.local}`);
  if (q.secao) partes.push(`Seção ${q.secao}`);
  return {
    turno: q.turno,
    cargo: { id: q.cargo.id, nome: q.cargo.nome, proporcional: q.cargo.proporcional },
    escopo: { nivel: q.nivel, rotulo: partes.join(' › '), uf: q.uf, ufNome: q.ufNome, mun: q.mun, munNome: q.municipio?.nm || null, zona: q.zona, bairro: extra.bairroNome || q.bairro, local: q.local, localNome: extra.localNome || null, endereco: extra.endereco || null, secao: q.secao },
    fonte,
    ...r,
  };
}

// Cada seção pertence a um único local: o do boletim de urna, se ele existe no cadastro de locais;
// senão, o do cadastro. O cadastro sozinho não basta (lista ~1.800 seções em dois locais, por
// transferência/agregação) e o boletim sozinho também não (em ~1,5% das seções traz um número de
// local ausente do cadastro). Assim locais e bairros somam exatamente o município.
function donoDasSecoes(locais) {
  const existe = new Set(locais.map(l => `${l.z}|${l.n}`));
  const cadastro = new Map();
  for (const l of locais) for (const s of l.secoes) if (!cadastro.has(`${l.z}|${s}`)) cadastro.set(`${l.z}|${s}`, l.n);
  return (zona, secao, sec) => (existe.has(`${zona}|${sec.l}`) ? sec.l : cadastro.get(`${zona}|${secao}`));
}

const FONTE_SECAO ='TSE — Dados abertos: votação por seção eleitoral (soma das seções)';

async function consultar(p) {
  const q = await validar(p);
  const k = `${q.turno}|${q.cargo.id}`;
  if (q.nivel === 'brasil') {
    const br = await carregar('br.bin');
    return envelope(q, br.resultados[k], {}, { tipo: 'ea20', descricao: 'TSE — Divulgação oficial de resultados (EA20)', atualizadoEm: br.resultados[k].atualizacao });
  }
  const [U, C] = await Promise.all([arquivoUf(q.uf), arquivoCargo(q.uf, q.turno, q.cargo.id)]);
  if (q.nivel === 'uf') {
    return envelope(q, C.resultado, {}, { tipo: 'ea20', descricao: 'TSE — Divulgação oficial de resultados (EA20)', atualizadoEm: C.resultado.atualizacao });
  }
  const meta = C.meta;
  const codigo = String(Number(q.cargo.codigo));
  const M = await arquivoMun(q.uf, q.mun);
  const fonte = { tipo: 'votacao_secao', descricao: FONTE_SECAO, atualizadoEm: (q.cargo.nacional ? U.atualizado.presidente : U.atualizado.secoes) || '' };
  const extra = {};
  let r, locaisEscopo, eleitoradoSecao = null;

  if (q.nivel === 'municipio') {
    const t = M.totais[`${q.turno}|${codigo}`] || { v: {}, s: 0 };
    r = montarResultado(t.v, q.cargo.proporcional, meta, t.s);
    locaisEscopo = M.locais;
  } else {
    let alvos;
    if (q.nivel === 'zona') {
      alvos = [{ zona: q.zona }];
      locaisEscopo = M.locais.filter(l => l.z === q.zona);
    } else if (q.nivel === 'secao') {
      alvos = [{ zona: q.zona, secoes: new Set([q.secao]) }];
      const l = M.locais.find(x => x.z === q.zona && x.secoes.includes(q.secao));
      if (l) { extra.localNome = l.nome; extra.endereco = l.end; }
    } else if (q.nivel === 'local') {
      const l = M.locais.find(x => x.z === q.zona && x.n === q.local) || erro('Local de votação não encontrado nesta zona.');
      extra.localNome = l.nome;
      extra.endereco = l.end;
      const dono = donoDasSecoes(M.locais);
      alvos = [{ zona: q.zona, aceita: (s, sec) => dono(q.zona, s, sec) === l.n }];
      locaisEscopo = [l];
    } else {
      const alvoNorm = normalizar(q.bairro);
      locaisEscopo = M.locais.filter(l => normalizar(l.bairro) === alvoNorm && (!q.zona || l.z === q.zona));
      if (!locaisEscopo.length) erro('Este bairro não possui locais de votação no recorte selecionado.');
      extra.bairroNome = locaisEscopo[0].bairro;
      const dono = donoDasSecoes(M.locais);
      const doBairro = new Set(locaisEscopo.map(l => `${l.z}|${l.n}`));
      alvos = [...new Set(locaisEscopo.map(l => l.z))].map(zona => ({ zona, aceita: (s, sec) => doBairro.has(`${zona}|${dono(zona, s, sec)}`) }));
    }
    const dados = await Promise.all(alvos.map(a => arquivoZona(q.uf, q.mun, a.zona, q.cargo.proporcional)));
    if (q.nivel === 'secao') {
      eleitoradoSecao = dados[0]?.e?.[q.secao] || 0;
      // Local exibido = dono da seção (mesma regra dos filtros de local e bairro).
      const sec = dados[0]?.[q.turno]?.[q.secao];
      const n = sec && donoDasSecoes(M.locais)(q.zona, q.secao, sec);
      const l = n !== undefined && M.locais.find(x => x.z === q.zona && x.n === n);
      if (l) { extra.localNome = l.nome; extra.endereco = l.end; }
    }
    const soma = somarSecoes(alvos.map((a, i) => ({ ...a, dados: dados[i] })), q.turno, codigo);
    if (q.nivel === 'secao' && !soma.secoes) erro(`A seção ${q.secao} não tem votos registrados na zona ${q.zona} neste turno. Ela pode não existir ou ter sido agregada a outra seção.`);
    r = montarResultado(soma.votos, q.cargo.proporcional, meta, soma.secoes);
  }
  // Eleitorado apto (cadastro do 1º turno) das seções do recorte.
  if (q.turno === 1 && (locaisEscopo?.length || eleitoradoSecao)) {
    const eleitorado = eleitoradoSecao ?? locaisEscopo.reduce((a, l) => a + (l.el || 0), 0);
    if (eleitorado >= r.totais.comparecimento) { r.totais.eleitorado = eleitorado; r.totais.abstencao = eleitorado - r.totais.comparecimento; }
  }
  return envelope(q, r, extra, fonte);
}

// ---------------------------------------------------------------------------

let candidatosCache = null;
async function listaCandidatos() {
  if (candidatosCache) return candidatosCache;
  const d = await carregar('candidatos.bin');
  candidatosCache = d.lista.map(([id, nome, nomeCompleto, numero, ci, uf, partido, situacao, turno2]) => ({
    c: { id, nome, nomeCompleto, numero, cargo: d.cargos[ci], uf, partido, situacao, turno2: !!turno2 },
    k: `${normalizar(nome)} | ${normalizar(nomeCompleto)} | ${numero}`,
  }));
  return candidatosCache;
}

async function buscarCandidatos(texto) {
  const q = normalizar(texto);
  if (q.length < 2) return [];
  const termos = q.split(' ');
  const out = (await listaCandidatos()).filter(x => termos.every(t => x.k.includes(t))).map(x => x.c);
  const ordemCargo = { presidente: 0, governador: 20, senador: 40 };
  const eleito = c => /ELEITO/.test(c.situacao) && !/NÃO ELEITO/.test(c.situacao);
  const peso = c => (c.numero === q ? 0 : 1000) + (ordemCargo[c.cargo] ?? 100) + (normalizar(c.nome).startsWith(q) ? 0 : 10) + (eleito(c) ? 0 : 1);
  return out.sort((a, b) => peso(a) - peso(b) || a.nome.localeCompare(b.nome, 'pt-BR')).slice(0, 25);
}

async function lideres(p) {
  const turno = Number(p.turno || 1);
  const ix = await indice();
  if (![1, 2].includes(turno) || !ix.cargos.some(c => c.id === p.cargo) || (p.uf && !UF_OK.test(p.uf))) erro('Consulta de mapa inválida.');
  // Partido líder e 3 mais votados por área (UF no mapa do Brasil; município nos estados).
  const { lideres: dados, top3 } = await carregar(`mapa/lideres/${p.uf || 'BR'}/${turno}-${p.cargo}.bin`, 'Sem dados de mapa para esta combinação.');
  const contagem = {};
  for (const l of Object.values(dados)) if (l) contagem[l.sigla] = (contagem[l.sigla] || 0) + 1;
  const ranking = Object.entries(contagem).sort((a, b) => b[1] - a[1]).map(([sigla, locais]) => ({ sigla, locais }));
  return { lideres: dados, ranking, top3 };
}

async function locaisMun(p) {
  const M = await arquivoMun(p.uf, p.mun);
  const bairros = new Map();
  for (const l of M.locais) {
    const k = normalizar(l.bairro);
    const b = bairros.get(k) || { nome: l.bairro, eleitores: 0, secoes: 0, zonas: new Set() };
    b.eleitores += l.el || 0;
    b.secoes += l.secoes.length;
    b.zonas.add(l.z);
    bairros.set(k, b);
  }
  return {
    locais: M.locais.map(l => ({ ...l, eleitores: l.el || 0 })),
    bairros: [...bairros.values()].map(b => ({ ...b, zonas: [...b.zonas].sort((a, c) => a - c) })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
  };
}

const ROTAS = {
  '/api/config': async () => {
    const ix = await indice();
    return { ...ix, preparoSobDemanda: false };
  },
  '/api/municipios': async p => (await arquivoUf(p.uf)).municipios,
  '/api/locais': locaisMun,
  '/api/candidatos': p => buscarCandidatos(p.q || ''),
  '/api/candidato': async p => (await listaCandidatos()).find(x => x.c.id === String(p.id))?.c || erro('Candidato não encontrado.'),
  '/api/resultado': consultar,
  '/api/mapa/brasil': () => carregar('mapa/brasil.bin'),
  '/api/mapa/uf': async p => { await arquivoUf(p.uf); return carregar(`mapa/${p.uf}.bin`); },
  '/api/mapa/lideres': lideres,
};

// Mesma assinatura usada pelas páginas: api(caminho, parâmetros).
export async function api(caminho, params = {}) {
  const fn = ROTAS[caminho];
  if (!fn) throw new ErroApi('Consulta desconhecida.', 404);
  const limpos = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== ''));
  return fn(limpos);
}
