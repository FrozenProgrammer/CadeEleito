// Página "Mapa": Brasil por UF e cada estado por município, coloridos pelo
// partido mais votado. Clicar em uma área aplica o filtro e mostra o resultado.

import { h, limpar, numero, pct, titulo, icone } from '../dom.js';
import { api } from '../api.js';
import { estado, contexto, definir, urlPara } from '../estado.js';
import { barras, mostrarTooltip, esconderTooltip } from '../grafico.js';
import { criarCarregador, rodapeFonte, esqueleto, erro, partesRecorte } from './comum.js';

const MAX_CORES = 3; // limite validado para mapas (todas as cores lado a lado)

function classeCor(sigla, cores) {
  if (!sigla) return 'cor-sem';
  const i = cores.indexOf(sigla);
  return i >= 0 ? `cor-${i + 1}` : 'cor-outros';
}

// Conteúdo do tooltip: nome da área e os 3 mais votados com barras de % dos votos válidos.
// Usa candidatos quando disponíveis; senão, os 3 partidos mais votados.
// A cor de cada barra é a do partido na legenda, ligando o tooltip ao mapa.
function conteudoTooltip(nome, l, top, cores) {
  const linhas = top?.length
    ? top.map(([cand, partido, p]) => ({ rotulo: titulo(cand), detalhe: partido, partido, p }))
    : (l?.top3 || []).map(([sigla, p]) => ({ rotulo: sigla, detalhe: '', partido: sigla, p }));
  if (!linhas.length) return h('div', { class: 'tt-mapa' }, h('strong', { text: nome }), h('span', { class: 'tt-nota', text: 'Sem dados de votação.' }));
  const maior = Math.max(...linhas.map(x => x.p), 1);
  return h('div', { class: 'tt-mapa' },
    h('strong', { class: 'tt-titulo', text: nome }),
    h('div', { class: 'tt-linhas' }, linhas.map(x => h('div', { class: 'tt-linha' },
      h('span', { class: 'tt-nome' }, x.rotulo, x.detalhe ? h('small', { text: ` ${x.detalhe}` }) : null),
      h('span', { class: 'tt-trilho', 'aria-hidden': 'true' }, h('span', { class: `tt-barra ${classeCor(x.partido, cores)}`, style: { width: `${Math.max(2, (x.p / maior) * 100)}%` } })),
      h('span', { class: 'tt-pct', text: pct(x.p) })))),
    h('span', { class: 'tt-nota', text: top?.length ? '% dos votos válidos' : 'Partidos mais votados · % dos votos válidos' }));
}

function legenda(cores, ranking, unidade) {
  const outros = ranking.slice(MAX_CORES).reduce((a, r) => a + r.locais, 0);
  return h('ul', { class: 'legenda', 'aria-label': 'Legenda do mapa' },
    cores.map((s, i) => h('li', {}, h('span', { class: `legenda-cor cor-${i + 1}` }), h('strong', { text: s }), h('span', { text: `${ranking[i].locais} ${unidade}` }))),
    outros ? h('li', {}, h('span', { class: 'legenda-cor cor-outros' }), h('strong', { text: 'Outros' }), h('span', { text: `${outros} ${unidade}` })) : null);
}

