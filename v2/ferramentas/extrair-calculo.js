// Extrai do index.html (versão 1) as funções do motor de cálculo, SEM ALTERAR o texto delas,
// e monta o módulo da versão 2. Assim as duas versões calculam com o mesmo código.
const fs = require('fs');
const V1 = require('path').join(__dirname, '..', '..', 'index.html');
const SAIDA = require('path').join(__dirname, '..', 'js', 'calculo.js');
const h = fs.readFileSync(V1, 'utf8');

// fim da função = '}' sozinho no começo da linha (estilo de toda a v1)
function extraiFuncao(nome){
  const ini = h.indexOf('\nfunction ' + nome + '(');
  if(ini < 0) throw new Error('não achei ' + nome);
  const resto = h.slice(ini + 1);
  // função de uma linha só: o bloco é só essa linha
  const primeira = resto.split(/\r?\n/)[0];
  const abre = (primeira.match(/\{/g) || []).length, fecha = (primeira.match(/\}/g) || []).length;
  if(abre > 0 && abre === fecha) return primeira;
  const m = resto.match(/\n\}(?=\r?\n)/);
  if(!m) throw new Error('não achei o fim de ' + nome);
  return resto.slice(0, m.index + m[0].length);
}

const FUNCOES = ['roundToBreakpoint', 'adPrices', 'effectiveCompanyCosts', 'effectiveFixedFee', 'tierRangeLabel',
  'taxasDoAnuncio', 'freteDoAnuncio', 'envioCombinarPct', 'fretePctNoPreco', 'freteNoPreco', 'feeSegments', 'segmentForPrice', 'calcSku'];
const corpos = FUNCOES.map(extraiFuncao);

// única troca: a v1 lê os custos da empresa de uma variável global (state.padroes); aqui eles
// entram por definirCustosDaEmpresa(), porque cada empresa tem os seus.
const juntos = corpos.join('\n\n');
const trocas = (juntos.match(/state\.padroes/g) || []).length;
const modulo = `// ============================================================================
// Motor de cálculo -- GERADO a partir da versão 1 (index.html) por extrair-calculo.js.
// NÃO EDITE À MÃO: as funções abaixo são cópia literal das da v1, para as duas versões
// calcularem exatamente igual. A única troca é de onde vêm os custos da empresa
// (state.padroes na v1, CUSTOS_EMPRESA aqui: ${trocas} ocorrência(s)).
// ============================================================================

const FMT_BRL = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const FMT_PCT = new Intl.NumberFormat('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1});
export const brl = v => FMT_BRL.format(isFinite(v)?v:0);
export const pct = v => FMT_PCT.format(isFinite(v)?v:0)+'%';

let CUSTOS_EMPRESA = {fixedCost:0, misc:0, taxPct:0, marketingPct:0, coupon:0, freightNet:0};
export function definirCustosDaEmpresa(c){ CUSTOS_EMPRESA = Object.assign({}, CUSTOS_EMPRESA, c); }

${juntos.replace(/state\.padroes/g, 'CUSTOS_EMPRESA')}

export { calcSku, adPrices, feeSegments, segmentForPrice, tierRangeLabel, freteNoPreco, taxasDoAnuncio, freteDoAnuncio, roundToBreakpoint };
`;
fs.mkdirSync(require('path').dirname(SAIDA), {recursive: true});
fs.writeFileSync(SAIDA, modulo);
console.log('calculo.js gerado:', FUNCOES.length, 'funções,', trocas, 'troca(s) de state.padroes,', modulo.split('\n').length, 'linhas');
