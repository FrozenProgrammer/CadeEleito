// Compartilhamento do cartão do candidato: imagem quadrada (1080 × 1080, formato do Instagram)
// desenhada em canvas, links diretos para X, WhatsApp e Facebook e "copiar link". Nada é enviado a terceiros sem o clique do usuário.

import { h, numero, pct, icone } from './dom.js';

const LADO = 1080;
// Mesmas fontes do site (public/fonts): Inter nos números e textos, Alata na marca e no nome.
const FONTE = '"Inter", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
const MARCA = `"Alata", ${FONTE}`;
const fonte = (peso, tam) => `${peso} ${tam}px ${FONTE}`;
const marca = (peso, tam) => `${peso} ${tam}px ${MARCA}`;

// Endereço do site no rodapé do cartão: o canônico (BR_ELEICOES_SITE_URL), senão o atual.
export function dominioSite() {
  const canonico = document.querySelector('link[rel="canonical"]')?.href;
  try { return new URL(canonico || location.href).host || 'Cadê o eleito?'; } catch { return 'Cadê o eleito?'; }
}

// Cores do cartão em cada tema (as mesmas de .cartao-social em css/app.css).
const TEMAS = {
  escuro: { fundo: '#0f1a2e', painel: '#1a2742', texto: '#eef1f5', texto2: '#a9b4c4', fio: 'rgba(255,255,255,.14)', trilho: '#2b3a57', logo1: '#00d4c6', logo2: '#d5dbe3' },
  claro: { fundo: '#f4f8fb', painel: '#e3e8ee', texto: '#0f141a', texto2: '#4a5563', fio: '#cfd6de', trilho: '#c9d1da', logo1: '#0d9488', logo2: '#1f2937' },
};
// Etiqueta da situação (fundo, texto, bolinha) por tipo e tema.
const SITUACOES = {
  escuro: { eleito: ['rgba(34,197,94,.18)', '#86efac', '#22c55e'], nao: ['rgba(239,68,68,.2)', '#fca5a5', '#ef4444'], segundo: ['rgba(234,179,8,.18)', '#fde68a', '#eab308'], outro: ['rgba(255,255,255,.1)', '#cbd2dc', '#8a93a0'] },
  claro: { eleito: ['#dcfce7', '#166534', '#16a34a'], nao: ['#fde2e2', '#b42323', '#dc2626'], segundo: ['#fef3c7', '#92400e', '#d97706'], outro: ['#e5e7eb', '#374151', '#6b7280'] },
};

