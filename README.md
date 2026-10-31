# BR Eleições 2026

Site para consultar os resultados oficiais das **Eleições Gerais de 2026** (1º turno em 4/10 e 2º turno em 25/10) com dados reais do **Tribunal Superior Eleitoral (TSE)**.

- **Resultados** (página inicial): tudo começa pela busca do candidato (nome ou número); o cargo vem dele. Depois de escolhido, aparecem o turno e o filtro **Estado › Município › Zona › Bairro › Local de votação › Seção**. A busca mostra a **foto oficial** de cada candidato ao lado do número. Abaixo, um **cartão do candidato** com a foto, os votos, o % dos válidos e a posição no local pesquisado, pronto para compartilhar: X, WhatsApp, Facebook, copiar link e **imagem 1080 × 1080** para o Instagram (gerada no navegador). Abaixo do cartão, o mapa de densidade e a fonte dos dados.
- **Mapa**: densidade de votos do candidato buscado, em três níveis de zoom: **Brasil** (por estado, para Presidente) › **Estado** (por município) › **Município**, dividido em **zonas eleitorais** (com o número de cada zona; clique para ver os bairros da zona) ou em **áreas de locais de votação** (clique para ver bairro, endereço e seções). O TSE não publica limites de zonas ou seções: cada ponto do município é atribuído ao local de votação mais próximo (diagrama de Voronoi a partir da latitude/longitude dos locais), e a zona é a união das áreas dos seus locais. Cada área ou local é colorido pelo % dos votos válidos que o candidato teve ali, numa escala de 9 tons: quanto maior o percentual, mais forte a cor. Clicar em um município aproxima o mapa; clicar em uma zona ou local aplica o filtro. **Zoom** pela roda do mouse (no ponto do cursor), pinça no celular ou botões + / −, e arrastar para mover; ao aproximar bastante de um estado ou município ele abre sozinho, e afastar além do mapa inteiro volta ao nível de cima. O logo no canto superior esquerdo volta ao início com todos os filtros limpos.
- **Sobre**: de onde vêm os dados e como ler os números.

## Como funciona

O site é **100% estático**: só HTML, CSS, JavaScript e arquivos de dados. Não há servidor de aplicação nem banco de dados, então ele pode ser publicado em qualquer hospedagem simples de arquivos.

1. **Na geração** (`npm run gerar`), feita uma única vez no seu computador ou no GitHub, os arquivos oficiais do TSE são baixados e divididos em pequenos arquivos comprimidos: um por estado, um por município e um por zona eleitoral.
2. **No navegador**, ao escolher um bairro, local ou seção, o visitante baixa só o arquivo daquela zona e do cargo consultado (Presidente, Governador e Senador ficam separados dos Deputados) e soma os votos das seções na hora, em milissegundos.

Desempenho medido em celular emulado (Chrome, tela de 390 px), com rede **4G lenta** (150 ms de latência, 1,6 Mbps) e **CPU 4 vezes mais lenta**, com cache vazio:

| Página | Tempo até o resultado | Dados baixados |
|---|---|---|
| Início (Presidente, Brasil) | 1,8 s | 117 KB |
| Bairro da capital paulista | 3,3 s | 261 KB |
| Local de votação (Recife) | 2,6 s | 163 KB |
| Zona da capital paulista, Deputado Federal (pior caso) | 4,8 s | 488 KB |
| Mapa de São Paulo | 3,9 s | 321 KB |

Em conexões comuns (Wi-Fi ou 4G bom) e com o cache do navegador, as respostas ficam abaixo de 1 segundo. Não houve rolagem horizontal, campos que forçam zoom no iPhone nem erros de JavaScript em nenhuma página testada.

Nenhum voto é estimado. A soma das seções de cada município confere exatamente com o total oficial do TSE, e isso pode ser verificado com `npm run verificar`.

---

## Rodar localmente

### Requisitos

- **Node.js 22 ou mais novo** (LTS). Não há dependências: **não é preciso rodar `npm install`**.
- Internet para baixar os dados do TSE e do IBGE durante a geração.

### Passo a passo

Abra o terminal **dentro desta pasta**, onde está este `README.md` e o `package.json`.

