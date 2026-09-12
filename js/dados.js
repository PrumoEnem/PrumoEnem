/** dados.js — carrega questões, cursos e vocabulário, com cache em memória. */

const cache = new Map();
export const AREAS = ['matematica', 'natureza', 'humanas', 'linguagens'];

export const NOME_AREA = {
  matematica: 'Matemática',
  natureza: 'Ciências da Natureza',
  humanas: 'Ciências Humanas',
  linguagens: 'Linguagens',
  redacao: 'Redação',
};

async function carregarJSON(caminho) {
  if (cache.has(caminho)) return cache.get(caminho);
  const resposta = await fetch(caminho);
  if (!resposta.ok) throw new Error(`Não consegui carregar ${caminho}`);
  const dados = await resposta.json();
  cache.set(caminho, dados);
  return dados;
}

/**
 * Uma questão só entra na sessão se estiver íntegra. O dataset de origem tem
 * alguns registros com alternativa sem texto nem imagem — se caírem numa
 * prova, a pessoa vê uma opção em branco e não tem como escolher.
 */
/**
 * Questão que dá para responder. Fonte única da verdade — o motor importa
 * daqui em vez de ter o próprio critério, senão os dois discordam e uma
 * questão barrada num lugar passa no outro.
 *
 * O dataset do enem.dev tem casos em que o texto de apoio não veio junto,
 * sobrando só o comando solto, e alternativas sem texto nem imagem.
 */
export function questaoUtilizavel(q) {
  if (!q || !q.enunciado || !q.enunciado.trim()) return false;
  if (!Array.isArray(q.alternativas) || q.alternativas.length < 4) return false;
  if (!q.alternativas.some((a) => a.letra === q.gabarito)) return false;
  if (!q.alternativas.every((a) => (a.texto && a.texto.trim()) || a.imagem)) return false;

  // Enunciado curto e sem imagem: o texto de apoio não veio no dataset.
  const semImagens = q.enunciado.replace(/!\[[^\]]*\]\([^)]+\)/g, '').trim();
  const temImagem = (q.imagens && q.imagens.length) || q.enunciado.includes('![');
  return semImagens.length >= 90 || temImagem;
}

export async function carregarQuestoes(area) {
  const todas = await carregarJSON(`dados/questoes-${area}.json`);
  const chave = `filtrado:${area}`;
  if (!cache.has(chave)) {
    const boas = todas.filter(questaoUtilizavel);
    const descartadas = todas.length - boas.length;
    if (descartadas) console.info(`${area}: ${descartadas} questão(ões) incompleta(s) descartada(s).`);
    cache.set(chave, boas);
  }
  return cache.get(chave);
}
export const carregarCursos = () => carregarJSON('dados/cursos.json');
export const carregarVocabulario = () => carregarJSON('dados/vocabulario.json');
export const carregarIndice = () => carregarJSON('dados/indice.json');

/** Baixa e guarda no cache do service worker todas as áreas de uma vez. */
export async function prepararOffline(aoProgredir) {
  for (let i = 0; i < AREAS.length; i++) {
    await carregarQuestoes(AREAS[i]);
    aoProgredir?.((i + 1) / AREAS.length);
  }
  await carregarVocabulario();
}
