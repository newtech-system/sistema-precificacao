// Teste diferencial: o motor da v1 (texto original, rodando num sandbox com um "state" falso)
// contra o módulo da v2, nas mesmas entradas aleatórias. Qualquer diferença aparece aqui.
import fs from 'fs';
import vm from 'vm';
import { calcSku as calcV2, definirCustosDaEmpresa, adPrices as adV2 } from '../js/calculo.js';

const h = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
function extrai(nome){
  const ini = h.indexOf('\nfunction ' + nome + '(');
  let i = h.indexOf('{', ini), p = 0;
  for(; i < h.length; i++){
    const c = h[i];
    if(c === '{') p++; else if(c === '}'){ p--; if(p === 0) break; }
    else if(c === "'" || c === '"' || c === '`'){ const q = c; i++; while(i < h.length && h[i] !== q){ if(h[i] === '\\') i++; i++; } }
  }
  return h.slice(ini + 1, i + 1);
}
const nomes = ['roundToBreakpoint','adPrices','effectiveCompanyCosts','effectiveFixedFee','tierRangeLabel',
  'taxasDoAnuncio','freteDoAnuncio','envioCombinarPct','fretePctNoPreco','freteNoPreco','feeSegments','segmentForPrice','calcSku'];
const ctx = {state: {padroes: {}}, Intl, isFinite, Math, Number, Infinity, Array, Object, String};
ctx.brl = v => String(v);   // só usado em rótulos de faixa
vm.createContext(ctx);
vm.runInContext(nomes.map(extrai).join('\n') + '\nthis.calcV1 = calcSku; this.adV1 = adPrices;', ctx);

