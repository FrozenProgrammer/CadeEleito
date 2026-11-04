// Início (rota #/resultados): busca do candidato, cartão com os números dele no recorte
// escolhido nos filtros (pronto para compartilhar nas redes) e, abaixo, o mapa de densidade.
// Comparação (2º candidato nos filtros): dois cartões lado a lado. No mesmo estado, os dois no
// mesmo recorte; em estados diferentes, o do foco no recorte e o outro com o total do estado dele.

import { h, limpar, numero, pct, titulo, situacao, icone, fotoCandidato, urlFoto } from '../dom.js';
import { estado, contexto, urlPara, consultaAtual } from '../estado.js';
import { api } from '../api.js';
import { acoesCompartilhar } from '../compartilhar.js';
import { rodapeFonte, candidatoDoFiltro, partesRecorte, esqueleto, erro, informacao } from './comum.js';
import { candidatoA, candidatoB, candidatoPrincipal, compativeis, coresDuelo } from '../comparacao.js';
import { criarPaginaMapa } from './mapa.js';
import { feminino, cargoDe, eleitoDe, situacaoDe } from '../genero.js';

// Situação do TSE: "Eleito", "Eleito por QP", "Eleito por média" (nunca "Não eleito"/"Suplente").
const eleito = s => /^eleit/i.test(s || '');
const selo = c => h('span', { class: 'selo-eleito', text: eleitoDe(c) }); // Eleito / Eleita

// Logo "lupa no mapa" (o mesmo do título), para o cartão sair com a marca no print.
const logo = () => h('svg:svg', { class: 'social-logo', viewBox: '0 0 64 64', 'aria-hidden': 'true' },
  h('svg:circle', { cx: '27', cy: '27', r: '17', class: 'lg-s1', 'stroke-width': '6' }),
  h('svg:path', { d: 'M40 40 55 55', class: 'lg-s1', 'stroke-width': '8', 'stroke-linecap': 'round' }),
  h('svg:path', { d: 'M27 15.5a8 8 0 0 1 8 8c0 6.2-8 13.5-8 13.5s-8-7.3-8-13.5a8 8 0 0 1 8-8zM27 20.5a3 3 0 1 0 0 6a3 3 0 1 0 0-6z', 'fill-rule': 'evenodd', class: 'lg-f2' }));

function metrica(valor, rotulo) {
  return h('div', { class: 'social-metrica' }, h('strong', { text: valor }), h('span', { text: rotulo }));
}

// Cartão do candidato no recorte. Sem votos no recorte, mostra zero (também é informação).
// Os textos concordam com o gênero da pessoa (Deputada, Eleita…: ver js/genero.js).
function cartaoCandidato(c, d) {
  const cargo = cargoDe(d.cargo.nome, c);
  const linha = d.candidatos.find(x => x.numero === c.numero);
  const lider = d.candidatos[0];
  const local = partesRecorte(d.escopo).join(' › ');
  const sit = linha?.situacao || c.situacao || '';
  const info = {
    nome: titulo(c.nome), numero: c.numero, partido: c.partido, cargo, uf: c.uf, situacao: sit, eleito: eleito(sit), eleitoTexto: eleitoDe(c).toUpperCase(),
    local, votos: linha?.votos || 0, percentual: linha?.percentual || 0, posicao: linha?.posicao || 0, total: d.candidatos.length, turno: d.turno,
    url: new URL(urlPara('resultados'), location.href).href, foto: urlFoto(c),
  };
  const dif = linha && lider && lider !== linha ? lider.votos - linha.votos : null;
  const cartao = h('section', { class: 'cartao-social', 'aria-label': `Cartão de ${info.nome}` },
    h('div', { class: 'social-topo' },
      h('span', { class: 'social-marca' }, logo(), 'Cadê o eleito?'),
      h('span', { class: 'social-eleicao', text: `Eleições 2026 · ${d.turno}º turno` })),
    h('div', { class: 'social-cand' },
      h('div', { class: 'destaque-num', text: c.numero }),
      h('div', { class: 'social-nome' },
        h('span', { class: 'destaque-sobre', text: [c.partido, cargo, c.uf !== 'BR' ? c.uf : ''].filter(Boolean).join(' · ') }),
        h('h3', {}, info.nome, info.eleito ? selo(c) : null),
        sit ? h('p', { text: situacaoDe(situacao(sit), c) }) : null),
      fotoCandidato(c, 'social-foto')),
    h('div', { class: 'social-local' }, icone('mapa'),
      h('div', {}, h('span', { class: 'social-rotulo', text: 'Onde' }), h('strong', { text: local }),
        d.escopo.endereco ? h('small', { text: titulo(d.escopo.endereco) }) : null)),
    h('div', { class: 'social-metricas' },
      metrica(numero(info.votos), 'votos'),
      metrica(pct(info.percentual), 'dos votos válidos'),
      metrica(linha ? `${linha.posicao}º` : '—', `de ${numero(d.candidatos.length)} candidatos`),
      linha ? (dif !== null ? metrica(numero(dif), `votos atrás de ${titulo(lider.nome)}`) : metrica('1º', feminino(c) ? 'mais votada aqui' : 'mais votado aqui')) : null),
    h('p', { class: 'social-fonte', text: 'Dados oficiais do TSE' }));
  return [cartao, acoesCompartilhar(info)];
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
