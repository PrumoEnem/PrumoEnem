/**
 * worker.js — intermediário entre o PrumoENEM e a API do Claude.
 *
 * Existe por dois motivos:
 *   1. A chave da API não pode ficar no navegador.
 *   2. Sem validar quem chama, qualquer um que descobrisse a URL gastaria
 *      seus créditos. Por isso todo pedido precisa trazer um token do
 *      Firebase, que é verificado aqui contra as chaves públicas do Google.
 *
 * Publicar:
 *   npx wrangler secret put ANTHROPIC_API_KEY
 *   npx wrangler deploy
 */

const JWK_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

// ------------------------------------------------------------ utilidades

const base64url = (texto) => {
  const normal = texto.replace(/-/g, '+').replace(/_/g, '/');
  const cheio = normal + '='.repeat((4 - (normal.length % 4)) % 4);
  const bruto = atob(cheio);
  const bytes = new Uint8Array(bruto.length);
  for (let i = 0; i < bruto.length; i++) bytes[i] = bruto.charCodeAt(i);
  return bytes;
};

const jsonDeBase64 = (texto) => JSON.parse(new TextDecoder().decode(base64url(texto)));

// As chaves do Google giram de tempos em tempos; guardamos até o vencimento.
let chavesCache = { chaves: null, valeAte: 0 };

async function buscarChaves() {
  const agora = Date.now();
  if (chavesCache.chaves && agora < chavesCache.valeAte) return chavesCache.chaves;

  const resposta = await fetch(JWK_URL);
  if (!resposta.ok) throw new Error('Não consegui buscar as chaves públicas do Google.');
  const { keys } = await resposta.json();

  const cache = resposta.headers.get('cache-control') || '';
  const maxIdade = Number((cache.match(/max-age=(\d+)/) || [])[1] || 3600);

  chavesCache = { chaves: keys, valeAte: agora + maxIdade * 1000 };
  return keys;
}

/**
 * Valida um token do Firebase: assinatura, emissor, destinatário e validade.
 * Devolve os dados do usuário ou lança erro.
 */
export async function validarToken(token, projectId) {
  const partes = token.split('.');
  if (partes.length !== 3) throw new Error('Token malformado.');

  const [cabecalhoB64, corpoB64, assinaturaB64] = partes;
  const cabecalho = jsonDeBase64(cabecalhoB64);
  const corpo = jsonDeBase64(corpoB64);

  if (cabecalho.alg !== 'RS256') throw new Error('Algoritmo inesperado no token.');

  const chaves = await buscarChaves();
  const jwk = chaves.find((k) => k.kid === cabecalho.kid);
  if (!jwk) throw new Error('Chave do token não encontrada.');

  const chave = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const assinado = new TextEncoder().encode(`${cabecalhoB64}.${corpoB64}`);
  const valida = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', chave, base64url(assinaturaB64), assinado
  );
  if (!valida) throw new Error('Assinatura do token inválida.');

  const agora = Math.floor(Date.now() / 1000);
  if (corpo.exp <= agora) throw new Error('Token expirado.');
  if (corpo.aud !== projectId) throw new Error('Token de outro projeto.');
  if (corpo.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('Emissor inesperado.');
  if (!corpo.sub) throw new Error('Token sem usuário.');

  return { uid: corpo.sub, email: corpo.email, verificado: corpo.email_verified === true };
}

// ------------------------------------------------------------ prompts

const SISTEMA_EXPLICAR = `Você corrige questões do ENEM para um estudante brasileiro do ensino médio.

Para cada questão errada, escreva uma explicação de 3 a 5 frases que:
- diga por que a alternativa marcada é atraente mas está errada;
- mostre o caminho até a alternativa correta, em passos;
- nomeie o conceito específico que faltou.

Escreva em português do Brasil, direto, sem elogios e sem enrolação.
Trate o estudante como capaz.

Quando várias questões erradas tiverem a mesma causa raiz, diga isso
explicitamente e proponha UM flashcard do conceito raiz, em vez de vários
flashcards repetitivos.

Sua resposta inteira deve ser um único objeto JSON. Não escreva nada antes
nem depois dele, nem crases, nem a palavra json. Comece com { e termine com }.

Formato exato:
{
  "explicacoes": [
    { "id": "<id da questão>", "texto": "<explicação>", "conceitos": ["<conceito 1>", "<conceito 2>"] }
  ],
  "flashcards": [
    { "conceito": "<igual a um dos conceitos acima>", "frente": "<pergunta>", "verso": "<resposta curta>" }
  ]
}`;

