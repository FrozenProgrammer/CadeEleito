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
const capital2t = ler(`uf/${ufSegundoTurno}.bin`).municipios.find(m => m.capital);
const ac = ler('uf/AC.bin').municipios.find(m => m.capital);
const locaisAc = ler(`m/AC/${ac.cd}.bin`).locais;
const localAc = locaisAc[0];

// ---------------------------------------------------------------------------
// Cenários.

await viewport(1280);

await caso('Primeira visita: só a busca por nome, sem cargo e sem resultados', async () => {
  await abrir('#/resultados', { primeiraVisita: true });
  verificar(await avaliar('return document.querySelector("#filtros").classList.contains("filtros-so-busca")'), 'filtros deveriam estar só com a busca');
  verificar(await avaliar('return getComputedStyle(document.querySelector("#f-cargo").closest(".campo")).display === "none"'), 'cargo não deveria aparecer');
  verificar(await avaliar('return !document.querySelector("#pagina-resultados table")'), 'não deveria haver tabela');
  await foto('01-primeira-visita');
});

await caso('Busca pelo teclado: digitar e Enter escolhe o primeiro e libera os filtros', async () => {
  await abrir('#/resultados', { primeiraVisita: true });
  const [, nome] = candSp;
  await avaliar(`const e = document.querySelector('#cand-busca'); e.focus(); e.value = ${JSON.stringify(nome.toLowerCase())}; e.dispatchEvent(new Event('input')); return 1`);
  verificar(await aguardar('!document.querySelector("#cand-lista").hidden && document.querySelector("#cand-lista .combo-item")'), 'lista de sugestões não abriu');
  await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  verificar(await aguardar('location.hash.includes("cand=")'), 'Enter não escolheu o candidato');
  verificar(await aguardar('document.querySelector(".destaque")'), 'destaque do candidato não apareceu');
  verificar(await avaliar('return !document.querySelector("#filtros").classList.contains("filtros-so-busca")'), 'filtros não foram liberados');
  verificar(!(await avaliar('return document.querySelector("#cand-busca").hasAttribute("aria-activedescendant")')), 'aria-activedescendant ficou pendurado');
});

await caso('Presidente no Brasil: tabela, indicadores e percentuais coerentes', async () => {
  await abrir('#/resultados?cargo=presidente');
  verificar(await aguardar('document.querySelectorAll("#pagina-resultados tbody tr").length > 1'), 'tabela vazia');
  const pcts = await avaliar('return [...document.querySelectorAll("#pagina-resultados td.col-pct span:first-child")].map(s => parseFloat(s.textContent.replace(".", "").replace(",", ".")))');
  verificar(pcts.every(p => p >= 0 && p <= 100), `percentual fora de 0–100: ${pcts}`);
  const soma = pcts.reduce((a, b) => a + b, 0);
  verificar(Math.abs(soma - 100) < 0.2, `percentuais somam ${soma.toFixed(2)}%`);
  verificar(await avaliar('return document.querySelectorAll(".kpi").length >= 4'), 'indicadores ausentes');
  await foto('02-presidente');
});

await caso('Selo "Eleito" só nos eleitos (nunca em "Não eleito" ou "Suplente")', async () => {
  await abrir('#/resultados?cargo=deputado_federal&uf=SP');
  verificar(await aguardar('document.querySelectorAll("#pagina-resultados tbody tr").length > 10'), 'tabela vazia');
  const linhas = await avaliar('return [...document.querySelectorAll("#pagina-resultados tbody tr")].map(tr => ({ selo: !!tr.querySelector(".selo-eleito"), situacao: tr.querySelector(".cand-celula small")?.textContent || "" }))');
  const errados = linhas.filter(l => l.selo !== /· Eleit/i.test(l.situacao));
  verificar(linhas.some(l => l.selo), 'nenhum selo nos mais votados de SP');
  verificar(!errados.length, `selo incoerente com a situação: ${JSON.stringify(errados.slice(0, 3))}`);
  await avaliar('document.querySelector("#pagina-resultados table").scrollIntoView(); return 1');
  await foto('05-selo-eleito');
});

