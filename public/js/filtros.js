// Barra de filtros compartilhada por todas as páginas. Tudo começa pela busca do candidato
// (nome ou número): o cargo vem dele. Depois de escolhido, aparecem o turno e a cascata
// Estado › Município › Zona › Bairro › Local › Seção.

import { h, $, limpar, numero, titulo, situacao, debounce, icone, fotoCandidato } from './dom.js';
import { cargoDe, situacaoDe, feminino } from './genero.js';
import { api } from './api.js';
import { estado, contexto, definir, aoMudar } from './estado.js';
import { candidatoA, candidatoB, compativeis, coresDuelo } from './comparacao.js';

const NOMES_CARGO_CURTO = { deputado_federal: 'Dep. Federal', deputado_estadual: 'Dep. Estadual', deputado_distrital: 'Dep. Distrital' };
// Nome do cargo concordando com a pessoa (Governadora, Senadora…).
const nomeCargo = (id, c) => cargoDe(NOMES_CARGO_CURTO[id] || contexto.config.cargos.find(x => x.id === id)?.nome || '', c);

// Candidatos do filtro já carregados (o da URL pode ainda estar chegando).
const candidatoAtual = candidatoA;

// 2º turno: só se todos os candidatos escolhidos (1 ou 2, na comparação) o disputaram.
function turnoDisponivel(cargo, turno, uf = estado.uf) {
  if (turno === '1') return true;
  const c = candidatoAtual(), c2 = candidatoB();
  if ((c && !c.turno2) || (c2 && !c2.turno2)) return false;
  if (cargo === 'presidente') return contexto.config.segundoTurnoPresidente;
  if (cargo === 'governador') return !uf || contexto.config.segundoTurnoGovernador.includes(uf);
  return false;
}

// UF obrigatória do recorte: a do candidato principal (estadual); Presidente comparado com um
// candidato estadual vai para o estado do outro. Vazio = qualquer UF (ou o Brasil).
function ufObrigatoria(p, outro) {
  if (!p) return '';
  if (p.uf !== 'BR') return p.uf;
  return outro && outro.uf !== 'BR' ? outro.uf : '';
}

// Corrige combinações impossíveis. O cargo é sempre o do candidato buscado (sem candidato, não há
// cargo) e o candidato estadual fica no seu estado: números se repetem entre estados (o 1234 de SP
// não é o 1234 do RJ), então um link editado com outra UF volta para a UF do candidato.
// Na comparação, o recorte segue o candidato principal (ver js/comparacao.js).
export function normalizarEstado() {
  const ajustes = {};
  const cfg = contexto.config;
  // UF inexistente (link editado à mão) ou município sem UF: volta ao nível válido mais alto.
  if (estado.uf && !cfg.ufs.some(u => u.sigla === estado.uf)) ajustes.uf = '';
  else if (!estado.uf && estado.mun) ajustes.mun = '';
  // Comparação: sem o 1º candidato (ou com o mesmo nos dois) não há 2º; sem 2º, não há foco.
  if (estado.cand2 && (!estado.cand || estado.cand2 === estado.cand)) ajustes.cand2 = '';
  const cand2 = ajustes.cand2 ?? estado.cand2;
  const c = candidatoAtual();
  const c2 = cand2 ? candidatoB() : null;
  const pendente = !!cand2 && !c2; // 2º candidato ainda chegando: o foco fica como está
  if (estado.foco && (!cand2 || compativeis(c, c2))) ajustes.foco = '';
  if (!estado.cand) { if (estado.cargo) ajustes.cargo = ''; }
  else if (c && !(pendente && estado.foco)) {
    const p = (ajustes.foco ?? estado.foco) === '2' && c2 ? c2 : c;
    if (p.cargo !== estado.cargo) ajustes.cargo = p.cargo;
    const uf = ufObrigatoria(p, p === c ? c2 : c);
    if (uf && (ajustes.uf ?? estado.uf) !== uf) ajustes.uf = uf;
  }
  const cargo = ajustes.cargo ?? estado.cargo;
  if (cargo && !cfg.cargos.some(x => x.id === cargo)) ajustes.cargo = '';
  if (!turnoDisponivel(ajustes.cargo ?? cargo, estado.turno, ajustes.uf ?? estado.uf)) ajustes.turno = '1';
  if (Object.keys(ajustes).length) definir(ajustes);
}

// Sem candidato não há filtro: volta à tela inicial, só com a busca.
const limparTudo = () => { contexto.candidato = null; contexto.candidato2 = null; definir({ cand: '', cand2: '', foco: '', cargo: '', uf: '', turno: '1' }); };

