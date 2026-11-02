// Inicialização do site: configuração, roteamento por hash e páginas.

// Proteção contra exibição dentro de frames de outros sites (clickjacking) em hospedagens que
// não permitem o cabeçalho X-Frame-Options/frame-ancestors (ex.: GitHub Pages).
if (window.top !== window.self) {
  document.documentElement.hidden = true;
  try { window.top.location = window.self.location.href; } catch { /* bloqueado: a página fica oculta */ }
  throw new Error('Exibição em frame bloqueada.');
}

import { h, $, limpar, icone } from './dom.js';
import { api } from './api.js';
import { estado, contexto, aoMudar, iniciarEstado, urlPara, definir } from './estado.js';
import { criarFiltros, normalizarEstado } from './filtros.js';
import { criarPaginaResultados } from './paginas/resultados.js';
import { criarPaginaMapa } from './paginas/mapa.js';
import { criarPaginaTipografia } from './paginas/tipografia.js';

const TITULOS = { resultados: 'Resultados', mapa: 'Mapa', sobre: 'Sobre os dados', tipografia: 'Typography' };
const paginas = {};

function atualizarNavegacao() {
  for (const a of document.querySelectorAll('[data-pagina]')) {
    const ativa = a.dataset.pagina === estado.pagina;
    a.setAttribute('href', urlPara(a.dataset.pagina));
    if (ativa) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  for (const s of document.querySelectorAll('.pagina')) s.hidden = s.id !== `pagina-${estado.pagina}`;
  $('#filtros').hidden = estado.pagina === 'sobre' || estado.pagina === 'tipografia';
  // Cada página tem a sua cor de destaque (ver css/app.css, "temas por página").
  document.body.dataset.pagina = estado.pagina;
  document.title = `${TITULOS[estado.pagina]} · Cadê o eleito? · Eleições 2026`;
}

function renderizarPagina() {
  atualizarNavegacao();
  paginas[estado.pagina]?.carregar();
}

// Candidatos da URL (o 1º e, na comparação, o 2º). Id inexistente sai da URL.
async function restaurarCandidato() {
  const carregar = async (campo, chave) => {
    if (!estado[campo]) { contexto[chave] = null; return; }
    if (contexto[chave]?.id === estado[campo]) return;
    try { contexto[chave] = await api('/api/candidato', { id: estado[campo] }); } catch { contexto[chave] = null; definir({ [campo]: '' }); }
  };
  await Promise.all([carregar('cand', 'candidato'), carregar('cand2', 'candidato2')]);
}

async function iniciar() {
  iniciarEstado();
  try {
    contexto.config = await api('/api/config');
  } catch (e) {
    limpar($('#principal'), h('div', { class: 'aviso aviso-erro', role: 'alert' }, icone('alerta'), h('div', {}, h('strong', { text: 'O servidor não respondeu.' }), h('p', { text: e.message }))));
    return;
  }
  const cfg = contexto.config;
  $('#sobre-geracao').textContent = `Publicação gerada em ${new Date(cfg.geradoEm).toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' })}. `
    + (cfg.detalhadas.length === cfg.ufs.length ? 'Todos os estados têm detalhamento por bairro, local e seção.' : `Detalhamento por bairro, local e seção: ${cfg.detalhadas.join(', ') || 'nenhum estado'}.`);
  await restaurarCandidato();
  const filtros = criarFiltros($('#filtros'));
  paginas.resultados = criarPaginaResultados($('#pagina-resultados'));
  // Aba Mapa: clicar num município só o seleciona (o mapa por zona/local fica na página inicial).
  paginas.mapa = criarPaginaMapa($('#pagina-mapa'), { abrirCidade: false });
  paginas.tipografia = criarPaginaTipografia($('#pagina-tipografia'));
  await filtros.iniciar();
  // Logo do topo: página inicial sem nenhum filtro (o endereço sem parâmetros zera tudo).
  $('#inicio').addEventListener('click', e => {
    e.preventDefault();
    contexto.candidato = null;
    contexto.candidato2 = null;
    if (location.hash !== '#/resultados') location.hash = '#/resultados';
    window.scrollTo({ top: 0 });
    $('#cand-busca')?.focus({ preventScroll: true });
  });
  aoMudar(async mudou => {
    // O cargo e o estado vêm do candidato: depois de carregá-lo, aplica as regras de novo.
    if (mudou.has('cand') || mudou.has('cand2')) { await restaurarCandidato(); normalizarEstado(); filtros.render(); }
    renderizarPagina();
    if (mudou.has('pagina')) window.scrollTo({ top: 0 });
  });
  renderizarPagina();
}

iniciar();
