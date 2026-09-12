/**
 * ia.js — fala com o Cloudflare Worker, nunca direto com a Anthropic.
 *
 * Uma chamada por sessão, com todos os erros juntos: além de ser mais
 * rápido e mais barato, o modelo enxerga o padrão dos erros e consegue
 * gerar um flashcard do conceito raiz em vez de um por questão.
 */

import { URL_WORKER } from './config.js';

export const iaDisponivel = () => !!URL_WORKER;

const SEM_CHAVE = {
  explicacoes: [],
  flashcards: [],
  aviso: 'A IA está desligada. Preencha URL_WORKER em js/config.js para ativar.',
};

export async function explicarErros(erros, area) {
  if (!iaDisponivel()) return SEM_CHAVE;
  if (!erros.length) return { explicacoes: [], flashcards: [] };

  const payload = {
    area,
    questoes: erros.map((e) => ({
      id: e.questao.id,
      ano: e.questao.ano,
      enunciado: e.questao.enunciado.slice(0, 2200),
      alternativas: e.questao.alternativas.map((a) => `${a.letra}) ${a.texto}`.slice(0, 300)),
      gabarito: e.questao.gabarito,
      marcada: e.marcada,
    })),
  };

  const resposta = await fetch(`${URL_WORKER}/explicar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!resposta.ok) {
    throw new Error(`O servidor da IA respondeu ${resposta.status}. Tente de novo mais tarde.`);
  }
  return resposta.json();
}

export async function gerarResumo(tema, area) {
  if (!iaDisponivel()) return null;
  const resposta = await fetch(`${URL_WORKER}/resumo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tema, area }),
  });
  if (!resposta.ok) throw new Error(`O servidor da IA respondeu ${resposta.status}.`);
  const dados = await resposta.json();
  return dados.resumo;
}
