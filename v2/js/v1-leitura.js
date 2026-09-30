// ============================================================================
// Leitura dos dados da versão 1 -- GERADO a partir do index.html por extrair-v1.js.
// NÃO EDITE À MÃO: cópia literal das funções da v1 que transformam o que vem da planilha
// (linhas planas, textos 'TRUE', faixas em JSON) em produtos com seus anúncios. A
// importação usa exatamente a mesma regra que o cliente vê na v1.
// ============================================================================

const PRESET_TIKTOK = {
  label:'TikTok Shop', color:'#25f4ee', confidence:'media',
  note:'Regras informadas pelo dono do sistema em set/2026, com os dois exemplos conferidos (R$40 -> recebe R$29,60; R$100 -> recebe R$82,00). Não foram verificadas contra a página oficial do TikTok Shop -- confirme no Seller Center, principalmente o teto de R$50 do Programa de Envio e se a sua categoria tem percentual diferente.',
  commission:10, service:6, transaction:0, fixedFee:4,
  tiered:true,
  tiers:[
    {min:0,  commission:10, service:6, transaction:0, fixedFee:4, serviceCap:50},
    {min:50, commission:6,  service:6, transaction:0, fixedFee:6, serviceCap:50}
  ]
};

const MISSING_PROFILE = {id:'__missing__', label:'Marketplace removido', color:'#e2716b', confidence:'baixa', note:'',
  commission:0, service:0, transaction:0, fixedFee:0, dualAdPrice:false, variableFreight:false, variableFixedFee:false, missing:true};

function toBool(v){ return (v === true || v === 'TRUE' || v === 'true' || v === 1 || v === '1'); }

