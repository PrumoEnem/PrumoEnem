/**
 * revisao.js — a fila de questões erradas.
 *
 * Regra: errou, a questão volta nas sessões seguintes até você acertar.
 * Acertou, sai da fila.
 *
 * O cuidado que não é óbvio: na segunda vez você lembra da alternativa, não
 * do conteúdo. Por isso a questão volta com as alternativas embaralhadas e
 * reetiquetadas — quem "lembrava que era a C" tem que raciocinar de novo.
 */

const MAX_FILA = 60;

/** Quantas questões de revisão entram em cada sessão. */
export const POR_SESSAO = 2;

export function registrarErro(fila, questao, marcada, explicacao = null) {
  const existente = fila.find((f) => f.id === questao.id);
  if (existente) {
    existente.tentativas += 1;
    existente.ultimoErro = new Date().toISOString().slice(0, 10);
    if (explicacao) existente.explicacao = explicacao;
    return fila;
  }
  return [{
    id: questao.id,
    area: questao.area,
    ano: questao.ano,
    numero: questao.numero,
    // Guarda o começo do enunciado para a lista não precisar carregar o banco.
    trecho: resumirEnunciado(questao.enunciado),
    gabarito: questao.gabarito,
    marcada,
    tentativas: 1,
    ultimoErro: new Date().toISOString().slice(0, 10),
    explicacao,
  }, ...fila].slice(0, MAX_FILA);
}

export const removerAcertada = (fila, questaoId) => fila.filter((f) => f.id !== questaoId);

export const anotarExplicacao = (fila, questaoId, texto) =>
  fila.map((f) => (f.id === questaoId ? { ...f, explicacao: texto } : f));

/** Primeiras frases do enunciado, sem imagens nem markdown. */
export function resumirEnunciado(texto, limite = 180) {
  const limpo = String(texto || '')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (limpo.length <= limite) return limpo;
  return limpo.slice(0, limite).replace(/\s+\S*$/, '') + '…';
}

/**
 * Reembaralha e reetiqueta as alternativas, devolvendo uma cópia da questão.
 * O gabarito acompanha a nova posição.
 */
export function embaralharAlternativas(questao) {
  const letras = ['A', 'B', 'C', 'D', 'E'];
  const originais = questao.alternativas;

  const ordem = originais.map((_, i) => i);
  for (let i = ordem.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ordem[i], ordem[j]] = [ordem[j], ordem[i]];
  }

  let novoGabarito = questao.gabarito;
  const alternativas = ordem.map((indiceOriginal, nova) => {
    const alt = originais[indiceOriginal];
    const letra = letras[nova] || alt.letra;
    if (alt.letra === questao.gabarito) novoGabarito = letra;
    return { ...alt, letra };
  });

  return { ...questao, alternativas, gabarito: novoGabarito, revisao: true };
}

/**
 * Escolhe quais entram na sessão: as mais antigas primeiro, e as que você
 * já errou mais vezes na frente — são as que estão te custando nota.
 */
export function selecionarParaSessao(fila, quantas = POR_SESSAO) {
  return [...fila]
    .sort((a, b) => (b.tentativas - a.tentativas) || (a.ultimoErro < b.ultimoErro ? -1 : 1))
    .slice(0, quantas);
}
