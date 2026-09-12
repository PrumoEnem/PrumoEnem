/** app.js — roteador e telas. */

import { AREAS, NOME_AREA, carregarQuestoes, carregarCursos, carregarVocabulario } from './dados.js';
import { estimarTheta, estimarPorAcertos, faixaDeNota, atualizarTheta, thetaParaNota } from './tri.js';
import { calcularPrioridades, escolherArea, montarSessao, simularNotaSisu, THETA_ALVO } from './motor.js';
import * as srs from './srs.js';
import * as est from './estado.js';
import * as nuvem from './nuvem.js';
import * as ia from './ia.js';
import * as red from './redacao.js';
import { MODO_LOCAL, DOMINIO_PERMITIDO } from './config.js';

const $ = (s) => document.querySelector(s);
const SEGUNDOS_POR_QUESTAO = 180;

const escapar = (t) => String(t ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * O dataset guarda o enunciado em markdown: imagens, negrito e itálico.
 * Sem converter, 37% das questões mostram asteriscos crus na tela.
 * Escapa o HTML primeiro, depois converte — nada do texto original vira tag.
 */
function formatarTexto(texto) {
  return escapar(texto)
    // ![alt](url) — imagem, inclusive caminhos locais depois de localizar-imagens
    .replace(/!\[[^\]]*\]\(([^)\s]+)\)/g,
      (_, url) => `<img src="${url}" alt="Imagem da questão" loading="lazy" data-img-questao>`)
    // [texto](url) — link
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
      (_, rotulo, url) => `<a href="${url}" target="_blank" rel="noopener">${rotulo}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // Itálico só entre não-letras, para não pegar variável com subscrito.
    .replace(/(^|[^\w])_([^_\n]{1,80})_(?![\w])/g, '$1<em>$2</em>');
}

function formatarEnunciado(texto, imagens = []) {
  let html = formatarTexto(texto);
  for (const url of imagens) {
    if (!html.includes(url)) html += `<img src="${escapar(url)}" alt="Imagem da questão" loading="lazy">`;
  }
  return html;
}

let sessao = null;
let cursos = null;
let bancoVocabulario = null;
/** True quando o Firebase está configurado mas não carregou nesta sessão. */
let quedaParaLocal = false;

/**
 * Imagem que não carrega vira aviso legível em vez de ícone quebrado.
 * Enquanto as imagens vierem do enem.dev isso acontece com rede ruim; depois
 * de rodar scripts/localizar-imagens.mjs elas passam a ser locais.
 * Captura na fase de captura porque 'error' de <img> não borbulha.
 */
document.addEventListener('error', (ev) => {
  const el = ev.target;
  if (el.tagName !== 'IMG' || el.dataset.tratada) return;
  el.dataset.tratada = '1';
  const aviso = document.createElement('div');
  aviso.className = 'img-falhou';
  aviso.innerHTML = 'Não consegui carregar esta imagem.' +
    `<br><a href="${el.src}" target="_blank" rel="noopener">Abrir em outra aba</a>`;
  el.replaceWith(aviso);
}, true);

// ---------------------------------------------------------------- navegação

function ir(tela) {
  document.querySelectorAll('.tela').forEach((t) => t.classList.remove('ativa'));
  $(`#tela-${tela}`)?.classList.add('ativa');
  document.querySelectorAll('.nav button').forEach((b) =>
    b.classList.toggle('ativo', b.dataset.ir === tela));
  $('#nav').style.display = tela === 'entrar' ? 'none' : 'flex';
  window.scrollTo(0, 0);

  if (tela === 'painel') desenharPainel();
  if (tela === 'cartoes') desenharCartoes();
  if (tela === 'redacao') desenharRedacao();
  if (tela === 'plano') desenharPlano();
  if (tela === 'perfil') desenharPerfil();
  if (tela === 'sessao' && !sessao) desenharInicioSessao();
  if (tela !== 'sessao') document.documentElement.style.removeProperty('--alt-rodape');
}

document.querySelectorAll('.nav button').forEach((b) =>
  b.addEventListener('click', () => {
    if (b.dataset.ir === 'sessao' && sessao) return ir('sessao');
    if (b.dataset.ir === 'sessao') sessao = null;
    ir(b.dataset.ir);
  }));

// ---------------------------------------------------------------- entrar

function desenharEntrar() {
  const caixa = $('#entrar-opcoes');
  if (MODO_LOCAL || !nuvem.nuvemAtiva()) {
    caixa.innerHTML = `
      <button class="primario" id="btn-local">Começar a estudar</button>
      <p class="fraco" style="margin-top:14px">Modo local: seus dados ficam neste navegador.
      Exporte um backup de vez em quando pela tela de perfil.</p>
      ${!MODO_LOCAL ? '<p class="fraco">Não consegui falar com o servidor de login agora. Você pode estudar assim mesmo — quando a conexão voltar, entre com sua conta e o histórico sobe junto.</p>' : ''}`;
    $('#btn-local').onclick = async () => { await est.puxarDaNuvem('local'); abrirApp(); };
    return;
  }
  caixa.innerHTML = `
    <button class="primario" id="btn-google">Entrar com Google</button>
    <p class="fraco" style="margin-top:12px">${DOMINIO_PERMITIDO
      ? `Use seu e-mail <b>@${escapar(DOMINIO_PERMITIDO)}</b>, o mesmo do Classroom.
         Outras contas não têm acesso.`
      : 'Entrar cria sua conta automaticamente na primeira vez.'}</p>`;

  if (est.estado.uid) {
    caixa.insertAdjacentHTML('beforeend',
      `<button class="secundario" id="btn-voltar-local" style="margin-top:14px">Continuar sem entrar</button>`);
    $('#btn-voltar-local').onclick = () => abrirApp();
  }

  const erro = (e) => {
    const amigavel = {
      'auth/popup-closed-by-user': 'Você fechou a janela do Google antes de terminar.',
      'auth/operation-not-allowed': 'O login com Google não está ativado no Firebase (Authentication → Sign-in method).',
      'auth/popup-blocked': 'Seu navegador bloqueou a janela do Google. Libere pop-ups para este site.',
      'auth/unauthorized-domain': 'Este endereço não está autorizado no Firebase (Authentication → Settings → Authorized domains).',
      'auth/network-request-failed': 'Sem conexão com o servidor de login.',
    }[e.code];
    $('#entrar-erro').innerHTML = `<div class="erro-caixa">${escapar(amigavel || e.message)}</div>`;
  };
  $('#btn-google').onclick = () => nuvem.entrarComGoogle().catch(erro);
}

// ---------------------------------------------------------------- painel