// Tirar o 1º candidato da comparação: o 2º passa a ser o 1º (no estado dele).
function removerA() {
  const b = candidatoB();
  if (!b) return limparTudo();
  contexto.candidato = b; contexto.candidato2 = null;
  const alt = { cand: b.id, cand2: '', foco: '', cargo: b.cargo };
  if (b.uf !== 'BR' && estado.uf !== b.uf) alt.uf = b.uf;
  definir(alt);
}

// Tirar o 2º: o recorte volta a seguir o 1º (se seguia o 2º, volta ao estado do 1º).
function removerB() {
  const a = candidatoAtual();
  contexto.candidato2 = null;
  const alt = { cand2: '', foco: '' };
  if (a && estado.foco === '2') { alt.cargo = a.cargo; alt.uf = a.uf === 'BR' ? '' : a.uf; }
  definir(alt);
}

// ---------------------------------------------------------------------------
// Componentes.

function campo(rotulo, controle, id) {
  return h('label', { class: 'campo', for: id }, h('span', { class: 'campo-rotulo', text: rotulo }), controle);
}

function select(id, aoTrocar) {
  return h('select', { id, class: 'controle', onchange: e => aoTrocar(e.target.value) });
}

function preencher(sel, opcoes, valor, vazio) {
  const els = [];
  if (vazio) els.push(h('option', { value: '', text: vazio }));
  for (const o of opcoes) els.push(h('option', { value: o.valor, text: o.texto, disabled: o.desabilitado || undefined }));
  limpar(sel, els);
  sel.value = opcoes.some(o => o.valor === valor) ? valor : '';
}

// Troca do 1º candidato no mesmo estado (ou para Presidente, que vale em qualquer recorte): os
// filtros ficam (estado, município, zona… e o turno, se ele disputou) e só os números mudam.
// De outro estado: começa no recorte dele, o estado (ou o Brasil), 1º turno.
function escolherA(c) {
  contexto.candidato = c;
  const mesmoEstado = c.uf === 'BR' || c.uf === estado.uf;
  const alt = mesmoEstado ? { cand: c.id, cargo: c.cargo, foco: '' } : { cand: c.id, cargo: c.cargo, foco: '', uf: c.uf === 'BR' ? '' : c.uf, turno: '1' };
  if (c.id === estado.cand2) { alt.cand2 = ''; contexto.candidato2 = null; } // o 2º virou o 1º
  definir(alt);
}

// 2º candidato (comparação): os filtros ficam. Presidente × candidato estadual vai para o estado
// do estadual (é onde os dois têm votos); estados diferentes: o recorte continua o do 1º.
function escolherB(c) {
  const a = candidatoAtual();
  if (!a || c.id === a.id) return;
  contexto.candidato2 = c;
  const alt = { cand2: c.id, foco: '' };
  if (a.uf === 'BR' && c.uf !== 'BR' && estado.uf !== c.uf) alt.uf = c.uf;
  definir(alt);
}