// Filtro da tabela ignora acentos ("sao" encontra "São").
await caso('Filtro da tabela ignora acentos e caixa', async () => {
  await abrir('#/resultados?cargo=deputado_federal&uf=SP');
  verificar(await aguardar('document.querySelector(".cartao-topo input[type=search]")'), 'filtro da tabela ausente');
  const alvo = await avaliar('return [...document.querySelectorAll("#pagina-resultados tbody strong")].map(s => s.textContent).find(t => /[áéíóúãõâêç]/i.test(t))');
  verificar(alvo, 'nenhum nome acentuado entre os primeiros');
  const semAcento = alvo.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  await avaliar(`const i = document.querySelector('.cartao-topo input[type=search]'); i.value = ${JSON.stringify(semAcento)}; i.dispatchEvent(new Event('input')); return 1`);
  verificar(await aguardar(`[...document.querySelectorAll('#pagina-resultados tbody strong')].some(s => s.textContent === ${JSON.stringify(alvo)})`), `"${semAcento}" não encontrou "${alvo}"`);
});

await caso('Candidato de SP não é confundido com o mesmo número no RJ', async () => {
  const [id, nome, , numero] = candSp;
  await abrir(`#/resultados?cargo=deputado_federal&uf=SP&cand=${id}`);
  verificar(await aguardar('document.querySelector(".destaque h3")'), 'destaque não apareceu em SP');
  const titulo = await avaliar('return document.querySelector(".destaque h3").firstChild.textContent');
  verificar(titulo.toLowerCase() === nome.toLowerCase(), `destaque mostra "${titulo}", esperado "${nome}"`);
  // Troca o estado para o RJ pelo filtro.
  await avaliar('const s = document.querySelector("#f-uf"); s.value = "RJ"; s.dispatchEvent(new Event("change")); return 1');
  verificar(await aguardar('location.hash.includes("uf=RJ")'), 'UF não mudou');
  await aguardar('!document.querySelector("[aria-busy=true]") && document.querySelector("#pagina-resultados table")');
  await espera(300);
  verificar(!(await avaliar('return location.hash.includes("cand=")')), 'candidato de SP continuou no filtro do RJ');
  verificar(!(await avaliar('return !!document.querySelector(".destaque")')), `destaque mostra o nº ${numero} do RJ como se fosse ${nome}`);
  verificar(!(await avaliar('return !!document.querySelector(".linha-destaque")')), 'linha do RJ destacada indevidamente');
});

await caso('Links adulterados não quebram a página (UF, cargo, turno e códigos inválidos)', async () => {
  for (const hash of [
    '#/mapa?uf=ZZ&cargo=hack&turno=9&mun=../../x',
    '#/resultados?uf=sp&cargo=governador&mun=abc&zona=-1&secao=0',
    '#/graficos?cargo=presidente&turno=2&uf=../../dados',
    '#/naoexiste?cargo=presidente',
    '#/resultados?cargo=senador&turno=2&uf=SP',
  ]) {
    await abrir(hash);
    verificar(await avaliar('return !!document.querySelector("#filtros select")'), `${hash}: página não montou`);
  }
  await abrir('#/resultados?uf=sp&cargo=governador');
  verificar(await aguardar('location.hash.includes("uf=SP")'), 'UF minúscula não foi normalizada');
  await abrir('#/resultados?cargo=senador&turno=2&uf=SP');
  verificar(!(await avaliar('return location.hash.includes("turno=2")')), '2º turno de Senador deveria voltar ao 1º');
});

await caso('Injeção de HTML/JS pela URL e pela busca é exibida como texto', async () => {
  const xss = encodeURIComponent('<img src=x onerror="document.title=\'XSS\'">');
  await abrir(`#/resultados?cargo=governador&uf=AC&mun=${ac.cd}&bairro=${xss}`);
  await espera(400);
  await avaliar(`const e = document.querySelector('#cand-busca'); e.value = '<svg onload=alert(1)>'; e.dispatchEvent(new Event('input')); return 1`);
  await espera(500);
  verificar(await avaliar('return !document.querySelector("img[src=x], svg[onload]") && document.title !== "XSS"'), 'HTML injetado foi interpretado');
});

