// Partes comuns das páginas: carregamento do resultado, estados de espera/erro
// e cabeçalho do recorte.

import { h, limpar, icone, titulo } from '../dom.js';
import { api } from '../api.js';
import { estado, consultaAtual, contexto } from '../estado.js';

export function esqueleto(linhas = 6) {
  return h('div', { class: 'esqueleto', 'aria-busy': 'true', 'aria-label': 'Carregando' },
    Array.from({ length: linhas }, (_, i) => h('div', { class: 'esqueleto-linha', style: { width: `${90 - i * 9}%` } })));
}

// Erro com botão "Tentar novamente" (falhas de rede são as mais comuns em celulares).
export function erro(mensagem, tentarDeNovo) {
  return h('div', { class: 'aviso aviso-erro', role: 'alert' }, icone('alerta'),
    h('div', { class: 'aviso-corpo' },
      h('strong', { text: 'Não foi possível carregar este recorte' }),
      h('p', { text: mensagem }),
      tentarDeNovo ? h('button', { type: 'button', class: 'botao-secundario', onclick: tentarDeNovo }, 'Tentar novamente') : null));
}

// Situação esperada (ex.: dado não incluído, seção inexistente): aviso neutro, não erro.
export function informacao(mensagem) {
  return h('div', { class: 'aviso', role: 'status' }, icone('info'), h('p', { text: mensagem }));
}

// Calcula o resultado do recorte atual a partir dos arquivos estáticos.
// `aoReceber(dados)` é chamado com o resultado; consultas antigas são descartadas.
export function criarCarregador(container, aoReceber) {
  let seq = 0;
  return async function carregar() {
    const minha = ++seq;
    const cargo = contexto.config.cargos.find(c => c.id === estado.cargo);
    // Tela inicial vazia: nada é carregado até escolher um candidato ou um cargo.
    if (!cargo) { limpar(container); return; }
    if (!estado.uf && cargo && !cargo.nacional) {
      limpar(container, h('div', { class: 'aviso' }, icone('info'), h('div', {}, h('strong', { text: `Escolha um estado` }), h('p', { text: `Os resultados de ${cargo.nome} são por estado. Selecione o estado no filtro acima.` }))));
      return;
    }
    // Só mostra o esqueleto se a resposta demorar (evita piscar em respostas instantâneas).
    const espera = setTimeout(() => { if (minha === seq) limpar(container, esqueleto()); }, 150);
    try {
      const dados = await api('/api/resultado', consultaAtual());
      clearTimeout(espera);
      if (minha === seq) aoReceber(dados);
    } catch (e) {
      clearTimeout(espera);
      if (minha !== seq) return;
      // 400/404 = recorte sem dados ou inválido (situação esperada); demais = falha de rede/servidor.
      limpar(container, e.status === 400 || e.status === 404 ? informacao(e.message) : erro(e.message, carregar));
    }
  };
}

export function partesRecorte(e) {
  const p = [e.ufNome];
  if (e.munNome) p.push(titulo(e.munNome));
  if (e.zona) p.push(`Zona ${e.zona}`);
  if (e.bairro) p.push(`Bairro ${titulo(e.bairro)}`);
  if (e.local) p.push(e.localNome ? titulo(e.localNome) : `Local ${e.local}`);
  if (e.secao) p.push(`Seção ${e.secao}${e.localNome && !e.local ? ` (${titulo(e.localNome)})` : ''}`);
  return p;
}

// Datas do TSE chegam como "dd/mm/aaaa hh:mm:ss" (EA20) ou cabeçalho HTTP (dados abertos).
function formatarData(s) {
  if (!s || /^\d{2}\/\d{2}\/\d{4}/.test(s)) return s;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
}

export function cabecalhoRecorte(dados, subtitulo) {
  const partes = partesRecorte(dados.escopo);
  return h('header', { class: 'recorte' },
    h('div', { class: 'recorte-titulo' },
      h('span', { class: 'etiqueta', text: `${dados.turno}º turno` }),
      h('h2', { text: dados.cargo.nome }),
    ),
    h('nav', { class: 'migalhas', 'aria-label': 'Recorte selecionado' },
      h('ol', {}, partes.map(p => h('li', { text: p })))),
    dados.escopo.endereco ? h('p', { class: 'recorte-sub', text: `Endereço do local de votação: ${titulo(dados.escopo.endereco)}` }) : null,
    subtitulo ? h('p', { class: 'recorte-sub', text: subtitulo }) : null);
}

export function rodapeFonte(dados) {
  const nivelSecao = dados.fonte.tipo === 'votacao_secao';
  return h('p', { class: 'fonte' }, icone('info'),
    h('span', {},
      `Fonte: ${dados.fonte.descricao}`,
      dados.fonte.atualizadoEm ? ` · atualizado em ${formatarData(dados.fonte.atualizadoEm)}` : '',
      nivelSecao ? '. Soma exata dos votos das seções do recorte; nenhum valor é estimado.' : '.'));
}

// Candidato selecionado no filtro (se pertencer ao cargo e à UF consultados: o mesmo número
// identifica candidatos diferentes em cada estado).
export function candidatoDoFiltro(dados) {
  const c = contexto.candidato;
  if (!c || !estado.cand || c.cargo !== dados.cargo.id) return null;
  if (c.uf !== 'BR' && c.uf !== dados.escopo.uf) return null;
  return c;
}
