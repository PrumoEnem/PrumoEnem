import * as rev from '../js/revisao.js';

let falhas = 0;
const ok = (n, c, d = '') => {
  if (!c) falhas++;
  console.log((c ? 'OK   ' : 'FALHA') + ' ' + n + (d ? ' — ' + d : ''));
};

const questao = {
  id: '2023-140', area: 'matematica', ano: 2023, numero: 140,
  enunciado: '**Atenção** ao gráfico ![](http://x/y.png) a seguir. ' + 'Texto de apoio bem longo. '.repeat(20),
  alternativas: [
    { letra: 'A', texto: 'alfa' }, { letra: 'B', texto: 'beta' },
    { letra: 'C', texto: 'gama' }, { letra: 'D', texto: 'delta' },
    { letra: 'E', texto: 'epsilon' },
  ],
  gabarito: 'C',
};

console.log('=== registrar e remover ===');
let fila = rev.registrarErro([], questao, 'A');
ok('entra na fila', fila.length === 1);
ok('guarda o gabarito e o que foi marcado', fila[0].gabarito === 'C' && fila[0].marcada === 'A');
ok('conta uma tentativa', fila[0].tentativas === 1);

fila = rev.registrarErro(fila, questao, 'B');
ok('errar de novo não duplica', fila.length === 1, `${fila.length} itens`);
ok('soma a tentativa', fila[0].tentativas === 2);

fila = rev.removerAcertada(fila, '2023-140');
ok('acertar tira da fila', fila.length === 0);

console.log('\n=== resumo do enunciado ===');
const t = rev.resumirEnunciado(questao.enunciado);
ok('remove markdown de imagem', !t.includes('!['), t.slice(0, 50));
ok('remove asteriscos', !t.includes('**'));
ok('corta no limite', t.length <= 181, `${t.length} chars`);
ok('termina com reticências', t.endsWith('…'));

console.log('\n=== embaralhar alternativas ===');
let mudouOrdem = 0, gabaritoCerto = 0;
for (let i = 0; i < 40; i++) {
  const q = rev.embaralharAlternativas(questao);
  const certa = q.alternativas.find((a) => a.letra === q.gabarito);
  if (certa.texto === 'gama') gabaritoCerto++;
  if (q.alternativas.map((a) => a.texto).join() !== 'alfa,beta,gama,delta,epsilon') mudouOrdem++;
}
ok('gabarito sempre aponta para a alternativa certa', gabaritoCerto === 40, `${gabaritoCerto}/40`);
ok('a ordem realmente muda', mudouOrdem >= 35, `${mudouOrdem}/40 embaralhadas`);

const q1 = rev.embaralharAlternativas(questao);
ok('letras continuam A..E em ordem', q1.alternativas.map((a) => a.letra).join('') === 'ABCDE',
  q1.alternativas.map((a) => a.letra).join(''));
ok('marca como revisão', q1.revisao === true);
ok('não altera a questão original', questao.alternativas[0].texto === 'alfa' && questao.gabarito === 'C');
ok('mantém as cinco alternativas', q1.alternativas.length === 5);

console.log('\n=== seleção para a sessão ===');
let muitas = [];
for (let i = 0; i < 10; i++) {
  muitas = rev.registrarErro(muitas, { ...questao, id: `q${i}` }, 'A');
}
// q3 errada mais vezes deve vir primeiro.
muitas = rev.registrarErro(muitas, { ...questao, id: 'q3' }, 'B');
muitas = rev.registrarErro(muitas, { ...questao, id: 'q3' }, 'B');
const escolhidas = rev.selecionarParaSessao(muitas);
ok('respeita o limite por sessão', escolhidas.length === rev.POR_SESSAO, `${escolhidas.length}`);
ok('prioriza a mais errada', escolhidas[0].id === 'q3', escolhidas[0].id);

console.log('\n=== limite da fila ===');
let enorme = [];
for (let i = 0; i < 80; i++) enorme = rev.registrarErro(enorme, { ...questao, id: `x${i}` }, 'A');
ok('fila não cresce sem fim', enorme.length === 60, `${enorme.length}`);

console.log('\n=== explicação ===');
let comExp = rev.registrarErro([], questao, 'A');
comExp = rev.anotarExplicacao(comExp, '2023-140', 'porque sim');
ok('guarda a explicação', comExp[0].explicacao === 'porque sim');
ok('ignora id inexistente', rev.anotarExplicacao(comExp, 'nao-existe', 'x')[0].explicacao === 'porque sim');

console.log(falhas ? `\n${falhas} falha(s)` : '\nTodos passaram.');
process.exit(falhas ? 1 : 0);
