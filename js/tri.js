/**
 * tri.js — Teoria de Resposta ao Item (modelo logístico de 3 parâmetros)
 *
 * Usado pelo ENEM/INEP para calcular a proficiência a partir do padrão de
 * respostas, e não apenas do número de acertos.
 *
 * Parâmetros de cada item (vêm dos microdados do INEP):
 *   a — discriminação: o quanto o item separa quem sabe de quem não sabe
 *   b — dificuldade: o nível de habilidade em que o item "vira"
 *   c — acerto casual: probabilidade de acertar chutando
 */

// Constante de escalonamento logístico, padrão do INEP.
const D = 1.7;

// Desvio-padrão do prior N(0, 1) usado na estimativa MAP.
const PRIOR_DP = 1.0;

/**
 * Probabilidade de acerto de um item para uma dada proficiência.
 * P(θ) = c + (1 - c) / (1 + e^(-D·a·(θ - b)))
 *
 * @param {number} theta
 * @param {{a: number, b: number, c: number}} item
 * @returns {number} entre c e 1
 */
export function probabilidadeAcerto(theta, item) {
  const { a, b, c } = item;
  return c + (1 - c) / (1 + Math.exp(-D * a * (theta - b)));
}

/**
 * Informação que um item carrega sobre uma dada proficiência.
 * Itens muito fáceis ou muito difíceis para o candidato informam pouco.
 * Serve para calcular a margem de erro da estimativa.
 */
export function informacaoItem(theta, item) {
  const { a, c } = item;
  const p = probabilidadeAcerto(theta, item);
  if (p <= c || p >= 1) return 0;
  const razao = (p - c) / (1 - c);
  return D * D * a * a * razao * razao * ((1 - p) / p);
}

/**
 * Estima a proficiência (θ) que melhor explica o padrão de respostas.
 *
 * Usa MAP: maximiza a verossimilhança somada a um prior normal padrão.
 * O prior existe por um motivo prático — sem ele, quem acerta todas recebe
 * θ = +infinito e quem erra todas recebe -infinito. Com poucas questões por
 * sessão isso aconteceria toda hora. O prior puxa a estimativa de volta para
 * o centro quando há pouca evidência, e some de cena conforme as respostas
 * se acumulam.
 *
 * @param {Array<{tri: {a,b,c}|null, acertou: boolean}>} respostas
 * @param {{min?: number, max?: number, passo?: number, usarPrior?: boolean}} opcoes
 * @returns {{theta: number, erroPadrao: number, itensUsados: number}|null}
 */
export function estimarTheta(respostas, opcoes = {}) {
  const { min = -4, max = 4, passo = 0.01, usarPrior = true } = opcoes;

  // Itens sem parâmetro publicado não entram na conta.
  const validas = respostas.filter(
    (r) => r.tri && Number.isFinite(r.tri.a) && Number.isFinite(r.tri.b)
  );
  if (validas.length === 0) return null;

  let melhorTheta = 0;
  let melhorLog = -Infinity;

  for (let t = min; t <= max + 1e-9; t += passo) {
    let log = 0;

    for (const r of validas) {
      let p = probabilidadeAcerto(t, r.tri);
      // Evita log(0) quando a probabilidade satura.
      p = Math.min(Math.max(p, 1e-12), 1 - 1e-12);
      log += r.acertou ? Math.log(p) : Math.log(1 - p);
    }

    if (usarPrior) {
      log += -(t * t) / (2 * PRIOR_DP * PRIOR_DP);
    }

    if (log > melhorLog) {
      melhorLog = log;
      melhorTheta = t;
    }
  }

  // Arredonda para o passo, evitando lixo de ponto flutuante.
  melhorTheta = Math.round(melhorTheta / passo) * passo;

  const informacaoTotal = validas.reduce(
    (soma, r) => soma + informacaoItem(melhorTheta, r.tri),
    usarPrior ? 1 / (PRIOR_DP * PRIOR_DP) : 0
  );

  return {
    theta: Number(melhorTheta.toFixed(4)),
    erroPadrao: Number((1 / Math.sqrt(informacaoTotal)).toFixed(4)),
    itensUsados: validas.length,
  };
}

/**
 * Estimativa aproximada, para quando os itens ainda não têm parâmetros do INEP.
 *
 * Não é TRI: é proporção de acertos corrigida pelo chute, mapeada na escala.
 * Ignora o padrão de respostas, que é justamente o que a TRI acrescenta.
 * Serve para o app ter um número desde a primeira sessão, e é marcada como
 * aproximada para que a interface possa dizer isso ao usuário.
 *
 * Calibração: 45% de acerto real ≈ 500 pontos, 70% ≈ 600, 95% ≈ 700.
 */
export function estimarPorAcertos(acertos, total, alternativas = 5) {
  if (!total) return null;
  const chute = 1 / alternativas;
  const proporcao = acertos / total;
  // Desconta o que se espera acertar chutando.
  const real = Math.max(0, (proporcao - chute) / (1 - chute));
  const theta = Math.max(-3, Math.min(3, (real - 0.45) / 0.25));

  return {
    theta: Number(theta.toFixed(4)),
    // Erro alto de propósito: a interface precisa mostrar faixa, não número.
    erroPadrao: Number((0.75 / Math.sqrt(total / 9)).toFixed(4)),
    itensUsados: total,
    aproximada: true,
  };
}

/** Converte proficiência para a escala do ENEM (média 500, desvio 100). */
export function thetaParaNota(theta) {
  return Math.round(500 + 100 * theta);
}

/** Caminho inverso: da nota do ENEM para a proficiência. */
export function notaParaTheta(nota) {
  return (nota - 500) / 100;
}

/**
 * Intervalo de confiança de 95% da nota, na escala do ENEM.
 * Útil para não mostrar "sua nota é 712" com base em 9 questões.
 */
export function faixaDeNota(estimativa) {
  if (!estimativa) return null;
  const margem = 1.96 * estimativa.erroPadrao;
  return {
    nota: thetaParaNota(estimativa.theta),
    minima: thetaParaNota(estimativa.theta - margem),
    maxima: thetaParaNota(estimativa.theta + margem),
    confiavel: estimativa.erroPadrao <= 0.3,
  };
}

/**
 * Classifica um item como fácil, médio ou difícil RELATIVO ao candidato.
 * É isso que alimenta a sessão de 3 fáceis + 3 médias + 3 difíceis.
 */
export function classificarDificuldade(theta, item) {
  const distancia = item.b - theta;
  if (distancia < -0.5) return 'facil';
  if (distancia < 0.5) return 'media';
  return 'dificil';
}

/**
 * Combina a estimativa nova com o histórico do usuário.
 * Média ponderada pela precisão de cada estimativa: a sessão de hoje pesa
 * mais se foi mais informativa, e o histórico segura o tranco quando a
 * sessão foi curta ou atípica.
 */
export function atualizarTheta(anterior, novaEstimativa) {
  if (!novaEstimativa) return anterior;
  if (!anterior) return novaEstimativa;

  const pesoAnterior = 1 / (anterior.erroPadrao ** 2);
  const pesoNovo = 1 / (novaEstimativa.erroPadrao ** 2);
  const soma = pesoAnterior + pesoNovo;

  return {
    theta: Number(
      ((anterior.theta * pesoAnterior + novaEstimativa.theta * pesoNovo) / soma).toFixed(4)
    ),
    erroPadrao: Number((1 / Math.sqrt(soma)).toFixed(4)),
    itensUsados: (anterior.itensUsados || 0) + novaEstimativa.itensUsados,
  };
}
