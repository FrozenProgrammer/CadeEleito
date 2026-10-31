// Integridade dos dados publicados (dist/dados) e regras de negócio da camada de dados do
// navegador (public/js/api.js), executada no Node com fetch apontando para os arquivos.
// Requer um site gerado: npm run gerar -- todos  (ou algumas UFs).
// Rodar: npm test

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DADOS = path.join(RAIZ, 'dist', 'dados');
const temDados = fs.existsSync(path.join(DADOS, 'indice.bin'));
const ler = rel => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(DADOS, rel))));
const opts = { skip: temDados ? false : 'dist/dados não existe (rode npm run gerar)' };

let api, ix;
const pedidos = [];
before(async () => {
  if (!temDados) return;
  // api.js resolve os dados em public/dados; aqui eles vêm de dist/dados.
  globalThis.fetch = async url => {
    const u = new URL(url);
    pedidos.push(u.pathname);
    const rel = decodeURIComponent(u.pathname).split('/public/dados/')[1];
    const arquivo = rel && path.resolve(DADOS, rel);
    if (!arquivo || !arquivo.startsWith(DADOS + path.sep) || !fs.existsSync(arquivo)) return new Response('', { status: 404 });
    return new Response(fs.readFileSync(arquivo), { status: 200 });
  };
  ({ api } = await import('../public/js/api.js'));
  ix = ler('indice.bin');
});

