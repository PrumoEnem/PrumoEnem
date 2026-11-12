/** app.js — roteador e telas. */

import { AREAS, NOME_AREA, carregarQuestoes, carregarCursos, carregarVocabulario } from './dados.js';
import { estimarTheta, estimarPorAcertos, faixaDeNota, atualizarTheta, thetaParaNota } from './tri.js';
import { calcularPrioridades, escolherArea, montarSessao, simularNotaSisu, THETA_ALVO } from './motor.js';
import * as srs from './srs.js';
import * as est from './estado.js';
import * as nuvem from './nuvem.js';
import * as ia from './ia.js';
import * as red from './redacao.js';
import * as rev from './revisao.js';
import { abrirPomodoro } from './pomodoro.js';
import { MODO_LOCAL, DOMINIO_PERMITIDO } from './config.js';

const $ = (s) => document.querySelector(s);
const SEGUNDOS_POR_QUESTAO = 180;
const dataLocal = (data = new Date()) => {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
};

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

function atalhoIntensivo() {
  const sprint = est.estado.intensivo || {};
  const dia = diaAtualIntensivo(sprint);
  const texto = sprint.modo === 'dia2' && dia >= 1 && dia <= ETAPAS_INTENSIVAS.length
    ? `Intensivo do 2º dia ativo · etapa ${dia} de ${ETAPAS_INTENSIVAS.length}.`
    : sprint.modo === 'dia2' && dia > ETAPAS_INTENSIVAS.length
      ? 'Intensivo do 2º dia concluído. Revise os erros e descanse.'
      : 'Plano intensivo de 4 horas para Matemática e Natureza.';
  return `<div class="cartao">
    <h3>Foco no 2º dia do ENEM</h3>
    <p class="fraco">${texto}</p>
    <button class="secundario" id="btn-abrir-intensivo">Abrir plano intensivo</button>
  </div>`;
}

function atalhoPomodoro() {
  return `<div class="cartao foco-card">
    <span class="foco-selo">MODO FOCO</span>
    <h3>Uma etapa de cada vez</h3>
    <p class="fraco">Pomodoro em janela separada, com ruído marrom opcional e desligado por padrão.</p>
    <button class="primario" id="btn-abrir-pomodoro">Abrir Pomodoro</button>
  </div>`;
}

function cartaoFocoEstudo(area) {
  const titulo = area === 'matematica' ? 'Matemática de hoje' : `Comece por ${NOME_AREA[area]}`;
  return `<div class="cartao home-foco">
    <div class="foco-selo">PRÓXIMO PASSO</div>
    <h3>${escapar(titulo)}</h3>
    <p class="fraco">Uma sessão curta que começa com 9 questões. Responda com calma e use a correção para escolher o que revisar.</p>
    <div class="home-foco-acoes">
      <button class="primario" id="btn-estudar">Começar agora · ${escapar(NOME_AREA[area])}</button>
      ${area !== 'matematica' ? '<button class="secundario" id="btn-estudar-matematica">Fazer Matemática do dia · 9 questões</button>' : ''}
      <button class="texto-botao" id="btn-escolher-sessao">Escolher outra área ou tamanho</button>
    </div>
  </div>`;
}

function iniciarSessaoRapida(area, tamanho = 9, modo = 'porQuestao') {
  est.estado.preferenciaSessao = {
    ...(est.estado.preferenciaSessao || {}),
    area,
    tamanho,
    modo,
  };
  est.salvarLocal();
  sessao = null;
  ir('sessao');
  montarEIniciar();
}

function ligarAtalhosPainel(areaFoco) {
  $('#btn-abrir-intensivo').onclick = () => ir('plano');
  $('#btn-abrir-pomodoro').onclick = abrirPomodoro;
  $('#btn-estudar').onclick = () => iniciarSessaoRapida(areaFoco);
  $('#btn-estudar-matematica')?.addEventListener('click', () => iniciarSessaoRapida('matematica'));
  $('#btn-escolher-sessao')?.addEventListener('click', () => { sessao = null; ir('sessao'); });
}

function desenharPainel() {
  const e = est.estado;
  const ofensiva = est.ofensivaViva();
  const chama = $('#painel-ofensiva');
  chama.innerHTML = `<span>${ofensiva}</span> ${ofensiva === 1 ? 'dia' : 'dias'}`;
  chama.classList.toggle('apagada', ofensiva === 0);

  const curso = cursos?.cursos.find((c) => c.id === e.alvo.cursoId);
  $('#painel-curso').textContent = curso ? `${curso.curso} · ${curso.campus}` : 'Escolher curso';
  $('#painel-saudacao').textContent = e.nome ? `Olá, ${e.nome}` : 'Seu próximo passo';
  const pesos = e.alvo.pesos || Object.fromEntries(AREAS.map((area) => [area, 1]));
  const prioridades = calcularPrioridades(pesos, e.thetas);
  const areaFoco = prioridades.find((p) => p.area === 'matematica' || p.area === 'natureza')?.area || 'matematica';

  if (!e.alvo.pesos) {
    $('#painel-conteudo').innerHTML = `
      ${cartaoFocoEstudo(areaFoco)}
      ${atalhoIntensivo()}
      <div class="vazio">
        <h3>Personalize seu alvo</h3>
        <p class="fraco">Escolha seu curso para o plano considerar os pesos do SiSU. Você já pode começar a estudar.</p>
        <button class="primario" onclick="document.querySelector('[data-ir=perfil]').click()">Escolher curso</button>
      </div>`;
    $('#painel-conteudo').insertAdjacentHTML('beforeend', atalhoPomodoro());
    ligarAtalhosPainel(areaFoco);
    return;
  }

  const simulacao = simularNotaSisu(e.alvo.pesos, e.thetas, e.notaRedacao);
  const medidas = AREAS.filter((a) => e.thetas[a]);
  const meta = e.metaSemanal;

  let html = cartaoFocoEstudo(areaFoco) + atalhoIntensivo();

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

  html += atalhoPomodoro();
  $('#painel-conteudo').innerHTML = html;
  ligarAtalhosPainel(areaFoco);
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
  { n: 1, rotulo: '1 questão', nota: 'manutenção leve' },
  { n: 9, rotulo: '9 questões', nota: '3 fáceis, 3 médias, 3 difíceis' },
  { n: 20, rotulo: '20 questões', nota: 'treino mais longo' },
  { n: 45, rotulo: '45 questões', nota: 'uma prova inteira de uma área' },
];

