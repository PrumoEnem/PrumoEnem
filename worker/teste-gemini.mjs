import { webcrypto } from 'crypto';

let falhas = 0;
const ok = (n, c, d = '') => {
  if (!c) falhas++;
  console.log((c ? 'OK   ' : 'FALHA') + ' ' + n + (d ? ' — ' + d : ''));
};

// Reimplementa a escolha exatamente como está no worker, para testar a regra.
const src = await import('fs').then((fs) => fs.readFileSync('worker.js', 'utf8'));
const corpo = src.slice(src.indexOf('function escolherModeloGemini'), src.indexOf('async function pedirAoGemini'));
const escolher = new Function(`${corpo}; return escolherModeloGemini;`)();

console.log('=== escolha do modelo ===');
ok('prefere flash estável mais novo',
  escolher(['gemini-2.5-flash', 'gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-pro']) === 'gemini-3.8-flash',
  escolher(['gemini-2.5-flash', 'gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-pro']));

ok('ignora preview e experimental',
  escolher(['gemini-4.0-flash-preview', 'gemini-3.8-flash']) === 'gemini-3.8-flash',
  escolher(['gemini-4.0-flash-preview', 'gemini-3.8-flash']));

ok('ignora imagem, tts e embedding',
  escolher(['gemini-9.0-flash-image', 'text-embedding-004', 'gemini-2.5-flash']) === 'gemini-2.5-flash',
  escolher(['gemini-9.0-flash-image', 'text-embedding-004', 'gemini-2.5-flash']));

ok('cai para lite se só houver lite',
  escolher(['gemini-3.1-flash-lite']) === 'gemini-3.1-flash-lite');

ok('cai para pro se não houver flash',
  escolher(['gemini-3.0-pro']) === 'gemini-3.0-pro',
  escolher(['gemini-3.0-pro']));

ok('devolve null com lista vazia', escolher([]) === null);
ok('devolve null se só houver modelos descartados', escolher(['text-embedding-004', 'imagen-3']) === null,
  String(escolher(['text-embedding-004', 'imagen-3'])));

console.log('\n=== descoberta ao tomar 404 ===');
const chamadas = [];
globalThis.fetch = async (url, opcoes) => {
  const u = String(url);
  chamadas.push(u);
  if (u.endsWith('/v1beta/models')) {
    return {
      ok: true,
      json: async () => ({
        models: [
          { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
        ],
      }),
    };
  }
  if (u.includes('gemini-2.5-flash:generateContent')) {
    return { status: 404, ok: false, text: async () => 'not found' };
  }
  return {
    ok: true, status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: 'resumo gerado' }] } }] }),
  };
};

const mod = await import('./worker.js');
// viaGemini não é exportada; exercita pelo handler completo seria pesado,
// então recria a função a partir do fonte com o mesmo escopo de dependências.
const trecho = src.slice(src.indexOf('let modeloGemini = null;'), src.indexOf('async function viaCloudflare'));
const viaGemini = new Function(`${trecho}; return viaGemini;`)();

const env = { GEMINI_API_KEY: 'chave', MODELO: '' };
const texto = await viaGemini(env, 'sistema', 'mensagem', 500);
ok('recupera do 404 e responde', texto === 'resumo gerado', texto);
ok('consultou a lista de modelos', chamadas.some((c) => c.endsWith('/v1beta/models')));
ok('repetiu com o modelo descoberto', chamadas.some((c) => c.includes('gemini-3.8-flash:generateContent')));

chamadas.length = 0;
await viaGemini(env, 'sistema', 'mensagem', 500);
ok('lembra do modelo e não lista de novo', !chamadas.some((c) => c.endsWith('/v1beta/models')));

console.log('\n=== erros úteis ===');
try {
  await viaGemini({ MODELO: '' }, 's', 'm', 100);
  ok('avisa quando falta a chave', false, 'não lançou');
} catch (e) { ok('avisa quando falta a chave', /secret put/.test(e.message), e.message); }

console.log('\n=== sobrecarga (503) ===');

function montarViaGemini() {
  const t = src.slice(src.indexOf('let modeloGemini = null;'), src.indexOf('async function viaCloudflare'));
  return new Function(`${t}; return viaGemini;`)();
}

// Falha duas vezes com 503, acerta na terceira.
let vezes = 0;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.endsWith('/v1beta/models')) {
    return { ok: true, json: async () => ({ models: [
      { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
    ] }) };
  }
  if (++vezes <= 2) return { status: 503, ok: false, text: async () => 'overloaded' };
  return { ok: true, status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: 'saiu na terceira' }] } }] }) };
};
const inicio = Date.now();
const r1 = await montarViaGemini()({ GEMINI_API_KEY: 'k', MODELO: '' }, 's', 'm', 500);
ok('insiste e vence a sobrecarga', r1 === 'saiu na terceira', `${vezes} tentativas`);
ok('esperou entre as tentativas', Date.now() - inicio >= 1400, `${Date.now() - inicio}ms`);

// Sempre 503: precisa falhar com mensagem clara, não com o código cru.
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.endsWith('/v1beta/models')) {
    return { ok: true, json: async () => ({ models: [
      { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
    ] }) };
  }
  return { status: 503, ok: false, text: async () => 'overloaded' };
};
try {
  await montarViaGemini()({ GEMINI_API_KEY: 'k', MODELO: '' }, 's', 'm', 500);
  ok('mensagem clara na sobrecarga persistente', false, 'não lançou');
} catch (e) {
  ok('mensagem clara na sobrecarga persistente', /sobrecarregado/.test(e.message), e.message);
}

// 429 é limite por minuto, não sobrecarga: mensagem diferente.
globalThis.fetch = async () => ({ status: 429, ok: false, text: async () => 'quota' });
try {
  await montarViaGemini()({ GEMINI_API_KEY: 'k', MODELO: 'fixo' }, 's', 'm', 500);
  ok('429 tem mensagem própria', false, 'não lançou');
} catch (e) {
  ok('429 tem mensagem própria', /por minuto/.test(e.message), e.message);
}

console.log(falhas ? `\n${falhas} falha(s)` : '\nTodos passaram.');
process.exit(falhas ? 1 : 0);
