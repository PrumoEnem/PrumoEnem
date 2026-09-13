/**
 * config.js — configuração do projeto.
 *
 * Sobre a apiKey: ela NÃO é segredo. A chave web do Firebase é pública por
 * design e vai no código de qualquer app Firebase do mundo. Ela apenas
 * identifica o projeto. Quem protege seus dados são as regras do Firestore
 * e a lista de domínios autorizados no Authentication — veja o README.
 */

export const FIREBASE = {
  apiKey: 'AIzaSyCAwpVx4Ceb2fp6l8xP0ztofKwfDm5-ib8',
  authDomain: 'prumoenem-6a949.firebaseapp.com',
  projectId: 'prumoenem-6a949',
  storageBucket: 'prumoenem-6a949.firebasestorage.app',
  messagingSenderId: '308553008969',
  appId: '1:308553008969:web:d2628f2bef31dc0a927c98',
};

/** URL do seu Cloudflare Worker. Deixe vazio para desligar a IA. */
export const URL_WORKER = https://prumoenem-ia.prumoenem.workers.dev';

/** Com true, ignora o Firebase e usa só dados locais. Útil para testar. */
export const MODO_LOCAL = false;

/**
 * Restringe o login a um domínio. Vazio ('') libera qualquer conta Google.
 *
 * IMPORTANTE: isto aqui é só conveniência e mensagem de erro. Quem de fato
 * bloqueia é a regra do Firestore, que roda no servidor — veja o README.
 * Mudar esta linha sem mudar a regra não protege nada.
 */
export const DOMINIO_PERMITIDO = 'escola.pr.gov.br';

/** Contas liberadas fora do domínio (a sua pessoal, por exemplo). */
export const EMAILS_LIBERADOS = [];
