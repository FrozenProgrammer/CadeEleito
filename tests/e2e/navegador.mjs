// Testes de ponta a ponta no navegador (Chrome sem janela, via DevTools Protocol, sem dependências).
// Sobe o server.js, abre o site gerado em dist/ e confere segurança, regras de negócio e design.
//
// Rodar: npm run test:e2e        (Chrome em outro lugar: CHROME="caminho/do/chrome" npm run test:e2e)
// Capturas de tela: pasta indicada em E2E_FOTOS (opcional).

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DADOS = path.join(RAIZ, 'dist', 'dados');
const ler = rel => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(DADOS, rel))));
const FOTOS = process.env.E2E_FOTOS || '';
const espera = ms => new Promise(r => setTimeout(r, ms));
const portaLivre = () => new Promise(res => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

const CHROMES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);
const chrome = CHROMES.find(c => fs.existsSync(c));
if (!chrome) { console.error('Chrome/Edge não encontrado. Informe o caminho em CHROME=...'); process.exit(1); }
if (!fs.existsSync(path.join(DADOS, 'indice.bin'))) { console.error('dist/ não existe. Rode: npm run gerar -- todos'); process.exit(1); }

// ---------------------------------------------------------------------------
// Infraestrutura: servidor, navegador e CDP.

