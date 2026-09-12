/**
 * localizar-imagens.mjs — traz as imagens das questões para dentro do projeto.
 *
 * Por padrão as questões apontam para https://enem.dev/... Funciona, mas
 * amarra o app ao servidor deles e quebra o modo offline, porque o service
 * worker não consegue garantir imagem de outro domínio.
 *
 * Este script baixa o repositório do enem-api (uns 80 MB), copia as imagens
 * para dados/img/ e reescreve os caminhos nos JSON.
 *
 *   node scripts/localizar-imagens.mjs
 *
 * Roda uma vez só. Depois disso o site inteiro funciona sem internet.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync, readdirSync } from 'fs';
import { execSync } from 'child_process';
import { join, basename } from 'path';

const AREAS = ['matematica', 'natureza', 'humanas', 'linguagens'];
const TEMP = '.enem-tmp';
const DESTINO = 'dados/img';
const TARBALL = 'https://codeload.github.com/yunger7/enem-api/tar.gz/refs/heads/main';

if (!existsSync(join(TEMP, 'enem-api-main'))) {
  console.log('Baixando o repositório (uns 80 MB, leva alguns minutos)…');
  mkdirSync(TEMP, { recursive: true });
  execSync(`curl -sSL -o ${TEMP}/repo.tar.gz "${TARBALL}"`, { stdio: 'inherit' });
  console.log('Extraindo…');
  execSync(`tar -xzf ${TEMP}/repo.tar.gz -C ${TEMP}`, { stdio: 'inherit' });
}

const ORIGEM = join(TEMP, 'enem-api-main', 'public');
mkdirSync(DESTINO, { recursive: true });

// Mapeia nome do arquivo -> caminho real dentro do repositório.
const mapa = new Map();
function varrer(dir) {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const caminho = join(dir, entrada.name);
    if (entrada.isDirectory()) varrer(caminho);
    else if (/\.(png|jpg|jpeg|svg|webp)$/i.test(entrada.name)) mapa.set(entrada.name, caminho);
  }
}
varrer(ORIGEM);
console.log(`${mapa.size} imagens encontradas no repositório.`);

let copiadas = 0, faltando = 0;

const localizar = (url) => {
  if (!url || !url.startsWith('http')) return url;
  const nome = basename(new URL(url).pathname);
  const fonte = mapa.get(nome);
  if (!fonte) { faltando++; return url; }
  const alvo = join(DESTINO, nome);
  if (!existsSync(alvo)) { copyFileSync(fonte, alvo); copiadas++; }
  return `${DESTINO}/${nome}`;
};

for (const area of AREAS) {
  const caminho = `dados/questoes-${area}.json`;
  const questoes = JSON.parse(readFileSync(caminho, 'utf8'));

  for (const q of questoes) {
    q.imagens = (q.imagens || []).map(localizar);
    // O enunciado traz as imagens em markdown; reescreve lá também.
    q.enunciado = q.enunciado.replace(
      /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g,
      (_, alt, url) => `![${alt}](${localizar(url)})`
    );
    for (const a of q.alternativas) a.imagem = localizar(a.imagem);
  }

  writeFileSync(caminho, JSON.stringify(questoes));
  console.log(`${area} reescrito`);
}

console.log(`\n${copiadas} imagens copiadas para ${DESTINO}/`);
if (faltando) console.log(`${faltando} continuam apontando para enem.dev (não achei o arquivo).`);
console.log(`Agora apague a pasta ${TEMP}/ — ela não precisa ir para o repositório.`);
