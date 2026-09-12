/**
 * redacao.js — notas por competência e cronômetro de escrita.
 *
 * O cronômetro tenta abrir numa janela "sempre no topo" (Document
 * Picture-in-Picture), para ficar visível enquanto você escreve no Redação
 * Paraná, que é um site de outro domínio. Nenhuma página pode desenhar por
 * cima de outro site — isso só um extensão de navegador faria. A janela PiP
 * é o mais perto disso que a web permite, e existe só no Chrome/Edge de
 * computador. Fora dali, cai para janela comum e depois para o próprio app.
 */

export const COMPETENCIAS = [
  { id: 'c1', nome: 'Domínio da norma culta', dica: 'Gramática, ortografia, pontuação, regência.' },
  { id: 'c2', nome: 'Compreender a proposta', dica: 'Ficar no tema e usar repertório de outras áreas.' },
  { id: 'c3', nome: 'Selecionar e organizar argumentos', dica: 'Defender um ponto de vista com progressão.' },
  { id: 'c4', nome: 'Coesão e coerência', dica: 'Conectivos e encadeamento entre parágrafos.' },
  { id: 'c5', nome: 'Proposta de intervenção', dica: 'Agente, ação, meio, efeito e detalhamento.' },
];

export const MAXIMO_POR_COMPETENCIA = 200;

export const somarCompetencias = (notas = {}) =>
  COMPETENCIAS.reduce((soma, c) => soma + (Number(notas[c.id]) || 0), 0);

/** A competência mais fraca vira sugestão de estudo. */
export function competenciaMaisFraca(notas = {}) {
  const preenchidas = COMPETENCIAS.filter((c) => notas[c.id] !== undefined && notas[c.id] !== null && notas[c.id] !== '');
  if (preenchidas.length < 2) return null;
  return preenchidas.reduce((pior, c) =>
    (Number(notas[c.id]) < Number(notas[pior.id]) ? c : pior), preenchidas[0]);
}

// ---------------------------------------------------------------- cronômetro

const RELOGIO_HTML = `
<div id="rel-caixa">
  <div id="rel-rotulo">Tempo de redação</div>
  <div id="rel-tempo">--:--</div>
  <div id="rel-estado"></div>
  <div id="rel-botoes">
    <button id="rel-iniciar">Iniciar</button>
    <button id="rel-parar">Parar</button>
  </div>
</div>`;

/**
 * Em janela própria o relógio ocupa a tela toda; embutido no app ele é só um
 * bloco. Sem separar os dois, o estilo de `body` vazaria para a página e
 * quebraria o layout inteiro.
 */
