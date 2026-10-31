'use strict';
// Gera o site estático completo em dist/ (HTML, CSS, JS e dados pré-calculados).
// O resultado pode ser publicado em qualquer hospedagem de arquivos estáticos
// (Netlify, Cloudflare Pages, GitHub Pages, hospedagem compartilhada via FTP...).
//
// Uso:
//   npm run gerar -- todos          site completo (BR + 27 UFs com bairro/local/seção)
//   npm run gerar -- AC PE SP       só essas UFs com detalhamento por bairro/local/seção
//                                   (Brasil, estados e mapa ficam completos em qualquer caso)
//
// Arquivos de dados (JSON comprimido com gzip, extensão .bin):
//   dados/indice.bin                 configuração, cargos e UFs detalhadas
//   dados/br.bin                       Presidente no Brasil
//   dados/uf/{UF}.bin                  municípios e zonas da UF
//   dados/uf/{UF}/{turno}-{cargo}.bin  resultado oficial da UF e metadados dos candidatos daquele cargo
//   dados/m/{UF}/{mun}.bin             locais de votação/bairros, eleitorado e totais do município
//   dados/s/{UF}/{mun}/{zona}.bin      votos por seção: Presidente, Governador e Senador (+ eleitores por seção)
//   dados/s/{UF}/{mun}/{zona}-p.bin    votos por seção: Deputados (+ eleitores por seção)
//   dados/candidatos.bin               busca de candidatos
//   dados/mapa/brasil.bin, mapa/{UF}.bin          geometria (IBGE) em caminhos SVG
//   dados/mapa/lideres/{UF|BR}/{turno}-{cargo}.bin partido líder e 3 mais votados por área (tooltip)

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pathToFileURL } = require('url');
const cfg = require('../lib/config');
const tse = require('../lib/tse');
const secoes = require('../lib/secoes');
const locais = require('../lib/locais');
const mapa = require('../lib/mapa');
const { garantirDir } = require('../lib/util');

const DIST = path.join(cfg.ROOT, 'dist');
const DADOS = path.join(DIST, 'dados');
let bytesGravados = 0, arquivosGravados = 0;

function gravar(rel, obj) {
  // Partes do caminho vêm dos dados do TSE (códigos de município, zona): nada fora de dist/dados.
  if (!/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*\.bin$/.test(rel)) throw new Error(`Caminho de dados inesperado: ${rel}`);
  const f = path.join(DADOS, rel);
  garantirDir(path.dirname(f));
  // Decimais (percentuais) com 4 casas bastam para exibir 2; votos são inteiros e não mudam.
  const json = JSON.stringify(obj, (_k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1e4) / 1e4 : v));
  const buf = zlib.gzipSync(json, { level: 9 });
  fs.writeFileSync(f, buf);
  bytesGravados += buf.length;
  arquivosGravados++;
}

function copiarDir(origem, destino) {
  garantirDir(destino);
  for (const nome of fs.readdirSync(origem)) {
    const o = path.join(origem, nome), d = path.join(destino, nome);
    if (nome === 'package.json') continue; // só serve para o Node tratar public/js como ES modules
    if (fs.statSync(o).isDirectory()) copiarDir(o, d); else fs.copyFileSync(o, d);
  }
}

// [nome, partido, % dos válidos com 1 casa] dos três primeiros.
const top3 = candidatos => candidatos.slice(0, 3).map(c => [c.nome, c.partido, Math.round(c.percentual * 10) / 10]);

// Cargos e turnos disputados em cada UF.
function combinacoes(uf, eleicoes) {
  const out = [];
  for (const [id, c] of Object.entries(cfg.CARGOS)) {
    if (c.somente && !c.somente.includes(uf)) continue;
    if (c.exceto && c.exceto.includes(uf)) continue;
    for (const t of Object.keys(c.eleicoes).map(Number)) {
      if (t === 2 && id === 'governador' && !eleicoes.segundoTurnoGovernador.includes(uf)) continue;
      if (t === 2 && id === 'presidente' && !eleicoes.segundoTurnoPresidente) continue;
      out.push({ id, turno: t, codigo: String(Number(c.codigo)), proporcional: c.proporcional });
    }
  }
  return out;
}

// Junta os índices por seção da UF (cargos estaduais) e do BR (Presidente) para uma zona,
// separando cargos majoritários (Presidente, Governador, Senador) dos proporcionais (Deputados).
const PROPORCIONAIS = new Set(Object.values(cfg.CARGOS).filter(c => c.proporcional).map(c => String(Number(c.codigo))));
function zonaSeparada(uf, mun, zona) {
  const maj = {}, prop = {};
  for (const fonte of [secoes.lerZona(uf, uf, mun, zona) || {}, secoes.lerZona('BR', uf, mun, zona) || {}]) {
    for (const [t, porSecao] of Object.entries(fonte)) {
      for (const [s, sec] of Object.entries(porSecao)) {
        for (const [cargo, votos] of Object.entries(sec.c)) {
          const alvo = PROPORCIONAIS.has(cargo) ? prop : maj;
          const d = ((alvo[t] ||= {})[s] ||= { l: sec.l, c: {} });
          d.c[cargo] = votos;
        }
      }
    }
  }
  return { maj, prop };
}

