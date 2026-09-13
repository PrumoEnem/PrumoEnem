/**
 * mesclar-tri.mjs — injeta os parâmetros de TRI do INEP nas questões.
 *
 * O enem.dev não traz a, b e c. Quem traz é o INEP, nas tabelas ITENS_PROVA
 * dos microdados. Sem eles, a sessão 3/3/3 cai para sorteio e a proficiência
 * sai por proporção de acertos.
 *
 *   node scripts/mesclar-tri.mjs dados/ITENS_PROVA_2021.csv dados/ITENS_PROVA_2022.csv
 *
 * O ano sai do nome do arquivo — os CSV do INEP não têm coluna de ano.
 * O banco de questões cobre 2009 a 2023; arquivo de ano fora disso não casa
 * com nada e o script avisa.
 *
 * Sobre a cor do caderno: cada cor embaralha as mesmas questões em ordem
 * diferente. O enem.dev segue o caderno AZUL. Se a taxa de casamento vier
 * baixa, troque COR_PREFERIDA.
 */

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'fs';
import { basename, join } from 'path';

const COR_PREFERIDA = 'AZUL';
const AREAS = ['matematica', 'natureza', 'humanas', 'linguagens'];

// SG_AREA do INEP -> área nossa. Serve de conferência do casamento.
const AREA_INEP = { MT: 'matematica', CN: 'natureza', CH: 'humanas', LC: 'linguagens' };

function lerCSV(caminho) {
  const texto = readFileSync(caminho, 'latin1');
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim());
  const sep = linhas[0].includes(';') ? ';' : ',';
  const cab = linhas[0].split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
  return linhas.slice(1).map((linha) => {
    const campos = linha.split(sep);
    return Object.fromEntries(cab.map((c, i) => [c, (campos[i] ?? '').trim().replace(/^"|"$/g, '')]));
  });
}

const numero = (v) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && String(v ?? '').trim() !== '' ? n : null;
};

// Aceita arquivos soltos ou pastas. Sem argumento, procura nos lugares
// prováveis — assim tanto faz se você pôs os CSV dentro ou fora do site.
const PASTAS_PADRAO = ['microdados', 'dados', '../microdados', '.'];
const argumentos = process.argv.slice(2);
const alvos = argumentos.length ? argumentos : PASTAS_PADRAO.filter(existsSync);

const arquivos = [];
for (const alvo of alvos) {
  if (!existsSync(alvo)) { console.error(`Não encontrei: ${alvo}`); continue; }
  if (statSync(alvo).isDirectory()) {
    const achados = readdirSync(alvo)
      .filter((f) => /^ITENS_PROVA.*\.csv$/i.test(f))
      .map((f) => join(alvo, f));
    // Só reclama de pasta vazia se o usuário a apontou de propósito.
    if (!achados.length && argumentos.length) console.error(`Nenhum ITENS_PROVA_*.csv em ${alvo}`);
    arquivos.push(...achados);
  } else {
    arquivos.push(alvo);
  }
}

if (!arquivos.length) {
  console.error(`
Não achei nenhum ITENS_PROVA_*.csv.

Ponha os arquivos em qualquer uma destas pastas e rode de novo:
  microdados/        (dentro do site — o .gitignore já cuida deles)
  dados/
  ../microdados/

Ou aponte o caminho na mão:
  node scripts/mesclar-tri.mjs caminho/ITENS_PROVA_2023.csv [...]

Onde baixar:
  gov.br/inep → Dados Abertos → Microdados → ENEM (anos 2020 a 2023)
Do ZIP, só interessa DADOS/ITENS_PROVA_<ano>.csv. O banco cobre 2009 a 2023.`);
  process.exit(1);
}

if (!existsSync('dados/questoes-matematica.json')) {
  console.error('Não achei dados/questoes-matematica.json — rode de dentro da pasta do site.');
  process.exit(1);
}

const parametros = new Map();
const anosVistos = new Set();