function desenharPainel() {
  const e = est.estado;
  const ofensiva = est.ofensivaViva();
  const chama = $('#painel-ofensiva');
  chama.innerHTML = `<span>${ofensiva}</span> ${ofensiva === 1 ? 'dia' : 'dias'}`;
  chama.classList.toggle('apagada', ofensiva === 0);

  const curso = cursos?.cursos.find((c) => c.id === e.alvo.cursoId);
  $('#painel-curso').textContent = curso ? `${curso.curso} · ${curso.campus}` : 'Escolher curso';
  $('#painel-saudacao').textContent = e.nome ? `Olá, ${e.nome}` : 'Seu alvo';

  if (!e.alvo.pesos) {
    $('#painel-conteudo').innerHTML = `
      <div class="vazio">
        <h3>Escolha seu curso primeiro</h3>
        <p class="fraco">Os pesos do SiSU definem quanto cada área vale para você.</p>
        <button class="primario" onclick="document.querySelector('[data-ir=perfil]').click()">Escolher curso</button>
      </div>`;
    return;
  }

  const simulacao = simularNotaSisu(e.alvo.pesos, e.thetas, e.notaRedacao);
  const medidas = AREAS.filter((a) => e.thetas[a]);
  const meta = e.metaSemanal;

  let html = '';

  if (medidas.length) {
    const media = simulacao.media;
    const pos = Math.min(100, Math.max(0, (media / 1000) * 100));
    const erroMedio = medidas.reduce((s, a) => s + e.thetas[a].erroPadrao, 0) / medidas.length;
    const margem = Math.round(1.96 * erroMedio * 100);
    const confiavel = erroMedio <= 0.3;

    html += `
      <div class="escala">
        <svg class="curva" viewBox="0 0 200 74" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 68 C 60 66, 80 58, 100 37 C 120 16, 140 8, 200 6"/>
        </svg>
        <div class="escala-valor">
          <span class="n">${confiavel ? '' : '<span class="til">~</span>'}${media.toFixed(0)}</span>
          <span class="rotulo">média ponderada pelos pesos do curso</span>
        </div>
        <div class="trilho">
          <div class="trilho-base"></div>
          <div class="trilho-faixa" style="left:${Math.max(0, pos - margem / 10)}%;width:${Math.min(100, margem / 5)}%"></div>
          <div class="trilho-alvo" style="left:70%" title="700 pontos"></div>
          <div class="trilho-marca" style="left:${pos}%"></div>
        </div>
        <div class="trilho-legenda"><span>0</span><span>500</span><span>1000</span></div>
        <div class="aviso-precisao">
          ${confiavel
            ? `Estimativa estável, baseada em ${medidas.reduce((s, a) => s + e.thetas[a].itensUsados, 0)} questões.`
            : `Ainda impreciso: sua nota real está entre ${Math.round(media - margem)} e ${Math.round(media + margem)}. Faça mais sessões para estreitar a faixa.`}
          ${medidas.some((a) => e.thetas[a].aproximada) ? '<br>Cálculo aproximado: sem os parâmetros do INEP, o padrão de respostas não entra na conta.' : ''}
          ${simulacao.completa ? '' : '<br>Áreas sem medição ainda não entram na conta.'}
        </div>
      </div>`;
  } else {
    html += `<div class="cartao"><h3>Sem medição ainda</h3>
      <p class="fraco">Faça a primeira sessão para calcular sua proficiência.</p></div>`;
  }

  html += `<div class="cartao">
      <h3>Meta da semana</h3>
      <div class="barra"><i style="width:${Math.min(100, (meta.feitas / meta.sessoes) * 100)}%"></i></div>
      <div class="fraco">${meta.feitas} de ${meta.sessoes} sessões</div>
    </div>`;

  const vencidos = srs.vencidos(e.flashcards).length;
  if (vencidos) {
    html += `<div class="cartao"><h3>${vencidos} ${vencidos === 1 ? 'cartão vencido' : 'cartões vencidos'}</h3>
      <button class="secundario" onclick="document.querySelector('[data-ir=cartoes]').click()">Revisar agora</button></div>`;
  }

  html += `<button class="primario" id="btn-estudar">Começar sessão</button>`;
  $('#painel-conteudo').innerHTML = html;
  $('#btn-estudar').onclick = () => { sessao = null; ir('sessao'); };
}

// ---------------------------------------------------------------- sessão

/**
 * Antes a sessão era um corredor de mão única: respondeu, foi embora. Não dava
 * para voltar, pular nem revisar antes de entregar — que é justamente o que
 * se faz numa prova de verdade. Agora a sessão tem navegação livre.
 *
 * Isso obrigou a mudar o cronômetro. Tempo por questão e navegação livre não
 * combinam: se você volta numa questão, o relógio dela já correu. Por isso
 * existem dois modos, e a pessoa escolhe antes de começar.
 */

const TAMANHOS = [
  { n: 9, rotulo: '9 questões', nota: '3 fáceis, 3 médias, 3 difíceis' },
  { n: 20, rotulo: '20 questões', nota: 'treino mais longo' },
  { n: 45, rotulo: '45 questões', nota: 'uma prova inteira de uma área' },
];

function desenharInicioSessao() {
  const e = est.estado;
  if (!e.alvo.pesos) return ir('perfil');

  const prioridades = calcularPrioridades(e.alvo.pesos, e.thetas);
  const sugerida = prioridades[0].area;
  const pref = e.preferenciaSessao || {};
  const tamanho = pref.tamanho || 9;
  const modo = pref.modo || 'porQuestao';
  const area = pref.area || 'auto';

  $('#sessao-conteudo').innerHTML = `
    <h1>Nova sessão</h1>

    <div class="cartao">
      <h3>Área</h3>
      <div class="opcoes" id="op-area">
        <button class="opcao ${area === 'auto' ? 'ativa' : ''}" data-area="auto">
          <b>Deixar o plano escolher</b>
          <span>Hoje cairia ${NOME_AREA[sugerida]}, que é onde peso e lacuna se encontram</span>
        </button>
        ${AREAS.map((a) => `
          <button class="opcao ${area === a ? 'ativa' : ''}" data-area="${a}">
            <b>${NOME_AREA[a]}</b>
            <span>peso ${e.alvo.pesos[a] ?? 1}${e.thetas[a] ? ` · ${thetaParaNota(e.thetas[a].theta)} pontos hoje` : ' · sem medição'}</span>
          </button>`).join('')}
      </div>
    </div>

    <div class="cartao">
      <h3>Tamanho</h3>
      <div class="opcoes" id="op-tamanho">
        ${TAMANHOS.map((t) => `
          <button class="opcao ${tamanho === t.n ? 'ativa' : ''}" data-tamanho="${t.n}">
            <b>${t.rotulo}</b><span>${t.nota}</span>
          </button>`).join('')}
      </div>
    </div>

    <div class="cartao">
      <h3>Cronômetro</h3>
      <div class="opcoes" id="op-modo">
        <button class="opcao ${modo === 'porQuestao' ? 'ativa' : ''}" data-modo="porQuestao">
          <b>3 minutos por questão</b>
          <span>Treina velocidade. Estourou, ele avisa e segue contando.</span>
        </button>
        <button class="opcao ${modo === 'total' ? 'ativa' : ''}" data-modo="total">
          <b>Tempo total corrido</b>
          <span>Como na prova: você distribui os minutos entre as questões.</span>
        </button>
        <button class="opcao ${modo === 'livre' ? 'ativa' : ''}" data-modo="livre">
          <b>Sem cronômetro</b><span>Para estudar sem pressão.</span>
        </button>
      </div>
    </div>

    <button class="primario" id="btn-comecar">Começar</button>
    <p class="fraco centro" style="margin-top:10px">Dá para voltar, pular e revisar antes de entregar.</p>`;

  const escolher = (seletor, atributo, campo) => {
    document.querySelectorAll(`${seletor} .opcao`).forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll(`${seletor} .opcao`).forEach((x) => x.classList.remove('ativa'));
        b.classList.add('ativa');
        e.preferenciaSessao = { ...(e.preferenciaSessao || {}), [campo]: b.dataset[atributo] };
        if (campo === 'tamanho') e.preferenciaSessao.tamanho = Number(b.dataset.tamanho);
        est.salvarLocal();
      };
    });
  };
  escolher('#op-area', 'area', 'area');
  escolher('#op-tamanho', 'tamanho', 'tamanho');
  escolher('#op-modo', 'modo', 'modo');

  $('#btn-comecar').onclick = () => montarEIniciar();
}