function retangulo(g, x, y, w, alt, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + alt, r); g.arcTo(x + w, y + alt, x, y + alt, r);
  g.arcTo(x, y + alt, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// Quebra o texto em até `max` linhas; a última termina em "…" se não couber.
function linhas(g, texto, largura, max) {
  const out = [];
  let atual = '';
  for (const p of String(texto).split(/\s+/)) {
    const tenta = atual ? `${atual} ${p}` : p;
    if (g.measureText(tenta).width <= largura || !atual) atual = tenta;
    else { out.push(atual); atual = p; }
  }
  if (atual) out.push(atual);
  if (out.length > max) {
    out.length = max;
    let u = out[max - 1];
    while (u && g.measureText(`${u}…`).width > largura) u = u.slice(0, -1);
    out[max - 1] = `${u.trimEnd()}…`;
  }
  return out;
}

// Maior tamanho de fonte (de `tamanhos`, do maior ao menor) em que o texto cabe em `max` linhas
// sem cortar; no menor, corta com "…". Deixa a fonte escolhida em g e devolve as linhas e o tamanho.
function caber(g, texto, largura, max, fonteDe, tamanhos) {
  for (const tam of tamanhos) {
    g.font = fonteDe(tam);
    const l = linhas(g, texto, largura, max);
    if (!l[l.length - 1].endsWith('…') || tam === tamanhos[tamanhos.length - 1]) return { linhas: l, tam };
  }
}

// Logo "lupa no mapa" (mesmo desenho do título), em coordenadas de 64 × 64.
function logo(g, x, y, tam, cor1 = '#00d4c6', cor2 = '#d5dbe3') {
  g.save();
  g.translate(x, y); g.scale(tam / 64, tam / 64);
  g.strokeStyle = cor1; g.lineCap = 'round';
  g.lineWidth = 6; g.beginPath(); g.arc(27, 27, 17, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 8; g.beginPath(); g.moveTo(40, 40); g.lineTo(55, 55); g.stroke();
  g.fillStyle = cor2;
  g.beginPath();
  g.moveTo(27, 15.5); g.bezierCurveTo(31.4, 15.5, 35, 19.1, 35, 23.5); g.bezierCurveTo(35, 29.7, 27, 37, 27, 37);
  g.bezierCurveTo(27, 37, 19, 29.7, 19, 23.5); g.bezierCurveTo(19, 19.1, 22.6, 15.5, 27, 15.5); g.closePath();
  g.moveTo(30, 23.5); g.arc(27, 23.5, 3, 0, Math.PI * 2, true);
  g.fill('evenodd');
  g.restore();
}

// Foto do próprio site (mesma origem: o canvas continua exportável). Falha = sem foto.
async function carregarFoto(url) {
  if (!url) return null;
  try { const img = new Image(); img.src = url; await img.decode(); return img; } catch { return null; }
}

// Foto em "cover" dentro de um retângulo arredondado, com moldura na cor do partido.
function desenharFoto(g, img, x, y, w, alt, moldura) {
  g.save();
  retangulo(g, x, y, w, alt, 26); g.clip();
  const escala = Math.max(w / img.naturalWidth, alt / img.naturalHeight);
  const lw = img.naturalWidth * escala, la = img.naturalHeight * escala;
  g.drawImage(img, x + (w - lw) / 2, y + (alt - la) / 2, lw, la);
  g.restore();
  retangulo(g, x, y, w, alt, 26);
  g.strokeStyle = moldura; g.lineWidth = 7; g.stroke();
}

// i: os dados do cartão (js/paginas/resultados.js, dadosCartao): nome, numero, partido, cargo,
// local, situacao, tipoSituacao, votos, percentual, colocacao, distancia, cores, dominio, turno, foto.
// Mesmo desenho do cartão da página, no tema atual (claro ou escuro).
export async function desenharImagem(i) {
  const tema = document.documentElement.dataset.tema === 'claro' ? 'claro' : 'escuro';
  const t = TEMAS[tema];
  const k = i.cores || { c1: '#6B7280', c2: '#374151', numFundo: '#374151', numTexto: '#FFFFFF', trilho: null };
  const foto = await carregarFoto(i.foto);
  // O canvas só usa a fonte da página se ela já estiver carregada.
  await Promise.all([document.fonts?.load(marca(600, 60)), document.fonts?.load(fonte(800, 56))]).catch(() => {});
  const cv = document.createElement('canvas');
  cv.width = LADO; cv.height = LADO;
  const g = cv.getContext('2d');
  const M = 72; // margem
  g.fillStyle = t.fundo; g.fillRect(0, 0, LADO, LADO);
  g.textBaseline = 'alphabetic';

  // Faixa do topo: metade de cada cor do partido.
  g.fillStyle = k.c1; g.fillRect(0, 0, LADO / 2, 18);
  g.fillStyle = k.faixa2?.[tema] || k.c2; g.fillRect(LADO / 2, 0, LADO / 2, 18);

  // Marca e eleição.
  logo(g, M, 58, 60, t.logo1, t.logo2);
  g.fillStyle = t.texto; g.font = marca(600, 44); g.textAlign = 'left';
  g.fillText('Cadê o eleito?', M + 76, 104);
  g.fillStyle = t.texto2; g.font = fonte(600, 24); g.textAlign = 'right';
  g.fillText(`ELEIÇÕES 2026 · ${i.turno}º TURNO`, LADO - M, 100);
  g.textAlign = 'left';
  g.fillStyle = t.fio; g.fillRect(M, 146, LADO - 2 * M, 2);

  // Foto à esquerda; partido, cargo e local, número e nome ao lado.
  const FW = 230, FH = 300, FY = 186;
  if (foto) desenharFoto(g, foto, M, FY, FW, FH, k.c1);
  const X = foto ? M + FW + 40 : M, W = LADO - M - X;
  let y = FY + 30;
  g.font = fonte(700, 26);
  const sigla = String(i.partido || '').toUpperCase();
  const resto = `· ${String(i.cargo || '').toUpperCase()} · ${String(i.local || '').toUpperCase()}`;
  g.fillStyle = t.texto; g.fillText(sigla, X, y);
  const larguraSigla = g.measureText(sigla).width;
  g.font = fonte(500, 26); g.fillStyle = t.texto2;
  const espaco = g.measureText(' ').width;
  g.fillText(linhas(g, resto, W - larguraSigla - espaco, 1)[0] || '', X + larguraSigla + espaco, y);
  y += 34;

  // Número (quadrado nas cores do partido) e nome.
  g.font = fonte(800, 58);
  const NW = Math.max(118, g.measureText(i.numero).width + 44), NH = 118, NY = y;
  g.fillStyle = k.numFundo; retangulo(g, X, NY, NW, NH, 20); g.fill();
  g.fillStyle = k.numTexto; g.textAlign = 'center'; g.fillText(i.numero, X + NW / 2, NY + 80); g.textAlign = 'left';
  g.fillStyle = t.texto;
  const { linhas: nome, tam: tn } = caber(g, i.nome, W - NW - 28, 2, tam => marca(400, tam), [58, 52, 46, 40]);
  const alturaNome = nome.length * (tn + 6);
  let yn = NY + NH / 2 - alturaNome / 2 + tn * 0.86;
  for (const l of nome) { g.fillText(l, X + NW + 28, yn); yn += tn + 6; }

  // Situação (etiqueta com bolinha), alinhada à direita embaixo do nome.
  if (i.situacao) {
    const [bg, cor, bola] = SITUACOES[tema][i.tipoSituacao] || SITUACOES[tema].outro;
    g.font = fonte(700, 24);
    const txt = i.situacao.toUpperCase();
    const w = g.measureText(txt).width + 70, sy = Math.max(NY + NH, yn - 40) + 22;
    retangulo(g, LADO - M - w, sy, w, 48, 24); g.fillStyle = bg; g.fill();
    g.fillStyle = bola; g.beginPath(); g.arc(LADO - M - w + 26, sy + 24, 7, 0, Math.PI * 2); g.fill();
    g.fillStyle = cor; g.fillText(txt, LADO - M - w + 44, sy + 33);
  }

  // Votos: número, % e barra na cor do partido.
  const VY = 540, VH = 196;
  g.fillStyle = t.painel; retangulo(g, M, VY, LADO - 2 * M, VH, 26); g.fill();
  g.fillStyle = t.texto2; g.font = fonte(600, 24); g.fillText('VOTOS OBTIDOS', M + 36, VY + 52);
  g.fillStyle = t.texto; g.font = fonte(800, 72); g.fillText(numero(i.votos), M + 36, VY + 128);
  g.font = fonte(500, 52); g.textAlign = 'right'; g.fillText(pct(i.percentual), LADO - M - 36, VY + 126); g.textAlign = 'left';
  const BX = M + 36, BW = LADO - 2 * M - 72, BY = VY + 152;
  g.fillStyle = k.trilho || t.trilho; retangulo(g, BX, BY, BW, 16, 8); g.fill();
  const larg = Math.max(16, BW * Math.min(1, Math.max(0, i.percentual / 100)));
  g.fillStyle = k.barra?.[tema] || k.c1; retangulo(g, BX, BY, larg, 16, 8); g.fill();

  // Colocação e distância.
  const CY = VY + VH + 24, CH = 210, CW = (LADO - 2 * M - 24) / 2;
  [i.colocacao, i.distancia].forEach((cx, n) => {
    if (!cx) return;
    const x = M + n * (CW + 24);
    g.fillStyle = t.painel; retangulo(g, x, CY, CW, CH, 26); g.fill();
    g.fillStyle = t.texto2; g.font = fonte(600, 22); g.fillText(linhas(g, cx.rotulo.toUpperCase(), CW - 64, 1)[0], x + 32, CY + 48);
    g.fillStyle = t.texto; g.fillText(caber(g, cx.valor, CW - 64, 1, tam => fonte(800, tam), [50, 44, 38, 34]).linhas[0], x + 32, CY + 112);
    g.fillStyle = t.texto2; g.font = fonte(500, 26);
    let yd = CY + 152;
    for (const l of linhas(g, cx.detalhe, CW - 64, 2)) { g.fillText(l, x + 32, yd); yd += 32; }
  });

  // Rodapé.
  g.fillStyle = t.fio; g.fillRect(M, LADO - 92, LADO - 2 * M, 2);
  g.fillStyle = t.texto2; g.font = fonte(500, 24);
  g.fillText('Dados oficiais do TSE', M, LADO - 44);
  g.textAlign = 'right'; g.fillText(i.dominio || location.host || 'Cadê o eleito?', LADO - M, LADO - 44); g.textAlign = 'left';
  return cv;
}

const paraBlob = cv => new Promise(res => cv.toBlob(res, 'image/png'));
const nomeArquivo = i => `cade-o-eleito-${String(i.nome).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${i.numero}.png`;

async function baixar(i) {
  const blob = await paraBlob(await desenharImagem(i));
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: nomeArquivo(i), hidden: true });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// Texto curto que acompanha o link (cabe no limite do X com folga).
export function textoCompartilhar(i) {
  return `${i.nome} (${i.partido}) teve ${numero(i.votos)} votos (${pct(i.percentual)} dos válidos) em ${i.local}. Eleições 2026, ${i.turno}º turno. #CadeOEleito`;
}

// Barra de ações. `i` traz os dados do cartão e `url`, o endereço absoluto do recorte.
export function acoesCompartilhar(i) {
  const texto = textoCompartilhar(i);
  const aviso = h('span', { class: 'compartilhar-aviso', role: 'status', 'aria-live': 'polite' });
  const avisar = t => { aviso.textContent = t; setTimeout(() => { if (aviso.textContent === t) aviso.textContent = ''; }, 2500); };
  const externo = (rotulo, href, cls) => h('a', { class: `botao-secundario botao-rede ${cls}`, href, target: '_blank', rel: 'noopener noreferrer' }, rotulo);

  const botoes = [];
  botoes.push(
    h('button', { type: 'button', class: 'botao-secundario', title: 'Imagem 1080 × 1080 para Instagram e outras redes', onclick: () => baixar(i).then(() => avisar('Imagem baixada.')).catch(() => avisar('Não foi possível gerar a imagem.')) }, 'Baixar imagem'),
    externo('X / Twitter', `https://twitter.com/intent/tweet?text=${encodeURIComponent(texto)}&url=${encodeURIComponent(i.url)}`, 'rede-x'),
    externo('WhatsApp', `https://wa.me/?text=${encodeURIComponent(`${texto} ${i.url}`)}`, 'rede-whatsapp'),
    externo('Facebook', `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(i.url)}`, 'rede-facebook'),
    h('button', {
      type: 'button', class: 'botao-secundario', onclick: async () => {
        try { await navigator.clipboard.writeText(i.url); avisar('Link copiado!'); } catch { avisar(i.url); }
      },
    }, icone('link'), 'Copiar link'),
  );
  return h('div', { class: 'compartilhar', role: 'group', 'aria-label': 'Compartilhar este resultado' },
    h('span', { class: 'compartilhar-titulo', text: 'Compartilhe:' }), botoes, aviso);
}