const SISTEMA_RESUMO = `Você escreve resumos de estudo para o ENEM, em português do Brasil.

Regras:
- Comece pelo que cai na prova, não pela história do assunto.
- Máximo de 350 palavras.
- Use exemplos concretos e, quando couber, a fórmula ou definição exata.
- Termine com uma linha "Pegadinha comum:" apontando o erro que o ENEM explora.
- Nada de listas com mais de cinco itens, nada de introdução genérica.

Responda apenas com o texto do resumo, sem título e sem markdown de cabeçalho.`;

// ------------------------------------------------------------ API

/**
 * Três provedores atendidos pela mesma função. O app não sabe qual está
 * ligado: ele só pede explicação ou resumo e recebe texto.
 *
 *   anthropic  — melhor qualidade, pago (uns 2 centavos de dólar por sessão)
 *   gemini     — 1.500 chamadas/dia grátis, sem cartão
 *   cloudflare — roda aqui dentro, sem chave, mas só ~20 chamadas/dia
 */

async function viaAnthropic(env, sistema, mensagem, maxTokens) {
  const resposta = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: (env.MODELO || '').trim() || 'claude-sonnet-5',
      max_tokens: maxTokens,
      system: sistema,
      messages: [{ role: 'user', content: mensagem }],
    }),
  });

  if (!resposta.ok) {
    const detalhe = await resposta.text().catch(() => '');
    if (resposta.status === 401) throw new Error('Chave da Anthropic recusada. Refaça o wrangler secret put.');
    if (resposta.status === 429) throw new Error('Limite de uso atingido. Tente daqui a pouco.');
    if (detalhe.includes('credit')) throw new Error('Créditos da Anthropic esgotados.');
    throw new Error(`A API respondeu ${resposta.status}.`);
  }

  const dados = await resposta.json();
  return dados.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

/**
 * Nomes de modelo do Gemini têm prazo de validade: o Google desliga versões
 * antigas e o app quebra sozinho num dia qualquer. Em vez de fixar um nome,
 * o Worker pergunta à própria chave quais modelos ela pode usar e escolhe.
 * O resultado fica em memória até o isolate reciclar.
 */
let modeloGemini = null;

async function listarModelosGemini(env) {
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
    headers: { 'x-goog-api-key': env.GEMINI_API_KEY },
  });
  if (!r.ok) return [];
  const d = await r.json().catch(() => ({}));
  return (d.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => String(m.name || '').replace(/^models\//, ''))
    .filter(Boolean);
}

/** Prefere o flash estável mais novo: rápido, barato e com cota generosa. */
function escolherModeloGemini(nomes) {
  const versao = (n) => {
    const m = n.match(/(\d+)(?:\.(\d+))?/);
    return m ? Number(m[1]) * 100 + Number(m[2] || 0) : 0;
  };
  const descartar = /(preview|exp|image|tts|live|audio|embedding|vision|learnlm|gemma)/i;

  const flash = nomes.filter((n) => /flash/i.test(n) && !descartar.test(n) && !/lite/i.test(n));
  const lite = nomes.filter((n) => /flash/i.test(n) && !descartar.test(n));
  const qualquer = nomes.filter((n) => !descartar.test(n));

  for (const grupo of [flash, lite, qualquer]) {
    if (grupo.length) return [...grupo].sort((a, b) => versao(b) - versao(a))[0];
  }
  return null;
}

async function pedirAoGemini(env, modelo, sistema, mensagem, maxTokens) {
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: sistema }] },
      contents: [{ role: 'user', parts: [{ text: mensagem }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.3 },
    }),
  });
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Tenta o mesmo modelo algumas vezes antes de desistir.
 *
 * 503 e 500 do Gemini são temporários — o modelo está sobrecarregado, coisa
 * frequente no nível grátis em horário de pico. Devolver esse erro ao
 * estudante seria transformar uma espera de dois segundos numa sessão
 * perdida. As pausas crescem para não piorar a fila.
 */
async function tentarModelo(env, modelo, sistema, mensagem, maxTokens, tentativas = 3) {
  let ultima = null;
  for (let i = 0; i < tentativas; i++) {
    const resposta = await pedirAoGemini(env, modelo, sistema, mensagem, maxTokens);
    if (resposta.ok || (resposta.status !== 503 && resposta.status !== 500)) return resposta;
    ultima = resposta;
    if (i < tentativas - 1) await esperar(700 * (i + 1) + Math.random() * 400);
  }
  return ultima;
}

