/** Pomodoro em janela separada; o áudio só começa após ativação explícita. */

const estilos = `
  :root{color-scheme:dark;--bg:#10131d;--card:#1e2333;--line:#313850;--text:#eceefa;--muted:#9ca5be;--blue:#8cc6ff;--amber:#f4b350;--green:#52c793}
  *{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(120% 50% at 50% 0%,#202941 0%,var(--bg) 68%);color:var(--text);font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;padding:28px 20px 38px}
  main{max-width:420px;margin:0 auto}.topo{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:22px}.marca{font-size:13px;letter-spacing:.12em;font-weight:700;color:var(--muted)}.marca b{color:var(--blue)}.janela{font-size:12px;color:#b5c9e5;background:#1c2d46;padding:5px 10px;border:1px solid #2d496b;border-radius:999px}
  h1{font-size:26px;line-height:1.15;margin:0 0 7px;letter-spacing:-.04em}.sub{color:var(--muted);margin:0 0 23px;font-size:14px}.cartao{background:linear-gradient(155deg,#222a40,var(--card) 58%);border:1px solid var(--line);border-radius:24px;padding:23px 20px 20px;text-align:center;box-shadow:0 20px 60px #0004}.fase{color:var(--amber);text-transform:uppercase;letter-spacing:.16em;font-size:11px;font-weight:700}.fase.pausa{color:var(--green)}
  .anel{width:218px;height:218px;margin:16px auto 18px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(var(--amber) var(--progresso,0%),#10131d 0);transition:background .3s}.anel.pausa{background:conic-gradient(var(--green) var(--progresso,0%),#10131d 0)}.anel::before{content:"";grid-area:1/1;width:190px;height:190px;border-radius:50%;background:linear-gradient(155deg,#20283d,#171b29);border:1px solid #343e58}.tempo{grid-area:1/1;z-index:1;font-size:52px;font-variant-numeric:tabular-nums;font-weight:700;letter-spacing:-.06em}.ciclos{font-size:13px;color:var(--muted);margin-bottom:18px}.ciclos b{color:var(--text)}
  .linha{display:flex;gap:9px}.linha>*{flex:1}.botao{border:1px solid #44506d;border-radius:13px;min-height:48px;background:#2b334a;color:var(--text);font:600 15px system-ui;cursor:pointer;padding:10px 12px}.botao:hover{filter:brightness(1.15)}.principal{background:linear-gradient(180deg,#9bd0ff,#62aef8);border-color:#a5d3ff;color:#0d1b2c}.discreto{width:auto;min-height:40px;padding:8px 13px;font-size:13px;background:transparent}.linha-topo{align-items:center;margin:19px 0 11px}.rotulo{font-size:13px;color:var(--muted);text-align:left}.select{width:190px;padding:10px 12px;border:1px solid var(--line);border-radius:11px;background:#181d2c;color:var(--text);font:14px system-ui}.timer-msg{min-height:20px;margin:10px 0 0;color:#c3cbe0;font-size:12px}.audio{margin-top:16px;background:#181d29;border:1px solid #2c3348;border-radius:16px;padding:15px;text-align:left}.audio-titulo{display:flex;justify-content:space-between;align-items:center;gap:12px;font-weight:650}.audio-hint{font-size:12px;color:var(--muted);margin:4px 0 0}.chave{display:flex;align-items:center;gap:9px;color:var(--muted);font-size:13px;margin-top:13px}.chave input{accent-color:var(--blue);width:18px;height:18px}.volume{width:100%;accent-color:var(--blue);margin:13px 0 0}.estado{min-height:22px;color:var(--muted);font-size:12px;margin:10px 0 0}.nota{margin:17px 2px 0;color:#727c96;font-size:11px;text-align:center}
  @media(max-width:360px){body{padding:20px 14px 30px}.anel{width:195px;height:195px}.anel::before{width:170px;height:170px}.tempo{font-size:46px}.select{width:165px}}
`;

