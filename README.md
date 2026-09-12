# PrumoENEM — plataforma de estudos para o ENEM

Site estático, sem build. Abre no celular, funciona offline, calcula sua
proficiência pela mesma teoria que o INEP usa e distribui seu tempo de
estudo pelos pesos do seu curso no SiSU.

## Rodar agora, sem configurar nada

```bash
cd site
python3 -m http.server 8000
```

Abra `http://localhost:8000`. O Firebase já está configurado; se os passos do
console ainda não estiverem feitos, o app cai sozinho para modo local e
continua utilizável.

Precisa de um servidor mesmo que local — abrir o `index.html` direto pelo
Finder/Explorer não funciona, porque módulos ES exigem HTTP.

## O que já está pronto

| Parte | Estado |
|---|---|
| 2.757 questões do ENEM 2009–2023 | pronto |
| Pesos reais do SiSU 2026 da UTFPR (12 cursos) | pronto |
| 54 itens de vocabulário para redação | pronto |
| Aba de redação: notas das 5 competências e cronômetro | pronto |
| Sessão com navegação livre, 3 tamanhos e 3 modos de tempo | pronto |
| Cálculo de proficiência e simulação do SiSU | pronto |
| Sessão de 9 questões + vocabulário, 3 min cada | pronto |
| Ofensiva, meta semanal, flashcards com revisão espaçada | pronto |
| Funciona offline (service worker) | pronto |
| Login e sincronização entre aparelhos | credenciais prontas, falta ligar no console |
| Explicações e flashcards por IA | precisa do Worker |
| Sessão 3/3/3 calibrada por dificuldade | precisa dos parâmetros do INEP |

As três últimas são opcionais e independentes. O app funciona sem nenhuma delas.

## Estrutura

```
index.html          página única; as telas são seções
css/app.css
js/
  app.js            roteador e telas
  tri.js            teoria de resposta ao item
  motor.js          prioridade por peso × lacuna, montagem da sessão
  srs.js            revisão espaçada
  estado.js         dados do usuário, ofensiva, backup
  dados.js          carregamento das questões
  nuvem.js          Firebase (opcional)
  ia.js             chamadas ao Worker (opcional)
  config.js         >>> você edita este <<<
dados/              questões, cursos, vocabulário
scripts/            utilitários que rodam uma vez
worker/worker.js    Cloudflare Worker da IA
sw.js               cache offline
```

---

## Passo 1 — Publicar (5 minutos, grátis)

O site é estático, então serve em qualquer lugar. GitHub Pages:

1. Crie um repositório e suba a pasta `site/`
2. Settings → Pages → Source: `main`, pasta `/root`
3. Em poucos minutos ele está no ar

Não use o Firebase Hosting. Deixe o Firebase cuidando só de login e banco —
são as duas coisas que ficam grátis sem cartão.

## Passo 2 — Imagens locais (recomendado)

981 questões têm imagem, e por padrão elas apontam para `enem.dev`. Funciona,
mas amarra o app ao servidor deles e o modo offline fica pela metade.

```bash
node scripts/localizar-imagens.mjs
```

Baixa o repositório do enem-api, copia as 1.840 imagens para `dados/img/` e
reescreve os caminhos. Roda uma vez só, leva alguns minutos.

## Passo 3 — Terminar a configuração do Firebase

As credenciais do projeto `prumoenem-6a949` já estão em `js/config.js`, e
`MODO_LOCAL` está em `false`. Falta ligar as coisas no console.

**Sobre a apiKey estar visível no código:** é assim mesmo. A chave web do
Firebase é pública por design — ela identifica o projeto, não autoriza nada.
Qualquer pessoa pode ver a chave de qualquer app Firebase abrindo o DevTools.
O que protege seus dados são os dois passos abaixo.

### 1. Ativar os métodos de login

Console → Authentication → Sign-in method → ative **apenas o Google**.

Sem isso, o botão devolve `auth/operation-not-allowed`. O login por e-mail e
senha foi removido do código: com restrição de domínio ele seria um buraco,
já que qualquer pessoa digita qualquer endereço no cadastro.

### 2. Criar o Firestore e travar as regras

Console → Firestore Database → Criar banco → **modo de produção** →
região `southamerica-east1` (São Paulo, menor latência daqui).

Depois, aba Regras: cole o conteúdo do arquivo `firestore.rules` e publique.

Essa regra faz duas coisas: só deixa cada estudante ler a própria pasta, e
só aceita contas terminadas em `@escola.pr.gov.br` com e-mail verificado.

**Por que a regra e não só o JavaScript:** a checagem em `js/config.js` roda
no navegador do usuário, e qualquer pessoa desativa em dois cliques no
DevTools. A regra roda no servidor do Google e não tem como contornar. Se
você mudar `DOMINIO_PERMITIDO` sem mudar a regra, não protegeu nada — e se
mudar a regra sem mudar o config, o usuário loga e depois toma erro sem
entender.

### 2c. Abrir para o público depois

Quando quiser tirar a restrição, são dois lugares:

1. `js/config.js` → `DOMINIO_PERMITIDO = ''`
2. `firestore.rules` → apague a linha do `matches(...)` e republique

Para liberar contas específicas sem abrir tudo (a sua pessoal, por exemplo),
use `EMAILS_LIBERADOS` no config **e** acrescente o e-mail na regra:

```javascript
&& (request.auth.token.email.matches('.*@escola[.]pr[.]gov[.]br')
    || request.auth.token.email == 'seuemail@gmail.com')
```

### 3. Autorizar o domínio depois de publicar

Console → Authentication → Settings → **Authorized domains** → adicione o
domínio onde o site vai ficar, por exemplo `seu-usuario.github.io`.

`localhost` já vem autorizado, então em desenvolvimento funciona de cara. Se
esquecer desse passo, o login quebra só em produção, com
`auth/unauthorized-domain` — erro chato justamente porque funciona na sua
máquina.

### O que continua fora do plano Spark

Cloud Functions e Cloud Storage exigem Blaze, com cartão. Nenhum dos dois é
usado aqui: a IA roda no Cloudflare e as imagens são arquivos estáticos.
Mantenha o projeto no Spark e ele nunca gera fatura — se estourar a cota,
apenas para até meia-noite.

**Suas cotas:** 50 mil leituras e 20 mil escritas por dia. Uma sessão custa
cerca de 12 leituras e 2 escritas, o que dá espaço para umas 4.000 sessões
diárias.

### Se o Firebase não carregar

O app detecta e cai para modo local sozinho, com aviso na tela de entrada.
Você continua estudando; quando a conexão voltar e você entrar na conta, o
histórico sobe junto. Nenhuma sessão se perde por causa de rede.

## Passo 4 — IA (Cloudflare Worker)

A IA faz duas coisas: explica cada questão que você errou e gera resumos sob
demanda na aba Revisão. As duas passam pelo Worker.

### Por que o Worker existe

A chave da API não pode ficar no navegador — qualquer um abre o DevTools e
copia. O Worker guarda a chave e só responde a quem apresenta um token válido
do Firebase. Sem essa verificação, quem descobrisse a URL gastaria seus
créditos à vontade.

### 4.1 — Escolher o provedor de IA

O Worker fala com três provedores. Troque `PROVEDOR` no `wrangler.toml`.

| | Custo | Cota | Cartão |
|---|---|---|---|
| `gemini` | grátis | 1.500 chamadas/dia | não |
| `cloudflare` | grátis | ~20 chamadas/dia | não |
| `anthropic` | ~2 centavos de dólar por sessão | sem limite prático | sim, depois do crédito inicial |

**Gemini é a escolha padrão** e a que eu recomendo para começar. Mil e
quinhentas chamadas por dia cobrem a escola inteira, não pede cartão e não
expira. Uma ressalva honesta: no nível grátis o Google pode usar o que você
manda para treinar os modelos dele. Como o conteúdo são questões públicas do
ENEM, isso não me preocupa aqui — mas você precisa saber.

```bash
# Pegue a chave em aistudio.google.com (é só entrar com a conta Google)
npx wrangler secret put GEMINI_API_KEY
```

**Cloudflare** roda dentro do próprio Worker, sem segunda conta e sem chave
nenhuma. O limite é a cota: 10 mil neurônios por dia, e uma resposta média
consome de 400 a 600 — ou seja, de 15 a 25 chamadas diárias no total, somando
todos os usuários. Serve para você testar sozinho, não para a turma.

Para usar, descomente o bloco `[ai]` no `wrangler.toml` e ponha
`PROVEDOR = "cloudflare"`. Modelos abertos explicam exatas pior que o Gemini
ou o Claude — dá para sentir a diferença numa questão de função.

**Anthropic** é a melhor qualidade de explicação, especialmente em
matemática. O Claude Sonnet 5 custa $2 por milhão de tokens de entrada e $10
de saída; uma sessão com quatro erros gasta perto de 3.500 de entrada e 1.200
de saída, o que dá **cerca de 2 centavos de dólar por sessão**, uns 10
centavos de real. Contas novas recebem crédito inicial sem cartão.

```bash
npx wrangler secret put ANTHROPIC_API_KEY
```

Trocar de provedor depois é mudar uma linha e rodar `wrangler deploy` de novo.
O app não sabe qual está ligado — ele só pede explicação e recebe texto.

### 4.2 — Publicar o Worker

```bash
cd worker
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY   # cole a chave quando pedir
npx wrangler deploy
```

Antes do deploy, abra o `wrangler.toml` e troque `SEU_USUARIO.github.io` em
`ORIGENS` pelo endereço real do seu site. Só as origens listadas conseguem
chamar o Worker.

O deploy imprime a URL, algo como `https://prumoenem-ia.SEU-SUBDOMINIO.workers.dev`.

### 4.3 — Ligar no app

Cole a URL em `URL_WORKER` no `js/config.js`. Pronto.

O plano grátis do Cloudflare não pede cartão e dá 100 mil requisições por dia.
O app faz **uma** chamada por sessão, com todos os erros juntos.

