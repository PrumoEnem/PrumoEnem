/** app.js — roteador e telas. */

import { AREAS, NOME_AREA, carregarQuestoes, carregarCursos, carregarVocabulario } from './dados.js';
import { estimarTheta, estimarPorAcertos, faixaDeNota, atualizarTheta, thetaParaNota } from './tri.js';
import { calcularPrioridades, escolherArea, montarSessao, simularNotaSisu, THETA_ALVO } from './motor.js';
import * as srs from './srs.js';
import * as est from './estado.js';
import * as nuvem from './nuvem.js';
import * as ia from './ia.js';
import { MODO_LOCAL } from './config.js';

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
      (_, url) => `<img src="${url}" alt="Imagem da questão" loading="lazy">`)
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
  if (tela === 'plano') desenharPlano();
  if (tela === 'perfil') desenharPerfil();
  if (tela === 'sessao' && !sessao) iniciarSessao();
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
    <div style="margin-top:22px">
      <label for="in-email">E-mail</label>
      <input id="in-email" type="email" autocomplete="email">
      <label for="in-senha">Senha</label>
      <input id="in-senha" type="password" autocomplete="current-password">
      <div class="linha-botoes" style="margin-top:14px">
        <button id="btn-entrar">Entrar</button>
        <button class="secundario" id="btn-criar">Criar conta</button>
      </div>
    </div>`;

  const erro = (e) => { $('#entrar-erro').innerHTML = `<div class="erro-caixa">${escapar(e.message)}</div>`; };
  $('#btn-google').onclick = () => nuvem.entrarComGoogle().catch(erro);
  $('#btn-entrar').onclick = () =>
    nuvem.entrarComEmail($('#in-email').value, $('#in-senha').value, false).catch(erro);
  $('#btn-criar').onclick = () =>
    nuvem.entrarComEmail($('#in-email').value, $('#in-senha').value, true).catch(erro);
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

async function iniciarSessao() {
  const e = est.estado;
  if (!e.alvo.pesos) return ir('perfil');

  $('#sessao-conteudo').innerHTML = '<div class="carregando">Montando sua sessão</div>';

  const prioridades = calcularPrioridades(e.alvo.pesos, e.thetas);
  const area = escolherArea(prioridades);

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
  const { questoes: escolhidas, calibrada } = montarSessao(questoes, theta, e.questoesVistas[area]);

  sessao = {
    id: `s-${Date.now()}`,
    area, calibrada,
    questoes: escolhidas,
    indice: 0,
    respostas: [],
    vocabulario: srs.proximoVocabulario(bancoVocabulario, e.vocabulario),
    respostaVocabulario: null,
    inicio: Date.now(),
  };
  desenharQuestao();
}

let cronometro = null;

function desenharQuestao() {
  clearInterval(cronometro);
  const s = sessao;

  if (s.indice >= s.questoes.length) return desenharVocabulario();

  const q = s.questoes[s.indice];
  const total = s.questoes.length + 1;

  $('#sessao-conteudo').innerHTML = `
    <div class="sessao-topo">
      <div class="sessao-info">
        <span class="area">${NOME_AREA[s.area]}</span>
        <span class="contador">${s.indice + 1} de ${total}</span>
        <span class="cronometro" id="cron">3:00</span>
      </div>
      <div class="barra tempo"><i id="barra-tempo" style="width:100%"></i></div>
    </div>
    ${s.calibrada || s.indice > 0 ? '' : '<p class="fraco aviso-calibracao">Dificuldade ainda não calibrada — veja o README para importar os parâmetros do INEP.</p>'}
    <div class="enunciado">${formatarEnunciado(q.enunciado, q.imagens)}</div>
    <div id="alternativas">
      ${q.alternativas.map((a) => `
        <button class="alternativa" data-letra="${escapar(a.letra)}">
          <span class="letra">${escapar(a.letra)}</span>
          <span>${a.imagem ? `<img src="${escapar(a.imagem)}" alt="Alternativa ${escapar(a.letra)}" loading="lazy">` : formatarTexto(a.texto)}</span>
        </button>`).join('')}
    </div>
    <div class="rodape-sessao">
      <button class="primario" id="btn-confirmar" disabled>Confirmar</button>
      <p class="fraco centro" style="margin-top:10px">A correção vem no fim da sessão.</p>
    </div>`;

  let marcada = null;
  document.querySelectorAll('.alternativa').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.alternativa').forEach((x) => x.classList.remove('marcada'));
      b.classList.add('marcada');
      marcada = b.dataset.letra;
      $('#btn-confirmar').disabled = false;
    };
  });

  const inicio = Date.now();
  let restante = SEGUNDOS_POR_QUESTAO;
  const tick = () => {
    restante -= 1;
    const el = $('#cron');
    if (!el) return clearInterval(cronometro);
    const m = Math.floor(Math.max(0, restante) / 60);
    const seg = String(Math.max(0, restante) % 60).padStart(2, '0');
    el.textContent = `${m}:${seg}`;
    el.classList.toggle('urgente', restante <= 30);
    $('#barra-tempo').style.width = `${Math.max(0, (restante / SEGUNDOS_POR_QUESTAO) * 100)}%`;
    if (restante <= 0) { clearInterval(cronometro); confirmar(marcada, inicio, true); }
  };
  cronometro = setInterval(tick, 1000);

  $('#btn-confirmar').onclick = () => confirmar(marcada, inicio, false);
}

function confirmar(marcada, inicio, estourou) {
  clearInterval(cronometro);
  const q = sessao.questoes[sessao.indice];
  sessao.respostas.push({
    questao: q,
    marcada: marcada || null,
    acertou: marcada === q.gabarito,
    segundos: Math.round((Date.now() - inicio) / 1000),
    estourouTempo: estourou,
  });
  sessao.indice += 1;
  desenharQuestao();
}

function desenharVocabulario() {
  const item = sessao.vocabulario;
  const rotulo = { conectivo: 'Conectivo', repertorio: 'Repertório', formal: 'Vocabulário formal' }[item.tipo];
  const total = sessao.questoes.length + 1;

  $('#sessao-conteudo').innerHTML = `
    <div class="sessao-topo">
      <div class="sessao-info">
        <span class="area">${rotulo}</span>
        <span class="contador">${total} de ${total}</span>
        <span class="fraco">sem tempo</span>
      </div>
    </div>
    <div class="enunciado">${escapar(item.pergunta)}</div>
    <div id="alternativas">
      ${item.alternativas.map((a, i) => `
        <button class="alternativa" data-i="${i}">
          <span class="letra">${'ABCD'[i]}</span><span>${escapar(a)}</span>
        </button>`).join('')}
    </div>
    <div class="rodape-sessao">
      <button class="primario" id="btn-fim" disabled>Ver resultado</button>
      <p class="fraco centro" style="margin-top:10px">Responder é obrigatório. Acertar, não — o item volta depois.</p>
    </div>`;

  let escolha = null;
  document.querySelectorAll('.alternativa').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.alternativa').forEach((x) => x.classList.remove('marcada'));
      b.classList.add('marcada');
      escolha = item.alternativas[Number(b.dataset.i)];
      $('#btn-fim').disabled = false;
    };
  });

  $('#btn-fim').onclick = () => {
    sessao.respostaVocabulario = { item, escolha, acertou: escolha === item.correta };
    finalizarSessao();
  };
}

// ---------------------------------------------------------------- resultado

async function finalizarSessao() {
  const s = sessao;
  const e = est.estado;
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

function desenharCartoes() {
  const pendentes = srs.vencidos(est.estado.flashcards);
  const alvo = $('#cartoes-conteudo');

  if (!pendentes.length) {
    alvo.innerHTML = `<div class="vazio">
      <h3>Nada para revisar hoje</h3>
      <p>Os cartões nascem dos seus erros. Faça uma sessão e eles aparecem aqui.</p>
      <p class="fraco">${est.estado.flashcards.length} ${est.estado.flashcards.length === 1 ? 'cartão no total' : 'cartões no total'}</p>
    </div>`;
    return;
  }

  cartaoAtual = pendentes[0];
  alvo.innerHTML = `
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