```powershell
# 1. Gerar o site em dist/
#    Teste rápido: Brasil, todos os estados e mapa, com detalhamento por bairro/seção só do Acre
npm run gerar -- AC

# 2. Abrir a pré-visualização local
npm start
```

Abra **http://127.0.0.1:8000/**.

> **Windows, porta 8000 bloqueada (`EACCES`)**: use outra porta com `$env:PORT=3000; npm start` e abra http://127.0.0.1:3000/.
>
> **Erro sobre `env-cmd` ou `react-scripts`**: o terminal está na pasta errada. Se a pasta atual não tem `package.json`, o npm usa o de uma pasta acima, de outro projeto. Entre nesta pasta com `cd` antes de rodar os comandos.

### Opções de geração

```bash
npm run gerar -- AC              # detalha só o Acre (alguns minutos na primeira vez)
npm run gerar -- AC PE SP        # detalha alguns estados
npm run gerar -- todos           # site completo: todos os estados com bairro, local e seção
```

Brasil, os 27 estados (resultado estadual) e o mapa ficam **sempre** completos. A lista de UFs controla só quais estados têm o detalhamento por município, zona, bairro, local e seção.

O que foi baixado fica em `.cache-brazil-eleicoes-2026/`. Gerar de novo é rápido: só o que falta é baixado.

Referências medidas para a primeira geração (o tempo depende da conexão):

| Estado | Download do TSE | Tempo medido |
|---|---|---|
| AC | 7 MB | cerca de 10 s |
| PE | 106 MB | cerca de 6 min |
| SP | 771 MB | cerca de 90 min nesta conexão |
| Presidente (todas as UFs) | 242 MB | cerca de 2,5 min |

O site completo (`todos`) baixa cerca de 3,5 GB do TSE na primeira vez. Com AC, PE e SP detalhados, o site gerado tem cerca de 3.300 arquivos e 43 MB. O site completo (27 UFs) tem **cerca de 50 mil arquivos** (20 mil são fotos de ~5 KB) e uns 340 MB: cabe no GitHub Pages (limite de 1 GB) e no Netlify, mas passa do limite de 20 mil arquivos do Cloudflare Pages.

#### Endereço do site (recomendado)

Informe o endereço público na geração para ativar a imagem de prévia ao compartilhar o link (WhatsApp, redes sociais) e a URL canônica:

```powershell
$env:BR_ELEICOES_SITE_URL="https://eleicoes.seudominio.com.br"; npm run gerar -- todos
```

No GitHub Actions, crie a variável `SITE_URL` em **Settings › Secrets and variables › Actions › Variables**.

### Conferir os dados

```bash
npm run verificar -- AC governador 1
npm run verificar -- SP deputado_federal 1
npm run verificar -- DF presidente 2
```

O comando refaz a soma das seções de cada município, com o mesmo código usado no navegador (`public/js/calculo.js`), e compara candidato a candidato com o total oficial do TSE. Já foram conferidos, com 100% dos municípios idênticos: AC (todos os cargos e os dois turnos), PE (Governador, Senador e Deputado Estadual) e SP (Governador, Deputado Federal e Presidente no 2º turno).

### Testes automáticos

```bash
npm test          # regras de apuração, segurança do servidor e integridade de todo o dist/dados (~40 s)
npm run test:e2e  # navegador (Chrome/Edge sem janela): 53 cenários de uso, segurança e design
```

- **`npm test`** confere, nas 27 UFs, em todos os cargos e turnos, que a soma dos municípios é igual ao resultado oficial do TSE; que zonas, bairros e locais somam exatamente o município; que o Brasil fecha com as UFs; que o cadastro de candidatos não traz CPF/e-mail; que parâmetros maliciosos (`../`, `%00`, HTML) são recusados; e que `_headers`, `.htaccess`, `<meta>` e `server.js` usam a mesma CSP.
- **`npm run test:e2e`** abre o site e confere busca por teclado, filtros, cartão do candidato, mapa de densidade, tema claro/escuro, links adulterados e injeção de HTML; e, em 4 larguras de tela × 2 temas, rolagem horizontal, contraste WCAG AA, nomes acessíveis e ids repetidos. Para guardar capturas de tela: `E2E_FOTOS=pasta npm run test:e2e`. Chrome em outro caminho: `CHROME=caminho npm run test:e2e`.

