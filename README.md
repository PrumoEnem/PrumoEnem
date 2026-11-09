# PrumoENEM

Plataforma estática de estudo para o ENEM. O app roda no navegador e não precisa de etapa de build.

[Acessar a plataforma](https://prumoenem.github.io/PrumoEnem/)


## Abrir localmente

Sirva esta pasta por HTTP, por exemplo com `python -m http.server 8000`, e abra `http://localhost:8000`. Módulos JavaScript e o modo offline não funcionam quando a página é aberta diretamente como arquivo.

## Intensivo para o segundo dia do ENEM

No **Painel**, abra **Abrir plano intensivo** e ative o plano. Ele começa na terça-feira mais próxima (no mesmo dia se ativado numa terça), deixa a segunda livre, reserva quatro horas líquidas de terça a sexta e mantém o sábado leve. Os blocos de conteúdo têm links de videoaulas e questões por assunto; os botões do Prumo abrem sessões da área correspondente. As questões da sexta são 20 de Matemática e 20 de Ciências da Natureza, com blocos de correção.

Concluir uma sessão do Prumo registra o dia no progresso do intensivo. O plano funciona sem escolher curso, usando pesos iguais entre as áreas.

## Pomodoro e flashcards

No **Painel**, abra o Pomodoro em uma janela separada. Escolha blocos de 25/5 ou 50/10 minutos; a cada quatro focos completos há uma pausa longa. O ruído marrom é gerado localmente no navegador, inicia desligado e só toca depois que você o ativa.

Em **Revisão → Flashcards**, revise os cartões vencidos com repetição espaçada ou crie cartões próprios. Ao revelar a resposta, avalie a lembrança de 1 a 4 para agendar a próxima revisão.

## Uso offline

Com o site aberto por HTTPS ou localhost, entre em **Perfil → Baixar tudo para uso offline** enquanto estiver conectado. O app guarda os bancos e tenta guardar as imagens das questões também; o painel informa se algumas imagens não puderam ser baixadas.

## Configuração de serviços

- Firebase Auth e Firestore: configure `js/config.js` e publique as regras de `firestore.rules`.
- IA: configure as variáveis e os secrets do Worker em `worker/wrangler.toml` e `js/config.js`.
- Não coloque chaves secretas de provedores no código do navegador.

## Scripts de manutenção

O projeto usa módulos ES nativos. Com Node.js instalado, os scripts locais podem ser executados a partir desta pasta com `npm test`, `npm run test:revisao` e `npm run test:worker`.
