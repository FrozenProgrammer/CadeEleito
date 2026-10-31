// Mapa de densidade de votos do candidato filtrado, em três níveis de zoom:
//   Brasil (por estado, para Presidente) › Estado (por município) › Município (por local de votação).
// Cada área ou local é colorido pelo % dos votos válidos que o candidato recebeu ali: quanto maior
// o percentual, mais forte a cor. Clicar em um estado ou município aproxima o mapa; clicar em um
// local de votação aplica o filtro do local.

import { h, limpar, numero, pct, titulo, icone } from '../dom.js';
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

export function criarPaginaMapa(raiz) {
  const instancia = ++instancias;
  const titulo1 = h('h2');
  const subtitulo = h('p', { class: 'recorte-sub' });
  const voltar = h('button', { type: 'button', class: 'botao-secundario', hidden: true }, icone('voltar'), h('span'));
  const modoSel = h('div', { class: 'segmentado modo-mapa', role: 'radiogroup', 'aria-label': 'Dividir o mapa do município por', hidden: true });
  const area = h('div', { class: 'mapa-area' });
  const leg = h('div', { class: 'mapa-legenda' });
  const tabela = h('div', { class: 'mapa-tabela' });
  const painel = h('div', { class: 'mapa-painel-conteudo' });

  limpar(raiz, h('div', { class: 'pagina-conteudo' },
    h('div', { class: 'mapa-layout' },
      h('section', { class: 'cartao mapa-cartao' },
        h('div', { class: 'cartao-topo' }, h('div', {}, titulo1, subtitulo), voltar, modoSel),
        area, leg, tabela),
      h('aside', { class: 'cartao mapa-painel', 'aria-live': 'polite' }, painel))));

  let seq = 0;
  let marcas = new Map(); // elemento SVG -> { ids: Set(ids que ele representa), d: contorno para o destaque }
  let camadaSelecao = null; // contorno do item escolhido (uma camada por cima das áreas)
  let atual = null; // { nivel, modo, cand, cargo, itens, areas } do último desenho
  let atualCand = null;
  let modo = null; // mapa do município: 'zonas' | 'locais' (null = automático)

  const nivelAtual = () => (!estado.uf ? 'brasil' : estado.mun && contexto.config.detalhadas.includes(estado.uf) ? 'municipio' : 'uf');
  const idSelecionado = () => (atual?.nivel === 'municipio'
    ? (atual.modo === 'zonas' ? estado.zona : estado.local ? `${estado.zona}|${estado.local}` : '')
    : atual?.nivel === 'uf' ? estado.mun : '');

  // Zona escolhida: as outras zonas (grupos) ficam apagadas. Município/local escolhido: contorno
  // desenhado na camada de seleção (sem mexer na ordem nem no estilo de milhares de áreas).
  function destacarSelecao() {
    const alvo = idSelecionado();
    const zonas = atual?.nivel === 'municipio' && atual.modo === 'zonas';
    let d = '';
    for (const [el, info] of marcas) {
      const sel = !!alvo && info.ids.has(alvo);
      if (zonas) el.classList.toggle('apagada', !!alvo && !sel);
      else if (sel) d = info.d;
    }
    if (!camadaSelecao) return;
    if (d) camadaSelecao.setAttribute('d', d); else camadaSelecao.removeAttribute('d');
  }

  function aviso(texto) { limpar(painel, h('div', { class: 'aviso' }, icone('mapa'), h('p', { text: texto }))); }

  // Painel: votos do candidato no item escolhido (estado, município ou local) ou no total do mapa.
  function desenharPainel() {
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
    const cargo = contexto.config.cargos.find(c => c.id === estado.cargo);
    const cand = candidatoDoMapa(cargo);
    atualCand = cand;
    if (nivel !== 'municipio') modoSel.hidden = true;
    const nomeUf = contexto.config.ufs.find(u => u.sigla === estado.uf)?.nome || estado.uf;
    // Voltar: do município para o estado; do estado para o Brasil (não para candidato estadual,
    // cujo número só vale na UF dele).
    voltar.hidden = nivel === 'brasil' || (nivel === 'uf' && !!cand && !cargo.nacional);
    voltar.lastChild.textContent = nivel === 'municipio' ? nomeUf : 'Brasil';
    voltar.onclick = () => definir(nivel === 'municipio' ? { mun: '' } : { uf: '' });
    titulo1.textContent = nivel === 'brasil' ? 'Brasil' : nomeUf;
    limpar(area, esqueleto(3));
    limpar(leg); limpar(tabela);
    atual = null;
    marcas = new Map();
    camadaSelecao = null;
    const unidadeNome = { brasil: 'estado', uf: 'município', municipio: 'local de votação' }[nivel];
    subtitulo.textContent = cand
      ? `Densidade de votos de ${titulo(cand.nome)} por ${unidadeNome} · ${estado.turno}º turno. ${nivel === 'municipio' ? 'Clique em um local.' : `Clique em ${nivel === 'brasil' ? 'um estado' : 'um município para ver os locais de votação'}.`}`
      : `Busque um candidato no filtro acima para ver onde ele teve mais votos${nivel === 'brasil' ? ', ou clique em um estado' : ''}.`;
    if (!cand) aviso('Busque um candidato pelo nome ou número no filtro acima para ver, no mapa, onde ele teve a maior parcela dos votos.');
    else if (nivel === 'brasil' && !cargo.nacional) aviso(`Escolha um estado no mapa para ver os votos de ${titulo(cand.nome)}.`);
    else limpar(painel, esqueleto(4));
    try {
      const pedir = !cand || (nivel === 'brasil' && !cargo.nacional) ? Promise.resolve(null)
        : (nivel === 'municipio'
          ? api('/api/mapa/locais', { cargo: cargo.id, turno: estado.turno, uf: estado.uf, mun: estado.mun, numero: cand.numero })
          : api('/api/mapa/candidato', { cargo: cargo.id, turno: estado.turno, uf: estado.uf, numero: cand.numero })).catch(e => ({ falha: e }));
      const [malha, dens] = await Promise.all([nivel === 'brasil' ? api('/api/mapa/brasil') : api('/api/mapa/uf', { uf: estado.uf }), pedir]);
      if (minha !== seq) return;
      const ok = dens && !dens.falha;
      const svg = nivel === 'municipio' ? desenharMunicipio(malha, ok ? dens : null) : desenharAreas(nivel, malha, ok ? dens : null);
      if (!svg) return;
      limpar(area, svg);
      destacarSelecao();
      if (dens?.falha) {
        const e = dens.falha;
        limpar(painel, e.status === 400 || e.status === 404 ? informacao(e.message) : erro(e.message, () => { chaveMapa = ''; desenhar(); }));
        return;
      }
      if (!ok) return;
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

  // Interação do mapa com um só conjunto de eventos no <svg> (delegação), em vez de 3–4 por área:
  // estados e cidades grandes têm milhares de áreas. Cada área tem data-i (índice em `alvos`).
  // O destaque ao passar o mouse é UMA camada por cima (o contorno/tinta da área), sem filtros CSS
  // nas áreas, que forçam o navegador a repintar o mapa inteiro.
  // alvos[i] = { texto, conteudo() (tooltip, criado só no 1º hover), escolher(), d (destaque) }
  function interagir(svg, alvos, camadas) {
    let ultimo = -1;
    const destaque = h('svg:path', { class: 'mapa-hover', 'aria-hidden': 'true' });
    const selecao = h('svg:path', { class: 'mapa-selecao', 'aria-hidden': 'true' });
    camadas.append(destaque, selecao);
    const alvoDe = e => {
      const el = e.target.closest?.('[data-i]');
      return el && svg.contains(el) ? Number(el.dataset.i) : -1;
    };
    const conteudo = i => (alvos[i].cache ||= alvos[i].conteudo());
    const sair = () => { ultimo = -1; destaque.removeAttribute('d'); esconderTooltip(); };
    svg.addEventListener('mousemove', e => {
      const i = alvoDe(e);
      if (i < 0) return sair();
      if (i !== ultimo) { ultimo = i; destaque.setAttribute('d', alvos[i].d); }
      mostrarTooltip(e, conteudo(i));
    });
    svg.addEventListener('mouseleave', sair);
    svg.addEventListener('click', e => { const i = alvoDe(e); if (i >= 0) { sair(); alvos[i].escolher(); } });
    // Teclado (as 27 UFs são focáveis): Enter/Espaço escolhe; o foco mostra o tooltip.
    svg.addEventListener('keydown', e => {
      const i = alvoDe(e);
      if (i >= 0 && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); sair(); alvos[i].escolher(); }
    });
    svg.addEventListener('focusin', e => { const i = alvoDe(e); if (i >= 0) { destaque.setAttribute('d', alvos[i].d); mostrarTooltip(e, conteudo(i)); } });
    svg.addEventListener('focusout', sair);
    camadaSelecao = selecao;
  }

  // Brasil (UFs) ou estado (municípios).
  function desenharAreas(nivel, malha, dens) {
    const nacional = nivel === 'brasil';
    const itens = nacional ? malha.ufs.map(u => ({ id: u.uf, nome: u.nome, d: u.d, cx: u.cx, cy: u.cy })) : malha.municipios.map(m => ({ id: m.cd, nome: titulo(m.nm), d: m.d }));
    const areas = new Map(dens ? Object.entries(dens.areas) : []);
    const escala = dens ? escalaDensidade([...areas.values()], dens.max) : null;
    const svg = h('svg:svg', { viewBox: malha.viewBox, class: 'mapa-svg', role: 'group', 'aria-label': `Mapa: ${titulo1.textContent}` });
    const grupo = h('svg:g', { class: 'mapa-areas' });
    const alvos = [];
    itens.forEach((it, i) => {
      const a = areas.get(it.id);
      const { texto } = dica(it.nome, dens ? a : null);
      alvos.push({
        d: it.d,
        conteudo: () => (dens ? dica(it.nome, a).el : dica(it.nome, null).el.firstChild),
        escolher: () => (nacional ? definir({ uf: it.id }) : definir({ mun: it.id })),
      });
      const p = h('svg:path', {
        d: it.d, class: `mapa-regiao ${dens ? classeDensidade(a, escala.topo) : 'mapa-neutro'}`, 'aria-label': dens ? texto : it.nome, 'data-i': i,
        // Teclado: só as 27 UFs viram paradas de Tab; municípios são escolhidos pelo filtro ou pela tabela.
        tabindex: nacional ? '0' : undefined, role: nacional ? 'button' : undefined,
      });
      marcas.set(p, { ids: new Set([it.id]), d: it.d });
      grupo.append(p);
    });
    const camadas = h('svg:g', { class: 'mapa-camadas' });
    svg.append(grupo, camadas);
    if (nacional) svg.append(h('svg:g', { class: 'mapa-rotulos', 'aria-hidden': 'true' }, itens.map(it => h('svg:text', { x: it.cx, y: it.cy, text: it.id }))));
    interagir(svg, alvos, camadas);
    return Object.assign(svg, { itens, areas, escala });
  }

  // Município: áreas dos locais de votação (Voronoi, recortadas pelo contorno da cidade).
  // Modo "zonas": cada área pinta com o % da sua zona eleitoral, com fronteiras e números das zonas.
  // Modo "locais": cada área pinta com o % do próprio local de votação.
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
      return { d, ls, z, votos, validos, percentual: validos ? (votos / validos) * 100 : 0 };
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
    const corte = `corte-${instancia}-${estado.mun}`;
    const svg = h('svg:svg', { viewBox: `${c.x0 - pad} ${c.y0 - pad} ${c.w + 2 * pad} ${c.h + 2 * pad}`, class: `mapa-svg mapa-municipio ${porZona ? 'modo-zonas' : 'modo-locais'}`, role: 'group', 'aria-label': `Mapa: ${nomeMun}, por ${unidade}` },
      h('svg:defs', {}, h('svg:clipPath', { id: corte }, h('svg:path', { d: mun.d }))));
    const grupo = h('svg:g', { class: 'mapa-areas', 'clip-path': `url(#${corte})` });
    const alvos = [];
    const escolherZona = zn => definir(estado.zona === zn.id && !estado.local ? { zona: '', local: '', bairro: '' } : { zona: zn.id, local: '', secao: '', bairro: '' });
    const escolherLocal = l => definir(estado.local === String(l.n) && estado.zona === String(l.z) ? { zona: '', local: '', bairro: '' } : { zona: String(l.z), local: String(l.n), secao: '', bairro: '' });
    if (porZona) {
      // Um <g> por zona: apagar as outras zonas muda a opacidade de poucos grupos, não de milhares de áreas.
      for (const cel of celulas) zonas.get(cel.z).celulas.push(cel);
      for (const zn of zonas.values()) {
        if (!zn.celulas.length) continue;
        const i = alvos.length;
        const dZona = zn.celulas.map(cel => cel.d).join('');
        alvos.push({ d: dZona, conteudo: () => dica(zn.nome, dens ? zn : null, zn.detalhe).el, escolher: () => escolherZona(zn) });
        const classe = `mapa-celula ${dens ? classeDensidade(zn, escala.topo) : 'mapa-neutro'}`;
        const g = h('svg:g', { class: 'zona-grupo', 'aria-label': dica(zn.nome, dens ? zn : null, zn.detalhe).texto, role: 'img' },
          zn.celulas.map(cel => h('svg:path', { d: cel.d, class: classe, 'data-i': i })));
        marcas.set(g, { ids: new Set([zn.id]), d: dZona });
        grupo.append(g);
      }
      if (geo.f) grupo.append(h('svg:path', { d: geo.f, class: 'mapa-fronteira', 'aria-hidden': 'true' }));
    } else {
      for (const cel of celulas) {
        const i = alvos.length;
        const nome = cel.ls.map(l => titulo(l.nome)).join(' · ');
        const detalhe = [...new Set(cel.ls.map(l => l.bairro).filter(Boolean))].map(b => `Bairro ${titulo(b)}`).join(' · ');
        const { texto } = dica(nome, dens ? cel : null, detalhe);
        alvos.push({ d: cel.d, conteudo: () => dica(nome, dens ? cel : null, detalhe).el, escolher: () => escolherLocal(cel.ls[0]) });
        const p = h('svg:path', { d: cel.d, class: `mapa-celula ${dens ? classeDensidade(cel, escala.topo) : 'mapa-neutro'}`, 'aria-label': texto, 'data-i': i });
        marcas.set(p, { ids: new Set(cel.ls.map(l => l.id)), d: cel.d });
        grupo.append(p);
      }
    }
    const camadas = h('svg:g', { class: 'mapa-camadas', 'clip-path': `url(#${corte})` });
    svg.append(grupo, camadas, h('svg:path', { d: mun.d, class: 'mapa-contorno-borda', 'aria-hidden': 'true' }));
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
    interagir(svg, alvos, camadas);
    return Object.assign(svg, extras);
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
      if (chave !== chaveMapa) { chaveMapa = chave; desenhar(); } else { destacarSelecao(); desenharPainel(); }
    },
  };
}