function desenharInicioSessao() {
  const e = est.estado;
  const pesos = e.alvo.pesos || Object.fromEntries(AREAS.map((area) => [area, 1]));
  const prioridades = calcularPrioridades(pesos, e.thetas);
  const sugerida = prioridades[0].area;
  const pref = e.preferenciaSessao || {};
  const tamanho = pref.tamanho || 9;
  const modo = pref.modo || 'porQuestao';
  const area = pref.area || 'auto';

  $('#sessao-conteudo').innerHTML = `
    <h1>Escolha seu foco</h1>
    <p class="fraco">Faça um bloco por vez. No fim, corrija os erros e escolha o próximo assunto para revisar.</p>

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
          <span>peso ${pesos[a] ?? 1}${e.thetas[a] ? ` · ${thetaParaNota(e.thetas[a].theta)} pontos hoje` : ' · sem medição'}</span>
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
  const semRevisao = pref.semRevisao === true;
  if (semRevisao) {
    delete pref.semRevisao;
    est.salvarLocal();
  }

  $('#sessao-conteudo').innerHTML = '<div class="carregando">Montando sua sessão</div>';

  const pesos = e.alvo.pesos || Object.fromEntries(AREAS.map((a) => [a, 1]));
  const prioridades = calcularPrioridades(pesos, e.thetas);
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
  const { questoes: sorteadas, calibrada } =
    montarSessao(questoes, theta, e.questoesVistas[area], porFaixa);
  const novas = sorteadas.slice(0, tamanho);

  // Questões erradas antes voltam até serem acertadas, com as alternativas
  // embaralhadas para não valer lembrar a letra.
  const daFila = semRevisao ? [] : rev.selecionarParaSessao(e.errosPendentes || []);
  const deRevisao = [];
  for (const item of daFila) {
    try {
      let q = null;
      let qComTrecho = null;
      let qComGabarito = null;
      const areasBusca = [item.area, ...AREAS.filter((a) => a !== item.area)];
      for (const areaBusca of areasBusca) {
        if (!AREAS.includes(areaBusca)) continue;
        const banco = await carregarQuestoes(areaBusca);
        const candidatas = banco.filter((x) => x.id === item.id || x.id.startsWith(`${item.id}-`));
        qComTrecho ||= candidatas.find((x) =>
          x.gabarito === item.gabarito && rev.resumirEnunciado(x.enunciado) === item.trecho
        ) || null;
        qComGabarito ||= candidatas.find((x) => x.gabarito === item.gabarito) || null;
        q ||= candidatas[0] || null;
      }
      q = qComTrecho || qComGabarito || q;
      if (q) {
        item.id = q.id;
        item.area = q.area || item.area;
        deRevisao.push(rev.embaralharAlternativas(q));
      }
    } catch { /* área indisponível: ignora esta */ }
  }

  // Revisão primeiro: começar acertando o que já custou nota rende mais.
  const escolhidas = [...deRevisao, ...novas].slice(0, tamanho + deRevisao.length);

  sessao = {
    id: `s-${Date.now()}`,
    area, calibrada, modo,
    questoes: escolhidas.slice(0, tamanho + deRevisao.length),
    quantasRevisao: deRevisao.length,
    indice: 0,
    // Respostas por posição: dá para voltar e trocar sem bagunçar a ordem.
    respostas: new Array(escolhidas.length).fill(null),
    paraRever: new Set(),
    vocabulario: srs.proximoVocabulario(bancoVocabulario, e.vocabulario),
    respostaVocabulario: null,
    naVocabulario: false,
    inicio: Date.now(),
    segundosTotais: modo === 'total' ? escolhidas.length * SEGUNDOS_POR_QUESTAO : null,
    gastoPorQuestao: new Array(escolhidas.length).fill(0),
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

  const respostasDaArea = s.respostas.filter((r) => (r.questao.area || s.area) === s.area);
  const acertosDaArea = respostasDaArea.filter((r) => r.acertou).length;
  const acertos = s.respostas.filter((r) => r.acertou).length;

  // Proficiência: TRI de verdade quando há parâmetros, aproximação quando não.
  let estimativa = estimarTheta(respostasDaArea.map((r) => ({ tri: r.questao.tri, acertou: r.acertou })));
  if (!estimativa) estimativa = estimarPorAcertos(acertosDaArea, respostasDaArea.length);
  if (estimativa) {
    const anterior = e.thetas[s.area];
    e.thetas[s.area] = atualizarTheta(anterior, estimativa);
    // Basta uma sessão aproximada para a área inteira ficar marcada assim.
    e.thetas[s.area].aproximada = estimativa.aproximada || anterior?.aproximada || false;
  }

  // Vocabulário
  const rv = s.respostaVocabulario || { item: s.vocabulario, escolha: null, acertou: false };
  s.respostaVocabulario = rv;
  e.vocabulario[rv.item.id] = srs.atualizarVocabulario(e.vocabulario[rv.item.id] || {}, rv.acertou);

  // Fila de revisão: errou entra, acertou sai.
  if (!e.errosPendentes) e.errosPendentes = [];
  for (const r of s.respostas) {
    if (r.acertou) e.errosPendentes = rev.removerAcertada(e.errosPendentes, r.questao.id);
    else e.errosPendentes = rev.registrarErro(e.errosPendentes, r.questao, r.marcada);
  }

  const vistasPorArea = new Map();
  for (const r of s.respostas) {
    const area = r.questao.area || s.area;
    if (!AREAS.includes(area)) continue;
    if (!vistasPorArea.has(area)) vistasPorArea.set(area, []);
    vistasPorArea.get(area).push(r.questao.id);
  }
  for (const [area, ids] of vistasPorArea) est.marcarVistas(area, ids);
  e.sessoes.push({ id: s.id, data: new Date().toISOString(), area: s.area, acertos, total: s.respostas.length });
  e.sessoes = e.sessoes.slice(-120);
  if (e.intensivo?.modo === 'dia2' && e.intensivo?.inicio) {
    const diaDoPlano = diaAtualIntensivo(e.intensivo);
    if (diaDoPlano >= 1 && diaDoPlano <= ETAPAS_INTENSIVAS.length) {
      e.intensivo.diasConcluidos = [...new Set([...(e.intensivo.diasConcluidos || []), dataLocal()])];
    }
  }
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

  if (s.quantasRevisao) {
    const revisadas = s.respostas.slice(0, s.quantasRevisao);
    const acertadas = revisadas.filter((r) => r.acertou).length;
    html += `<p class="fraco">${s.quantasRevisao} ${s.quantasRevisao === 1 ? 'questão era' : 'questões eram'}
      de revisão — você acertou ${acertadas}. ${acertadas === s.quantasRevisao
        ? 'Saíram da fila.'
        : 'As erradas voltam na próxima sessão.'}</p>`;
  }

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

  const resultado = { explicacoes: [], flashcards: [] };
  const avisos = [];
  const grupos = new Map();
  for (const erro of erros) {
    const area = erro.questao.area || sessao.area;
    if (!grupos.has(area)) grupos.set(area, []);
    grupos.get(area).push(erro);
  }
  for (const [area, grupo] of grupos) {
    for (let i = 0; i < grupo.length; i += 12) {
      try {
        const parcial = await ia.explicarErros(grupo.slice(i, i + 12), NOME_AREA[area] || area);
        resultado.explicacoes.push(...(parcial.explicacoes || []));
        resultado.flashcards.push(...(parcial.flashcards || []));
        if (parcial.aviso) avisos.push(parcial.aviso);
      } catch (err) {
        avisos.push(err.message);
      }
    }
  }
  if (avisos.length) resultado.aviso = [...new Set(avisos)].join(' ');

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
        // A explicação também vai para a fila, para ficar visível na aba Errei.
        if (achada?.texto) {
          est.estado.errosPendentes = rev.anotarExplicacao(
            est.estado.errosPendentes || [], r.questao.id, achada.texto
          );
        }
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

let abaRevisao = 'revisar';
let filaFlashcards = [];
let indiceFlashcard = 0;
let flashcardVirado = false;
let flashcardsEmRevisao = false;
let flashcardsRevisadosSessao = 0;
let flashcardsTotalSessao = 0;
let flashcardsSessaoConcluida = false;

function desenharCartoes() {
  const alvo = $('#cartoes-conteudo');
  const fila = est.estado.errosPendentes || [];
  const totalCartoes = est.estado.flashcards.length;
  const vencidos = srs.vencidos(est.estado.flashcards).length;

  alvo.innerHTML = `
    <div class="abas" id="abas-revisao">
      <button class="${abaRevisao === 'revisar' ? 'ativa' : ''}" data-aba="revisar">
        Errei${fila.length ? ` <i>${fila.length}</i>` : ''}
      </button>
      <button class="${abaRevisao === 'flashcards' ? 'ativa' : ''}" data-aba="flashcards">
        Flashcards${totalCartoes ? ` <i>${totalCartoes}</i>` : ''}
      </button>
      <button class="${abaRevisao === 'resumos' ? 'ativa' : ''}" data-aba="resumos">
        Resumos${est.estado.resumos?.length ? ` <i>${est.estado.resumos.length}</i>` : ''}
      </button>
      <button class="${abaRevisao === 'provas' ? 'ativa' : ''}" data-aba="provas">Provas</button>
    </div>
    <div id="revisao-corpo"></div>`;

  document.querySelectorAll('#abas-revisao button').forEach((b) => {
    b.onclick = () => { abaRevisao = b.dataset.aba; desenharCartoes(); };
  });

  if (abaRevisao === 'flashcards') return desenharFlashcards();
  if (abaRevisao === 'resumos') return desenharResumos();
  if (abaRevisao === 'provas') return desenharProvas();
  desenharErrosPendentes();
}

function desenharFlashcards() {
  const corpo = $('#revisao-corpo');
  const cartoes = est.estado.flashcards;

  // Dá um identificador estável aos cartões antigos que vieram sem ID.
  const ids = new Set();
  for (const [i, cartao] of cartoes.entries()) {
    if (!cartao.id || ids.has(cartao.id)) cartao.id = `fc-${Date.now()}-${i}`;
    ids.add(cartao.id);
    cartao.proximaRevisao ||= dataLocal();
    cartao.intervalo ??= 0;
    cartao.facilidade ??= 2.5;
    cartao.repeticoes ??= 0;
  }

  if (flashcardsEmRevisao && filaFlashcards.length) {
    return desenharCartaoAtual();
  }

  flashcardsEmRevisao = false;
  const vencidos = srs.vencidos(cartoes).length;
  corpo.innerHTML = `
    ${flashcardsSessaoConcluida ? `<div class="flash-resultado"><b>Revisão concluída!</b><span>${flashcardsRevisadosSessao} ${flashcardsRevisadosSessao === 1 ? 'cartão revisado' : 'cartões revisados'} — bom trabalho, mantenha a sequência.</span></div>` : ''}
    <div class="cartao flash-resumo">
      <span class="foco-selo">REVISÃO ESPAÇADA</span>
      <h3>Se lembrar, fixe. Se esquecer, revise de novo.</h3>
      <div class="flash-estatisticas">
        <div><b>${cartoes.length}</b><span>no baralho</span></div>
        <div><b>${vencidos}</b><span>para revisar hoje</span></div>
      </div>
      <div class="linha-botoes">
        <button class="primario" id="btn-comecar-flash" ${cartoes.length ? '' : 'disabled'}>
          ${vencidos ? `Revisar ${vencidos} vencido${vencidos === 1 ? '' : 's'}` : 'Estudar cartões'}
        </button>
        ${vencidos && cartoes.length > vencidos ? '<button class="secundario" id="btn-estudar-todos">Estudar todos</button>' : ''}
      </div>
      ${cartoes.length ? '' : '<p class="fraco flash-vazio">Seu baralho está vazio. Crie cartões ou marque conceitos ao terminar uma sessão.</p>'}
    </div>
    <div class="cartao">
      <h3>Crie seu próprio cartão</h3>
      <p class="fraco">Pergunte na frente e escreva uma resposta curta no verso.</p>
      <button class="secundario" id="btn-mostrar-form-cartao" aria-expanded="false">＋ Novo flashcard</button>
      <form id="form-flashcard" class="form-flashcard" hidden>
        <label for="flash-frente">Frente</label>
        <textarea id="flash-frente" rows="2" maxlength="500" required placeholder="Ex.: O que é a primeira lei de Newton?"></textarea>
        <label for="flash-verso">Verso</label>
        <textarea id="flash-verso" rows="3" maxlength="1200" required placeholder="Escreva a resposta com suas palavras"></textarea>
        <label for="flash-conceito">Matéria ou conceito <span class="fraco">(opcional)</span></label>
        <input id="flash-conceito" maxlength="80" placeholder="Ex.: Física · Dinâmica">
        <button class="primario" type="submit">Salvar flashcard</button>
      </form>
    </div>`;

  $('#btn-comecar-flash').onclick = () => iniciarRevisaoFlashcards(vencidos === 0);
  $('#btn-estudar-todos')?.addEventListener('click', () => iniciarRevisaoFlashcards(true));
  const form = $('#form-flashcard');
  const botaoNovo = $('#btn-mostrar-form-cartao');
  botaoNovo.onclick = () => {
    form.hidden = !form.hidden;
    botaoNovo.setAttribute('aria-expanded', String(!form.hidden));
    botaoNovo.textContent = form.hidden ? '＋ Novo flashcard' : 'Fechar formulário';
    if (!form.hidden) $('#flash-frente').focus();
  };
  form.onsubmit = (ev) => {
    ev.preventDefault();
    const frente = $('#flash-frente').value.trim();
    const verso = $('#flash-verso').value.trim();
    if (!frente || !verso) return;
    cartoes.push(srs.novoCartao({
      id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      frente, verso, conceito: $('#flash-conceito').value.trim() || 'Meu cartão',
      origem: 'manual',
    }));
    est.salvarLocal();
    est.sincronizar();
    desenharCartoes();
  };
}

function iniciarRevisaoFlashcards(todos) {
  const vencidos = srs.vencidos(est.estado.flashcards);
  filaFlashcards = (todos ? est.estado.flashcards : vencidos).map((c) => c.id);
  indiceFlashcard = 0;
  flashcardVirado = false;
  flashcardsEmRevisao = filaFlashcards.length > 0;
  flashcardsRevisadosSessao = 0;
  flashcardsTotalSessao = filaFlashcards.length;
  flashcardsSessaoConcluida = false;
  desenharCartoes();
}

function desenharCartaoAtual() {
  const corpo = $('#revisao-corpo');
  const id = filaFlashcards[indiceFlashcard];
  const cartao = est.estado.flashcards.find((c) => c.id === id);
  if (!cartao) {
    filaFlashcards = filaFlashcards.filter((x) => est.estado.flashcards.some((c) => c.id === x));
    if (indiceFlashcard >= filaFlashcards.length) indiceFlashcard = 0;
    if (!filaFlashcards.length) { flashcardsEmRevisao = false; return desenharFlashcards(); }
    return desenharCartaoAtual();
  }

  const progresso = Math.min(100, Math.round(((indiceFlashcard + 1) / filaFlashcards.length) * 100));
  corpo.innerHTML = `
    <div class="flash-progresso-linha"><span>Cartão ${indiceFlashcard + 1} de ${filaFlashcards.length}</span><button class="texto-botao" id="btn-sair-flash">Sair da revisão</button></div>
    <div class="barra"><i style="width:${progresso}%"></i></div>
    <article class="flashcard-face">
      <span class="foco-selo">${escapar(cartao.conceito || 'FLASHCARD')}</span>
      <div class="flash-pergunta">${escapar(cartao.frente || 'Sem pergunta')}</div>
      <div id="flash-resposta" class="flash-resposta" ${flashcardVirado ? '' : 'hidden'}>
        <span class="flash-divisor">RESPOSTA</span>
        <p>${escapar(cartao.verso || 'Este cartão não tem resposta cadastrada.')}</p>
      </div>
    </article>
    <button class="primario flash-virar" id="btn-virar" ${flashcardVirado ? 'hidden' : ''}>Virar cartão</button>
    <div id="notas-acoes" ${flashcardVirado ? '' : 'hidden'}>
      <p class="fraco centro">Como foi sua lembrança? (atalhos: 1 a 4)</p>
      <div id="notas" class="conceito-acoes flash-notas" ${flashcardVirado ? '' : 'hidden'}>
        <button class="secundario" data-nota="0"><b>1 · Errei</b><small>Rever hoje</small></button>
        <button class="secundario" data-nota="1"><b>2 · Difícil</b><small>Rever em breve</small></button>
        <button class="secundario" data-nota="2"><b>3 · Lembrei</b><small>Espaçar revisão</small></button>
        <button class="secundario" data-nota="3"><b>4 · Fácil</b><small>Espaçar mais</small></button>
      </div>
    </div>`;

  $('#btn-sair-flash').onclick = () => { flashcardsEmRevisao = false; desenharCartoes(); };
  $('#btn-virar').onclick = () => { flashcardVirado = true; desenharCartoes(); };
  corpo.querySelectorAll('[data-nota]').forEach((b) => {
    b.onclick = () => avaliarFlashcard(cartao, Number(b.dataset.nota));
  });
}

function avaliarFlashcard(cartao, qualidade) {
  const indice = est.estado.flashcards.indexOf(cartao);
  if (indice < 0) return desenharCartoes();
  est.estado.flashcards[indice] = srs.revisar(cartao, qualidade);
  indiceFlashcard += 1;
  flashcardsRevisadosSessao += 1;
  flashcardVirado = false;
  if (indiceFlashcard >= filaFlashcards.length) {
    flashcardsEmRevisao = false;
    flashcardsSessaoConcluida = flashcardsRevisadosSessao === flashcardsTotalSessao;
  }
  est.salvarLocal();
  est.sincronizar();
  desenharCartoes();
}

/**
 * Lista das questões que você errou e ainda não acertou.
 *
 * Aqui é só leitura: o resumo do que caiu e a explicação da IA, quando ela
 * já respondeu. Responder de novo acontece na sessão — a questão volta
 * sozinha, embaralhada, até você acertar.
 */
function desenharErrosPendentes() {
  const corpo = $('#revisao-corpo');
  const fila = est.estado.errosPendentes || [];

  if (!fila.length) {
    corpo.innerHTML = `<div class="vazio">
      <h3>Nenhuma questão pendente</h3>
      <p>Quando você errar uma questão, ela aparece aqui e volta nas próximas
      sessões até você acertar.</p>
    </div>`;
    return;
  }

  corpo.innerHTML = `
    <p class="fraco">${fila.length} ${fila.length === 1 ? 'questão volta' : 'questões voltam'}
    nas próximas sessões, ${rev.POR_SESSAO} por vez, com as alternativas embaralhadas.</p>
    ${fila.map((f) => `
      <div class="cartao erro-pendente">
        <div class="erro-cabecalho">
          <b>${NOME_AREA[f.area] || f.area} · ${f.ano}, questão ${f.numero}</b>
          <span class="etiqueta-tentativas">${f.tentativas}× ${f.tentativas === 1 ? 'erro' : 'erros'}</span>
        </div>
        <p class="erro-trecho">${escapar(f.trecho || '')}</p>
        <p class="fraco">Você marcou <b>${escapar(f.marcada || '—')}</b> · gabarito <b>${escapar(f.gabarito)}</b></p>
        ${f.explicacao
          ? `<div class="explicacao">${formatarTexto(f.explicacao)}</div>`
          : `<p class="fraco">Sem explicação guardada${ia.iaDisponivel()
              ? ' — ela é gerada ao fim da sessão em que você errar de novo.'
              : '. Ligue a IA para ter explicações.'}</p>`}
      </div>`).join('')}`;
}

// ---------------------------------------------------------------- provas

const PROVAS = [
  { ano: 2023, dia: 1, arquivo: 'ENEM_2023_P1_CAD_01_DIA_1_AZUL.pdf' },
  { ano: 2023, dia: 2, arquivo: 'ENEM_2023_P2_CAD_07_DIA_2_AZUL.pdf' },
  { ano: 2022, dia: 1, arquivo: 'ENEM_2022_P1_CAD_01_DIA_1_AZUL.pdf' },
  { ano: 2022, dia: 2, arquivo: 'ENEM_2022_P1_CAD_07_DIA_2_AZUL.pdf' },
  { ano: 2021, dia: 1, arquivo: 'ENEM_2021_DIGITAL_CAD_01_DIA_1_AZUL_ESPANHOL.pdf' },
  { ano: 2021, dia: 2, arquivo: 'ENEM_2021_DIGITAL_CAD_07_DIA_2_AZUL.pdf' },
  { ano: 2020, dia: 1, arquivo: 'ENEM_2020_DIGITAL_CAD_01_DIA_1_AZUL_ESPANHOL.pdf' },
  { ano: 2020, dia: 2, arquivo: 'ENEM_2020_DIGITAL_CAD_07_DIA_2_AZUL.pdf' },
];

const ANO_PROVAS_INICIO = 2009;
const ANO_PROVAS_FIM = 2025;
const URL_PROVAS_INEP = 'https://www.gov.br/inep/pt-br/areas-de-atuacao/avaliacao-e-exames-educacionais/enem/provas-e-gabaritos';

const CONTEUDO_DIA = {
  1: 'Linguagens, Humanas e Redação · 5h30',
  2: 'Natureza e Matemática · 5h',
};

function desenharProvas() {
  const anos = Array.from(
    { length: ANO_PROVAS_FIM - ANO_PROVAS_INICIO + 1 },
    (_, i) => ANO_PROVAS_FIM - i
  );

  $('#revisao-corpo').innerHTML = `
    <p class="fraco">Escolha uma edição de 2009 a 2025. Os PDFs de 2020 a 2023
    estão disponíveis aqui; nos outros anos, o botão abre os cadernos e gabaritos
    oficiais do INEP.</p>
    ${anos.map((ano) => `
      <div class="cartao">
        <h3>ENEM ${ano}</h3>
        ${PROVAS.filter((p) => p.ano === ano).map((p) => `
          <div class="linha-prova">
            <span>
              <b>Dia ${p.dia}</b>
              <span class="fraco">${CONTEUDO_DIA[p.dia]}</span>
            </span>
            <span class="prova-acoes">
              <a class="botao secundario" href="provas/${escapar(p.arquivo)}" target="_blank" rel="noopener">Abrir</a>
              <a class="botao secundario" href="provas/${escapar(p.arquivo)}" download="${escapar(p.arquivo)}">Baixar</a>
            </span>
          </div>`).join('')}
        ${!PROVAS.some((p) => p.ano === ano)
          ? '<p class="fraco">Cadernos dos dois dias e gabaritos disponíveis no acervo oficial.</p>'
          : ''}
        <a class="botao secundario" href="${URL_PROVAS_INEP}/${ano}" target="_blank" rel="noopener noreferrer">Ver provas e gabaritos no INEP ↗</a>
      </div>`).join('')}
    <p class="fraco">O acervo oficial inclui cadernos, reaplicações e gabaritos de cada ano.</p>`;
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

const MODELO_REDACAO = `Introdução
- Repertório: [autor, lei, dado ou obra]
- Contextualização do tema
- Tese: [sua posição em uma frase]

Desenvolvimento 1
- Argumento: [causa]
- Comprovação: [repertório ou dado]
- Fechamento ligando à tese

Desenvolvimento 2
- Argumento: [consequência]
- Comprovação: [repertório ou dado]
- Fechamento ligando à tese

Conclusão — proposta de intervenção
- Agente: quem faz
- Ação: o que faz
- Meio: como faz
- Efeito: para quê
- Detalhamento: de um dos anteriores`;

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
      <a class="botao secundario" href="https://redacao.pr.gov.br/" target="_blank" rel="noopener"
         style="margin-top:12px">Abrir o Redação Paraná</a>
    </div>

    <div class="cartao">
      <h3>Seu modelo de redação</h3>
      <p class="fraco">A estrutura que você segue ao escrever. Deixe aberta numa
      aba enquanto redige — decorar o esqueleto é o que faz você parar de perder
      tempo pensando em como começar cada parágrafo.</p>
      <textarea id="in-modelo" rows="14" spellcheck="false"
        placeholder="Escreva aqui a sua estrutura...">${escapar(e.redacao?.modelo ?? MODELO_REDACAO)}</textarea>
      <div class="linha-botoes" style="margin-top:10px">
        <button class="secundario" id="btn-modelo-padrao">Restaurar sugestão</button>
        <button class="secundario" id="btn-copiar-modelo">Copiar</button>
      </div>
      <p class="fraco" id="modelo-status"></p>
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
      const completa = red.COMPETENCIAS.every((c) => {
        const nota = e.redacao.competencias[c.id];
        return nota !== undefined && nota !== null && nota !== '';
      });
      e.notaRedacao = completa ? red.somarCompetencias(e.redacao.competencias) : null;
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

  const campoModelo = $('#in-modelo');
  const statusModelo = $('#modelo-status');
  let guardarModelo = null;
  campoModelo.oninput = () => {
    // Salva depois que a digitação para: gravar a cada tecla trava em texto longo.
    clearTimeout(guardarModelo);
    statusModelo.textContent = 'salvando…';
    guardarModelo = setTimeout(() => {
      e.redacao = { ...(e.redacao || {}), modelo: campoModelo.value };
      est.salvarLocal(); est.sincronizar();
      statusModelo.textContent = 'salvo';
    }, 600);
  };
  $('#btn-modelo-padrao').onclick = () => {
    campoModelo.value = MODELO_REDACAO;
    campoModelo.dispatchEvent(new Event('input'));
  };
  $('#btn-copiar-modelo').onclick = async () => {
    try {
      await navigator.clipboard.writeText(campoModelo.value);
      statusModelo.textContent = 'copiado';
    } catch {
      campoModelo.select();
      statusModelo.textContent = 'selecionado — use Ctrl+C';
    }
  };

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

const DIAS = [
  { i: 0, curto: 'D', nome: 'Domingo' },
  { i: 1, curto: 'S', nome: 'Segunda' },
  { i: 2, curto: 'T', nome: 'Terça' },
  { i: 3, curto: 'Q', nome: 'Quarta' },
  { i: 4, curto: 'Q', nome: 'Quinta' },
  { i: 5, curto: 'S', nome: 'Sexta' },
  { i: 6, curto: 'S', nome: 'Sábado' },
];

function blocoVideoIntensivo(titulo, foco, recursos, roteiro) {
  return { duracao: '40 min', titulo, foco, recursos, roteiro };
}

function blocoQuestoesIntensivo(titulo, area, tamanho, foco, roteiro, duracao = '40 min', modo = 'porQuestao') {
  return { duracao, titulo, foco, roteiro, sessao: { area, tamanho, modo } };
}

function blocoRoteiroIntensivo(duracao, titulo, foco, roteiro) {
  return { duracao, titulo, foco, roteiro };
}

const ETAPAS_INTENSIVAS = [
  {
    titulo: 'Proporção + ecologia', dia: 'Terça-feira', carga: '4h líquidas', blocos: [
      blocoVideoIntensivo('Razão, proporção e regra de três', 'Distinguir razão e proporção e identificar quando as grandezas são diretas ou inversas.', [
        { titulo: 'Videoaulas de razão e proporção', href: 'https://enemhub.com.br/topico/razoes-e-proporcoes' },
      ], [
        { tempo: '15 min', acao: 'Assista a uma videoaula curta e pause para acompanhar os exemplos.' },
        { tempo: '10 min', acao: 'Anote como reconhecer grandezas diretas e inversas.' },
        { tempo: '15 min', acao: 'Refaça 2 exemplos sem olhar a resolução e confira o resultado.' },
      ]),
      blocoQuestoesIntensivo('Questões diárias de Matemática', 'matematica', 9, 'Praticar leitura de enunciado e cálculo sem depender de uma fórmula decorada.', [
        { tempo: '5 min', acao: 'Leia as questões e marque os dados importantes.' },
        { tempo: '25 min', acao: 'Resolva as 9 questões com calma, sem abrir a resolução.' },
        { tempo: '10 min', acao: 'Confira as respostas e anote o motivo de cada erro.' },
      ]),
      blocoRoteiroIntensivo('40 min', 'Questões do ENEM: proporção e escalas', 'Treinar a escolha da proporção e manter as unidades iguais antes de calcular.', [
        { tempo: '5 min', acao: 'Leia os enunciados e circule as grandezas que se relacionam.' },
        { tempo: '25 min', acao: 'Resolva questões de proporção e escala, mostrando as contas.' },
        { tempo: '10 min', acao: 'Confira o gabarito e refaça uma questão que errou.' },
      ]),
      blocoVideoIntensivo('Ecologia: relações e fluxo de energia', 'Reconhecer níveis ecológicos, relações entre espécies e o caminho da energia nas cadeias alimentares.', [
        { titulo: 'Videoaulas de conceitos da ecologia', href: 'https://enemhub.com.br/topico/conceitos-da-ecologia' },
        { titulo: 'Videoaulas de relações ecológicas', href: 'https://enemhub.com.br/topico/relacoes-ecologicas' },
        { titulo: 'Videoaulas de cadeias alimentares', href: 'https://enemhub.com.br/topico/fluxo-de-energia-e-niveis-troficos' },
      ], [
        { tempo: '15 min', acao: 'Escolha uma aula curta nos links e anote os conceitos que se confundem.' },
        { tempo: '15 min', acao: 'Desenhe uma cadeia alimentar com setas no sentido do fluxo de energia.' },
        { tempo: '10 min', acao: 'Explique em voz alta uma relação ecológica e um impacto ambiental.' },
      ]),
      blocoQuestoesIntensivo('Questões de Ciências da Natureza', 'natureza', 9, 'Aplicar os conceitos estudados e praticar a leitura de situações científicas.', [
        { tempo: '5 min', acao: 'Leia e identifique o assunto principal de cada enunciado.' },
        { tempo: '25 min', acao: 'Resolva as 9 questões sem consultar o resumo.' },
        { tempo: '10 min', acao: 'Corrija e marque o conceito que precisa rever.' },
      ]),
      blocoRoteiroIntensivo('40 min', 'Correção e revisão do dia', 'Transformar os erros de proporção e ecologia em pontos concretos para revisar.', [
        { tempo: '15 min', acao: 'Releia as questões erradas de Matemática e refaça uma delas.' },
        { tempo: '15 min', acao: 'Revise o mapa de ecologia e complete o que ficou faltando.' },
        { tempo: '10 min', acao: 'Registre 3 dúvidas ou ideias-chave para retomar depois.' },
      ]),
    ],
  },
  {
    titulo: 'Porcentagem, gráficos, mecânica e eletricidade', dia: 'Quarta-feira', carga: '4h líquidas', blocos: [
      blocoVideoIntensivo('Porcentagem: aumentos e descontos', 'Calcular uma parte do todo e interpretar variações percentuais em situações do cotidiano.', [
        { titulo: 'Videoaulas de porcentagem', href: 'https://enemhub.com.br/topico/porcentagem' },
      ], [
        { tempo: '15 min', acao: 'Assista a uma aula curta e pause nos exemplos de aumento e desconto.' },
        { tempo: '10 min', acao: 'Anote dois jeitos de calcular porcentagem.' },
        { tempo: '15 min', acao: 'Resolva 2 exemplos: um de aumento e outro de desconto.' },
      ]),
      blocoQuestoesIntensivo('Questões diárias de Matemática', 'matematica', 9, 'Manter a prática diária e reconhecer que cálculo cada questão pede.', [
        { tempo: '5 min', acao: 'Leia as questões e destaque os dados numéricos.' },
        { tempo: '25 min', acao: 'Resolva as 9 questões sem consultar o resumo.' },
        { tempo: '10 min', acao: 'Corrija e anote onde o raciocínio mudou.' },
      ]),
      blocoVideoIntensivo('Gráficos e tabelas', 'Ler título, eixos, unidades e tendência antes de fazer contas.', [
        { titulo: 'Videoaulas de gráficos e tabelas', href: 'https://enemhub.com.br/topico/graficos-e-tabelas' },
      ], [
        { tempo: '15 min', acao: 'Assista a uma aula curta sobre leitura de gráficos.' },
        { tempo: '10 min', acao: 'Anote o que verificar nos eixos, na legenda e nas unidades.' },
        { tempo: '15 min', acao: 'Interprete 2 gráficos ou tabelas e escreva a conclusão em uma frase.' },
      ]),
      blocoVideoIntensivo('Mecânica: movimento, trabalho e energia', 'Relacionar movimento e transformação de energia aos dados apresentados no enunciado.', [
        { titulo: 'Videoaulas de movimento uniforme', href: 'https://enemhub.com.br/topico/movimento-uniforme' },
        { titulo: 'Videoaulas de trabalho e energia', href: 'https://enemhub.com.br/topico/trabalho' },
      ], [
        { tempo: '20 min', acao: 'Assista a uma aula de movimento e a um exemplo de trabalho ou energia.' },
        { tempo: '10 min', acao: 'Registre as grandezas e unidades usadas nos exemplos.' },
        { tempo: '10 min', acao: 'Refaça um exemplo identificando os dados antes de calcular.' },
      ]),
      blocoVideoIntensivo('Eletricidade: corrente, potência e consumo', 'Distinguir tensão, corrente e potência e interpretar o consumo em kWh.', [
        { titulo: 'Videoaulas de eletrodinâmica', href: 'https://enemhub.com.br/topico/eletrodinamica-i-corrente-potencia-resistores-e-lampadas' },
      ], [
        { tempo: '15 min', acao: 'Assista a uma aula sobre circuitos, potência ou consumo elétrico.' },
        { tempo: '10 min', acao: 'Anote o significado das unidades V, A, W e kWh.' },
        { tempo: '15 min', acao: 'Resolva um exemplo de consumo de energia de um aparelho.' },
      ]),
      blocoQuestoesIntensivo('Questões de Natureza + correção', 'natureza', 9, 'Aplicar mecânica e eletricidade em questões contextualizadas.', [
        { tempo: '5 min', acao: 'Leia os enunciados e identifique o fenômeno envolvido.' },
        { tempo: '25 min', acao: 'Resolva as 9 questões e registre as contas.' },
        { tempo: '10 min', acao: 'Confira as respostas e reveja uma questão errada.' },
      ]),
    ],
  },
  {
    titulo: 'Geometria, funções, química, corpo humano e doenças', dia: 'Quinta-feira', carga: '4h líquidas', blocos: [
      blocoVideoIntensivo('Geometria: áreas, perímetros e figuras', 'Escolher a fórmula adequada, conferir as medidas e manter as unidades corretas.', [
        { titulo: 'Videoaulas de áreas de figuras planas', href: 'https://enemhub.com.br/topico/area-de-todas-as-figuras-planas' },
      ], [
        { tempo: '15 min', acao: 'Assista a uma aula curta de áreas de figuras planas.' },
        { tempo: '10 min', acao: 'Desenhe as figuras e escreva as fórmulas principais.' },
        { tempo: '15 min', acao: 'Resolva 2 exemplos e confira se a unidade final faz sentido.' },
      ]),
      blocoQuestoesIntensivo('Questões diárias de Matemática', 'matematica', 9, 'Praticar a leitura matemática e revisar os conteúdos dos dois dias anteriores.', [
        { tempo: '5 min', acao: 'Leia as questões e marque o que cada uma pede.' },
        { tempo: '25 min', acao: 'Resolva as 9 questões sem olhar soluções.' },
        { tempo: '10 min', acao: 'Corrija e escolha um erro para explicar com suas palavras.' },
      ]),
      blocoVideoIntensivo('Funções: lei, gráfico e interpretação', 'Relacionar a regra da função ao gráfico e entender o papel de cada variável.', [
        { titulo: 'Videoaulas de função afim', href: 'https://enemhub.com.br/topico/funcao-afim-e-funcoes-lineares' },
      ], [
        { tempo: '15 min', acao: 'Assista a uma aula de função afim e observe a construção do gráfico.' },
        { tempo: '10 min', acao: 'Anote o que representam a taxa de variação e o valor inicial.' },
        { tempo: '15 min', acao: 'Leia um gráfico e resolva um exemplo de função.' },
      ]),
      blocoVideoIntensivo('Química geral e físico-química', 'Revisar propriedades e misturas e praticar cálculos simples de concentração ou quantidade de matéria.', [
        { titulo: 'Videoaulas de propriedades dos materiais', href: 'https://enemhub.com.br/topico/propriedades-dos-materiais' },
        { titulo: 'Videoaulas de concentração de soluções', href: 'https://enemhub.com.br/topico/tipos-e-calculos-de-concentracao-g-l-densidade-porcentagem-em-massa-ppm-mol-l-molalidade/ZwT6epapk-A' },
      ], [
        { tempo: '15 min', acao: 'Escolha uma aula curta de conceitos, propriedades ou misturas.' },
        { tempo: '15 min', acao: 'Escolha uma aula de concentração, reação ou cálculo químico.' },
        { tempo: '10 min', acao: 'Anote um exemplo resolvido e explique as etapas do cálculo.' },
      ]),
      blocoQuestoesIntensivo('Questões de Ciências da Natureza', 'natureza', 9, 'Usar interpretação e conceitos de Química e Biologia sem depender de decorar respostas.', [
        { tempo: '5 min', acao: 'Leia as questões e identifique o conteúdo cobrado.' },
        { tempo: '25 min', acao: 'Resolva as 9 questões e sinalize as que geraram dúvida.' },
        { tempo: '10 min', acao: 'Confira o gabarito e reveja o conceito de uma questão errada.' },
      ]),
      blocoVideoIntensivo('Corpo humano e doenças', 'Revisar a função dos sistemas do corpo e relacionar agentes infecciosos, transmissão e prevenção.', [
        { titulo: 'Videoaulas do sistema cardiovascular', href: 'https://enemhub.com.br/topico/sistema-cardiovascular' },
        { titulo: 'Videoaulas de viroses e doenças', href: 'https://enemhub.com.br/topico/viroses' },
      ], [
        { tempo: '15 min', acao: 'Escolha uma videoaula curta sobre um sistema do corpo humano.' },
        { tempo: '15 min', acao: 'Revise uma doença: agente causador, transmissão e prevenção.' },
        { tempo: '10 min', acao: 'Crie 3 flashcards de pergunta e resposta para revisar depois.' },
      ]),
    ],
  },
  {
    titulo: 'Simulado parcial do 2º dia', dia: 'Sexta-feira', carga: '4h líquidas', blocos: [
      blocoQuestoesIntensivo('Simulado: 20 questões de Matemática', 'matematica', 20, 'Treinar ritmo de prova e decidir quando seguir para a próxima questão.', [
        { tempo: '50 min', acao: 'Resolva as 20 questões em ritmo de prova e marque as que quer revisar.' },
        { tempo: '10 min', acao: 'Revise as marcações sem consultar o gabarito ainda.' },
      ], '60 min'),
      blocoQuestoesIntensivo('Simulado: 20 questões de Ciências da Natureza', 'natureza', 20, 'Treinar interpretação e controle do tempo em Física, Química e Biologia.', [
        { tempo: '50 min', acao: 'Resolva as 20 questões em ritmo de prova e marque as que quer revisar.' },
        { tempo: '10 min', acao: 'Revise as marcações sem consultar o gabarito ainda.' },
      ], '60 min'),
      blocoRoteiroIntensivo('60 min', 'Corrigir Matemática e anotar o motivo dos erros', 'Identificar se cada erro veio de conteúdo, cálculo, leitura ou falta de tempo.', [
        { tempo: '40 min', acao: 'Confira as 20 respostas e refaça as questões erradas.' },
        { tempo: '20 min', acao: 'Classifique os erros e escolha 3 pontos para revisar.' },
      ]),
      blocoRoteiroIntensivo('60 min', 'Corrigir Natureza e separar dúvidas para revisão', 'Transformar cada erro em uma dúvida ou conceito específico para retomar.', [
        { tempo: '40 min', acao: 'Confira as 20 respostas e releia os enunciados que errou.' },
        { tempo: '20 min', acao: 'Separe as dúvidas por Física, Química e Biologia.' },
      ]),
    ],
  },
  {
    titulo: 'Mapa mental e descanso', dia: 'Sábado', carga: 'Revisão leve · 30 a 45 min', blocos: [
      blocoRoteiroIntensivo('20 min', 'Mapa mental com fórmulas e erros mais importantes', 'Organizar só o que você quer lembrar antes da prova, sem abrir assuntos novos.', [
        { tempo: '5 min', acao: 'Escolha os erros mais frequentes do simulado.' },
        { tempo: '10 min', acao: 'Monte um mapa com fórmulas, conceitos e palavras-chave.' },
        { tempo: '5 min', acao: 'Feche o material e tente explicar o mapa de memória.' },
      ]),
      blocoQuestoesIntensivo('Uma questão leve de Matemática, sem cronômetro', 'matematica', 1, 'Manter o contato com Matemática sem transformar a revisão em outro simulado.', [
        { tempo: '10–25 min', acao: 'Resolva uma questão confortável, confira e encerre o estudo.' },
      ], '10–25 min', 'livre'),
      blocoRoteiroIntensivo('Fim do dia', 'Separar o necessário para a prova e dormir cedo', 'Chegar descansado e com o material preparado.', [
        { tempo: '5 min', acao: 'Separe documentos, canetas e o que vai levar.' },
        { tempo: 'Depois', acao: 'Encerre a revisão e priorize uma boa noite de sono.' },
      ]),
    ],
  },
];

function diaAtualIntensivo(intensivo) {
  if (intensivo?.modo !== 'dia2' || !intensivo?.inicio) return 0;
  const [ano, mes, dia] = intensivo.inicio.split('-').map(Number);
  const [anoHoje, mesHoje, diaHoje] = dataLocal().split('-').map(Number);
  const inicioUtc = Date.UTC(ano, mes - 1, dia);
  const hojeUtc = Date.UTC(anoHoje, mesHoje - 1, diaHoje);
  const diferenca = Math.floor((hojeUtc - inicioUtc) / 86400000);
  if (diferenca < 0) return 0;
  return diferenca < ETAPAS_INTENSIVAS.length ? diferenca + 1 : ETAPAS_INTENSIVAS.length + 1;
}

function avancarData(chave, dias) {
  const [ano, mes, dia] = chave.split('-').map(Number);
  const data = new Date(ano, mes - 1, dia);
  data.setDate(data.getDate() + dias);
  return dataLocal(data);
}

function proximaTerca(chave = dataLocal()) {
  const [ano, mes, dia] = chave.split('-').map(Number);
  const data = new Date(ano, mes - 1, dia);
  data.setDate(data.getDate() + ((2 - data.getDay() + 7) % 7));
  return dataLocal(data);
}

function dataCurta(chave) {
  const [, mes, dia] = chave.split('-').map(Number);
  return `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}`;
}

function chaveBlocoIntensivo(inicio, diaIndex, blocoIndex) {
  return `${avancarData(inicio, diaIndex)}:${blocoIndex}`;
}

function htmlBlocoIntensivo(bloco, diaIndex, blocoIndex, concluido, ativo) {
  const recursos = bloco.recursos || (bloco.href
    ? [{ titulo: 'Videoaulas + questões do tema', href: bloco.href }]
    : []);
  const linksRecursos = recursos.map((recurso) =>
    `<a class="botao-recurso" href="${escapar(recurso.href)}" target="_blank" rel="noopener noreferrer">▶ ${escapar(recurso.titulo)} ↗</a>`
  ).join('');
  const foco = bloco.foco
    ? `<p class="foco-intensivo"><b>Objetivo:</b> ${escapar(bloco.foco)}</p>`
    : '';
  const roteiro = Array.isArray(bloco.roteiro) && bloco.roteiro.length
    ? `<details class="roteiro-intensivo">
         <summary>Ver passo a passo</summary>
         <ol>${bloco.roteiro.map((passo) => `<li><b>${escapar(passo.tempo)}</b><span>${escapar(passo.acao)}</span></li>`).join('')}</ol>
       </details>`
    : '';
  const treino = bloco.sessao
    ? `<button class="secundario" data-intensivo-treino="true" data-area="${escapar(bloco.sessao.area)}" data-tamanho="${bloco.sessao.tamanho}" data-modo="${escapar(bloco.sessao.modo || 'porQuestao')}" data-bloco="${diaIndex}-${blocoIndex}">${escapar(bloco.sessao.tamanho === 1 ? 'Fazer 1 questão no Prumo' : `Fazer ${bloco.sessao.tamanho} questões no Prumo`)}</button>`
    : '';
  const marcar = ativo
    ? `<button class="botao-conclusao-intensivo ${concluido ? 'concluido' : ''}" data-intensivo-concluir="${diaIndex}-${blocoIndex}" aria-pressed="${concluido}" aria-label="${concluido ? 'Desmarcar tarefa concluída' : 'Marcar tarefa como concluída'}">${concluido ? '✓ Tarefa concluída' : 'Marcar como concluída'}</button>`
    : '';
  return `<div class="bloco-intensivo">
    <div class="bloco-intensivo-cabecalho"><span>${escapar(bloco.duracao)}</span><b>${escapar(bloco.titulo)}</b></div>
    ${foco}${roteiro}
    ${(linksRecursos || treino || marcar) ? `<div class="acoes-intensivo">${linksRecursos}${treino}${marcar}</div>` : ''}
  </div>`;
}

function cartaoIntensivo() {
  const sprint = est.estado.intensivo || { inicio: null, diasConcluidos: [], blocosConcluidos: [] };
  const temPlano = sprint.modo === 'dia2' && Boolean(sprint.inicio);
  const dia = temPlano ? diaAtualIntensivo(sprint) : 0;
  const concluidos = new Set(sprint.blocosConcluidos || []);
  const totalTarefas = ETAPAS_INTENSIVAS.reduce((total, item) => total + item.blocos.length, 0);
  const chaveTarefa = (diaIndex, blocoIndex) => chaveBlocoIntensivo(sprint.inicio, diaIndex, blocoIndex);
  const feitos = temPlano
    ? ETAPAS_INTENSIVAS.reduce((total, item, diaIndex) => total + item.blocos.filter((_, blocoIndex) => concluidos.has(chaveTarefa(diaIndex, blocoIndex))).length, 0)
    : 0;
  const percentual = Math.round(feitos / totalTarefas * 100);
  const inicioProposto = proximaTerca();
  const status = !temPlano
    ? `Ative para começar na terça-feira, ${dataCurta(inicioProposto)}.`
    : dia === 0
      ? `Seu plano começa na terça-feira, ${dataCurta(sprint.inicio)}.`
      : dia <= ETAPAS_INTENSIVAS.length
        ? `Etapa ${dia} de ${ETAPAS_INTENSIVAS.length} · ${feitos} de ${totalTarefas} tarefas concluídas.`
        : `Ciclo concluído · ${feitos} de ${totalTarefas} tarefas concluídas.`;
  const dias = ETAPAS_INTENSIVAS.map((item, i) => {
    const numero = i + 1;
    const data = temPlano ? dataCurta(avancarData(sprint.inicio, i)) : item.dia;
    const totalDia = item.blocos.length;
    const feitosDia = item.blocos.filter((_, j) => temPlano && concluidos.has(chaveTarefa(i, j))).length;
    const aberto = numero === dia || (!temPlano && numero === 1);
    return `<details class="dia-intensivo" ${aberto ? 'open' : ''}>
      <summary><span>${escapar(data)} · ${escapar(item.titulo)}</span><b>${temPlano ? `${feitosDia}/${totalDia} feitas` : `${item.carga}`}</b></summary>
      <div class="lista-blocos-intensivo">${item.blocos.map((bloco, j) => htmlBlocoIntensivo(bloco, i, j, temPlano && concluidos.has(chaveTarefa(i, j)), temPlano)).join('')}</div>
    </details>`;
  }).join('');

  return `<div class="cartao cartao-intensivo">
    <h3>Intensivo para o 2º dia do ENEM</h3>
    <p class="fraco">${escapar(status)}</p>
    <p class="fraco">Segunda livre. Terça a sexta: 4 horas líquidas por dia, com videoaulas nos blocos de conteúdo. O simulado de sexta tem 20 questões de Matemática e 20 de Natureza, mais correção. Sábado: mapa mental, uma questão leve de Matemática e cama cedo. Domingo: dia da prova.</p>
    ${temPlano ? `<div class="barra"><i style="width:${percentual}%"></i></div>` : ''}
    <div class="lista-dias-intensivo">${dias}</div>
    ${temPlano
      ? `<button class="secundario" id="btn-reiniciar-intensivo" style="margin-top:12px">Reiniciar intensivo · começa ${dataCurta(inicioProposto)}</button>
         <button class="secundario" id="btn-desativar-intensivo" style="margin-top:8px">Desativar intensivo</button>`
      : '<button class="primario" id="btn-ativar-intensivo" style="margin-top:14px">Ativar meu intensivo</button>'}
    <p class="fraco" style="margin-top:12px">Cada bloco mostra o objetivo e um passo a passo com tempo. Ative o intensivo para marcar cada tarefa como concluída; seu progresso fica salvo. Abra “Ver passo a passo” para seguir a sessão.</p>
  </div>`;
}

function ligarIntensivo() {
  const ativar = () => {
    est.estado.intensivo = { modo: 'dia2', inicio: proximaTerca(), diasConcluidos: [], blocosConcluidos: [] };
    est.salvarLocal(); est.sincronizar(); desenharPlano();
  };
  if ($('#btn-ativar-intensivo')) $('#btn-ativar-intensivo').onclick = ativar;
  if ($('#btn-reiniciar-intensivo')) $('#btn-reiniciar-intensivo').onclick = ativar;
  if ($('#btn-desativar-intensivo')) $('#btn-desativar-intensivo').onclick = () => {
    est.estado.intensivo = { modo: null, inicio: null, diasConcluidos: [], blocosConcluidos: [] };
    est.salvarLocal(); est.sincronizar(); desenharPlano();
  };
  document.querySelectorAll('[data-intensivo-concluir]').forEach((botao) => {
    botao.onclick = () => {
      const [diaIndex, blocoIndex] = botao.dataset.intensivoConcluir.split('-').map(Number);
      const diaAberto = botao.closest('.dia-intensivo');
      const sprint = est.estado.intensivo;
      const chave = chaveBlocoIntensivo(sprint.inicio, diaIndex, blocoIndex);
      const marcados = new Set(sprint.blocosConcluidos || []);
      if (marcados.has(chave)) marcados.delete(chave);
      else marcados.add(chave);
      sprint.blocosConcluidos = [...marcados];
      est.salvarLocal();
      est.sincronizar();
      desenharPlano();
      const dias = document.querySelectorAll('.dia-intensivo');
      if (diaAberto) dias[diaIndex]?.setAttribute('open', '');
    };
  });
  document.querySelectorAll('[data-intensivo-treino="true"]').forEach((botao) => {
    botao.onclick = () => {
      const area = botao.dataset.area;
      const tamanho = Number(botao.dataset.tamanho);
      const modo = botao.dataset.modo || 'porQuestao';
      est.estado.preferenciaSessao = {
        ...(est.estado.preferenciaSessao || {}),
        area,
        tamanho,
        modo,
        semRevisao: true,
      };
      est.salvarLocal();
      sessao = null;
      ir('sessao');
      montarEIniciar();
    };
  });
}

/**
 * Distribui as áreas pelos dias em que você estuda, na proporção da
 * prioridade. Dia de redação não recebe área: escrever uma redação já toma
 * a sessão inteira, e empilhar as duas coisas é como o cronograma morre.
 */
function montarSemana(prioridades, rotina) {
  const diasRedacao = new Set(rotina.redacao || []);
  const diasEstudo = (rotina.estudo || [1, 2, 3, 4, 5]).filter((d) => !diasRedacao.has(d));

  // Cotas proporcionais, garantindo ao menos um dia para cada área medida.
  const cotas = prioridades.map((p) => ({
    area: p.area,
    ideal: (p.percentual / 100) * diasEstudo.length,
    dados: 0,
  }));

  const escala = [];
  for (let k = 0; k < diasEstudo.length; k++) {
    // A cada rodada entra quem está mais atrás da própria cota.
    cotas.sort((x, y) => (y.ideal - y.dados) - (x.ideal - x.dados));
    cotas[0].dados += 1;
    escala.push(cotas[0].area);
  }

  return DIAS.map((d) => ({
    ...d,
    redacao: diasRedacao.has(d.i),
    area: diasRedacao.has(d.i) ? null : (diasEstudo.includes(d.i) ? escala[diasEstudo.indexOf(d.i)] : null),
    folga: !diasRedacao.has(d.i) && !diasEstudo.includes(d.i),
  }));
}

function cartaoRotina(prioridades) {
  const e = est.estado;
  const rotina = e.rotina || { redacao: [3], estudo: [1, 2, 3, 4, 5] };
  const semana = montarSemana(prioridades, rotina);
  const hoje = new Date().getDay();

  return `<div class="cartao">
    <h3>Sua semana</h3>
    <p class="fraco" style="margin-bottom:14px">Toque num dia para marcar ou desmarcar
    estudo. Toque no lápis para dizer que ali é dia de redação.</p>

    <div class="semana">
      ${semana.map((d) => `
        <div class="dia ${d.folga ? 'folga' : ''} ${d.redacao ? 'redacao' : ''} ${d.i === hoje ? 'hoje' : ''}">
          <button class="dia-toque" data-dia="${d.i}" title="${d.nome}">
            <span class="dia-letra">${d.curto}</span>
            <span class="dia-marca">${d.redacao ? 'Red.' : d.area ? NOME_AREA[d.area].slice(0, 4) : '—'}</span>
          </button>
          <button class="dia-redacao" data-redacao="${d.i}" title="Marcar ${d.nome} como dia de redação"
            aria-pressed="${d.redacao}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>
          </button>
        </div>`).join('')}
    </div>

    <div class="semana-lista">
      ${semana.map((d) => `
        <div class="linha-dia ${d.i === hoje ? 'hoje' : ''}">
          <b>${d.nome}</b>
          <span class="${d.folga ? 'fraco' : ''}">${
            d.redacao ? 'Redação' : d.area ? NOME_AREA[d.area] : 'Descanso'
          }</span>
        </div>`).join('')}
    </div>
  </div>`;
}

function ligarRotina(prioridades) {
  const e = est.estado;
  if (!e.rotina) e.rotina = { redacao: [3], estudo: [1, 2, 3, 4, 5] };

  document.querySelectorAll('.dia-toque').forEach((b) => {
    b.onclick = () => {
      const d = Number(b.dataset.dia);
      const estudo = new Set(e.rotina.estudo);
      const redacao = new Set(e.rotina.redacao);
      if (redacao.has(d)) redacao.delete(d);
      else if (estudo.has(d)) estudo.delete(d);
      else estudo.add(d);
      e.rotina = { estudo: [...estudo].sort(), redacao: [...redacao].sort() };
      est.salvarLocal(); est.sincronizar(); desenharPlano();
    };
  });

  document.querySelectorAll('.dia-redacao').forEach((b) => {
    b.onclick = () => {
      const d = Number(b.dataset.redacao);
      const redacao = new Set(e.rotina.redacao);
      const estudo = new Set(e.rotina.estudo);
      if (redacao.has(d)) { redacao.delete(d); estudo.add(d); }
      else { redacao.add(d); estudo.add(d); }
      e.rotina = { estudo: [...estudo].sort(), redacao: [...redacao].sort() };
      est.salvarLocal(); est.sincronizar(); desenharPlano();
    };
  });
}

function desenharPlano() {
  const e = est.estado;
  const pesos = e.alvo.pesos || Object.fromEntries(AREAS.map((area) => [area, 1]));
  const prioridades = calcularPrioridades(pesos, e.thetas);
  let html = cartaoIntensivo();

  if (!e.alvo.pesos) {
    $('#plano-conteudo').innerHTML = `${html}<p class="fraco">Escolha seu curso no perfil para personalizar as prioridades do plano.</p>`;
    ligarIntensivo();
    return;
  }

  html += cartaoRotina(prioridades);

  html += `<div class="cartao">
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
  ligarRotina(prioridades);
  ligarIntensivo();
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