const consulta = (p) => api('/api/resultado', p);
async function rejeita(promessa, status, trecho) {
  await assert.rejects(promessa, e => {
    assert.equal(e.status, status, `status esperado ${status}, recebido ${e.status} (${e.message})`);
    if (trecho) assert.match(e.message, trecho);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Segurança: parâmetros vindos da URL nunca viram caminhos de arquivo arbitrários.

test('entradas maliciosas são recusadas antes de qualquer leitura de arquivo', opts, async () => {
  const antes = pedidos.length;
  const ataques = ['../', '..%2f', 'A/', 'SP/../../', 'sp\u0000', '<script>', 'XX'];
  for (const uf of ataques) {
    await rejeita(consulta({ cargo: 'governador', uf }), 400);
    await rejeita(api('/api/municipios', { uf }), 400);
    await assert.rejects(api('/api/mapa/uf', { uf }));
  }
  for (const mun of ['../../indice', '1234', '123456', '01007/../x']) {
    await rejeita(api('/api/locais', { uf: 'AC', mun }), 400);
  }
  await rejeita(api('/api/mapa/candidato', { cargo: '../../indice', turno: 1, numero: '13' }), 400);
  await rejeita(api('/api/mapa/candidato', { cargo: 'governador', turno: 1, uf: '../x', numero: '13' }), 400);
  await rejeita(api('/api/mapa/candidato', { cargo: 'governador', turno: 1, uf: 'SP', numero: '../1' }), 400);
  await rejeita(api('/api/mapa/candidato', { cargo: 'governador', turno: 1, numero: '13' }), 400); // cargo estadual sem UF
  await rejeita(api('/api/inexistente'), 404);
  const suspeitos = pedidos.slice(antes).filter(p => /\.\.|%2e|%2f|<|\u0000/i.test(p));
  assert.deepEqual(suspeitos, [], 'nenhum pedido com caminho suspeito');
});

test('validação do recorte: turno, cargo, hierarquia e limites', opts, async () => {
  await rejeita(consulta({ cargo: 'presidente', turno: 3 }), 400, /Turno/);
  await rejeita(consulta({ cargo: 'prefeito' }), 400, /Cargo/);
  await rejeita(consulta({ cargo: 'governador' }), 400, /Selecione um estado/);
  await rejeita(consulta({ cargo: 'senador', uf: 'SP', turno: 2 }), 400, /2º turno/);
  const semSegundo = ix.ufs.map(u => u.sigla).find(uf => !ix.segundoTurnoGovernador.includes(uf));
  await rejeita(consulta({ cargo: 'governador', uf: semSegundo, turno: 2 }), 400, /2º turno/);
  await rejeita(consulta({ cargo: 'governador', mun: '01007' }), 400);
  await rejeita(consulta({ cargo: 'governador', uf: 'AC', zona: 8 }), 400, /Zona/);
  await rejeita(consulta({ cargo: 'governador', uf: 'AC', mun: '99999' }), 400, /Município/);
  const mun = ler('uf/AC.bin').municipios[0];
  await rejeita(consulta({ cargo: 'governador', uf: 'AC', mun: mun.cd, zona: 9999 }), 400, /Zona/);
  await rejeita(consulta({ cargo: 'governador', uf: 'AC', mun: mun.cd, secao: 1 }), 400, /zona/);
  await rejeita(consulta({ cargo: 'governador', uf: 'AC', mun: mun.cd, zona: mun.zonas[0], secao: '1; DROP' }), 400);
  await rejeita(consulta({ cargo: 'governador', uf: 'AC', mun: mun.cd, zona: mun.zonas[0], secao: 99999 }), 400, /não tem votos/);
  await rejeita(consulta({ cargo: 'governador', uf: 'AC', mun: mun.cd, bairro: 'x'.repeat(5000) }), 400, /bairro/i);
});

test('DF usa Deputado Distrital e as demais UFs Deputado Estadual', opts, async () => {
  assert.equal((await consulta({ cargo: 'deputado_estadual', uf: 'DF' })).cargo.id, 'deputado_distrital');
  assert.equal((await consulta({ cargo: 'deputado_distrital', uf: 'SP' })).cargo.id, 'deputado_estadual');
});

test('2º turno de Presidente só é aceito se houve disputa', opts, async () => {
  const br = ler('br.bin');
  if (ix.segundoTurnoPresidente) assert.ok(br.resultados['2|presidente'], 'br.bin tem o 2º turno');
  else await rejeita(consulta({ cargo: 'presidente', turno: 2 }), 400, /2º turno/);
});

// ---------------------------------------------------------------------------
// Regras de negócio: os números de cada nível fecham com o nível acima.

function conferirTotais(r, contexto) {
  const t = r.totais;
  assert.equal(t.validos, t.nominais + t.legenda, `${contexto}: válidos = nominais + legenda`);
  assert.equal(r.candidatos.reduce((a, c) => a + c.votos, 0), t.nominais, `${contexto}: soma dos candidatos = nominais`);
  if (t.eleitorado) assert.ok(t.comparecimento <= t.eleitorado, `${contexto}: comparecimento <= eleitorado`);
  for (let i = 1; i < r.candidatos.length; i++) assert.ok(r.candidatos[i - 1].votos >= r.candidatos[i].votos, `${contexto}: ordem decrescente`);
  for (const c of r.candidatos) assert.ok(c.percentual >= 0 && c.percentual <= 100.0001, `${contexto}: percentual entre 0 e 100`);
}

test('Brasil: totais coerentes e Presidente = soma das 27 UFs', opts, async () => {
  for (const t of ix.segundoTurnoPresidente ? [1, 2] : [1]) {
    const br = await consulta({ cargo: 'presidente', turno: t });
    conferirTotais(br, `BR ${t}º turno`);
    const porNumero = new Map();
    let validos = 0;
    for (const { sigla } of ix.ufs) {
      const r = await consulta({ cargo: 'presidente', turno: t, uf: sigla });
      conferirTotais(r, `${sigla} presidente ${t}º`);
      validos += r.totais.validos;
      for (const c of r.candidatos) porNumero.set(c.numero, (porNumero.get(c.numero) || 0) + c.votos);
    }
    // O total nacional inclui o voto no exterior (ZZ), que não pertence a nenhuma UF.
    assert.ok(validos <= br.totais.validos, `${t}º turno: soma das UFs (${validos}) <= Brasil (${br.totais.validos})`);
    for (const c of br.candidatos) assert.ok((porNumero.get(c.numero) || 0) <= c.votos, `${c.nome}: UFs <= Brasil`);
  }
});

test('cada UF detalhada: soma dos municípios = resultado oficial da UF (todos os cargos e turnos)', { ...opts, timeout: 600_000 }, async () => {
  const { montarResultado } = await import('../public/js/calculo.js');
  const falhas = [];
  for (const uf of ix.detalhadas) {
    const U = ler(`uf/${uf}.bin`);
    const totaisMun = U.municipios.map(m => fs.existsSync(path.join(DADOS, 'm', uf, `${m.cd}.bin`)) ? ler(`m/${uf}/${m.cd}.bin`).totais : {});
    for (const arq of fs.readdirSync(path.join(DADOS, 'uf', uf))) {
      const [turno, cargoId] = arq.replace('.bin', '').split(/-(.+)/);
      const cargo = ix.cargos.find(c => c.id === cargoId);
      const { resultado: oficial, meta } = ler(`uf/${uf}/${arq}`);
      const k = `${turno}|${Number(cargo.codigo)}`;
      const soma = {};
      let secoes = 0;
      for (const tm of totaisMun) {
        const t = tm[k];
        if (!t) continue;
        secoes += t.s;
        for (const [v, q] of Object.entries(t.v)) soma[v] = (soma[v] || 0) + q;
      }
      const calc = montarResultado(soma, cargo.proporcional, meta, secoes);
      const porNumero = new Map(calc.candidatos.map(c => [c.numero, c.votos]));
      const difs = oficial.candidatos.filter(c => (porNumero.get(c.numero) || 0) !== c.votos);
      if (difs.length || calc.totais.validos !== oficial.totais.validos) {
        falhas.push(`${uf} ${cargoId} ${turno}º: válidos oficial ${oficial.totais.validos} x seções ${calc.totais.validos}, ${difs.length} candidato(s) divergente(s)`);
      }
    }
  }
  assert.deepEqual(falhas, []);
});

test('município, zona, bairro, local e seção fecham entre si (amostra por UF)', { ...opts, timeout: 300_000 }, async () => {
  for (const uf of ix.detalhadas) {
    const U = ler(`uf/${uf}.bin`);
    // Maior município da UF (capital) e um município pequeno.
    const amostra = [U.municipios.find(m => m.capital) || U.municipios[0], U.municipios.at(-1)];
    for (const m of amostra) {
      const base = { cargo: 'governador', uf, mun: m.cd };
      const rm = await consulta(base);
      conferirTotais(rm, `${uf}/${m.nm}`);
      let somaZonas = 0;
      for (const zona of m.zonas) {
        const rz = await consulta({ ...base, zona }).catch(e => (e.status === 404 ? null : Promise.reject(e)));
        if (!rz) continue;
        conferirTotais(rz, `${uf}/${m.nm}/Z${zona}`);
        somaZonas += rz.totais.validos;
      }
      assert.equal(somaZonas, rm.totais.validos, `${uf}/${m.nm}: soma das zonas = município`);
      // Todos os bairros juntos = município (nenhuma seção fica de fora).
      const { locais, bairros } = await api('/api/locais', { uf, mun: m.cd });
      let somaBairros = 0;
      for (const b of bairros) somaBairros += (await consulta({ ...base, bairro: b.nome })).totais.validos;
      assert.equal(somaBairros, rm.totais.validos, `${uf}/${m.nm}: soma dos bairros = município`);
      // Todos os locais juntos = município (cada seção pertence a um único local).
      let somaLocais = 0;
      for (const l of locais) somaLocais += (await consulta({ ...base, zona: l.z, local: l.n })).totais.validos;
      assert.equal(somaLocais, rm.totais.validos, `${uf}/${m.nm}: soma dos locais = município`);
      // Seções de um local somam o local.
      // Um local sem seções compartilhadas com outro local do cadastro.
      const contagem = new Map();
      for (const x of locais) for (const s of x.secoes) contagem.set(`${x.z}|${s}`, (contagem.get(`${x.z}|${s}`) || 0) + 1);
      const l = locais.find(x => x.secoes.length > 1 && x.secoes.every(s => contagem.get(`${x.z}|${s}`) === 1));
      if (!l) continue;
      const rl = await consulta({ ...base, zona: l.z, local: l.n });
      let somaSecoes = 0;
      for (const s of l.secoes) {
        const rs = await consulta({ ...base, zona: l.z, secao: s }).catch(e => (e.status === 400 ? null : Promise.reject(e)));
        if (rs) somaSecoes += rs.totais.validos;
      }
      assert.equal(somaSecoes, rl.totais.validos, `${uf}/${m.nm}/${l.nome}: soma das seções = local`);
      const rb = await consulta({ ...base, bairro: l.bairro });
      assert.ok(rb.totais.validos >= rl.totais.validos && rb.totais.validos <= rm.totais.validos, `${uf}/${m.nm}: local <= bairro <= município`);
    }
  }
});

// ---------------------------------------------------------------------------
// Candidatos: busca e privacidade.

test('cadastro de candidatos: só dados públicos, ids únicos, números coerentes com o cargo', opts, () => {
  const { cargos, lista } = ler('candidatos.bin');
  const ids = new Set();
  const digitos = { presidente: 2, governador: 2, senador: 3, deputado_federal: 4, deputado_estadual: 5, deputado_distrital: 5 };
  const ufs = new Set([...ix.ufs.map(u => u.sigla), 'BR']);
  const problemas = [];
  for (const [id, nome, nomeCompleto, numero, ci, uf, partido, situacao] of lista) {
    if (ids.has(id)) problemas.push(`id repetido ${id}`);
    ids.add(id);
    const cargo = cargos[ci];
    if (!cargo) problemas.push(`${id}: cargo inválido`);
    if (!/^\d+$/.test(numero) || numero.length !== digitos[cargo]) problemas.push(`${id}: número ${numero} incompatível com ${cargo}`);
    if (!ufs.has(uf)) problemas.push(`${id}: UF ${uf}`);
    if ((cargo === 'presidente') !== (uf === 'BR')) problemas.push(`${id}: UF ${uf} para ${cargo}`);
    if (!nome || !partido) problemas.push(`${id}: nome/partido vazio`);
    const texto = [nome, nomeCompleto, partido, situacao].join(' ');
    if (/\d{3}\.?\d{3}\.?\d{3}-?\d{2}|@[\w-]+\.\w/.test(texto)) problemas.push(`${id}: parece conter CPF/e-mail`);
  }
  assert.deepEqual(problemas.slice(0, 20), []);
  assert.ok(lista.length > 1000);
});

test('busca de candidatos: acentos, número exato primeiro, limite de 25 e textos curtos', opts, async () => {
  assert.deepEqual(await api('/api/candidatos', { q: 'a' }), []);
  assert.deepEqual(await api('/api/candidatos', { q: '' }), []);
  const muitos = await api('/api/candidatos', { q: 'silva' });
  assert.equal(muitos.length, 25);
  const { lista } = ler('candidatos.bin');
  const [, nome, , numero, , uf] = lista.find(c => /[ÁÉÍÓÚÃÕÇ]/.test(c[1]));
  const semAcento = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const r = await api('/api/candidatos', { q: semAcento });
  assert.ok(r.some(c => c.nome === nome && c.uf === uf), `"${semAcento}" encontra "${nome}"`);
  const porNumero = await api('/api/candidatos', { q: numero });
  assert.equal(porNumero[0].numero, numero, 'número exato vem primeiro');
  assert.deepEqual(await api('/api/candidatos', { q: '<img src=x onerror=alert(1)>' }), []);
  await rejeita(api('/api/candidato', { id: 'nao-existe' }), 400);
});

// ---------------------------------------------------------------------------
// Mapa.

test('mapa: toda área com votos existe na malha e os percentuais são válidos', opts, () => {
  const problemas = [];
  const brasil = ler('mapa/brasil.bin');
  assert.equal(brasil.ufs.length, 27);
  for (const { sigla } of ix.ufs) {
    const malha = ler(`mapa/${sigla}.bin`);
    const ids = new Set(malha.municipios.map(m => m.cd));
    const U = ler(`uf/${sigla}.bin`);
    // Municípios recém-criados podem faltar na malha do IBGE (ex.: Boa Esperança do Norte/MT):
    // ficam fora do desenho, mas continuam no filtro. O contrário (área sem município) é erro.
    const cods = new Set(U.municipios.map(m => m.cd));
    const semMalha = U.municipios.filter(m => !ids.has(m.cd));
    if (semMalha.length) console.log(`  aviso: ${sigla} sem desenho no mapa do IBGE: ${semMalha.map(m => m.nm).join(', ')}`);
    if (semMalha.length > 2) problemas.push(`${sigla}: ${semMalha.length} municípios sem malha`);
    for (const cd of ids) if (!cods.has(cd)) problemas.push(`${sigla}: área ${cd} da malha não é município do TSE`);
    for (const m of malha.municipios) if (!/^[\d\sMLHVCSQTAZmlhvcsqtaz.,-]+$/.test(m.d)) problemas.push(`${sigla}/${m.cd}: caminho SVG inesperado`);
    if (!ix.detalhadas.includes(sigla)) continue;
    const dir = path.join(DADOS, 'mapa', 'votos', sigla);
    for (const arq of fs.readdirSync(dir)) {
      const { validos, votos } = ler(`mapa/votos/${sigla}/${arq}`);
      for (const cd of Object.keys(validos)) if (!cods.has(cd)) problemas.push(`${sigla}/${arq}: área ${cd} não é município`);
      for (const [num, porMun] of Object.entries(votos)) {
        for (const [cd, v] of Object.entries(porMun)) {
          if (!(Number.isInteger(v) && v > 0 && v <= (validos[cd] || 0))) problemas.push(`${sigla}/${arq}/${num}/${cd}: votos fora de 0..válidos`);
        }
      }
    }
  }
  assert.deepEqual(problemas.slice(0, 20), []);
});

test('mapa de densidade: votos do candidato somados nos municípios = total oficial do estado', opts, async () => {
  const problemas = [];
  for (const sigla of ix.detalhadas) {
    for (const arq of fs.readdirSync(path.join(DADOS, 'mapa', 'votos', sigla))) {
      const { votos } = ler(`mapa/votos/${sigla}/${arq}`);
      const { resultado } = ler(`uf/${sigla}/${arq}`);
      for (const c of resultado.candidatos.slice(0, 5)) {
        const soma = Object.values(votos[c.numero] || {}).reduce((a, v) => a + v, 0);
        if (soma !== c.votos) problemas.push(`${sigla}/${arq} ${c.numero}: mapa ${soma} ≠ oficial ${c.votos}`);
      }
    }
  }
  assert.deepEqual(problemas.slice(0, 20), []);
  // API: percentuais por área, máximo coerente e Presidente por UF no mapa do Brasil.
  const sp = await api('/api/mapa/candidato', { cargo: 'governador', turno: 1, uf: 'SP', numero: ler('uf/SP/1-governador.bin').resultado.candidatos[0].numero });
  const pcts = Object.values(sp.areas).map(a => a.percentual);
  assert.ok(pcts.every(p => p >= 0 && p <= 100));
  assert.equal(sp.max, Math.max(...pcts));
  const br = await api('/api/mapa/candidato', { cargo: 'presidente', turno: 1, numero: ler('br.bin').resultados['1|presidente'].candidatos[0].numero });
  assert.equal(Object.keys(br.areas).length, 27);
  const semVotos = await api('/api/mapa/candidato', { cargo: 'governador', turno: 1, uf: 'SP', numero: '99999' });
  assert.equal(semVotos.max, 0, 'número sem candidato: mapa vazio, sem erro');
});

test('mapa do município: votos por local de votação somam exatamente o total do município', opts, () => {
  const problemas = [];
  const codigo = id => String(Number(ix.cargos.find(c => c.id === id).codigo));
  for (const uf of ['AC', 'SP', 'RJ', 'MG', 'BA'].filter(u => ix.detalhadas.includes(u))) {
    const muns = ler(`uf/${uf}.bin`).municipios;
    for (const m of [muns.find(x => x.capital), muns[1]].filter(Boolean)) {
      const M = ler(`m/${uf}/${m.cd}.bin`);
      const comPosicao = M.locais.filter(l => Number.isFinite(l.x) && Number.isFinite(l.y)).length;
      if (comPosicao < M.locais.length * 0.9) problemas.push(`${uf}/${m.cd}: só ${comPosicao} de ${M.locais.length} locais com posição`);
      for (const suf of ['', '-p']) {
        const d = ler(`mapa/l/${uf}/${m.cd}${suf}.bin`);
        if (d.l.length !== M.locais.length) problemas.push(`${uf}/${m.cd}${suf}: ${d.l.length} locais ≠ ${M.locais.length}`);
        for (const [k, c] of Object.entries(d.c)) {
          const [t, id] = k.split('|');
          const oficial = M.totais[`${t}|${codigo(id)}`]?.v || {};
          for (const [num, pares] of Object.entries(c.n)) {
            let soma = 0;
            for (let i = 1; i < pares.length; i += 2) soma += pares[i];
            if (soma !== oficial[num]) problemas.push(`${uf}/${m.cd} ${k} nº ${num}: locais ${soma} ≠ município ${oficial[num]}`);
          }
          if (c.v.some((v, i) => v < 0 || !Number.isInteger(v))) problemas.push(`${uf}/${m.cd} ${k}: válidos inválidos`);
        }
      }
    }
  }
  assert.deepEqual(problemas.slice(0, 20), []);
});

test('API do mapa do município: percentuais por local e entradas maliciosas recusadas', opts, async () => {
  const ac = ler('uf/AC.bin').municipios.find(m => m.capital);
  const gov = ler('uf/AC/1-governador.bin').resultado.candidatos[0].numero;
  const r = await api('/api/mapa/locais', { cargo: 'governador', turno: 1, uf: 'AC', mun: ac.cd, numero: gov });
  assert.ok(r.locais.length > 10);
  assert.ok(r.locais.every(l => l.percentual >= 0 && l.percentual <= 100 && l.votos <= l.validos));
  assert.equal(r.max, Math.max(...r.locais.map(l => l.percentual)));
  await rejeita(api('/api/mapa/locais', { cargo: 'governador', turno: 1, uf: 'AC', mun: '../../x', numero: gov }), 400);
  await rejeita(api('/api/mapa/locais', { cargo: 'governador', turno: 1, uf: '../', mun: ac.cd, numero: gov }), 400);
  await rejeita(api('/api/mapa/locais', { cargo: 'hack', turno: 1, uf: 'AC', mun: ac.cd, numero: gov }), 400);
});

test('fotos dos candidatos: toda foto marcada existe, é JPEG e é pequena', opts, () => {
  const { lista } = ler('candidatos.bin');
  const comFoto = lista.filter(c => c[9] === 1);
  assert.ok(comFoto.length > lista.length * 0.9, `poucas fotos: ${comFoto.length} de ${lista.length}`);
  const problemas = [];
  for (const c of comFoto) {
    const f = path.join(RAIZ, 'dist', 'img', 'c', `${c[0]}.jpg`);
    if (!/^\d{6,14}$/.test(c[0])) { problemas.push(`id inesperado ${c[0]}`); continue; }
    let b;
    try { b = fs.readFileSync(f); } catch { problemas.push(`${c[0]}: arquivo ausente`); continue; }
    if (b[0] !== 0xff || b[1] !== 0xd8 || b.length > 512 * 1024) problemas.push(`${c[0]}: não é JPEG pequeno`);
  }
  assert.deepEqual(problemas.slice(0, 10), []);
});

test('mapa do município: áreas dos locais (Voronoi) cobrem cada local uma vez e há fronteiras entre zonas', opts, () => {
  const problemas = [];
  for (const uf of ['AC', 'SP', 'MG', 'RJ'].filter(u => ix.detalhadas.includes(u))) {
    const muns = ler(`uf/${uf}.bin`).municipios;
    for (const m of [muns.find(x => x.capital), muns[2]].filter(Boolean)) {
      const M = ler(`m/${uf}/${m.cd}.bin`);
      if (!M.geo) { problemas.push(`${uf}/${m.cd}: sem divisão`); continue; }
      const vistos = new Map();
      for (const [ids, d] of M.geo.c) {
        if (!/^M[\d. L-]+Z$/.test(d)) problemas.push(`${uf}/${m.cd}: caminho de área inesperado`);
        for (const i of ids) {
          if (!M.locais[i]) problemas.push(`${uf}/${m.cd}: índice ${i} fora dos locais`);
          vistos.set(i, (vistos.get(i) || 0) + 1);
        }
      }
      if ([...vistos.values()].some(n => n !== 1)) problemas.push(`${uf}/${m.cd}: local em mais de uma área`);
      const comPosicao = M.locais.filter(l => Number.isFinite(l.x)).length;
      if (vistos.size < comPosicao * 0.95) problemas.push(`${uf}/${m.cd}: só ${vistos.size} de ${comPosicao} locais com área`);
      const zonas = new Set(M.locais.map(l => l.z)).size;
      if (zonas > 1 && !M.geo.f) problemas.push(`${uf}/${m.cd}: ${zonas} zonas sem fronteiras`);
      if (M.geo.f && !/^(M[\d. -]+L[\d. -]+)+$/.test(M.geo.f)) problemas.push(`${uf}/${m.cd}: fronteiras com formato inesperado`);
    }
  }
  assert.deepEqual(problemas.slice(0, 20), []);
});
