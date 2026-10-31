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

  // Troca animada: o novo tema "abre" em círculo a partir do botão (View Transitions). Sem
  // suporte, as cores mudam com uma transição suave. Quem pede menos movimento troca na hora.
  function trocarAnimado(novo, botao) {
    var menosMovimento = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (menosMovimento) { aplicar(novo); return; }
    if (document.startViewTransition) {
      var r = botao.getBoundingClientRect();
      var x = r.left + r.width / 2, y = r.top + r.height / 2;
      var raio = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
      var transicao = document.startViewTransition(function () { aplicar(novo); });
      transicao.ready.then(function () {
        raiz.animate(
          { clipPath: ['circle(0px at ' + x + 'px ' + y + 'px)', 'circle(' + raio + 'px at ' + x + 'px ' + y + 'px)'] },
          { duration: 600, easing: 'cubic-bezier(.4, 0, .2, 1)', pseudoElement: '::view-transition-new(root)' });
      }).catch(function () { /* transição cancelada: o tema já foi aplicado */ });
      return;
    }
    raiz.classList.add('tema-mudando');
    aplicar(novo);
    setTimeout(function () { raiz.classList.remove('tema-mudando'); }, 500);
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
      try { localStorage.setItem(CHAVE, novo); } catch (e) { /* vale só nesta visita */ }
      trocarAnimado(novo, botao);
    });
  });
})();