async function montarEIniciar() {
  const e = est.estado;
  const pref = e.preferenciaSessao || {};
  const tamanho = pref.tamanho || 9;
  const modo = pref.modo || 'porQuestao';

  $('#sessao-conteudo').innerHTML = '<div class="carregando">Montando sua sessão</div>';

  const prioridades = calcularPrioridades(e.alvo.pesos, e.thetas);
  const area = (!pref.area || pref.area === 'auto') ? escolherArea(prioridades) : pref.area;

  let questoes;
  try {
    questoes = await carregarQuestoes(area);
    if (!bancoVocabulario) bancoVocabulario = await carregarVocabulario();
  } catch (err) {
    $('#sessao-conteudo').innerHTML = `
      <div class="erro-caixa">${escapar(err.message)}</div>
      <p class="fraco">Confira se a pasta <code>dados/</code> foi enviada junto com o site.</p>
      <button class="primario" onclick="location.reload()">Tentar de novo</button>`;
    return;
  }

  const theta = e.thetas[area]?.theta ?? 0;
  const porFaixa = Math.max(1, Math.round(tamanho / 3));
  const { questoes: escolhidas, calibrada } =
    montarSessao(questoes, theta, e.questoesVistas[area], porFaixa);

  sessao = {
    id: `s-${Date.now()}`,
    area, calibrada, modo,
    questoes: escolhidas.slice(0, tamanho),
    indice: 0,
    // Respostas por posição: dá para voltar e trocar sem bagunçar a ordem.
    respostas: new Array(Math.min(tamanho, escolhidas.length)).fill(null),
    paraRever: new Set(),
    vocabulario: srs.proximoVocabulario(bancoVocabulario, e.vocabulario),
    respostaVocabulario: null,
    naVocabulario: false,
    inicio: Date.now(),
    segundosTotais: modo === 'total' ? escolhidas.slice(0, tamanho).length * SEGUNDOS_POR_QUESTAO : null,
    gastoPorQuestao: new Array(Math.min(tamanho, escolhidas.length)).fill(0),
    entradaQuestao: Date.now(),
  };
  desenharQuestao();
}

let cronometro = null;

function formatarRelogio(segundos) {
  const negativo = segundos < 0;
  const s = Math.abs(Math.round(segundos));
  const texto = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return negativo ? `+${texto}` : texto;
}

/** Grade com o número de cada questão: estado de cada uma e atalho para pular. */
function grade() {
  const s = sessao;
  return `<div class="grade" id="grade">
    ${s.questoes.map((_, i) => {
      const classes = [
        i === s.indice && !s.naVocabulario ? 'atual' : '',
        s.respostas[i] ? 'feita' : '',
        s.paraRever.has(i) ? 'rever' : '',
      ].filter(Boolean).join(' ');
      return `<button class="celula ${classes}" data-ir-questao="${i}"
        aria-label="Questão ${i + 1}${s.respostas[i] ? ', respondida' : ''}">${i + 1}</button>`;
    }).join('')}
    <button class="celula ${s.naVocabulario ? 'atual' : ''} ${s.respostaVocabulario ? 'feita' : ''}"
      data-ir-questao="vocab" aria-label="Vocabulário">V</button>
  </div>`;
}

function cabecalhoSessao() {
  const s = sessao;
  const respondidas = s.respostas.filter(Boolean).length;
  let relogio = '';
  if (s.modo === 'porQuestao') relogio = `<span class="cronometro" id="cron">3:00</span>`;
  else if (s.modo === 'total') relogio = `<span class="cronometro" id="cron">—</span>`;
  else relogio = `<span class="fraco">sem cronômetro</span>`;

  return `<div class="sessao-topo">
    <div class="sessao-info">
      <span class="area">${NOME_AREA[s.area]}</span>
      <span class="contador">${respondidas} de ${s.questoes.length} respondidas</span>
      ${relogio}
    </div>
    ${s.modo === 'livre' ? '' : '<div class="barra tempo"><i id="barra-tempo" style="width:100%"></i></div>'}
    ${grade()}
  </div>`;
}

function ligarGrade() {
  document.querySelectorAll('[data-ir-questao]').forEach((b) => {
    b.onclick = () => {
      registrarTempoDaQuestao();
      const alvo = b.dataset.irQuestao;
      if (alvo === 'vocab') { sessao.naVocabulario = true; desenharVocabulario(); }
      else { sessao.naVocabulario = false; sessao.indice = Number(alvo); desenharQuestao(); }
    };
  });
}

function registrarTempoDaQuestao() {
  const s = sessao;
  if (!s || s.naVocabulario) return;
  const gasto = (Date.now() - s.entradaQuestao) / 1000;
  s.gastoPorQuestao[s.indice] = (s.gastoPorQuestao[s.indice] || 0) + gasto;
  s.entradaQuestao = Date.now();
}

function desenharQuestao() {
  clearInterval(cronometro);
  const s = sessao;
  s.naVocabulario = false;
  s.entradaQuestao = Date.now();

  const q = s.questoes[s.indice];
  const jaMarcada = s.respostas[s.indice]?.marcada || null;
  const primeira = s.indice === 0;
  const ultima = s.indice === s.questoes.length - 1;

  $('#sessao-conteudo').innerHTML = `
    ${cabecalhoSessao()}
    ${s.calibrada || s.indice > 0 ? '' : '<p class="fraco aviso-calibracao">Dificuldade ainda não calibrada — veja o README para importar os parâmetros do INEP.</p>'}
    <div class="enunciado">${formatarEnunciado(q.enunciado, q.imagens)}</div>
    <div id="alternativas">
      ${q.alternativas.map((a) => `
        <button class="alternativa ${jaMarcada === a.letra ? 'marcada' : ''}" data-letra="${escapar(a.letra)}">
          <span class="letra">${escapar(a.letra)}</span>
          <span>${a.imagem ? `<img src="${escapar(a.imagem)}" alt="Alternativa ${escapar(a.letra)}" loading="lazy">` : formatarTexto(a.texto)}</span>
        </button>`).join('')}
    </div>
    <div class="rodape-sessao">
      <div class="linha-botoes">
        <button class="secundario" id="btn-anterior" ${primeira ? 'disabled' : ''}>Anterior</button>
        <button class="secundario ${s.paraRever.has(s.indice) ? 'primario' : ''}" id="btn-rever">
          ${s.paraRever.has(s.indice) ? 'Marcada' : 'Rever depois'}</button>
        <button class="primario" id="btn-proxima">${ultima ? 'Vocabulário' : 'Próxima'}</button>
      </div>
      <button class="secundario" id="btn-entregar" style="margin-top:10px">Entregar sessão</button>
    </div>`;

  document.querySelectorAll('.alternativa').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.alternativa').forEach((x) => x.classList.remove('marcada'));
      b.classList.add('marcada');
      s.respostas[s.indice] = { marcada: b.dataset.letra, acertou: b.dataset.letra === q.gabarito };
      atualizarGrade();
    };
  });

  ligarGrade();
  $('#btn-anterior').onclick = () => { registrarTempoDaQuestao(); s.indice--; desenharQuestao(); };
  $('#btn-proxima').onclick = () => {
    registrarTempoDaQuestao();
    if (ultima) { s.naVocabulario = true; desenharVocabulario(); }
    else { s.indice++; desenharQuestao(); }
  };
  $('#btn-rever').onclick = () => {
    if (s.paraRever.has(s.indice)) s.paraRever.delete(s.indice);
    else s.paraRever.add(s.indice);
    desenharQuestao();
  };
  $('#btn-entregar').onclick = () => tentarEntregar();

  iniciarCronometro();
  requestAnimationFrame(medirRodape);
}

function atualizarGrade() {
  const alvo = $('#grade');
  if (!alvo) return;
  alvo.outerHTML = grade();
  ligarGrade();
  const contador = document.querySelector('.contador');
  if (contador) {
    contador.textContent = `${sessao.respostas.filter(Boolean).length} de ${sessao.questoes.length} respondidas`;
  }
}

function iniciarCronometro() {
  clearInterval(cronometro);
  const s = sessao;
  if (s.modo === 'livre') return;

  const tick = () => {
    const el = $('#cron');
    if (!el) return clearInterval(cronometro);
    let restante, fracao;

    if (s.modo === 'total') {
      const gasto = (Date.now() - s.inicio) / 1000;
      restante = s.segundosTotais - gasto;
      fracao = Math.max(0, restante / s.segundosTotais);
    } else {
      const gasto = (s.gastoPorQuestao[s.indice] || 0) + (Date.now() - s.entradaQuestao) / 1000;
      restante = SEGUNDOS_POR_QUESTAO - gasto;
      fracao = Math.max(0, restante / SEGUNDOS_POR_QUESTAO);
    }

    el.textContent = formatarRelogio(restante);
    el.classList.toggle('urgente', restante <= 30);
    // Estourar o tempo não interrompe nem entrega sozinho: ele passa a contar
    // para cima, e você vê quanto passou. Interromper no meio de uma conta
    // seria punir sem ensinar nada.
    el.classList.toggle('estourado', restante < 0);
    const barra = $('#barra-tempo');
    if (barra) barra.style.width = `${fracao * 100}%`;
  };

  tick();
  cronometro = setInterval(tick, 1000);
}