const css = (embutido) => `
  ${embutido ? '' : `
  :root { color-scheme: dark; }
  body { margin:0; background:#12151f; color:#eceefa;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    display:grid; place-items:center; height:100vh; }`}
  #rel-caixa { text-align:center; padding:14px; width:100%; }
  #rel-rotulo { font-size:11px; letter-spacing:.04em; text-transform:uppercase; color:#646c85; }
  #rel-tempo { font-size:clamp(34px,17vw,60px); font-weight:600; line-height:1.05;
    margin:6px 0 2px; font-variant-numeric:tabular-nums; color:#8cc6ff; }
  #rel-tempo.estourado { color:#ec6f83; }
  #rel-estado { font-size:12.5px; color:#8d95b0; min-height:18px; }
  #rel-botoes { display:flex; gap:7px; margin-top:12px; }
  #rel-botoes button { flex:1; padding:9px 4px; font-size:13px; font-weight:600;
    border-radius:9px; border:1px solid #313850; background:#272d41; color:#eceefa; cursor:pointer; }
  #rel-iniciar { background:#62aef8; border-color:#8cc6ff; color:#09182a; }
  #rel-botoes button:disabled { opacity:.4; cursor:not-allowed; }`;

/**
 * Controla o relógio dentro de um documento qualquer — a página, uma janela
 * PiP ou um popup. Assim a lógica é uma só nos três casos.
 */
export function montarRelogio(doc, minutosLimite, aoTerminar, embutido = false) {
  const estilo = doc.createElement('style');
  estilo.textContent = css(embutido);
  (doc.head || doc.body).appendChild(estilo);
  doc.body.innerHTML = RELOGIO_HTML;
  doc.body.appendChild(estilo);

  const limite = minutosLimite * 60;
  let inicio = null;
  let intervalo = null;
  let avisou = false;

  const elTempo = doc.getElementById('rel-tempo');
  const elEstado = doc.getElementById('rel-estado');
  const btIniciar = doc.getElementById('rel-iniciar');
  const btParar = doc.getElementById('rel-parar');

  const formatar = (s) => {
    const t = Math.abs(Math.floor(s));
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const seg = t % 60;
    const base = h ? `${h}:${String(m).padStart(2, '0')}` : String(m);
    return `${base}:${String(seg).padStart(2, '0')}`;
  };

  const passo = () => {
    const decorrido = (Date.now() - inicio) / 1000;
    const restante = limite - decorrido;

    if (restante >= 0) {
      elTempo.textContent = formatar(restante);
      elTempo.classList.remove('estourado');
      elEstado.textContent = `de ${minutosLimite} min`;
    } else {
      // Passou do limite: continua contando, agora para cima. Interromper
      // no meio de um parágrafo não ensina nada; saber quanto passou, sim.
      elTempo.textContent = '+' + formatar(-restante);
      elTempo.classList.add('estourado');
      elEstado.textContent = 'além do limite';
      if (!avisou) {
        avisou = true;
        elEstado.textContent = 'acabou o tempo — contando o excedente';
      }
    }
  };

  const parar = () => {
    clearInterval(intervalo);
    intervalo = null;
    if (!inicio) return;
    const decorrido = (Date.now() - inicio) / 1000;
    const excedente = Math.max(0, decorrido - limite);
    inicio = null;
    btIniciar.disabled = false;
    btIniciar.textContent = 'Iniciar';
    elEstado.textContent = excedente > 0
      ? `passou ${formatar(excedente)} do limite`
      : 'dentro do tempo';
    aoTerminar?.({ segundos: Math.round(decorrido), excedente: Math.round(excedente), limite });
  };

  btIniciar.onclick = () => {
    inicio = Date.now();
    avisou = false;
    btIniciar.disabled = true;
    btIniciar.textContent = 'Correndo';
    clearInterval(intervalo);
    passo();
    intervalo = setInterval(passo, 1000);
  };
  btParar.onclick = parar;

  elTempo.textContent = formatar(limite);
  elEstado.textContent = `de ${minutosLimite} min`;

  return { parar, encerrar: () => clearInterval(intervalo) };
}

export const suportaJanelaFlutuante = () => 'documentPictureInPicture' in window;

/**
 * Abre o relógio na melhor janela disponível.
 * @returns {Promise<'flutuante'|'popup'|'embutido'>} onde ele abriu
 */
export async function abrirRelogio(minutos, aoTerminar, alvoEmbutido) {
  if (suportaJanelaFlutuante()) {
    try {
      const janela = await window.documentPictureInPicture.requestWindow({ width: 240, height: 190 });
      montarRelogio(janela.document, minutos, aoTerminar);
      return 'flutuante';
    } catch (e) {
      console.warn('Janela flutuante recusada, tentando popup.', e);
    }
  }

  const popup = window.open('', 'PrumoRelogio', 'width=250,height=210,menubar=no,toolbar=no');
  if (popup && !popup.closed) {
    popup.document.title = 'Redação — PrumoENEM';
    montarRelogio(popup.document, minutos, aoTerminar);
    return 'popup';
  }

  if (alvoEmbutido) {
    montarRelogio({
      body: alvoEmbutido,
      createElement: (t) => document.createElement(t),
      getElementById: (id) => alvoEmbutido.querySelector('#' + id),
    }, minutos, aoTerminar, true);
    return 'embutido';
  }
  throw new Error('Não consegui abrir o cronômetro.');
}
