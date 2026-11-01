// Compartilhamento do cartão do candidato: imagem quadrada (1080 × 1080, formato do Instagram)
// desenhada em canvas, links diretos para X, WhatsApp e Facebook e "copiar link". Nada é enviado a terceiros sem o clique do usuário.

import { h, numero, pct, icone } from './dom.js';

const LADO = 1080;
// Mesmas fontes do site (public/fonts): Inter nos números e textos, Newsreader na marca e no nome.
const FONTE = '"Inter", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
const SERIFA = '"Newsreader", Georgia, "Times New Roman", serif';
const fonte = (peso, tam) => `${peso} ${tam}px ${FONTE}`;
const serifa = (peso, tam) => `${peso} ${tam}px ${SERIFA}`;

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

// Logo "lupa no mapa" (mesmo desenho do título), em coordenadas de 64 × 64.
function logo(g, x, y, tam) {
  g.save();
  g.translate(x, y); g.scale(tam / 64, tam / 64);
  g.strokeStyle = '#3b82f6'; g.lineCap = 'round';
  g.lineWidth = 6; g.beginPath(); g.arc(27, 27, 17, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 8; g.beginPath(); g.moveTo(40, 40); g.lineTo(55, 55); g.stroke();
  g.fillStyle = '#d5dbe3';
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

// Foto em "cover" dentro de um retângulo arredondado.
function desenharFoto(g, img, x, y, w, alt) {
  g.save();
  retangulo(g, x, y, w, alt, 24); g.clip();
  const escala = Math.max(w / img.naturalWidth, alt / img.naturalHeight);
  const lw = img.naturalWidth * escala, la = img.naturalHeight * escala;
  g.drawImage(img, x + (w - lw) / 2, y + (alt - la) / 2, lw, la);
  g.restore();
  retangulo(g, x, y, w, alt, 24);
  g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 3; g.stroke();
}

// i: { nome, numero, partido, cargo, uf, situacao, eleito, local, votos, percentual, posicao, total, turno, foto }
export async function desenharImagem(i) {
  const foto = await carregarFoto(i.foto);
  // O canvas só usa a fonte da página se ela já estiver carregada.
  await Promise.all([document.fonts?.load(serifa(600, 68)), document.fonts?.load(fonte(800, 56))]).catch(() => {});
  const cv = document.createElement('canvas');
  cv.width = LADO; cv.height = LADO;
  const g = cv.getContext('2d');
  const M = 80; // margem
  const fundo = g.createLinearGradient(0, 0, LADO, LADO);
  fundo.addColorStop(0, '#0c1322'); fundo.addColorStop(1, '#1b3766');
  g.fillStyle = fundo; g.fillRect(0, 0, LADO, LADO);
  const brilho = g.createRadialGradient(LADO * 0.85, 0, 0, LADO * 0.85, 0, 700);
  brilho.addColorStop(0, 'rgba(59,130,246,.35)'); brilho.addColorStop(1, 'rgba(59,130,246,0)');
  g.fillStyle = brilho; g.fillRect(0, 0, LADO, LADO);
  g.textBaseline = 'alphabetic';

  // Marca e eleição.
  logo(g, M, 66, 72);
  g.fillStyle = '#eef1f5'; g.font = serifa(600, 48); g.textAlign = 'left';
  g.fillText('Cadê o eleito?', M + 90, 118);
  g.fillStyle = '#8ab4f8'; g.font = fonte(700, 28); g.textAlign = 'right';
  g.fillText(`Eleições 2026 · ${i.turno}º turno`, LADO - M, 114);
  g.textAlign = 'left';

  // Foto à direita (3 × 4); o texto ao lado dela fica mais estreito.
  const FW = 240, FH = 320, FX = LADO - M - FW, FY = 200;
  if (foto) desenharFoto(g, foto, FX, FY, FW, FH);
  const largTexto = foto ? FX - M - 28 : LADO - 2 * M;

  // Número, nome, partido e cargo.
  let y = 230;
  g.font = fonte(800, 56);
  const largNum = g.measureText(i.numero).width + 56;
  g.fillStyle = 'rgba(255,255,255,.14)'; retangulo(g, M, y, largNum, 96, 18); g.fill();
  g.fillStyle = '#ffffff'; g.fillText(i.numero, M + 28, y + 68);
  if (i.eleito) {
    g.font = fonte(800, 26);
    const selo = i.eleitoTexto || 'ELEITO'; // ELEITO / ELEITA
    const w = g.measureText(selo).width + 40;
    g.fillStyle = 'rgba(34,197,94,.22)'; retangulo(g, M + largNum + 20, y + 26, w, 46, 23); g.fill();
    g.strokeStyle = 'rgba(110,231,160,.6)'; g.lineWidth = 2; g.stroke();
    g.fillStyle = '#6ee7a0'; g.fillText(selo, M + largNum + 40, y + 59);
  }
  y += 170;
  g.fillStyle = '#ffffff'; g.font = serifa(600, 70);
  for (const l of linhas(g, i.nome, largTexto, 2)) { g.fillText(l, M, y); y += 78; }
  g.fillStyle = '#b6bdc8'; g.font = fonte(600, 32);
  for (const l of linhas(g, [i.partido, i.cargo, i.uf !== 'BR' ? i.uf : ''].filter(Boolean).join(' · '), largTexto, 2)) { g.fillText(l, M, y + 4); y += 40; }
  y = Math.max(y + 30, foto ? FY + FH + 50 : 0);

  // Recorte da pesquisa.
  g.fillStyle = '#8ab4f8'; g.font = fonte(700, 24);
  g.fillText('ONDE', M, y); y += 44;
  g.fillStyle = '#eef1f5'; g.font = fonte(650, 34);
  for (const l of linhas(g, i.local, LADO - 2 * M, 2)) { g.fillText(l, M, y); y += 44; }

  // Métricas.
  const topo = Math.max(y + 30, 760);
  const larg = (LADO - 2 * M - 40) / 3;
  const metricas = [
    [numero(i.votos), 'votos'],
    [pct(i.percentual), 'dos votos válidos'],
    [i.posicao ? `${i.posicao}º` : '—', i.total ? `de ${numero(i.total)} candidatos` : 'posição'],
  ];
  metricas.forEach(([valor, rotulo], k) => {
    const x = M + k * (larg + 20);
    g.fillStyle = 'rgba(255,255,255,.08)'; retangulo(g, x, topo, larg, 160, 20); g.fill();
    g.fillStyle = '#ffffff'; g.font = fonte(800, valor.length > 7 ? 44 : 54);
    g.fillText(valor, x + 26, topo + 82);
    g.fillStyle = '#b6bdc8'; g.font = fonte(600, 24);
    g.fillText(rotulo, x + 26, topo + 126);
  });

  // Rodapé.
  g.fillStyle = '#8a93a0'; g.font = fonte(500, 24);
  g.fillText(`Dados oficiais do TSE · ${location.host || 'Cadê o eleito?'}`, M, LADO - 50);
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
