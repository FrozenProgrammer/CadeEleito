// Mapa de densidade de votos do candidato filtrado, em três níveis de zoom:
//   Brasil (por estado, para Presidente) › Estado (por município) › Município (por local de votação).
// Cada área ou local é colorido pelo % dos votos válidos que o candidato recebeu ali, numa escala
// da cor do partido dele: quanto maior o percentual, mais forte a cor. Clicar em um estado aproxima
// o mapa; clicar em um município aproxima (página inicial) ou só o seleciona (aba Mapa).
// Aba Mapa, sem candidato, num estado: mapa "quem venceu" — cada município na cor do partido do
// mais votado do cargo escolhido nos atalhos ao lado, e os mais votados do município clicado (ou
// buscado na caixa "Cidade" do mapa, que aproxima o mapa dele; a caixa some quando há candidato).
// Comparação (dois candidatos do mesmo estado, ou um deles Presidente): mapa do "duelo" — cada área
// na cor de quem teve o maior % dos votos válidos ali, mais forte quanto maior a vantagem (em pontos
// percentuais). Estados diferentes: o mapa mostra um dos dois (botões "Mapa de").

import { h, limpar, numero, pct, titulo, icone, fotoCandidato } from '../dom.js';
import { corPartido } from '../partidos.js';
import { feminino, cargoDe, oCandidato, esteCandidato } from '../genero.js';
import { api } from '../api.js';
import { estado, contexto, definir, urlPara } from '../estado.js';
import { mostrarTooltip, esconderTooltip } from '../grafico.js';
import { esqueleto, erro, informacao } from './comum.js';
import { candidatoA, candidatoB, candidatoPrincipal, emDuelo, compativeis, coresDuelo } from '../comparacao.js';

const FAIXAS = 9; // degraus da escala sequencial (classes dens-1 … dens-9 em css/app.css)
const fmtCurto = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const pctCurto = n => `${fmtCurto.format(n)}%`;
const ppCurto = n => `${fmtCurto.format(n)} p.p.`; // pontos percentuais (diferença entre dois %)

// Nota da escala: no tema claro o degrau mais forte é o mais escuro; no escuro, o mais claro. Os
// dois textos ficam na página e o CSS mostra o do tema atual (trocar o tema não redesenha o mapa).
function notaTom(escuro, claro) {
  return h('p', { class: 'legenda-nota' }, h('span', { class: 'so-tema-escuro', text: escuro }), h('span', { class: 'so-tema-claro', text: claro }));
}

// Topo da escala arredondado para cima, para a legenda ter marcas legíveis (ex.: 12,8% -> 15%).
function topoEscala(max) {
  for (const p of [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 25]) if (max / p <= 6) return Math.min(100, Math.ceil(max / p) * p) || p;
  return 100;
}

// A escala vai de 0% ao percentil 95 das áreas com votos: um reduto isolado (ex.: 11% numa
// cidade e menos de 1% no resto) não deixa todo o mapa no primeiro degrau. Áreas acima do topo
// ficam no degrau mais forte e a legenda indica "ou mais".
function escalaDensidade(areas, max) {
  const pcts = areas.filter(a => a?.votos).map(a => a.percentual).sort((a, b) => a - b);
  if (!pcts.length) return { topo: 1, teto: false };
  const topo = topoEscala(pcts[Math.min(pcts.length - 1, Math.floor(pcts.length * 0.95))]);
  return { topo, teto: max > topo };
}

function classeDensidade(a, topo) {
  if (!a || !a.validos) return 'cor-sem';
  if (!a.votos) return 'dens-0';
  return `dens-${Math.min(FAIXAS, Math.max(1, Math.ceil((a.percentual / topo) * FAIXAS)))}`;
}

// Legenda: barra em degraus da cor mais fraca à mais forte, com o percentual nas pontas e no meio.
function legenda(nome, { topo, teto }, unidade, cand) {
  const fim = `${pctCurto(topo)}${teto ? ' ou mais' : ''}`;
  return h('div', { class: 'legenda-densidade', role: 'group', 'aria-label': `Legenda: % dos votos válidos para ${nome} em cada ${unidade}, de 0% a ${fim}` },
    h('p', { class: 'legenda-titulo', text: `% dos votos válidos para ${nome} em cada ${unidade}` }),
    h('div', { class: 'legenda-escala', 'aria-hidden': 'true' },
      h('div', { class: 'legenda-degraus' }, Array.from({ length: FAIXAS }, (_, i) => h('span', { class: `dens-${i + 1}`, style: { animationDelay: `${i * 45}ms` } }))),
      h('div', { class: 'legenda-marcas' },
        h('span', { text: '0%' }), h('span', { text: pctCurto(topo / 2) }), h('span', { text: fim }))),
    h('ul', { class: 'legenda legenda-extra', 'aria-hidden': 'true' },
      h('li', {}, h('span', { class: 'legenda-cor dens-0' }), h('span', { text: 'Nenhum voto' })),
      h('li', {}, h('span', { class: 'legenda-cor cor-sem' }), h('span', { text: 'Sem dados' }))),
    notaTom(`Quanto mais clara a cor, maior a parcela dos votos válidos que foi para ${oCandidato(cand)}.`,
      `Quanto mais escura a cor, maior a parcela dos votos válidos que foi para ${oCandidato(cand)}.`));
}

// Tooltip: nome, detalhe (bairro), votos e o percentual em negrito.
function dica(nome, a, detalhe) {
  const texto = [nome, detalhe, a ? `${numero(a.votos)} votos` : 'Sem dados de votação', a ? `${pct(a.percentual)} dos votos válidos` : ''].filter(Boolean).join('. ');
  const el = h('div', { class: 'tt-dens' },
    h('strong', { text: nome }),
    detalhe ? h('span', { class: 'tt-detalhe', text: detalhe }) : null,
    a ? [h('span', { text: `${numero(a.votos)} votos` }), h('span', {}, h('strong', { class: 'tt-pct', text: pct(a.percentual) }), ' dos votos válidos')]
      : h('span', { text: 'Sem dados de votação.' }));
  return { texto, el };
}

// Mapa "quem venceu": nome, mais votado (partido) e o percentual dele em negrito.
function dicaVencedor(nome, a) {
  const v = a?.top?.[0];
  const texto = v ? `${nome}. Mais votado: ${titulo(v.nome)} (${v.partido}), ${numero(v.votos)} votos, ${pct(v.percentual)} dos votos válidos` : `${nome}. Sem dados de votação`;
  const el = h('div', { class: 'tt-dens' },
    h('strong', { text: nome }),
    v ? [h('span', {}, amostraPartido(v.partido), ` ${titulo(v.nome)} · ${v.partido}`),
      h('span', {}, h('strong', { class: 'tt-pct', text: pct(v.percentual) }), ` · ${numero(v.votos)} votos`)]
      : h('span', { text: 'Sem dados de votação.' }));
  return { texto, el };
}

// Quadradinho na cor do partido (legenda, tooltip e lista dos mais votados) ou de um lado do duelo.
function amostraCor(cor) {
  const el = h('span', { class: 'cor-partido', 'aria-hidden': 'true' });
  el.style.setProperty('--partido', cor);
  return el;
}
const amostraPartido = sigla => amostraCor(corPartido(sigla));

// ---------------------------------------------------------------------------------------------
// Duelo. Cada área traz os números do 1º candidato (votos, validos, percentual) e os do 2º em b.

// Junta os dados dos dois candidatos (áreas do Brasil/estado ou locais de votação do município).
function juntarDuelo(da, db, nivel) {
  const zero = { votos: 0, validos: 0, percentual: 0 };
  if (nivel === 'municipio') {
    const doB = new Map(db.locais.map(l => [l.id, l]));
    return { ...da, duelo: true, locais: da.locais.map(l => { const o = doB.get(l.id) || zero; return { ...l, b: { votos: o.votos, validos: o.validos, percentual: o.percentual } }; }) };
  }
  const areas = {};
  for (const [id, a] of Object.entries(da.areas)) areas[id] = { ...a, b: db.areas[id] || zero };
  return { areas, max: da.max, duelo: true };
}

const vantagem = a => a.percentual - a.b.percentual;
const semVotos = a => !a.votos && !a.b.votos;

// Escala da vantagem: de 0 ao percentil 95 das diferenças (mesma regra do mapa de um candidato).
function escalaDuelo(lista) {
  const difs = lista.filter(a => a && !semVotos(a)).map(a => ({ votos: 1, percentual: Math.abs(vantagem(a)) }));
  return escalaDensidade(difs, Math.max(0, ...difs.map(d => d.percentual)));
}

// { classe, lado }: lado 0 = 1º candidato à frente, 1 = o 2º; empate e "sem votos" não têm lado.
function classeDuelo(a, topo) {
  if (!a || (!a.validos && !a.b.validos)) return { classe: 'cor-sem' };
  if (semVotos(a)) return { classe: 'dens-0' };
  const d = vantagem(a);
  if (Math.abs(d) < 1e-9) return { classe: 'mapa-empate' };
  return { classe: `dens-${Math.min(FAIXAS, Math.max(1, Math.ceil((Math.abs(d) / topo) * FAIXAS)))}`, lado: d > 0 ? 0 : 1 };
}

// Atalhos de cargo do mapa "quem venceu" (só os que existem na UF: Distrital só no DF).
const ROTULO_CURTO = { presidente: 'Presidente', governador: 'Governador', deputado_federal: 'Dep. Federal', deputado_estadual: 'Dep. Estadual', deputado_distrital: 'Dep. Distrital' };
function cargosRapidos(uf) {
  return contexto.config.cargos.filter(c => ROTULO_CURTO[c.id] && (!c.somente || c.somente.includes(uf)) && (!c.exceto || !c.exceto.includes(uf)));
}

// Candidato do filtro, se valer para o cargo e a UF do mapa (números se repetem entre estados).
// Na comparação é o candidato principal (o que os filtros seguem).
function candidatoDoMapa(cargo) {
  const c = candidatoPrincipal();
  if (!c || !estado.cand || !cargo || c.cargo !== cargo.id) return null;
  if (c.uf !== 'BR' && c.uf !== estado.uf) return null;
  return c;
}

