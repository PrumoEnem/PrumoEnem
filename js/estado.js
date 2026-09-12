/**
 * estado.js — tudo que é do usuário.
 *
 * Grava primeiro no navegador e sobe para a nuvem depois. Se a internet
 * cair no meio da sessão, nada se perde: o localStorage já tem, e a
 * sincronização acontece na próxima vez que houver conexão.
 */

import * as nuvem from './nuvem.js';
import { AREAS } from './dados.js';

const CHAVE = 'enem-plataforma-v1';
const hoje = () => new Date().toISOString().slice(0, 10);

const ontem = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
};

function estadoInicial() {
  return {
    versao: 1,
    uid: null,
    alvo: { cursoId: null, pesos: null },
    notaRedacao: null,
    redacao: { competencias: {}, ultimaAtualizacao: null, tempos: [] },
    preferenciaSessao: null,
    nome: null,
    plano: 'gratuito',
    thetas: {},
    ofensiva: { atual: 0, recorde: 0, ultimoDia: null },
    metaSemanal: { sessoes: 5, semana: null, feitas: 0 },
    sessoes: [],
    questoesVistas: {},
    flashcards: [],
    resumos: [],
    vocabulario: {},
    ultimaSincronizacao: null,
  };
}

export let estado = estadoInicial();

export function carregarLocal() {
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (bruto) estado = { ...estadoInicial(), ...JSON.parse(bruto) };
  } catch {
    estado = estadoInicial();
  }
  for (const area of AREAS) if (!estado.questoesVistas[area]) estado.questoesVistas[area] = [];
  return estado;
}

export function salvarLocal() {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(estado));
  } catch (e) {
    console.warn('Armazenamento local cheio.', e);
  }
}

export async function sincronizar() {
  if (!nuvem.nuvemAtiva() || !estado.uid) return;
  try {
    await nuvem.salvarPerfil(estado.uid, {
      alvo: estado.alvo,
      thetas: estado.thetas,
      ofensiva: estado.ofensiva,
      metaSemanal: estado.metaSemanal,
      notaRedacao: estado.notaRedacao,
      redacao: estado.redacao,
      nome: estado.nome,
      plano: estado.plano,
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
  estado.uid = uid;
  if (!nuvem.nuvemAtiva()) return;
  const remoto = await nuvem.lerPerfil(uid);
  // O mais recente vence. Sem histórico de merge, é a regra menos surpreendente.
  if (remoto?.atualizadoEm && (!estado.ultimaSincronizacao || remoto.atualizadoEm > estado.ultimaSincronizacao)) {
    Object.assign(estado, remoto);
    salvarLocal();
  }
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
  estado = { ...estadoInicial(), ...dados };
  salvarLocal();
  await sincronizar();
}
