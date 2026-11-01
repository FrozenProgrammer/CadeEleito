// Mapa de densidade de votos do candidato filtrado, em três níveis de zoom:
//   Brasil (por estado, para Presidente) › Estado (por município) › Município (por local de votação).
// Cada área ou local é colorido pelo % dos votos válidos que o candidato recebeu ali, numa escala
// da cor do partido dele: quanto maior o percentual, mais forte a cor. Clicar em um estado aproxima
// o mapa; clicar em um município aproxima (página inicial) ou só o seleciona (aba Mapa).
// Aba Mapa, sem candidato, num estado: mapa "quem venceu" — cada município na cor do partido do
// mais votado do cargo escolhido nos atalhos ao lado, e os 3 mais votados do município clicado.

import { h, limpar, numero, pct, titulo, icone, fotoCandidato } from '../dom.js';
import { corPartido } from '../partidos.js';
import { api } from '../api.js';
import { estado, contexto, definir, urlPara } from '../estado.js';
import { mostrarTooltip, esconderTooltip } from '../grafico.js';
import { esqueleto, erro, informacao } from './comum.js';

const FAIXAS = 9; // degraus da escala sequencial (classes dens-1 … dens-9 em css/app.css)
const fmtCurto = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const pctCurto = n => `${fmtCurto.format(n)}%`;

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
function legenda(nome, { topo, teto }, unidade) {
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
    h('p', { class: 'legenda-nota', text: 'Quanto mais forte a cor, maior a parcela dos votos válidos que foi para o candidato.' }));
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

// Quadradinho na cor do partido (legenda, tooltip e lista dos mais votados).
function amostraPartido(sigla) {
  const el = h('span', { class: 'cor-partido', 'aria-hidden': 'true' });
  el.style.setProperty('--partido', corPartido(sigla));
  return el;
}

// Atalhos de cargo do mapa "quem venceu" (só os que existem na UF: Distrital só no DF).
const ROTULO_CURTO = { presidente: 'Presidente', governador: 'Governador', deputado_federal: 'Dep. Federal', deputado_estadual: 'Dep. Estadual', deputado_distrital: 'Dep. Distrital' };
function cargosRapidos(uf) {
  return contexto.config.cargos.filter(c => ROTULO_CURTO[c.id] && (!c.somente || c.somente.includes(uf)) && (!c.exceto || !c.exceto.includes(uf)));
}