for (const arquivo of [...new Set(arquivos)]) {
  if (!existsSync(arquivo)) { console.error(`Não encontrei ${arquivo}`); continue; }

  const ano = numero((basename(arquivo).match(/(19|20)\d{2}/) || [])[0]);
  if (!ano) {
    console.error(`Não achei o ano no nome de ${arquivo}. Renomeie para ITENS_PROVA_2021.csv.`);
    continue;
  }

  if (anosVistos.has(ano)) {
    console.log(`${basename(arquivo)}: ano ${ano} já processado, pulando.`);
    continue;
  }
  anosVistos.add(ano);

  const linhas = lerCSV(arquivo);
  const cores = new Set(linhas.map((l) => (l.TX_COR || '').toUpperCase()).filter(Boolean));
  // Se o caderno azul não existir nesse ano, usa a cor mais frequente.
  let cor = COR_PREFERIDA;
  if (cores.size && !cores.has(COR_PREFERIDA)) {
    const contagem = {};
    for (const l of linhas) {
      const c = (l.TX_COR || '').toUpperCase();
      if (c && c !== 'LEITOR TELA') contagem[c] = (contagem[c] || 0) + 1;
    }
    cor = Object.entries(contagem).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    console.log(`${basename(arquivo)}: sem caderno ${COR_PREFERIDA}, usando ${cor}`);
  }

  let usadas = 0;
  for (const l of linhas) {
    const corLinha = (l.TX_COR || '').toUpperCase();
    if (cor && corLinha && corLinha !== cor) continue;
    // Item de língua estrangeira aparece duas vezes (inglês e espanhol).
    if (l.TP_LINGUA && numero(l.TP_LINGUA) === 1) continue;
    if (l.IN_ITEM_ABAN === '1') continue;

    const posicao = numero(l.CO_POSICAO ?? l.NU_POSICAO);
    const a = numero(l.NU_PARAM_A);
    const b = numero(l.NU_PARAM_B);
    const c = numero(l.NU_PARAM_C);
    if (!posicao || a === null || b === null) continue;

    parametros.set(`${ano}-${posicao}`, { a, b, c: c ?? 0.2, area: AREA_INEP[l.SG_AREA] || null });
    usadas++;
  }
  console.log(`${basename(arquivo)}: ano ${ano}, ${usadas} itens com parâmetro`);
}

let total = 0, casadas = 0, areaErrada = 0;
const porAno = {};

for (const area of AREAS) {
  const caminho = `dados/questoes-${area}.json`;
  const questoes = JSON.parse(readFileSync(caminho, 'utf8'));
  let n = 0;
  for (const q of questoes) {
    total++;
    const p = parametros.get(`${q.ano}-${q.numero}`);
    if (!p) continue;
    // Se a área do INEP não bate com a nossa, o alinhamento de posição está
    // errado — gravar seria pior que não gravar.
    if (p.area && p.area !== area) { areaErrada++; continue; }
    q.tri = { a: p.a, b: p.b, c: p.c };
    n++; casadas++;
    porAno[q.ano] = (porAno[q.ano] || 0) + 1;
  }
  writeFileSync(caminho, JSON.stringify(questoes));
  console.log(`${area.padEnd(11)} ${String(n).padStart(4)} de ${questoes.length} calibradas`);
}

console.log(`\n${casadas} de ${total} questões calibradas (${((casadas / total) * 100).toFixed(1)}%).`);
if (Object.keys(porAno).length) console.log('por ano:', porAno);

if (!casadas) {
  console.log('\nNenhuma casou. Causas comuns:');
  console.log('  · o ano do arquivo não existe no banco (ele cobre 2009 a 2023);');
  console.log('  · a cor do caderno não bate — ajuste COR_PREFERIDA no topo do script.');
} else if (areaErrada > casadas * 0.1) {
  console.log(`\nAtenção: ${areaErrada} itens foram descartados por área divergente.`);
  console.log('Isso indica ordem de questões diferente. Tente outra cor de caderno.');
}
