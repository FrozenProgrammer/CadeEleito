// Tema claro/escuro. Script clássico (não módulo) carregado no <head>: aplica o tema
// salvo antes da primeira pintura, para a página não piscar no tema errado.
// Padrão: escuro. A escolha fica só no navegador do visitante (localStorage).
(function () {
  var CHAVE = 'cadeOEleito.tema';
  var COR_TOPO = { escuro: '#0c0e12', claro: '#ffffff' };
  var raiz = document.documentElement;

  function atual() { return raiz.dataset.tema === 'claro' ? 'claro' : 'escuro'; }

  function aplicar(tema) {
    if (tema === 'claro') raiz.dataset.tema = 'claro'; else delete raiz.dataset.tema;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', COR_TOPO[tema]);
    var botao = document.getElementById('tema-botao');
    if (botao) {
      var rotulo = tema === 'claro' ? 'Ativar tema escuro' : 'Ativar tema claro';
      botao.setAttribute('aria-label', rotulo);
      botao.title = rotulo;
    }
  }

  var salvo = null;
  try { salvo = localStorage.getItem(CHAVE); } catch (e) { /* armazenamento bloqueado */ }
  aplicar(salvo === 'claro' ? 'claro' : 'escuro');

  document.addEventListener('DOMContentLoaded', function () {
    aplicar(atual());
    var botao = document.getElementById('tema-botao');
    if (!botao) return;
    botao.addEventListener('click', function () {
      var novo = atual() === 'claro' ? 'escuro' : 'claro';
      aplicar(novo);
      try { localStorage.setItem(CHAVE, novo); } catch (e) { /* vale só nesta visita */ }
    });
  });
})();
