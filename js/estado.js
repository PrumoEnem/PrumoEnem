/**
 * estado.js — tudo que é do usuário.
 *
 * Grava primeiro no navegador e sobe para a nuvem depois. Se a internet
 * cair no meio da sessão, nada se perde: o localStorage já tem, e a
 * sincronização acontece na próxima vez que houver conexão.
 */

import * as nuvem from './nuvem.js';
import { AREAS, CORRECOES_AREA } from './dados.js';

const CHAVE = 'enem-plataforma-v1';
const CHAVE_LOCAL = `${CHAVE}:local`;
const chaveUsuario = (uid) => `${CHAVE}:${encodeURIComponent(uid)}`;
const lerSalvo = (chave) => {
  try {
    const bruto = localStorage.getItem(chave);
    return bruto ? JSON.parse(bruto) : null;
  } catch {
    return null;
  }
};
const dataLocal = (data = new Date()) => {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
};
const hoje = () => dataLocal();

const ontem = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return dataLocal(d);
};

function estadoInicial() {
  return {
    versao: 1,
    uid: null,
    alvo: { cursoId: null, pesos: null },
    notaRedacao: null,
    redacao: { competencias: {}, ultimaAtualizacao: null, tempos: [] },
    preferenciaSessao: null,
    intensivo: { inicio: null, diasConcluidos: [] },
    nome: null,
    foto: null,
    plano: 'gratuito',
    thetas: {},
    ofensiva: { atual: 0, recorde: 0, ultimoDia: null },
    rotina: { estudo: [1, 2, 3, 4, 5], redacao: [3] },
    metaSemanal: { sessoes: 5, semana: null, feitas: 0 },
    sessoes: [],
    questoesVistas: {},
    errosPendentes: [],
    flashcards: [],
    resumos: [],
    vocabulario: {},
    ultimaSincronizacao: null,
  };
}

export let estado = estadoInicial();

function normalizarEstado() {
  if (!estado || typeof estado !== 'object') estado = estadoInicial();
  estado = { ...estadoInicial(), ...estado };
  if (!estado.redacao || typeof estado.redacao !== 'object') estado.redacao = estadoInicial().redacao;
  estado.redacao.competencias ||= {};
  if (!estado.questoesVistas || typeof estado.questoesVistas !== 'object' || Array.isArray(estado.questoesVistas)) {
    estado.questoesVistas = {};
  }
  if (!estado.vocabulario || typeof estado.vocabulario !== 'object' || Array.isArray(estado.vocabulario)) {
    estado.vocabulario = {};
  }
  estado.errosPendentes = Array.isArray(estado.errosPendentes) ? estado.errosPendentes : [];
  estado.flashcards = Array.isArray(estado.flashcards) ? estado.flashcards : [];
  estado.resumos = Array.isArray(estado.resumos) ? estado.resumos : [];
  estado.sessoes = Array.isArray(estado.sessoes) ? estado.sessoes : [];
  estado.intensivo = {
    inicio: estado.intensivo?.inicio || null,
    diasConcluidos: Array.isArray(estado.intensivo?.diasConcluidos)
      ? [...new Set(estado.intensivo.diasConcluidos)] : [],
  };

  for (const area of AREAS) {
    if (!Array.isArray(estado.questoesVistas[area])) estado.questoesVistas[area] = [];
  }
  for (const erro of estado.errosPendentes) {
    if (!erro || typeof erro !== 'object') continue;
    const correcao = CORRECOES_AREA[erro.id];
    if (correcao && erro.area === correcao.de) {
      erro.area = correcao.para;
      if (correcao.idCorrigido) erro.id = correcao.idCorrigido;
    }
  }
  for (const [id, correcao] of Object.entries(CORRECOES_AREA)) {
    const antigas = estado.questoesVistas[correcao.de] || [];
    if (!antigas.includes(id)) continue;
    estado.questoesVistas[correcao.de] = antigas.filter((vista) => vista !== id);
    const idCorrigido = correcao.idCorrigido || id;
    estado.questoesVistas[correcao.para] = [...new Set([...(estado.questoesVistas[correcao.para] || []), idCorrigido])].slice(-600);
  }

  // A nota só pode entrar na simulação quando as cinco competências existem.
  const competencias = estado.redacao?.competencias || {};
  const ids = ['c1', 'c2', 'c3', 'c4', 'c5'];
  const completa = ids.every((id) => competencias[id] !== undefined && competencias[id] !== null && competencias[id] !== '');
  estado.notaRedacao = completa
    ? ids.reduce((soma, id) => soma + (Number(competencias[id]) || 0), 0)
    : null;
}

export function carregarLocal() {
  const legado = lerSalvo(CHAVE);
  const local = lerSalvo(CHAVE_LOCAL);
  // A chave antiga podia conter dados de uma conta. Só carregamos dela antes
  // da autenticação se não estiver vinculada a um usuário.
  const estadoLocal = local && (!local.uid || local.uid === 'local') ? local : null;
  const inicial = estadoLocal || (legado && (!legado.uid || legado.uid === 'local') ? legado : null);
  estado = inicial ? { ...estadoInicial(), ...inicial } : estadoInicial();
  if (inicial && !estado.uid) estado.uid = 'local';
  for (const area of AREAS) if (!estado.questoesVistas[area]) estado.questoesVistas[area] = [];
  normalizarEstado();
  return estado;
}

