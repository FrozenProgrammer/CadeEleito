// Início (rota #/resultados): busca do candidato, cartão com os números dele no recorte
// escolhido nos filtros (pronto para compartilhar nas redes) e, abaixo, o mapa de densidade.
// Comparação (2º candidato nos filtros): dois cartões lado a lado. No mesmo estado, os dois no
// mesmo recorte; em estados diferentes, o do foco no recorte e o outro com o total do estado dele.

import { h, limpar, numero, pct, titulo, situacao, icone, fotoCandidato, urlFoto } from '../dom.js';
import { estado, contexto, urlPara, consultaAtual } from '../estado.js';
import { api } from '../api.js';
import { acoesCompartilhar, dominioSite } from '../compartilhar.js';
import { paletaCartao } from '../partidos.js';
import { rodapeFonte, candidatoDoFiltro, partesRecorte, esqueleto, erro, informacao } from './comum.js';
import { candidatoA, candidatoB, candidatoPrincipal, compativeis, coresDuelo } from '../comparacao.js';
import { criarPaginaMapa } from './mapa.js';
import { feminino, cargoDe, situacaoDe } from '../genero.js';

// Situação do TSE em quatro tipos (cor da etiqueta, sempre com o texto): eleito, não eleito,
// foi ao 2º turno e outros (suplente…). "Eleito por QP"/"Eleito por média" contam como eleito.
const tipoSituacao = s => (/^eleit/i.test(s) ? 'eleito' : /2\s*º?\s*turno/i.test(s) ? 'segundo' : /^n[aã]o eleit/i.test(s) ? 'nao' : 'outro');
// Números grandes curtos: 53.412.345 -> "53,4 mi"; 12.345 -> "12,3 mil".
const compacto = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

// Logo "lupa no mapa" (o mesmo do título), para o cartão sair com a marca no print.
const logo = () => h('svg:svg', { class: 'social-logo', viewBox: '0 0 64 64', 'aria-hidden': 'true' },
  h('svg:circle', { cx: '27', cy: '27', r: '17', class: 'lg-s1', 'stroke-width': '6' }),
  h('svg:path', { d: 'M40 40 55 55', class: 'lg-s1', 'stroke-width': '8', 'stroke-linecap': 'round' }),
  h('svg:path', { d: 'M27 15.5a8 8 0 0 1 8 8c0 6.2-8 13.5-8 13.5s-8-7.3-8-13.5a8 8 0 0 1 8-8zM27 20.5a3 3 0 1 0 0 6a3 3 0 1 0 0-6z', 'fill-rule': 'evenodd', class: 'lg-f2' }));

const caixa = ({ rotulo, valor, detalhe }) => h('div', { class: 'social-caixa' },
  h('span', { class: 'social-rotulo', text: rotulo }), h('strong', { text: valor }), h('span', { class: 'social-detalhe', text: detalhe }));

// Dados do cartão (os mesmos na página e na imagem para o Instagram, em js/compartilhar.js).
function dadosCartao(c, d) {
  const cargo = cargoDe(d.cargo.nome, c);
  const linha = d.candidatos.find(x => x.numero === c.numero);
  const [lider, segundo] = d.candidatos;
  const sit = linha?.situacao || c.situacao || '';
  const total = d.candidatos.length;
  // Distância para o 1º (ou, sendo o 1º, a vantagem sobre o 2º).
  let distancia;
  if (!linha) distancia = { rotulo: 'Distância para o 1º', valor: '—', detalhe: 'sem votos neste local' };
  else if (lider !== linha) {
    const dif = lider.votos - linha.votos;
    distancia = { rotulo: 'Distância para o 1º', valor: `−${compacto.format(dif)} ${dif === 1 ? 'voto' : 'votos'}`, detalhe: `atrás de ${titulo(lider.nome)}` };
  } else if (segundo) {
    const dif = linha.votos - segundo.votos;
    distancia = { rotulo: 'Vantagem sobre o 2º', valor: `+${compacto.format(dif)} ${dif === 1 ? 'voto' : 'votos'}`, detalhe: `à frente de ${titulo(segundo.nome)}` };
  } else distancia = { rotulo: 'Vantagem sobre o 2º', valor: '—', detalhe: `${feminino(c) ? 'única candidata' : 'único candidato'} neste local` };
  return {
    nome: titulo(c.nome), numero: c.numero, partido: c.partido, cargo, uf: c.uf, turno: d.turno,
    situacao: sit ? situacaoDe(situacao(sit), c) : '', tipoSituacao: tipoSituacao(sit),
    local: partesRecorte(d.escopo).join(' › '), endereco: d.escopo.endereco ? titulo(d.escopo.endereco) : '',
    votos: linha?.votos || 0, percentual: linha?.percentual || 0, posicao: linha?.posicao || 0, total,
    colocacao: { rotulo: 'Colocação', valor: linha ? `${linha.posicao}º lugar` : '—', detalhe: `de ${numero(total)} ${total === 1 ? 'candidato' : 'candidatos'}` },
    distancia, cores: paletaCartao(c.partido), dominio: dominioSite(),
    url: new URL(urlPara('resultados'), location.href).href, foto: urlFoto(c),
  };
}