export function criarPaginaMapa(raiz) {
  const titulo1 = h('h2');
  const subtitulo = h('p', { class: 'recorte-sub' });
  const voltar = h('button', { type: 'button', class: 'botao-secundario', hidden: true, onclick: () => definir({ uf: '' }) }, icone('voltar'), 'Brasil');
  const area = h('div', { class: 'mapa-area' });
  const leg = h('div', { class: 'mapa-legenda' });
  const tabela = h('div', { class: 'mapa-tabela' });
  const painel = h('div', { class: 'mapa-painel-conteudo' });

  limpar(raiz, h('div', { class: 'pagina-conteudo' },
    h('div', { class: 'mapa-layout' },
      h('section', { class: 'cartao mapa-cartao' },
        h('div', { class: 'cartao-topo' }, h('div', {}, titulo1, subtitulo), voltar),
        area, leg, tabela),
      h('aside', { class: 'cartao mapa-painel', 'aria-live': 'polite' }, painel))));

  let seq = 0;
  let caminhos = new Map(); // id -> path

  const carregarPainel = criarCarregador(painel, d => {
    const top = d.candidatos.slice(0, 5).map(c => ({ rotulo: titulo(c.nome), detalhe: `${c.partido} · ${c.numero}`, votos: c.votos, percentual: c.percentual }));
    limpar(painel,
      h('span', { class: 'etiqueta', text: `${d.cargo.nome} · ${d.turno}º turno` }),
      h('h3', { class: 'painel-titulo', text: d.escopo.munNome ? titulo(d.escopo.munNome) : d.escopo.ufNome }),
      d.escopo.nivel !== 'brasil' ? h('p', { class: 'recorte-sub', text: partesRecorte(d.escopo).join(' › ') }) : null,
      h('div', { class: 'painel-kpis' },
        h('div', {}, h('strong', { text: numero(d.totais.validos) }), h('span', { text: 'votos válidos' })),
        // Sem eleitorado conhecido (ex.: 2º turno por município) não há base para o percentual.
        d.totais.comparecimento && d.totais.eleitorado ? h('div', {}, h('strong', { text: pct((d.totais.comparecimento / d.totais.eleitorado) * 100) }), h('span', { text: 'comparecimento' })) : null),
      barras(top, { titulo: 'Mais votados', rotuloColuna: 'Candidato' }),
      h('a', { class: 'botao-primario', href: urlPara('resultados') }, 'Ver resultado completo'),
      rodapeFonte(d));
  });

  function destacarSelecao() {
    const alvo = estado.uf ? estado.mun : '';
    for (const [id, p] of caminhos) {
      const sel = !!alvo && id === alvo;
      p.classList.toggle('selecionado', sel);
      if (sel) p.parentNode.append(p); // desenha por último para o contorno não ficar encoberto
    }
  }

  async function desenhar() {
    const minha = ++seq;
    const nacional = !estado.uf;
    const cargo = contexto.config.cargos.find(c => c.id === estado.cargo);
    voltar.hidden = nacional;
    titulo1.textContent = nacional ? 'Brasil' : contexto.config.ufs.find(u => u.sigla === estado.uf)?.nome || estado.uf;
    subtitulo.textContent = !cargo
      ? `Escolha um cargo no filtro para colorir o mapa${nacional ? ', ou clique em um estado' : ''}.`
      : nacional
      ? (cargo.nacional ? `Partido mais votado por estado · ${cargo.nome}, ${estado.turno}º turno. Clique em um estado.` : 'Clique em um estado para ver os municípios.')
      : `Partido mais votado por município · ${cargo.nome}, ${estado.turno}º turno. Clique em um município.`;
    limpar(area, esqueleto(3));
    limpar(leg); limpar(tabela);
    try {
      const [malha, lid] = await Promise.all([
        nacional ? api('/api/mapa/brasil') : api('/api/mapa/uf', { uf: estado.uf }),
        !cargo || (nacional && !cargo.nacional) ? Promise.resolve(null) : api('/api/mapa/lideres', { cargo: estado.cargo, turno: estado.turno, uf: estado.uf }).catch(() => null),
      ]);
      if (minha !== seq) return;
      const ranking = lid?.ranking || [];
      const cores = ranking.slice(0, MAX_CORES).map(r => r.sigla);
      const unidade = nacional ? 'UFs' : 'municípios';
      const itens = nacional ? malha.ufs.map(u => ({ id: u.uf, nome: u.nome, d: u.d, cx: u.cx, cy: u.cy })) : malha.municipios.map(m => ({ id: m.cd, nome: titulo(m.nm), d: m.d }));
      caminhos = new Map();
      const svg = h('svg:svg', { viewBox: malha.viewBox, class: 'mapa-svg', role: 'group', 'aria-label': `Mapa: ${titulo1.textContent}` });
      const grupo = h('svg:g', {});
      for (const it of itens) {
        const l = lid?.lideres?.[it.id];
        const top = lid?.top3?.[it.id];
        const rotuloAcessivel = [it.nome, ...(top || []).map(([c, p, v]) => `${titulo(c)} (${p}) ${pct(v)}`), !top && l ? `${l.sigla} lidera com ${pct(l.percentual)}` : '', !l ? 'Sem dados de votação' : ''].filter(Boolean).join('. ');
        const escolher = () => { esconderTooltip(); nacional ? definir({ uf: it.id }) : definir({ mun: estado.mun === it.id ? '' : it.id }); };
        // O conteúdo do tooltip é montado só ao passar o mouse (mapas estaduais têm centenas de áreas).
        let dica = null;
        const mostrar = e => mostrarTooltip(e, (dica ||= conteudoTooltip(it.nome, l, top, cores)));
        const p = h('svg:path', {
          d: it.d, class: `mapa-regiao ${classeCor(l?.sigla, cores)}`, 'aria-label': rotuloAcessivel,
          // Teclado: só as 27 UFs viram paradas de Tab; municípios são escolhidos pelo filtro ou pela tabela.
          tabindex: nacional ? '0' : undefined, role: nacional ? 'button' : undefined,
          onclick: escolher, onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); escolher(); } },
          onmousemove: mostrar, onmouseleave: esconderTooltip, onfocus: mostrar, onblur: esconderTooltip,
        });
        caminhos.set(it.id, p);
        grupo.append(p);
      }
      svg.append(grupo);
      if (nacional) svg.append(h('svg:g', { class: 'mapa-rotulos', 'aria-hidden': 'true' }, itens.map(it => h('svg:text', { x: it.cx, y: it.cy, text: it.id }))));
      limpar(area, svg);
      if (cores.length) limpar(leg, legenda(cores, ranking, unidade));
      // Visão em tabela (acessibilidade e leitura exata).
      if (lid) {
        const linhas = itens.map(it => ({ it, l: lid.lideres[it.id] })).filter(x => x.l).sort((a, b) => a.it.nome.localeCompare(b.it.nome, 'pt-BR'));
        limpar(tabela, h('details', { class: 'tabela-dados' },
          h('summary', { text: `Ver como tabela (${linhas.length} ${unidade})` }),
          h('div', { class: 'tabela-rolagem tabela-alta' }, h('table', { class: 'tabela' },
            h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: nacional ? 'Estado' : 'Município' }), h('th', { scope: 'col', text: 'Partido líder' }), h('th', { scope: 'col', class: 'num', text: '% válidos' }), h('th', { scope: 'col', class: 'num', text: 'Votos' }))),
            h('tbody', {}, linhas.map(({ it, l }) => h('tr', {}, h('td', { text: it.nome }), h('td', { text: l.sigla }), h('td', { class: 'num', text: pct(l.percentual) }), h('td', { class: 'num', text: numero(l.votos) }))))))));
      }
      destacarSelecao();
    } catch (e) {
      if (minha === seq) limpar(area, erro(e.message, () => { chaveMapa = ''; desenhar(); }));
    }
  }

  let chaveMapa = '';
  return {
    async carregar() {
      const chave = [estado.uf, estado.cargo, estado.turno].join('|');
      if (chave !== chaveMapa) { chaveMapa = chave; desenhar(); } else destacarSelecao();
      const cargo = contexto.config.cargos.find(c => c.id === estado.cargo);
      if (!cargo) {
        limpar(painel, h('div', { class: 'aviso' }, icone('mapa'), h('p', { text: 'Escolha um cargo no filtro acima para ver os mais votados de cada região.' })));
        return;
      }
      if (!estado.uf && !cargo.nacional) {
        limpar(painel, h('div', { class: 'aviso' }, icone('mapa'), h('p', { text: `Escolha um estado no mapa para ver os resultados de ${cargo.nome}.` })));
        return;
      }
      carregarPainel();
    },
  };
}