// Candidato do filtro, se valer para o cargo e a UF do mapa (números se repetem entre estados).
function candidatoDoMapa(cargo) {
  const c = contexto.candidato;
  if (!c || !estado.cand || !cargo || c.cargo !== cargo.id) return null;
  if (c.uf !== 'BR' && c.uf !== estado.uf) return null;
  return c;
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
  const area = h('div', { class: 'mapa-area' });
  const ajuda = h('p', { class: 'mapa-dica', hidden: true, text: 'Role sobre o mapa (ou use + e −) para aproximar: chegando perto, o estado ou a cidade abre sozinho. Arraste para mover.' });
  const leg = h('div', { class: 'mapa-legenda' });
  const tabela = h('div', { class: 'mapa-tabela' });
  const painel = h('div', { class: 'mapa-painel-conteudo' });

  const lateral = h('aside', { class: 'cartao mapa-painel', 'aria-live': 'polite' }, painel);
  const layout = h('div', { class: 'mapa-layout' },
    h('section', { class: 'cartao mapa-cartao' },
      h('div', { class: 'cartao-topo' }, h('div', {}, titulo1, subtitulo), voltar, modoSel),
      area, ajuda, leg, tabela),
    lateral);
  limpar(raiz, h('div', { class: 'pagina-conteudo' }, layout));

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
  const POR_VEZ = 10; // mais votados mostrados por vez no painel ("Ver mais" mostra outros 10)
  const trocarPorZoom = (mudanca, de = '') => { porZoom = { de }; definir(mudanca); };

  const nivelAtual = () => (!estado.uf ? 'brasil' : abrirCidade && estado.mun && contexto.config.detalhadas.includes(estado.uf) ? 'municipio' : 'uf');
  const idSelecionado = () => (atual?.nivel === 'municipio'
    ? (atual.modo === 'zonas' ? estado.zona : estado.local ? `${estado.zona}|${estado.local}` : '')
    : atual?.nivel === 'uf' ? estado.mun : '');

  // Zona escolhida: as outras zonas (um caminho cada) ficam apagadas. Município/local escolhido:
  // contorno na camada de cima (sem mexer no estilo das áreas do mapa).
  function destacarSelecao() {
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
    const { nivel, cand, cargo, itens, areas } = atual;
    const sel = itens.find(it => it.id === idSelecionado());
    let votos = 0, validos = 0;
    if (sel) ({ votos = 0, validos = 0 } = areas.get(sel.id) || {});
    else for (const a of areas.values()) { votos += a.votos; validos += a.validos; }
    const onde = sel ? `em ${sel.nome}` : nivel === 'brasil' ? 'no Brasil' : `em ${titulo1.textContent}`;
    const comVotos = [...areas.values()].filter(a => a.votos).length;
    const unidade = { brasil: 'estados', uf: 'municípios', municipio: atual.modo === 'zonas' ? 'zonas' : 'locais de votação' }[nivel];
    limpar(painel,
      h('span', { class: 'etiqueta', text: `${cargo.nome} · ${estado.turno}º turno` }),
      h('h3', { class: 'painel-titulo', text: titulo(cand.nome) }),
      h('p', { class: 'recorte-sub', text: `${cand.partido} · ${cand.numero}${cand.uf !== 'BR' ? ` · ${cand.uf}` : ''}` }),
      h('div', { class: 'painel-kpis' },
        h('div', {}, h('strong', { text: numero(votos) }), h('span', { text: `votos ${onde}` })),
        h('div', {}, h('strong', { text: pct(validos ? (votos / validos) * 100 : 0) }), h('span', { text: 'dos votos válidos' }))),
      sel?.detalhe ? h('p', { class: 'recorte-sub', text: sel.detalhe }) : null,
      votos || sel ? h('p', { class: 'painel-nota', text: `Teve votos em ${numero(comVotos)} de ${numero(areas.size)} ${unidade}.` })
        : informacao(`Nenhum voto registrado para este candidato no ${estado.turno}º turno.`),
      detalheSelecao(sel),
      // Na página inicial o cartão do candidato já está logo acima do mapa.
      estado.pagina === 'resultados' ? null : h('a', { class: 'botao-primario', href: urlPara('resultados') }, 'Ver resultado do candidato'));
  }

  const vencedoresAtivo = () => !abrirCidade && !atualCand && nivelAtual() === 'uf';

  // Painel do mapa "quem venceu": atalhos de cargo e os mais votados do município escolhido
  // (10 por vez; "Ver mais" acrescenta outros 10 dentro de uma caixa com rolagem, sem esticar a página).
  function painelVencedores() {
    const chips = h('div', { class: 'chips-cargo', role: 'radiogroup', 'aria-label': 'Cargo do mapa' },
      cargosRapidos(estado.uf).map(c => h('button', {
        type: 'button', role: 'radio', class: 'chip-cargo', 'aria-checked': String(cargoVenc === c.id),
        onclick: () => { if (cargoVenc !== c.id) { cargoVenc = c.id; desenhar(); } },
      }, ROTULO_CURTO[c.id])));
    const partes = [h('h3', { class: 'painel-titulo', text: 'Quem venceu em cada cidade' }), chips];
    const sel = atual?.vencedores && atual.itens.find(it => it.id === estado.mun);
    const a = sel && atual.vencedores.get(sel.id);
    if (a?.ranking?.length) partes.push(rankingMunicipio(sel, a));
    else if (sel && atual?.vencedores) partes.push(informacao(`Sem votos registrados em ${sel.nome}.`));
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
            c.id ? h('button', { type: 'button', class: 'ranking-nome', title: 'Ver o mapa deste candidato', onclick: () => definir({ cand: c.id, cargo: atual.cargo.id, turno: '1' }) }, titulo(c.nome))
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
        h('caption', { class: 'sr-only', text: `Mais votados para ${atual.cargo.nome} em ${sel.nome}, 1º turno` }),
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
      h('p', { class: 'legenda-titulo', text: `Partido do mais votado para ${cargo.nome} em cada município · 1º turno` }),
      h('ul', { class: 'legenda legenda-partidos' }, ordem.map(([sigla, n]) =>
        h('li', {}, amostraPartido(sigla), h('span', { text: `${sigla || 'Sem partido'} · ${numero(n)}` })))),
      h('p', { class: 'legenda-nota', text: `Tom mais forte = maior % dos votos válidos para o vencedor (escala até ${pctCurto(escala.topo)}${escala.teto ? ' ou mais' : ''}).` }));
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
    // Escala de densidade na cor do partido do candidato.
    if (cand) layout.style.setProperty('--partido', corPartido(cand.partido)); else layout.style.removeProperty('--partido');
    const venc = vencedoresAtivo();
    const cargoV = venc && cargoVenc ? cargosRapidos(estado.uf).find(c => c.id === cargoVenc) : null;
    if (nivel !== 'municipio') modoSel.hidden = true;
    const nomeUf = contexto.config.ufs.find(u => u.sigla === estado.uf)?.nome || estado.uf;
    // Voltar: do município para o estado; do estado para o Brasil (não para candidato estadual,
    // cujo número só vale na UF dele).
    voltar.hidden = nivel === 'brasil' || (nivel === 'uf' && !!cand && !cargo.nacional);
    voltar.lastChild.textContent = nivel === 'municipio' ? nomeUf : 'Brasil';
    voltar.onclick = () => definir(nivel === 'municipio' ? { mun: '' } : { uf: '' });
    titulo1.textContent = nivel === 'brasil' ? 'Brasil' : nomeUf;
    limpar(area, esqueleto(3));
    ajuda.hidden = true;
    limpar(leg); limpar(tabela);
    atual = null;
    dePorId = new Map();
    apagaveis = new Map();
    camadaSelecao = null;
    const unidadeNome = { brasil: 'estado', uf: 'município', municipio: 'local de votação' }[nivel];
    const cliqueMun = abrirCidade ? 'um município para ver os locais de votação' : 'um município';
    subtitulo.textContent = cand
      ? `Densidade de votos de ${titulo(cand.nome)} por ${unidadeNome} · ${estado.turno}º turno. ${nivel === 'municipio' ? 'Clique em um local.' : `Clique em ${nivel === 'brasil' ? 'um estado' : cliqueMun}.`}`
      : '';
    // Sem candidato: só o mapa, sem textos repetindo "busque um candidato" e sem o painel lateral
    // (na aba Mapa, dentro de um estado, o painel traz os atalhos do mapa "quem venceu").
    lateral.hidden = !cand && !venc;
    layout.classList.toggle('sem-painel', !cand && !venc);
    if (venc) painelVencedores();
    else if (!cand) limpar(painel);
    else if (nivel === 'brasil' && !cargo.nacional) aviso(`Escolha um estado no mapa para ver os votos de ${titulo(cand.nome)}.`);
    else limpar(painel, esqueleto(4));
    try {
      const pedir = cargoV ? api('/api/mapa/vencedores', { cargo: cargoV.id, turno: 1, uf: estado.uf }).catch(e => ({ falha: e }))
        : !cand || (nivel === 'brasil' && !cargo.nacional) ? Promise.resolve(null)
        : (nivel === 'municipio'
          ? api('/api/mapa/locais', { cargo: cargo.id, turno: estado.turno, uf: estado.uf, mun: estado.mun, numero: cand.numero })
          : api('/api/mapa/candidato', { cargo: cargo.id, turno: estado.turno, uf: estado.uf, numero: cand.numero })).catch(e => ({ falha: e }));
      const [malha, dens] = await Promise.all([nivel === 'brasil' ? api('/api/mapa/brasil') : api('/api/mapa/uf', { uf: estado.uf }), pedir]);
      if (minha !== seq) return;
      const ok = dens && !dens.falha;
      const svg = nivel === 'municipio' ? desenharMunicipio(malha, ok ? dens : null)
        : desenharAreas(nivel, malha, ok && !cargoV ? dens : null, ok && cargoV ? dens : null);
      if (!svg) return;
      limpar(area, svg);
      ajuda.hidden = !cand || !svg.classList.contains('mapa-pilha');
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
      atual = { nivel, modo: svg.modo, cand, cargo, itens: svg.itens, areas: svg.areas };
      destacarSelecao();
      limpar(leg, legenda(titulo(cand.nome), svg.escala, svg.unidade || unidadeNome), svg.nota || null);
      const porZona = svg.modo === 'zonas';
      tabelaDados(cand, svg.itens, svg.areas, { brasil: 'Estado', uf: 'Município', municipio: porZona ? 'Zona' : 'Local de votação' }[nivel], { brasil: 'estados', uf: 'municípios', municipio: porZona ? 'zonas' : 'locais' }[nivel]);
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

    aplicar();
    // Voltando de um nível: começa no lugar de onde se saiu e afasta até o mapa inteiro.
    if (inicial) {
      const pad = Math.max(inicial.w, inicial.h * (w0 / h0)) * 0.15;
      Object.assign(vb, limitar({ x: inicial.x0 - pad, y: inicial.y0 - pad, w: Math.max(inicial.w, inicial.h * (w0 / h0)) + 2 * pad }));
      aplicar();
      animarPara({ x: x0, y: y0, w: w0, h: h0 }, 550);
    }
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
    // Vencedor de cada município como "área" (votos e % do 1º colocado) para usar a mesma escala.
    const doVencedor = a => (a?.top?.[0] ? { votos: a.top[0].votos, validos: a.validos, percentual: a.top[0].percentual } : null);
    const escala = dens ? escalaDensidade([...areas.values()], dens.max)
      : venc ? escalaDensidade([...vencedores.values()].map(doVencedor), Math.max(0, ...[...vencedores.values()].map(a => a.top[0]?.percentual || 0))) : null;
    const contagem = new Map(); // partido -> municípios vencidos
    const svg = h('svg:svg', { viewBox: malha.viewBox, class: 'mapa-svg', role: 'group', 'aria-label': `Mapa: ${titulo1.textContent}` });
    const grupo = h('svg:g', { class: 'mapa-areas' });
    const alvos = [];
    itens.forEach((it, i) => {
      const a = areas.get(it.id);
      const v = vencedores?.get(it.id);
      const { texto } = venc ? dicaVencedor(it.nome, v) : dica(it.nome, dens ? a : null);
      alvos.push({
        d: it.d,
        conteudo: () => (venc ? dicaVencedor(it.nome, v).el : dens ? dica(it.nome, a).el : dica(it.nome, null).el.firstChild),
        // Aba Mapa: clicar de novo no município escolhido desfaz a seleção.
        escolher: () => (nacional ? definir({ uf: it.id }) : definir({ mun: !abrirCidade && estado.mun === it.id ? '' : it.id })),
      });
      const classe = venc ? classeDensidade(doVencedor(v), escala.topo) : dens ? classeDensidade(a, escala.topo) : 'mapa-neutro';
      const p = h('svg:path', {
        d: it.d, class: `mapa-regiao ${classe}`, 'aria-label': dens || venc ? texto : it.nome, 'data-i': i,
        // Teclado: só as 27 UFs viram paradas de Tab; municípios são escolhidos pelo filtro ou pela tabela.
        tabindex: nacional ? '0' : undefined, role: nacional ? 'button' : undefined,
      });
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
    ampliar(el, malha.viewBox, {
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
    // Totais por zona (soma dos locais = total da zona no município) e bairros de cada zona.
    const zonas = new Map();
    for (const l of locais) {
      const zn = zonas.get(l.z) || { id: String(l.z), nome: `Zona ${l.z}`, votos: 0, validos: 0, locais: [], celulas: [] };
      zn.votos += l.votos; zn.validos += l.validos; zn.locais.push(l);
      zonas.set(l.z, zn);
    }
    for (const zn of zonas.values()) {
      zn.percentual = zn.validos ? (zn.votos / zn.validos) * 100 : 0;
      zn.detalhe = `${numero(zn.locais.length)} ${zn.locais.length === 1 ? 'local' : 'locais'} · ${numero(new Set(zn.locais.map(l => l.bairro)).size)} bairros`;
    }
    const comArea = new Set();
    const celulas = geo ? geo.c.map(([ids, d]) => {
      const ls = ids.map(i => locais[i]).filter(Boolean);
      const cont = new Map();
      for (const l of ls) { cont.set(l.z, (cont.get(l.z) || 0) + 1); comArea.add(l); }
      const z = [...cont].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
      const votos = ls.reduce((s, l) => s + l.votos, 0), validos = ls.reduce((s, l) => s + l.validos, 0);
      return { d, ls, z, x: ls[0]?.x, y: ls[0]?.y, votos, validos, percentual: validos ? (votos / validos) * 100 : 0 };
    }).filter(cel => cel.ls.length) : [];
    if (!modo || !['zonas', 'locais'].includes(modo)) modo = new Set(celulas.map(cel => cel.z)).size > 1 ? 'zonas' : 'locais';
    const porZona = modo === 'zonas';
    const unidade = porZona ? 'zona eleitoral' : 'local de votação';
    subtitulo.textContent = `Densidade de votos de ${titulo(atualCand?.nome || '')} por ${unidade} · ${estado.turno}º turno. Clique em ${porZona ? 'uma zona para ver os bairros' : 'um local'}.`;
    desenharModo(celulas.length > 0);
    const itens = porZona
      ? [...zonas.values()].sort((a, b) => a.locais[0].z - b.locais[0].z)
      : locais.map(l => ({ id: l.id, l, nome: titulo(l.nome), detalhe: l.bairro ? `Bairro ${titulo(l.bairro)}` : '' }));
    const areas = new Map(porZona ? itens.map(zn => [zn.id, zn]) : locais.map(l => [l.id, l]));
    const escala = dens ? escalaDensidade(porZona ? [...zonas.values()] : locais, porZona ? Math.max(0, ...[...zonas.values()].map(zn => zn.percentual)) : dens.max) : null;
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
        alvos.push({ d: dZona, conteudo: () => dica(zn.nome, dens ? zn : null, zn.detalhe).el, escolher: () => escolherZona(zn) });
        const p = h('svg:path', { d: dZona, class: `mapa-celula mapa-zona ${dens ? classeDensidade(zn, escala.topo) : 'mapa-neutro'}` });
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
        alvos.push({ d: cel.d, conteudo: () => dica(nome, dens ? cel : null, detalhe).el, escolher: () => escolherLocal(cel.ls[0]) });
        for (const l of cel.ls) dePorId.set(l.id, cel.d);
        const classe = dens ? classeDensidade(cel, escala.topo) : 'mapa-neutro';
        (porCor.get(classe) || porCor.set(classe, []).get(classe)).push(cel.d);
      });
      for (const [classe, ds] of porCor) grupo.append(h('svg:path', { d: ds.join(''), class: `mapa-celula mapa-classe ${classe}` }));
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
        const b = bairros.get(l.bairro) || { nome: titulo(l.bairro || 'Não informado'), votos: 0, validos: 0, locais: 0 };
        b.votos += l.votos; b.validos += l.validos; b.locais++;
        bairros.set(l.bairro, b);
      }
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
      const chave = [estado.uf, nivel === 'municipio' ? estado.mun : '', estado.cargo, estado.turno, estado.cand].join('|');
      // Outro município (ou outro nível): a divisão volta ao automático.
      if (chave.split('|').slice(0, 2).join('|') !== chaveMapa.split('|').slice(0, 2).join('|')) modo = null;
      if (chave !== chaveMapa) { chaveMapa = chave; desenhar(); } else { porZoom = null; destacarSelecao(); desenharPainel(); }
    },
  };
}