// Combobox acessível para busca de candidatos. Duas instâncias: a busca principal (prefixo
// "cand") e a do candidato para comparar ("cand2").
function criarBuscaCandidato({ prefixo = 'cand', placeholder = 'Buscar candidato por nome ou número', aoEscolher, atual, remover, excluir = () => '' }) {
  const lista = h('ul', { id: `${prefixo}-lista`, class: 'combo-lista', role: 'listbox', hidden: true });
  const entrada = h('input', {
    id: `${prefixo}-busca`, class: 'controle controle-busca', type: 'search', autocomplete: 'off', spellcheck: 'false',
    placeholder, role: 'combobox', 'aria-expanded': 'false', 'aria-controls': `${prefixo}-lista`, 'aria-autocomplete': 'list', maxlength: '60',
  });
  const chip = h('div', { class: 'cand-chip', hidden: true });
  let itens = [], ativo = -1, seq = 0;

  const fechar = () => { lista.hidden = true; entrada.setAttribute('aria-expanded', 'false'); entrada.removeAttribute('aria-activedescendant'); ativo = -1; };
  const escolher = c => {
    entrada.value = '';
    fechar();
    aoEscolher(c);
  };
  const marcar = i => {
    ativo = i;
    [...lista.children].forEach((li, j) => li.setAttribute('aria-selected', String(j === i)));
    if (lista.children[i]) { lista.children[i].scrollIntoView({ block: 'nearest' }); entrada.setAttribute('aria-activedescendant', lista.children[i].id); }
  };
  const buscar = debounce(async () => {
    const q = entrada.value.trim();
    const minha = ++seq;
    if (q.length < 2) return fechar();
    try {
      itens = (await api('/api/candidatos', { q })).filter(c => c.id !== excluir());
      if (minha !== seq) return;
      limpar(lista, itens.length ? itens.map((c, i) => h('li', { id: `${prefixo}-op-${i}`, role: 'option', class: 'combo-item', 'aria-selected': 'false', onmousedown: e => { e.preventDefault(); escolher(c); } },
        fotoCandidato(c, 'combo-foto'),
        h('span', { class: 'combo-num', text: c.numero }),
        h('span', { class: 'combo-texto' },
          h('strong', { text: titulo(c.nome) }),
          h('small', { text: `${c.partido} · ${nomeCargo(c.cargo, c)} · ${c.uf}${c.situacao ? ` · ${situacaoDe(situacao(c.situacao), c)}` : ''}` })),
      )) : [h('li', { class: 'combo-vazio', text: 'Nenhum candidato encontrado.' })]);
      lista.hidden = false;
      entrada.setAttribute('aria-expanded', 'true');
      ativo = -1;
    } catch { fechar(); }
  }, 160);

  entrada.addEventListener('input', buscar);
  // Baixa o índice de candidatos (~500 KB) assim que o campo recebe foco, antes da primeira tecla.
  entrada.addEventListener('focus', () => { api('/api/candidatos', { q: 'aa' }).catch(() => {}); }, { once: true });
  entrada.addEventListener('blur', () => setTimeout(fechar, 120));
  entrada.addEventListener('keydown', e => {
    if (lista.hidden || !itens.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); marcar(Math.min(itens.length - 1, ativo + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); marcar(Math.max(0, ativo - 1)); }
    // Enter sem item marcado escolhe o primeiro (o mais relevante da busca).
    else if (e.key === 'Enter') { e.preventDefault(); escolher(itens[Math.max(0, ativo)]); }
    else if (e.key === 'Escape') fechar();
  });

  // cor: na comparação, o fio do lado esquerdo tem a cor do candidato no mapa e nos cartões.
  const atualizarChip = cor => {
    const c = atual();
    chip.hidden = !c;
    chip.classList.toggle('com-cor', !!cor);
    if (cor) chip.style.setProperty('--lado', cor); else chip.style.removeProperty('--lado');
    if (!c) return limpar(chip);
    limpar(chip,
      fotoCandidato(c, 'cand-chip-foto'),
      h('span', { class: 'cand-chip-num', text: c.numero }),
      h('span', { class: 'cand-chip-texto' }, h('strong', { text: titulo(c.nome) }), h('small', { text: `${c.partido} · ${nomeCargo(c.cargo, c)} · ${c.uf}` })),
      h('button', { type: 'button', class: 'botao-icone', 'aria-label': `Remover ${titulo(c.nome)} do filtro`, title: 'Remover candidato', onclick: remover }, icone('fechar')));
  };

  const raiz = h('div', { class: 'combo' }, h('span', { class: 'combo-icone' }, icone('busca')), entrada, lista);
  return { raiz, chip, entrada, atualizarChip };
}

// ---------------------------------------------------------------------------

