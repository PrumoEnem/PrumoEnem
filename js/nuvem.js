/**
 * nuvem.js — Firebase (Auth + Firestore) via CDN, sem build.
 *
 * Com MODO_LOCAL ligado, tudo funciona sem Firebase: o usuário é anônimo e
 * os dados ficam só no navegador. É assim que o app roda antes de você
 * configurar o projeto.
 */

import { FIREBASE, MODO_LOCAL, DOMINIO_PERMITIDO, EMAILS_LIBERADOS } from './config.js';

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
  sdk.onAuthStateChanged(auth, async (u) => {
    // Sessão antiga de conta fora do domínio (ou domínio mudou depois): expulsa.
    if (u && !emailPermitido(u.email)) {
      await sdk.signOut(auth);
      callback(null, new ContaNaoPermitida(u.email));
      return;
    }
    callback(u ? { uid: u.uid, nome: u.displayName || u.email, email: u.email, foto: u.photoURL } : null);
  });
  return true;
}

/** O e-mail tem permissão de entrar? */
export function emailPermitido(email) {
  if (!DOMINIO_PERMITIDO) return true;
  if (!email) return false;
  const limpo = email.toLowerCase().trim();
  if (EMAILS_LIBERADOS.map((x) => x.toLowerCase()).includes(limpo)) return true;
  return limpo.endsWith('@' + DOMINIO_PERMITIDO.toLowerCase());
}

export class ContaNaoPermitida extends Error {
  constructor(email) {
    super(`A conta ${email || 'usada'} não é do domínio @${DOMINIO_PERMITIDO}. ` +
          'Entre com seu e-mail @escola, o mesmo do Classroom.');
    this.name = 'ContaNaoPermitida';
  }
}

export async function entrarComGoogle() {
  await iniciar();
  const provedor = new sdk.GoogleAuthProvider();
  // hd faz o Google já mostrar só contas desse domínio no seletor.
  // É conveniência, não segurança: dá para contornar. A regra do Firestore
  // é o que realmente barra.
  if (DOMINIO_PERMITIDO) provedor.setCustomParameters({ hd: DOMINIO_PERMITIDO, prompt: 'select_account' });

  const credencial = await sdk.signInWithPopup(auth, provedor);
  const email = credencial.user?.email;

  if (!emailPermitido(email)) {
    // Desloga antes de devolver o erro, senão a sessão fica pendurada.
    await sdk.signOut(auth);
    throw new ContaNaoPermitida(email);
  }
}

export async function sair() {
  if (!nuvemAtiva()) return;
  await iniciar();
  await sdk.signOut(auth);
}

/**
 * Token de identidade do usuário, para o Worker saber quem está chamando.
 * Sem isso qualquer um que descobrisse a URL do Worker gastaria os créditos.
 */
export async function tokenAtual() {
  if (!nuvemAtiva() || !auth?.currentUser) return null;
  return auth.currentUser.getIdToken();
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
