// Barra de filtros compartilhada por todas as páginas. Tudo começa pela busca do candidato
// (nome ou número): o cargo vem dele. Depois de escolhido, aparecem o turno e a cascata
// Estado › Município › Zona › Bairro › Local › Seção.

import { h, $, limpar, numero, titulo, situacao, debounce, icone, fotoCandidato } from './dom.js';
import { api } from './api.js';
import { estado, contexto, definir, aoMudar } from './estado.js';

const NOMES_CARGO_CURTO = { deputado_federal: 'Dep. Federal', deputado_estadual: 'Dep. Estadual', deputado_distrital: 'Dep. Distrital' };
const nomeCargo = id => NOMES_CARGO_CURTO[id] || contexto.config.cargos.find(x => x.id === id)?.nome || '';

// Candidato do filtro já carregado (o da URL pode ainda estar chegando).
const candidatoAtual = () => (contexto.candidato && contexto.candidato.id === estado.cand ? contexto.candidato : null);

function turnoDisponivel(cargo, turno, uf = estado.uf) {
  if (turno === '1') return true;
  const c = candidatoAtual();
  if (c && !c.turno2) return false; // o candidato não disputou o 2º turno
  if (cargo === 'presidente') return contexto.config.segundoTurnoPresidente;
  if (cargo === 'governador') return !uf || contexto.config.segundoTurnoGovernador.includes(uf);
  return false;
}

// Corrige combinações impossíveis. O cargo é sempre o do candidato buscado (sem candidato, não há
// cargo) e o candidato estadual fica no seu estado: números se repetem entre estados (o 1234 de SP
// não é o 1234 do RJ), então um link editado com outra UF volta para a UF do candidato.
export function normalizarEstado() {
  const ajustes = {};
  const cfg = contexto.config;
  // UF inexistente (link editado à mão) ou município sem UF: volta ao nível válido mais alto.
  if (estado.uf && !cfg.ufs.some(u => u.sigla === estado.uf)) ajustes.uf = '';
  else if (!estado.uf && estado.mun) ajustes.mun = '';
  const c = candidatoAtual();
  if (!estado.cand) { if (estado.cargo) ajustes.cargo = ''; }
  else if (c) {
    if (c.cargo !== estado.cargo) ajustes.cargo = c.cargo;
    if (c.uf !== 'BR' && (ajustes.uf ?? estado.uf) !== c.uf) ajustes.uf = c.uf;
  }
  const cargo = ajustes.cargo ?? estado.cargo;
  if (cargo && !cfg.cargos.some(x => x.id === cargo)) ajustes.cargo = '';
  if (!turnoDisponivel(ajustes.cargo ?? cargo, estado.turno, ajustes.uf ?? estado.uf)) ajustes.turno = '1';
  if (Object.keys(ajustes).length) definir(ajustes);
}

// Sem candidato não há filtro: volta à tela inicial, só com a busca.
const limparTudo = () => { contexto.candidato = null; definir({ cand: '', cargo: '', uf: '', turno: '1' }); };

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

// Combobox acessível para busca de candidatos.
function criarBuscaCandidato() {
  const lista = h('ul', { id: 'cand-lista', class: 'combo-lista', role: 'listbox', hidden: true });
  const entrada = h('input', {
    id: 'cand-busca', class: 'controle controle-busca', type: 'search', autocomplete: 'off', spellcheck: 'false',
    placeholder: 'Buscar candidato por nome ou número', role: 'combobox', 'aria-expanded': 'false', 'aria-controls': 'cand-lista', 'aria-autocomplete': 'list', maxlength: '60',
  });
  const chip = h('div', { class: 'cand-chip', hidden: true });
  let itens = [], ativo = -1, seq = 0;

  const fechar = () => { lista.hidden = true; entrada.setAttribute('aria-expanded', 'false'); entrada.removeAttribute('aria-activedescendant'); ativo = -1; };
  const escolher = c => {
    contexto.candidato = c;
    entrada.value = '';
    fechar();
    // Novo candidato começa no recorte dele: o estado (ou o Brasil, para Presidente), 1º turno.
    const alt = { cand: c.id, cargo: c.cargo, uf: c.uf === 'BR' ? '' : c.uf, turno: '1' };
    definir(alt);
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
      itens = await api('/api/candidatos', { q });
      if (minha !== seq) return;
      limpar(lista, itens.length ? itens.map((c, i) => h('li', { id: `cand-op-${i}`, role: 'option', class: 'combo-item', 'aria-selected': 'false', onmousedown: e => { e.preventDefault(); escolher(c); } },
        fotoCandidato(c, 'combo-foto'),
        h('span', { class: 'combo-num', text: c.numero }),
        h('span', { class: 'combo-texto' },
          h('strong', { text: titulo(c.nome) }),
          h('small', { text: `${c.partido} · ${nomeCargo(c.cargo)} · ${c.uf}${c.situacao ? ` · ${situacao(c.situacao)}` : ''}` })),
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

  const atualizarChip = () => {
    const c = contexto.candidato;
    chip.hidden = !c;
    if (!c) return limpar(chip);
    limpar(chip,
      fotoCandidato(c, 'cand-chip-foto'),
      h('span', { class: 'cand-chip-num', text: c.numero }),
      h('span', { class: 'cand-chip-texto' }, h('strong', { text: titulo(c.nome) }), h('small', { text: `${c.partido} · ${nomeCargo(c.cargo)} · ${c.uf}` })),
      h('button', { type: 'button', class: 'botao-icone', 'aria-label': 'Remover candidato do filtro', title: 'Remover candidato', onclick: limparTudo }, icone('fechar')));
  };

  const raiz = h('div', { class: 'combo' }, h('span', { class: 'combo-icone' }, icone('busca')), entrada, lista);
  return { raiz, chip, atualizarChip };
}

// ---------------------------------------------------------------------------

export function criarFiltros(container) {
  const busca = criarBuscaCandidato();
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
      h('div', { class: 'filtros-busca' }, busca.raiz, busca.chip),
      h('div', { class: 'campo campo-turno' }, h('span', { class: 'campo-rotulo', text: 'Turno' }), turnos),
    ),
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
    const c = candidatoAtual();
    // Turno
    limpar(turnos, ['1', '2'].map(t => {
      const disp = turnoDisponivel(estado.cargo, t);
      return h('button', { type: 'button', role: 'radio', class: 'segmento', 'aria-checked': String(estado.turno === t), disabled: !disp || undefined, title: disp ? '' : 'O candidato não disputou o 2º turno', onclick: () => definir({ turno: t }) }, `${t}º`);
    }));
    // Estado: candidato estadual só existe no seu estado (o campo fica fixo); Presidente, em todos.
    const fixo = c && c.uf !== 'BR';
    sUf.disabled = !!fixo;
    preencher(sUf, cfg.ufs.filter(u => !fixo || u.sigla === c.uf).map(u => ({ valor: u.sigla, texto: `${u.nome} (${u.sigla})` })), estado.uf, fixo ? null : 'Brasil (todos)');
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
    busca.atualizarChip();
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