async function main() {
  const t0 = Date.now();
  const args = process.argv.slice(2).map(a => a.toUpperCase());
  const detalhadas = args.includes('TODOS') ? cfg.UFS.map(u => u.sigla) : args.filter(a => cfg.UF_POR_SIGLA.has(a));
  const calc = await import(pathToFileURL(path.join(cfg.PUBLIC_DIR, 'js', 'calculo.js')).href);

  console.log(`Gerando site estático em dist/ — UFs detalhadas: ${detalhadas.length ? detalhadas.join(', ') : 'nenhuma'}`);
  const eleicoes = await tse.configEleicoes();
  const { lista: municipios } = await tse.municipios();

  // 1. Fontes por seção (baixadas e indexadas uma única vez; ficam em cache).
  const preparar = async fonte => {
    if (secoes.pronto(fonte)) return;
    let ultimo = '';
    await secoes.prepararFonte(fonte, (fase, p) => {
      const linha = `  ${fonte}: ${fase} ${(p * 100).toFixed(0)}%`;
      if (linha !== ultimo) { process.stdout.write(`\r${linha}   `); ultimo = linha; }
    });
    process.stdout.write('\n');
  };
  if (detalhadas.length) await preparar('BR');
  for (const uf of detalhadas) { await locais.garantirUf(uf); await preparar(uf); }

  // 2. Site base.
  fs.rmSync(DIST, { recursive: true, force: true });
  copiarDir(cfg.PUBLIC_DIR, DIST);
  // Endereço público (opcional): habilita prévia com imagem ao compartilhar o link e URL canônica.
  const siteUrl = String(process.env.BR_ELEICOES_SITE_URL || '').trim().replace(/\/+$/, '');
  const indexHtml = path.join(DIST, 'index.html');
  let html = fs.readFileSync(indexHtml, 'utf8');
  const marcador = /\s*<!-- SITE_URL:.*?-->/;
  if (siteUrl) {
    if (!/^https:\/\/[a-z0-9.-]+(\/[\w./-]*)?$/i.test(siteUrl)) throw new Error('BR_ELEICOES_SITE_URL deve ser um endereço https, ex.: https://eleicoes.exemplo.com.br');
    html = html.replace(marcador, `
  <link rel="canonical" href="${siteUrl}/">
  <meta property="og:url" content="${siteUrl}/">
  <meta property="og:image" content="${siteUrl}/img/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">`);
  } else {
    html = html.replace(marcador, '');
    console.log('Dica: defina BR_ELEICOES_SITE_URL=https://seu-dominio para ativar a imagem de prévia ao compartilhar links.');
  }
  fs.writeFileSync(indexHtml, html);

  // 3. Brasil (Presidente). Os dados do mapa ficam em arquivos próprios, carregados só na página Mapa.
  const br = { resultados: {} };
  const top3Br = {};
  for (const t of [1, 2]) {
    if (t === 2 && !eleicoes.segundoTurnoPresidente) continue;
    br.resultados[`${t}|presidente`] = await tse.resultadoEa20({ cargoId: 'presidente', turno: t, uf: null });
  }

  // 4. UFs, municípios e zonas.
  for (const u of cfg.UFS) {
    const uf = u.sigla;
    const combos = combinacoes(uf, eleicoes);
    const munsUf = municipios.filter(m => m.uf === uf);
    const detalhada = detalhadas.includes(uf);
    const meta = {};
    // Por cargo e turno: resultado oficial da UF + metadados dos candidatos (só o cargo consultado é baixado).
    for (const c of combos) {
      const k = `${c.turno}|${c.id}`;
      const resultado = await tse.resultadoEa20({ cargoId: c.id, turno: c.turno, uf });
      meta[k] = await tse.metaCompacta(c.id, c.turno, uf);
      gravar(`uf/${uf}/${c.turno}-${c.id}.bin`, { resultado, meta: meta[k] });
      if (c.id === 'presidente') (top3Br[c.turno] ||= {})[uf] = top3(resultado.candidatos);
    }
    // Três candidatos mais votados por município (tooltip do mapa).
    const topMun = {};
    let atualizado = {};
    if (detalhada) {
      atualizado = { secoes: secoes.manifesto(uf)?.fonteAtualizadaEm || '', presidente: secoes.manifesto('BR')?.fonteAtualizadaEm || '' };
      let zonasGravadas = 0;
      for (const m of munsUf) {
        const idx = await locais.locaisMunicipio(uf, m.cd).catch(() => ({ locais: [] }));
        // Eleitores aptos por seção (1º turno), gravados junto com os votos da zona.
        const eleitoresPorZona = new Map();
        for (const l of idx.locais) {
          const e = eleitoresPorZona.get(l.z) || {};
          l.secoes.forEach((s, i) => { e[s] = (e[s] || 0) + (l.el?.[i] || 0); });
          eleitoresPorZona.set(l.z, e);
        }
        const totais = {};
        const zonasComDados = new Set();
        for (const zona of m.zonas) {
          const { maj, prop } = zonaSeparada(uf, m.cd, zona);
          if (!Object.keys(maj).length && !Object.keys(prop).length) continue;
          zonasComDados.add(zona);
          const e = eleitoresPorZona.get(zona) || {};
          // Presidente/Governador/Senador num arquivo pequeno; Deputados (milhares de votáveis) em outro.
          gravar(`s/${uf}/${m.cd}/${zona}.bin`, { e, ...maj });
          gravar(`s/${uf}/${m.cd}/${zona}-p.bin`, { e, ...prop });
          zonasGravadas++;
          // Totais do município (soma de todas as seções) para resposta imediata.
          for (const c of combos) {
            const k = `${c.turno}|${c.codigo}`;
            const { votos, secoes: n } = calc.somarSecoes([{ dados: c.proporcional ? prop : maj }], c.turno, c.codigo);
            const alvo = (totais[k] ||= { v: {}, s: 0 });
            for (const [v, q] of votos) alvo.v[v] = (alvo.v[v] || 0) + q;
            alvo.s += n;
          }
        }
        for (const c of combos) {
          const t = totais[`${c.turno}|${c.codigo}`];
          if (!t) continue;
          const r = calc.montarResultado(t.v, c.proporcional, meta[`${c.turno}|${c.id}`], t.s);
          (topMun[`${c.turno}|${c.id}`] ||= {})[m.cd] = top3(r.candidatos);
        }
        gravar(`m/${uf}/${m.cd}.bin`, {
          zonas: [...zonasComDados].sort((a, b) => a - b),
          // el = eleitores aptos do local (o detalhe por seção está no arquivo da zona).
          locais: idx.locais.map(l => ({ z: l.z, n: l.n, nome: l.nome, end: l.end, bairro: l.bairro, secoes: l.secoes, el: (l.el || []).reduce((a, x) => a + x, 0) })),
          totais,
        });
      }
      console.log(`  ${uf}: ${munsUf.length} municípios, ${zonasGravadas} zonas com votos por seção.`);
    } else {
      console.log(`  ${uf}: resultado estadual e mapa (sem detalhamento por seção).`);
    }
    // Mapa: partido líder (+3 partidos) por município e, se houver, os 3 candidatos mais votados.
    for (const c of combos) {
      const k = `${c.turno}|${c.id}`;
      try {
        const { lideres } = await mapa.lideres(c.id, c.turno, uf);
        gravar(`mapa/lideres/${uf}/${c.turno}-${c.id}.bin`, { lideres, top3: topMun[k] || null });
      } catch (e) { console.warn(`  mapa ${uf} ${k}: ${e.message}`); }
    }
    gravar(`uf/${uf}.bin`, { uf, detalhada, municipios: munsUf.map(m => ({ cd: m.cd, nm: m.nm, capital: m.capital, zonas: m.zonas })), atualizado });
  }

  gravar('br.bin', br);
  for (const t of Object.keys(top3Br)) {
    gravar(`mapa/lideres/BR/${t}-presidente.bin`, { lideres: (await mapa.lideres('presidente', Number(t), null)).lideres, top3: top3Br[t] });
  }

  // 5. Mapa (IBGE).
  gravar('mapa/brasil.bin', await mapa.malhaBrasil());
  for (const u of cfg.UFS) gravar(`mapa/${u.sigla}.bin`, await mapa.malhaUf(u.sigla));

  // 6. Busca de candidatos (só dados públicos de candidatura; nada de CPF/e-mail/título).
  const { lista } = await tse.candidatos();
  const cargosIdx = Object.keys(cfg.CARGOS);
  gravar('candidatos.bin', { cargos: cargosIdx, lista: lista.map(c => [c.id, c.nome, c.nomeCompleto, c.numero, cargosIdx.indexOf(c.cargo), c.uf, c.partido, c.situacao, c.turno2 ? 1 : 0]) });

  // 7. Índice.
  gravar('indice.bin', {
    versao: cfg.APP_VERSION,
    geradoEm: new Date().toISOString(),
    ufs: cfg.UFS.map(u => ({ sigla: u.sigla, nome: u.nome })),
    detalhadas,
    cargos: Object.entries(cfg.CARGOS).map(([id, c]) => ({ id, nome: c.nome, codigo: c.codigo, turnos: Object.keys(c.eleicoes).map(Number), nacional: c.nacional, proporcional: c.proporcional, somente: c.somente || null, exceto: c.exceto || null })),
    segundoTurnoGovernador: eleicoes.segundoTurnoGovernador,
    segundoTurnoPresidente: eleicoes.segundoTurnoPresidente,
  });

  console.log(`\nPronto em ${((Date.now() - t0) / 1000).toFixed(0)} s: ${arquivosGravados} arquivos de dados, ${(bytesGravados / 1048576).toFixed(1)} MB comprimidos.`);
  console.log('Publique a pasta dist/ em qualquer hospedagem estática. Para testar localmente: npm start');
}

main().catch(err => { console.error('\nFalha:', err); process.exit(1); });