function novoId(){ return 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

function slugDoRotulo(label){
  return String(label||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'');
}

function idsDosMarketplaces(profiles){
  return (profiles||[]).map(pr=> String(pr.id||'').trim()).filter(Boolean).sort((a,b)=> b.length - a.length);
}

function skuBase(sku, profiles){
  const s = String(sku||'').trim();
  const baixo = s.toLowerCase();
  for(const id of idsDosMarketplaces(profiles)){
    const suf = '-' + id.toLowerCase();
    if(baixo.length > suf.length && baixo.endsWith(suf)) return s.slice(0, -suf.length);
  }
  return s;
}

function idPeloNome(label){ return slugDoRotulo(label); }

function normalizeSku(s){
  ['cogs','fixedCost','misc','taxPct','marketingPct','coupon','freightNet','price','marginTarget','mktFixedFee'].forEach(k=> s[k] = Number(s[k])||0);
  s.sku = String(s.sku||''); s.name = String(s.name||'');
  s.mode = (s.mode === 'margin') ? 'margin' : 'price';
  s.costOverride = toBool(s.costOverride);
}

function normalizeProfile(p){
  ['commission','service','transaction','fixedFee'].forEach(k=> p[k] = Number(p[k])||0);
  p.id = String(p.id === undefined || p.id === null ? '' : p.id).trim();
  // ID que já existia (padrão de fábrica ou escrito na planilha) nunca muda sozinho
  p.idManual = (p.idManual === undefined || p.idManual === null || p.idManual === '') ? true : toBool(p.idManual);
  p.label = String(p.label||'Sem nome'); p.note = String(p.note||''); p.color = String(p.color||'#8c8c88');
  // chave interna que nunca muda, nem quando o ID é trocado: é por ela que a sincronização
  // reconhece o mesmo marketplace nos dois lados (preenchida em normalizeState quando falta)
  p.uid = String(p.uid === undefined || p.uid === null ? '' : p.uid).trim();
  p.alteradoPor = String(p.alteradoPor||''); p.alteradoEm = String(p.alteradoEm||'');
  if(['alta','media','baixa'].indexOf(p.confidence) === -1) p.confidence = 'baixa';
  p.dualAdPrice = toBool(p.dualAdPrice);
  p.ehMercadoLivre = toBool(p.ehMercadoLivre);   // qual cadastro é o Mercado Livre, para a integração
  p.variableFreight = toBool(p.variableFreight);
  p.variableFixedFee = toBool(p.variableFixedFee);
  p.tiered = toBool(p.tiered);
  // As faixas de preço são uma lista de objetos. Uma célula do Google Sheets só guarda texto,
  // então elas viajam como JSON e voltam como string -- precisa desserializar aqui.
  if(typeof p.tiers === 'string'){
    const txt = p.tiers.trim().replace(/^'/, '');   // prefixo de texto puro do Sheets, se vier
    try{ p.tiers = JSON.parse(txt || '[]'); }
    catch(e){ console.warn('Faixas ilegíveis no marketplace ' + p.label, p.tiers); p.tiers = []; }
  }
  if(!Array.isArray(p.tiers)) p.tiers = [];
  p.tiers = p.tiers.map(t=>({
    min: Number(t.min)||0,
    commission: Number(t.commission)||0,
    service: Number(t.service)||0,
    transaction: Number(t.transaction)||0,
    fixedFee: Number(t.fixedFee)||0,
    serviceCap: Number(t.serviceCap)||0
  })).sort((a,b)=> a.min - b.min);
  if(p.tiered && p.tiers.length === 0) p.tiered = false;   // marcado como faixado mas sem faixa nenhuma
}

function normalizePadroes(p){
  const out = {};
  ['fixedCost','misc','taxPct','marketingPct','coupon','freightNet'].forEach(k=> out[k] = Number(p[k])||0);
  return out;
}

function normalizeListing(l){
  ['price','marginTarget','coupon','freightNet','mktFixedFee','mlPreco','mlPct','mlFixo','mlFrete','mlFreteOutra','mlConfPreco','mlConfTaxa','mlConfEnvio'].forEach(k=> l[k] = Number(l[k])||0);
  ['mlItemId','mlVarId','mlTitulo','mlTipo','mlSituacao','mlCategoria','mlAtualizadoEm','mlLogistica','mlFreteEm','mlConfEm','mlConfErro'].forEach(k=> l[k] = String(l[k]===undefined||l[k]===null ? '' : l[k]));
  l.mlUsar = toBool(l.mlUsar);
  l.mlUsarFrete = toBool(l.mlUsarFrete);
  l.mlFreteGratis = toBool(l.mlFreteGratis);
  if(typeof l.mlFreteFaixas === 'string'){
    const txtF = l.mlFreteFaixas.trim().replace(/^'/, '');
    try{ l.mlFreteFaixas = JSON.parse(txtF || '[]'); }catch(e){ l.mlFreteFaixas = []; }
  }
  if(!Array.isArray(l.mlFreteFaixas)) l.mlFreteFaixas = [];
  l.mlFreteFaixas = l.mlFreteFaixas.map(f=>({min: Number(f.min)||0, custo: Number(f.custo)||0})).sort((a,b)=> a.min - b.min);
  // as faixas de taxa do Mercado Livre viajam como JSON numa célula da planilha
  if(typeof l.mlFaixas === 'string'){
    const txt = l.mlFaixas.trim().replace(/^'/, '');
    try{ l.mlFaixas = JSON.parse(txt || '[]'); }catch(e){ l.mlFaixas = []; }
  }
  if(!Array.isArray(l.mlFaixas)) l.mlFaixas = [];
  l.mlFaixas = l.mlFaixas.map(f=>({min: Number(f.min)||0, pct: Number(f.pct)||0, fixo: Number(f.fixo)||0}))
    .sort((a,b)=> a.min - b.min);
  l.id = String(l.id || novoId());
  l.marketplaceId = String(l.marketplaceId||'');
  l.sku = String(l.sku||'');
  l.mode = (l.mode === 'margin') ? 'margin' : 'price';
  l.alteradoPor = String(l.alteradoPor||''); l.alteradoEm = String(l.alteradoEm||'');
  return l;
}

function normalizeProduct(p){
  ['cogs','fixedCost','misc','taxPct','marketingPct'].forEach(k=> p[k] = Number(p[k])||0);
  p.id = String(p.id || ('p_' + novoId()));
  p.sku = String(p.sku||''); p.name = String(p.name||'');
  p.costOverride = toBool(p.costOverride);
  p.alteradoPor = String(p.alteradoPor||''); p.alteradoEm = String(p.alteradoEm||'');
  if(!Array.isArray(p.listings)) p.listings = [];
  p.listings.forEach(normalizeListing);
  return p;
}

function agruparEmProdutos(rows, profiles){
  const produtos = [];
  const porChave = new Map();
  const basesVistas = new Map();   // base -> quantos produtos diferentes nasceram com ela
  let legado = 0;
  (rows||[]).forEach(r0=>{
    const r = Object.assign({}, r0);
    normalizeSku(r);
    const temProductId = !!String(r.productId||'').trim();
    if(!temProductId) legado++;
    const base = String(r.productSku||'').trim() || skuBase(r.sku, profiles);
    const custos = r.costOverride ? [r.cogs, r.fixedCost, r.misc, r.taxPct, r.marketingPct].join('|') : String(r.cogs);
    const chave = temProductId ? 'id:' + r.productId : 'sku:' + base + '#' + r.costOverride + '#' + custos;
    const mid = String(r.marketplaceId||'');
    let prod = porChave.get(chave);
    // o mesmo marketplace duas vezes não cabe num produto só: são produtos diferentes
    if(prod && mid && prod.listings.some(l=> l.marketplaceId === mid)) prod = null;
    if(!prod){
      prod = normalizeProduct({
        id: temProductId ? String(r.productId) : ('p_' + (r.id || novoId())),
        sku: base, name: r.name, cogs: r.cogs, costOverride: r.costOverride,
        fixedCost: r.fixedCost, misc: r.misc, taxPct: r.taxPct, marketingPct: r.marketingPct, listings: [],
        alteradoPor: r.prodAlteradoPor, alteradoEm: r.prodAlteradoEm
      });
      if(!porChave.has(chave)) porChave.set(chave, prod);
      produtos.push(prod);
      if(!temProductId) basesVistas.set(base, (basesVistas.get(base)||0) + 1);
    }
    // linha sem marketplace = produto guardado sem nenhum anúncio
    if(mid) prod.listings.push(normalizeListing({
      id: r.id, marketplaceId: mid, sku: r.sku, mode: r.mode, price: r.price, marginTarget: r.marginTarget,
      coupon: r.coupon, freightNet: r.freightNet, mktFixedFee: r.mktFixedFee,
      alteradoPor: r.alteradoPor, alteradoEm: r.alteradoEm,
      mlItemId: r.mlItemId, mlVarId: r.mlVarId, mlTitulo: r.mlTitulo, mlTipo: r.mlTipo, mlSituacao: r.mlSituacao,
      mlCategoria: r.mlCategoria, mlPreco: r.mlPreco, mlPct: r.mlPct, mlFixo: r.mlFixo, mlFaixas: r.mlFaixas,
      mlUsar: r.mlUsar, mlAtualizadoEm: r.mlAtualizadoEm,
      mlFrete: r.mlFrete, mlFreteFaixas: r.mlFreteFaixas, mlFreteGratis: r.mlFreteGratis, mlFreteOutra: r.mlFreteOutra,
      mlLogistica: r.mlLogistica, mlUsarFrete: r.mlUsarFrete, mlFreteEm: r.mlFreteEm,
      mlConfEm: r.mlConfEm, mlConfPreco: r.mlConfPreco, mlConfTaxa: r.mlConfTaxa, mlConfEnvio: r.mlConfEnvio, mlConfErro: r.mlConfErro
    }));
  });
  let separados = 0;
  basesVistas.forEach(n=>{ if(n > 1) separados++; });
  return {produtos, legado, separados};
}

function defaultProfiles(){
  return [
    {id:'shopee', label:'Shopee', color:'#ee4d2d', confidence:'alta',
      note:'Percentuais calculados a partir de um pedido real conferido pelo usuário: comissão 17,63% + taxa de serviço 3,44% + taxa de transação 1,96% + R$4,00 fixo = R$14,11 sobre R$43,89. Em mar/2026 a Shopee teria passado a cobrar por faixa de preço (ex.: até R$79,99 = 20% + R$4; acima de R$200 = 14% + R$26), segundo fontes não oficiais -- confirme na Central do Vendedor se o seu produto mudou de faixa.',
      commission:17.63, service:3.44, transaction:1.96, fixedFee:4.00},
    {id:'mercadolivre', label:'Mercado Livre', color:'#ffe600', confidence:'baixa',
      note:'Não encontrei fonte oficial verificada com o percentual exato. Faixas relatadas por terceiros: Clássico 11% a 14%, Premium 16% a 19% (varia por categoria), mais custo fixo de aprox. R$5,50 a R$6,75 em itens abaixo de R$79. Confirme na Central do Vendedor.',
      commission:13, service:0, transaction:0, fixedFee:6.50},
    {id:'amazon', label:'Amazon', color:'#146eb4', confidence:'baixa',
      note:'Faixa geral relatada por terceiros: comissão entre 8% e 15%, podendo chegar a 20% em categorias específicas. Não inclui comissão mínima por item (aprox. R$1,00) nem mensalidade do plano Profissional (aprox. R$19/mês). Confirme no Seller Central.',
      commission:12, service:0, transaction:0, fixedFee:0},
    {id:'shein', label:'Shein', color:'#ff5a9e', confidence:'media',
      note:'Diversas fontes de terceiros convergem em 16% sobre o valor do produto após cupons, sem taxa fixa por item. Pode haver isenção temporária para novos vendedores. Confirme na página oficial "Política de Comissão" da Shein.',
      commission:16, service:0, transaction:0, fixedFee:0},
    Object.assign({id:'tiktokshop'}, JSON.parse(JSON.stringify(PRESET_TIKTOK))),  // cópia: as faixas não podem compartilhar a mesma lista do modelo
    {id:'custom', label:'Personalizado', color:'#8c8c88', confidence:'baixa',
      note:'Preencha com os valores reais do canal de venda que você quer simular.',
      commission:0, service:0, transaction:0, fixedFee:0}
  ].map(p => Object.assign({dualAdPrice:false, variableFreight:false, variableFixedFee:false, tiered:false, tiers:[]}, p));
}

function normalizeState(s){
  if(!s || !Array.isArray(s.profiles)) return null;
  s.profiles.forEach(normalizeProfile);
  if(s.profiles.length === 0) s.profiles = defaultProfiles();
  // marketplace sem ID (célula vazia na planilha) ganha o nome, minúsculo e sem espaços
  s.profiles.forEach(pr=>{
    if(pr.id) return;
    let id = idPeloNome(pr.label) || 'marketplace', n = 2;
    const base = id;
    while(s.profiles.some(x=> x !== pr && x.id === id)) id = base + (n++);
    pr.id = id;
  });
  // marketplace sem chave interna ganha "m:" + ID -- todo dispositivo chega na mesma chave
  const uids = new Set();
  s.profiles.forEach(pr=>{
    let u = pr.uid || ('m:' + pr.id);
    if(uids.has(u)){ let n = 2; while(uids.has(u + '#' + n)) n++; u = u + '#' + n; }
    uids.add(u); pr.uid = u;
  });
  s.padroes = normalizePadroes(s.padroes || {});
  if(!Array.isArray(s.products)){
    if(!Array.isArray(s.skus)) return null;
    const g = agruparEmProdutos(s.skus, s.profiles);
    s.products = g.produtos;
    if(g.legado > 0 && (g.legado !== g.produtos.length || g.separados > 0)){
      s._migracao = {cadastros: s.skus.length, produtos: g.produtos.length, separados: g.separados};
    }
  }
  delete s.skus;
  s.products.forEach(normalizeProduct);
  const ids = [];
  s.products.forEach(p=> p.listings.forEach(l=> ids.push(l.id)));
  if(ids.indexOf(s.selectedSkuId) === -1) s.selectedSkuId = ids[0] || null;
  return s;
}

function visaoDoAnuncio(prod, lst){
  return {
    id: lst.id, productId: prod.id, productSku: prod.sku,
    sku: lst.sku, name: prod.name, marketplaceId: lst.marketplaceId,
    cogs: prod.cogs, costOverride: prod.costOverride,
    fixedCost: prod.fixedCost, misc: prod.misc, taxPct: prod.taxPct, marketingPct: prod.marketingPct,
    coupon: lst.coupon, freightNet: lst.freightNet, mktFixedFee: lst.mktFixedFee,
    mode: lst.mode, price: lst.price, marginTarget: lst.marginTarget,
    mlUsar: lst.mlUsar, mlFaixas: lst.mlFaixas, mlItemId: lst.mlItemId, mlTipo: lst.mlTipo, mlAtualizadoEm: lst.mlAtualizadoEm,
    mlUsarFrete: lst.mlUsarFrete, mlFreteFaixas: lst.mlFreteFaixas, mlFreteGratis: lst.mlFreteGratis
  };
}

export { normalizeState, agruparEmProdutos, normalizeProfile, normalizeProduct, normalizeListing, skuBase,
  visaoDoAnuncio, MISSING_PROFILE };
