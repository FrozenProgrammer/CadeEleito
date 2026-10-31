'use strict';
// Confere os dados gerados: para cada município da UF, a soma dos votos por seção
// (exatamente como o navegador calcula) deve ser igual ao total oficial do TSE (EA20).
//
// Uso: npm run verificar -- AC [governador|senador|presidente|deputado_federal|...] [turno]

const path = require('path');
const { pathToFileURL } = require('url');
const cfg = require('../lib/config');
const tse = require('../lib/tse');
const secoes = require('../lib/secoes');

async function main() {
  const [ufArg, cargoArg = 'governador', turnoArg = '1'] = process.argv.slice(2);
  const uf = String(ufArg || '').toUpperCase();
  if (!cfg.UF_POR_SIGLA.has(uf)) throw new Error('Informe a UF, ex.: npm run verificar -- AC governador 1');
  const cargoId = uf === 'DF' && cargoArg === 'deputado_estadual' ? 'deputado_distrital' : cargoArg;
  const cargo = cfg.CARGOS[cargoId];
  if (!cargo) throw new Error('Cargo inválido.');
  const turno = Number(turnoArg);
  const fonte = secoes.fonteDe(cargoId, uf);
  if (!secoes.pronto(fonte)) throw new Error(`Dados por seção de ${fonte} ainda não baixados. Rode: npm run gerar -- ${uf}`);
  const calc = await import(pathToFileURL(path.join(cfg.PUBLIC_DIR, 'js', 'calculo.js')).href);

  const meta = await tse.metaCompacta(cargoId, turno, uf);
  const lista = (await tse.municipios()).lista.filter(m => m.uf === uf);
  let ok = 0, divergentes = 0;
  for (const m of lista) {
    const oficial = await tse.resultadoEa20({ cargoId, turno, uf, mun: m.cd });
    const alvos = m.zonas.map(z => ({ dados: secoes.lerZona(fonte, uf, m.cd, z) }));
    const soma = calc.somarSecoes(alvos, turno, cargo.codigo);
    const calculado = calc.montarResultado(soma.votos, cargo.proporcional, meta, soma.secoes);
    const porNumero = new Map(calculado.candidatos.map(c => [c.numero, c.votos]));
    const difs = oficial.candidatos.filter(c => (porNumero.get(c.numero) || 0) !== c.votos);
    const difValidos = oficial.totais.validos - calculado.totais.validos;
    if (difs.length || difValidos) {
      divergentes++;
      console.log(`✗ ${m.nm}: válidos oficial ${oficial.totais.validos} x seções ${calculado.totais.validos}; ${difs.length} candidato(s) divergente(s)`);
    } else ok++;
  }
  console.log(`\n${uf} · ${cargo.nome} · ${turno}º turno: ${ok} município(s) idênticos ao EA20, ${divergentes} divergente(s).`);
  process.exit(divergentes ? 2 : 0);
}

main().catch(err => { console.error('Falha:', err.message); process.exit(1); });
