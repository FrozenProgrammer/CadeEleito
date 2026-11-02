// Estado global do filtro, sincronizado com a URL (#/pagina?turno=1&cargo=...).
// Qualquer recorte pode ser compartilhado copiando o endereço.

// cand2: 2º candidato (comparação); foco: '2' quando o recorte segue o 2º (candidatos de estados diferentes).
const CAMPOS = ['turno', 'cargo', 'uf', 'mun', 'zona', 'bairro', 'local', 'secao', 'cand', 'cand2', 'foco'];
const PAGINAS = ['resultados', 'mapa', 'sobre', 'tipografia'];
const FORMATOS = {
  turno: /^[12]$/, cargo: /^[a-z_]{1,30}$/, uf: /^[A-Z]{2}$/, mun: /^\d{5}$/, zona: /^[1-9]\d{0,3}$/,
  bairro: /^[^\u0000-\u001f]{1,150}$/, local: /^[1-9]\d{0,4}$/, secao: /^[1-9]\d{0,4}$/, cand: /^\d{1,20}$/, cand2: /^\d{1,20}$/, foco: /^2$/,
};
// Ordem hierárquica: mudar um nível limpa os níveis abaixo dele.
const HIERARQUIA = ['uf', 'mun', 'zona', 'bairro', 'local', 'secao'];

export const estado = { pagina: 'resultados', turno: '1', cargo: '', uf: '', mun: '', zona: '', bairro: '', local: '', secao: '', cand: '', cand2: '', foco: '' };
export const contexto = { config: null, candidato: null, candidato2: null, municipios: [], locais: null };

const ouvintes = new Set();
export const aoMudar = fn => ouvintes.add(fn);

function lerUrl() {
  const [rota, qs = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const p = new URLSearchParams(qs);
  estado.pagina = PAGINAS.includes(rota) ? rota : 'resultados';
  // A URL pode ser editada por qualquer um: só valores no formato esperado entram no estado.
  for (const c of CAMPOS) {
    let v = (p.get(c) || '').trim();
    if (c === 'uf') v = v.toUpperCase();
    estado[c] = FORMATOS[c].test(v) ? v : '';
  }
  if (!estado.turno) estado.turno = '1';
}

export function urlPara(pagina = estado.pagina, extra = {}) {
  const p = new URLSearchParams();
  const alvo = { ...estado, ...extra };
  for (const c of CAMPOS) if (alvo[c] && !(c === 'turno' && alvo[c] === '1')) p.set(c, alvo[c]);
  const qs = p.toString();
  return `#/${pagina}${qs ? `?${qs}` : ''}`;
}

// Alterações feitas por um ouvinte durante o aviso (ex.: normalizarEstado trocando a UF) entram no
// mesmo conjunto `mudou`, para os ouvintes seguintes (e o próprio, depois de normalizar) as verem.
let emCurso = null;
function notificar(mudou) {
  if (emCurso) { for (const k of mudou) emCurso.add(k); return; }
  emCurso = mudou;
  try { for (const fn of ouvintes) fn(mudou); } finally { emCurso = null; }
}

// Aplica alterações; níveis abaixo do mais alto alterado são limpos, exceto os informados.
export function definir(alteracoes) {
  const mudou = new Set();
  let nivelMaisAlto = Infinity;
  for (const [k, v] of Object.entries(alteracoes)) {
    const val = v === null || v === undefined ? '' : String(v);
    if (estado[k] === val) continue;
    estado[k] = val;
    mudou.add(k);
    const i = HIERARQUIA.indexOf(k);
    if (i >= 0) nivelMaisAlto = Math.min(nivelMaisAlto, i);
  }
  if (nivelMaisAlto < Infinity) {
    for (const k of HIERARQUIA.slice(nivelMaisAlto + 1)) {
      if (k in alteracoes || !estado[k]) continue;
      // Bairro sobrevive à troca de zona (é filtrado por ela); local/seção não.
      if (k === 'bairro' && HIERARQUIA[nivelMaisAlto] === 'zona') continue;
      estado[k] = '';
      mudou.add(k);
    }
  }
  if (!mudou.size) return;
  history.replaceState(null, '', urlPara());
  notificar(mudou);
}

export function irPara(pagina) {
  if (estado.pagina === pagina) return;
  location.hash = urlPara(pagina);
}

// Reescreve a URL na forma canônica (ex.: "uf=sp" -> "uf=SP", parâmetros inválidos removidos).
function canonizarUrl() {
  const canonica = urlPara();
  if (location.hash !== canonica) history.replaceState(null, '', canonica);
}

export function iniciarEstado() {
  lerUrl();
  canonizarUrl();
  window.addEventListener('hashchange', () => {
    const antes = { ...estado };
    lerUrl();
    canonizarUrl();
    const mudou = new Set(Object.keys(estado).filter(k => antes[k] !== estado[k]));
    if (mudou.size) notificar(mudou);
  });
}

// Parâmetros da consulta /api/resultado a partir do estado atual.
export function consultaAtual(extra = {}) {
  const s = { ...estado, ...extra };
  return { turno: s.turno, cargo: s.cargo, uf: s.uf, mun: s.mun, zona: s.zona, bairro: s.bairro, local: s.local, secao: s.secao };
}