O GitHub Actions roda `npm test` antes de publicar: se algum teste falhar, o site não é publicado.

---

## Publicar

Publique o conteúdo da pasta **`dist/`**. Qualquer hospedagem de arquivos estáticos serve.

### Opção 1: GitHub Pages, com geração automática (recomendada)

O arquivo `.github/workflows/publicar.yml` gera o site completo nos servidores do GitHub, que têm conexão rápida, e publica no GitHub Pages:

1. Crie um repositório no GitHub e envie esta pasta (o `dist/` e o cache não são enviados, veja `.gitignore`).
2. Em **Settings › Pages**, escolha **Source: GitHub Actions**.
3. Em **Actions › Gerar e publicar site**, clique em **Run workflow**.

### Opção 2: Netlify ou Cloudflare Pages

Gere localmente com `npm run gerar -- todos` e envie a pasta `dist/`:

- **Netlify**: arraste a pasta `dist/` em https://app.netlify.com/drop.
- **Cloudflare Pages**: crie um projeto com upload direto e envie a pasta `dist/`.

Os cabeçalhos de segurança são aplicados automaticamente pelo arquivo `dist/_headers`.

### Opção 3: Hospedagem compartilhada (Apache, via FTP)

Envie todo o conteúdo de `dist/` para a pasta pública, normalmente `public_html/`. O arquivo `dist/.htaccess` configura os cabeçalhos de segurança e o tipo dos arquivos de dados. Ele é um arquivo oculto: confirme que o programa de FTP o enviou.

O site também funciona em uma subpasta (por exemplo, `https://seusite.com.br/eleicoes/`), porque todos os caminhos são relativos.

---

## Estrutura

```
public/                 Código do site (copiado para dist/ na geração)
  index.html
  css/app.css
  js/app.js             Inicialização e navegação entre páginas
  js/api.js             Camada de dados: lê dist/dados/ e calcula cada recorte
  js/calculo.js         Regras de soma (usadas também pelo gerador e pelo verificador)
  js/filtros.js         Barra de filtros e busca de candidatos
  js/grafico.js         Tooltip do mapa
  fonts/                Newsreader (títulos) e Inter (texto), licença OFL, servidas pelo próprio site
  js/paginas/           Páginas Resultados e Mapa
  _headers, .htaccess   Cabeçalhos de segurança para Netlify/Cloudflare e Apache
lib/                    Usado só na geração: acesso ao TSE/IBGE, leitura de ZIP/CSV e índices
scripts/gerar.js        Gera dist/
scripts/verificar.js    Confere as somas contra o total oficial
server.js               Pré-visualização local de dist/ (não é usado em produção)
.github/workflows/      Geração e publicação automática no GitHub Pages
legado/v2.9/            Versão anterior do projeto, mantida só para referência
```

### Dados gerados (`dist/dados/`, JSON comprimido com gzip)

| Arquivo | Conteúdo |
|---|---|
| `indice.bin` | UFs, cargos, 2º turno e data da geração |
| `br.bin` | Presidente no Brasil |
| `uf/{UF}.bin` | Municípios e zonas da UF |
| `uf/{UF}/{turno}-{cargo}.bin` | Resultado oficial da UF e dados dos candidatos daquele cargo |
| `m/{UF}/{município}.bin` | Locais de votação (nome, endereço, bairro, seções, eleitorado e posição no mapa) e totais do município |
| `s/{UF}/{município}/{zona}.bin` | Votos por seção: Presidente, Governador e Senador, mais o eleitorado de cada seção |
| `s/{UF}/{município}/{zona}-p.bin` | Votos por seção: Deputados, mais o eleitorado de cada seção |
| `mapa/brasil.bin`, `mapa/{UF}.bin` | Contornos do IBGE já convertidos para SVG |
| `mapa/l/{UF}/{município}.bin`, `-p.bin` | Votos válidos e votos de cada candidato por local de votação (majoritários / Deputados): mapa do município |
| `mapa/votos/{UF ou BR}/{turno}-{cargo}.bin` | Votos válidos e votos de cada candidato por município (ou por UF, para Presidente no mapa do Brasil): mapa de densidade |
| `../img/c/{id}.jpg` | Foto oficial do candidato (TSE), ~5 KB cada |
| `candidatos.bin` | Índice da busca de candidatos |

