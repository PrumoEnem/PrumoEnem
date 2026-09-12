/** srs.js — revisão espaçada (SM-2 simplificado) para flashcards e vocabulário. */

const DIA = 86400000;
const hoje = () => new Date().toISOString().slice(0, 10);
const emDias = (n) => new Date(Date.now() + n * DIA).toISOString().slice(0, 10);

export function novoCartao(dados) {
  return { ...dados, intervalo: 0, facilidade: 2.5, repeticoes: 0, proximaRevisao: hoje() };
}

/**
 * Atualiza o cartão após a resposta.
 * qualidade: 0 errei · 1 difícil · 2 acertei · 3 fácil
 */
export function revisar(cartao, qualidade) {
  const c = { ...cartao };

  if (qualidade === 0) {
    // Errou: volta para o começo, mas a facilidade cai devagar para não
    // punir demais um deslize isolado.
    c.repeticoes = 0;
    c.intervalo = 0;
    c.facilidade = Math.max(1.3, c.facilidade - 0.2);
    c.proximaRevisao = hoje();
    return c;
  }

  c.repeticoes += 1;
  if (c.repeticoes === 1) c.intervalo = 1;
  else if (c.repeticoes === 2) c.intervalo = 3;
  else c.intervalo = Math.round(c.intervalo * c.facilidade);

  const ajuste = { 1: -0.15, 2: 0, 3: 0.1 }[qualidade] ?? 0;
  c.facilidade = Math.min(2.8, Math.max(1.3, c.facilidade + ajuste));
  if (qualidade === 1) c.intervalo = Math.max(1, Math.round(c.intervalo * 0.6));

  c.proximaRevisao = emDias(c.intervalo);
  return c;
}

export const estaVencido = (cartao) => cartao.proximaRevisao <= hoje();
export const vencidos = (cartoes) => cartoes.filter(estaVencido);

/**
 * Item do vocabulário sai da fila depois de dois acertos seguidos.
 * Foi a regra que a gente definiu: errar não trava a sessão, mas a palavra
 * volta até você acertar de verdade.
 */
export function atualizarVocabulario(item, acertou) {
  const i = { ...item };
  i.acertosSeguidos = acertou ? (i.acertosSeguidos || 0) + 1 : 0;
  i.dominado = i.acertosSeguidos >= 2;
  i.proximaAparicao = i.dominado ? emDias(21) : acertou ? emDias(2) : hoje();
  return i;
}

export function proximoVocabulario(banco, estado = {}) {
  const agora = hoje();
  const pendentes = banco.filter((item) => {
    const e = estado[item.id];
    if (!e) return true;
    if (e.dominado && e.proximaAparicao > agora) return false;
    return (e.proximaAparicao || agora) <= agora;
  });
  const fila = pendentes.length ? pendentes : banco;
  // Prioriza o que já foi errado antes.
  fila.sort((a, b) => (estado[a.id]?.acertosSeguidos ?? 0) - (estado[b.id]?.acertosSeguidos ?? 0));
  const topo = fila.slice(0, Math.min(10, fila.length));
  return topo[Math.floor(Math.random() * topo.length)];
}