async function viaGemini(env, sistema, mensagem, maxTokens) {
  if (!env.GEMINI_API_KEY) {
    throw new Error('Falta a chave do Gemini. Rode: npx wrangler secret put GEMINI_API_KEY');
  }

  const configurado = (env.MODELO || '').trim();
  let modelo = configurado || modeloGemini || 'gemini-2.5-flash';
  let resposta = await tentarModelo(env, modelo, sistema, mensagem, maxTokens);

  // 404: esse nome não existe mais para esta chave. Descobre e tenta de novo.
  if (resposta.status === 404 && !configurado) {
    const disponiveis = await listarModelosGemini(env);
    const escolhido = escolherModeloGemini(disponiveis);
    if (!escolhido) {
      throw new Error(
        disponiveis.length
          ? `Nenhum modelo compatível. Sua chave tem: ${disponiveis.slice(0, 8).join(', ')}`
          : 'Sua chave não listou nenhum modelo. Confira se ela é do Google AI Studio e está ativa.'
      );
    }
    modeloGemini = escolhido;
    modelo = escolhido;
    resposta = await tentarModelo(env, modelo, sistema, mensagem, maxTokens);
  }

  // Ainda sobrecarregado depois das tentativas: troca de modelo.
  // Um flash mais antigo costuma estar livre quando o novo está em fila.
  if ((resposta.status === 503 || resposta.status === 500) && !configurado) {
    const disponiveis = await listarModelosGemini(env);
    const alternativa = escolherModeloGemini(disponiveis.filter((n) => n !== modelo));
    if (alternativa) {
      const segunda = await tentarModelo(env, alternativa, sistema, mensagem, maxTokens, 2);
      if (segunda.ok) { modeloGemini = alternativa; resposta = segunda; }
    }
  }

  if (!resposta.ok) {
    const detalhe = await resposta.text().catch(() => '');
    if (resposta.status === 400 && detalhe.includes('API key')) {
      throw new Error('Chave do Gemini recusada. Refaça o wrangler secret put.');
    }
    if (resposta.status === 429) {
      throw new Error('Você atingiu o limite de chamadas por minuto do Gemini. Espere um minuto e tente de novo.');
    }
    if (resposta.status === 503 || resposta.status === 500) {
      throw new Error('O Gemini está sobrecarregado agora. Isso passa em alguns minutos — tente de novo.');
    }
    if (resposta.status === 404) {
      const disponiveis = await listarModelosGemini(env);
      throw new Error(
        `O modelo "${modelo}" não existe para sua chave. Disponíveis: ${disponiveis.slice(0, 8).join(', ') || 'nenhum'}`
      );
    }
    throw new Error(`O Gemini respondeu ${resposta.status}.`);
  }

  const dados = await resposta.json();
  const texto = dados.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join('\n');
  if (!texto) {
    const motivo = dados.candidates?.[0]?.finishReason;
    throw new Error(motivo === 'MAX_TOKENS'
      ? 'A resposta foi cortada por tamanho. Tente um tema mais específico.'
      : 'O Gemini devolveu resposta vazia.');
  }
  return texto;
}

async function viaCloudflare(env, sistema, mensagem, maxTokens) {
  if (!env.AI) throw new Error('Binding de IA não configurado no wrangler.toml.');
  const modelo = (env.MODELO || '').trim() || '@cf/meta/llama-3.1-8b-instruct';

  try {
    const saida = await env.AI.run(modelo, {
      messages: [
        { role: 'system', content: sistema },
        { role: 'user', content: mensagem },
      ],
      max_tokens: maxTokens,
    });
    const texto = saida?.response || saida?.result?.response;
    if (!texto) throw new Error('Resposta vazia.');
    return texto;
  } catch (e) {
    // 3036 é a cota diária; 3040 é falta de GPU no instante e vale repetir.
    const msg = String(e.message || e);
    if (msg.includes('3036')) throw new Error('Cota diária grátis do Cloudflare esgotada. Ela volta amanhã.');
    if (msg.includes('3040')) throw new Error('Sem GPU disponível agora. Tente de novo em alguns segundos.');
    throw new Error(`Workers AI: ${msg}`);
  }
}

async function chamarIA(env, sistema, mensagem, maxTokens) {
  const provedor = (env.PROVEDOR || 'anthropic').toLowerCase();
  if (provedor === 'gemini') return viaGemini(env, sistema, mensagem, maxTokens);
  if (provedor === 'cloudflare') return viaCloudflare(env, sistema, mensagem, maxTokens);
  return viaAnthropic(env, sistema, mensagem, maxTokens);
}