const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#10131d"><title>Pomodoro · PrumoENEM</title><style>${estilos}</style></head><body>
  <main>
    <div class="topo"><div class="marca">PRUMO<b>ENEM</b></div><span class="janela">JANELA DE FOCO</span></div>
    <h1>Presença total.<br>Uma etapa de cada vez.</h1>
    <p class="sub">Estude em blocos curtos e faça pausas de verdade.</p>
    <section class="cartao" aria-label="Cronômetro Pomodoro">
      <div id="fase" class="fase">FOCO</div>
      <div id="anel" class="anel" role="timer" aria-live="off"><span id="tempo" class="tempo">25:00</span></div>
      <div class="ciclos"><b id="contagem">0 pomodoros</b> concluídos hoje</div>
      <div class="linha"><button id="iniciar" class="botao principal">Começar foco</button><button id="reiniciar" class="botao">Reiniciar</button></div>
      <div class="linha" style="margin-top:9px"><button id="pular" class="botao discreto">Pular etapa</button></div>
      <p id="timer-status" class="timer-msg" aria-live="polite">Quando estiver pronto, comece seu primeiro bloco.</p>
      <div class="linha linha-topo"><span class="rotulo">Ritmo do estudo</span><select id="ritmo" class="select" aria-label="Duração dos blocos"><option value="25">25 min foco · 5 min pausa</option><option value="50">50 min foco · 10 min pausa</option></select></div>
    </section>
    <section class="audio" aria-label="Ruído marrom">
      <div class="audio-titulo"><span>Ruído marrom</span><span aria-hidden="true">〰</span></div>
      <p class="audio-hint">Som grave e contínuo para abafar distrações. O áudio começa desligado.</p>
      <label class="chave"><input id="audio-ligado" type="checkbox"> Ativar ruído marrom</label>
      <input id="volume" class="volume" type="range" min="0" max="60" value="22" aria-label="Volume do ruído marrom" disabled>
      <p id="audio-status" class="estado" aria-live="polite">Desligado — ative quando quiser.</p>
    </section>
    <p class="nota">A pausa é parte do estudo. Levante, alongue e descanse os olhos.</p>
  </main>
