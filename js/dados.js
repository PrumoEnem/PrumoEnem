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

export const carregarQuestoes = (area) => carregarJSON(`dados/questoes-${area}.json`);
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
