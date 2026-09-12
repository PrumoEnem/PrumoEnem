// Simula uma sessão inteira usando os módulos e os dados reais.
import { readFileSync } from 'fs';
import { estimarTheta, faixaDeNota, atualizarTheta } from './site/js/tri.js';
import { calcularPrioridades, escolherArea, montarSessao, simularNotaSisu } from './site/js/motor.js';
import * as srs from './site/js/srs.js';

let falhas = 0;
const ok = (n, c, d='') => { if(!c) falhas++; console.log(`${c?'OK  ':'FALHA'} ${n}${d?' — '+d:''}`); };

const cursos = JSON.parse(readFileSync('site/dados/cursos.json','utf8'));
const vocab  = JSON.parse(readFileSync('site/dados/vocabulario.json','utf8'));
const banco  = {};
for (const a of ['matematica','natureza','humanas','linguagens'])
  banco[a] = JSON.parse(readFileSync(`site/dados/questoes-${a}.json`,'utf8'));

console.log('=== Integridade dos dados ===');
const total = Object.values(banco).reduce((s,q)=>s+q.length,0);
ok('2757 questões carregadas', total === 2757, `${total}`);
const semGabarito = Object.values(banco).flat().filter(q => !q.alternativas.some(a=>a.letra===q.gabarito));
ok('todo gabarito aponta para uma alternativa existente', semGabarito.length===0, `${semGabarito.length} problemas`);
const vazias = Object.values(banco).flat().filter(q => !q.enunciado || q.alternativas.length<4);
ok('nenhuma questão vazia ou incompleta', vazias.length===0);
ok('vocabulário com os 3 tipos', new Set(vocab.map(v=>v.tipo)).size===3, [...new Set(vocab.map(v=>v.tipo))].join(', '));
const vocabRuim = vocab.filter(v => !v.alternativas.includes(v.correta));
ok('resposta certa consta nas alternativas de todo item', vocabRuim.length===0, `${vocabRuim.length} ruins`);
ok('ids de vocabulário únicos', new Set(vocab.map(v=>v.id)).size===vocab.length);

console.log('\n=== Curso e pesos ===');
const alvo = cursos.cursos.find(c=>c.id==='utfpr-eletronica-cornelio');
ok('Eletrônica Cornélio Procópio existe', !!alvo);
ok('matemática peso 4', alvo.pesos.matematica===4);

console.log('\n=== Prioridade: peso × lacuna ===');
let thetas = {};
let p = calcularPrioridades(alvo.pesos, thetas);
console.log('  sem medição: ' + p.map(x=>`${x.area} ${x.percentual}%`).join(' · '));
ok('matemática lidera quando tudo está zerado', p[0].area==='matematica');

thetas = { matematica:{theta:1.9,erroPadrao:.2,itensUsados:90}, natureza:{theta:-0.5,erroPadrao:.2,itensUsados:90} };
p = calcularPrioridades(alvo.pesos, thetas);
console.log('  forte em mat, fraco em CN: ' + p.map(x=>`${x.area} ${x.percentual}%`).join(' · '));
ok('matemática desce quando já está perto do alvo', p.find(x=>x.area==='matematica').percentual < 20,
   `${p.find(x=>x.area==='matematica').percentual}%`);
ok('natureza sobe', p[0].area==='natureza');

console.log('\n=== Montagem da sessão ===');
const s = montarSessao(banco.matematica, 0.5, []);
ok('9 questões', s.questoes.length===9);
ok('marcada como não calibrada (sem params do INEP)', s.calibrada===false);
ok('sem repetição dentro da sessão', new Set(s.questoes.map(q=>q.id)).size===9);
const vistas = s.questoes.map(q=>q.id);
const s2 = montarSessao(banco.matematica, 0.5, vistas);
ok('não repete questões já vistas', s2.questoes.every(q=>!vistas.includes(q.id)));

