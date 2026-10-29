/** dados.js — carrega questões, cursos e vocabulário, com cache em memória. */

const cache = new Map();
export const AREAS = ['matematica', 'natureza', 'humanas', 'linguagens'];

// Correções aplicadas ao banco distribuído. Mantidas para migrar filas e
// questões vistas de versões anteriores que ainda guardam a área antiga.
export const CORRECOES_AREA = {
  '2015-95': { de: 'humanas', para: 'linguagens', idCorrigido: '2015-95-alternativa' },
  '2020-5': { de: 'humanas', para: 'linguagens', idCorrigido: '2020-5-alternativa' },
  '2020-20': { de: 'humanas', para: 'linguagens' },
  '2020-102': { de: 'humanas', para: 'natureza' },
  '2020-124': { de: 'humanas', para: 'natureza' },
  '2021-9': { de: 'humanas', para: 'linguagens' },
  '2021-28': { de: 'humanas', para: 'linguagens' },
  '2021-37': { de: 'humanas', para: 'linguagens' },
  '2021-38': { de: 'humanas', para: 'linguagens' },
  '2021-44': { de: 'humanas', para: 'linguagens' },
  '2021-100': { de: 'humanas', para: 'natureza' },
  '2021-106': { de: 'humanas', para: 'natureza' },
  '2021-120': { de: 'humanas', para: 'natureza' },
  '2021-138': { de: 'humanas', para: 'matematica' },
  '2021-140': { de: 'humanas', para: 'matematica' },
  '2021-149': { de: 'humanas', para: 'matematica' },
  '2022-7': { de: 'humanas', para: 'linguagens' },
  '2022-24': { de: 'humanas', para: 'linguagens' },
  '2022-92': { de: 'humanas', para: 'natureza' },
  '2022-108': { de: 'humanas', para: 'natureza' },
  '2022-144': { de: 'humanas', para: 'matematica' },
  '2023-30': { de: 'humanas', para: 'linguagens' },
  '2023-93': { de: 'humanas', para: 'natureza' },
  '2023-94': { de: 'humanas', para: 'natureza' },
  '2023-96': { de: 'humanas', para: 'natureza' },
  '2023-97': { de: 'humanas', para: 'natureza' },
  '2023-98': { de: 'humanas', para: 'natureza' },
  '2023-109': { de: 'humanas', para: 'natureza' },
  '2023-148': { de: 'humanas', para: 'matematica' },
  '2023-149': { de: 'humanas', para: 'matematica' },
  '2023-153': { de: 'humanas', para: 'matematica' },
  '2023-154': { de: 'humanas', para: 'matematica' },
  '2023-81': { de: 'linguagens', para: 'humanas' },
  '2021-94': { de: 'matematica', para: 'natureza' },
  '2023-128': { de: 'matematica', para: 'natureza' },
  '2023-129': { de: 'matematica', para: 'natureza' },
  '2023-130': { de: 'matematica', para: 'natureza' },
  '2023-131': { de: 'matematica', para: 'natureza' },
};

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

/** Baixa bancos e imagens para que as questões também funcionem offline. */
export async function prepararOffline(aoProgredir) {
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    await Promise.race([
      navigator.serviceWorker.ready.catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  }

  const bancos = [];
  for (let i = 0; i < AREAS.length; i++) {
    bancos.push(await carregarQuestoes(AREAS[i]));
    aoProgredir?.(0.15 * ((i + 1) / AREAS.length));
  }
  await carregarVocabulario();

  const imagens = new Set();
  const adicionar = (url) => {
    if (typeof url !== 'string' || !url.trim()) return;
    try {
      const resolvida = new URL(url, location.href);
      if (resolvida.protocol === 'http:' || resolvida.protocol === 'https:') imagens.add(resolvida.href);
    } catch { /* URL inválida no banco */ }
  };
  for (const banco of bancos) for (const q of banco) {
    for (const url of q.imagens || []) adicionar(url);
    for (const match of String(q.enunciado || '').matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) adicionar(match[1]);
    for (const alternativa of q.alternativas || []) {
      adicionar(alternativa.imagem);
      for (const match of String(alternativa.texto || '').matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) adicionar(match[1]);
    }
  }

  const urls = [...imagens];
  if (!urls.length) { aoProgredir?.(1); return { imagens: 0, falhas: 0 }; }
  let proxima = 0;
  let prontas = 0;
  let falhas = 0;
  const baixar = async () => {
    while (proxima < urls.length) {
      const url = urls[proxima++];
      try {
        const resposta = await fetch(url, { mode: 'no-cors' });
        const guardada = typeof caches !== 'undefined' ? await caches.match(url) : null;
        if ((resposta.ok || resposta.type === 'opaque') && guardada) prontas++;
        else falhas++;
      } catch { falhas++; }
      aoProgredir?.(0.15 + 0.85 * ((prontas + falhas) / urls.length));
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, urls.length) }, baixar));
  return { imagens: prontas, falhas };
}