export function criarFiltros(container) {
  const busca = criarBuscaCandidato({ aoEscolher: escolherA, atual: candidatoAtual, remover: removerA, excluir: () => estado.cand2 });
  // Comparação: o botão "Comparar" abre a 2ª busca; escolhido, o 2º candidato vira um chip.
  let abrirComparar = false;
  const busca2 = criarBuscaCandidato({
    prefixo: 'cand2', placeholder: 'Comparar com outro candidato', atual: candidatoB, remover: removerB, excluir: () => estado.cand,
    aoEscolher: c => { abrirComparar = false; escolherB(c); },
  });
  const botaoComparar = h('button', {
    type: 'button', class: 'botao-secundario botao-comparar',
    onclick: () => { abrirComparar = true; render(); busca2.entrada.focus(); },
  }, h('span', { class: 'botao-comparar-mais', 'aria-hidden': 'true', text: '+' }), 'Adicionar candidato');
  const fecharComparar = h('button', {
    type: 'button', class: 'botao-icone', 'aria-label': 'Cancelar a comparação', title: 'Cancelar',
    onclick: () => { abrirComparar = false; busca2.entrada.value = ''; render(); botaoComparar.focus(); },
  }, icone('fechar'));
  // Candidatos em duas colunas iguais, com rótulo: os chips ficam alinhados entre si e com a
  // cascata abaixo (as 2 colunas coincidem com 3 + 3 das 6 da cascata).
  const linhaComparar = h('div', { class: 'filtros-linha filtros-comparar' },
    h('div', { class: 'campo campo-cand campo-cand-a' }, h('span', { class: 'campo-rotulo', text: 'Candidato' }), busca.chip),
    h('div', { class: 'campo campo-cand campo-cand-b' }, h('span', { class: 'campo-rotulo', text: 'Comparar com' }),
      h('div', { class: 'filtros-busca' }, botaoComparar, busca2.raiz, fecharComparar, busca2.chip)));
  busca2.entrada.addEventListener('keydown', e => { if (e.key === 'Escape' && !busca2.entrada.value) fecharComparar.click(); });
  const turnos = h('div', { class: 'segmentado', role: 'radiogroup', 'aria-label': 'Turno' });
  const sUf = select('f-uf', v => definir({ uf: v }));
  const sMun = select('f-mun', v => definir({ mun: v }));
  const sZona = select('f-zona', v => definir({ zona: v }));
  const sBairro = select('f-bairro', v => definir({ bairro: v }));
  const sLocal = select('f-local', v => {
    if (!v) return definir({ local: '' });
    const [z, n] = v.split('|');
    definir({ zona: z, local: n, secao: '' });
  });
  const sSecao = select('f-secao', v => {
    if (!v) return definir({ secao: '' });
    const [z, s] = v.split('|');
    definir({ zona: z, secao: s });
  });
  const dicaSecao = h('p', { class: 'filtros-dica', hidden: true });
  const limparBtn = h('button', { type: 'button', class: 'botao-texto', onclick: limparTudo }, 'Limpar filtros');

  limpar(container,
    h('div', { class: 'filtros-linha filtros-principal' },
      h('div', { class: 'filtros-busca' }, busca.raiz),
      h('div', { class: 'campo campo-turno' }, h('span', { class: 'campo-rotulo', text: 'Turno' }), turnos),
    ),
    linhaComparar,
    h('div', { class: 'filtros-linha filtros-cascata' },
      campo('Estado', sUf, 'f-uf'),
      campo('Município', sMun, 'f-mun'),
      campo('Zona', sZona, 'f-zona'),
      campo('Bairro', sBairro, 'f-bairro'),
      campo('Local de votação', sLocal, 'f-local'),
      campo('Seção', sSecao, 'f-secao'),
    ),
    h('div', { class: 'filtros-rodape' }, dicaSecao, limparBtn),
  );

  let seqMun = 0, seqLocais = 0;

  async function carregarMunicipios() {
    const minha = ++seqMun;
    if (!estado.uf) { contexto.municipios = []; return; }
    sMun.disabled = true;
    try {
      const lista = await api('/api/municipios', { uf: estado.uf });
      if (minha === seqMun) contexto.municipios = lista;
    } catch { if (minha === seqMun) contexto.municipios = []; }
  }

  async function carregarLocais() {
    const minha = ++seqLocais;
    contexto.locais = null;
    if (!estado.uf || !estado.mun) return;
    try {
      const d = await api('/api/locais', { uf: estado.uf, mun: estado.mun });
      if (minha === seqLocais) contexto.locais = d;
    } catch { if (minha === seqLocais) contexto.locais = { locais: [], bairros: [], erro: true }; }
  }

  function render() {
    const cfg = contexto.config;
    // Sem candidato: só a busca por nome ou número.
    container.classList.toggle('filtros-so-busca', !estado.cand);
    const c = candidatoAtual(), c2 = candidatoB();
    // Turno. Na comparação, o 2º turno só vale se os dois o disputaram (o título diz quem não).
    const semSegundo = [c, c2].find(x => x && !x.turno2);
    limpar(turnos, ['1', '2'].map(t => {
      const disp = turnoDisponivel(estado.cargo, t);
      const motivo = !semSegundo ? 'Não houve 2º turno para este cargo neste recorte' : c2 ? `${titulo(semSegundo.nome)} não disputou o 2º turno` : `${feminino(semSegundo) ? 'A candidata' : 'O candidato'} não disputou o 2º turno`;
      return h('button', { type: 'button', role: 'radio', class: 'segmento', 'aria-checked': String(estado.turno === t), disabled: !disp || undefined, title: disp ? '' : motivo, onclick: () => definir({ turno: t }) }, `${t}º`);
    }));
    // Estado: candidato estadual só existe no seu estado (o campo fica fixo); Presidente, em todos.
    // Na comparação vale a UF do candidato principal (ou a do estadual, se o outro é Presidente).
    const p = estado.foco === '2' && c2 ? c2 : c;
    const ufFixa = ufObrigatoria(p, p === c ? c2 : c);
    sUf.disabled = !!ufFixa;
    preencher(sUf, cfg.ufs.filter(u => !ufFixa || u.sigla === ufFixa).map(u => ({ valor: u.sigla, texto: `${u.nome} (${u.sigla})` })), estado.uf, ufFixa ? null : 'Brasil (todos)');
    // Município
    sMun.disabled = !estado.uf;
    preencher(sMun, contexto.municipios.map(m => ({ valor: m.cd, texto: titulo(m.nm) + (m.capital ? ' (capital)' : '') })), estado.mun, estado.uf ? 'Todos os municípios' : 'Escolha o estado');
    // Zona
    const mun = contexto.municipios.find(m => m.cd === estado.mun);
    sZona.disabled = !mun;
    preencher(sZona, (mun?.zonas || []).map(z => ({ valor: String(z), texto: `Zona ${z}` })), estado.zona, mun ? 'Todas as zonas' : '—');
    // Bairro / Local / Seção
    const L = contexto.locais;
    const temLocais = !!(L && L.locais.length);
    const z = Number(estado.zona) || null;
    const bairros = temLocais ? L.bairros.filter(b => !z || b.zonas.includes(z)) : [];
    // Bairro sem locais de votação na zona escolhida deixa de valer.
    if (estado.bairro && temLocais && !bairros.some(b => b.nome === estado.bairro)) {
      queueMicrotask(() => definir({ bairro: '' }));
    }
    sBairro.disabled = !temLocais;
    preencher(sBairro, bairros.map(b => ({ valor: b.nome, texto: `${titulo(b.nome)} · ${numero(b.secoes)} seç.` })), estado.bairro, !mun ? '—' : L ? (temLocais ? 'Todos os bairros' : 'Indisponível') : 'Carregando…');
    const locais = temLocais ? L.locais.filter(l => (!z || l.z === z) && (!estado.bairro || l.bairro === estado.bairro)) : [];
    sLocal.disabled = !temLocais;
    preencher(sLocal, locais.map(l => ({ valor: `${l.z}|${l.n}`, texto: `${titulo(l.nome)} (Z${l.z})` })), estado.local ? `${estado.zona}|${estado.local}` : '', !mun ? '—' : 'Todos os locais');
    const secoesLista = locais.filter(l => !estado.local || l.n === Number(estado.local)).flatMap(l => l.secoes.map(s => ({ z: l.z, s })));
    secoesLista.sort((a, b) => a.z - b.z || a.s - b.s);
    const muitas = secoesLista.length > 1500 && !z;
    sSecao.disabled = !temLocais || muitas;
    preencher(sSecao, muitas ? [] : secoesLista.map(x => ({ valor: `${x.z}|${x.s}`, texto: z ? `Seção ${x.s}` : `Zona ${x.z} · Seção ${x.s}` })), estado.secao ? `${estado.zona}|${estado.secao}` : '', !mun ? '—' : muitas ? 'Escolha a zona' : 'Todas as seções');
    dicaSecao.hidden = !mun;
    dicaSecao.textContent = !mun ? '' : L?.erro
      ? 'O detalhamento por bairro, local e seção deste estado não está incluído nesta publicação.'
      : 'Bairro, local de votação e seção somam os votos oficiais de cada seção eleitoral.';
    // Comparação: botão, 2ª busca ou o chip do 2º candidato. Os chips levam a cor de cada um.
    linhaComparar.hidden = !c;
    if (!c) abrirComparar = false;
    const cores = c && c2 ? coresDuelo(c, c2) : [];
    botaoComparar.hidden = !!c2 || abrirComparar;
    busca2.raiz.hidden = fecharComparar.hidden = !!c2 || !abrirComparar;
    busca.atualizarChip(cores[0]);
    busca2.atualizarChip(cores[1]);
  }

  aoMudar(async mudou => {
    normalizarEstado();
    if (mudou.has('uf')) await carregarMunicipios();
    if (mudou.has('uf') || mudou.has('mun')) { render(); await carregarLocais(); }
    render();
  });

  return {
    async iniciar() {
      normalizarEstado();
      await carregarMunicipios();
      render();
      await carregarLocais();
      render();
    },
    render,
  };
}

export function focarBusca() { $('#cand-busca')?.focus(); }