// Duelo: o outro candidato, se ele tem votos neste mapa (no Brasil, só Presidente).
function rivalDoMapa(cand, nivel) {
  const par = cand && emDuelo();
  if (!par) return null;
  const r = par[0] === cand ? par[1] : par[0];
  const cargo = contexto.config.cargos.find(c => c.id === r.cargo);
  if (!cargo || (nivel === 'brasil' ? !cargo.nacional : r.uf !== 'BR' && r.uf !== estado.uf)) return null;
  return r;
}

// Retângulo que envolve um caminho SVG (só comandos M/L/Z com pares x y, como os gerados).
function caixa(d) {
  const n = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i + 1 < n.length; i += 2) {
    if (n[i] < x0) x0 = n[i]; if (n[i] > x1) x1 = n[i];
    if (n[i + 1] < y0) y0 = n[i + 1]; if (n[i + 1] > y1) y1 = n[i + 1];
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

let instancias = 0; // ids únicos (clip-path) quando há dois mapas na página

// Busca de cidade sem diferenciar acentos e maiúsculas ("sao paulo" acha "São Paulo").
const semAcento = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');

// Momento da última rolagem da página: a roda do mouse que vinha rolando a página e "passa" por
// cima do mapa continua rolando a página, em vez de virar zoom de repente.
let ultimaRolagem = 0;
globalThis.addEventListener?.('scroll', () => { ultimaRolagem = performance.now(); }, { passive: true });
const semAnimacao = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// abrirCidade: clicar (ou aproximar) num município abre o mapa por zona/local (página inicial).
// Na aba Mapa é false: o clique só seleciona o município.
export function criarPaginaMapa(raiz, { abrirCidade = true } = {}) {
  const instancia = ++instancias;
  const titulo1 = h('h2');
  const subtitulo = h('p', { class: 'recorte-sub' });
  const voltar = h('button', { type: 'button', class: 'botao-secundario', hidden: true }, icone('voltar'), h('span'));
  const modoSel = h('div', { class: 'segmentado modo-mapa', role: 'radiogroup', 'aria-label': 'Dividir o mapa do município por', hidden: true });
  // Comparação com candidatos de estados diferentes: qual dos dois o mapa (e os filtros) mostra.
  const focoSel = h('div', { class: 'foco-mapa', hidden: true });
  const area = h('div', { class: 'mapa-area' });
  const ajuda = h('p', { class: 'mapa-dica', hidden: true, text: 'Role sobre o mapa (ou use + e −) para aproximar: chegando perto, o estado ou a cidade abre sozinho. Arraste para mover.' });
  const leg = h('div', { class: 'mapa-legenda' });
  const tabela = h('div', { class: 'mapa-tabela' });
  const painel = h('div', { class: 'mapa-painel-conteudo' });
  let focarMapa = null; // aproxima o mapa do estado numa cidade (definido a cada desenho)
  let cidadeBuscada = ''; // cidade escolhida na caixa: o mapa volta a aproximar dela ao redesenhar (outro cargo/turno)
  const cidade = criarBuscaCidade();

  // Aba Mapa sem candidato: como interagir com o mapa (some quando há candidato no filtro).
  const guia = h('ol', { class: 'mapa-guia', 'aria-label': 'Como usar o mapa', hidden: true },
    [
      'Clique em um estado para abrir o mapa dele.',
      'Escolha um cargo para colorir cada cidade pelo partido do mais votado.',
      'Clique em uma cidade (ou busque no campo Cidade) para ver o ranking.',
      'Ou busque um candidato para ver onde teve votos.',
    ].map((t, i) => h('li', {}, h('b', { 'aria-hidden': 'true', text: String(i + 1) }), h('span', { text: t }))));
  const lateral = h('aside', { class: 'cartao mapa-painel', 'aria-live': 'polite' }, painel);
  const layout = h('div', { class: 'mapa-layout' },
    h('section', { class: 'cartao mapa-cartao' },
      h('div', { class: 'cartao-topo' }, h('div', {}, titulo1, subtitulo), cidade.raiz, voltar, modoSel, focoSel),
      area, ajuda, leg, tabela),
    lateral);
  limpar(raiz, h('div', { class: 'pagina-conteudo' }, guia, layout));

  let seq = 0;
  let dePorId = new Map(); // id (UF, município ou local) -> contorno, para desenhar a seleção
  let apagaveis = new Map(); // caminho de zona -> id da zona (as outras zonas se apagam ao escolher uma)
  let camadaSelecao = null; // contorno do item escolhido (na camada de cima)
  let atual = null; // { nivel, modo, cand, cargo, itens, areas } do último desenho
  let atualCand = null;
  let modo = null; // mapa do município: 'zonas' | 'locais' (null = automático)
  // Troca de nível feita pelo zoom: { de } = id do lugar de onde se saiu (o novo mapa começa nele).
  let porZoom = null, chegada = null;
  let cargoVenc = ''; // mapa "quem venceu": cargo escolhido nos atalhos (vazio = mapa neutro)
  let turnoVenc = '1'; // e o turno (2º só para Presidente e Governador, onde houve)
  let duelo = null; // { lados: [1º, 2º candidato], cores, cargos } quando o mapa compara os dois
  const POR_VEZ = 10; // mais votados mostrados por vez no painel ("Ver mais" mostra outros 10)
  const trocarPorZoom = (mudanca, de = '') => { porZoom = { de }; definir(mudanca); };

  const nivelAtual = () => (!estado.uf ? 'brasil' : abrirCidade && estado.mun && contexto.config.detalhadas.includes(estado.uf) ? 'municipio' : 'uf');
  const idSelecionado = () => (atual?.nivel === 'municipio'
    ? (atual.modo === 'zonas' ? estado.zona : estado.local ? `${estado.zona}|${estado.local}` : '')
    : atual?.nivel === 'uf' ? estado.mun : '');

  // Zona escolhida: as outras zonas (um caminho cada) ficam apagadas. Município/local escolhido:
  // contorno na camada de cima (sem mexer no estilo das áreas do mapa).
  function destacarSelecao() {
    cidade.sincronizar();
    const alvo = idSelecionado();
    for (const [el, id] of apagaveis) el.classList.toggle('apagada', !!alvo && id !== alvo);
    if (!camadaSelecao) return;
    const d = apagaveis.size ? '' : (alvo && dePorId.get(alvo)) || '';
    if (d) camadaSelecao.setAttribute('d', d); else camadaSelecao.removeAttribute('d');
  }

  function aviso(texto) { limpar(painel, h('div', { class: 'aviso' }, icone('mapa'), h('p', { text: texto }))); }

  // Painel: votos do candidato no item escolhido (estado, município ou local) ou no total do mapa.
  function desenharPainel() {
    if (vencedoresAtivo()) return painelVencedores();
    if (!atual) return;
    if (atual.duelo) return painelDuelo();
    const { nivel, cand, cargo, itens, areas } = atual;
    const sel = itens.find(it => it.id === idSelecionado());
    let votos = 0, validos = 0;
    if (sel) ({ votos = 0, validos = 0 } = areas.get(sel.id) || {});
    else for (const a of areas.values()) { votos += a.votos; validos += a.validos; }
    const onde = sel ? `em ${sel.nome}` : nivel === 'brasil' ? 'no Brasil' : `em ${titulo1.textContent}`;
    const comVotos = [...areas.values()].filter(a => a.votos).length;
    const unidade = { brasil: 'estados', uf: 'municípios', municipio: atual.modo === 'zonas' ? 'zonas' : 'locais de votação' }[nivel];
    limpar(painel,
      h('span', { class: 'etiqueta', text: `${cargoDe(cargo.nome, cand)} · ${estado.turno}º turno` }),
      h('h3', { class: 'painel-titulo', text: titulo(cand.nome) }),
      h('p', { class: 'recorte-sub', text: `${cand.partido} · ${cand.numero}${cand.uf !== 'BR' ? ` · ${cand.uf}` : ''}` }),
      h('div', { class: 'painel-kpis' },
        h('div', {}, h('strong', { text: numero(votos) }), h('span', { text: `votos ${onde}` })),
        h('div', {}, h('strong', { text: pct(validos ? (votos / validos) * 100 : 0) }), h('span', { text: 'dos votos válidos' }))),
      sel?.detalhe ? h('p', { class: 'recorte-sub', text: sel.detalhe }) : null,
      votos || sel ? h('p', { class: 'painel-nota', text: `Teve votos em ${numero(comVotos)} de ${numero(areas.size)} ${unidade}.` })
        : informacao(`Nenhum voto registrado para ${esteCandidato(cand)} no ${estado.turno}º turno.`),
      detalheSelecao(sel),
      // Na página inicial o cartão do candidato já está logo acima do mapa.
      estado.pagina === 'resultados' ? null : h('a', { class: 'botao-primario', href: urlPara('resultados') }, `Ver resultado d${feminino(cand) ? 'a candidata' : 'o candidato'}`));
  }

  const vencedoresAtivo = () => !abrirCidade && !atualCand && nivelAtual() === 'uf';
  // 2º turno no mapa "quem venceu": Presidente (se houve) e Governador nas UFs que tiveram.
  const temSegundo = id => (id === 'presidente' ? !!contexto.config.segundoTurnoPresidente : id === 'governador' && contexto.config.segundoTurnoGovernador.includes(estado.uf));

  // Painel do duelo: % e votos dos dois no lugar escolhido (ou no mapa todo) e quem venceu onde.
  function painelDuelo() {
    const { nivel, itens, areas } = atual;
    const [A, B] = duelo.lados;
    const sel = itens.find(it => it.id === idSelecionado());
    const soma = { a: { votos: 0, validos: 0 }, b: { votos: 0, validos: 0 } };
    const somar = a => { soma.a.votos += a.votos; soma.a.validos += a.validos; soma.b.votos += a.b.votos; soma.b.validos += a.b.validos; };
    if (sel) { const a = areas.get(sel.id); if (a) somar(a); } else for (const a of areas.values()) somar(a);
    const onde = sel ? `em ${sel.nome}` : nivel === 'brasil' ? 'no Brasil' : `em ${titulo1.textContent}`;
    let frenteA = 0, frenteB = 0;
    for (const a of areas.values()) { if (semVotos(a)) continue; const d = vantagem(a); if (d > 0) frenteA++; else if (d < 0) frenteB++; }
    const unidade = { brasil: 'estados', uf: 'municípios', municipio: atual.modo === 'zonas' ? 'zonas' : 'locais de votação' }[nivel];
    const bloco = (c, x, cor) => h('div', { class: 'duelo-kpi' },
      h('span', { class: 'duelo-nome' }, amostraCor(cor), h('span', { text: titulo(c.nome) })),
      h('strong', { text: pct(x.validos ? (x.votos / x.validos) * 100 : 0) }),
      h('span', { text: `dos válidos · ${numero(x.votos)} votos` }));
    limpar(painel,
      h('span', { class: 'etiqueta', text: `Comparação · ${estado.turno}º turno` }),
      h('h3', { class: 'painel-titulo', text: `${titulo(A.nome)} × ${titulo(B.nome)}` }),
      h('p', { class: 'recorte-sub', text: sel ? `Votos ${onde}` : `Total ${onde}` }),
      h('div', { class: 'duelo-kpis' }, bloco(A, soma.a, duelo.cores[0]), bloco(B, soma.b, duelo.cores[1])),
      sel?.detalhe ? h('p', { class: 'recorte-sub', text: sel.detalhe }) : null,
      h('p', { class: 'painel-nota', text: `Dos ${numero(areas.size)} ${unidade}, ${titulo(A.nome)} ficou à frente em ${numero(frenteA)} e ${titulo(B.nome)} em ${numero(frenteB)}.` }),
      detalheSelecao(sel));
  }

  // Tooltip do duelo: % e votos de cada um e quem ficou à frente.
  function dicaDuelo(nome, a, detalhe) {
    if (!a) return dica(nome, null, detalhe);
    const [A, B] = duelo.lados;
    const d = vantagem(a);
    const frase = semVotos(a) ? 'Nenhum voto para os dois' : Math.abs(d) < 1e-9 ? 'Empate' : `${titulo((d > 0 ? A : B).nome)} à frente por ${ppCurto(Math.abs(d))}`;
    const linha = (c, x, cor) => h('span', { class: 'tt-duelo' }, amostraCor(cor), ` ${titulo(c.nome)}: `, h('strong', { class: 'tt-pct', text: pct(x.percentual) }), ` · ${numero(x.votos)} votos`);
    const texto = [nome, detalhe, `${titulo(A.nome)}: ${pct(a.percentual)}`, `${titulo(B.nome)}: ${pct(a.b.percentual)}`, frase].filter(Boolean).join('. ');
    const el = h('div', { class: 'tt-dens' },
      h('strong', { text: nome }),
      detalhe ? h('span', { class: 'tt-detalhe', text: detalhe }) : null,
      linha(A, a, duelo.cores[0]), linha(B, a.b, duelo.cores[1]),
      h('span', { class: 'tt-frase', text: frase }));
    return { texto, el };
  }

  // Legenda do duelo: uma escala na cor de cada candidato (vantagem de 0 ao topo, em p.p.).
  function legendaDuelo({ topo, teto }, unidade) {
    const [A, B] = duelo.lados;
    const fim = `${ppCurto(topo)}${teto ? ' ou mais' : ''}`;
    const rampa = (c, cor) => {
      const el = h('div', { class: 'legenda-duelo-linha' },
        h('span', { class: 'legenda-duelo-nome', text: `${titulo(c.nome)} à frente` }),
        h('div', { class: 'legenda-degraus' }, Array.from({ length: FAIXAS }, (_, i) => h('span', { class: `dens-${i + 1}` }))));
      el.style.setProperty('--partido', cor);
      return el;
    };
    return h('div', { class: 'legenda-densidade legenda-duelo', role: 'group', 'aria-label': `Legenda: em cada ${unidade}, a cor de quem teve o maior % dos votos válidos; vantagem de 0 a ${fim}` },
      h('p', { class: 'legenda-titulo', text: `Quem teve o maior % dos votos válidos em cada ${unidade}` }),
      h('div', { class: 'legenda-escala', 'aria-hidden': 'true' },
        rampa(A, duelo.cores[0]), rampa(B, duelo.cores[1]),
        h('div', { class: 'legenda-duelo-linha' }, h('span'),
          h('div', { class: 'legenda-marcas' }, h('span', { text: '0' }), h('span', { text: ppCurto(topo / 2) }), h('span', { text: fim })))),
      h('ul', { class: 'legenda legenda-extra', 'aria-hidden': 'true' },
        h('li', {}, h('span', { class: 'legenda-cor mapa-empate' }), h('span', { text: 'Empate' })),
        h('li', {}, h('span', { class: 'legenda-cor dens-0' }), h('span', { text: 'Nenhum voto' })),
        h('li', {}, h('span', { class: 'legenda-cor cor-sem' }), h('span', { text: 'Sem dados' }))),
      notaTom('Tom mais claro = maior vantagem, em pontos percentuais (p.p.) dos votos válidos.',
        'Tom mais escuro = maior vantagem, em pontos percentuais (p.p.) dos votos válidos.'));
  }

  // Tabela do duelo: % de cada um e a vantagem, da maior vantagem do 1º à maior do 2º.
  function tabelaDuelo(itens, areas, colunaNome, unidade) {
    const [A, B] = duelo.lados;
    const linhas = itens.map(it => ({ it, a: areas.get(it.id) })).filter(x => x.a && !semVotos(x.a)).sort((x, y) => vantagem(y.a) - vantagem(x.a));
    if (!linhas.length) return limpar(tabela);
    limpar(tabela, h('details', { class: 'tabela-dados' },
      h('summary', { text: `Ver como tabela (${numero(linhas.length)} ${unidade} com votos)` }),
      h('div', { class: 'tabela-rolagem tabela-alta' }, h('table', { class: 'tabela' },
        h('caption', { class: 'sr-only', text: `% dos votos válidos de ${titulo(A.nome)} e de ${titulo(B.nome)} por ${colunaNome.toLowerCase()}` }),
        h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: colunaNome }), h('th', { scope: 'col', class: 'num', text: `% ${titulo(A.nome)}` }), h('th', { scope: 'col', class: 'num', text: `% ${titulo(B.nome)}` }), h('th', { scope: 'col', class: 'num', text: 'Vantagem' }))),
        h('tbody', {}, linhas.map(({ it, a }) => {
          const d = vantagem(a);
          return h('tr', {},
            h('td', {}, it.nome, it.detalhe ? h('small', { class: 'tabela-detalhe', text: it.detalhe }) : null),
            h('td', { class: 'num', text: pct(a.percentual) }), h('td', { class: 'num', text: pct(a.b.percentual) }),
            h('td', { class: 'num', text: Math.abs(d) < 1e-9 ? 'Empate' : `${titulo((d > 0 ? A : B).nome)} +${ppCurto(Math.abs(d))}` }));
        }))))));
  }

  // Painel do mapa "quem venceu": atalhos de cargo e os mais votados do município escolhido
  // (10 por vez; "Ver mais" acrescenta outros 10 dentro de uma caixa com rolagem, sem esticar a página).
  function painelVencedores() {
    const chips = h('div', { class: 'chips-cargo', role: 'radiogroup', 'aria-label': 'Cargo do mapa' },
      cargosRapidos(estado.uf).map(c => h('button', {
        type: 'button', role: 'radio', class: 'chip-cargo', 'aria-checked': String(cargoVenc === c.id),
        onclick: () => { if (cargoVenc !== c.id) { cargoVenc = c.id; if (!temSegundo(c.id)) turnoVenc = '1'; desenhar(); } },
      }, ROTULO_CURTO[c.id])));
    // Turno: o 2º só para os cargos que tiveram 2º turno neste estado.
    const turnos = h('div', { class: 'segmentado turno-mapa', role: 'radiogroup', 'aria-label': 'Turno do mapa' },
      ['1', '2'].map(t => {
        const disp = t === '1' || (!!cargoVenc && temSegundo(cargoVenc));
        return h('button', {
          type: 'button', role: 'radio', class: 'segmento', 'aria-checked': String(turnoVenc === t), disabled: !disp || undefined,
          title: disp ? '' : cargoVenc ? 'Não houve 2º turno para este cargo neste estado' : 'Escolha um cargo',
          onclick: () => { if (turnoVenc !== t) { turnoVenc = t; desenhar(); } },
        }, `${t}º turno`);
      }));
    const partes = [h('h3', { class: 'painel-titulo', text: 'Quem venceu em cada cidade' }), chips, turnos];
    const sel = atual?.vencedores && atual.itens.find(it => it.id === estado.mun);
    const a = sel && atual.vencedores.get(sel.id);
    if (a?.ranking?.length) partes.push(rankingMunicipio(sel, a));
    else if (sel && atual?.vencedores) partes.push(informacao(`Sem votos registrados em ${sel.nome}.`));
    else if (!cargoVenc && estado.mun) {
      const nome = atual?.itens?.find(it => it.id === estado.mun)?.nome;
      if (nome) partes.push(informacao(`Escolha um cargo acima para ver os mais votados em ${nome}.`));
    }
    limpar(painel, partes);
  }

  function rankingMunicipio(sel, a) {
    const total = a.ranking.length;
    const linha = ([num, votos], i) => {
      const c = atual.candidato(num);
      return h('tr', {},
        h('td', { class: 'ranking-pos', text: `${i + 1}º` }),
        h('td', {}, h('div', { class: 'ranking-cand' }, fotoCandidato(c, 'ranking-foto'),
          h('div', { class: 'ranking-texto' },
            c.id ? h('button', { type: 'button', class: 'ranking-nome', title: `Ver o mapa d${esteCandidato(c)}`, onclick: () => definir({ cand: c.id, cargo: atual.cargo.id, turno: turnoVenc }) }, titulo(c.nome))
              : h('strong', { text: titulo(c.nome) }),
            h('small', {}, amostraPartido(c.partido), ` ${c.partido || '—'}`)))),
        h('td', { class: 'num', text: numero(votos) }),
        h('td', { class: 'num' }, h('strong', { text: pct(a.validos ? (votos / a.validos) * 100 : 0) })));
    };
    let mostrados = Math.min(POR_VEZ, total);
    const corpo = h('tbody', {}, a.ranking.slice(0, mostrados).map(linha));
    const subtitulo = h('h4', { class: 'painel-subtitulo' });
    const rolagem = h('div', { class: 'ranking-rolagem' },
      h('table', { class: 'tabela tabela-compacta tabela-ranking' },
        h('caption', { class: 'sr-only', text: `Mais votados para ${atual.cargo.nome} em ${sel.nome}, ${turnoVenc}º turno` }),
        h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: 'Pos.' }), h('th', { scope: 'col', text: 'Candidato' }), h('th', { scope: 'col', class: 'num', text: 'Votos' }), h('th', { scope: 'col', class: 'num', text: '%' }))),
        corpo));
    const mais = h('button', { type: 'button', class: 'ranking-mais' });
    const atualizar = () => {
      subtitulo.textContent = `${sel.nome} · ${mostrados === total ? (total === 1 ? 'único votado' : `todos os ${numero(total)} votados`) : `${mostrados} mais votados de ${numero(total)}`}`;
      mais.hidden = mostrados >= total;
      mais.textContent = `Ver mais (${Math.min(POR_VEZ, total - mostrados)})`;
    };
    mais.onclick = () => {
      const de = mostrados;
      mostrados = Math.min(total, mostrados + POR_VEZ);
      corpo.append(...a.ranking.slice(de, mostrados).map((r, k) => linha(r, de + k)));
      atualizar();
      // A caixa rola até as novas linhas (a página não cresce).
      corpo.rows[de]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
    atualizar();
    return h('div', { class: 'painel-ranking' }, subtitulo, rolagem, mais);
  }

  // Legenda do mapa "quem venceu": partidos que venceram em mais municípios e o que o tom indica.
  function legendaVencedores(cargo, contagem, escala) {
    const ordem = [...contagem].sort((a, b) => b[1] - a[1]);
    return h('div', { class: 'legenda-densidade' },
      h('p', { class: 'legenda-titulo', text: `Partido do mais votado para ${cargo.nome} em cada município · ${turnoVenc}º turno` }),
      h('ul', { class: 'legenda legenda-partidos' }, ordem.map(([sigla, n]) =>
        h('li', {}, amostraPartido(sigla), h('span', { text: `${sigla || 'Sem partido'} · ${numero(n)}` })))),
      notaTom(`Tom mais claro = maior % dos votos válidos para o vencedor (escala até ${pctCurto(escala.topo)}${escala.teto ? ' ou mais' : ''}).`,
        `Tom mais escuro = maior % dos votos válidos para o vencedor (escala até ${pctCurto(escala.topo)}${escala.teto ? ' ou mais' : ''}).`));
  }

  function tabelaDados(cand, itens, areas, colunaNome, unidade) {
    const linhas = itens.map(it => ({ it, a: areas.get(it.id) })).filter(x => x.a?.votos).sort((x, y) => y.a.percentual - x.a.percentual);
    if (!linhas.length) return limpar(tabela);
    limpar(tabela, h('details', { class: 'tabela-dados' },
      h('summary', { text: `Ver como tabela (${numero(linhas.length)} ${unidade} com votos)` }),
      h('div', { class: 'tabela-rolagem tabela-alta' }, h('table', { class: 'tabela' },
        h('caption', { class: 'sr-only', text: `Votos de ${titulo(cand.nome)} por ${colunaNome.toLowerCase()}` }),
        h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: colunaNome }), h('th', { scope: 'col', class: 'num', text: 'Votos' }), h('th', { scope: 'col', class: 'num', text: '% válidos' }))),
        h('tbody', {}, linhas.map(({ it, a }) => h('tr', {},
          h('td', {}, it.nome, it.detalhe ? h('small', { class: 'tabela-detalhe', text: it.detalhe }) : null),
          h('td', { class: 'num', text: numero(a.votos) }), h('td', { class: 'num', text: pct(a.percentual) }))))))));
  }

  async function desenhar() {
    const minha = ++seq;
    const nivel = nivelAtual();
    chegada = porZoom; porZoom = null;
    const cargo = contexto.config.cargos.find(c => c.id === estado.cargo);
    const cand = candidatoDoMapa(cargo);
    atualCand = cand;
    const rival = rivalDoMapa(cand, nivel);
    duelo = rival ? { lados: [cand, rival], cores: coresDuelo(cand, rival), cargos: [cargo, contexto.config.cargos.find(c => c.id === rival.cargo)] } : null;
    // Estados diferentes: botões para escolher qual dos dois o mapa mostra (os filtros seguem).
    const ca = candidatoA(), cb = candidatoB();
    focoSel.hidden = !(ca && cb && !compativeis(ca, cb));
    if (!focoSel.hidden) {
      limpar(focoSel, h('span', { class: 'campo-rotulo', text: 'Mapa de' }),
        h('div', { class: 'segmentado modo-mapa', role: 'radiogroup', 'aria-label': 'Candidato do mapa' },
          [[ca, ''], [cb, '2']].map(([c, f]) => h('button', {
            type: 'button', role: 'radio', class: 'segmento', 'aria-checked': String(estado.foco === f),
            onclick: () => { if (estado.foco !== f) definir({ foco: f }); },
          }, `${titulo(c.nome)} (${c.uf})`))));
    }
    // Escala de densidade na cor do partido do candidato.
    if (cand) layout.style.setProperty('--partido', corPartido(cand.partido)); else layout.style.removeProperty('--partido');
    const venc = vencedoresAtivo();
    const cargoV = venc && cargoVenc ? cargosRapidos(estado.uf).find(c => c.id === cargoVenc) : null;
    if (turnoVenc === '2' && !(cargoV && temSegundo(cargoV.id))) turnoVenc = '1'; // outro estado/cargo sem 2º turno
    if (nivel !== 'municipio') modoSel.hidden = true;
    const nomeUf = contexto.config.ufs.find(u => u.sigla === estado.uf)?.nome || estado.uf;
    // Voltar: do município para o estado; do estado para o Brasil (não para candidato estadual,
    // cujo número só vale na UF dele, nem no duelo de Presidente com candidato estadual).
    voltar.hidden = nivel === 'brasil' || (nivel === 'uf' && !!cand && (!cargo.nacional || (!!rival && rival.uf !== 'BR')));
    voltar.lastChild.textContent = nivel === 'municipio' ? nomeUf : 'Brasil';
    voltar.onclick = () => definir(nivel === 'municipio' ? { mun: '' } : { uf: '' });
    titulo1.textContent = nivel === 'brasil' ? 'Brasil' : nomeUf;
    // Carregando: indicador do tamanho do mapa (as linhas de "esqueleto" encolhiam no centro da área).
    const ondeCarrega = nivel === 'municipio' ? 'da cidade' : nivel === 'brasil' ? 'do Brasil' : `de ${nomeUf}`;
    limpar(area, h('div', { class: 'mapa-carregando', role: 'status' },
      h('span', { class: 'mapa-carregando-giro', 'aria-hidden': 'true' }),
      h('span', { text: `Carregando o mapa ${ondeCarrega}…` })));
    ajuda.hidden = true;
    limpar(leg); limpar(tabela);
    atual = null;
    dePorId = new Map();
    apagaveis = new Map();
    camadaSelecao = null;
    const unidadeNome = { brasil: 'estado', uf: 'município', municipio: 'local de votação' }[nivel];
    const cliqueMun = abrirCidade ? 'um município para ver os locais de votação' : 'um município';
    const clique = nivel === 'municipio' ? 'Clique em um local.' : `Clique em ${nivel === 'brasil' ? 'um estado' : cliqueMun}.`;
    subtitulo.textContent = !cand ? ''
      : duelo ? `${titulo(cand.nome)} × ${titulo(rival.nome)}: quem teve o maior % dos votos válidos em cada ${unidadeNome} · ${estado.turno}º turno. ${clique}`
      : `Densidade de votos de ${titulo(cand.nome)} por ${unidadeNome} · ${estado.turno}º turno. ${clique}`;
    // Sem candidato: só o mapa, sem textos repetindo "busque um candidato" e sem o painel lateral
    // (na aba Mapa, dentro de um estado, o painel traz os atalhos do mapa "quem venceu").
    guia.hidden = abrirCidade || !!cand;
    // Caixa "Cidade": só na aba Mapa, num estado, sem candidato (com candidato, os filtros têm o município).
    cidade.raiz.hidden = !venc;
    cidade.definirCidades([]);
    focarMapa = null;
    lateral.hidden = !cand && !venc;
    layout.classList.toggle('sem-painel', !cand && !venc);
    if (venc) painelVencedores();
    else if (!cand) limpar(painel);
    else if (nivel === 'brasil' && !cargo.nacional) aviso(`Escolha um estado no mapa para ver os votos de ${titulo(cand.nome)}.`);
    else limpar(painel, esqueleto(4));
    try {
      const porCandidato = (c, cg) => (nivel === 'municipio'
        ? api('/api/mapa/locais', { cargo: cg.id, turno: estado.turno, uf: estado.uf, mun: estado.mun, numero: c.numero })
        : api('/api/mapa/candidato', { cargo: cg.id, turno: estado.turno, uf: estado.uf, numero: c.numero }));
      const pedir = cargoV ? api('/api/mapa/vencedores', { cargo: cargoV.id, turno: turnoVenc, uf: estado.uf }).catch(e => ({ falha: e }))
        : !cand || (nivel === 'brasil' && !cargo.nacional) ? Promise.resolve(null)
        : (duelo
          ? Promise.all([porCandidato(cand, cargo), porCandidato(rival, duelo.cargos[1])]).then(([x, y]) => juntarDuelo(x, y, nivel))
          : porCandidato(cand, cargo)).catch(e => ({ falha: e }));
      const [malha, dens] = await Promise.all([nivel === 'brasil' ? api('/api/mapa/brasil') : api('/api/mapa/uf', { uf: estado.uf }), pedir]);
      if (minha !== seq) return;
      const ok = dens && !dens.falha;
      const svg = nivel === 'municipio' ? desenharMunicipio(malha, ok ? dens : null)
        : desenharAreas(nivel, malha, ok && !cargoV ? dens : null, ok && cargoV ? dens : null);
      if (!svg) return;
      limpar(area, svg);
      ajuda.hidden = !cand || !svg.classList.contains('mapa-pilha');
      // Sem candidato: o município escolhido (clique ou caixa "Cidade") tem contorno mesmo sem cargo.
      if (venc) {
        atual = { nivel, itens: svg.itens };
        cidade.definirCidades(svg.itens);
        if (cidadeBuscada && cidadeBuscada === estado.mun) focarMapa?.(cidadeBuscada);
      }
      destacarSelecao();
      if (dens?.falha) {
        const e = dens.falha;
        limpar(painel, e.status === 400 || e.status === 404 ? informacao(e.message) : erro(e.message, () => { chaveMapa = ''; desenhar(); }));
        return;
      }
      if (!ok) return;
      if (cargoV) {
        atual = { nivel, cargo: cargoV, itens: svg.itens, vencedores: svg.vencedores, candidato: dens.candidato };
        subtitulo.textContent = 'Clique em um município para ver os mais votados.';
        limpar(leg, legendaVencedores(cargoV, svg.contagem, svg.escala));
        destacarSelecao();
        painelVencedores();
        return;
      }
      atual = { nivel, modo: svg.modo, cand, cargo, itens: svg.itens, areas: svg.areas, duelo: !!dens.duelo };
      destacarSelecao();
      limpar(leg, dens.duelo ? legendaDuelo(svg.escala, svg.unidade || unidadeNome) : legenda(titulo(cand.nome), svg.escala, svg.unidade || unidadeNome, cand), svg.nota || null);
      const porZona = svg.modo === 'zonas';
      const colunaNome = { brasil: 'Estado', uf: 'Município', municipio: porZona ? 'Zona' : 'Local de votação' }[nivel];
      const unidadeTabela = { brasil: 'estados', uf: 'municípios', municipio: porZona ? 'zonas' : 'locais' }[nivel];
      if (dens.duelo) tabelaDuelo(svg.itens, svg.areas, colunaNome, unidadeTabela);
      else tabelaDados(cand, svg.itens, svg.areas, colunaNome, unidadeTabela);
      desenharPainel();
    } catch (e) {
      if (minha === seq) limpar(area, erro(e.message, () => { chaveMapa = ''; desenhar(); }));
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Desenho leve (pensado para cidades com milhares de áreas, como a capital paulista):
  //  • "pilha" de dois SVGs: o mapa colorido fica numa camada própria do navegador (will-change),
  //    pintada uma vez; o destaque do mouse e a seleção ficam num SVG fino por cima. Passar o
  //    mouse só repinta essa camada de cima, nunca as milhares de áreas.
  //  • um só conjunto de eventos e no máximo um processamento por quadro (requestAnimationFrame);
  //  • no município, o "o que está sob o mouse" é calculado (local de votação mais próximo = a
  //    área de Voronoi que contém o ponto), sem o navegador testar forma por forma, e as áreas
  //    são agrupadas num caminho por zona (modo zonas) ou por cor (modo locais).

  // corte/dCorte: recorte pelo contorno do município (o destaque não vaza para fora da cidade).
  function pilha(viewBox, base, classe, corte, dCorte) {
    const camadas = h('svg:g', corte ? { 'clip-path': `url(#${corte}-t)` } : {});
    const topo = h('svg:svg', { viewBox, class: 'mapa-topo', 'aria-hidden': 'true', focusable: 'false' },
      corte ? h('svg:defs', {}, h('svg:clipPath', { id: `${corte}-t` }, h('svg:path', { d: dCorte }))) : null,
      camadas);
    const el = h('div', { class: `mapa-pilha ${classe || ''}` }, base, topo);
    return { el, camadas };
  }

  // Zoom: roda do mouse (no ponto do cursor), arrastar para mover, pinça no toque e botões + / −.
  // Muda o viewBox das duas camadas da pilha, então o desenho continua nítido em qualquer zoom.
  // O mapa troca de nível sozinho: aproximar bastante de um estado ou município abre esse lugar
  // (entrar) e afastar além do mapa inteiro volta ao nível de cima (sair).
  //   entrar(clientX, clientY, caixaVisivel) -> true se trocou de nível
  //   inicial: caixa de onde o zoom começa (ao voltar de um nível, parte do lugar de onde se saiu)
  function ampliar(el, viewBox, { entrar, sair, maximo = 40, inicial }) {
    const svgs = [...el.querySelectorAll(':scope > svg')];
    const [x0, y0, w0, h0] = viewBox.split(/\s+/).map(Number);
    const vb = { x: x0, y: y0, w: w0, h: h0 };
    let quadro = 0, animacao = 0, trocou = false, afastar = 0, moveu = false, inicio = null;
    let usou = !!chegada; // só volta de nível ao afastar quem já está navegando pelo zoom
    const ponteiros = new Map();
    const z = () => w0 / vb.w;

    const botao = (rotulo, texto, acao) => h('button', { type: 'button', class: 'mapa-zoom-botao', 'aria-label': rotulo, title: rotulo, onclick: acao }, texto);
    const mais = botao('Aproximar', '+', () => { const [cx, cy] = centro(), alvo = caixaZoom(cx, cy, 1.8); usou = true; animarPara(alvo); tentarEntrar(cx, cy, alvo); });
    const menos = botao('Afastar', '−', () => {
      if (z() <= 1.001) { usou = true; tentarSair(); return; }
      const [cx, cy] = centro(); animarPara(caixaZoom(cx, cy, 1 / 1.8));
    });
    const tudo = botao('Ver o mapa inteiro', '⤢', () => animarPara({ x: x0, y: y0, w: w0, h: h0 }));
    el.append(h('div', { class: 'mapa-zoom' }, mais, menos, tudo));

    function aplicar() {
      quadro = 0;
      const texto = `${vb.x.toFixed(2)} ${vb.y.toFixed(2)} ${vb.w.toFixed(2)} ${vb.h.toFixed(2)}`;
      for (const s of svgs) s.setAttribute('viewBox', texto);
      el.style.setProperty('--z', z().toFixed(3)); // rótulos mantêm o tamanho na tela (css)
      el.classList.toggle('ampliado', z() > 1.001);
      menos.disabled = z() <= 1.001 && !sair;
      tudo.hidden = z() <= 1.001;
    }
    const agendar = () => { if (!quadro) quadro = requestAnimationFrame(aplicar); };
    function animarPara(alvo, ms = 280) {
      cancelAnimationFrame(animacao);
      if (semAnimacao()) ms = 0;
      const de = { ...vb };
      let t0 = null;
      const passo = t => {
        // O tempo conta do 1º quadro: o horário do quadro pode ser anterior a quando a animação foi
        // pedida (depois de desenhar um mapa grande), o que daria progresso negativo.
        t0 ??= t;
        const p = ms ? Math.min(1, Math.max(0, (t - t0) / ms)) : 1, e = 1 - (1 - p) ** 3;
        for (const k of ['x', 'y', 'w', 'h']) vb[k] = de[k] + (alvo[k] - de[k]) * e;
        aplicar();
        if (p < 1) animacao = requestAnimationFrame(passo);
      };
      animacao = requestAnimationFrame(passo);
    }
    // Tela -> coordenadas do mapa (preserveAspectRatio "meet": o desenho fica centrado na caixa).
    function ponto(cx, cy) {
      const r = svgs[0].getBoundingClientRect();
      const k = Math.min(r.width / vb.w, r.height / vb.h);
      return { x: vb.x + (cx - r.left - (r.width - vb.w * k) / 2) / k, y: vb.y + (cy - r.top - (r.height - vb.h * k) / 2) / k, k };
    }
    const centro = () => { const r = svgs[0].getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
    // O centro da vista nunca sai do mapa; no zoom mínimo, o mapa inteiro.
    function limitar(c) {
      c.w = Math.min(w0, Math.max(w0 / maximo, c.w)); c.h = (c.w * h0) / w0;
      if (c.w >= w0 - 1e-6) return Object.assign(c, { x: x0, y: y0 });
      c.x = Math.min(x0 + w0 - c.w / 2, Math.max(x0 - c.w / 2, c.x));
      c.y = Math.min(y0 + h0 - c.h / 2, Math.max(y0 - c.h / 2, c.y));
      return c;
    }
    // Caixa depois de um zoom de fator f em volta do ponto da tela (cx, cy): o ponto fica parado.
    function caixaZoom(cx, cy, f) {
      const p = ponto(cx, cy);
      const w = Math.min(w0, Math.max(w0 / maximo, vb.w / f)), g = vb.w / w;
      return limitar({ x: p.x - (p.x - vb.x) / g, y: p.y - (p.y - vb.y) / g, w });
    }
    function tentarEntrar(cx, cy, caixaNova) {
      if (!trocou && entrar && entrar(cx, cy, caixaNova)) trocou = true;
    }
    function tentarSair() {
      if (!trocou && sair) { trocou = true; sair(); }
    }

    el.addEventListener('wheel', e => {
      if (performance.now() - ultimaRolagem < 350) return; // a página estava rolando: continua
      if (trocou) { e.preventDefault(); return; }
      // deltaMode: 0 pixels, 1 linhas, 2 páginas; ctrl + roda = pinça do touchpad (deltas pequenos).
      const passo = e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 400 : 1) * (e.ctrlKey ? 5 : 1);
      const f = Math.exp(-passo * 0.0022);
      if (f < 1 && z() <= 1.001) {
        if (!sair || !usou) return; // nada a afastar: a roda volta a rolar a página
        e.preventDefault();
        afastar += -Math.log(f);
        if (afastar > 0.6) tentarSair();
        return;
      }
      e.preventDefault();
      cancelAnimationFrame(animacao);
      afastar = 0;
      if (f > 1) usou = true;
      Object.assign(vb, caixaZoom(e.clientX, e.clientY, f));
      agendar();
      if (f > 1) tentarEntrar(e.clientX, e.clientY, vb);
    }, { passive: false });

    // Arrastar (com zoom) e pinça (dois dedos).
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.target.closest('.mapa-zoom')) return;
      ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ponteiros.size === 1) { inicio = { x: e.clientX, y: e.clientY }; moveu = false; }
    });
    el.addEventListener('pointermove', e => {
      const antes = ponteiros.get(e.pointerId);
      if (!antes) return;
      if (ponteiros.size === 2) {
        const [a, b] = [...ponteiros.values()];
        const d0 = Math.hypot(a.x - b.x, a.y - b.y);
        ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [c, d] = [...ponteiros.values()];
        const d1 = Math.hypot(c.x - d.x, c.y - d.y), mx = (c.x + d.x) / 2, my = (c.y + d.y) / 2;
        if (d0 > 0) {
          usou = true; moveu = true;
          Object.assign(vb, caixaZoom(mx, my, d1 / d0)); agendar();
          if (d1 > d0) tentarEntrar(mx, my, vb);
        }
        return;
      }
      ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (z() <= 1.001) return; // sem zoom não há o que mover
      if (!moveu && Math.hypot(e.clientX - inicio.x, e.clientY - inicio.y) < 5) return;
      if (!moveu) { moveu = true; el.setPointerCapture(e.pointerId); cancelAnimationFrame(animacao); }
      const k = ponto(0, 0).k;
      Object.assign(vb, limitar({ x: vb.x - (e.clientX - antes.x) / k, y: vb.y - (e.clientY - antes.y) / k, w: vb.w }));
      agendar();
    });
    const soltar = e => ponteiros.delete(e.pointerId);
    el.addEventListener('pointerup', soltar);
    el.addEventListener('pointercancel', soltar);
    // Depois de arrastar, soltar o botão não conta como clique na área embaixo do cursor.
    el.addEventListener('click', e => { if (moveu) { moveu = false; e.stopPropagation(); } }, true);

    // Aproxima até a caixa b (a cidade buscada): no centro, ocupando ~1/3 da vista, no máximo 8x.
    function focar(b) {
      const lado = Math.max(b.w, b.h * (w0 / h0));
      const w = Math.min(w0, Math.max(lado * 3, w0 / Math.min(8, maximo)));
      const hh = (w * h0) / w0;
      animarPara(limitar({ x: b.x0 + b.w / 2 - w / 2, y: b.y0 + b.h / 2 - hh / 2, w }), 450);
    }

    aplicar();
    // Voltando de um nível: começa no lugar de onde se saiu e afasta até o mapa inteiro.
    if (inicial) {
      const pad = Math.max(inicial.w, inicial.h * (w0 / h0)) * 0.15;
      Object.assign(vb, limitar({ x: inicial.x0 - pad, y: inicial.y0 - pad, w: Math.max(inicial.w, inicial.h * (w0 / h0)) + 2 * pad }));
      aplicar();
      animarPara({ x: x0, y: y0, w: w0, h: h0 }, 550);
    }
    return { focar };
  }

  // Caixa "Cidade" (aba Mapa, sem candidato): combobox com as cidades do estado, buscando sem acento.
  // Escolher = o mesmo que clicar no município (contorno e mais votados), e o mapa aproxima dele.
  function criarBuscaCidade() {
    const id = `cidade-${instancia}`;
    let cidades = [], itens = [], ativo = -1;
    const lista = h('ul', { id: `${id}-lista`, class: 'combo-lista', role: 'listbox', 'aria-label': 'Cidades', hidden: true });
    const entrada = h('input', {
      id: `${id}-busca`, class: 'controle controle-busca', type: 'text', autocomplete: 'off', spellcheck: 'false',
      placeholder: 'Buscar cidade', role: 'combobox', 'aria-expanded': 'false', 'aria-controls': lista.id, 'aria-autocomplete': 'list', maxlength: '60',
    });
    const limparBtn = h('button', {
      type: 'button', class: 'botao-icone mapa-cidade-limpar', 'aria-label': 'Tirar a cidade escolhida', title: 'Tirar a cidade', hidden: true,
      onclick: () => { entrada.value = ''; cidadeBuscada = ''; definir({ mun: '' }); entrada.focus(); },
    }, icone('fechar'));
    const fechar = () => { lista.hidden = true; entrada.setAttribute('aria-expanded', 'false'); entrada.removeAttribute('aria-activedescendant'); ativo = -1; };
    const nomeEscolhido = () => cidades.find(c => c.id === estado.mun)?.nome || '';
    const escolher = c => {
      fechar();
      entrada.value = c.nome;
      cidadeBuscada = c.id;
      if (estado.mun !== c.id) definir({ mun: c.id });
      focarMapa?.(c.id);
    };
    const marcar = i => {
      ativo = i;
      [...lista.children].forEach((li, j) => li.setAttribute('aria-selected', String(j === i)));
      if (lista.children[i]) { lista.children[i].scrollIntoView({ block: 'nearest' }); entrada.setAttribute('aria-activedescendant', lista.children[i].id); }
    };
    // Lista: as que começam com o texto primeiro, depois as que o contêm. Vazio = todas.
    function filtrar() {
      const q = semAcento(entrada.value.trim());
      const comeca = [], contem = [];
      for (const c of cidades) {
        const n = c.chave.indexOf(q);
        if (n === 0) comeca.push(c); else if (n > 0) contem.push(c);
      }
      itens = [...comeca, ...contem];
      limpar(lista, itens.length ? itens.map((c, i) => h('li', {
        id: `${id}-op-${i}`, role: 'option', class: 'combo-item', 'aria-selected': 'false',
        onmousedown: e => { e.preventDefault(); escolher(c); },
      }, h('span', { text: c.nome }))) : [h('li', { class: 'combo-vazio', text: 'Nenhuma cidade encontrada.' })]);
      lista.hidden = false;
      entrada.setAttribute('aria-expanded', 'true');
      ativo = -1;
    }
    entrada.addEventListener('input', filtrar);
    entrada.addEventListener('focus', () => { if (cidades.length) { entrada.select(); filtrar(); } });
    // Saiu da caixa sem escolher: volta a mostrar a cidade escolhida (ou fica vazia).
    entrada.addEventListener('blur', () => setTimeout(() => { fechar(); entrada.value = nomeEscolhido(); }, 120));
    entrada.addEventListener('keydown', e => {
      if (e.key === 'Escape') { fechar(); return; }
      if (lista.hidden || !itens.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); marcar(Math.min(itens.length - 1, ativo + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); marcar(Math.max(0, ativo - 1)); }
      else if (e.key === 'Enter') { e.preventDefault(); escolher(itens[Math.max(0, ativo)]); }
    });
    const raiz = h('div', { class: 'campo mapa-cidade', hidden: true },
      h('label', { class: 'campo-rotulo', for: entrada.id, text: 'Cidade' }),
      h('div', { class: 'combo' }, h('span', { class: 'combo-icone' }, icone('busca')), entrada, lista, limparBtn));
    return {
      raiz,
      // Cidades do mapa desenhado (vazio enquanto carrega: a caixa fica desativada).
      definirCidades(lista_) {
        cidades = lista_.map(c => ({ ...c, chave: semAcento(c.nome) })).sort((a, b) => a.chave.localeCompare(b.chave, 'pt-BR'));
        entrada.disabled = !cidades.length;
        this.sincronizar();
      },
      // Município escolhido mudou (clique no mapa, voltar, outro estado): mostra o nome dele.
      sincronizar() {
        limparBtn.hidden = !estado.mun || !nomeEscolhido();
        if (document.activeElement !== entrada) entrada.value = nomeEscolhido();
      },
    };
  }

  // Ao aproximar: abre o lugar sob o cursor se ele já ocupa boa parte da vista.
  const ocupaVista = (d, vista) => { const b = caixa(d); return Math.max(b.w / vista.w, b.h / vista.h) >= 0.4; };

  // alvos[i] = { d (destaque), conteudo() (tooltip, criado no 1º hover), escolher() }
  // alvoEm(evento) -> índice em alvos ou -1.
  function interagir(base, camadas, alvos, alvoEm) {
    let ultimo = -1, pendente = null, quadro = 0;
    const destaque = h('svg:path', { class: 'mapa-hover' });
    const selecao = h('svg:path', { class: 'mapa-selecao' });
    camadas.append(destaque, selecao);
    const conteudo = i => (alvos[i].cache ||= alvos[i].conteudo());
    const sair = () => {
      if (quadro) { cancelAnimationFrame(quadro); quadro = 0; }
      pendente = null; ultimo = -1; destaque.removeAttribute('d'); esconderTooltip();
    };
    const processar = () => {
      quadro = 0;
      const e = pendente; pendente = null;
      if (!e) return;
      const i = alvoEm(e);
      if (i < 0) { ultimo = -1; destaque.removeAttribute('d'); esconderTooltip(); return; }
      if (i !== ultimo) { ultimo = i; destaque.setAttribute('d', alvos[i].d); }
      mostrarTooltip(e, conteudo(i));
    };
    base.addEventListener('mousemove', e => { pendente = e; if (!quadro) quadro = requestAnimationFrame(processar); });
    base.addEventListener('mouseleave', sair);
    base.addEventListener('click', e => { const i = alvoEm(e); if (i >= 0) { sair(); alvos[i].escolher(); } });
    // Teclado (as 27 UFs são focáveis): Enter/Espaço escolhe; o foco mostra o tooltip.
    base.addEventListener('keydown', e => {
      const i = alvoEm(e);
      if (i >= 0 && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); sair(); alvos[i].escolher(); }
    });
    base.addEventListener('focusin', e => { const i = alvoEm(e); if (i >= 0) { destaque.setAttribute('d', alvos[i].d); mostrarTooltip(e, conteudo(i)); } });
    base.addEventListener('focusout', sair);
    camadaSelecao = selecao;
  }

  // Brasil (UFs) ou estado (municípios): poucas centenas de áreas, uma por caminho (data-i).
  // venc: mapa "quem venceu" ({ areas: { município: { validos, top: [3 mais votados] } } }).
  function desenharAreas(nivel, malha, dens, venc) {
    const nacional = nivel === 'brasil';
    const itens = nacional ? malha.ufs.map(u => ({ id: u.uf, nome: u.nome, d: u.d, cx: u.cx, cy: u.cy })) : malha.municipios.map(m => ({ id: m.cd, nome: titulo(m.nm), d: m.d }));
    const areas = new Map(dens ? Object.entries(dens.areas) : []);
    const vencedores = venc ? new Map(Object.entries(venc.areas)) : null;
    const dueloM = !!dens?.duelo;
    // Vencedor de cada município como "área" (votos e % do 1º colocado) para usar a mesma escala.
    const doVencedor = a => (a?.top?.[0] ? { votos: a.top[0].votos, validos: a.validos, percentual: a.top[0].percentual } : null);
    const escala = dueloM ? escalaDuelo([...areas.values()])
      : dens ? escalaDensidade([...areas.values()], dens.max)
      : venc ? escalaDensidade([...vencedores.values()].map(doVencedor), Math.max(0, ...[...vencedores.values()].map(a => a.top[0]?.percentual || 0))) : null;
    const contagem = new Map(); // partido -> municípios vencidos
    const svg = h('svg:svg', { viewBox: malha.viewBox, class: 'mapa-svg', role: 'group', 'aria-label': `Mapa: ${titulo1.textContent}` });
    const grupo = h('svg:g', { class: 'mapa-areas' });
    const alvos = [];
    itens.forEach((it, i) => {
      const a = areas.get(it.id);
      const v = vencedores?.get(it.id);
      const { texto } = venc ? dicaVencedor(it.nome, v) : dueloM ? dicaDuelo(it.nome, a) : dica(it.nome, dens ? a : null);
      alvos.push({
        d: it.d,
        conteudo: () => (venc ? dicaVencedor(it.nome, v).el : dueloM ? dicaDuelo(it.nome, a).el : dens ? dica(it.nome, a).el : dica(it.nome, null).el.firstChild),
        // Aba Mapa: clicar de novo no município escolhido desfaz a seleção.
        escolher: () => (nacional ? definir({ uf: it.id }) : definir({ mun: !abrirCidade && estado.mun === it.id ? '' : it.id })),
      });
      const cd = dueloM ? classeDuelo(a, escala.topo) : null;
      const classe = venc ? classeDensidade(doVencedor(v), escala.topo) : cd ? cd.classe : dens ? classeDensidade(a, escala.topo) : 'mapa-neutro';
      const p = h('svg:path', {
        d: it.d, class: `mapa-regiao ${classe}`, 'aria-label': dens || venc ? texto : it.nome, 'data-i': i,
        // Teclado: só as 27 UFs viram paradas de Tab; municípios são escolhidos pelo filtro ou pela tabela.
        tabindex: nacional ? '0' : undefined, role: nacional ? 'button' : undefined,
      });
      // Duelo: a escala de cada área é a cor de quem ficou à frente.
      if (cd?.lado !== undefined) p.style.setProperty('--partido', duelo.cores[cd.lado]);
      // Quem venceu: a escala de cada município é a do partido do vencedor.
      const vencedor = v?.top?.[0];
      if (vencedor) {
        p.style.setProperty('--partido', corPartido(vencedor.partido));
        contagem.set(vencedor.partido, (contagem.get(vencedor.partido) || 0) + 1);
      }
      grupo.append(p);
      dePorId.set(it.id, it.d);
    });
    svg.append(grupo);
    if (nacional) svg.append(h('svg:g', { class: 'mapa-rotulos', 'aria-hidden': 'true' }, itens.map(it => h('svg:text', { x: it.cx, y: it.cy, text: it.id }))));
    const { el, camadas } = pilha(malha.viewBox, svg, chegada ? (chegada.de ? 'saida-zoom' : 'por-zoom') : '');
    interagir(svg, camadas, alvos, e => {
      const p = e.target.closest?.('[data-i]');
      return p && svg.contains(p) ? Number(p.dataset.i) : -1;
    });
    // Zoom: o estado (ou município, se o estado tem mapa por local) sob o cursor abre sozinho.
    const abreMunicipio = contexto.config.detalhadas.includes(estado.uf);
    const zoom = ampliar(el, malha.viewBox, {
      maximo: nacional ? 40 : 120,
      inicial: chegada?.de && dePorId.has(chegada.de) ? caixa(dePorId.get(chegada.de)) : null,
      sair: nacional || voltar.hidden ? null : () => trocarPorZoom({ uf: '' }, estado.uf),
      entrar: nacional || (abreMunicipio && abrirCidade) ? (cx, cy, vista) => {
        const p = document.elementFromPoint(cx, cy)?.closest?.('[data-i]');
        const it = p && svg.contains(p) ? itens[Number(p.dataset.i)] : null;
        if (!it || !ocupaVista(it.d, vista)) return false;
        trocarPorZoom(nacional ? { uf: it.id } : { mun: it.id });
        return true;
      } : null,
    });
    if (!nacional) focarMapa = id => dePorId.has(id) && zoom.focar(caixa(dePorId.get(id)));
    return Object.assign(el, { itens, areas, escala, vencedores, contagem });
  }

  // Município: áreas dos locais de votação (Voronoi, recortadas pelo contorno da cidade).
  // Modo "zonas": cada zona é UM caminho (todas as suas áreas), com fronteiras e números.
  // Modo "locais": um caminho por degrau de cor (todas as áreas daquela cor) + a malha das divisas.
  function desenharMunicipio(malha, dens) {
    const mun = malha.municipios.find(m => m.cd === estado.mun);
    const nomeMun = titulo(mun?.nm || contexto.municipios.find(m => m.cd === estado.mun)?.nm || 'Município');
    titulo1.textContent = nomeMun;
    const locais = dens?.locais || [];
    const geo = dens?.geo;
    const dueloM = !!dens?.duelo;
    // Duelo: números do 2º candidato somados do mesmo jeito (b) em cada zona e área.
    const somaB = ls => {
      const votos = ls.reduce((s, l) => s + l.b.votos, 0), validos = ls.reduce((s, l) => s + l.b.validos, 0);
      return { votos, validos, percentual: validos ? (votos / validos) * 100 : 0 };
    };
    // Totais por zona (soma dos locais = total da zona no município) e bairros de cada zona.
    const zonas = new Map();
    for (const l of locais) {
      const zn = zonas.get(l.z) || { id: String(l.z), nome: `Zona ${l.z}`, votos: 0, validos: 0, locais: [], celulas: [] };
      zn.votos += l.votos; zn.validos += l.validos; zn.locais.push(l);
      zonas.set(l.z, zn);
    }
    for (const zn of zonas.values()) {
      zn.percentual = zn.validos ? (zn.votos / zn.validos) * 100 : 0;
      if (dueloM) zn.b = somaB(zn.locais);
      zn.detalhe = `${numero(zn.locais.length)} ${zn.locais.length === 1 ? 'local' : 'locais'} · ${numero(new Set(zn.locais.map(l => l.bairro)).size)} bairros`;
    }
    const comArea = new Set();
    const celulas = geo ? geo.c.map(([ids, d]) => {
      const ls = ids.map(i => locais[i]).filter(Boolean);
      const cont = new Map();
      for (const l of ls) { cont.set(l.z, (cont.get(l.z) || 0) + 1); comArea.add(l); }
      const z = [...cont].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
      const votos = ls.reduce((s, l) => s + l.votos, 0), validos = ls.reduce((s, l) => s + l.validos, 0);
      return { d, ls, z, x: ls[0]?.x, y: ls[0]?.y, votos, validos, percentual: validos ? (votos / validos) * 100 : 0, b: dueloM ? somaB(ls) : undefined };
    }).filter(cel => cel.ls.length) : [];
    if (!modo || !['zonas', 'locais'].includes(modo)) modo = new Set(celulas.map(cel => cel.z)).size > 1 ? 'zonas' : 'locais';
    const porZona = modo === 'zonas';
    const unidade = porZona ? 'zona eleitoral' : 'local de votação';
    const cliqueMun = `Clique em ${porZona ? 'uma zona para ver os bairros' : 'um local'}.`;
    subtitulo.textContent = dueloM
      ? `${titulo(duelo.lados[0].nome)} × ${titulo(duelo.lados[1].nome)}: quem teve o maior % dos votos válidos em cada ${unidade} · ${estado.turno}º turno. ${cliqueMun}`
      : `Densidade de votos de ${titulo(atualCand?.nome || '')} por ${unidade} · ${estado.turno}º turno. ${cliqueMun}`;
    desenharModo(celulas.length > 0);
    const itens = porZona
      ? [...zonas.values()].sort((a, b) => a.locais[0].z - b.locais[0].z)
      : locais.map(l => ({ id: l.id, l, nome: titulo(l.nome), detalhe: l.bairro ? `Bairro ${titulo(l.bairro)}` : '' }));
    const areas = new Map(porZona ? itens.map(zn => [zn.id, zn]) : locais.map(l => [l.id, l]));
    const escala = dueloM ? escalaDuelo(porZona ? [...zonas.values()] : locais)
      : dens ? escalaDensidade(porZona ? [...zonas.values()] : locais, porZona ? Math.max(0, ...[...zonas.values()].map(zn => zn.percentual)) : dens.max) : null;
    // Classe (e cor, no duelo) de uma zona ou área.
    const pintar = x => {
      if (!dens) return { classe: 'mapa-neutro' };
      return dueloM ? classeDuelo(x, escala.topo) : { classe: classeDensidade(x, escala.topo) };
    };
    const conteudoDica = (nome, x, detalhe) => (dueloM ? dicaDuelo(nome, x, detalhe) : dica(nome, dens ? x : null, detalhe)).el;
    const semArea = locais.length - comArea.size;
    const nota = semArea > 0 ? h('p', { class: 'legenda-nota', text: `${numero(semArea)} ${semArea === 1 ? 'local sem localização informada pelo TSE fica' : 'locais sem localização informada pelo TSE ficam'} fora do desenho${porZona ? ' (os votos contam na zona)' : ' e aparecem só na tabela'}.` }) : null;
    const extras = { itens, areas, escala, nota, modo, zonas, unidade };
    if (!mun || !celulas.length) return Object.assign(informacao('Não há como desenhar as áreas deste município (sem contorno no IBGE ou sem localização dos locais de votação). Os votos aparecem na tabela.'), extras);

    const c = caixa(mun.d);
    const pad = Math.max(c.w, c.h) * 0.04;
    const viewBox = `${c.x0 - pad} ${c.y0 - pad} ${c.w + 2 * pad} ${c.h + 2 * pad}`;
    const corte = `corte-${instancia}-${estado.mun}`;
    const svg = h('svg:svg', { viewBox, class: 'mapa-svg mapa-municipio', role: 'img', 'aria-label': `Mapa de ${nomeMun} por ${unidade}. Os números exatos estão na tabela abaixo do mapa.` },
      h('svg:defs', {}, h('svg:clipPath', { id: corte }, h('svg:path', { d: mun.d }))));
    const grupo = h('svg:g', { class: 'mapa-areas', 'clip-path': `url(#${corte})` });
    const alvos = [];
    const alvoDaCelula = new Int32Array(celulas.length);
    const escolherZona = zn => definir(estado.zona === zn.id && !estado.local ? { zona: '', local: '', bairro: '' } : { zona: zn.id, local: '', secao: '', bairro: '' });
    const escolherLocal = l => definir(estado.local === String(l.n) && estado.zona === String(l.z) ? { zona: '', local: '', bairro: '' } : { zona: String(l.z), local: String(l.n), secao: '', bairro: '' });
    if (porZona) {
      celulas.forEach((cel, k) => zonas.get(cel.z).celulas.push(k));
      for (const zn of zonas.values()) {
        if (!zn.celulas.length) continue;
        const i = alvos.length;
        const dZona = zn.celulas.map(k => celulas[k].d).join('');
        for (const k of zn.celulas) alvoDaCelula[k] = i;
        alvos.push({ d: dZona, conteudo: () => conteudoDica(zn.nome, zn, zn.detalhe), escolher: () => escolherZona(zn) });
        const cor = pintar(zn);
        const p = h('svg:path', { d: dZona, class: `mapa-celula mapa-zona ${cor.classe}` });
        if (cor.lado !== undefined) p.style.setProperty('--partido', duelo.cores[cor.lado]);
        apagaveis.set(p, zn.id);
        grupo.append(p);
      }
      if (geo.f) grupo.append(h('svg:path', { d: geo.f, class: 'mapa-fronteira' }));
    } else {
      const porCor = new Map();
      celulas.forEach((cel, k) => {
        alvoDaCelula[k] = k;
        const nome = cel.ls.map(l => titulo(l.nome)).join(' · ');
        const detalhe = [...new Set(cel.ls.map(l => l.bairro).filter(Boolean))].map(b => `Bairro ${titulo(b)}`).join(' · ');
        alvos.push({ d: cel.d, conteudo: () => conteudoDica(nome, cel, detalhe), escolher: () => escolherLocal(cel.ls[0]) });
        for (const l of cel.ls) dePorId.set(l.id, cel.d);
        // Um caminho por cor: no duelo, a mesma classe nas duas cores são caminhos diferentes.
        const cor = pintar(cel);
        const chave = `${cor.classe}|${cor.lado ?? ''}`;
        (porCor.get(chave) || porCor.set(chave, []).get(chave)).push(cel.d);
      });
      for (const [chave, ds] of porCor) {
        const [classe, lado] = chave.split('|');
        const p = h('svg:path', { d: ds.join(''), class: `mapa-celula mapa-classe ${classe}` });
        if (lado) p.style.setProperty('--partido', duelo.cores[Number(lado)]);
        grupo.append(p);
      }
      grupo.append(h('svg:path', { d: celulas.map(cel => cel.d).join(''), class: 'mapa-malha' }));
    }
    const contorno = h('svg:path', { d: mun.d, class: 'mapa-contorno-borda' });
    svg.append(grupo, contorno);
    if (porZona) {
      // Número de cada zona no centro dos seus locais de votação desenhados.
      const rotulos = h('svg:g', { class: 'mapa-rotulos mapa-rotulos-zona', 'aria-hidden': 'true' });
      // Letra menor quando há muitas zonas (ex.: 57 na capital paulista).
      rotulos.style.setProperty('--fs', `${(Math.max(c.w, c.h) / (28 + zonas.size * 0.6)).toFixed(2)}px`);
      for (const zn of zonas.values()) {
        const pts = zn.locais.filter(l => comArea.has(l));
        if (!pts.length) continue;
        rotulos.append(h('svg:text', { x: (pts.reduce((s, l) => s + l.x, 0) / pts.length).toFixed(2), y: (pts.reduce((s, l) => s + l.y, 0) / pts.length).toFixed(2), text: zn.locais[0].z }));
      }
      svg.append(rotulos);
    }
    const { el, camadas } = pilha(viewBox, svg, `mapa-pilha-municipio ${porZona ? 'modo-zonas' : 'modo-locais'}`, corte, mun.d);
    ampliar(el, viewBox, { maximo: 40, sair: () => trocarPorZoom({ mun: '' }, estado.mun) });
    // Ponto do mouse -> coordenadas do mapa -> local de votação mais próximo (= área que o contém).
    const xs = Float64Array.from(celulas, cel => cel.x), ys = Float64Array.from(celulas, cel => cel.y);
    interagir(svg, camadas, alvos, e => {
      if (e.clientX === undefined) return -1;
      const m = svg.getScreenCTM();
      if (!m) return -1;
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
      if (contorno.isPointInFill && !contorno.isPointInFill(p)) return -1;
      let melhor = -1, dmin = Infinity;
      for (let k = 0; k < xs.length; k++) {
        const dx = xs[k] - p.x, dy = ys[k] - p.y, d2 = dx * dx + dy * dy;
        if (d2 < dmin) { dmin = d2; melhor = k; }
      }
      return melhor < 0 ? -1 : alvoDaCelula[melhor];
    });
    return Object.assign(el, extras);
  }

  // Detalhe no painel ao clicar: bairros da zona (modo zonas) ou dados do local (modo locais).
  function detalheSelecao(sel) {
    if (!sel || atual?.nivel !== 'municipio') return null;
    if (atual.modo === 'zonas') {
      const bairros = new Map();
      for (const l of sel.locais) {
        const b = bairros.get(l.bairro) || { nome: titulo(l.bairro || 'Não informado'), votos: 0, validos: 0, votosB: 0, validosB: 0, locais: 0 };
        b.votos += l.votos; b.validos += l.validos; b.locais++;
        if (l.b) { b.votosB += l.b.votos; b.validosB += l.b.validos; }
        bairros.set(l.bairro, b);
      }
      if (atual.duelo) return bairrosDuelo(sel, [...bairros.values()]);
      const linhas = [...bairros.values()].sort((a, b) => b.votos - a.votos || a.nome.localeCompare(b.nome, 'pt-BR'));
      return h('div', { class: 'painel-bairros' },
        h('h4', { class: 'painel-subtitulo', text: `Bairros da ${sel.nome} (${numero(linhas.length)})` }),
        h('div', { class: 'tabela-rolagem tabela-alta' }, h('table', { class: 'tabela tabela-compacta' },
          h('caption', { class: 'sr-only', text: `Votos de ${titulo(atual.cand.nome)} nos bairros da ${sel.nome}` }),
          h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: 'Bairro' }), h('th', { scope: 'col', class: 'num', text: 'Votos' }), h('th', { scope: 'col', class: 'num', text: '%' }))),
          h('tbody', {}, linhas.map(b => h('tr', {},
            h('td', {}, b.nome, h('small', { class: 'tabela-detalhe', text: `${b.locais} ${b.locais === 1 ? 'local' : 'locais'}` })),
            h('td', { class: 'num', text: numero(b.votos) }),
            h('td', { class: 'num' }, h('strong', { text: pct(b.validos ? (b.votos / b.validos) * 100 : 0) }))))))));
    }
    const l = sel.l;
    return h('dl', { class: 'painel-local' },
      h('dt', { text: 'Bairro' }), h('dd', { text: titulo(l.bairro || 'Não informado') }),
      l.end ? [h('dt', { text: 'Endereço' }), h('dd', { text: titulo(l.end) })] : null,
      h('dt', { text: 'Zona' }), h('dd', { text: String(l.z) }),
      h('dt', { text: `Seções (${l.secoes.length})` }), h('dd', { text: l.secoes.join(', ') }));
  }

  // Bairros da zona no duelo: % de cada um (da maior vantagem do 1º à maior do 2º).
  function bairrosDuelo(sel, lista) {
    const [A, B] = duelo.lados;
    const p = (v, t) => (t ? (v / t) * 100 : 0);
    const linhas = lista.sort((x, y) => (p(y.votos, y.validos) - p(y.votosB, y.validosB)) - (p(x.votos, x.validos) - p(x.votosB, x.validosB)) || x.nome.localeCompare(y.nome, 'pt-BR'));
    return h('div', { class: 'painel-bairros' },
      h('h4', { class: 'painel-subtitulo', text: `Bairros da ${sel.nome} (${numero(linhas.length)})` }),
      h('div', { class: 'tabela-rolagem tabela-alta' }, h('table', { class: 'tabela tabela-compacta' },
        h('caption', { class: 'sr-only', text: `% dos votos válidos de ${titulo(A.nome)} e de ${titulo(B.nome)} nos bairros da ${sel.nome}` }),
        h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: 'Bairro' }), h('th', { scope: 'col', class: 'num', text: `% ${titulo(A.nome)}` }), h('th', { scope: 'col', class: 'num', text: `% ${titulo(B.nome)}` }))),
        h('tbody', {}, linhas.map(b => h('tr', {},
          h('td', {}, b.nome, h('small', { class: 'tabela-detalhe', text: `${b.locais} ${b.locais === 1 ? 'local' : 'locais'}` })),
          h('td', { class: 'num', text: pct(p(b.votos, b.validos)) }),
          h('td', { class: 'num', text: pct(p(b.votosB, b.validosB)) })))))));
  }

  // Botões "Zonas eleitorais | Locais de votação" (só no mapa do município).
  function desenharModo(visivel) {
    modoSel.hidden = !visivel;
    limpar(modoSel, [['zonas', 'Zonas eleitorais'], ['locais', 'Locais de votação']].map(([v, rotulo]) =>
      h('button', { type: 'button', role: 'radio', class: 'segmento', 'aria-checked': String(modo === v), onclick: () => { if (modo !== v) { modo = v; desenhar(); } } }, rotulo)));
  }

  let chaveMapa = '';
  return {
    carregar() {
      const nivel = nivelAtual();
      const chave = [estado.uf, nivel === 'municipio' ? estado.mun : '', estado.cargo, estado.turno, estado.cand, estado.cand2, estado.foco].join('|');
      // Outro município (ou outro nível): a divisão volta ao automático.
      if (chave.split('|').slice(0, 2).join('|') !== chaveMapa.split('|').slice(0, 2).join('|')) modo = null;
      if (chave !== chaveMapa) { chaveMapa = chave; desenhar(); } else { porZoom = null; destacarSelecao(); desenharPainel(); }
    },
  };
}