## Fontes de dados (oficiais e públicas)

| Uso | Fonte |
|---|---|
| Resultado do Brasil e dos estados | TSE, divulgação oficial (EA20): `resultados.tse.jus.br/oficial/ele2026/...` |
| Municípios e zonas | TSE, EA12: `.../ele2026/6259/config/mun-e006259-cm.json` |
| Votos por seção (município, zona, bairro, local e seção) | TSE, dados abertos: `cdn.tse.jus.br/estatistica/sead/odsele/votacao_secao/votacao_secao_2026_{UF\|BR}.zip` |
| Bairros, locais de votação e eleitorado | TSE, dados abertos: `.../eleitorado_locais_votacao/eleitorado_local_votacao_2026.zip` |
| Fotos dos candidatos | TSE, dados abertos: `cdn.tse.jus.br/estatistica/sead/eleicoes/eleicoes2026/fotos/foto_cand2026_{UF|BR}_div.zip` |
| Busca de candidatos | TSE, dados abertos: `.../consulta_cand/consulta_cand_2026.zip` (só nome, número, partido, cargo, UF e situação) |
| Contornos do mapa | IBGE, API de malhas. Uma cópia já convertida fica em `dados-fixos/malhas/` (≈ 0,7 MB) e é a usada na geração: a API do IBGE costuma não responder a servidores fora do Brasil, como os do GitHub Actions. Para atualizar a cópia a partir do IBGE (num computador no Brasil): `BR_ELEICOES_ATUALIZAR_MALHAS=1 npm run gerar -- AC` e faça commit de `dados-fixos/malhas/`. |

## Segurança

- **Sem servidor e sem banco de dados**, não há o que invadir no lado do servidor. A hospedagem só entrega arquivos.
- **CSP estrita** (`script-src 'self'; style-src 'self'; connect-src 'self'`), aplicada pelo `_headers`/`.htaccess` e também por uma tag `<meta>` no HTML, que vale para hospedagens que não permitem configurar cabeçalhos. Não há scripts nem estilos inline e nenhum recurso de terceiros é carregado.
- Todo texto vindo dos dados é inserido com `textContent`. Não se usa `innerHTML` com dados, o que evita XSS.
- O site não usa cookies, não faz rastreamento e não coleta dados de visitantes.
- Dados pessoais do cadastro de candidatos (CPF, e-mail, título) **não** entram nos arquivos publicados. Uma varredura em todos os arquivos de `dist/` não encontrou CPF, e-mail nem título de eleitor.
- Só o necessário é publicado: `dist/` não contém código de geração, cache, `package.json` nem arquivos de configuração. O `.htaccess` bloqueia arquivos ocultos e listagem de pastas.
- **Proteção contra frames (clickjacking)**: `X-Frame-Options`/`frame-ancestors` via `_headers`/`.htaccess`. Em hospedagens sem cabeçalhos (GitHub Pages), o próprio script se recusa a rodar dentro de um frame de outro site.
- Os parâmetros da URL (UF, município, zona, seção) são validados antes de montar qualquer caminho de arquivo; links adulterados voltam ao recorte válido mais próximo.
- O GitHub Actions usa permissões mínimas: só o job de publicação recebe o token do Pages.

## Checklist antes de publicar

1. Gerar o site completo: `npm run gerar -- todos` (ou pelo GitHub Actions), com `BR_ELEICOES_SITE_URL` definido.
2. Rodar `npm test` e `npm run test:e2e` (e, se quiser, `npm run verificar -- UF cargo turno`).
3. Testar `dist/` com `npm start`, no computador e no celular.
4. Publicar `dist/` e ativar **HTTPS** na hospedagem. Na hospedagem Apache, descomente as linhas de HTTPS/HSTS no `.htaccess` depois que o certificado estiver ativo.
5. Conferir os cabeçalhos no ar, por exemplo em https://securityheaders.com, e a prévia do link em um aplicativo de mensagens.

Este é um painel **independente**. Não é um site oficial da Justiça Eleitoral.
