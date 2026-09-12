/**
 * ia.js — fala com o Cloudflare Worker, nunca direto com a Anthropic.
 *
 * Uma chamada por sessão, com todos os erros juntos: além de ser mais
 * rápido e mais barato, o modelo enxerga o padrão dos erros e consegue
 * gerar um flashcard do conceito raiz em vez de um por questão.
 */

import { URL_WORKER } from './config.js';
import { tokenAtual, nuvemAtiva } from './nuvem.js';

export const iaDisponivel = () => !!URL_WORKER;

/** A IA exige conta: é ela que impede um estranho de gastar seus créditos. */
export const iaPrecisaLogin = () => !!URL_WORKER && !nuvemAtiva();

async function pedir(rota, corpo) {
  const token = await tokenAtual();
  if (!token) {
    const erro = new Error('Entre na sua conta para usar a IA.');
    erro.precisaLogin = true;
    throw erro;
  }

  const resposta = await fetch(`${URL_WORKER}${rota}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(corpo),
  });

  let dados = null;
  try { dados = await resposta.json(); } catch { /* resposta sem corpo */ }

  if (!resposta.ok) {
    throw new Error(dados?.erro || `O servidor da IA respondeu ${resposta.status}.`);
  }
  return dados;
}

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

  return pedir('/explicar', payload);
}

export async function gerarResumo(tema, area) {
  if (!iaDisponivel()) return null;
  const dados = await pedir('/resumo', { tema, area });
  return dados.resumo;
}