function desenharVocabulario() {
  clearInterval(cronometro);
  const s = sessao;
  s.naVocabulario = true;
  const item = s.vocabulario;
  const rotulo = { conectivo: 'Conectivo', repertorio: 'Repertório', formal: 'Vocabulário formal' }[item.tipo];
  const escolhida = s.respostaVocabulario?.escolha || null;

  $('#sessao-conteudo').innerHTML = `
    ${cabecalhoSessao()}
    <h2 style="margin-top:0">${rotulo}</h2>
    <div class="enunciado">${escapar(item.pergunta)}</div>
    <div id="alternativas">
      ${item.alternativas.map((a, i) => `
        <button class="alternativa ${escolhida === a ? 'marcada' : ''}" data-i="${i}">
          <span class="letra">${'ABCD'[i]}</span><span>${escapar(a)}</span>
        </button>`).join('')}
    </div>
    <div class="rodape-sessao">
      <div class="linha-botoes">
        <button class="secundario" id="btn-voltar-q">Voltar às questões</button>
        <button class="primario" id="btn-entregar">Entregar sessão</button>
      </div>
      <p class="fraco centro" style="margin-top:10px">Responder é obrigatório. Acertar, não — o item volta depois.</p>
    </div>`;

  document.querySelectorAll('.alternativa').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.alternativa').forEach((x) => x.classList.remove('marcada'));
      b.classList.add('marcada');
      const escolha = item.alternativas[Number(b.dataset.i)];
      s.respostaVocabulario = { item, escolha, acertou: escolha === item.correta };
      atualizarGrade();
    };
  });

  ligarGrade();
  $('#btn-voltar-q').onclick = () => { s.naVocabulario = false; desenharQuestao(); };
  $('#btn-entregar').onclick = () => tentarEntregar();
  if (s.modo === 'total') iniciarCronometro();
  requestAnimationFrame(medirRodape);
}

/** Entregar com questões em branco é permitido, mas nunca por engano. */
function tentarEntregar() {
  registrarTempoDaQuestao();
  const s = sessao;
  const vazias = s.respostas.reduce((lista, r, i) => (r ? lista : [...lista, i + 1]), []);
  const semVocabulario = !s.respostaVocabulario;

  if (!vazias.length && !semVocabulario) return finalizarSessao();

  const partes = [];
  if (vazias.length) {
    partes.push(`${vazias.length === 1 ? 'A questão' : 'As questões'} ${vazias.join(', ')} ${vazias.length === 1 ? 'está' : 'estão'} em branco`);
  }
  if (semVocabulario) partes.push('o item de vocabulário não foi respondido');

  $('#sessao-conteudo').insertAdjacentHTML('afterbegin', `
    <div class="cartao" id="confirmar-entrega" style="border-color:var(--ambar)">
      <h3>Entregar assim?</h3>
      <p class="fraco">${escapar(partes.join(' e '))}. Em branco conta como erro no
      cálculo da proficiência — que é o mesmo que acontece na prova.</p>
      <div class="linha-botoes">
        <button class="secundario" id="btn-cancelar-entrega">Voltar e responder</button>
        <button class="primario" id="btn-entregar-mesmo">Entregar assim</button>
      </div>
    </div>`);
  $('#confirmar-entrega').scrollIntoView({ behavior: 'smooth', block: 'center' });
  $('#btn-cancelar-entrega').onclick = () => {
    $('#confirmar-entrega').remove();
    if (vazias.length) { sessao.indice = vazias[0] - 1; sessao.naVocabulario = false; desenharQuestao(); }
  };
  $('#btn-entregar-mesmo').onclick = () => finalizarSessao();
}

// ---------------------------------------------------------------- resultado

async function finalizarSessao() {
  clearInterval(cronometro);
  const s = sessao;
  const e = est.estado;

  // Normaliza: posição em branco vira resposta errada, como na prova.
  s.respostas = s.questoes.map((q, i) => ({
    questao: q,
    marcada: s.respostas[i]?.marcada || null,
    acertou: !!s.respostas[i]?.acertou,
    segundos: Math.round(s.gastoPorQuestao[i] || 0),
    emBranco: !s.respostas[i],
  }));

  const acertos = s.respostas.filter((r) => r.acertou).length;

  // Proficiência: TRI de verdade quando há parâmetros, aproximação quando não.
  let estimativa = estimarTheta(s.respostas.map((r) => ({ tri: r.questao.tri, acertou: r.acertou })));
  if (!estimativa) estimativa = estimarPorAcertos(acertos, s.respostas.length);
  if (estimativa) {
    const anterior = e.thetas[s.area];
    e.thetas[s.area] = atualizarTheta(anterior, estimativa);
    // Basta uma sessão aproximada para a área inteira ficar marcada assim.
    e.thetas[s.area].aproximada = estimativa.aproximada || anterior?.aproximada || false;
  }

  // Vocabulário
  const rv = s.respostaVocabulario;
  e.vocabulario[rv.item.id] = srs.atualizarVocabulario(e.vocabulario[rv.item.id] || {}, rv.acertou);

  est.marcarVistas(s.area, s.respostas.map((r) => r.questao.id));
  e.sessoes.push({ id: s.id, data: new Date().toISOString(), area: s.area, acertos, total: s.respostas.length });
  e.sessoes = e.sessoes.slice(-120);
  est.registrarDiaEstudado();
  est.salvarLocal();
  est.sincronizar();
  nuvem.salvarSessao(e.uid, { id: s.id, area: s.area, acertos, data: new Date().toISOString() })
    .catch(() => {});

  ir('resultado');
  desenharResultado(acertos, estimativa);
}

function desenharResultado(acertos, estimativa) {
  const s = sessao;
  const e = est.estado;
  const faixa = faixaDeNota(e.thetas[s.area]);
  const erros = s.respostas.filter((r) => !r.acertou);
  const rv = s.respostaVocabulario;
  const tempoTotal = s.respostas.reduce((t, r) => t + r.segundos, 0);

  let html = `
    <h1>Sessão concluída</h1>
    <div class="placar">
      <div><span class="n">${acertos}/${s.respostas.length}</span><span class="r">acertos</span></div>
      <div><span class="n">${faixa ? faixa.nota : '—'}</span><span class="r">${NOME_AREA[s.area]}</span></div>
      <div><span class="n">${Math.round(tempoTotal / 60)}min</span><span class="r">de prova</span></div>
    </div>`;

  if (faixa && !faixa.confiavel) {
    html += `<p class="fraco">Nota estimada entre ${faixa.minima} e ${faixa.maxima}. A faixa aperta conforme você acumula sessões.</p>`;
  }
  if (estimativa?.aproximada) {
    html += `<p class="fraco">Estimativa aproximada, por proporção de acertos. Importe os parâmetros do INEP (veja o README) para o cálculo por TRI, que leva em conta quais questões você errou.</p>`;
  }

  html += `<div class="cartao">
      <h3>${rv.acertou ? 'Vocabulário: acertou' : 'Vocabulário: errou'}</h3>
      <p style="margin:0">${escapar(rv.item.pergunta)}</p>
      <p style="margin:8px 0 0"><b>${escapar(rv.item.correta)}</b></p>
      <p class="fraco" style="margin:8px 0 0">${escapar(rv.item.explicacao)}</p>
      ${rv.acertou ? '' : '<p class="fraco" style="margin:8px 0 0">Esse item volta na próxima sessão.</p>'}
    </div>`;

  if (erros.length) {
    html += `<div class="trava" id="trava">Leia as ${erros.length} ${erros.length === 1 ? 'explicação' : 'explicações'} e escolha o conceito que falhou. O botão libera quando terminar.</div>`;
    html += `<h2>O que deu errado</h2><div id="erros"></div>`;
  } else {
    html += `<div class="cartao"><h3>Sessão limpa</h3><p class="fraco" style="margin:0">Nenhum erro para revisar.</p></div>`;
  }

  html += `<button class="primario" id="btn-concluir" ${erros.length ? 'disabled' : ''}>Voltar ao painel</button>`;
  $('#resultado-conteudo').innerHTML = html;

  $('#btn-concluir').onclick = () => { sessao = null; ir('painel'); };

  if (erros.length) carregarExplicacoes(erros);
}