// ------------------------------------------------------------ HTTP

/**
 * O navegador manda a origem sempre em minúsculas e sem barra no fim.
 * Comparar string crua daria 403 só porque alguém escreveu o domínio com
 * maiúscula no wrangler.toml — erro invisível e chato de achar.
 */
const normalizar = (o) => (o || '').trim().toLowerCase().replace(/\/+$/, '');

function listaDeOrigens(env) {
  return (env.ORIGENS || '').split(',').map(normalizar).filter(Boolean);
}

function cabecalhosCors(origem, env) {
  /*
   * Devolve a origem que veio, mesmo quando ela não está autorizada.
   *
   * A versão anterior mandava a primeira origem da lista no caso de recusa.
   * O navegador então bloqueava a resposta e mostrava só "Failed to fetch",
   * escondendo o 403 e a mensagem explicando o motivo. Recusar continua
   * sendo pelo status e pelo corpo; o cabeçalho aqui só permite que o
   * usuário consiga LER a recusa em vez de ver um erro de rede genérico.
   */
  return {
    'Access-Control-Allow-Origin': origem || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (dados, status, cors) =>
  new Response(JSON.stringify(dados), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });

export default {
  async fetch(requisicao, env) {
    const origem = requisicao.headers.get('Origin') || '';
    const cors = cabecalhosCors(origem, env);

    if (requisicao.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (requisicao.method !== 'POST') return json({ erro: 'Use POST.' }, 405, cors);

    const permitidas = listaDeOrigens(env);
    if (permitidas.length && origem && !permitidas.includes(normalizar(origem))) {
      return json({ erro: 'Origem não autorizada.' }, 403, cors);
    }

    // ---- quem está chamando ----
    const cabecalho = requisicao.headers.get('Authorization') || '';
    const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7) : '';
    if (!token) return json({ erro: 'Entre na sua conta para usar a IA.' }, 401, cors);

    let usuario;
    try {
      usuario = await validarToken(token, env.FIREBASE_PROJECT_ID);
    } catch (e) {
      return json({ erro: `Sessão inválida: ${e.message}` }, 401, cors);
    }

    if (env.DOMINIO_PERMITIDO) {
      const email = (usuario.email || '').toLowerCase();
      if (!usuario.verificado || !email.endsWith('@' + env.DOMINIO_PERMITIDO.toLowerCase())) {
        return json({ erro: 'Sua conta não tem acesso à IA.' }, 403, cors);
      }
    }

    // ---- rotas ----
    const caminho = new URL(requisicao.url).pathname;

    try {
      if (caminho.endsWith('/explicar')) {
        const { questoes, area } = await requisicao.json();
        if (!Array.isArray(questoes) || !questoes.length) {
          return json({ erro: 'Nenhuma questão enviada.' }, 400, cors);
        }
        if (questoes.length > 12) return json({ erro: 'Máximo de 12 questões por chamada.' }, 400, cors);

        const mensagem = `Área: ${area}\n\n` + questoes.map((q) => `
### Questão ${q.id} (ENEM ${q.ano})
${q.enunciado}

${(q.alternativas || []).join('\n')}

Gabarito: ${q.gabarito}
O estudante marcou: ${q.marcada || 'nenhuma (acabou o tempo)'}`).join('\n\n');

        const texto = await chamarIA(env, SISTEMA_EXPLICAR, mensagem, 3000);
        const limpo = texto.replace(/```json|```/g, '').trim();
        try {
          return json(JSON.parse(limpo), 200, cors);
        } catch {
          return json({ explicacoes: [], flashcards: [], aviso: 'A IA respondeu num formato inesperado.' }, 200, cors);
        }
      }

      if (caminho.endsWith('/resumo')) {
        const { tema, area } = await requisicao.json();
        if (!tema || String(tema).trim().length < 3) {
          return json({ erro: 'Escreva o tema que você quer revisar.' }, 400, cors);
        }
        const resumo = await chamarIA(
          env, SISTEMA_RESUMO,
          `Área: ${area || 'não informada'}\nTema: ${String(tema).slice(0, 200)}`,
          1200
        );
        return json({ resumo }, 200, cors);
      }

      return json({ erro: 'Rota desconhecida.' }, 404, cors);
    } catch (e) {
      return json({ erro: e.message }, 502, cors);
    }
  },
};