// Cartão do candidato no recorte. Sem votos no recorte, mostra zero (também é informação).
// Os textos concordam com o gênero da pessoa (Deputada, Eleita…: ver js/genero.js).
// Cores do partido (js/partidos.js): faixa do topo metade de cada cor, moldura da foto, número e barra.
function cartaoCandidato(c, d) {
  const i = dadosCartao(c, d);
  const barra = h('div', { class: 'social-barra', role: 'img', 'aria-label': `${pct(i.percentual)} dos votos válidos` }, h('span'));
  const cartao = h('section', { class: 'cartao-social', 'aria-label': `Cartão de ${i.nome}` },
    h('div', { class: 'social-faixa', 'aria-hidden': 'true' }),
    h('div', { class: 'social-topo' },
      h('span', { class: 'social-marca' }, logo(), 'Cadê o eleito?'),
      h('span', { class: 'social-eleicao', text: `Eleições 2026 · ${i.turno}º turno` })),
    h('div', { class: 'social-cand' },
      fotoCandidato(c, 'social-foto'),
      h('div', { class: 'social-ident' },
        h('p', { class: 'social-sobre' }, h('strong', { text: i.partido }), ` · ${i.cargo} · `, h('span', { class: 'social-local' }, h('strong', { text: i.local }))),
        i.endereco ? h('p', { class: 'social-endereco', text: i.endereco }) : null,
        h('div', { class: 'social-nome' }, h('span', { class: 'social-num', text: i.numero }), h('h3', { text: i.nome })),
        i.situacao ? h('span', { class: `social-status status-${i.tipoSituacao}`, text: i.situacao }) : null)),
    h('div', { class: 'social-votos' },
      h('div', { class: 'social-votos-linha' },
        h('div', {}, h('span', { class: 'social-rotulo', text: 'Votos obtidos' }), h('strong', { class: 'social-votos-num', text: numero(i.votos) })),
        h('span', { class: 'social-pct', text: pct(i.percentual) })),
      barra),
    h('div', { class: 'social-caixas' }, caixa(i.colocacao), caixa(i.distancia)),
    h('div', { class: 'social-rodape' }, h('span', { text: 'Dados oficiais do TSE' }), h('span', { text: i.dominio })));
  const k = i.cores;
  cartao.style.setProperty('--p1', k.c1);
  cartao.style.setProperty('--p2', k.c2);
  cartao.style.setProperty('--p2-claro', k.faixa2.claro);
  cartao.style.setProperty('--barra-escuro', k.barra.escuro);
  cartao.style.setProperty('--barra-claro', k.barra.claro);
  cartao.style.setProperty('--num-fundo', k.numFundo);
  cartao.style.setProperty('--num-texto', k.numTexto);
  if (k.trilho) cartao.style.setProperty('--trilho', k.trilho);
  barra.style.setProperty('--pct', String(Math.min(100, Math.max(0, i.percentual)) / 100));
  return [cartao, acoesCompartilhar(i)];
}