async function carregarExplicacoes(erros) {
  const alvo = $('#erros');
  alvo.innerHTML = erros.map((r, i) => `
    <div class="revisao" data-i="${i}">
      <b>${NOME_AREA[r.questao.area]} ${r.questao.ano}, questão ${r.questao.numero}</b>
      <div class="fraco">Você marcou ${escapar(r.marcada || '—')} · gabarito ${escapar(r.questao.gabarito)}</div>
      <div class="explicacao" id="exp-${i}">${ia.iaDisponivel() ? 'Carregando explicação…' : ''}</div>
    </div>`).join('');

  let resultado;
  try {
    resultado = await ia.explicarErros(erros, sessao.area);
  } catch (err) {
    resultado = { explicacoes: [], flashcards: [], aviso: err.message };
  }

  erros.forEach((r, i) => {
    const caixa = $(`#exp-${i}`);
    const achada = resultado.explicacoes?.find((x) => x.id === r.questao.id);
    caixa.innerHTML = achada
      ? escapar(achada.texto)
      : `<span class="fraco">${escapar(resultado.aviso || 'Sem explicação automática. A alternativa correta é ' + r.questao.gabarito + '.')}</span>`;

    const conceitos = achada?.conceitos?.length ? achada.conceitos : ['Revisar esta questão'];
    const botoes = document.createElement('div');
    botoes.style.marginTop = '10px';
    botoes.innerHTML = `<div class="fraco" style="margin-bottom:6px">Qual conceito você precisa revisar?</div>` +
      conceitos.map((c, j) => `<button class="secundario conceito" data-e="${i}" data-c="${j}" style="margin-bottom:6px">${escapar(c)}</button>`).join('');
    caixa.after(botoes);

    botoes.querySelectorAll('.conceito').forEach((b) => {
      b.onclick = () => {
        botoes.querySelectorAll('.conceito').forEach((x) => { x.disabled = true; x.classList.remove('primario'); });
        b.classList.add('primario');
        const conceito = conceitos[Number(b.dataset.c)];
        const pronto = resultado.flashcards?.find((f) => f.conceito === conceito);
        est.estado.flashcards.push(srs.novoCartao({
          id: `f-${Date.now()}-${i}`,
          frente: pronto?.frente || `${conceito} — o que você precisa lembrar?`,
          verso: pronto?.verso || achada?.texto?.slice(0, 400) || `Revise a questão ${r.questao.numero} de ${r.questao.ano}.`,
          conceito,
          origemQuestaoId: r.questao.id,
        }));
        est.salvarLocal();
        verificarLiberacao(erros.length);
      };
    });
  });
}

function verificarLiberacao(totalErros) {
  const marcados = document.querySelectorAll('.conceito.primario').length;
  if (marcados >= totalErros) {
    $('#btn-concluir').disabled = false;
    $('#trava').textContent = `${totalErros} ${totalErros === 1 ? 'cartão criado' : 'cartões criados'}. Eles voltam na revisão.`;
    est.sincronizar();
  } else {
    $('#trava').textContent = `Faltam ${totalErros - marcados} de ${totalErros}.`;
  }
}

// ---------------------------------------------------------------- flashcards

let cartaoAtual = null;
let abaRevisao = 'cartoes';

function desenharCartoes() {
  const alvo = $('#cartoes-conteudo');
  const pendentes = srs.vencidos(est.estado.flashcards);

  alvo.innerHTML = `
    <div class="abas" id="abas-revisao">
      <button class="${abaRevisao === 'cartoes' ? 'ativa' : ''}" data-aba="cartoes">
        Cartões${pendentes.length ? ` <i>${pendentes.length}</i>` : ''}
      </button>
      <button class="${abaRevisao === 'resumos' ? 'ativa' : ''}" data-aba="resumos">
        Resumos${est.estado.resumos?.length ? ` <i>${est.estado.resumos.length}</i>` : ''}
      </button>
    </div>
    <div id="revisao-corpo"></div>`;

  document.querySelectorAll('#abas-revisao button').forEach((b) => {
    b.onclick = () => { abaRevisao = b.dataset.aba; desenharCartoes(); };
  });

  if (abaRevisao === 'resumos') return desenharResumos();
  desenharFilaCartoes(pendentes);
}

function desenharFilaCartoes(pendentes) {
  const corpo = $('#revisao-corpo');

  if (!pendentes.length) {
    corpo.innerHTML = `<div class="vazio">
      <h3>Nada para revisar hoje</h3>
      <p>Os cartões nascem dos seus erros. Faça uma sessão e eles aparecem aqui.</p>
      <p class="fraco">${est.estado.flashcards.length} ${est.estado.flashcards.length === 1 ? 'cartão no total' : 'cartões no total'}</p>
    </div>`;
    return;
  }

  cartaoAtual = pendentes[0];
  corpo.innerHTML = `
    <p class="fraco">${pendentes.length} ${pendentes.length === 1 ? 'cartão' : 'cartões'} na fila</p>
    <div class="flash">
      <div class="frente">${escapar(cartaoAtual.frente)}</div>
      <div class="verso" id="verso" hidden>${escapar(cartaoAtual.verso)}</div>
    </div>
    <button class="primario" id="btn-virar">Mostrar resposta</button>
    <div class="notas" id="notas" hidden>
      <button data-q="0">Errei</button>
      <button data-q="1">Difícil</button>
      <button data-q="2">Acertei</button>
      <button data-q="3">Fácil</button>
    </div>`;

  $('#btn-virar').onclick = () => {
    $('#verso').hidden = false;
    $('#btn-virar').hidden = true;
    $('#notas').hidden = false;
  };

  document.querySelectorAll('#notas button').forEach((b) => {
    b.onclick = () => {
      const i = est.estado.flashcards.findIndex((c) => c.id === cartaoAtual.id);
      est.estado.flashcards[i] = srs.revisar(cartaoAtual, Number(b.dataset.q));
      est.salvarLocal();
      est.sincronizar();
      desenharCartoes();
    };
  });
}

// ---------------------------------------------------------------- resumos

/**
 * O resumo é gerado uma vez e guardado. Dois motivos: cada geração custa
 * créditos, e resumo guardado abre offline — que é quando você mais precisa.
 */