await caso('Local de votação e seção (AC, capital) carregam com o nome do local', async () => {
  await abrir(`#/resultados?cargo=governador&uf=AC&mun=${ac.cd}&zona=${localAc.z}&local=${localAc.n}`);
  verificar(await aguardar('document.querySelector(".migalhas")'), 'recorte não carregou');
  const migalhas = await avaliar('return document.querySelector(".migalhas").textContent');
  verificar(migalhas.toLowerCase().includes(localAc.nome.toLowerCase().slice(0, 10)), `migalhas sem o local: ${migalhas}`);
  await abrir(`#/resultados?cargo=governador&uf=AC&mun=${ac.cd}&zona=${localAc.z}&secao=${localAc.secoes[0]}`);
  verificar(await aguardar('document.querySelector(".migalhas") && document.querySelector(".kpi")'), 'seção não carregou');
});

await caso(`Mapa, 2º turno por município (${ufSegundoTurno}): percentuais nunca acima de 100%`, async () => {
  await abrir(`#/mapa?cargo=governador&turno=2&uf=${ufSegundoTurno}&mun=${capital2t.cd}`);
  verificar(await aguardar('document.querySelector(".mapa-svg") && document.querySelector(".painel-titulo")', 12000), 'mapa/painel não carregou');
  const textos = await avaliar('return [...document.querySelectorAll(".mapa-painel strong")].map(s => s.textContent)');
  const ruins = textos.filter(t => /%$/.test(t) && parseFloat(t.replace(/\./g, '').replace(',', '.')) > 100);
  verificar(!ruins.length, `percentual impossível no painel: ${ruins}`);
  await foto('03-mapa-2turno');
});

await caso('Mapa do Brasil: 27 estados clicáveis por teclado e legenda presente', async () => {
  await abrir('#/mapa?cargo=presidente');
  verificar(await aguardar('document.querySelectorAll(".mapa-svg path[tabindex]").length === 27', 12000), 'mapa não tem 27 UFs focáveis');
  verificar(await aguardar('document.querySelector(".legenda li")'), 'legenda ausente');
  await avaliar('const p = document.querySelector(".mapa-svg path[tabindex]"); p.focus(); p.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); return 1');
  verificar(await aguardar('/uf=[A-Z]{2}/.test(location.hash)'), 'Enter no estado não abriu o estado');
});

await caso('Gráficos: 5 candidatos e 5 partidos, com visão em tabela', async () => {
  await abrir('#/graficos?cargo=senador&uf=SP');
  verificar(await aguardar('document.querySelectorAll(".barras-linha").length >= 6', 8000), 'gráficos não renderizaram');
  const n = await avaliar('return [...document.querySelectorAll(".barras")].map(b => b.querySelectorAll(".barras-linha").length)');
  verificar(n.length === 2 && n.every(x => x > 0 && x <= 5), `quantidade de barras inesperada: ${n}`);
  verificar(await avaliar('return document.querySelectorAll("details.tabela-dados").length === 2'), 'falta a visão em tabela');
  await foto('04-graficos');
});

await caso('Tema claro/escuro: alterna, fica salvo e muda a cor do navegador', async () => {
  await abrir('#/resultados?cargo=presidente', { tema: 'escuro' });
  await avaliar('document.querySelector("#tema-botao").click(); return 1');
  verificar(await avaliar('return document.documentElement.dataset.tema === "claro" && localStorage.getItem("cadeOEleito.tema") === "claro"'), 'tema claro não aplicado/salvo');
  verificar(await avaliar('return document.querySelector("meta[name=theme-color]").content === "#ffffff"'), 'theme-color não mudou');
  await cmd('Page.reload'); await aguardar('document.readyState === "complete"');
  verificar(await avaliar('return document.documentElement.dataset.tema === "claro"'), 'tema não persistiu após recarregar');
});

// Design: sem rolagem horizontal, contraste de texto e nomes acessíveis, em todas as páginas,
// nos dois temas e em 4 larguras de tela.
const PAGINAS = ['#/resultados?cargo=deputado_federal&uf=SP', '#/graficos?cargo=presidente', '#/mapa?cargo=governador&uf=MG', '#/sobre'];
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
