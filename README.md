# PrumoENEM — plataforma de estudos para o ENEM

Site estático, sem build. Abre no celular, funciona offline, calcula sua
proficiência pela mesma teoria que o INEP usa e distribui seu tempo de
estudo pelos pesos do seu curso no SiSU.

## Rodar agora, sem configurar nada

```bash
cd site
python3 -m http.server 8000
```

Abra `http://localhost:8000`. Já vem em modo local: nada de login, os dados
ficam no navegador. Dá para usar assim indefinidamente.

Precisa de um servidor mesmo que local — abrir o `index.html` direto pelo
Finder/Explorer não funciona, porque módulos ES exigem HTTP.

## O que já está pronto

| Parte | Estado |
|---|---|
| 2.757 questões do ENEM 2009–2023 | pronto |
| Pesos reais do SiSU 2026 da UTFPR (12 cursos) | pronto |
| 54 itens de vocabulário para redação | pronto |
| Cálculo de proficiência e simulação do SiSU | pronto |
| Sessão de 9 questões + vocabulário, 3 min cada | pronto |
| Ofensiva, meta semanal, flashcards com revisão espaçada | pronto |
| Funciona offline (service worker) | pronto |
| Login e sincronização entre aparelhos | precisa do Firebase |
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

## Passo 3 — Login e sincronização (opcional)

Sem isso, seus dados vivem só neste navegador. Limpou o cache, perdeu tudo.

1. [console.firebase.google.com](https://console.firebase.google.com) → criar projeto
2. Mantenha o plano **Spark**. Não vincule cartão.
3. Authentication → Sign-in method → ative **E-mail/senha** e **Google**
4. Firestore Database → criar banco → modo produção
5. Regras do Firestore:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /usuarios/{uid}/{documento=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

6. Configurações do projeto → Seus apps → Web → copie as credenciais
7. Cole em `js/config.js` e mude `MODO_LOCAL` para `false`

**O que o Spark não dá:** Cloud Functions e Cloud Storage. Nenhum dos dois é
usado aqui — a IA roda no Cloudflare e as imagens são arquivos estáticos.

**Suas cotas:** 50 mil leituras e 20 mil escritas por dia. Uma sessão custa
cerca de 12 leituras e 2 escritas, então cabem umas 4.000 sessões diárias.
E como o Spark não tem faturamento vinculado, ele nunca gera conta: se
estourar, para até meia-noite.

## Passo 4 — IA (opcional)

A chave da API não pode ficar no navegador. O Worker existe só para isso.

```bash
cd worker
npm install -g wrangler
wrangler init --yes
# aponte o main do wrangler.toml para worker.js
wrangler secret put ANTHROPIC_API_KEY
wrangler deploy
```

Copie a URL e cole em `URL_WORKER` no `js/config.js`.

O plano grátis do Cloudflare não pede cartão e dá 100 mil requisições por dia.
O app faz **uma** chamada por sessão, com todos os erros juntos — mais barato,
mais rápido, e o modelo enxerga o padrão dos erros em vez de uma questão isolada.

## Passo 5 — Calibrar a dificuldade (opcional, mas vale)

Enquanto não fizer isso, a sessão sorteia 9 questões quaisquer e a proficiência
é estimada por proporção de acertos. Funciona, mas ignora *quais* questões você
errou — que é justamente o que a TRI acrescenta.

1. Baixe os microdados em
   [gov.br/inep → microdados → ENEM](https://www.gov.br/inep/pt-br/acesso-a-informacao/dados-abertos/microdados/enem)
2. Extraia os `ITENS_PROVA_<ano>.csv`
3. ```bash
   node scripts/mesclar-tri.mjs ITENS_PROVA_2020.csv ITENS_PROVA_2021.csv
   ```

O INEP passou a publicar os parâmetros a partir do ENEM 2020, liberando as
demais edições aos poucos. Cada ano que você mesclar ativa o 3/3/3 real e o
cálculo de nota por TRI para aquelas questões.

Se a taxa de casamento vier muito baixa, confira `COR_CADERNO` no script: cada
cor de caderno embaralha as questões em ordem diferente.

---

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
