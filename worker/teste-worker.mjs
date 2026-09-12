import { validarToken } from './worker.js';
import { webcrypto } from 'crypto';
const subtle = webcrypto.subtle;


const PROJ = 'prumoenem-6a949';
let falhas = 0;
const ok = (n, c, d='') => { if(!c) falhas++; console.log((c?'OK   ':'FALHA')+' '+n+(d?' — '+d:'')); };

// Par de chaves RSA, fazendo o papel do Google.
const par = await webcrypto.subtle.generateKey(
  { name:'RSASSA-PKCS1-v1_5', modulusLength:2048, publicExponent:new Uint8Array([1,0,1]), hash:'SHA-256' },
  true, ['sign','verify']);
const jwkPub = await webcrypto.subtle.exportKey('jwk', par.publicKey);
jwkPub.kid = 'chave-teste';

// Dublê do endpoint de chaves do Google.
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({ keys: [{ ...jwkPub, kid: 'chave-teste' }] }),
  headers: { get: () => 'max-age=3600' },
});

const b64u = (buf) => Buffer.from(buf).toString('base64')
  .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');

async function fazerToken(corpo, kid='chave-teste', alg='RS256') {
  const cab = b64u(JSON.stringify({ alg, kid, typ:'JWT' }));
  const cor = b64u(JSON.stringify(corpo));
  const assinatura = await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5', par.privateKey,
    new TextEncoder().encode(`${cab}.${cor}`));
  return `${cab}.${cor}.${b64u(assinatura)}`;
}

const agora = Math.floor(Date.now()/1000);
const base = {
  sub:'uid123', aud:PROJ, iss:`https://securetoken.google.com/${PROJ}`,
  exp: agora+3600, iat: agora, email:'rafael@escola.pr.gov.br', email_verified:true,
};

console.log('=== token bom ===');
const u = await validarToken(await fazerToken(base), PROJ);
ok('aceita token válido', u.uid==='uid123' && u.email===base.email && u.verificado===true, JSON.stringify(u));

console.log('\n=== ataques ===');
const recusa = async (nome, corpo, mexer) => {
  let t = await fazerToken(corpo ?? base);
  if (mexer) t = mexer(t);
  try { await validarToken(t, PROJ); ok(nome, false, 'ACEITOU indevidamente'); }
  catch (e) { ok(nome, true, e.message); }
};

await recusa('recusa token expirado', { ...base, exp: agora-10 });
await recusa('recusa outro projeto', { ...base, aud: 'projeto-alheio' });
await recusa('recusa emissor falso', { ...base, iss: 'https://malicioso.com/'+PROJ });
await recusa('recusa sem usuário', { ...base, sub: undefined });
await recusa('recusa assinatura adulterada', base, (t) => {
  const p = t.split('.');
  // troca o e-mail mantendo a assinatura original
  const corpo = JSON.parse(Buffer.from(p[1].replace(/-/g,'+').replace(/_/g,'/'),'base64'));
  corpo.email = 'invasor@gmail.com';
  p[1] = b64u(JSON.stringify(corpo));
  return p.join('.');
});
await recusa('recusa token malformado', null, () => 'abc.def');

// alg none — ataque clássico
try {
  const cab = b64u(JSON.stringify({ alg:'none', kid:'chave-teste', typ:'JWT' }));
  const cor = b64u(JSON.stringify(base));
  await validarToken(`${cab}.${cor}.`, PROJ);
  ok('recusa alg none', false, 'ACEITOU');
} catch (e) { ok('recusa alg none', true, e.message); }

// kid desconhecido
try {
  await validarToken(await fazerToken(base, 'kid-falso'), PROJ);
  ok('recusa chave desconhecida', false, 'ACEITOU');
} catch (e) { ok('recusa chave desconhecida', true, e.message); }

console.log(falhas ? `\n${falhas} falha(s)` : '\nTodos passaram.');
process.exit(falhas?1:0);