// Agora com parâmetros fictícios, para provar que o 3/3/3 funciona quando calibrado.
const calib = banco.matematica.slice(0,300).map((q,i)=>({...q,tri:{a:1+(i%10)/8,b:-2+(i%40)/10,c:.2}}));
const s3 = montarSessao(calib, 0.5, []);
ok('com parâmetros, marca como calibrada', s3.calibrada===true);
const faixas = { facil:0, media:0, dificil:0 };
for (const q of s3.questoes) {
  const d = q.tri.b - 0.5;
  faixas[d < -0.5 ? 'facil' : d < 0.5 ? 'media' : 'dificil']++;
}
console.log(`  distribuição: ${faixas.facil} fáceis, ${faixas.media} médias, ${faixas.dificil} difíceis`);
ok('3/3/3 respeitado', faixas.facil===3 && faixas.media===3 && faixas.dificil===3);

console.log('\n=== Sessão simulada (aluno com θ real de 0.8) ===');
const THETA_REAL = 0.8;
let acumulado = null;
for (let sess=1; sess<=6; sess++) {
  const { questoes } = montarSessao(calib, acumulado?.theta ?? 0, []);
  const respostas = questoes.map(q => {
    const pr = q.tri.c + (1-q.tri.c)/(1+Math.exp(-1.7*q.tri.a*(THETA_REAL-q.tri.b)));
    return { tri:q.tri, acertou: Math.random() < pr };
  });
  acumulado = atualizarTheta(acumulado, estimarTheta(respostas));
  if (sess===1 || sess===6) {
    const f = faixaDeNota(acumulado);
    console.log(`  após ${sess} ${sess===1?'sessão ':'sessões'}: ${f.nota} pts (${f.minima}–${f.maxima}) confiável: ${f.confiavel}`);
  }
}
ok('converge perto do θ verdadeiro', Math.abs(acumulado.theta - THETA_REAL) < 0.5,
   `θ estimado ${acumulado.theta} vs real ${THETA_REAL}`);
ok('vira confiável depois de algumas sessões', faixaDeNota(acumulado).confiavel);

console.log('\n=== Simulação do SiSU ===');
const sim = simularNotaSisu(alvo.pesos, {
  matematica:{theta:1.2}, natureza:{theta:0.6}, humanas:{theta:0.3}, linguagens:{theta:0.4}
}, 880);
console.log(`  média ponderada: ${sim.media}`);
ok('média calculada', sim.media > 500 && sim.media < 1000);
ok('marca como completa com redação', sim.completa);
// Confere a conta na mão: (620*4 + 560*2 + 530*1 + 540*1 + 880*1) / 9
const esperado = (620*4 + 560*2 + 530*1 + 540*1 + 880*1)/9;
ok('bate com o cálculo manual', Math.abs(sim.media - esperado) < 0.01, `esperado ${esperado.toFixed(2)}`);

console.log('\n=== Revisão espaçada ===');
let c = srs.novoCartao({frente:'a',verso:'b'});
ok('cartão novo vence hoje', srs.estaVencido(c));
c = srs.revisar(c,2); ok('após acertar, 1 dia', c.intervalo===1);
c = srs.revisar(c,2); ok('depois, 3 dias', c.intervalo===3);
c = srs.revisar(c,3); ok('fácil estende mais', c.intervalo>3, `${c.intervalo} dias`);
c = srs.revisar(c,0); ok('errar zera o intervalo', c.intervalo===0 && srs.estaVencido(c));

console.log('\n=== Vocabulário ===');
let v = srs.atualizarVocabulario({}, false);
ok('errar não domina', !v.dominado);
v = srs.atualizarVocabulario(v, true);
ok('um acerto ainda não domina', !v.dominado);
v = srs.atualizarVocabulario(v, true);
ok('dois acertos seguidos dominam', v.dominado);
const prox = srs.proximoVocabulario(vocab, {});
ok('sorteia um item válido', !!prox && !!prox.correta);

console.log(falhas===0 ? '\nTodos os testes passaram.\n' : `\n${falhas} falha(s).\n`);
process.exit(falhas ? 1 : 0);