const portaSite = await portaLivre();
const portaCdp = await portaLivre();
const SITE = `http://127.0.0.1:${portaSite}`;
const servidor = spawn(process.execPath, ['server.js'], { cwd: RAIZ, env: { ...process.env, PORT: String(portaSite), HOST: '127.0.0.1' }, stdio: 'ignore' });
const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-cade-'));
const navegador = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${portaCdp}`, `--user-data-dir=${perfil}`, 'about:blank'], { stdio: 'ignore' });
function encerrar(codigo) {
  try { ws?.close(); } catch { /* ignora */ }
  navegador.kill(); servidor.kill();
  setTimeout(() => { try { fs.rmSync(perfil, { recursive: true, force: true }); } catch { /* Chrome ainda liberando */ } process.exit(codigo); }, 800);
}

let ws, alvo;
for (let i = 0; i < 40 && !alvo; i++) {
  await espera(250);
  try { alvo = (await (await fetch(`http://127.0.0.1:${portaCdp}/json`)).json()).find(t => t.type === 'page'); } catch { /* subindo */ }
}
if (!alvo) { console.error('Chrome não respondeu.'); encerrar(1); }
ws = new WebSocket(alvo.webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });
let seqCmd = 0;
const pendentes = new Map();
const eventos = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pendentes.has(m.id)) { pendentes.get(m.id)(m); pendentes.delete(m.id); } else if (m.method) eventos.push(m);
};
const cmd = (method, params = {}) => new Promise((res, rej) => {
  const i = ++seqCmd;
  pendentes.set(i, m => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
  ws.send(JSON.stringify({ id: i, method, params }));
});
async function avaliar(expr) {
  const r = await cmd('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`Erro no script de teste: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
  return r.result.value;
}
// Espera uma condição na página (texto JS que retorna verdadeiro).
async function aguardar(cond, ms = 8000) {
  const ate = Date.now() + ms;
  while (Date.now() < ate) {
    if (await avaliar(`return !!(${cond})`).catch(() => false)) return true;
    await espera(100);
  }
  return false;
}
async function viewport(largura, altura = 900) {
  await cmd('Emulation.setDeviceMetricsOverride', { width: largura, height: altura, deviceScaleFactor: 1, mobile: largura < 700 });
}
// Abre do zero (recarrega o documento; sessionStorage limpo = primeira visita).
async function abrir(hash, { primeiraVisita = false, tema = 'escuro' } = {}) {
  await cmd('Page.navigate', { url: 'about:blank' });
  await espera(50);
  await cmd('Page.navigate', { url: `${SITE}/${hash}` });
  await aguardar('document.readyState === "complete"');
  await avaliar(`${primeiraVisita ? 'sessionStorage.clear();' : "sessionStorage.setItem('cadeOEleito.buscaUsada','1');"} localStorage.setItem('cadeOEleito.tema', '${tema}'); return 1`);
  await cmd('Page.reload');
  await aguardar('document.readyState === "complete" && document.querySelector("#filtros select, .aviso-erro")');
  await aguardar('!document.querySelector("[aria-busy=true]")', 6000);
  await espera(250);
}
async function foto(nome) {
  if (!FOTOS) return;
  fs.mkdirSync(FOTOS, { recursive: true });
  fs.writeFileSync(path.join(FOTOS, `${nome}.png`), Buffer.from((await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data, 'base64'));
}

await cmd('Page.enable');
await cmd('Runtime.enable');
await cmd('Log.enable');
await cmd('Network.enable');

// ---------------------------------------------------------------------------
// Execução e relatório.

const resultados = [];
async function caso(nome, fn) {
  const inicio = eventos.length;
  let erro = null;
  try { await fn(); } catch (e) { erro = e.message; }
  // Erros de JS, violações de CSP e pedidos a outros domínios durante o caso também reprovam.
  const novos = eventos.slice(inicio);
  const problemas = [];
  for (const ev of novos) {
    if (ev.method === 'Runtime.exceptionThrown') problemas.push(`exceção JS: ${ev.params.exceptionDetails.exception?.description?.split('\n')[0] || ev.params.exceptionDetails.text}`);
    if (ev.method === 'Runtime.consoleAPICalled' && ev.params.type === 'error') problemas.push(`console.error: ${ev.params.args.map(a => a.value ?? a.description).join(' ')}`);
    if (ev.method === 'Log.entryAdded' && ev.params.entry.level === 'error' && !/favicon/.test(ev.params.entry.url || '')) problemas.push(`log: ${ev.params.entry.text}`);
    if (ev.method === 'Network.requestWillBeSent') {
      const u = new URL(ev.params.request.url);
      if (!['127.0.0.1', ''].includes(u.hostname) && u.protocol !== 'data:') problemas.push(`pedido externo: ${u.href}`);
    }
  }
  if (erro) problemas.unshift(erro);
  resultados.push({ nome, problemas });
  console.log(`${problemas.length ? '✖' : '✔'} ${nome}${problemas.map(p => `\n    - ${p}`).join('')}`);
}
const verificar = (cond, msg) => { if (!cond) throw new Error(msg); };

// ---------------------------------------------------------------------------
// Dados auxiliares para os cenários.

const ix = ler('indice.bin');
const { cargos: cargosIdx, lista: candidatos } = ler('candidatos.bin');
// Mesmo número de Deputado Federal em SP e no RJ (candidatos diferentes).
const depSp = candidatos.filter(c => cargosIdx[c[4]] === 'deputado_federal' && c[5] === 'SP');
const depRj = new Map(candidatos.filter(c => cargosIdx[c[4]] === 'deputado_federal' && c[5] === 'RJ').map(c => [c[3], c]));
const candSp = depSp.find(c => depRj.has(c[3]) && /ELEITO/.test(c[7]) && !/NÃO/.test(c[7])) || depSp.find(c => depRj.has(c[3]));
const ufSegundoTurno = ix.segundoTurnoGovernador[0];
const gov2t = candidatos.find(c => cargosIdx[c[4]] === 'governador' && c[5] === ufSegundoTurno && c[8]);
const presidente = candidatos.find(c => cargosIdx[c[4]] === 'presidente' && c[8]) || candidatos.find(c => cargosIdx[c[4]] === 'presidente');
const capital2t = ler(`uf/${ufSegundoTurno}.bin`).municipios.find(m => m.capital);
const ac = ler('uf/AC.bin').municipios.find(m => m.capital);
const capitalSp = ler('uf/SP.bin').municipios.find(m => m.capital);
const govAc = candidatos.find(c => cargosIdx[c[4]] === 'governador' && c[5] === 'AC');
const locaisAc = ler(`m/AC/${ac.cd}.bin`).locais;
const localAc = locaisAc[0];

// ---------------------------------------------------------------------------
// Cenários.

await viewport(1280);

await caso('Sem candidato: só a busca (sem cargo, turno, cascata, cartão ou mapa)', async () => {
  await abrir('#/resultados', { primeiraVisita: true });
  verificar(await avaliar('return document.querySelector("#filtros").classList.contains("filtros-so-busca")'), 'filtros deveriam estar só com a busca');
  verificar(await avaliar('return !document.querySelector("#f-cargo")'), 'o filtro de cargo não deveria existir');
  verificar(await avaliar('return getComputedStyle(document.querySelector(".filtros-cascata")).display === "none" && getComputedStyle(document.querySelector(".campo-turno")).display === "none"'), 'turno/cascata não deveriam aparecer');
  verificar(await avaliar('return !document.querySelector(".cartao-social") && document.querySelector("#pagina-resultados .resultados-mapa").hidden'), 'cartão/mapa não deveriam aparecer');
  // Links antigos só com cargo também abrem só com a busca.
  await abrir('#/resultados?cargo=presidente&uf=SP');
  verificar(await aguardar('!location.hash.includes("cargo=")'), 'cargo sem candidato deveria sair da URL');
  verificar(await avaliar('return document.querySelector("#filtros").classList.contains("filtros-so-busca")'), 'link antigo com cargo deveria abrir só com a busca');
  await foto('01-primeira-visita');
});

await caso('Busca pelo teclado: Enter escolhe o primeiro e libera estado, município… (sem cargo)', async () => {
  await abrir('#/resultados', { primeiraVisita: true });
  const [, nome] = candSp;
  await avaliar(`const e = document.querySelector('#cand-busca'); e.focus(); e.value = ${JSON.stringify(nome.toLowerCase())}; e.dispatchEvent(new Event('input')); return 1`);
  verificar(await aguardar('!document.querySelector("#cand-lista").hidden && document.querySelector("#cand-lista .combo-item")'), 'lista de sugestões não abriu');
  // Foto oficial ao lado do número em cada sugestão (carregada do próprio site).
  verificar(await aguardar('[...document.querySelectorAll("#cand-lista .combo-item")].every(li => li.querySelector(".combo-foto")) && [...document.querySelectorAll("#cand-lista img.combo-foto")].some(i => i.complete && i.naturalWidth > 0)'), 'sugestões sem foto do candidato');
  await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  verificar(await aguardar('location.hash.includes("cand=")'), 'Enter não escolheu o candidato');
  verificar(await aguardar('document.querySelector(".cartao-social")'), 'cartão do candidato não apareceu');
  verificar(await avaliar('return !document.querySelector("#filtros").classList.contains("filtros-so-busca") && getComputedStyle(document.querySelector(".filtros-cascata")).display !== "none"'), 'filtros não foram liberados');
  verificar(await avaliar('return /cargo=deputado_federal/.test(location.hash) && /uf=SP/.test(location.hash)'), 'cargo/UF deveriam vir do candidato');
  verificar(!(await avaliar('return document.querySelector("#cand-busca").hasAttribute("aria-activedescendant")')), 'aria-activedescendant ficou pendurado');
  verificar(await aguardar('document.querySelector("#pagina-resultados .resultados-mapa:not([hidden]) .legenda-densidade")', 15000), 'mapa abaixo do cartão não apareceu');
});

await caso('Limpar filtros: volta só à busca, sem cargo e com a caixa pequena', async () => {
  await abrir(`#/resultados?cand=${candSp[0]}`);
  verificar(await aguardar('document.querySelector(".cartao-social")'), 'cartão não apareceu');
  await avaliar('[...document.querySelectorAll("#filtros .botao-texto")].find(b => /Limpar/.test(b.textContent)).click(); return 1');
  verificar(await aguardar('location.hash === "#/resultados"'), `URL não foi limpa: ${await avaliar('return location.hash')}`);
  verificar(await avaliar('return document.querySelector("#filtros").classList.contains("filtros-so-busca") && document.querySelector("#filtros").getBoundingClientRect().width <= 561'), 'filtros não voltaram ao tamanho só-busca');
  verificar(await avaliar('return !document.querySelector(".cartao-social")'), 'cartão continuou na tela');
});

await caso('Cartão do candidato: números coerentes, selo, local da pesquisa e compartilhamento', async () => {
  const [id] = candSp;
  await abrir(`#/resultados?cand=${id}&uf=SP&mun=${capitalSp.cd}`);
  verificar(await aguardar('document.querySelector(".cartao-social .social-metricas")'), 'cartão do candidato não apareceu');
  verificar(await avaliar('return !document.querySelector(".kpi, .kpis, td.col-pct, .cand-celula")'), 'tabela geral/indicadores ainda aparecem');
  const m = await avaliar('return [...document.querySelectorAll(".social-metrica strong")].map(s => s.textContent)');
  const p = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
  verificar(p >= 0 && p <= 100, `percentual fora de 0–100: ${m[1]}`);
  const local = await avaliar('return document.querySelector(".social-local strong").textContent');
  verificar(/São Paulo › /.test(local), `local da pesquisa ausente no cartão: ${local}`);
  // Selo "Eleito" só quando a situação começa com "Eleito" (nunca "Não eleito"/"Suplente").
  const { selo, situacao } = await avaliar('return { selo: !!document.querySelector(".cartao-social .selo-eleito"), situacao: document.querySelector(".social-nome p")?.textContent || "" }');
  verificar(selo === /^eleit/i.test(situacao), `selo incoerente com "${situacao}"`);
  // Links das redes levam o endereço deste recorte (candidato + município).
  const links = await avaliar('return [...document.querySelectorAll(".compartilhar a")].map(a => ({ href: a.href, alvo: a.target, rel: a.rel }))');
  verificar(links.length === 3, `esperados X, WhatsApp e Facebook: ${links.length}`);
  for (const l of links) {
    verificar(/^https:\/\/(twitter\.com|wa\.me|www\.facebook\.com)\//.test(l.href), `link inesperado: ${l.href}`);
    verificar(decodeURIComponent(l.href).includes(`cand=${id}`) && decodeURIComponent(l.href).includes(`mun=${capitalSp.cd}`), `link sem o recorte: ${l.href}`);
    verificar(l.alvo === '_blank' && /noopener/.test(l.rel) && /noreferrer/.test(l.rel), 'link externo sem noopener/noreferrer');
  }
  // Foto do candidato à direita no cartão.
  verificar(await aguardar('(i => i && i.complete && i.naturalWidth > 0)(document.querySelector(".cartao-social img.social-foto"))'), 'cartão sem a foto do candidato');
  verificar(await avaliar('const f = document.querySelector(".social-foto").getBoundingClientRect(), n = document.querySelector(".social-nome").getBoundingClientRect(); return f.left >= n.right - 1'), 'a foto deveria ficar à direita do nome');
  // Imagem para Instagram: 1080 × 1080, com a foto, desenhada sem erro (canvas exportável = foto da mesma origem).
  const img = await avaliar(`const m = await import('./js/compartilhar.js');
    const cv = await m.desenharImagem({ foto: 'img/c/${id}.jpg', nome: 'Maria Antônia de Albuquerque Cavalcanti Pernambucano', numero: '12345', partido: 'PARTIDO', cargo: 'Deputado Federal', uf: 'SP', eleito: true,
      local: 'São Paulo › São José do Rio Preto › Zona 123 › Bairro Jardim das Flores Muito Comprido', votos: 1234567, percentual: 12.34, posicao: 3, total: 1200, turno: 1 });
    const url = cv.toDataURL('image/png');
    return { w: cv.width, h: cv.height, tam: url.length, url };`);
  verificar(img.w === 1080 && img.h === 1080 && img.tam > 20000, `imagem inválida: ${img.w}×${img.h}, ${img.tam}`);
  if (FOTOS) fs.writeFileSync(path.join(FOTOS, '02b-imagem-instagram.png'), Buffer.from(img.url.split(',')[1], 'base64'));
  await foto('02-cartao-candidato');
});

await caso('Candidato estadual fica no seu estado (link editado com outra UF volta para a UF dele)', async () => {
  const [id, nome] = candSp;
  await abrir(`#/resultados?cargo=deputado_federal&uf=RJ&cand=${id}`);
  verificar(await aguardar('location.hash.includes("uf=SP")'), `UF deveria voltar para SP: ${await avaliar('return location.hash')}`);
  verificar(await aguardar('document.querySelector(".cartao-social h3")'), 'cartão não apareceu');
  const titulo = await avaliar('return document.querySelector(".cartao-social h3").firstChild.textContent');
  verificar(titulo.toLowerCase() === nome.toLowerCase(), `cartão mostra "${titulo}", esperado "${nome}"`);
  verificar(await avaliar('return document.querySelector("#f-uf").disabled && document.querySelector("#f-uf").options.length === 1'), 'estado deveria ficar fixo no do candidato');
  // Cargo errado na URL também é corrigido pelo do candidato.
  await abrir(`#/resultados?cargo=senador&uf=SP&cand=${id}`);
  verificar(await aguardar('location.hash.includes("cargo=deputado_federal")'), 'cargo deveria vir do candidato');
});

await caso('Links adulterados não quebram a página (UF, cargo, turno e códigos inválidos)', async () => {
  for (const hash of [
    '#/mapa?uf=ZZ&cargo=hack&turno=9&mun=../../x',
    `#/resultados?uf=sp&cand=${govAc[0]}&mun=abc&zona=-1&secao=0`,
    '#/graficos?cargo=presidente&turno=2&uf=../../dados', // página removida: volta para Resultados
    '#/mapa?cargo=governador&uf=SP&cand=../../x',
    '#/naoexiste?cargo=presidente',
    `#/resultados?turno=2&uf=SP&cand=${candSp[0]}`,
    '#/resultados?cand=99999999999',
  ]) {
    await abrir(hash);
    verificar(await avaliar('return !!document.querySelector("#filtros select")'), `${hash}: página não montou`);
  }
  await abrir(`#/resultados?uf=ac&cand=${govAc[0]}`);
  verificar(await aguardar('location.hash.includes("uf=AC")'), 'UF minúscula não foi normalizada');
  await abrir(`#/resultados?turno=2&cand=${candSp[0]}`);
  verificar(await aguardar('!location.hash.includes("turno=2")'), '2º turno de Deputado deveria voltar ao 1º');
});

await caso('Injeção de HTML/JS pela URL e pela busca é exibida como texto', async () => {
  const xss = encodeURIComponent('<img src=x onerror="document.title=\'XSS\'">');
  await abrir(`#/resultados?cand=${govAc[0]}&uf=AC&mun=${ac.cd}&bairro=${xss}`);
  await espera(400);
  await avaliar(`const e = document.querySelector('#cand-busca'); e.value = '<svg onload=alert(1)>'; e.dispatchEvent(new Event('input')); return 1`);
  await espera(500);
  verificar(await avaliar('return !document.querySelector("img[src=x], svg[onload]") && document.title !== "XSS"'), 'HTML injetado foi interpretado');
});

await caso('Local de votação e seção (AC, capital) aparecem no cartão', async () => {
  await abrir(`#/resultados?cand=${govAc[0]}&uf=AC&mun=${ac.cd}&zona=${localAc.z}&local=${localAc.n}`);
  verificar(await aguardar('document.querySelector(".social-local strong")', 15000), 'recorte não carregou');
  const local = await avaliar('return document.querySelector(".social-local").textContent');
  verificar(local.toLowerCase().includes(localAc.nome.toLowerCase().slice(0, 10)), `cartão sem o local: ${local}`);
  await abrir(`#/resultados?cand=${govAc[0]}&uf=AC&mun=${ac.cd}&zona=${localAc.z}&secao=${localAc.secoes[0]}`);
  verificar(await aguardar(`document.querySelector(".social-local strong") && /Seção ${localAc.secoes[0]}/.test(document.querySelector(".social-local strong").textContent)`), 'seção não carregou no cartão');
});

await caso('Mapa sem candidato: mapa neutro, sem legenda, e o painel pede a busca', async () => {
  await abrir('#/mapa?cargo=governador&uf=MG');
  verificar(await aguardar('document.querySelectorAll("#pagina-mapa .mapa-svg path").length > 100', 12000), 'mapa de MG não carregou');
  verificar(await avaliar('return [...document.querySelectorAll("#pagina-mapa .mapa-svg path.mapa-regiao")].every(p => p.classList.contains("mapa-neutro"))'), 'mapa deveria estar neutro');
  verificar(await avaliar('return !document.querySelector("#pagina-mapa .legenda-densidade") && !!document.querySelector("#pagina-mapa .mapa-painel .aviso")'), 'sem candidato não deve haver legenda; painel deve pedir a busca');
});

await caso('Mapa de densidade (SP): só o candidato filtrado, cor mais forte = maior %, legenda com escala', async () => {
  const [id] = candSp;
  await abrir(`#/mapa?cargo=deputado_federal&uf=SP&cand=${id}`);
  verificar(await aguardar('document.querySelector("#pagina-mapa .legenda-densidade") && document.querySelector("#pagina-mapa .mapa-painel .painel-kpis")', 15000), 'mapa de densidade/legenda não carregou');
  verificar(await avaliar('return document.querySelectorAll("#pagina-mapa .legenda-degraus span").length === 9 && document.querySelectorAll("#pagina-mapa .legenda-marcas span").length === 3'), 'legenda sem os 9 degraus e as marcas de %');
  // A área de maior % (1ª linha da tabela, ordenada) tem o degrau mais forte; nenhuma área com votos fica sem cor.
  const r = await avaliar(`
    const nomes = new Map([...document.querySelectorAll('#pagina-mapa .mapa-svg path.mapa-regiao')].map(p => [p.getAttribute('aria-label').split('. ')[0], p]));
    const linhas = [...document.querySelectorAll('#pagina-mapa .mapa-tabela tbody tr')].map(tr => [...tr.cells].map(td => td.textContent));
    const pcts = linhas.map(l => parseFloat(l[2].replace(/\\./g, '').replace(',', '.')));
    return { topo: nomes.get(linhas[0][0])?.getAttribute('class'), ordenada: pcts.every((p, i) => !i || p <= pcts[i - 1]), max: pcts[0],
      semCor: linhas.filter(l => !/dens-[1-9]/.test(nomes.get(l[0])?.getAttribute('class') || 'dens-1')).length };
  `);
  verificar(/dens-9/.test(r.topo), `área de maior % deveria ter o degrau 9, tem "${r.topo}"`);
  verificar(r.ordenada && r.max > 0 && r.max <= 100, 'tabela fora de ordem ou % inválido');
  verificar(r.semCor === 0, `${r.semCor} áreas com votos sem cor de densidade`);
  verificar(await avaliar('return document.querySelector("#pagina-mapa .cartao-topo .botao-secundario").hidden'), 'botão Brasil não deveria aparecer para candidato estadual');
  await foto('03-mapa-densidade');
});

await caso(`Mapa, 2º turno por município (${ufSegundoTurno}): percentuais nunca acima de 100%`, async () => {
  await abrir(`#/mapa?cargo=governador&turno=2&uf=${ufSegundoTurno}&mun=${capital2t.cd}&cand=${gov2t[0]}`);
  verificar(await aguardar('document.querySelector("#pagina-mapa .mapa-svg") && document.querySelector(".painel-titulo")', 12000), 'mapa/painel não carregou');
  const textos = await avaliar('return [...document.querySelectorAll("#pagina-mapa .mapa-painel strong, .barra-valor")].map(s => s.textContent)');
  const ruins = textos.filter(t => /%$/.test(t) && parseFloat(t.replace(/\./g, '').replace(',', '.')) > 100);
  verificar(!ruins.length, `percentual impossível no painel: ${ruins}`);
  verificar(await avaliar('return /em /.test(document.querySelector("#pagina-mapa .painel-kpis span").textContent)'), 'painel deveria mostrar os votos no município escolhido');
});

await caso('Mapa do Brasil (Presidente): 27 estados por teclado, legenda, e o candidato continua ao abrir um estado', async () => {
  await abrir(`#/mapa?cargo=presidente&cand=${presidente[0]}`);
  verificar(await aguardar('document.querySelectorAll("#pagina-mapa .mapa-svg path[tabindex]").length === 27 && document.querySelector("#pagina-mapa .legenda-densidade")', 12000), 'mapa não tem 27 UFs focáveis/legenda');
  verificar(await avaliar('return document.querySelectorAll("#pagina-mapa .mapa-svg path[class*=dens-]").length === 27'), 'nem todas as UFs têm cor de densidade');
  await avaliar('const p = document.querySelector("#pagina-mapa .mapa-svg path[tabindex]"); p.focus(); p.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); return 1');
  verificar(await aguardar('/uf=[A-Z]{2}/.test(location.hash)'), 'Enter no estado não abriu o estado');
  verificar(await avaliar('return location.hash.includes("cand=")'), 'candidato a Presidente saiu do filtro ao abrir o estado');
  verificar(await aguardar('document.querySelector("#pagina-mapa .legenda-densidade")', 12000), 'mapa do estado sem densidade');
});

await caso('Zoom no município (zonas): áreas das zonas com números, clique mostra os bairros da zona', async () => {
  const [id] = candSp;
  await abrir(`#/mapa?cand=${id}&uf=SP&mun=${capitalSp.cd}`);
  verificar(await aguardar('document.querySelectorAll("#pagina-mapa .mapa-zona").length > 40 && document.querySelector("#pagina-mapa .legenda-densidade")', 20000), 'áreas do município não apareceram');
  verificar(await avaliar('return !document.querySelector("#pagina-mapa .mapa-ponto, #pagina-mapa circle")'), 'não deveria haver pontos (bolinhas) no mapa');
  verificar(await avaliar('return !!document.querySelector("#pagina-mapa .modo-zonas .mapa-fronteira") && document.querySelectorAll("#pagina-mapa .mapa-rotulos-zona text").length > 20'), 'fronteiras/números das zonas ausentes');
  verificar(await avaliar('return /zona eleitoral/.test(document.querySelector("#pagina-mapa .legenda-titulo").textContent)'), 'legenda deveria ser por zona eleitoral');
  // Áreas recortadas pelo contorno do município (clip-path com id único).
  verificar(await avaliar('const g = document.querySelector("#pagina-mapa .mapa-areas"); const id = (g.getAttribute("clip-path") || "").match(/#([^)]+)/)?.[1]; return !!id && !!document.getElementById(id)'), 'áreas sem recorte pelo contorno');
  const voltar = await avaliar('const b = document.querySelector("#pagina-mapa .cartao-topo .botao-secundario"); return b.hidden ? "" : b.textContent');
  verificar(/São Paulo/.test(voltar), `botão de voltar deveria levar ao estado: "${voltar}"`);
  // Tooltip: percentual em negrito.
  // Desempenho: uma área por zona (não milhares de caminhos) e o destaque numa camada separada.
  verificar(await avaliar('return document.querySelectorAll("#pagina-mapa .mapa-pilha-municipio .mapa-svg path").length < 200 && !!document.querySelector("#pagina-mapa .mapa-pilha-municipio .mapa-topo .mapa-hover")'), 'mapa do município deveria ter poucas formas e camada de destaque separada');
  await avaliar('return (() => { const svg = document.querySelector("#pagina-mapa .mapa-pilha-municipio .mapa-svg"); const ref = document.querySelector("#pagina-mapa .mapa-rotulos-zona text"); const r = ref.getBoundingClientRect(); svg.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 })); return 1; })()');
  verificar(await aguardar('document.querySelector(".tooltip:not([hidden]) .tt-pct")'), 'tooltip sem o percentual em destaque');
  verificar(await avaliar('return Number(getComputedStyle(document.querySelector(".tooltip .tt-pct")).fontWeight) >= 700'), 'percentual do tooltip não está em negrito');
  // Clique numa zona: filtro da zona, outras zonas apagadas e tabela de bairros no painel.
  await avaliar('return (() => { const svg = document.querySelector("#pagina-mapa .mapa-pilha-municipio .mapa-svg"); const ref = document.querySelector("#pagina-mapa .mapa-rotulos-zona text"); const r = ref.getBoundingClientRect(); svg.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 })); return 1; })()');
  verificar(await aguardar('/zona=\\d+/.test(location.hash) && !/local=/.test(location.hash)'), 'clique na zona não aplicou o filtro da zona');
  verificar(await aguardar('document.querySelectorAll("#pagina-mapa .mapa-zona.apagada").length > 10'), 'outras zonas deveriam ficar apagadas');
  verificar(await aguardar('document.querySelectorAll("#pagina-mapa .painel-bairros tbody tr").length > 0', 8000), 'tabela de bairros da zona não apareceu');
  const titulo = await avaliar('return document.querySelector("#pagina-mapa .painel-bairros h4").textContent');
  verificar(/Bairros da Zona \d+/.test(titulo), `título da tabela de bairros: ${titulo}`);
  await foto('04-mapa-municipio-zonas');
  // Modo locais de votação: áreas por local, clique escolhe o local e mostra bairro e seções.
  // Guarda um ponto dentro da cidade (posição do número de uma zona) para clicar no modo locais.
  await avaliar('const r = document.querySelector("#pagina-mapa .mapa-rotulos-zona text").getBoundingClientRect(); window.__ponto = [r.x + r.width / 2, r.y + r.height / 2]; return 1');
  await avaliar('[...document.querySelectorAll("#pagina-mapa .modo-mapa .segmento")].find(b => /Locais/.test(b.textContent)).click(); return 1');
  verificar(await aguardar('document.querySelector("#pagina-mapa .modo-locais") && !document.querySelector("#pagina-mapa .mapa-fronteira")', 10000), 'modo locais não desenhou');
  await espera(700); // fim da animação de entrada (o mapa cresce de 60% a 100%)
  await avaliar('return (() => { const svg = document.querySelector("#pagina-mapa .mapa-pilha-municipio .mapa-svg"); const ref = null; svg.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: window.__ponto[0], clientY: window.__ponto[1] })); return 1; })()');
  verificar(await aguardar('/local=\\d+/.test(location.hash)'), 'clique na área não aplicou o local');
  verificar(await aguardar('document.querySelector("#pagina-mapa .mapa-selecao[d]") && /Seções/.test(document.querySelector("#pagina-mapa .painel-local")?.textContent || "")'), 'local escolhido sem destaque/detalhes');
  verificar(await avaliar('return document.querySelector("#pagina-mapa .modo-mapa [aria-checked=true]").textContent.includes("Locais")'), 'o modo escolhido deveria continuar após o clique');
  await foto('04b-mapa-municipio-locais');
  // Voltar ao estado.
  await avaliar('document.querySelector("#pagina-mapa .cartao-topo .botao-secundario").click(); return 1');
  verificar(await aguardar('!location.hash.includes("mun=") && document.querySelectorAll("#pagina-mapa .mapa-svg path.mapa-regiao").length > 500', 15000), 'voltar não levou ao mapa do estado');
});

await caso('Desempenho do mapa: hover em camada única, sem filtros nas áreas, tooltip só visual', async () => {
  const [id] = candSp;
  await abrir(`#/mapa?cand=${id}&uf=SP`);
  verificar(await aguardar('document.querySelectorAll("#pagina-mapa .mapa-regiao").length > 600', 15000), 'mapa de SP não carregou');
  const r = await avaliar(`
    const svg = document.querySelector('#pagina-mapa .mapa-svg');
    const areas = [...svg.querySelectorAll('.mapa-regiao')];
    const alvo = areas[300], b = alvo.getBoundingClientRect();
    const t0 = performance.now();
    for (let k = 0; k < 200; k++) alvo.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: b.x + b.width / 2 + (k % 3), clientY: b.y + b.height / 2 }));
    const ms = performance.now() - t0;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const hover = document.querySelector('#pagina-mapa .mapa-topo .mapa-hover');
    return {
      ms, hoverOk: hover.getAttribute('d') === alvo.getAttribute('d'),
      semFiltro: areas.slice(0, 50).every(a => getComputedStyle(a).filter === 'none' && getComputedStyle(a).transitionDuration === '0s'),
      tooltipFixo: getComputedStyle(document.querySelector('.tooltip')).position === 'fixed' && document.querySelector('.tooltip').getAttribute('aria-hidden') === 'true',
      semRole: !document.querySelector('.tooltip[role]'),
      topoSemBlur: getComputedStyle(document.querySelector('.topo')).backdropFilter === 'none',
    };`);
  verificar(r.hoverOk, 'o destaque deveria ser a camada .mapa-hover com o contorno da área');
  verificar(r.semFiltro, 'áreas não deveriam ter filtro nem transição (custo por área)');
  verificar(r.tooltipFixo && r.semRole, 'tooltip deveria ser fixo e só visual');
  verificar(r.topoSemBlur, 'topo não deveria usar backdrop-filter');
  verificar(r.ms < 150, `200 movimentos do mouse levaram ${r.ms.toFixed(0)} ms`);
});

await caso('Zoom pela roda do mouse: aproxima no cursor, abre o município sozinho e volta ao afastar', async () => {
  const [id] = candSp;
  await abrir(`#/mapa?cand=${id}&uf=SP`);
  verificar(await aguardar('document.querySelectorAll("#pagina-mapa .mapa-regiao").length > 600', 15000), 'mapa de SP não carregou');
  verificar(await avaliar('return document.querySelectorAll("#pagina-mapa .mapa-zoom button").length === 3 && !document.querySelector("#pagina-mapa .mapa-dica").hidden'), 'botões de zoom ou dica ausentes');
  // Centro da capital na tela (com o mapa rolado para a vista e a rolagem já parada).
  const ponto = async () => avaliar(`
    const p = [...document.querySelectorAll('#pagina-mapa .mapa-regiao')].find(a => /^São Paulo\\./.test(a.getAttribute('aria-label')));
    const b = p.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 };`);
  // Espera o mapa e o painel terminarem de carregar e animar (posições estáveis).
  await aguardar('document.querySelector("#pagina-mapa .painel-kpis") && !document.getAnimations().some(a => a.playState === "running")', 8000);
  await avaliar('document.querySelector("#pagina-mapa .mapa-pilha").scrollIntoView({ block: "center" }); return 1');
  await espera(500);
  const roda = async (deltaY, { x, y }) => cmd('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY });
  const vb0 = await avaliar('return document.querySelector("#pagina-mapa .mapa-svg").getAttribute("viewBox")');
  const alvo = await ponto();
  // Município que está de fato sob o cursor (o centro da caixa da capital pode cair num vizinho).
  const nomeAlvo = await avaliar(`return document.elementFromPoint(${alvo.x}, ${alvo.y}).getAttribute('aria-label').split('.')[0]`);
  await roda(-120, alvo); await espera(120);
  verificar(await avaliar(`return document.querySelector("#pagina-mapa .mapa-svg").getAttribute("viewBox") !== ${JSON.stringify(vb0)} && document.querySelector("#pagina-mapa .mapa-pilha").classList.contains("ampliado")`), 'a roda não aproximou o mapa');
  verificar(await avaliar('const t = document.querySelector("#pagina-mapa .mapa-svg"), m = document.querySelector("#pagina-mapa .mapa-topo"); return t.getAttribute("viewBox") === m.getAttribute("viewBox")'), 'as camadas do mapa ficaram com zoom diferente');
  for (let k = 0; k < 40 && !(await avaliar('return location.hash.includes("mun=")')); k++) { await roda(-240, alvo); await espera(60); }
  verificar(await aguardar(`location.hash.includes("mun=") && document.querySelector("#pagina-mapa .mapa-pilha-municipio") && document.querySelector("#pagina-mapa .mapa-cartao h2").textContent === ${JSON.stringify(nomeAlvo)}`, 15000), `aproximar não abriu o município sob o cursor (${nomeAlvo})`);
  await espera(800);
  // Afastar além do mapa inteiro volta ao estado.
  const meio = await avaliar('const b = document.querySelector("#pagina-mapa .mapa-pilha").getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }');
  for (let k = 0; k < 20 && (await avaliar('return location.hash.includes("mun=")')); k++) { await roda(240, meio); await espera(60); }
  verificar(await aguardar('!location.hash.includes("mun=") && document.querySelectorAll("#pagina-mapa .mapa-regiao").length > 600', 15000), 'afastar não voltou ao mapa do estado');
});

await caso('Página inicial: sem botão "Compartilhar", fonte abaixo do mapa e zoom no município', async () => {
  await abrir(`#/resultados?cand=${govAc[0]}&uf=AC&mun=${ac.cd}`);
  verificar(await aguardar('document.querySelector(".cartao-social") && document.querySelector("#pagina-resultados .mapa-pilha-municipio .mapa-celula")', 15000), 'cartão/mapa do município não apareceram');
  verificar(await avaliar('return ![...document.querySelectorAll(".compartilhar button, .compartilhar a")].some(b => b.textContent.trim() === "Compartilhar")'), 'botão "Compartilhar" ainda aparece');
  verificar(await aguardar('document.querySelector("#pagina-resultados .resultados-fonte .fonte")'), 'fonte dos dados ausente');
  verificar(await avaliar('const m = document.querySelector("#pagina-resultados .resultados-mapa"), f = document.querySelector("#pagina-resultados .resultados-fonte"); return m.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING && f.getBoundingClientRect().top >= m.getBoundingClientRect().bottom - 1'), 'a fonte deveria ficar abaixo do mapa');
});

await caso('Logo do topo: volta ao início com todos os filtros limpos', async () => {
  await abrir(`#/mapa?cand=${govAc[0]}&uf=AC&mun=${ac.cd}&zona=${localAc.z}`);
  verificar(await aguardar('document.querySelector("#inicio")'), 'logo do topo ausente');
  await avaliar('document.querySelector("#inicio").click(); return 1');
  verificar(await aguardar('location.hash === "#/resultados"'), `URL não voltou ao início: ${await avaliar('return location.hash')}`);
  verificar(await aguardar('document.querySelector("#filtros").classList.contains("filtros-so-busca") && !document.querySelector(".cartao-social") && !document.querySelector("#pagina-resultados").hidden'), 'início deveria ficar só com a busca, sem filtros');
  verificar(await avaliar('return /início/i.test(document.querySelector("#inicio").title) && document.querySelector("#inicio").textContent.includes("Cadê o eleito?")'), 'logo sem nome acessível');
});

await caso('Página Gráficos foi removida: link antigo abre Resultados e o menu não a lista', async () => {
  await abrir('#/graficos?cargo=senador&uf=SP');
  verificar(await avaliar('return !document.querySelector("[data-pagina=graficos], #pagina-graficos") && !document.querySelector("#pagina-resultados").hidden'), 'Gráficos ainda existe');
});

await caso('Tema claro/escuro: alterna, fica salvo e muda a cor do navegador', async () => {
  await abrir(`#/resultados?cand=${candSp[0]}`, { tema: 'escuro' });
  await avaliar('document.querySelector("#tema-botao").click(); return 1');
  // A troca é animada (View Transitions): o tema muda no quadro seguinte.
  verificar(await aguardar('document.documentElement.dataset.tema === "claro" && localStorage.getItem("cadeOEleito.tema") === "claro"', 3000), 'tema claro não aplicado/salvo');
  verificar(await avaliar('return document.querySelector("meta[name=theme-color]").content === "#ffffff"'), 'theme-color não mudou');
  await cmd('Page.reload'); await aguardar('document.readyState === "complete"');
  verificar(await avaliar('return document.documentElement.dataset.tema === "claro"'), 'tema não persistiu após recarregar');
});

// Design: sem rolagem horizontal, contraste de texto e nomes acessíveis, em todas as páginas,
// nos dois temas e em 4 larguras de tela.
const PAGINAS = ['#/resultados', `#/resultados?cand=${candSp[0]}&uf=SP&mun=${capitalSp.cd}`, `#/mapa?cargo=deputado_federal&uf=SP&cand=${candSp[0]}`, '#/mapa?cargo=governador&uf=MG', '#/sobre'];
const AUDITORIA = `
  const lum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const rgba = s => { const m = s.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; };
  const fundo = el => { for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.backgroundImage !== 'none') return null; const c = rgba(cs.backgroundColor); if (c && c[3] > 0.95) return c; } return rgba(getComputedStyle(document.body).backgroundColor); };
  const visivel = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.opacity !== '0' && !el.closest('[hidden], .sr-only, svg, details:not([open]) > :not(summary)'); };
  const baixoContraste = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!visivel(el) || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const cs = getComputedStyle(el); const cor = rgba(cs.color);
    // Rótulo dentro da barra: o fundo real é a barra (elemento irmão), não o trilho.
    const barra = el.matches('.barra-valor.dentro') && el.parentElement.querySelector('.barra');
    const bg = barra ? rgba(getComputedStyle(barra).backgroundColor) : fundo(el);
    if (!cor || !bg || el.closest(':disabled, [aria-disabled=true]')) continue;
    const efetivo = cor[3] < 1 ? cor.map((v, i) => i < 3 ? v * cor[3] + bg[i] * (1 - cor[3]) : 1) : cor;
    let opac = 1; for (let e = el; e; e = e.parentElement) opac *= Number(getComputedStyle(e).opacity);
    const final = opac < 1 ? efetivo.map((v, i) => i < 3 ? v * opac + bg[i] * (1 - opac) : 1) : efetivo;
    const [a, b] = [lum(final), lum(bg)];
    const razao = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const grande = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && Number(cs.fontWeight) >= 700);
    if (razao < (grande ? 3 : 4.5)) baixoContraste.push(\`"\${el.textContent.trim().slice(0, 30)}" (\${el.className || el.tagName}) \${razao.toFixed(2)}:1\`);
  }
  const semNome = [...document.querySelectorAll('button, a[href], input, select, [role=button], [role=combobox]')].filter(visivel)
    .filter(el => !(el.getAttribute('aria-label') || el.textContent.trim() || el.title || (el.id && document.querySelector('label[for="' + el.id + '"]')) || el.closest('label') || el.placeholder))
    .map(el => el.outerHTML.slice(0, 80));
  const ids = [...document.querySelectorAll('[id]')].map(e => e.id); const repetidos = [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))];
  const larguraExtra = document.documentElement.scrollWidth - window.innerWidth;
  const transbordando = larguraExtra > 1 ? [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > window.innerWidth + 1 && visivel(e) && !e.closest('.tabela-rolagem')).slice(0, 4).map(e => (e.className || e.tagName) + ' ' + Math.round(e.getBoundingClientRect().right)) : [];
  return { baixoContraste: [...new Set(baixoContraste)].slice(0, 8), semNome, repetidos, larguraExtra, transbordando };
`;
for (const tema of ['escuro', 'claro']) {
  for (const largura of [320, 390, 768, 1280]) {
    await viewport(largura);
    for (const pagina of PAGINAS) {
      await caso(`Design ${tema} ${largura}px ${pagina.split('?')[0]}`, async () => {
        await abrir(pagina, { tema });
        await espera(400);
        // Mede só depois das animações de entrada (texto surgindo do transparente não conta).
        await aguardar('!document.querySelector("[aria-busy=true]") && document.getAnimations().every(a => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity)', 6000);
        const r = await avaliar(AUDITORIA);
        const erros = [];
        if (r.larguraExtra > 1) erros.push(`rolagem horizontal de ${r.larguraExtra}px: ${r.transbordando.join('; ')}`);
        if (r.baixoContraste.length) erros.push(`contraste abaixo do WCAG AA: ${r.baixoContraste.join(' | ')}`);
        if (r.semNome.length) erros.push(`controles sem nome acessível: ${r.semNome.join(' | ')}`);
        if (r.repetidos.length) erros.push(`ids repetidos: ${r.repetidos.join(', ')}`);
        if (largura === 390) await foto(`design-${tema}-${pagina.split('?')[0].replace(/\W+/g, '')}`);
        verificar(!erros.length, erros.join('\n    - '));
      });
    }
  }
}

const falhas = resultados.filter(r => r.problemas.length);
console.log(`\n${resultados.length - falhas.length} de ${resultados.length} cenários sem problemas.`);
encerrar(falhas.length ? 1 : 0);