function desenharPerfil() {
  const e = est.estado;
  const lista = cursos?.cursos || [];

  $('#perfil-conteudo').innerHTML = `
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
      <h3>Redação</h3>
      <label for="in-redacao">Sua última nota (0 a 1000)</label>
      <input id="in-redacao" type="number" min="0" max="1000" value="${e.notaRedacao ?? ''}" inputmode="numeric">
      <p class="fraco">Registre aqui a nota que você recebeu no Redação Paraná ou num simulado. Ela entra na média ponderada.</p>
      <a class="botao secundario" href="https://www.educacao.pr.gov.br/" target="_blank" rel="noopener">Abrir o Redação Paraná</a>
    </div>

    <div class="cartao">
      <h3>Meta semanal</h3>
      <label for="in-meta">Sessões por semana</label>
      <input id="in-meta" type="number" min="1" max="21" value="${e.metaSemanal.sessoes}" inputmode="numeric">
    </div>

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
  $('#in-redacao').onchange = (ev) => {
    const v = Number(ev.target.value);
    e.notaRedacao = ev.target.value === '' ? null : Math.min(1000, Math.max(0, v));
    est.salvarLocal(); est.sincronizar();
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
    const { prepararOffline } = await import('./dados.js');
    await prepararOffline((p) => { status.textContent = `Baixando… ${Math.round(p * 100)}%`; });
    status.textContent = 'Pronto. O app agora abre sem internet.';
  };
  if ($('#btn-sair')) $('#btn-sair').onclick = () => nuvem.sair().then(() => location.reload());
}

// ---------------------------------------------------------------- teclado

/** Atalhos de teclado: só fazem sentido no computador, mas não atrapalham. */
document.addEventListener('keydown', (ev) => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(ev.target.tagName)) return;
  const tecla = ev.key.toUpperCase();

  if ($('#tela-sessao')?.classList.contains('ativa')) {
    const alternativas = [...document.querySelectorAll('.alternativa')];
    const posicao = 'ABCDE'.indexOf(tecla);
    if (posicao >= 0 && alternativas[posicao]) { alternativas[posicao].click(); ev.preventDefault(); return; }
    if (ev.key === 'Enter') {
      const seguir = $('#btn-confirmar') || $('#btn-fim');
      if (seguir && !seguir.disabled) { seguir.click(); ev.preventDefault(); }
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

  const conectou = await nuvem.observarUsuario(async (usuario) => {
    if (!usuario) { ir('entrar'); desenharEntrar(); return; }
    await est.puxarDaNuvem(usuario.uid);
    await abrirApp();
  });

  // O SDK não veio: segue em modo local para o app não ficar em branco.
  if (!conectou) {
    if (est.estado.uid) { await est.puxarDaNuvem(est.estado.uid); await abrirApp(); }
    else { ir('entrar'); desenharEntrar(); }
  }
}

principal();