function desenharResumos() {
  const e = est.estado;
  const corpo = $('#revisao-corpo');
  const lista = e.resumos || [];

  // Sugere o tema pela área mais atrasada, para não começar em branco.
  const prioridades = e.alvo.pesos ? calcularPrioridades(e.alvo.pesos, e.thetas) : [];
  const areaSugerida = prioridades[0]?.area || 'matematica';

  corpo.innerHTML = `
    <div class="cartao">
      <h3>Novo resumo</h3>
      ${ia.iaDisponivel()
        ? `<p class="fraco">Escreva o assunto que você quer revisar. O resumo vem focado no que cai na prova e fica guardado para ler offline.</p>`
        : `<p class="fraco">A IA está desligada. Preencha <code>URL_WORKER</code> em <code>js/config.js</code> depois de publicar o Worker — o passo a passo está no README.</p>`}
      <label for="in-tema">Assunto</label>
      <input id="in-tema" type="text" maxlength="120" placeholder="Ex.: função exponencial, Revolução Industrial"
        ${ia.iaDisponivel() ? '' : 'disabled'}>
      <label for="sel-area-resumo">Área</label>
      <select id="sel-area-resumo" ${ia.iaDisponivel() ? '' : 'disabled'}>
        ${AREAS.map((a) => `<option value="${a}" ${a === areaSugerida ? 'selected' : ''}>${NOME_AREA[a]}</option>`).join('')}
      </select>
      <button class="primario" id="btn-resumir" style="margin-top:14px" ${ia.iaDisponivel() ? '' : 'disabled'}>Gerar resumo</button>
      <div id="resumo-aviso"></div>
    </div>

    ${lista.length ? lista.map((r) => `
      <div class="cartao resumo" data-id="${escapar(r.id)}">
        <h3>${escapar(r.tema)}</h3>
        <p class="fraco" style="margin-bottom:10px">${NOME_AREA[r.area] || ''} · ${escapar(r.data)}</p>
        <div class="resumo-texto">${formatarTexto(r.texto)}</div>
        <button class="secundario apagar-resumo" data-id="${escapar(r.id)}" style="margin-top:12px">Apagar</button>
      </div>`).join('')
      : '<div class="vazio"><h3>Nenhum resumo ainda</h3><p>Gere um acima e ele fica guardado aqui.</p></div>'}`;

  document.querySelectorAll('.apagar-resumo').forEach((b) => {
    b.onclick = () => {
      e.resumos = (e.resumos || []).filter((r) => r.id !== b.dataset.id);
      est.salvarLocal(); est.sincronizar(); desenharResumos();
    };
  });

  const botao = $('#btn-resumir');
  if (!botao || botao.disabled) return;

  botao.onclick = async () => {
    const tema = $('#in-tema').value.trim();
    const area = $('#sel-area-resumo').value;
    const aviso = $('#resumo-aviso');

    if (tema.length < 3) {
      aviso.innerHTML = '<div class="erro-caixa">Escreva o assunto que você quer revisar.</div>';
      return;
    }

    botao.disabled = true;
    botao.textContent = 'Escrevendo…';
    aviso.innerHTML = '';

    try {
      const texto = await ia.gerarResumo(tema, NOME_AREA[area]);
      e.resumos = [{
        id: `r-${Date.now()}`,
        tema, area, texto,
        data: new Date().toLocaleDateString('pt-BR'),
      }, ...(e.resumos || [])].slice(0, 60);
      est.salvarLocal();
      est.sincronizar();
      desenharResumos();
    } catch (erro) {
      botao.disabled = false;
      botao.textContent = 'Gerar resumo';
      aviso.innerHTML = `<div class="erro-caixa">${escapar(erro.message)}</div>`;
    }
  };
}

// ---------------------------------------------------------------- redação

const MINUTOS_PADRAO = 60;

function desenharRedacao() {
  const e = est.estado;
  const notas = e.redacao?.competencias || {};
  const total = red.somarCompetencias(notas);
  const preenchidas = red.COMPETENCIAS.filter((c) => notas[c.id] !== undefined && notas[c.id] !== '').length;
  const fraca = red.competenciaMaisFraca(notas);
  const minutos = e.redacao?.minutos || MINUTOS_PADRAO;
  const tempos = e.redacao?.tempos || [];

  $('#redacao-conteudo').innerHTML = `
    <div class="cartao">
      <h3>Nota da sua última redação</h3>
      <p class="fraco">Cada competência vale de 0 a 200. Registre a nota que você
      recebeu no Redação Paraná ou num simulado.</p>
      <div id="competencias">
        ${red.COMPETENCIAS.map((c, i) => `
          <div class="competencia">
            <label for="nota-${c.id}">C${i + 1} · ${escapar(c.nome)}
              <span class="fraco" style="display:block;font-size:12px">${escapar(c.dica)}</span></label>
            <input id="nota-${c.id}" type="number" inputmode="numeric" min="0" max="200" step="20"
              data-comp="${c.id}" value="${notas[c.id] ?? ''}" placeholder="0–200">
          </div>`).join('')}
      </div>
      <div class="total-redacao">
        <span>Total</span>
        <b class="numero" id="total-redacao">${total}</b>
      </div>
      <p class="fraco" id="aviso-branco">${preenchidas < 5 ? `${5 - preenchidas} competência(s) em branco — o total ainda não fecha.` : ''}</p>
      <p class="fraco" id="aviso-fraca">${fraca ? `Mais fraca agora: <b>${escapar(fraca.nome)}</b>. ${escapar(fraca.dica)}` : ''}</p>
      <a class="botao secundario" href="https://redacaoparana.pr.gov.br/" target="_blank" rel="noopener"
         style="margin-top:12px">Abrir o Redação Paraná</a>
    </div>

    <div class="cartao">
      <h3>Cronômetro de escrita</h3>
      <p class="fraco">Abre numa janelinha que fica por cima das outras, para você
      acompanhar o tempo enquanto escreve no Redação Paraná. Passando do limite ele
      não trava: continua contando quanto você excedeu.</p>
      <label for="sel-minutos">Tempo alvo</label>
      <select id="sel-minutos">
        ${[30, 45, 60, 90].map((m) => `<option value="${m}" ${m === minutos ? 'selected' : ''}>${m} minutos</option>`).join('')}
      </select>
      <button class="primario" id="btn-relogio" style="margin-top:12px">Abrir cronômetro</button>
      <div id="relogio-embutido"></div>
      <div id="relogio-aviso" class="fraco"></div>
      ${tempos.length ? `<p class="fraco" style="margin-top:12px">Últimas: ${tempos.slice(-5).map((t) =>
        `${Math.round(t.segundos / 60)}min${t.excedente ? ` (+${Math.round(t.excedente / 60)})` : ''}`).join(' · ')}</p>` : ''}
    </div>

    <div class="cartao em-breve">
      <h3>Em breve</h3>
      <ul class="fraco">
        <li>Correção por IA das cinco competências</li>
        <li>Banco de temas com propostas e textos de apoio</li>
        <li>Repertório sugerido a partir da competência mais fraca</li>
        <li>Comparação da sua evolução competência a competência</li>
      </ul>
    </div>`;

  /**
   * Atualiza só o que deriva das notas. Redesenhar a aba inteira aqui
   * destruía o campo em que a pessoa estava digitando: ao pular de C1 para
   * C2, o blur de C1 recriava o DOM e o que já tinha sido digitado em C2
   * se perdia. Trocar o texto de três elementos resolve sem tocar nos inputs.
   */
  const atualizarDerivados = () => {
    const atuais = e.redacao.competencias;
    const novoTotal = red.somarCompetencias(atuais);
    $('#total-redacao').textContent = novoTotal;

    const faltam = red.COMPETENCIAS.filter((c) => atuais[c.id] === undefined).length;
    $('#aviso-branco').textContent = faltam
      ? `${faltam} competência${faltam > 1 ? 's' : ''} em branco — o total ainda não fecha.`
      : '';

    const pior = red.competenciaMaisFraca(atuais);
    $('#aviso-fraca').innerHTML = pior
      ? `Mais fraca agora: <b>${escapar(pior.nome)}</b>. ${escapar(pior.dica)}`
      : '';
  };

  document.querySelectorAll('[data-comp]').forEach((campo) => {
    campo.oninput = () => {
      const bruto = campo.value;
      if (bruto === '') delete e.redacao.competencias[campo.dataset.comp];
      else {
        const v = Math.min(red.MAXIMO_POR_COMPETENCIA, Math.max(0, Number(bruto) || 0));
        e.redacao.competencias[campo.dataset.comp] = v;
      }
      // O total alimenta a média ponderada do SiSU.
      e.notaRedacao = red.somarCompetencias(e.redacao.competencias) || null;
      e.redacao.ultimaAtualizacao = new Date().toISOString();
      atualizarDerivados();
      est.salvarLocal();
    };
    campo.onblur = () => {
      // Corrige valor fora da faixa só ao sair do campo, para não atrapalhar
      // quem está digitando "20" a caminho de "200".
      if (campo.value !== '') {
        const v = Math.min(red.MAXIMO_POR_COMPETENCIA, Math.max(0, Number(campo.value) || 0));
        campo.value = v;
        e.redacao.competencias[campo.dataset.comp] = v;
        atualizarDerivados();
        est.salvarLocal();
      }
      est.sincronizar();
    };
  });

  $('#sel-minutos').onchange = (ev) => {
    e.redacao.minutos = Number(ev.target.value);
    est.salvarLocal();
  };

  $('#btn-relogio').onclick = async () => {
    const aviso = $('#relogio-aviso');
    try {
      const onde = await red.abrirRelogio(
        Number($('#sel-minutos').value),
        (resultado) => {
          e.redacao.tempos = [...(e.redacao.tempos || []), { ...resultado, data: new Date().toISOString() }].slice(-20);
          est.salvarLocal();
          est.sincronizar();
        },
        $('#relogio-embutido')
      );
      aviso.textContent = {
        flutuante: 'Cronômetro aberto numa janela que fica por cima das outras.',
        popup: 'Seu navegador não tem a janela flutuante; abri numa janela comum. Deixe ela ao lado da aba do Redação Paraná.',
        embutido: 'Não consegui abrir janela separada (pop-up bloqueado?). O cronômetro ficou aqui nesta tela.',
      }[onde];
    } catch (err) {
      aviso.innerHTML = `<span class="erro-caixa" style="display:block">${escapar(err.message)}</span>`;
    }
  };
}

