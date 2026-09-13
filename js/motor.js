/** motor.js — decide o que estudar e quais questões cair na sessão. */

import { classificarDificuldade } from './tri.js';
import { AREAS, questaoUtilizavel } from './dados.js';

/** Proficiência que serve de alvo. θ = 2 equivale a 700 na escala do ENEM. */
export const THETA_ALVO = 2.0;

/**
 * Prioridade de cada área: peso do curso × o quanto falta para o alvo.
 *
 * Peso alto onde você já vai bem rende pouco esforço adicional; peso alto
 * onde você está longe é onde cada hora de estudo vale mais nota final.
 *
 * @param {Object} pesos     ex.: { matematica: 4, natureza: 2, ... }
 * @param {Object} thetas    ex.: { matematica: {theta: 0.4}, ... }
 * @returns {Array<{area, peso, theta, lacuna, prioridade, percentual}>}
 */
export function calcularPrioridades(pesos, thetas = {}) {
  const linhas = AREAS.map((area) => {
    const theta = thetas[area]?.theta ?? 0;
    const peso = pesos[area] ?? 1;
    // Lacuna mínima de 0.1 para que nenhuma área zere e suma do cronograma.
    const lacuna = Math.max(THETA_ALVO - theta, 0.1);
    return { area, peso, theta, lacuna, prioridade: peso * lacuna };
  });

  const soma = linhas.reduce((s, l) => s + l.prioridade, 0);
  return linhas
    .map((l) => ({ ...l, percentual: Math.round((l.prioridade / soma) * 100) }))
    .sort((a, b) => b.prioridade - a.prioridade);
}

/**
 * Escolhe a área da próxima sessão por sorteio ponderado pela prioridade.
 * Ponderado em vez de sempre a primeira: senão você passaria três meses
 * fazendo só matemática e as outras áreas apodreceriam.
 */
export function escolherArea(prioridades) {
  const total = prioridades.reduce((s, p) => s + p.prioridade, 0);
  let sorteio = Math.random() * total;
  for (const p of prioridades) {
    sorteio -= p.prioridade;
    if (sorteio <= 0) return p.area;
  }
  return prioridades[0].area;
}

const embaralhar = (lista) => {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
};

/**
 * Monta a sessão: 3 fáceis, 3 médias, 3 difíceis — relativo ao seu θ,
 * não a uma escala fixa.
 *
 * Se as questões ainda não tiverem parâmetros do INEP, cai para sorteio
 * simples e avisa, em vez de fingir uma calibração que não existe.
 *
 * @returns {{questoes: Array, calibrada: boolean}}
 */
export function montarSessao(questoes, theta = 0, idsJaVistos = [], porFaixa = 3) {
  const vistos = new Set(idsJaVistos);
  const utilizaveis = questoes.filter(questaoUtilizavel);
  let disponiveis = utilizaveis.filter((q) => !vistos.has(q.id));

  // Se já viu quase tudo da área, libera o banco inteiro de novo.
  if (disponiveis.length < porFaixa * 3) disponiveis = utilizaveis;

  const comTri = disponiveis.filter((q) => q.tri && Number.isFinite(q.tri.b));

  if (comTri.length < porFaixa * 3) {
    return { questoes: embaralhar(disponiveis).slice(0, porFaixa * 3), calibrada: false };
  }

  /*
   * Faixas por posição relativa, não por distância fixa do θ.
   *
   * A primeira versão usava limites absolutos (b < θ-0.5 é fácil, etc.).
   * Com os parâmetros reais do INEP isso quebra: o b mediano das questões
   * calibradas é 1.16 e o mínimo é -1.42, então para quem começa em θ=0
   * a faixa "fácil" fica vazia e a sessão vira nove questões difíceis.
   *
   * Ordenando por distância até o θ e cortando em terços, as três faixas
   * sempre existem, e continuam se movendo junto com a proficiência:
   * o que era difícil hoje vira médio quando você melhora.
   */
  const ordenadas = [...comTri].sort((x, y) => x.tri.b - y.tri.b);
  const n = ordenadas.length;

  // Onde o candidato cai dentro dessa lista.
  let corte = ordenadas.findIndex((q) => q.tri.b >= theta);
  if (corte < 0) corte = n;

  // Janelas proporcionais ao banco, não a um número fixo de itens: assim as
  // três faixas ficam realmente separadas em qualquer área e em qualquer θ.
  const fatia = (de, ate) => ordenadas.slice(
    Math.max(0, Math.min(n - 1, Math.round(corte + de * n))),
    Math.max(1, Math.min(n, Math.round(corte + ate * n)))
  );

  const fonteFacil = fatia(-0.40, -0.12);
  const fonteMedia = fatia(-0.07, 0.07);
  const fonteDificil = fatia(0.12, 0.40);

  const escolhidas = [];
  const usados = new Set();
  const pegar = (fonte, quantos) => {
    for (const q of embaralhar(fonte)) {
      if (escolhidas.length >= porFaixa * 3) return;
      if (usados.has(q.id)) continue;
      usados.add(q.id);
      escolhidas.push(q);
      if (--quantos <= 0) return;
    }
  };

  pegar(fonteFacil, porFaixa);
  pegar(fonteMedia, porFaixa);
  pegar(fonteDificil, porFaixa);
  // Se alguma fonte não teve itens novos suficientes, completa do resto.
  pegar(ordenadas, porFaixa * 3 - escolhidas.length);

  // Apresenta na ordem crescente de dificuldade: aquece antes de apertar.
  escolhidas.sort((x, y) => x.tri.b - y.tri.b);

  return { questoes: escolhidas, calibrada: true };
}

/**
 * Nota final simulada no SiSU: média ponderada pelos pesos do curso.
 * A nota de redação é informada pelo usuário, já que não temos como medi-la.
 */
export function simularNotaSisu(pesos, thetas, notaRedacao = null) {
  let somaPesos = 0;
  let somaNotas = 0;
  const detalhe = [];

  for (const area of AREAS) {
    const theta = thetas[area]?.theta;
    if (theta === undefined || theta === null) continue;
    const nota = 500 + 100 * theta;
    const peso = pesos[area] ?? 1;
    somaNotas += nota * peso;
    somaPesos += peso;
    detalhe.push({ area, nota: Math.round(nota), peso });
  }

  if (notaRedacao !== null && pesos.redacao) {
    somaNotas += notaRedacao * pesos.redacao;
    somaPesos += pesos.redacao;
    detalhe.push({ area: 'redacao', nota: notaRedacao, peso: pesos.redacao });
  }

  if (!somaPesos) return null;

  return {
    media: Math.round((somaNotas / somaPesos) * 100) / 100,
    detalhe,
    completa: detalhe.length === AREAS.length + (pesos.redacao ? 1 : 0),
  };
}
