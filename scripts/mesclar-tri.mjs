/**
 * mesclar-tri.mjs — injeta os parâmetros de TRI do INEP nas questões.
 *
 * O enem.dev não traz os parâmetros a, b e c. Quem traz é o INEP, nas
 * tabelas ITENS_PROVA dos microdados. Sem eles, a sessão 3/3/3 cai para
 * sorteio simples: funciona, mas não calibra.
 *
 * Como usar:
 *   1. Baixe os microdados em
 *      gov.br/inep/pt-br/acesso-a-informacao/dados-abertos/microdados/enem
 *   2. Extraia os arquivos ITENS_PROVA_<ano>.csv
 *   3. node scripts/mesclar-tri.mjs ITENS_PROVA_2020.csv ITENS_PROVA_2021.csv
 *
 * Atenção ao caderno: cada cor tem ordem diferente das mesmas questões.
 * O script usa CO_POSICAO do caderno azul, que é a ordem que o enem.dev
 * segue. Se a taxa de casamento vier muito baixa, troque TP_LINGUA ou a
 * cor em COR_CADERNO abaixo.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';

const COR_CADERNO = 'AZUL';
const AREAS = ['matematica', 'natureza', 'humanas', 'linguagens'];

function lerCSV(caminho) {
  const texto = readFileSync(caminho, 'latin1');
  const linhas = texto.split(/\r?\n/).filter(Boolean);
  const sep = linhas[0].includes(';') ? ';' : ',';
  const cabecalho = linhas[0].split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
  return linhas.slice(1).map((linha) => {
    const campos = linha.split(sep);
    return Object.fromEntries(cabecalho.map((c, i) => [c, (campos[i] ?? '').trim().replace(/^"|"$/g, '')]));
  });
}

const numero = (v) => {
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

const arquivos = process.argv.slice(2);
if (!arquivos.length) {
  console.error('Informe ao menos um CSV. Exemplo: node scripts/mesclar-tri.mjs ITENS_PROVA_2020.csv');
  process.exit(1);
}

// Monta o índice ano+posição -> parâmetros.
const parametros = new Map();
for (const arquivo of arquivos) {
  if (!existsSync(arquivo)) { console.error(`Não encontrei ${arquivo}`); continue; }
  let usadas = 0;
  for (const linha of lerCSV(arquivo)) {
    const cor = (linha.TX_COR || '').toUpperCase();
    if (cor && cor !== COR_CADERNO) continue;
    const ano = numero(linha.NU_ANO ?? linha.ANO);
    const posicao = numero(linha.CO_POSICAO ?? linha.NU_POSICAO);
    const a = numero(linha.NU_PARAM_A);
    const b = numero(linha.NU_PARAM_B);
    const c = numero(linha.NU_PARAM_C);
    if (!ano || !posicao || a === null || b === null) continue;
    parametros.set(`${ano}-${posicao}`, { a, b, c: c ?? 0.2 });
    usadas++;
  }
  console.log(`${arquivo}: ${usadas} itens com parâmetro`);
}

// Aplica nas questões.
let total = 0, casadas = 0;
for (const area of AREAS) {
  const caminho = `dados/questoes-${area}.json`;
  const questoes = JSON.parse(readFileSync(caminho, 'utf8'));
  let n = 0;
  for (const q of questoes) {
    total++;
    const p = parametros.get(`${q.ano}-${q.numero}`);
    if (p) { q.tri = p; n++; casadas++; }
  }
  writeFileSync(caminho, JSON.stringify(questoes));
  console.log(`${area.padEnd(11)} ${String(n).padStart(4)} de ${questoes.length} calibradas`);
}

const taxa = ((casadas / total) * 100).toFixed(1);
console.log(`\n${casadas} de ${total} questões calibradas (${taxa}%).`);
if (casadas && casadas / total < 0.1) {
  console.log('Taxa baixa. Confira a cor do caderno em COR_CADERNO e o nome das colunas do CSV.');
}