// ---------------------------------------------------------------- plano

function desenharPlano() {
  const e = est.estado;
  if (!e.alvo.pesos) { $('#plano-conteudo').innerHTML = '<p class="fraco">Escolha seu curso no perfil.</p>'; return; }

  const prioridades = calcularPrioridades(e.alvo.pesos, e.thetas);

  let html = `<div class="cartao">
    <h3>Divisão do seu tempo</h3>
    <p class="fraco" style="margin-bottom:14px">Peso do curso multiplicado pelo quanto falta até 700. Área com peso alto onde você já vai bem rende menos, e desce sozinha.</p>`;

  for (const p of prioridades) {
    const nota = e.thetas[p.area] ? thetaParaNota(e.thetas[p.area].theta) : null;
    html += `<div class="linha-area">
      <div class="rotulo">
        <b>${NOME_AREA[p.area]}<span class="peso">peso ${p.peso}</span></b>
        <div class="barra"><i style="width:${p.percentual}%"></i></div>
        <span class="fraco">${nota ? `${nota} pontos hoje` : 'sem medição'}</span>
      </div>
      <div class="pct numero">${p.percentual}%</div>
    </div>`;
  }
  html += '</div>';

  const simulacao = simularNotaSisu(e.alvo.pesos, e.thetas, e.notaRedacao);
  if (simulacao) {
    html += `<div class="cartao"><h3>Simulação do SiSU</h3>
      ${simulacao.detalhe.map((d) => `<div class="linha-area">
        <div class="rotulo"><b>${NOME_AREA[d.area]}</b><span class="fraco">peso ${d.peso}</span></div>
        <div class="pct numero">${d.nota}</div></div>`).join('')}
      <div class="linha-area"><div class="rotulo"><b>Média ponderada</b></div>
        <div class="pct numero">${simulacao.media.toFixed(2)}</div></div>
      ${e.notaRedacao === null ? '<p class="fraco" style="margin:10px 0 0">Informe sua nota de redação no perfil para completar a conta.</p>' : ''}
    </div>`;
  }

  html += `<div class="cartao"><h3>Alvo</h3>
    <p class="fraco" style="margin:0">A meta interna é ${thetaParaNota(THETA_ALVO)} pontos por área. Passando disso, a área sai da prioridade e o tempo vai para onde ainda falta.</p></div>`;

  $('#plano-conteudo').innerHTML = html;
}

// ---------------------------------------------------------------- perfil

/**
 * Sem isto, quem entra em modo local fica preso nele: a tela de abertura
 * é a única com botão de login, e ela não aparece mais depois da primeira vez.
 */
function cartaoDeConta() {
  const e = est.estado;
  const logado = nuvem.nuvemAtiva() && e.uid && e.uid !== 'local';

  if (logado) {
    return `<div class="cartao">
      <h3>Conta</h3>
      <p class="fraco">Conectado. Seu histórico sincroniza entre celular e computador.</p>
      <button class="secundario" id="btn-sair-conta">Sair da conta</button>
    </div>`;
  }

  if (MODO_LOCAL) {
    return `<div class="cartao">
      <h3>Conta</h3>
      <p class="fraco">Modo local ligado em <code>js/config.js</code>. Seus dados ficam
      só neste navegador — exporte backup de vez em quando.</p>
    </div>`;
  }

  return `<div class="cartao">
    <h3>Conta</h3>
    <p class="fraco">${quedaParaLocal
      ? 'Não consegui falar com o servidor de login. Você está estudando em modo local: os dados ficam neste navegador até você entrar.'
      : 'Você está em modo local. Entrando na conta, o histórico passa a sincronizar entre aparelhos e sobrevive a formatar o celular.'}</p>
    <button class="primario" id="btn-ir-login">Entrar na minha conta</button>
  </div>`;
}

const PLANOS = {
  gratuito: { nome: 'Gratuito', detalhe: 'Todas as questões, proficiência e flashcards.' },
  // Os outros planos ainda não estão definidos — ficam aqui para o dia que estiverem.
};

function cabecalhoPerfil() {
  const e = est.estado;
  const plano = PLANOS[e.plano] || PLANOS.gratuito;
  const nome = e.nome || 'Estudante';
  const iniciais = nome.trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

  return `<div class="cartao perfil-topo">
    <div class="avatar" aria-hidden="true">${escapar(iniciais)}</div>
    <div class="perfil-identidade">
      <b id="perfil-nome">${escapar(nome)}</b>
      ${e.email ? `<span class="fraco">${escapar(e.email)}</span>` : ''}
      <span class="etiqueta-plano">${escapar(plano.nome)}</span>
    </div>
  </div>
  <p class="fraco" style="margin-top:-6px">${escapar(plano.detalhe)}</p>`;
}