// gerador aleatório com semente (resultado reproduzível)
let s = 20260930;
const r = ()=> (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
const entre = (a, b)=> Math.round((a + r() * (b - a)) * 100) / 100;
const escolhe = arr => arr[Math.floor(r() * arr.length)];

function perfilAleatorio(){
  const tipo = escolhe(['simples', 'faixas', 'tiktok', 'variavel']);
  const p = {commission: entre(0, 25), service: entre(0, 8), transaction: entre(0, 3), fixedFee: entre(0, 8),
    dualAdPrice: r() < 0.3, variableFreight: r() < 0.3, variableFixedFee: tipo === 'variavel', tiered: false, tiers: []};
  if(tipo === 'faixas' || tipo === 'tiktok'){
    p.tiered = true;
    p.tiers = [{min: 0, commission: entre(5, 20), service: tipo === 'tiktok' ? 6 : entre(0, 5), transaction: 0, fixedFee: entre(0, 6), serviceCap: tipo === 'tiktok' ? 50 : 0},
               {min: entre(30, 90), commission: entre(5, 20), service: tipo === 'tiktok' ? 6 : entre(0, 5), transaction: 0, fixedFee: entre(0, 8), serviceCap: tipo === 'tiktok' ? 50 : 0}];
  }
  return p;
}
function anuncioAleatorio(){
  const a = {cogs: entre(1, 300), costOverride: r() < 0.3, fixedCost: entre(0, 5), misc: entre(0, 2), taxPct: entre(0, 12),
    marketingPct: entre(0, 8), coupon: r() < 0.3 ? entre(0, 5) : 0, freightNet: r() < 0.3 ? entre(-10, 5) : 0,
    mktFixedFee: entre(0, 10), mode: r() < 0.5 ? 'price' : 'margin', price: entre(5, 900), marginTarget: entre(-10, 70)};
  if(r() < 0.4){   // vinculado ao Mercado Livre, com faixas de taxa e de envio
    a.mlUsar = r() < 0.9;
    a.mlFaixas = [{min: 0, pct: 62, fixo: 0}, {min: 12.5, pct: 12, fixo: 6.25}, {min: 29, pct: 12, fixo: 6.5},
                  {min: 50, pct: 12, fixo: 6.75}, {min: 79, pct: entre(10, 19), fixo: 0}];
    a.mlUsarFrete = r() < 0.8;
    a.mlFreteFaixas = r() < 0.3
      ? [{min: 0, custo: 0, combinar: true}]   // entrega a combinar: percentual do preço
      : [{min: 0, custo: 5.65}, {min: 29, custo: 7.45}, {min: 50, custo: 8.75}, {min: 79, custo: entre(8, 25)}];
  }
  return a;
}

const campos = ['price', 'netMarketplace', 'profit', 'marginOnNet', 'marginOnPrice', 'commissionVal', 'serviceVal',
  'transactionVal', 'fixedFee', 'freteML', 'fretePct', 'feesTotal', 'taxVal', 'marketingVal'];
let testes = 0, erros = 0, inviaveis = 0;
const exemplos = [];
for(let k = 0; k < 20000; k++){
  const padroes = {fixedCost: entre(0, 4), misc: entre(0, 1), taxPct: entre(0, 10), marketingPct: entre(0, 6),
    envioCombinarPct: r() < 0.2 ? undefined : entre(0, 30)};
  ctx.state.padroes = padroes;
  definirCustosDaEmpresa(padroes);
  const perfil = perfilAleatorio(), anuncio = anuncioAleatorio();
  const a = ctx.calcV1(JSON.parse(JSON.stringify(perfil)), JSON.parse(JSON.stringify(anuncio)));
  const b = calcV2(JSON.parse(JSON.stringify(perfil)), JSON.parse(JSON.stringify(anuncio)));
  testes++;
  if(!!a.error !== !!b.error){ erros++; if(exemplos.length < 3) exemplos.push({perfil, anuncio, a, b}); continue; }
  if(a.error){ inviaveis++; continue; }
  for(const c of campos){
    const x = a[c], y = b[c];
    if(!(x === y || (Number.isNaN(x) && Number.isNaN(y)) || (x === undefined && y === undefined))){
      erros++; if(exemplos.length < 3) exemplos.push({campo: c, x, y, perfil, anuncio}); break;
    }
  }
  const ad1 = ctx.adV1(a.price, perfil), ad2 = adV2(b.price, perfil);
  if(ad1.p20 !== ad2.p20 || ad1.p40 !== ad2.p40){ erros++; if(exemplos.length < 3) exemplos.push({anuncioPreco: 'difere', ad1, ad2}); }
}
console.log(`${testes} cálculos comparados (${inviaveis} inviáveis nos dois), diferenças: ${erros}`);
if(erros) console.log(JSON.stringify(exemplos, null, 1).slice(0, 3000));

// os casos de referência de sempre, direto no módulo da v2
definirCustosDaEmpresa({fixedCost: 0, misc: 0, taxPct: 0, marketingPct: 0});
const base = {cogs: 0, costOverride: true, fixedCost: 0, misc: 0, taxPct: 0, marketingPct: 0, coupon: 0, freightNet: 0, mktFixedFee: 0, mode: 'price', marginTarget: 0};
const shopee = {commission: 17.63, service: 3.44, transaction: 1.96, fixedFee: 4, tiers: []};
const ml = {commission: 14, service: 0, transaction: 0, fixedFee: 6.5, tiers: []};
const tt = {commission: 10, service: 6, transaction: 0, fixedFee: 4, tiered: true, tiers: [
  {min: 0, commission: 10, service: 6, transaction: 0, fixedFee: 4, serviceCap: 50},
  {min: 50, commission: 6, service: 6, transaction: 0, fixedFee: 6, serviceCap: 50}]};
const f = v => v.toFixed(2);
const r1 = calcV2(shopee, {...base, price: 43.89, coupon: 0.88});
const r2 = calcV2(ml, {...base, mode: 'margin', marginTarget: 50, cogs: 12.33, fixedCost: 1, misc: 0.15, taxPct: 6, marketingPct: 3});
console.log('referências v2: Shopee recebe', f(r1.netMarketplace), '| ML', f(r2.price), f(r2.marginOnNet) + '%', f(r2.marginOnPrice) + '%',
  '| TikTok 40→', f(calcV2(tt, {...base, price: 40}).netMarketplace), '100→', f(calcV2(tt, {...base, price: 100}).netMarketplace));