export function salvarLocal() {
  try {
    const chave = !estado.uid || estado.uid === 'local' ? CHAVE_LOCAL : chaveUsuario(estado.uid);
    localStorage.setItem(chave, JSON.stringify(estado));
  } catch (e) {
    console.warn('Armazenamento local cheio.', e);
  }
}

export async function sincronizar() {
  if (!nuvem.nuvemAtiva() || !estado.uid || estado.uid === 'local') return;
  try {
    await nuvem.salvarPerfil(estado.uid, {
      alvo: estado.alvo,
      thetas: estado.thetas,
      ofensiva: estado.ofensiva,
      rotina: estado.rotina,
      metaSemanal: estado.metaSemanal,
      intensivo: estado.intensivo,
      sessoes: estado.sessoes,
      notaRedacao: estado.notaRedacao,
      redacao: estado.redacao,
      nome: estado.nome,
      foto: estado.foto,
      plano: estado.plano,
      errosPendentes: estado.errosPendentes,
      flashcards: estado.flashcards,
      resumos: estado.resumos,
      vocabulario: estado.vocabulario,
      questoesVistas: estado.questoesVistas,
      atualizadoEm: new Date().toISOString(),
    });
    estado.ultimaSincronizacao = new Date().toISOString();
    salvarLocal();
  } catch (e) {
    console.warn('Sincronização adiada.', e);
  }
}

export async function puxarDaNuvem(uid) {
  const legado = lerSalvo(CHAVE);
  if (uid === 'local') {
    const local = lerSalvo(CHAVE_LOCAL)
      || (legado && (!legado.uid || legado.uid === 'local') ? legado : null);
    estado = local ? { ...estadoInicial(), ...local, uid: 'local' } : { ...estadoInicial(), uid: 'local' };
    normalizarEstado();
    salvarLocal();
    return;
  }

  const anterior = estado;
  const salvoDaConta = lerSalvo(chaveUsuario(uid));
  const legadoPertence = legado && (!legado.uid || legado.uid === 'local' || legado.uid === uid);
  const origem = salvoDaConta || (legadoPertence ? legado : anterior.uid === 'local' ? anterior : null);
  estado = origem ? { ...estadoInicial(), ...origem, uid } : { ...estadoInicial(), uid };
  normalizarEstado();
  if (!nuvem.nuvemAtiva()) { salvarLocal(); return; }

  const remoto = await nuvem.lerPerfil(uid);
  // O mais recente vence. Sem histórico de merge, é a regra menos surpreendente.
  if (remoto?.atualizadoEm && (!estado.ultimaSincronizacao || remoto.atualizadoEm > estado.ultimaSincronizacao)) {
    Object.assign(estado, remoto);
  }
  normalizarEstado();
  salvarLocal();
}

/** Ofensiva: conta dias corridos de estudo. Pular um dia zera. */
export function registrarDiaEstudado() {
  const d = hoje();
  const o = estado.ofensiva;
  if (o.ultimoDia === d) return { mudou: false, ofensiva: o.atual };

  o.atual = o.ultimoDia === ontem() ? o.atual + 1 : 1;
  o.ultimoDia = d;
  o.recorde = Math.max(o.recorde, o.atual);

  const semana = semanaAtual();
  if (estado.metaSemanal.semana !== semana) {
    estado.metaSemanal.semana = semana;
    estado.metaSemanal.feitas = 0;
  }
  estado.metaSemanal.feitas += 1;

  salvarLocal();
  return { mudou: true, ofensiva: o.atual };
}

/** Se passou de um dia sem estudar, a ofensiva já morreu — mostra zero. */
export function ofensivaViva() {
  const o = estado.ofensiva;
  if (!o.ultimoDia) return 0;
  return o.ultimoDia === hoje() || o.ultimoDia === ontem() ? o.atual : 0;
}

function semanaAtual() {
  const d = new Date();
  const inicio = new Date(d.getFullYear(), 0, 1);
  const dias = Math.floor((d - inicio) / 86400000);
  return `${d.getFullYear()}-S${Math.ceil((dias + inicio.getDay() + 1) / 7)}`;
}

export function marcarVistas(area, ids) {
  const lista = estado.questoesVistas[area] || [];
  estado.questoesVistas[area] = [...new Set([...lista, ...ids])].slice(-600);
}

export function exportarBackup() {
  const blob = new Blob([JSON.stringify(estado, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `backup-estudos-${hoje()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function importarBackup(arquivo) {
  const texto = await arquivo.text();
  const dados = JSON.parse(texto);
  if (!dados.versao) throw new Error('Esse arquivo não parece um backup da plataforma.');
  const donoAtual = estado.uid || (!nuvem.nuvemAtiva() ? 'local' : null);
  estado = { ...estadoInicial(), ...dados, uid: donoAtual };
  normalizarEstado();
  salvarLocal();
  await sincronizar();
}
