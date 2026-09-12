/**
 * nuvem.js — Firebase (Auth + Firestore) via CDN, sem build.
 *
 * Com MODO_LOCAL ligado, tudo funciona sem Firebase: o usuário é anônimo e
 * os dados ficam só no navegador. É assim que o app roda antes de você
 * configurar o projeto.
 */

import { FIREBASE, MODO_LOCAL } from './config.js';

const CDN = 'https://www.gstatic.com/firebasejs/10.12.0';

let app = null;
let auth = null;
let db = null;
let sdk = null;
let falhou = false;

/**
 * A nuvem só conta como ativa se estiver configurada E tiver carregado.
 * Se o SDK não vier (rede ruim, bloqueio, offline no primeiro acesso),
 * o app cai para modo local em vez de mostrar tela branca.
 */
export const nuvemAtiva = () => !MODO_LOCAL && !!FIREBASE.apiKey && !falhou;

async function iniciar() {
  if (app || !nuvemAtiva()) return;
  const [núcleo, autenticacao, firestore] = await Promise.all([
    import(`${CDN}/firebase-app.js`),
    import(`${CDN}/firebase-auth.js`),
    import(`${CDN}/firebase-firestore.js`),
  ]);
  sdk = { ...autenticacao, ...firestore };
  app = núcleo.initializeApp(FIREBASE);
  auth = autenticacao.getAuth(app);
  db = firestore.getFirestore(app);
}

export async function observarUsuario(callback) {
  // Em modo local o app.js cuida do fluxo; não há usuário para observar.
  if (!nuvemAtiva()) return false;
  try {
    await iniciar();
  } catch (e) {
    console.warn('Firebase não carregou; seguindo em modo local.', e);
    falhou = true;
    return false;
  }
  sdk.onAuthStateChanged(auth, (u) => {
    callback(u ? { uid: u.uid, nome: u.displayName || u.email, email: u.email } : null);
  });
  return true;
}

export async function entrarComGoogle() {
  await iniciar();
  const provedor = new sdk.GoogleAuthProvider();
  await sdk.signInWithPopup(auth, provedor);
}

export async function entrarComEmail(email, senha, criar = false) {
  await iniciar();
  const fn = criar ? sdk.createUserWithEmailAndPassword : sdk.signInWithEmailAndPassword;
  await fn(auth, email, senha);
}

export async function sair() {
  if (!nuvemAtiva()) return;
  await iniciar();
  await sdk.signOut(auth);
}

export async function lerPerfil(uid) {
  if (!nuvemAtiva()) return null;
  await iniciar();
  const doc = await sdk.getDoc(sdk.doc(db, 'usuarios', uid));
  return doc.exists() ? doc.data() : null;
}

export async function salvarPerfil(uid, dados) {
  if (!nuvemAtiva()) return;
  await iniciar();
  await sdk.setDoc(sdk.doc(db, 'usuarios', uid), dados, { merge: true });
}

/** Grava a sessão inteira numa escrita só, como planejado. */
export async function salvarSessao(uid, sessao) {
  if (!nuvemAtiva()) return;
  await iniciar();
  await sdk.setDoc(sdk.doc(db, 'usuarios', uid, 'sessoes', sessao.id), sessao);
}