// Linha de resumo do duelo (mesmo cargo e mesmo recorte: votos comparáveis).
function resumoDuelo([a, b], [da, db]) {
  const va = da.candidatos.find(x => x.numero === a.numero)?.votos || 0;
  const vb = db.candidatos.find(x => x.numero === b.numero)?.votos || 0;
  const local = partesRecorte(da.escopo).join(' › ');
  if (va === vb) return h('p', { class: 'comparacao-resumo', text: `Empate em ${local}: ${numero(va)} votos para cada um.` });
  const [lider, outro, dif] = va > vb ? [a, b, va - vb] : [b, a, vb - va];
  return h('p', { class: 'comparacao-resumo' }, h('strong', { text: titulo(lider.nome) }), ` teve ${numero(dif)} ${dif === 1 ? 'voto' : 'votos'} a mais que ${titulo(outro.nome)} em ${local}.`);
}

export function criarPaginaResultados(raiz) {
  const conteudo = h('div', { class: 'pagina-conteudo' });
  const areaMapa = h('div', { class: 'resultados-mapa', hidden: true });
  const fonte = h('div', { class: 'resultados-fonte' });
  limpar(raiz, conteudo, areaMapa, fonte);
  const mapa = criarPaginaMapa(areaMapa);

  // Um só carregador para um ou dois cartões (respostas antigas são descartadas pelo seq).
  let seq = 0;
  const falha = (e, deNovo) => (e.status === 400 || e.status === 404 ? informacao(e.message) : erro(e.message, deNovo));
  async function carregar() {
    const minha = ++seq;
    const cargo = contexto.config.cargos.find(c => c.id === estado.cargo);
    const a = candidatoA(), b = candidatoB();
    if (!cargo || !a) { limpar(conteudo); limpar(fonte); return; }
    if (!estado.uf && !cargo.nacional) {
      limpar(conteudo, informacao(`Os resultados de ${cargo.nome} são por estado. Selecione o estado no filtro acima.`));
      return;
    }
    const duelo = compativeis(a, b);
    const p = candidatoPrincipal();
    // Estados diferentes: o candidato fora do foco aparece com o total do estado dele.
    const consulta = c => (!b || duelo || c === p ? consultaAtual({ cargo: c.cargo }) : { turno: estado.turno, cargo: c.cargo, uf: c.uf === 'BR' ? '' : c.uf });
    const lista = b ? [a, b] : [a];
    // Só mostra o esqueleto se a resposta demorar (evita piscar em respostas instantâneas).
    const espera = setTimeout(() => { if (minha === seq) limpar(conteudo, esqueleto()); }, 150);
    const res = await Promise.allSettled(lista.map(c => api('/api/resultado', consulta(c))));
    clearTimeout(espera);
    if (minha !== seq) return;
    const ok = res.map(r => (r.status === 'fulfilled' ? r.value : null));
    // A fonte dos dados fica abaixo do mapa.
    limpar(fonte, ok.find(Boolean) ? rodapeFonte(ok.find(Boolean)) : null);
    if (!b) {
      if (!ok[0]) return limpar(conteudo, falha(res[0].reason, carregar));
      const c = candidatoDoFiltro(ok[0]);
      return limpar(conteudo, c ? cartaoCandidato(c, ok[0]) : null);
    }
    const cores = coresDuelo(a, b);
    const itens = lista.map((c, i) => {
      const item = h('div', { class: 'comparacao-item' }, ok[i] ? cartaoCandidato(c, ok[i]) : falha(res[i].reason, carregar));
      item.style.setProperty('--lado', cores[i]);
      return item;
    });
    // Estados diferentes: uma nota só, acima dos dois cartões (eles continuam alinhados).
    const fora = duelo ? null : lista.find(c => c !== p);
    limpar(conteudo,
      fora ? h('p', { class: 'comparacao-nota' }, icone('info'),
        h('span', { text: `${titulo(fora.nome)} é de outro estado: o cartão mostra o total do estado (${fora.uf}). Os filtros seguem ${titulo(p.nome)}; para ver ${titulo(fora.nome)} por município, use "Mapa de" no mapa abaixo.` })) : null,
      h('div', { class: 'comparacao', role: 'group', 'aria-label': `Comparação entre ${titulo(a.nome)} e ${titulo(b.nome)}` }, itens),
      duelo && a.cargo === b.cargo && ok[0] && ok[1] ? resumoDuelo(lista, ok) : null);
  }

  return {
    carregar() {
      // Sem candidato: a página é só a busca (o cartão e o mapa aparecem depois de escolher).
      areaMapa.hidden = !estado.cand;
      if (!estado.cand) { limpar(conteudo); limpar(fonte); return; }
      carregar();
      mapa.carregar();
    },
  };
}
