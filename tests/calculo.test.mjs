// Regras de apuração (public/js/calculo.js): as mesmas usadas no navegador e no gerador.
// Rodar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { somarSecoes, montarResultado, lider, normalizar } from '../public/js/calculo.js';

const meta = {
  c: {
    '13': ['FULANO', 'PT', 1, 'ELEITO', 1, 'FULANO DE TAL'],
    '22': ['BELTRANO', 'PL', 1, 'NÃO ELEITO', 0, 'BELTRANO DA SILVA'],
    '45': ['CICLANO', 'PSDB', 0, 'INDEFERIDO', 0, 'CICLANO SOUZA'], // candidatura anulada
    '1301': ['DEP A', 'PT', 1, 'ELEITO POR QP', 1, ''],
    '2201': ['DEP B', 'PL', 1, 'SUPLENTE', 0, ''],
  },
  p: { '13': ['PT', 'Partido dos Trabalhadores', 1], '22': ['PL', 'Partido Liberal', 1], '99': ['XX', 'Partido Anulado', 0] },
};

test('majoritário: brancos, nulos, anulados e números sem candidato', () => {
  const r = montarResultado({ '13': 60, '22': 40, '45': 7, '95': 5, '96': 3, '97': 1, '77': 2 }, false, meta, 3);
  assert.equal(r.totais.validos, 100);
  assert.equal(r.totais.brancos, 5);
  assert.equal(r.totais.nulos, 6, 'nulos (96/97) + número sem candidato (77) contam como nulos');
  assert.equal(r.totais.anulados, 7, 'candidatura anulada não entra nos válidos');
  assert.equal(r.totais.comparecimento, 118);
  assert.equal(r.totais.secoes, 3);
  assert.deepEqual(r.candidatos.map(c => [c.numero, c.posicao, c.percentual]), [['13', 1, 60], ['22', 2, 40]]);
});

test('proporcional: voto de legenda soma no partido e nos válidos; legenda anulada não', () => {
  const r = montarResultado(new Map([['1301', 50], ['2201', 30], ['13', 20], ['99', 4], ['95', 1]]), true, meta);
  assert.equal(r.totais.nominais, 80);
  assert.equal(r.totais.legenda, 20);
  assert.equal(r.totais.validos, 100);
  assert.equal(r.totais.anulados, 4);
  const pt = r.partidos.find(p => p.sigla === 'PT');
  assert.equal(pt.votos, 70, 'PT = nominais (50) + legenda (20)');
  assert.equal(pt.percentual, 70);
  assert.ok(Math.abs(r.partidos.reduce((a, p) => a + p.percentual, 0) - 100) < 1e-9, 'partidos somam 100% dos válidos');
});

test('sem votos: percentuais zerados, sem divisão por zero', () => {
  const r = montarResultado({}, false, meta);
  assert.equal(r.totais.validos, 0);
  assert.deepEqual(r.candidatos, []);
  const r2 = montarResultado({ '95': 3 }, false, meta);
  assert.equal(r2.totais.validos, 0);
  assert.equal(r2.totais.comparecimento, 3);
});

test('empate: desempate estável por nome', () => {
  const r = montarResultado({ '22': 10, '13': 10 }, false, meta);
  assert.deepEqual(r.candidatos.map(c => c.nome), ['BELTRANO', 'FULANO']);
});

test('somarSecoes filtra por seção e por local e ignora cargos/turnos ausentes', () => {
  const dados = {
    1: {
      10: { l: 1001, c: { 3: { 13: 5, 95: 1 } } },
      11: { l: 1001, c: { 3: { 22: 4 } } },
      12: { l: 1002, c: { 3: { 13: 2 } } },
      13: { l: 1002, c: { 5: { 13: 9 } } }, // outro cargo
    },
  };
  const todos = somarSecoes([{ dados }], 1, '0003');
  assert.equal(todos.secoes, 3);
  assert.equal(todos.votos.get('13'), 7);
  const porLocal = somarSecoes([{ dados, locais: new Set([1001]) }], 1, '3');
  assert.equal(porLocal.secoes, 2);
  assert.equal(porLocal.votos.get('13'), 5);
  const porSecao = somarSecoes([{ dados, secoes: new Set([12]) }], 1, 3);
  assert.deepEqual([...porSecao.votos], [['13', 2]]);
  const porDono = somarSecoes([{ dados, aceita: (s, sec) => s === 12 || sec.l === 1001 }], 1, 3);
  assert.equal(porDono.secoes, 3, 'predicado aceita recebe número da seção e dados');
  assert.equal(somarSecoes([{ dados }], 2, 3).secoes, 0, 'turno sem dados');
  assert.equal(somarSecoes([{ dados: undefined }], 1, 3).secoes, 0, 'zona sem arquivo');
});

test('lider: partido mais votado, segundo e margem', () => {
  assert.deepEqual(lider({ PT: 60, PL: 30, PSDB: 10 }), { sigla: 'PT', votos: 60, percentual: 60, segundo: 'PL', margem: 30, validos: 100 });
  assert.equal(lider({}), null);
  assert.equal(lider({ PT: 5 }).margem, 100);
  assert.equal(lider({ PSDB: 10, PL: 30, PT: 60 }).segundo, 'PL', 'segundo correto mesmo quando o líder aparece por último');
});

test('normalizar: acentos, caixa e pontuação', () => {
  assert.equal(normalizar('  JOÃO d\'Ávila-Ção  '), 'joao d avila cao');
  assert.equal(normalizar(null), '');
  assert.equal(normalizar('São Paulo'), 'sao paulo');
});
