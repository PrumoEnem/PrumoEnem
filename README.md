# PrumoENEM

Plataforma estática de estudo para o ENEM. O app roda no navegador e não precisa de etapa de build.

## Abrir localmente

Sirva esta pasta por HTTP, por exemplo com `python -m http.server 8000`, e abra `http://localhost:8000`. Módulos JavaScript e o modo offline não funcionam quando a página é aberta diretamente como arquivo.

## Modo intensivo de 10 dias

No **Painel**, abra **Abrir plano intensivo** e ative o sprint. O cronograma começa na data local de ativação e se adapta às prioridades do curso. Ele alterna sessões de 20 e 45 questões, reserva dias para redação e revisão de erros e termina com uma sessão leve. Concluir uma sessão marca a etapa do dia.

O plano usa 10 dias a partir da ativação; não presume uma data fixa para a prova. Também funciona sem escolher curso, usando pesos iguais entre as áreas.

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