### O que o Worker recusa

- Requisição sem token do Firebase → 401
- Token expirado, de outro projeto, com assinatura adulterada ou com
  `alg: none` → 401
- Conta fora de `@escola.pr.gov.br` → 403
- Origem fora da lista de `ORIGENS` → 403
- Mais de 12 questões por chamada → 400

A validação confere a assinatura contra as chaves públicas do Google, e não
apenas lê o conteúdo do token. Está coberta por testes em `teste-worker.mjs`,
incluindo os ataques acima.

### Se a IA estiver desligada

O app funciona igual: você só vê o gabarito em vez da explicação, e o
flashcard nasce genérico. A aba Resumos avisa e desabilita o campo.

## Passo 5 — Calibrar a dificuldade (opcional, mas vale)

Enquanto não fizer isso, a sessão sorteia 9 questões quaisquer e a
proficiência é estimada por proporção de acertos. Funciona, mas ignora
*quais* questões você errou — que é justamente o que a TRI acrescenta.

### Onde baixar

[gov.br/inep](https://www.gov.br/inep/pt-br/acesso-a-informacao/dados-abertos/microdados/enem)
→ Dados Abertos → Microdados → ENEM. Baixe **2020, 2021, 2022 e 2023**.

Anos anteriores a 2020 não têm os parâmetros publicados, e anos posteriores a
2023 não existem no banco de questões — o CSV de 2025 casa com zero questões.

### O que extrair

Cada ZIP tem mais de um gigabyte, quase tudo respostas de candidatos que não
interessam aqui. Do ZIP, extraia **um arquivo só**:

```
DADOS/ITENS_PROVA_<ano>.csv
```

São uns poucos megabytes cada.

### Onde colocar

Na pasta `microdados/`, ao lado da pasta do site:

```
PrumoEnem/
├── microdados/          ← os CSV vão aqui
│   ├── ITENS_PROVA_2020.csv
│   ├── ITENS_PROVA_2021.csv
│   ├── ITENS_PROVA_2022.csv
│   └── ITENS_PROVA_2023.csv
├── index.html
├── dados/
└── scripts/
```

A pasta já está no `.gitignore`, então os CSV não vão para o repositório —
só o resultado da mesclagem, que fica dentro dos `dados/questoes-*.json`.

### Rodar

De dentro da pasta do site:

```bash
node scripts/mesclar-tri.mjs
```

Sem argumento nenhum ele procura em `../microdados/` e pega todos os
`ITENS_PROVA_*.csv` que achar. Também aceita caminhos avulsos:

```bash
node scripts/mesclar-tri.mjs ../microdados/ITENS_PROVA_2023.csv
```

Ele imprime quantas questões calibrou por área e por ano. Com os quatro anos,
espere algo em torno de 700 de 2.718 — o que já liga o 3/3/3 real para uma
fatia grande do banco.

Se a taxa vier perto de zero, confira `COR_PREFERIDA` no topo do script: cada
cor de caderno embaralha as mesmas questões em ordem diferente.

## Decisões que talvez não sejam óbvias

**Questões são arquivo, não banco.** São públicas, iguais para todo mundo e
nunca mudam. No Firestore você pagaria leitura por dado imutável e perderia o
cache. Como JSON estático, o service worker guarda e a sessão abre sem rede.

**A estimativa usa MAP, não máxima verossimilhança.** Sem o termo de
regularização, quem gabarita as 9 questões receberia proficiência infinita. Com
9 questões por sessão isso aconteceria toda semana.

**A tela mostra faixa, não número, no começo.** Com 9 questões a margem de erro
passa de 100 pontos. Exibir "sua nota é 581" seria mentira; o app só mostra
número cravado quando o erro padrão cai o bastante.

**Fácil/médio/difícil é relativo ao seu θ, não a uma escala fixa.** Faixas fixas
te dariam 3 questões quase impossíveis toda sessão. Conforme você melhora, as
questões sobem junto.

**Errar o vocabulário não trava a sessão.** Travar até acertar vira chute até
sair. O item errado volta na próxima sessão e só sai da fila depois de dois
acertos seguidos — mais rigoroso, e sem beco sem saída.

**A explicação dos erros é obrigatória, mas por dependência.** Você precisa
escolher qual conceito falhou para liberar o botão, e essa escolha é o que
gera o flashcard. Não tem timer para esperar nem scroll para fingir.

## Backup

Modo local guarda tudo no navegador, e navegador esquece. A tela de perfil tem
**Exportar backup**: baixa um JSON com histórico, proficiência e cartões. Faça
isso de vez em quando, ou configure o Firebase e pare de se preocupar.

## Créditos e licença

Questões e imagens vêm da [API ENEM](https://enem.dev), projeto open-source da
comunidade brasileira, licença GNU GPL-2.0. Os dados são públicos, obtidos de
fontes abertas do INEP.

Pesos e vagas: Termo de Adesão SiSU 1ª edição de 2026 da UTFPR.
Os pesos são republicados a cada ano — confira antes de cada edição.
