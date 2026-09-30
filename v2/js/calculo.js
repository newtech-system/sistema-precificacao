// ============================================================================
// Motor de cálculo -- GERADO a partir da versão 1 (index.html) por extrair-calculo.js.
// NÃO EDITE À MÃO: as funções abaixo são cópia literal das da v1, para as duas versões
// calcularem exatamente igual. A única troca é de onde vêm os custos da empresa
// (state.padroes na v1, CUSTOS_EMPRESA aqui: 4 ocorrência(s)).
// ============================================================================

const FMT_BRL = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const FMT_PCT = new Intl.NumberFormat('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1});
export const brl = v => FMT_BRL.format(isFinite(v)?v:0);
export const pct = v => FMT_PCT.format(isFinite(v)?v:0)+'%';

let CUSTOS_EMPRESA = {fixedCost:0, misc:0, taxPct:0, marketingPct:0, coupon:0, freightNet:0};
export function definirCustosDaEmpresa(c){ CUSTOS_EMPRESA = Object.assign({}, CUSTOS_EMPRESA, c); }

function roundToBreakpoint(v){
  if(!isFinite(v) || v<=0) return 0;
  const m = Math.ceil(v/5)*5;
  return Math.round((m-0.10)*100)/100;
}

function adPrices(price, profile){
  const p20 = roundToBreakpoint(price*1.20);
  let p40 = null;
  if(profile.dualAdPrice){
    p40 = roundToBreakpoint(price*1.40);
    const minGap = 10.00; // garante que o valor "antes" pareça de verdade maior -- sem isso, o arredondamento independente às vezes deixa os dois só R$5 (uma quebra) de distância
    if(p40 - p20 < minGap){
      p40 = roundToBreakpoint(p20 + minGap);
    }
  }
  return {p20, p40};
}

function effectiveCompanyCosts(sku){
  if(sku.costOverride){
    return {fixedCost: sku.fixedCost, misc: sku.misc, taxPct: sku.taxPct, marketingPct: sku.marketingPct};
  }
  return {fixedCost: CUSTOS_EMPRESA.fixedCost, misc: CUSTOS_EMPRESA.misc, taxPct: CUSTOS_EMPRESA.taxPct, marketingPct: CUSTOS_EMPRESA.marketingPct};
}

function effectiveFixedFee(profile, sku){
  return profile.variableFixedFee ? (Number(sku.mktFixedFee)||0) : (Number(profile.fixedFee)||0);
}

function tierRangeLabel(min, max){
  if(min<=0 && !isFinite(max)) return '';
  if(min<=0) return 'abaixo de ' + brl(max);
  if(!isFinite(max)) return 'a partir de ' + brl(min);
  return 'de ' + brl(min) + ' a ' + brl(max);
}

function taxasDoAnuncio(sku){
  if(!sku || !sku.mlUsar || !Array.isArray(sku.mlFaixas) || !sku.mlFaixas.length) return null;
  return sku.mlFaixas.map(f=>({min: Number(f.min)||0, commission: Number(f.pct)||0, service: 0, transaction: 0,
    fixedFee: Number(f.fixo)||0, serviceCap: 0}));
}

function freteDoAnuncio(sku){
  if(!sku || !sku.mlUsarFrete || !Array.isArray(sku.mlFreteFaixas) || !sku.mlFreteFaixas.length) return null;
  return sku.mlFreteFaixas.map(f=>({min: Number(f.min)||0, custo: Number(f.custo)||0}));
}

function freteNoPreco(faixas, preco){
  if(!faixas || !faixas.length) return 0;
  let achado = faixas[0];
  faixas.forEach(f=>{ if(preco >= f.min) achado = f; });
  return achado.custo;
}

function feeSegments(profile, sku){
  const mk = (commission, service, transaction, fixedFee, serviceCap) =>
    ({commission:Number(commission)||0, service:Number(service)||0, transaction:Number(transaction)||0,
      fixedFee:Number(fixedFee)||0, serviceCap:Number(serviceCap)||0});

  // Anúncio vinculado ao Mercado Livre manda nas próprias taxas: valem a comissão e o custo fixo
  // que o ML informou para a categoria e o tipo dele, e não o que está no cadastro do marketplace.
  const doML = taxasDoAnuncio(sku);
  const tiersDoPerfil = doML || ((profile.tiered && Array.isArray(profile.tiers) && profile.tiers.length)
    ? profile.tiers.slice().sort((a,b)=> (Number(a.min)||0) - (Number(b.min)||0))
    : null);

  let faixas = tiersDoPerfil
    ? tiersDoPerfil.map((t,i)=>({
        min: i===0 ? 0 : (Number(t.min)||0),   // a primeira faixa sempre cobre de zero pra cima
        max: tiersDoPerfil[i+1] ? (Number(tiersDoPerfil[i+1].min)||0) : Infinity,
        rates: mk(t.commission, t.service, t.transaction, t.fixedFee, t.serviceCap)
      }))
    : [{min:0, max:Infinity, rates: mk(profile.commission, profile.service, profile.transaction, effectiveFixedFee(profile, sku), 0)}];

  // O envio do Mercado Livre muda por faixa de preço igual às taxas, então as viradas de faixa dos
  // dois entram na mesma conta: cada trecho carrega o custo de envio que vale nele.
  const frete = freteDoAnuncio(sku);
  if(frete){
    const cortes = [];
    faixas.forEach(f=> cortes.push(f.min));
    frete.forEach(f=> cortes.push(f.min));
    const unicos = [...new Set(cortes)].sort((a,b)=> a - b);
    const novas = [];
    unicos.forEach((min, i)=>{
      const max = unicos[i+1] === undefined ? Infinity : unicos[i+1];
      const dona = faixas.filter(f=> f.min <= min).pop() || faixas[0];
      if(max > min) novas.push({min: i === 0 ? 0 : min, max, rates: dona.rates});
    });
    faixas = novas;
  }

  const segs = [];
  faixas.forEach(f=>{
    const label = tierRangeLabel(f.min, f.max);
    const custoEnvio = frete ? freteNoPreco(frete, Math.max(f.min, 0.01)) : 0;
    const pctCheio = (f.rates.commission + f.rates.service + f.rates.transaction)/100;
    const svc = f.rates.service/100;
    const cap = f.rates.serviceCap;
    const limiar = (cap > 0 && svc > 0) ? cap/svc : Infinity;  // preço em que a taxa bate no teto
    const semTeto = {min:f.min, max:Math.min(f.max, limiar), pct:pctCheio, fixed:f.rates.fixedFee + custoEnvio, frete:custoEnvio, rates:f.rates, label, capBinds:false};
    const comTeto = {min:Math.max(f.min, limiar), max:f.max, pct:pctCheio - svc, fixed:f.rates.fixedFee + cap + custoEnvio, frete:custoEnvio, rates:f.rates, label, capBinds:true};
    if(semTeto.max > semTeto.min) segs.push(semTeto);
    if(limiar < f.max && comTeto.max > comTeto.min) segs.push(comTeto);
  });
  return segs.length ? segs : [{min:0, max:Infinity, pct:0, fixed:0, rates:mk(0,0,0,0,0), label:'', capBinds:false}];
}

function segmentForPrice(segs, price){
  for(const s of segs){ if(price >= s.min && price < s.max) return s; }
  return segs[segs.length-1];
}

function calcSku(profile, sku){
  const cc = effectiveCompanyCosts(sku);
  const tax = cc.taxPct/100, mk = cc.marketingPct/100;
  const companyCosts = sku.cogs + cc.fixedCost + cc.misc;   // custos fixos da empresa
  const extraFixed = sku.coupon - sku.freightNet;           // fixos que não vêm do marketplace
  const segs = feeSegments(profile, sku);

  // Margem sobre o valor recebido, dado um trecho de taxas.
  const margemEm = (p, seg) => {
    const net = p*(1-seg.pct) - seg.fixed - extraFixed;
    const lucro = net - companyCosts - tax*p - mk*p;
    return net !== 0 ? lucro/net : -Infinity;
  };

  let price, seg;
  if(sku.mode === 'margin'){
    // Margem definida sobre o valor que sobra na mão do vendedor (após o marketplace tirar a parte dele),
    // e não sobre o preço de venda total -- é assim que o valor realmente é sentido no caixa.
    //
    // Com faixas de preço a fórmula fechada só vale DENTRO de um trecho: resolve em cada um e
    // fica com a solução que de fato cai no próprio trecho. Resolver com as taxas de uma faixa
    // e acabar num preço de outra daria uma margem que não se realiza.
    const m = sku.marginTarget/100;
    const solucoes = [];
    segs.forEach(sg=>{
      const denom = (1 - sg.pct) * (1 - m) - (tax + mk);
      if(denom <= 0) return;
      const p = (companyCosts + (sg.fixed + extraFixed) * (1 - m)) / denom;
      if(!isFinite(p) || p <= 0) return;
      if(p >= sg.min - 1e-9 && p < sg.max) solucoes.push({p, sg});
    });
    // Faixas mal encaixadas podem deixar um vão: nenhum preço dentro do próprio trecho atinge a
    // margem, mas o primeiro preço da faixa seguinte atinge. Nesse caso vale a virada de faixa.
    if(solucoes.length === 0){
      segs.forEach(sg=>{
        if(sg.min <= 0 || !isFinite(sg.min)) return;
        if(margemEm(sg.min, sg) >= m - 1e-9) solucoes.push({p: sg.min, sg});
      });
    }
    if(solucoes.length === 0) return {error:true, m, mktPct: segs[0].pct, tax, mk};
    solucoes.sort((a,b)=> a.p - b.p);   // entre preços que servem, o menor é o mais competitivo
    price = solucoes[0].p; seg = solucoes[0].sg;
    if(price*(1-seg.pct) - seg.fixed - extraFixed <= 0) return {error:true, m, mktPct: seg.pct, tax, mk};
  } else {
    price = sku.price;
    seg = segmentForPrice(segs, price);
  }

  const rates = seg.rates;
  const commissionVal = rates.commission/100*price;
  const servicoCheio = rates.service/100*price;
  const serviceVal = (rates.serviceCap > 0) ? Math.min(servicoCheio, rates.serviceCap) : servicoCheio;
  const transactionVal = rates.transaction/100*price;
  const fixedFee = rates.fixedFee;
  const freteML = seg.frete || 0;   // envio informado pelo Mercado Livre para este anúncio
  const taxVal = tax*price, marketingVal = mk*price;
  const feesTotal = commissionVal+serviceVal+transactionVal+fixedFee+freteML;
  const netMarketplace = price - feesTotal - sku.coupon + sku.freightNet;
  const profit = netMarketplace - sku.cogs - cc.fixedCost - cc.misc - taxVal - marketingVal;
  const marginOnNet = netMarketplace !== 0 ? (profit/netMarketplace*100) : 0;
  const marginOnPrice = price>0 ? (profit/price*100) : 0;
  return {price, commissionVal, serviceVal, transactionVal, fixedFee,
    coupon:sku.coupon, freightNet:sku.freightNet, freteML, feesTotal, netMarketplace,
    cogs:sku.cogs, fixedCost:cc.fixedCost, misc:cc.misc, taxVal, marketingVal, profit,
    marginPct: marginOnNet, marginOnNet, marginOnPrice,
    rates, tierLabel: seg.label, capBinds: seg.capBinds && servicoCheio > rates.serviceCap,
    tiered: segs.length > 1};
}

export { calcSku, adPrices, feeSegments, segmentForPrice, tierRangeLabel, freteNoPreco, taxasDoAnuncio, freteDoAnuncio, roundToBreakpoint };
