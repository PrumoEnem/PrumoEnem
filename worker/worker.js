/**
 * worker.js — Cloudflare Worker.
 *
 * Existe por um motivo só: a chave da API não pode ficar no navegador.
 * Publique com `npx wrangler deploy` e guarde a chave com
 * `npx wrangler secret put ANTHROPIC_API_KEY`.
 */

const MODELO = 'claude-sonnet-4-6';

const SISTEMA_EXPLICAR = `Você corrige questões do ENEM para um estudante brasileiro do ensino médio.

Para cada questão errada, escreva uma explicação de 3 a 5 frases que:
- diga por que a alternativa que ele marcou é atraente mas está errada;
- mostre o caminho até a alternativa correta, em passos;
- nomeie o conceito específico que faltou.

Escreva em português do Brasil, direto, sem elogios e sem enrolação.
Trate o estudante como capaz.

Quando várias questões erradas tiverem a mesma causa raiz, diga isso
explicitamente e proponha UM flashcard do conceito raiz, em vez de vários
flashcards repetitivos.

Responda SOMENTE com JSON válido, sem crases e sem texto fora dele:
{
  "explicacoes": [
    { "id": "<id da questão>", "texto": "<explicação>", "conceitos": ["<conceito 1>", "<conceito 2>"] }
  ],
  "flashcards": [
    { "conceito": "<igual a um dos conceitos acima>", "frente": "<pergunta>", "verso": "<resposta curta>" }
  ]
}`;

const SISTEMA_RESUMO = `Você escreve resumos de estudo para o ENEM, em português do Brasil.
Máximo de 400 palavras. Comece pelo que cai na prova, não pela história do assunto.
Use exemplos concretos. Não use listas com mais de 5 itens.
Responda apenas com o texto do resumo.`;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (dados, status = 200) =>
  new Response(JSON.stringify(dados), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

async function chamarClaude(env, sistema, mensagem, maxTokens) {
  const resposta = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODELO,
      max_tokens: maxTokens,
      system: sistema,
      messages: [{ role: 'user', content: mensagem }],
    }),
  });

  if (!resposta.ok) {
    throw new Error(`A API respondeu ${resposta.status}`);
  }
  const dados = await resposta.json();
  return dados.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

export default {
  async fetch(requisicao, env) {
    if (requisicao.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (requisicao.method !== 'POST') return json({ erro: 'Use POST.' }, 405);

    const caminho = new URL(requisicao.url).pathname;

    try {
      if (caminho.endsWith('/explicar')) {
        const { questoes, area } = await requisicao.json();
        if (!Array.isArray(questoes) || !questoes.length) return json({ erro: 'Nenhuma questão enviada.' }, 400);
        if (questoes.length > 12) return json({ erro: 'Máximo de 12 questões por chamada.' }, 400);

        const mensagem = `Área: ${area}\n\n` + questoes.map((q) => `
### Questão ${q.id} (ENEM ${q.ano})
${q.enunciado}

${q.alternativas.join('\n')}

Gabarito: ${q.gabarito}
O estudante marcou: ${q.marcada || 'nenhuma (acabou o tempo)'}`).join('\n\n');

        const texto = await chamarClaude(env, SISTEMA_EXPLICAR, mensagem, 3000);
        const limpo = texto.replace(/```json|```/g, '').trim();

        try {
          return json(JSON.parse(limpo));
        } catch {
          return json({ explicacoes: [], flashcards: [], aviso: 'A IA respondeu num formato inesperado.' });
        }
      }

      if (caminho.endsWith('/resumo')) {
        const { tema, area } = await requisicao.json();
        if (!tema) return json({ erro: 'Informe o tema.' }, 400);
        const resumo = await chamarClaude(env, SISTEMA_RESUMO, `Área: ${area}\nTema: ${tema}`, 1200);
        return json({ resumo });
      }

      return json({ erro: 'Rota desconhecida.' }, 404);
    } catch (e) {
      return json({ erro: e.message }, 502);
    }
  },
};