function desenharPerfil() {
  const e = est.estado;
  const lista = cursos?.cursos || [];

  $('#perfil-conteudo').innerHTML = `
    ${cabecalhoPerfil()}

    <div class="cartao">
      <h3>Seu nome</h3>
      <label for="in-nome">Como quer ser chamado</label>
      <input id="in-nome" type="text" maxlength="40" value="${escapar(e.nome || '')}" placeholder="Seu nome">
    </div>

    <div class="cartao">
      <h3>Curso alvo</h3>
      <label for="sel-curso">Curso e campus</label>
      <select id="sel-curso">
        <option value="">Selecione…</option>
        ${lista.map((c) => `<option value="${c.id}" ${c.id === e.alvo.cursoId ? 'selected' : ''}>
          ${escapar(c.curso)} — ${escapar(c.campus)}${c.vagasSisu ? ` (${c.vagasSisu} vagas)` : ''}</option>`).join('')}
      </select>
      <div id="pesos-curso" class="fraco" style="margin-top:12px"></div>
      <p class="fraco">Pesos do ${escapar(cursos?.fonte || '')}.</p>
    </div>

    <div class="cartao">
      <h3>Meta semanal</h3>
      <label for="in-meta">Sessões por semana</label>
      <input id="in-meta" type="number" min="1" max="21" value="${e.metaSemanal.sessoes}" inputmode="numeric">
    </div>

    ${cartaoDeConta()}

    <div class="cartao">
      <h3>Seus dados</h3>
      <p class="fraco">Recorde de ofensiva: ${e.ofensiva.recorde} dias · ${e.sessoes.length} sessões · ${e.flashcards.length} cartões</p>
      <div class="linha-botoes">
        <button id="btn-exportar">Exportar backup</button>
        <button class="secundario" id="btn-importar">Importar</button>
      </div>
      <input id="in-arquivo" type="file" accept="application/json" hidden>
      <button class="secundario" id="btn-offline" style="margin-top:10px">Baixar tudo para uso offline</button>
      <div id="offline-status" class="fraco"></div>
    </div>

    ${nuvem.nuvemAtiva() ? '<button class="secundario" id="btn-sair">Sair da conta</button>' : ''}`;

  const mostrarPesos = () => {
    const c = lista.find((x) => x.id === e.alvo.cursoId);
    $('#pesos-curso').innerHTML = c
      ? Object.entries(c.pesos).map(([a, p]) => `${NOME_AREA[a]} <b>${p}</b>`).join(' · ')
      : '';
  };
  mostrarPesos();

  $('#sel-curso').onchange = (ev) => {
    const c = lista.find((x) => x.id === ev.target.value);
    e.alvo = { cursoId: c?.id || null, pesos: c ? c.pesos : null };
    est.salvarLocal(); est.sincronizar(); mostrarPesos();
  };
  $('#in-meta').onchange = (ev) => {
    e.metaSemanal.sessoes = Math.max(1, Number(ev.target.value) || 5);
    est.salvarLocal(); est.sincronizar();
  };
  $('#in-nome').oninput = (ev) => {
    e.nome = ev.target.value.trim() || null;
    est.salvarLocal();
    // Atualiza o cabeçalho na hora; esperar o blur fazia parecer que não salvou.
    $('#perfil-nome').textContent = e.nome || 'Estudante';
  };
  $('#in-nome').onblur = () => { est.sincronizar(); $('#perfil-nome').textContent = e.nome || 'Estudante'; };
  $('#btn-exportar').onclick = () => est.exportarBackup();
  $('#btn-importar').onclick = () => $('#in-arquivo').click();
  $('#in-arquivo').onchange = async (ev) => {
    try { await est.importarBackup(ev.target.files[0]); desenharPerfil(); }
    catch (err) { alert(err.message); }
  };
  $('#btn-offline').onclick = async () => {
    const status = $('#offline-status');
    status.textContent = 'Baixando…';
    const { prepararOffline } = await import('./dados.js');
    await prepararOffline((p) => { status.textContent = `Baixando… ${Math.round(p * 100)}%`; });
    status.textContent = 'Pronto. O app agora abre sem internet.';
  };
  if ($('#btn-sair')) $('#btn-sair').onclick = () => nuvem.sair().then(() => location.reload());
  if ($('#btn-sair-conta')) $('#btn-sair-conta').onclick = () => nuvem.sair().then(() => location.reload());
  if ($('#btn-ir-login')) $('#btn-ir-login').onclick = () => {
    // Se o SDK falhou nesta sessão, ir para a tela de login não adianta:
    // ela renderiza a versão local. Recarregar é o que dá nova chance.
    if (quedaParaLocal) location.reload();
    else { ir('entrar'); desenharEntrar(); }
  };
}

/**
 * Informa ao CSS a altura real do rodapé fixo da sessão, para o conteúdo
 * reservar o espaço exato. Número chutado erra: o rodapé tem uma ou duas
 * linhas de botões conforme a tela.
 */
function medirRodape() {
  const rodape = document.querySelector('.rodape-sessao');
  const raiz = document.documentElement;
  if (!rodape) { raiz.style.removeProperty('--alt-rodape'); return; }
  const alto = Math.ceil(rodape.getBoundingClientRect().height);
  raiz.style.setProperty('--alt-rodape', `${alto}px`);
}

window.addEventListener('resize', () => requestAnimationFrame(medirRodape));

// ---------------------------------------------------------------- teclado

/** Atalhos de teclado: só fazem sentido no computador, mas não atrapalham. */
document.addEventListener('keydown', (ev) => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(ev.target.tagName)) return;
  const tecla = ev.key.toUpperCase();

  if ($('#tela-sessao')?.classList.contains('ativa')) {
    const alternativas = [...document.querySelectorAll('.alternativa')];
    const posicao = 'ABCDE'.indexOf(tecla);
    if (posicao >= 0 && alternativas[posicao]) { alternativas[posicao].click(); ev.preventDefault(); return; }
    if (ev.key === 'Enter' || ev.key === 'ArrowRight') {
      const seguir = $('#btn-proxima');
      if (seguir && !seguir.disabled) { seguir.click(); ev.preventDefault(); }
      return;
    }
    if (ev.key === 'ArrowLeft') {
      const voltar = $('#btn-anterior') || $('#btn-voltar-q');
      if (voltar && !voltar.disabled) { voltar.click(); ev.preventDefault(); }
    }
    return;
  }

  if ($('#tela-cartoes')?.classList.contains('ativa')) {
    if (ev.key === ' ' || ev.key === 'Enter') {
      const virar = $('#btn-virar');
      if (virar && !virar.hidden) { virar.click(); ev.preventDefault(); }
      return;
    }
    const nota = ['1', '2', '3', '4'].indexOf(ev.key);
    const notas = document.querySelectorAll('#notas button');
    if (nota >= 0 && notas.length && !$('#notas').hidden) { notas[nota].click(); ev.preventDefault(); }
  }
});

// ---------------------------------------------------------------- início

function telaDeFalha(erro) {
  ir('painel');
  $('#painel-conteudo').innerHTML = `
    <div class="erro-caixa">Não consegui carregar os dados das questões.</div>
    <div class="cartao">
      <h3>O que provavelmente aconteceu</h3>
      <p class="fraco">A pasta <code>dados/</code> não chegou ao servidor, ou o
      endereço do site mudou. O arquivo que faltou foi:</p>
      <p class="fraco"><code>${escapar(new URL('dados/cursos.json', location.href).pathname)}</code></p>
      <p class="fraco">Abra esse endereço direto no navegador. Se der 404, os
      arquivos JSON não foram enviados junto com o site.</p>
      <p class="fraco">Detalhe técnico: ${escapar(erro.message)}</p>
    </div>
    <button class="primario" id="btn-recarregar">Tentar de novo</button>
    <button class="secundario" id="btn-limpar-cache">Limpar cache e recarregar</button>`;
  $('#btn-recarregar').onclick = () => location.reload();
  $('#btn-limpar-cache').onclick = async () => {
    // Service worker velho servindo versão antiga é a segunda causa mais comum.
    if ('serviceWorker' in navigator) {
      const registros = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registros.map((r) => r.unregister()));
    }
    if (window.caches) {
      const chaves = await caches.keys();
      await Promise.all(chaves.map((k) => caches.delete(k)));
    }
    location.reload();
  };
}

async function abrirApp() {
  try {
    cursos = await carregarCursos();
  } catch (erro) {
    console.error(erro);
    telaDeFalha(erro);
    return;
  }
  ir(est.estado.alvo.pesos ? 'painel' : 'perfil');
}

async function principal() {
  est.carregarLocal();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // Modo local: quem já usou antes entra direto, sem passar pela porta.
  if (!nuvem.nuvemAtiva()) {
    if (est.estado.uid) { await est.puxarDaNuvem('local'); await abrirApp(); }
    else { ir('entrar'); desenharEntrar(); }
    return;
  }

  const conectou = await nuvem.observarUsuario(async (usuario, recusa) => {
    if (!usuario) {
      ir('entrar');
      desenharEntrar();
      if (recusa) $('#entrar-erro').innerHTML = `<div class="erro-caixa">${escapar(recusa.message)}</div>`;
      return;
    }
    await est.puxarDaNuvem(usuario.uid);
    if (!est.estado.nome && usuario.nome) est.estado.nome = usuario.nome.split('@')[0];
    est.estado.email = usuario.email || null;
    est.salvarLocal();
    await abrirApp();
  });

  // O SDK não veio: segue em modo local para o app não ficar em branco.
  if (!conectou) {
    quedaParaLocal = true;
    if (est.estado.uid) { await est.puxarDaNuvem(est.estado.uid); await abrirApp(); }
    else { ir('entrar'); desenharEntrar(); }
  }
}

principal();