/**
 * Identidade vem inteira da conta Google da escola: nome, e-mail e foto.
 * Não há campo para editar — em plataforma escolar, nome digitado à mão vira
 * apelido e some a ligação com a conta institucional.
 */
function cabecalhoPerfil() {
  const e = est.estado;
  const plano = PLANOS[e.plano] || PLANOS.gratuito;
  const nome = e.nome || 'Estudante';
  const iniciais = nome.trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

  const avatar = e.foto
    ? `<img class="avatar" src="${escapar(e.foto)}" alt="" referrerpolicy="no-referrer"
         onerror="this.replaceWith(Object.assign(document.createElement('div'),
           {className:'avatar', textContent:'${escapar(iniciais)}'}))">`
    : `<div class="avatar" aria-hidden="true">${escapar(iniciais)}</div>`;

  return `<div class="cartao perfil-topo">
    ${avatar}
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
  $('#btn-exportar').onclick = () => est.exportarBackup();
  $('#btn-importar').onclick = () => $('#in-arquivo').click();
  $('#in-arquivo').onchange = async (ev) => {
    try { await est.importarBackup(ev.target.files[0]); desenharPerfil(); }
    catch (err) { alert(err.message); }
  };
  $('#btn-offline').onclick = async () => {
    const status = $('#offline-status');
    status.textContent = 'Baixando…';
    try {
      const { prepararOffline } = await import('./dados.js');
      const resultado = await prepararOffline((p) => { status.textContent = `Baixando bancos e imagens… ${Math.round(p * 100)}%`; });
      status.textContent = resultado.falhas
        ? `Bancos prontos; ${resultado.imagens} imagens guardadas e ${resultado.falhas} não baixaram. As imagens pendentes precisam de internet.`
        : `Pronto. Bancos e ${resultado.imagens} imagens guardados para uso offline.`;
    } catch (err) {
      status.textContent = `Não consegui preparar o modo offline: ${err.message}`;
    }
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
    if (est.estado.uid === 'local') { await est.puxarDaNuvem('local'); await abrirApp(); }
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
    // Identidade sempre espelha a conta: se a escola trocar o nome, o app segue.
    if (usuario.nome) est.estado.nome = usuario.nome.split('@')[0];
    est.estado.email = usuario.email || null;
    est.estado.foto = usuario.foto || null;
    est.salvarLocal();
    await abrirApp();
  });

  // O SDK não veio: segue em modo local para o app não ficar em branco.
  if (!conectou) {
    quedaParaLocal = true;
    if (est.estado.uid === 'local') { await est.puxarDaNuvem('local'); await abrirApp(); }
    else { ir('entrar'); desenharEntrar(); }
  }
}

// Avisa a rede de segurança do index.html que os módulos carregaram.
window.__appIniciou = true;

principal();