</body></html>`;

function formatar(segundos) {
  const min = Math.floor(segundos / 60).toString().padStart(2, '0');
  const seg = (segundos % 60).toString().padStart(2, '0');
  return `${min}:${seg}`;
}

export function abrirPomodoro() {
  const popup = window.open('', 'prumo-enem-pomodoro', 'popup=yes,width=480,height=790,resizable=yes,scrollbars=yes');
  if (!popup) {
    window.alert('O navegador bloqueou a janela do Pomodoro. Libere pop-ups para este site e tente novamente.');
    return false;
  }

  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  popup.focus();

  const doc = popup.document;
  const $ = (seletor) => doc.querySelector(seletor);
  const ritmo = $('#ritmo');
  const faseEl = $('#fase');
  const anel = $('#anel');
  const tempoEl = $('#tempo');
  const iniciar = $('#iniciar');
  const pular = $('#pular');
  const volume = $('#volume');
  const audioLigado = $('#audio-ligado');
  let fase = 'foco';
  let pomodoros = 0;
  let duracao = Number(ritmo.value) * 60;
  let restante = duracao;
  let finalEm = null;
  let intervalo = null;
  let contextoAudio = null;
  let fonteAudio = null;
  let ganhoAudio = null;

  function duracaoDaFase() {
    if (fase === 'foco') return Number(ritmo.value) * 60;
    if (fase === 'pausa-longa') return 15 * 60;
    return (Number(ritmo.value) === 50 ? 10 : 5) * 60;
  }

  function mostrar() {
    tempoEl.textContent = formatar(restante);
    faseEl.textContent = fase === 'foco' ? 'FOCO' : fase === 'pausa-longa' ? 'PAUSA LONGA' : 'PAUSA';
    faseEl.classList.toggle('pausa', fase !== 'foco');
    anel.classList.toggle('pausa', fase !== 'foco');
    const pct = Math.max(0, Math.min(100, ((duracaoDaFase() - restante) / duracaoDaFase()) * 100));
    anel.style.setProperty('--progresso', `${pct}%`);
    iniciar.textContent = intervalo ? 'Pausar' : fase === 'foco' ? 'Começar foco' : 'Começar pausa';
    ritmo.disabled = !!intervalo;
    $('#contagem').textContent = `${pomodoros} ${pomodoros === 1 ? 'pomodoro' : 'pomodoros'}`;
    popup.document.title = `${formatar(restante)} · ${fase === 'foco' ? 'Foco' : 'Pausa'} · PrumoENEM`;
  }

  function limparIntervalo() {
    if (intervalo) popup.clearInterval(intervalo);
    intervalo = null;
    finalEm = null;
  }

  function proximaFase(mensagem, focoConcluido = false) {
    limparIntervalo();
    if (fase === 'foco') {
      if (focoConcluido) pomodoros += 1;
      fase = focoConcluido && pomodoros > 0 && pomodoros % 4 === 0 ? 'pausa-longa' : 'pausa';
    } else fase = 'foco';
    restante = duracaoDaFase();
    mostrar();
    $('#timer-status').textContent = mensagem;
  }

  function tick() {
    restante = Math.max(0, Math.ceil((finalEm - Date.now()) / 1000));
    if (restante <= 0) {
      const concluiu = fase === 'foco';
      const pausaLonga = concluiu && (pomodoros + 1) % 4 === 0;
      proximaFase(concluiu
        ? `Foco concluído. ${pausaLonga ? 'Hora da pausa longa.' : 'Faça uma pausa antes do próximo bloco.'}`
        : 'Pausa concluída. Quando estiver pronto, comece o próximo foco.', concluiu);
      return;
    }
    mostrar();
  }

  iniciar.onclick = () => {
    if (intervalo) {
      restante = Math.max(0, Math.ceil((finalEm - Date.now()) / 1000));
      limparIntervalo();
      $('#timer-status').textContent = 'Cronômetro pausado. Retome quando quiser.';
    } else {
      finalEm = Date.now() + restante * 1000;
      intervalo = popup.setInterval(tick, 250);
      $('#timer-status').textContent = `${fase === 'foco' ? 'Foco' : 'Pausa'} em andamento.`;
      tick();
    }
    mostrar();
  };

  $('#reiniciar').onclick = () => {
    limparIntervalo();
    fase = 'foco';
    restante = duracaoDaFase();
    mostrar();
    $('#timer-status').textContent = 'Cronômetro reiniciado. Quando estiver pronto, comece um novo foco.';
  };

  pular.onclick = () => {
    proximaFase(fase === 'foco'
      ? 'Bloco pulado. Inicie a pausa ou ajuste seu ritmo.'
      : 'Pausa pulada. Inicie o próximo bloco quando estiver pronto.');
  };

  ritmo.onchange = () => {
    duracao = duracaoDaFase();
    restante = duracao;
    mostrar();
  };

  async function desligarAudio() {
    try { fonteAudio?.stop(); } catch { /* a fonte pode já ter terminado */ }
    fonteAudio = null;
    if (contextoAudio && contextoAudio.state !== 'closed') await contextoAudio.close();
    contextoAudio = null;
    ganhoAudio = null;
    volume.disabled = true;
    $('#audio-status').textContent = 'Desligado — ative quando quiser.';
  }

  async function ligarAudio() {
    const AudioContextApi = popup.AudioContext || popup.webkitAudioContext;
    if (!AudioContextApi) throw new Error('Áudio não disponível neste navegador.');
    contextoAudio = new AudioContextApi();
    await contextoAudio.resume();
    const amostras = contextoAudio.createBuffer(1, contextoAudio.sampleRate * 3, contextoAudio.sampleRate);
    const dados = amostras.getChannelData(0);
    let anterior = 0;
    for (let i = 0; i < dados.length; i++) {
      const branco = Math.random() * 2 - 1;
      anterior = (anterior + 0.02 * branco) / 1.02;
      dados[i] = Math.max(-1, Math.min(1, anterior * 3.5));
    }
    fonteAudio = contextoAudio.createBufferSource();
    fonteAudio.buffer = amostras;
    fonteAudio.loop = true;
    ganhoAudio = contextoAudio.createGain();
    ganhoAudio.gain.value = Number(volume.value) / 100;
    fonteAudio.connect(ganhoAudio);
    ganhoAudio.connect(contextoAudio.destination);
    fonteAudio.start();
    volume.disabled = false;
    $('#audio-status').textContent = 'Ruído marrom ativo — ajuste o volume abaixo.';
  }

  audioLigado.onchange = async () => {
    if (!audioLigado.checked) return desligarAudio();
    audioLigado.disabled = true;
    try {
      await ligarAudio();
    } catch (erro) {
      audioLigado.checked = false;
      await desligarAudio();
      $('#audio-status').textContent = erro.message || 'Não foi possível iniciar o áudio.';
    } finally {
      audioLigado.disabled = false;
    }
  };

  volume.oninput = () => {
    if (ganhoAudio && contextoAudio) {
      ganhoAudio.gain.setTargetAtTime(Number(volume.value) / 100, contextoAudio.currentTime, 0.04);
    }
  };

  popup.addEventListener('beforeunload', () => {
    limparIntervalo();
    if (contextoAudio && contextoAudio.state !== 'closed') contextoAudio.close();
  }, { once: true });
  mostrar();
  return true;
}
