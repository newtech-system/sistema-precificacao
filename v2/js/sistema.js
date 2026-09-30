// ============================================================================
// GERADO por ferramentas/gerar-sistema.js a partir da v1 (index.html). NÃO EDITE À MÃO:
// mude a v1 ou os trechos em ferramentas/porte/ e rode o gerador de novo.
//
// É o código da tela da v1, com a conversa com a planilha do Google trocada pela conversa com o
// banco de dados (ferramentas/porte/02-banco.js).
// ============================================================================
const STORAGE_KEY = 'precificacao_v2';

// Escapa texto vindo do usuário antes de jogar em innerHTML. Sem isso, um nome de produto
// com aspas (ex.: Suporte 5") quebra o atributo value= e some com o resto do formulário.
function esc(v){
  return String(v===undefined||v===null ? '' : v)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Espera o usuário parar de digitar antes de refazer um trabalho caro.
function debounce(fn, ms){
  let t;
  return function(){ const args = arguments; clearTimeout(t); t = setTimeout(()=> fn.apply(null, args), ms); };
}

// redesenho do catálogo agrupado: várias mudanças seguidas viram um desenho só
const recalcularCatalogo = debounce(()=> renderProdutos(), 150);

let toastSeq = 0;
function toast(msg, kind, title){
  const box = document.getElementById('toasts');
  if(!box){ return; }
  const el = document.createElement('div');
  el.className = 'toast ' + (kind||'');
  el.innerHTML = (title ? `<div class="tt">${esc(title)}</div>` : '') + esc(msg);
  box.appendChild(el);
  const id = ++toastSeq;
  el.dataset.id = id;
  setTimeout(()=>{
    el.classList.add('out');
    setTimeout(()=> el.remove(), 200);
  }, kind==='err' ? 7000 : 4000);
  el.onclick = ()=> el.remove();
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

// Modelos prontos de marketplace, usados no botão "+ Adicionar marketplace".
// TikTok Shop cobra por faixa de preço: abaixo de R$50 a comissão é maior e a taxa fixa menor;
// a partir de R$50 inverte. O Programa de Envio (6%) tem teto de R$50 por item, o que na prática
// cria uma terceira faixa a partir de R$833,33, quando o percentual bate no teto.
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
const PRESETS = [
  {key:'tiktokshop', label:'TikTok Shop', hint:'com as faixas de preço já configuradas', data: PRESET_TIKTOK},
  {key:'branco', label:'Em branco', hint:'preencher do zero', data:{
    label:'Novo marketplace', confidence:'baixa', note:'Preencha com os valores reais deste canal de venda.',
    commission:0, service:0, transaction:0, fixedFee:0, tiered:false, tiers:[]}}
];

function defaultState(){
  const profiles = defaultProfiles();
  return normalizeState({
    profiles,
    padroes:{fixedCost:0, misc:0, taxPct:0, marketingPct:0, coupon:0, freightNet:0},
    products:[
      {id:'p_demo1', sku:'DEMO-001', name:'Produto de exemplo (seu pedido real)',
       cogs:0, costOverride:false, fixedCost:0, misc:0, taxPct:0, marketingPct:0,
       listings:[
         {id:'demo1', marketplaceId:'shopee', sku:'DEMO-001-shopee', mode:'price', price:43.89, marginTarget:20,
          coupon:0.88, freightNet:0, mktFixedFee:0}
       ]}
    ],
    selectedSkuId:'demo1'
  });
}

// ---------- modelo: produto pai com um anúncio por marketplace ----------
// O produto guarda UMA vez o que é dele (SKU base, nome, CMV, custos da empresa); cada anúncio
// guarda o que muda de canal para canal (preço ou margem, cupom, frete, taxa fixa, SKU no canal).
// Mudar o CMV no produto recalcula todos os marketplaces de uma vez.
//
// Tudo aqui é declaração de função de propósito: loadState() roda antes de uid, mktSlug e
// profileOf existirem (são const mais abaixo), e chamar um deles daqui quebraria a leitura do
// armazenamento -- o sistema voltaria em silêncio aos dados de fábrica.
// Na v2 os ids são UUID, o formato das chaves do banco: cada item já nasce com o id que terá lá.
function novoId(){
  if(window.crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x=> x.toString(16).padStart(2, '0')).join('');
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
}
function slugDoRotulo(label){
  return String(label||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'');
}
// O marketplace de um anúncio é reconhecido no fim do SKU SÓ pelo ID cadastrado: um SKU que
// termina em "-meli" é do marketplace cujo ID é "meli". O nome não conta e nada é deduzido -- vale
// o ID que está no cadastro do marketplace (o mesmo da planilha). O mais longo é testado primeiro,
// para "-magalulolo" não ser confundido com um ID "lolo".
function idsDosMarketplaces(profiles){
  return (profiles||[]).map(pr=> String(pr.id||'').trim()).filter(Boolean).sort((a,b)=> b.length - a.length);
}
// SKU sem o "-ID" do fim: "07-01-46-meli" -> "07-01-46", se "meli" for o ID de um marketplace
function skuBase(sku, profiles){
  const s = String(sku||'').trim();
  const baixo = s.toLowerCase();
  for(const id of idsDosMarketplaces(profiles)){
    const suf = '-' + id.toLowerCase();
    if(baixo.length > suf.length && baixo.endsWith(suf)) return s.slice(0, -suf.length);
  }
  return s;
}
// ID que o sistema usa quando ninguém escreveu um: o nome, minúsculo e sem espaços
function idPeloNome(label){ return slugDoRotulo(label); }
// ID escrito à mão: minúsculo, sem espaços nem acentos; letras, números, "-" e "_"
function normalizaIdDigitado(texto){
  return String(texto||'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/\s+/g,'').replace(/[^a-z0-9_-]/g,'');
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
  p.id = String(p.id || novoId());
  p.sku = String(p.sku||''); p.name = String(p.name||'');
  p.costOverride = toBool(p.costOverride);
  p.alteradoPor = String(p.alteradoPor||''); p.alteradoEm = String(p.alteradoEm||'');
  if(!Array.isArray(p.listings)) p.listings = [];
  p.listings.forEach(normalizeListing);
  return p;
}

// Visão plana de um anúncio: exatamente o formato do cadastro antigo. É o que o calcSku, as
// exportações e a planilha do Google entendem -- por isso o cálculo não precisou mudar.
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
function listagens(){
  const out = [];
  state.products.forEach(prod=> prod.listings.forEach(l=> out.push(visaoDoAnuncio(prod, l))));
  return out;
}
function anuncioPorId(id){
  for(const prod of state.products){
    const lst = prod.listings.find(l=> l.id === id);
    if(lst) return {prod, lst};
  }
  return null;
}
function produtoPorId(id){ return state.products.find(p=> p.id === id) || null; }

// Linhas planas (formato antigo, backup antigo ou planilha do Google) -> produtos com anúncios.
// Só junta o que é o mesmo produto de verdade: mesmo productId ou, sem ele, mesmo SKU base E os
// mesmos custos. Um produto com CMV diferente entre marketplaces fica separado -- juntar obrigaria
// a escolher um dos números sem avisar, e isso mudaria preço e margem.
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

// Produtos -> linhas planas, uma por anúncio, para a planilha e para o backup legível.
function achatarProdutos(products){
  const rows = [];
  const linha = (prod, l)=>{
    const r = Object.assign(visaoDoAnuncio(prod, l), {
      alteradoPor: l.alteradoPor || '', alteradoEm: l.alteradoEm || '',
      prodAlteradoPor: prod.alteradoPor || '', prodAlteradoEm: prod.alteradoEm || ''});
    CAMPOS_ML.forEach(k=> r[k] = (l[k] === undefined || l[k] === null) ? '' : l[k]);
    return r;
  };
  products.forEach(prod=>{
    if(prod.listings.length === 0){
      rows.push(linha(prod, {id:'p0_' + prod.id, marketplaceId:'', sku:prod.sku, mode:'price',
        price:0, marginTarget:0, coupon:0, freightNet:0, mktFixedFee:0}));
    } else prod.listings.forEach(l=> rows.push(linha(prod, l)));
  });
  return rows;
}

// Um estado que veio do localStorage, de um backup JSON, da planilha ou de uma versão anterior
// do sistema pode não ter campos que foram adicionados depois -- ou nem estar no formato de
// produtos. Tudo passa por aqui.
function normalizeState(s, semPadrao){
  if(!s || !Array.isArray(s.profiles)) return null;
  s.profiles.forEach(normalizeProfile);
  if(s.profiles.length === 0 && !semPadrao) s.profiles = defaultProfiles();
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

// Na v2 o estado vem do banco, ao abrir a empresa (iniciarSistema). Até lá, fica vazio.
function loadState(){
  return {profiles: [], products: [], padroes: normalizePadroes({}), selectedSkuId: null};
}

// Conta uma vez só como os cadastros antigos foram agrupados, e grava o formato novo.
function avisaMigracao(){
  const m = state._migracao;
  if(!m) return;
  delete state._migracao;
  toast(`${m.cadastros} cadastros por marketplace viraram ${m.produtos} produto(s), cada um com seus anúncios.`
    + (m.separados ? ` ${m.separados} SKU(s) ficaram em mais de um produto porque o custo era diferente entre marketplaces -- confira e junte à mão se for o mesmo item.` : ''),
    m.separados ? 'warn' : 'ok', 'Catálogo reorganizado');
}

// Navegador em aba anônima ou com dados de site bloqueados lança SecurityError já na LEITURA
// do localStorage. Sem esta proteção o sistema inteiro morria antes de desenhar a primeira tela.
const store = {
  get(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } },
  set(k,v){ try{ localStorage.setItem(k,v); return true; }catch(e){ return false; } },
  del(k){ try{ localStorage.removeItem(k); }catch(e){} }
};

let state = loadState();
let editingSkuId = null;
// Nome de quem está usando: vem da conta (o mesmo que o banco grava em "alterado por").
let usuario = '';
let CONFLITOS_KEY = 'precificacao_v2_conflitos';   // ganha o id da empresa ao abrir
let conflitosRecentes = [];
let syncTimer = null;
let syncing = false;
let lastSyncOk = null;
let lastSyncTime = null;
let lastSyncError = '';

// Avança a cada alteração de dado; o cache de cálculo compara com isto.
let versaoDados = 0;
// Toda alteração da tela passa por aqui: guarda um rascunho neste navegador (para nada se perder
// se a aba fechar ou a internet cair) e agenda o envio ao banco. Quem só pode ler não altera: a
// tela volta ao que está no banco.
function saveState(){
  versaoDados++;
  if(!base) return;
  if(!podeEditar){
    toast('Seu acesso a esta empresa é só de consulta. A alteração foi desfeita.', 'warn', 'Somente leitura');
    aplicarDados(dadosDaBase());
    return;
  }
  guardarRascunho();
  scheduleSync();
}

// ---------- fila: uma conversa com o banco por vez ----------
// Envio, leitura do que outra pessoa mudou e releitura completa esperam um o outro terminar:
// assim a comparação com a "base" nunca é feita no meio de uma gravação.
let filaSync = Promise.resolve();
let naFilaAgora = 0;
function naFila(fn){
  naFilaAgora++;
  const p = filaSync.then(fn).finally(()=>{ naFilaAgora--; });
  filaSync = p.catch(()=>{});
  return p;
}
function syncOcupado(){ return !!syncTimer || naFilaAgora > 0 || syncing; }

function scheduleSync(){
  if(!base || !podeEditar){ renderSyncPill(); return; }
  clearTimeout(syncTimer);
  renderSyncPill('pending');
  syncTimer = setTimeout(()=>{ syncTimer = null; naFila(enviarAgora); }, 1000);
}


// Cópia só com os dados (sem o que é da tela, como o anúncio selecionado). Vinha da v1, junto
// com a base da planilha.
function dadosDe(s){ return JSON.parse(JSON.stringify({profiles: s.profiles, products: s.products, padroes: s.padroes})); }
// IndexedDB: guarda o rascunho do que ainda não chegou ao banco. O localStorage tem uns 5 MB e
// não caberia um catálogo grande. O banco daqui é outro nome que o da v1: as duas não se misturam.
const idb = {
  abrir(){
    if(!this._p) this._p = new Promise((res, rej)=>{
      try{
        const r = indexedDB.open('precificacao_v2', 1);
        r.onupgradeneeded = ()=> r.result.createObjectStore('kv');
        r.onsuccess = ()=> res(r.result);
        r.onerror = ()=> rej(r.error);
      }catch(e){ rej(e); }
    });
    return this._p;
  },
  async get(k){
    try{
      const db = await this.abrir();
      return await new Promise(res=>{ const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = ()=> res(q.result); q.onerror = ()=> res(undefined); });
    }catch(e){ return undefined; }
  },
  async set(k, v){
    try{
      const db = await this.abrir();
      return await new Promise(res=>{ const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = ()=> res(true); tx.onerror = tx.onabort = ()=> res(false); });
    }catch(e){ return false; }
  },
  async del(k){
    try{ const db = await this.abrir(); db.transaction('kv', 'readwrite').objectStore('kv').delete(k); }catch(e){}
  }
};

// Texto canônico (chaves em ordem) para comparar objetos sem depender da ordem das propriedades.
function canon(v){
  if(Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if(v && typeof v === 'object'){
    return '{' + Object.keys(v).filter(k=> v[k] !== undefined).sort().map(k=> JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}

// Quem mexeu por último em cada item. Não conta como alteração ao comparar.
const META = ['alteradoPor','alteradoEm'];
const CAMPOS_PRODUTO = ['sku','name','cogs','costOverride','fixedCost','misc','taxPct','marketingPct'];
const CAMPOS_ANUNCIO = ['marketplaceId','sku','mode','price','marginTarget','coupon','freightNet','mktFixedFee'];
// Campos do vínculo com o Mercado Livre. Ficam fora de CAMPOS_ANUNCIO de propósito: o formulário e
// o editor em lote gravam "só o que mudou neles", e se estes entrassem naquela lista um salvar
// apagaria o vínculo. Aqui eles entram na sincronização, que precisa vê-los.
const CAMPOS_ML = ['mlItemId','mlVarId','mlTitulo','mlTipo','mlSituacao','mlCategoria','mlPreco','mlPct','mlFixo','mlFaixas','mlUsar','mlAtualizadoEm',
  'mlFrete','mlFreteFaixas','mlFreteGratis','mlFreteOutra','mlLogistica','mlUsarFrete','mlFreteEm',
  'mlConfEm','mlConfPreco','mlConfTaxa','mlConfEnvio','mlConfErro'];

// Os dados em quatro coleções de itens com chave: marketplaces (pela chave interna uid, que não
// muda quando o ID é trocado), produtos, anúncios (com o produto a que pertencem em _prod -- assim
// um anúncio que mudou de produto na unificação é só um campo alterado) e os custos da empresa.
function entidades(d){
  const mk = new Map(), pr = new Map(), an = new Map();
  (d.profiles||[]).forEach(p=>{
    const o = {};
    Object.keys(p).forEach(k=>{ if(k.charAt(0) !== '_') o[k] = p[k]; });
    mk.set(p.uid || ('m:' + p.id), o);
  });
  (d.products||[]).forEach(p=>{
    const o = {id: p.id};
    CAMPOS_PRODUTO.concat(META).forEach(k=> o[k] = (p[k] === undefined || p[k] === null) ? '' : p[k]);
    pr.set(p.id, o);
    (p.listings||[]).forEach(l=>{
      const a = {id: l.id, _prod: p.id};
      CAMPOS_ANUNCIO.concat(CAMPOS_ML, META).forEach(k=> a[k] = (l[k] === undefined || l[k] === null) ? '' : l[k]);
      an.set(l.id, a);
    });
  });
  const pad = {};
  Object.keys(d.padroes||{}).forEach(k=> pad[k] = d.padroes[k]);
  return {mk, pr, an, pad};
}
function semMeta(o){
  const c = {};
  Object.keys(o).forEach(k=>{ if(META.indexOf(k) === -1) c[k] = o[k]; });
  return canon(c);
}
function assinaturaDados(d){
  const E = entidades(d);
  return canon([[...E.mk], [...E.pr], [...E.an], E.pad]);
}

// Quem fez a alteração que veio da planilha. Conteúdo mudado com o mesmo 'quem/quando' de antes
// só pode ser edição feita direto na planilha, que não passa pelo sistema.
function autorRemoto(bo, ro){
  if(bo && ro && bo.alteradoEm === ro.alteradoEm && bo.alteradoPor === ro.alteradoPor) return 'a importação da versão 1';
  return (ro && ro.alteradoPor) || '';
}

// Junta campo a campo. Quem mudou um campo leva; se os dois mudaram o MESMO campo para valores
// diferentes, fica o valor daqui e o caso vai para a lista de conflitos, com o valor da outra pessoa,
// para ser conferido -- nada some sem aparecer.
function mesclaCampos(bo, lo, ro, tipo, id, conflitos){
  const v = {};
  const chaves = new Set(Object.keys(bo).concat(Object.keys(lo), Object.keys(ro)));
  let usouDaqui = false;
  chaves.forEach(k=>{
    if(META.indexOf(k) !== -1) return;
    const b = canon(bo[k]), l = canon(lo[k]), r = canon(ro[k]);
    if(l === b) v[k] = ro[k];
    else if(r === b || l === r){ v[k] = lo[k]; usouDaqui = true; }
    else {
      v[k] = lo[k]; usouDaqui = true;
      conflitos.push({tipo, id, acao:'campo', campo:k, meu: lo[k], deles: ro[k], quem: autorRemoto(bo, ro), obj: lo});
    }
  });
  const fonte = usouDaqui ? lo : ro;
  META.forEach(k=>{ if(fonte[k] !== undefined) v[k] = fonte[k]; });
  return v;
}
function mesclaMapa(b, l, r, tipo, conflitos){
  const res = new Map();
  new Set([...r.keys(), ...l.keys(), ...b.keys()]).forEach(id=>{
    const bo = b.get(id), lo = l.get(id), ro = r.get(id);
    let v = null;
    if(!bo){
      v = (lo && ro) ? mesclaCampos({}, lo, ro, tipo, id, conflitos) : (lo || ro);
    } else {
      const lMud = !!lo && semMeta(lo) !== semMeta(bo);
      const rMud = !!ro && semMeta(ro) !== semMeta(bo);
      if(!lo && !ro) v = null;
      else if(!lo){   // excluído aqui
        if(rMud){ v = ro; conflitos.push({tipo, id, acao:'excluidoAqui', quem: autorRemoto(bo, ro), obj: ro}); }
      } else if(!ro){ // excluído lá
        if(lMud){ v = lo; conflitos.push({tipo, id, acao:'excluidoLa', obj: lo}); }
      }
      else if(!lMud) v = ro;
      else if(!rMud) v = lo;
      else v = mesclaCampos(bo, lo, ro, tipo, id, conflitos);
    }
    if(v) res.set(id, v);
  });
  // ordem: a da planilha, e cada item novo daqui entra logo depois do vizinho que tinha aqui
  const ordem = [...r.keys()].filter(id=> res.has(id));
  const dentro = new Set(ordem);
  let anterior = null;
  [...l.keys()].forEach(id=>{
    if(!res.has(id)) return;
    if(!dentro.has(id)){
      const i = anterior === null ? -1 : ordem.indexOf(anterior);
      ordem.splice(i + 1, 0, id); dentro.add(id);
    }
    anterior = id;
  });
  res.forEach((v, id)=>{ if(!dentro.has(id)) ordem.push(id); });
  const out = new Map();
  ordem.forEach(id=> out.set(id, res.get(id)));
  return out;
}
function semIndefinidos(o){
  const c = {};
  Object.keys(o).forEach(k=>{ if(o[k] !== undefined) c[k] = o[k]; });
  return c;
}
function mesclar(base, local, remoto){
  const B = entidades(base), L = entidades(local), R = entidades(remoto);
  const conflitos = [];
  const mk = mesclaMapa(B.mk, L.mk, R.mk, 'marketplace', conflitos);
  const pr = mesclaMapa(B.pr, L.pr, R.pr, 'produto', conflitos);
  const an = mesclaMapa(B.an, L.an, R.an, 'anuncio', conflitos);
  const pad = mesclaCampos(B.pad, L.pad, R.pad, 'padroes', 'padroes', conflitos);
  // produto excluído de um lado e alterado do outro fica -- e com os anúncios que tinha do lado que
  // o manteve (excluir o produto levava os anúncios junto, e eles não devem sumir sozinhos)
  conflitos.forEach(c=>{
    if(c.tipo !== 'produto' || (c.acao !== 'excluidoAqui' && c.acao !== 'excluidoLa')) return;
    const lado = c.acao === 'excluidoAqui' ? R : L;
    lado.an.forEach((a, id)=>{ if(a._prod === c.id && !an.has(id)) an.set(id, a); });
  });
  // anúncio alterado de um lado cujo produto foi excluído do outro: o produto volta
  an.forEach(a=>{
    if(pr.has(a._prod)) return;
    const p = L.pr.get(a._prod) || R.pr.get(a._prod) || B.pr.get(a._prod);
    if(p){ pr.set(a._prod, p); conflitos.push({tipo:'produto', id:a._prod, acao:'recriado', obj:p}); }
  });
  // anúncio apontando para um ID de marketplace que foi trocado do outro lado: segue o marketplace
  const idsMk = new Set([...mk.values()].map(p=> p.id));
  const uidPorId = new Map();
  [B, R, L].forEach(E=> E.mk.forEach((p, uid)=> uidPorId.set(p.id, uid)));
  an.forEach((a, id)=>{
    if(!a.marketplaceId || idsMk.has(a.marketplaceId)) return;
    const m = mk.get(uidPorId.get(a.marketplaceId));
    if(!m) return;
    const antigo = a.marketplaceId;
    a.marketplaceId = m.id;
    // o SKU não é mexido (pode ser o SKU de verdade no marketplace); só avisa se ficou com o final velho
    if(String(a.sku).toLowerCase().endsWith('-' + antigo.toLowerCase()))
      conflitos.push({tipo:'anuncio', id, acao:'idTrocado', obj:a, antigo, novo:m.id});
  });
  const products = [...pr.values()].map(p=> Object.assign(semIndefinidos(p), {listings: []}));
  const porId = new Map(products.map(p=> [p.id, p]));
  an.forEach(a0=>{
    const a = semIndefinidos(a0);
    const dono = porId.get(a._prod);
    delete a._prod;
    if(dono) dono.listings.push(a);
  });
  // os dois lados puseram o produto no mesmo marketplace: fica tudo, mas avisa
  products.forEach(p=>{
    const vistos = new Set();
    p.listings.forEach(l=>{
      if(vistos.has(l.marketplaceId)) conflitos.push({tipo:'produto', id:p.id, acao:'canalRepetido', obj:p, mid:l.marketplaceId});
      vistos.add(l.marketplaceId);
    });
  });
  return {dados: {profiles: [...mk.values()].map(semIndefinidos), products, padroes: semIndefinidos(pad)}, conflitos};
}

// Coloca dados novos no sistema SEM trocar os objetos que já existem: um formulário aberto, a
// importação ou a revisão de unificação guardam referência a produtos e anúncios, e se o objeto
// fosse trocado por um novo o que a pessoa salvasse ali iria para um objeto solto e se perderia.
function aplicarDados(dados, migracao){
  const novo = normalizeState(Object.assign(JSON.parse(JSON.stringify(dados)), {selectedSkuId: state.selectedSkuId}));
  if(!novo) return;
  const reaproveita = (velho, n)=>{ Object.keys(velho).forEach(k=> delete velho[k]); return Object.assign(velho, n); };
  const velhosMk = new Map(state.profiles.map(p=> [p.uid, p]));
  const velhosP = new Map(state.products.map(p=> [p.id, p]));
  const velhosL = new Map();
  state.products.forEach(p=> p.listings.forEach(l=> velhosL.set(l.id, l)));
  novo.profiles = novo.profiles.map(p=> velhosMk.has(p.uid) ? reaproveita(velhosMk.get(p.uid), p) : p);
  novo.products = novo.products.map(p=>{
    const lst = p.listings.map(l=> velhosL.has(l.id) ? reaproveita(velhosL.get(l.id), l) : l);
    return velhosP.has(p.id) ? reaproveita(velhosP.get(p.id), Object.assign(p, {listings: lst})) : Object.assign(p, {listings: lst});
  });
  if(migracao) novo._migracao = migracao;
  state = novo;
  versaoDados++;   // dados novos: resultados guardados não valem mais
  renderProdutos();
  if(document.getElementById('view-marketplaces').classList.contains('active')) renderMarketplaces();
  if(document.getElementById('view-padroes').classList.contains('active')) renderPadroes();
  if(document.getElementById('view-ml').classList.contains('active')) renderML();
  avisaMigracao();
  avisaFormularioDesatualizado();
}
// Formulário de produto aberto e alguém salvou aquele produto: os campos na tela estão velhos.
function avisaFormularioDesatualizado(){
  const form = document.getElementById('skuForm');
  if(!editingSkuId || form.style.display === 'none' || document.getElementById('f_avisoRemoto')) return;
  const acoes = form.querySelector('.form-actions');
  if(!acoes) return;
  const p = document.createElement('p');
  p.id = 'f_avisoRemoto'; p.className = 'warnline';
  p.style.cssText = 'color:var(--warn);margin:12px 0 0;';
  p.textContent = 'Outra pessoa salvou alterações enquanto este formulário estava aberto, e os valores na tela podem estar velhos. Ao salvar, só o que você mudou aqui é gravado: o resto fica como está agora. Para ver os valores novos, cancele e abra de novo.';
  acoes.parentNode.insertBefore(p, acoes);
}

// ---------- quem mudou o quê ----------
const ROTULOS_CAMPO = {
  produto: {sku:'SKU do produto', name:'Nome', cogs:'Custo (CMV)', costOverride:'Custo próprio (destravado)', fixedCost:'Custo fixo',
    misc:'Outros custos', taxPct:'Imposto %', marketingPct:'Marketing %'},
  anuncio: {_prod:'Produto', marketplaceId:'Marketplace', sku:'SKU do anúncio', mode:'Definido por', price:'Preço',
    mlItemId:'Anúncio no Mercado Livre', mlVarId:'Variação no ML', mlTitulo:'Título no ML', mlTipo:'Tipo de anúncio no ML',
    mlSituacao:'Situação no ML', mlCategoria:'Categoria no ML', mlPreco:'Preço no ML', mlPct:'Comissão do ML %',
    mlFixo:'Custo fixo do ML', mlFaixas:'Faixas de taxa do ML', mlUsar:'Usar as taxas do ML', mlAtualizadoEm:'Taxas do ML atualizadas em',
    mlFrete:'Custo de envio do ML', mlFreteFaixas:'Faixas de envio do ML', mlFreteGratis:'Anúncio com frete grátis',
    mlFreteOutra:'Envio na outra opção', mlLogistica:'Logística do ML', mlUsarFrete:'Usar o envio do ML', mlFreteEm:'Envio do ML atualizado em',
    mlConfEm:'Conferido com o ML em', mlConfPreco:'Preço conferido', mlConfTaxa:'Taxa informada pelo ML', mlConfEnvio:'Envio informado pelo ML', mlConfErro:'Erro na conferência',
    marginTarget:'Margem alvo %', coupon:'Cupom', freightNet:'Frete líquido', mktFixedFee:'Taxa fixa do anúncio'},
  marketplace: {id:'ID', label:'Nome', color:'Cor', confidence:'Confiança', note:'Observação', commission:'Comissão %', ehMercadoLivre:'É o Mercado Livre',
    service:'Taxa de serviço %', transaction:'Taxa de transação %', fixedFee:'Taxa fixa', dualAdPrice:'Preço de anúncio duplo',
    variableFreight:'Frete por anúncio', variableFixedFee:'Taxa fixa por anúncio', tiered:'Cobra por faixa de preço', tiers:'Faixas de preço'},
  padroes: {fixedCost:'Custo fixo', misc:'Outros custos', taxPct:'Imposto %', marketingPct:'Marketing %', coupon:'Cupom padrão', freightNet:'Frete padrão'}
};
const CAMPOS_FORA_DO_HISTORICO = ['uid','idManual'];
function rotuloCampo(tipo, k){ return (ROTULOS_CAMPO[tipo] || {})[k] || k; }
function textoValor(v){
  // faixas de preço: legível em vez do JSON guardado na planilha
  if(Array.isArray(v) && v.length && v[0] && typeof v[0] === 'object' && 'min' in v[0]){
    return v.map(t=> `a partir de ${brl(t.min)}: ${t.commission}%`
      + (t.service ? ` + ${t.service}%${t.serviceCap ? ' (teto ' + brl(t.serviceCap) + ')' : ''}` : '')
      + (t.transaction ? ` + ${t.transaction}%` : '')
      + (t.fixedFee ? ` + ${brl(t.fixedFee)}` : '')).join('; ');
  }
  if(v === true) return 'sim';
  if(v === false) return 'não';
  if(v === undefined || v === null) return '';
  if(typeof v === 'number') return v.toLocaleString('pt-BR', {maximumFractionDigits: 4});
  if(typeof v === 'object') return JSON.stringify(v).slice(0, 200);
  return String(v);
}
// Nome legível de um item, procurando nos dados que existirem (o item pode já ter sido excluído)
function nomeDoItem(tipo, id, obj, fontes){
  const acha = (fn)=>{ for(const f of fontes){ const r = fn(f); if(r) return r; } return null; };
  if(tipo === 'padroes') return 'Custos da empresa';
  if(tipo === 'marketplace') return 'Marketplace ' + ((obj && obj.label) || id);
  if(tipo === 'produto') return 'Produto ' + ((obj && obj.sku) || id) + ((obj && obj.name) ? ' · ' + obj.name : '');
  const mid = obj && obj.marketplaceId;
  const mk = acha(E=> [...E.mk.values()].find(p=> p.id === mid));
  return 'Anúncio ' + ((obj && obj.sku) || id) + ' (' + ((mk && mk.label) || mid || '?') + ')';
}


// ---------- conflitos: o que foi mudado dos dois lados ----------
function registrarConflitos(lista, B, L, R){
  if(!lista.length) return;
  const agora = new Date().toISOString();
  const fontes = [L, R, B];
  const novos = lista.map(c=>{
    const onde = nomeDoItem(c.tipo, c.id, c.obj, fontes);
    const quem = c.quem || 'outra pessoa';
    let texto;
    if(c.acao === 'campo') texto = `${rotuloCampo(c.tipo, c.campo)}: você pôs ${textoValor(c.meu) || '(vazio)'} e ${quem} pôs ${textoValor(c.deles) || '(vazio)'}. Ficou o seu.`;
    else if(c.acao === 'excluidoAqui') texto = `Você excluiu, mas ${quem} alterou ao mesmo tempo. O item foi mantido; exclua de novo se for o caso.`;
    else if(c.acao === 'excluidoLa') texto = 'Outra pessoa excluiu, mas você tinha alterado. O item foi mantido com a sua alteração.';
    else if(c.acao === 'recriado') texto = 'Outra pessoa excluiu o produto, mas um anúncio dele tinha sido alterado. O produto voltou.';
    else if(c.acao === 'idTrocado') texto = `Foi criado com o ID antigo "${c.antigo}" enquanto o ID do marketplace era trocado para "${c.novo}". Já está no marketplace certo, mas o SKU ainda termina em -${c.antigo}: corrija no produto se precisar.`;
    else if(c.acao === 'canalRepetido') texto = `Ficou com dois anúncios em ${profileOf(c.mid).label}: cada pessoa acrescentou um. Confira e exclua o que sobrar.`;
    else texto = c.acao;
    return {quando: agora, onde, texto, tipo: c.tipo, id: c.id, campo: c.acao === 'campo' ? c.campo : null,
      deles: c.acao === 'campo' ? c.deles : null, quem: c.quem || ''};
  });
  conflitosRecentes = novos.concat(conflitosRecentes).slice(0, 60);
  store.set(CONFLITOS_KEY, JSON.stringify(conflitosRecentes));
  toast(`${novos.length === 1 ? 'Um item foi alterado' : novos.length + ' itens foram alterados'} aqui e por outra pessoa ao mesmo tempo. Juntei tudo; confira em Histórico → Conflitos.`, 'warn', 'Alterações juntadas');
  atualizaTelaDeSync();
}
// "Usar o valor da outra pessoa" num conflito de campo
function usarValorDeles(i){
  const c = conflitosRecentes[i];
  if(!c || c.campo === null) return;
  let alvo = null;
  if(c.tipo === 'marketplace') alvo = state.profiles.find(p=> p.uid === c.id);
  else if(c.tipo === 'produto') alvo = produtoPorId(c.id);
  else if(c.tipo === 'anuncio'){ const a = anuncioPorId(c.id); alvo = a && a.lst; }
  else if(c.tipo === 'padroes') alvo = state.padroes;
  if(!alvo || c.campo === '_prod'){ toast('Esse item não existe mais ou não dá para trocar daqui.', 'err'); return; }
  if(c.tipo === 'marketplace' && c.campo === 'id'){ toast('Para o ID do marketplace, use o campo "ID do marketplace" no cartão dele: assim os anúncios acompanham.', 'warn'); return; }
  alvo[c.campo] = c.deles;
  if(c.tipo === 'marketplace') normalizeProfile(alvo);
  conflitosRecentes.splice(i, 1);
  store.set(CONFLITOS_KEY, JSON.stringify(conflitosRecentes));
  saveState();
  renderProdutos();
  if(document.getElementById('view-marketplaces').classList.contains('active')) renderMarketplaces();
  if(document.getElementById('view-padroes').classList.contains('active')) renderPadroes();
  atualizaTelaDeSync();
  toast('Valor trocado.', 'ok');
}

// Alterações de outras pessoas que chegaram nesta leitura: quantas e de quem
// "seus": campos que VOCÊ tinha alterado por último e que outra pessoa trocou depois -- quem teve
// o valor substituído fica sabendo, não só quem salvou por último.
function contarRecebidas(base, remoto){
  const B = entidades(base), R = entidades(remoto);
  const nomes = new Set();
  const seus = [];
  let n = 0;
  const olha = (bm, rm, tipo)=>{
    rm.forEach((ro, id)=>{
      const bo = bm.get(id);
      if(bo && semMeta(bo) === semMeta(ro)) return;
      n++;
      const autor = autorRemoto(bo, ro);
      if(autor && autor !== usuario) nomes.add(autor);
      if(bo && usuario && bo.alteradoPor === usuario && autor !== usuario){
        Object.keys(ro).forEach(k=>{
          if(META.indexOf(k) !== -1 || CAMPOS_FORA_DO_HISTORICO.indexOf(k) !== -1 || k === '_prod' || canon(bo[k]) === canon(ro[k])) return;
          seus.push({tipo, id, campo: k,
            texto: `${nomeDoItem(tipo, id, ro, [R, B])}: ${rotuloCampo(tipo, k)} ${textoValor(bo[k]) || '(vazio)'} → ${textoValor(ro[k]) || '(vazio)'} (${autor || 'outra pessoa'})`});
        });
      }
    });
    bm.forEach((bo, id)=>{ if(!rm.has(id)) n++; });
  };
  olha(B.mk, R.mk, 'marketplace'); olha(B.pr, R.pr, 'produto'); olha(B.an, R.an, 'anuncio');
  if(canon(B.pad) !== canon(R.pad)) n++;
  return {n, nomes: [...nomes], seus};
}

// ---------- conversa com o banco de dados (v2) ----------
// A "base" é o banco como este navegador o viu da última vez, linha por linha, com a versão de
// cada registro. Comparando a base com a tela sai exatamente o que mudou aqui, campo por campo; e
// quando outra pessoa grava, a junção é a MESMA da v1 (mesclar): quem mudou um campo leva, e se os
// dois mudaram o mesmo campo fica o daqui e o caso aparece em Conflitos.
//
// V2 é a ponte com o módulo que fala com o Supabase (js/inicio.js).
let empresa = null;       // {id, nome}
let papel = null;         // 'admin' | 'dono' | 'editor' | 'leitor'
let podeEditar = false;
let meuId = null;
let base = null;          // {linhas: {emp, mk, pr, an, vi}, cache}
let canalNoAr = false;

function linhasComoMapas(l){
  return {
    emp: l.empresa,
    mk: new Map(l.marketplaces.map(r=> [r.id, r])),
    pr: new Map(l.produtos.map(r=> [r.id, r])),
    an: new Map(l.anuncios.map(r=> [r.id, r])),
    vi: new Map(l.vinculos.map(r=> [r.anuncio_id, r]))
  };
}
function mapasComoLinhas(m){
  return {empresa: m.emp, marketplaces: [...m.mk.values()], produtos: [...m.pr.values()],
    anuncios: [...m.an.values()], vinculos: [...m.vi.values()]};
}
function copiaDosMapas(m){
  return {emp: m.emp, mk: new Map(m.mk), pr: new Map(m.pr), an: new Map(m.an), vi: new Map(m.vi)};
}
// O estado da v1 que estas linhas representam, normalizado igual à tela (sem inventar
// marketplaces de fábrica: a base é o que está no banco, nem mais nem menos).
function dadosDasLinhas(m){
  const cru = V2.modelo.estadoDoBanco(mapasComoLinhas(m));
  return dadosDe(normalizeState(Object.assign(cru, {selectedSkuId: null}), true));
}
function dadosDaBase(){
  if(!base.cache.dados) base.cache.dados = dadosDasLinhas(base.linhas);
  return base.cache.dados;
}
function mudouABase(){ base.cache = {}; }
// código do marketplace -> id no banco (os removidos também: são dos anúncios órfãos)
function mkPorCodigo(perfisLocais){
  const mapa = new Map();
  base.linhas.mk.forEach(r=> mapa.set(r.codigo, r.id));
  (perfisLocais || []).forEach(p=> mapa.set(p.id, p.uid));
  return mapa;
}
function versoesDaBase(){
  const v = t=> new Map([...base.linhas[t]].map(([id, r])=> [id, r.versao]));
  return {mk: v('mk'), pr: v('pr'), an: v('an'), vi: v('vi'), emp: base.linhas.emp.versao};
}
// O que falta gravar: a diferença entre a base e a tela, já no formato do "salvar".
function opsPendentes(){
  if(!base) return [];
  if(!base.cache.antes) base.cache.antes = V2.modelo.linhasDoEstado(dadosDaBase(), mkPorCodigo());
  // lê a tela direto, sem copiar: linhasDoEstado não altera nada (catálogo grande = menos trabalho a cada gravação)
  const agora = V2.modelo.linhasDoEstado(state, mkPorCodigo(state.profiles));
  return V2.modelo.operacoes(base.cache.antes, agora, versoesDaBase());
}
function temPendencia(){ return !!base && podeEditar && opsPendentes().length > 0; }

// Item criado por um backup antigo ou pela junção com ids da v1: ganha um id no formato do banco.
function garantirUuids(){
  const U = V2.modelo.UUID;
  state.profiles.forEach(p=>{ if(!U.test(p.uid)) p.uid = novoId(); });
  state.products.forEach(p=>{
    if(!U.test(p.id)){
      const antigo = p.id; p.id = novoId();
      if(selecaoLote.has(antigo)){ selecaoLote.delete(antigo); selecaoLote.add(p.id); }
    }
    p.listings.forEach(l=>{
      if(!U.test(l.id)){ const antigo = l.id; l.id = novoId(); if(state.selectedSkuId === antigo) state.selectedSkuId = l.id; }
    });
  });
}

// ---------- rascunho: o que ainda não chegou ao banco fica guardado neste navegador ----------
// Se a aba fechar ou a internet cair antes do envio, na próxima abertura o rascunho é juntado com
// o banco (a mesma junção de sempre) e enviado. Guardado no IndexedDB, que cabe catálogo grande.
function chaveDoRascunho(){ return 'rascunho:' + empresa.id + ':' + meuId; }
const guardarRascunho = debounce(()=>{
  if(!base) return;
  if(!temPendencia()){ idb.del(chaveDoRascunho()); return; }
  idb.set(chaveDoRascunho(), {quando: new Date().toISOString(), base: mapasComoLinhas(base.linhas), local: dadosDe(state)});
}, 800);

// ---------- envio ----------
const MAPA_T = {marketplaces: 'mk', produtos: 'pr', anuncios: 'an', ml_vinculos: 'vi'};
let ultimoErroAvisado = '';

// Depois que o banco confirmou uma operação, a base passa a ter aquele valor.
function aplicarNaBase(op, r){
  if(op.t === 'empresas'){
    base.linhas.emp = Object.assign({}, base.linhas.emp, op.campos, {versao: r.versao});
    return;
  }
  const mapa = base.linhas[MAPA_T[op.t]];
  if(op.acao === 'excluir' && !r.removido){
    mapa.delete(op.id);
    if(op.t === 'produtos'){   // o banco leva os anúncios junto
      [...base.linhas.an].forEach(([id, a])=>{ if(a.produto_id === op.id){ base.linhas.an.delete(id); base.linhas.vi.delete(id); } });
    }
    if(op.t === 'anuncios') base.linhas.vi.delete(op.id);
    return;
  }
  if(r.removido){
    // marketplace com anúncios: fica marcado como removido, e o código ganha um final para liberar
    // o ID. Os anúncios órfãos daqui acompanham o código novo (continuam "marketplace removido").
    const velha = mapa.get(op.id);
    const novoCodigo = velha.codigo + '~removido~' + op.id.slice(0, 8);
    mapa.set(op.id, Object.assign({}, velha, {removido: true, codigo: novoCodigo, versao: r.versao}));
    state.products.forEach(p=> p.listings.forEach(l=>{
      if(l.marketplaceId === velha.codigo && !state.profiles.some(x=> x.id === l.marketplaceId)) l.marketplaceId = novoCodigo;
    }));
    return;
  }
  const chave = op.t === 'ml_vinculos' ? {anuncio_id: op.id} : {id: op.id};
  mapa.set(op.id, Object.assign({}, mapa.get(op.id) || {removido: false}, chave, {empresa_id: empresa.id}, op.campos,
    {versao: r.versao, alterado_por_nome: usuario, alterado_em: new Date().toISOString()}));
}
// "Última alteração: você, agora" na tela, sem esperar a próxima leitura
function carimbarNaTela(op){
  const agora = new Date().toISOString();
  let alvo = null;
  if(op.t === 'marketplaces') alvo = state.profiles.find(p=> p.uid === op.id);
  else if(op.t === 'produtos') alvo = produtoPorId(op.id);
  else if(op.t === 'anuncios' || op.t === 'ml_vinculos'){ const a = anuncioPorId(op.id); alvo = a && a.lst; }
  if(alvo){ alvo.alteradoPor = usuario; alvo.alteradoEm = agora; }
}

async function enviarAgora(){
  if(!base || !podeEditar) return;
  syncing = true;
  renderSyncPill('syncing');
  let erros = [];
  try{
    for(let volta = 0; volta < 12; volta++){
      garantirUuids();
      const ops = opsPendentes();
      if(!ops.length) break;
      // em lotes: um cadastro em massa de milhares de itens vai em partes, cada uma numa transação
      const lote = ops.slice(0, 400);
      const res = await V2.salvarLote(empresa.id, lote);
      const reler = {marketplaces: [], produtos: [], anuncios: [], ml_vinculos: []};
      let precisaReler = false, relerEmpresa = false;
      res.forEach(r=>{
        const op = lote[r.i];
        if(!op) return;
        if(r.ok){ aplicarNaBase(op, r); carimbarNaTela(op); }
        else if(r.conflito || r.sumiu){
          precisaReler = true;
          if(op.t === 'empresas') relerEmpresa = true; else reler[op.t].push(op.id);
        }
        else erros.push(Object.assign({op}, r));
      });
      mudouABase();
      // alguém gravou antes: lê o que está lá agora, junta e manda de novo o que for daqui
      if(precisaReler) await buscarEJuntar(reler, relerEmpresa);
      if(erros.length) break;   // não insiste no que o banco recusou; tenta de novo daqui a pouco
    }
    if(erros.some(e=> e.erro === 'permissao')){
      // o acesso mudou (ex.: virou leitor): o que não pode ser gravado sai da tela
      aplicarDados(dadosDaBase());
      toast('Seu acesso a esta empresa mudou e algumas alterações não puderam ser gravadas. A tela voltou ao que está no banco.', 'err', 'Sem permissão');
      erros = erros.filter(e=> e.erro !== 'permissao');
    }
    if(erros.length){
      const msg = erros[0].msg || 'O banco recusou a gravação.';
      throw new Error((erros.length > 1 ? erros.length + ' alterações não foram gravadas. A primeira: ' : '') + msg);
    }
    if(temPendencia()) throw new Error('Muitas gravações seguidas; o resto vai em instantes. Nada foi perdido.');
    lastSyncOk = true; lastSyncTime = new Date(); lastSyncError = ''; ultimoErroAvisado = '';
  }catch(err){
    lastSyncOk = false;
    lastSyncError = mensagemDeErroDeRede(err);
    if(lastSyncError !== ultimoErroAvisado){ ultimoErroAvisado = lastSyncError; toast(lastSyncError + ' As alterações continuam na tela e guardadas neste navegador.', 'err', 'Não foi possível gravar'); }
    clearTimeout(syncTimer);
    syncTimer = setTimeout(()=>{ syncTimer = null; naFila(enviarAgora); }, 15000);
  }
  syncing = false;
  guardarRascunho();
  renderSyncPill();
  atualizaTelaDeSync();
}

function atualizaTelaDeSync(){
  const v = document.getElementById('view-historico');
  if(v && v.classList.contains('active')) renderHistoricoView();
}

function mensagemDeErroDeRede(err){
  const m = (err && err.message) || String(err);
  if(/Failed to fetch|NetworkError|Load failed|conexão/i.test(m)) return 'Sem conexão com o banco agora.';
  if(/JWT|expired|sess/i.test(m)) return 'Sua sessão expirou. Recarregue a página e entre de novo.';
  return m;
}

// ---------- o que outra pessoa gravou ----------
// Lê só os registros pedidos (ou tudo, com "tudo"), monta o banco como está agora e junta com a tela.
async function buscarEJuntar(ids, relerEmpresa, tudo){
  let novas;
  if(tudo){
    novas = linhasComoMapas(await V2.carregarEmpresa(empresa.id));
  } else {
    novas = copiaDosMapas(base.linhas);
    // anúncio e vínculo com o ML andam juntos na tela: mudou um, relê os dois
    const anIds = [...new Set((ids.anuncios || []).concat(ids.ml_vinculos || []))];
    const mkIds = ids.marketplaces || [], prIds = ids.produtos || [];
    const [mks, prs, ans, vis, emp] = await Promise.all([
      mkIds.length ? V2.lerPorIds('marketplaces', mkIds) : [],
      prIds.length ? V2.lerPorIds('produtos', prIds) : [],
      anIds.length ? V2.lerPorIds('anuncios', anIds) : [],
      anIds.length ? V2.lerPorIds('ml_vinculos', anIds) : [],
      relerEmpresa ? V2.lerEmpresa(empresa.id) : null
    ]);
    const troca = (mapa, pedidos, achados, chave)=>{
      const vistos = new Set(achados.map(r=> r[chave]));
      pedidos.forEach(id=>{ if(!vistos.has(id)) mapa.delete(id); });
      achados.forEach(r=> mapa.set(r[chave], r));
    };
    troca(novas.mk, mkIds, mks, 'id');
    troca(novas.pr, prIds, prs, 'id');
    troca(novas.an, anIds, ans, 'id');
    troca(novas.vi, anIds, vis, 'anuncio_id');
    // produto excluído leva os anúncios junto
    prIds.forEach(id=>{
      if(novas.pr.has(id)) return;
      [...novas.an].forEach(([aid, a])=>{ if(a.produto_id === id){ novas.an.delete(aid); novas.vi.delete(aid); } });
    });
    // anúncio que aponta para produto ou marketplace que esta tela ainda não conhece: busca também
    const faltaPr = [...new Set([...novas.an.values()].map(a=> a.produto_id).filter(id=> !novas.pr.has(id)))];
    const faltaMk = [...new Set([...novas.an.values()].map(a=> a.marketplace_id).filter(id=> !novas.mk.has(id)))];
    if(faltaPr.length) (await V2.lerPorIds('produtos', faltaPr)).forEach(r=> novas.pr.set(r.id, r));
    if(faltaMk.length) (await V2.lerPorIds('marketplaces', faltaMk)).forEach(r=> novas.mk.set(r.id, r));
    if(emp) novas.emp = emp;
  }
  juntarComOBanco(novas);
}

function juntarComOBanco(novas){
  const antes = dadosDaBase();
  const remoto = dadosDasLinhas(novas);
  const local = dadosDe(state);
  const recebidas = contarRecebidas(antes, remoto);
  const r = mesclar(antes, local, remoto);
  base.linhas = novas; mudouABase();
  if(assinaturaDados(r.dados) !== assinaturaDados(local)) aplicarDados(r.dados);
  registrarConflitos(r.conflitos, entidades(antes), entidades(local), entidades(remoto));
  if(recebidas.n && recebidas.nomes.length)
    toast(`${recebidas.nomes.join(', ')} ${recebidas.nomes.length > 1 ? 'fizeram' : 'fez'} ${recebidas.n} alteração(ões). Já estão na sua tela.`, 'ok', 'Atualizado');
  // o que virou conflito já foi avisado (e ficou o seu valor): não repete aqui
  const seus = recebidas.seus.filter(s=> !r.conflitos.some(c=> c.tipo === s.tipo && c.id === s.id));
  if(seus.length){
    toast(seus.slice(0, 3).map(s=> s.texto).join(' · ') + (seus.length > 3 ? ` · e mais ${seus.length - 3} (veja em Histórico)` : ''), 'warn', 'Trocaram algo que você tinha alterado');
  }
  renderSyncPill();
  if(temPendencia()) scheduleSync();
}

// Aviso do banco: {mudou:[{t,id,v}]} ou {recarregar:true}. Os avisos se acumulam por um instante e
// são tratados na fila, depois de qualquer envio em andamento; aí o que já está na base (inclusive
// o que esta própria tela acabou de gravar) é descartado, e só o resto é lido.
let avisosPendentes = [];
let relerTudoPedido = false;
const tratarAvisos = debounce(()=> naFila(async ()=>{
  const lista = avisosPendentes; avisosPendentes = [];
  const tudo = relerTudoPedido; relerTudoPedido = false;
  if(!base) return;
  try{
    if(tudo){ await buscarEJuntar(null, false, true); return; }
    const ids = {marketplaces: [], produtos: [], anuncios: [], ml_vinculos: []};
    let emp = false, algum = false;
    lista.forEach(x=>{
      if(x.t === 'empresas'){ if(x.v !== base.linhas.emp.versao){ emp = true; algum = true; } return; }
      const mapa = base.linhas[MAPA_T[x.t]];
      if(!mapa) return;
      const r = mapa.get(x.id);
      const novo = x.v === null ? !!r : (!r || r.versao !== x.v);
      if(novo && ids[x.t].indexOf(x.id) === -1){ ids[x.t].push(x.id); algum = true; }
    });
    if(algum) await buscarEJuntar(ids, emp, false);
  }catch(err){
    // não conseguiu ler agora: na próxima reconexão (ou ao voltar para a aba) relê tudo
    relerTudoPedido = true;
    console.warn('Não foi possível ler as alterações de outra pessoa agora.', err);
  }
}), 300);
function aoAvisoDoBanco(p){
  if(p && p.recarregar) relerTudoPedido = true;
  else if(p && Array.isArray(p.mudou)) avisosPendentes.push(...p.mudou);
  tratarAvisos();
}
// Canal caiu e voltou: pode ter perdido avisos no meio. Relê tudo e junta.
let canalJaConectou = false;
function aoStatusDoCanal(status){
  const antes = canalNoAr;
  canalNoAr = status === 'SUBSCRIBED';
  if(canalNoAr && canalJaConectou && !antes){ relerTudoPedido = true; tratarAvisos(); }
  if(canalNoAr) canalJaConectou = true;
  renderSyncPill();
}
function relerTudo(){ relerTudoPedido = true; tratarAvisos(); }

// O Google Sheets devolve booleano como a string 'TRUE'/'true' ou como o número 1 -- nunca como
// boolean de verdade. E 'FALSE' é truthy em JS, então a coerção precisa ser explícita.
// Precisa ser declaração de função (não const): normalizeSku é chamado por loadState(), que roda
// bem antes desta linha -- com const, a leitura do localStorage falhava e o sistema voltava
// silenciosamente aos dados de fábrica a cada recarga.
function toBool(v){ return (v === true || v === 'TRUE' || v === 'true' || v === 1 || v === '1'); }

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


function dataHora(iso){
  const d = new Date(iso);
  return (!iso || isNaN(d)) ? String(iso||'') : d.toLocaleString('pt-BR', {day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit'});
}
function ultimaAlteracao(prod){
  let quem = '', quando = '';
  [prod].concat(prod.listings || []).forEach(o=>{ if(o.alteradoEm && o.alteradoEm > quando){ quando = o.alteradoEm; quem = o.alteradoPor; } });
  return quando ? `Última alteração: ${quem || 'sem nome'}, ${dataHora(quando)}.` : '';
}
function renderConflitos(){
  const card = document.getElementById('conflitosCard');
  if(!conflitosRecentes.length){ card.style.display = 'none'; return; }
  card.style.display = '';
  document.getElementById('conflitosLista').innerHTML = conflitosRecentes.map((c, i)=> `<div class="conf-linha">
      <div class="conf-txt"><b>${esc(c.onde)}</b> <span class="muted">${esc(dataHora(c.quando))}</span><br>${esc(c.texto)}</div>
      ${c.campo !== null && c.campo !== '_prod' ? `<button class="btn small" data-usar="${i}">Usar o de ${esc(c.quem || 'outra pessoa')}</button>` : ''}
      <button class="btn small" data-visto="${i}">Ok, visto</button>
    </div>`).join('');
}
function renderSyncPill(forceState){
  const pill = document.getElementById('syncPill');
  const txt = document.getElementById('syncPillText');
  if(!pill || !txt) return;
  if(!base){ pill.className = 'sync-pill sync-off'; txt.textContent = 'Carregando...'; return; }
  if(!podeEditar){ pill.className = 'sync-pill sync-off'; txt.textContent = 'Somente consulta'; return; }
  const st = forceState || (syncing ? 'syncing' : (lastSyncOk === false ? 'error' : 'ok'));
  if(st === 'pending'){ pill.className = 'sync-pill sync-warn'; txt.textContent = 'Alterações pendentes...'; }
  else if(st === 'syncing'){ pill.className = 'sync-pill sync-warn'; txt.textContent = 'Salvando...'; }
  else if(st === 'error'){ pill.className = 'sync-pill sync-err'; txt.textContent = /conexão/i.test(lastSyncError) ? 'Sem conexão' : 'Erro ao salvar'; }
  else if(!canalNoAr){ pill.className = 'sync-pill sync-warn'; txt.textContent = 'Salvo · reconectando'; }
  else { pill.className = 'sync-pill sync-ok'; txt.textContent = 'Salvo no banco'; }
}

function renderHistoricoView(){
  const detail = document.getElementById('syncStatusDetail');
  if(detail){
    const quem = `Empresa <b>${esc(empresa ? empresa.nome : '')}</b>, como <b>${esc(usuario)}</b> (${esc(({admin:'administrador', dono:'dono', editor:'editor', leitor:'leitor'})[papel] || papel || '')}).`;
    let estado;
    if(!podeEditar) estado = 'Seu acesso é só de consulta: você vê tudo, mas não altera.';
    else if(syncing) estado = 'Salvando no banco agora...';
    else if(lastSyncOk === false) estado = '<span class="neg">A última gravação falhou: ' + esc(lastSyncError) + '</span> Tentando de novo sozinho; nada foi perdido.';
    else if(lastSyncTime) estado = 'Tudo salvo no banco. Última gravação às ' + lastSyncTime.toLocaleTimeString('pt-BR') + '.';
    else estado = 'Tudo salvo no banco.';
    detail.innerHTML = quem + ' ' + estado + (canalNoAr ? ' Alterações de outras pessoas aparecem aqui na hora.'
      : ' <span class="neg">Sem aviso em tempo real agora</span> (reconectando): o que outras pessoas mudarem aparece quando voltar.');
  }
  renderConflitos();
  renderHistorico();
}

// ---------- histórico, lido do banco ----------
// O banco registra cada alteração sozinho (quem, quando, campo a campo). Aqui ele é lido em
// páginas de 200 e mostrado como a v1 mostrava: onde, o quê, antes e depois.
let historicoBanco = null;       // linhas já lidas (mais nova primeiro)
let historicoAcabou = false;
let historicoLendo = false;
const TIPO_DA_TABELA = {marketplaces: 'marketplace', produtos: 'produto', anuncios: 'anuncio', ml_vinculos: 'anuncio', empresas: 'padroes'};
function rotuloDaColuna(tabela, coluna){
  const m = V2.modelo;
  const lista = {marketplaces: m.CAMPOS_MARKETPLACE, produtos: m.CAMPOS_PRODUTO, anuncios: m.CAMPOS_ANUNCIO,
    ml_vinculos: m.CAMPOS_ML, empresas: m.CAMPOS_PADROES}[tabela] || [];
  const par = lista.find(c=> c[1] === coluna);
  if(tabela === 'anuncios' && coluna === 'produto_id') return rotuloCampo('anuncio', '_prod');
  if(tabela === 'anuncios' && coluna === 'marketplace_id') return rotuloCampo('anuncio', 'marketplaceId');
  if(tabela === 'marketplaces' && coluna === 'ordem') return 'Posição na lista';
  if(tabela === 'marketplaces' && coluna === 'removido') return 'Removido';
  if(tabela === 'membros') return ({papel: 'Papel', nome: 'Nome', senha: 'Senha', conta_nova: 'Conta nova'})[coluna] || coluna;
  return par ? rotuloCampo(TIPO_DA_TABELA[tabela], par[0]) : coluna;
}
function valorDaColuna(tabela, coluna, v){
  if(tabela === 'anuncios' && coluna === 'produto_id'){ const p = produtoPorId(v); return p ? p.sku : '(outro produto)'; }
  if(tabela === 'anuncios' && coluna === 'marketplace_id'){ const r = base && base.linhas.mk.get(v); return r ? r.nome : v; }
  if(tabela === 'anuncios' && coluna === 'modo') return v === 'margem' ? 'margem' : 'preço';
  if(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return dataHora(v);
  return textoValor(v);
}
function ondeDoHistorico(h){
  const dado = h.depois || h.antes || {};
  if(h.tabela === 'empresas') return 'Custos da empresa';
  if(h.tabela === 'membros') return 'Equipe: ' + (dado.nome || 'pessoa');
  if(h.tabela === 'marketplaces'){
    const p = state.profiles.find(x=> x.uid === h.registro_id);
    return 'Marketplace ' + (p ? p.label : (dado.nome || dado.codigo || ''));
  }
  if(h.tabela === 'produtos'){
    const p = produtoPorId(h.registro_id);
    return 'Produto ' + (p ? p.sku + ' · ' + p.name : (dado.sku || '') + (dado.nome ? ' · ' + dado.nome : ''));
  }
  const a = anuncioPorId(h.registro_id);
  if(a) return 'Anúncio ' + a.lst.sku + ' (' + profileOf(a.lst.marketplaceId).label + ')';
  return 'Anúncio ' + (dado.sku || dado.item_id || '');
}
// uma linha do banco vira uma linha por campo, como na aba Historico da v1
function linhasDoHistorico(h){
  const base_ = {quando: h.quando, quem: h.quem_nome || '(importação)', onde: ondeDoHistorico(h)};
  if(h.acao === 'criou') return [Object.assign({campo: h.tabela === 'membros' ? 'incluído(a) na equipe' : 'criado', antes: '', depois: ''}, base_)];
  if(h.acao === 'excluiu') return [Object.assign({campo: h.tabela === 'membros' ? 'tirado(a) da equipe' : 'excluído', antes: '', depois: ''}, base_)];
  const antes = h.antes || {}, depois = h.depois || {};
  return Object.keys(depois).map(k=> Object.assign({campo: rotuloDaColuna(h.tabela, k),
    antes: valorDaColuna(h.tabela, k, antes[k]), depois: valorDaColuna(h.tabela, k, depois[k])}, base_));
}
async function carregarHistorico(mais){
  if(historicoLendo || (mais && historicoAcabou)) return;
  historicoLendo = true;
  try{
    const ultimo = mais && historicoBanco && historicoBanco.length ? historicoBanco[historicoBanco.length - 1].id : null;
    const pagina = await V2.listarHistorico(empresa.id, {antesDoId: ultimo, limite: 200});
    historicoBanco = (mais ? historicoBanco : []).concat(pagina);
    historicoAcabou = pagina.length < 200;
  }catch(err){
    toast(err.message, 'err', 'Histórico');
  }
  historicoLendo = false;
  renderHistorico();
}
function renderHistorico(){
  const box = document.getElementById('historicoLista');
  const aviso = document.getElementById('historicoAviso');
  if(!box || !aviso) return;
  if(!historicoBanco){ aviso.textContent = 'Carregando...'; box.style.display = 'none'; carregarHistorico(false); return; }
  const filtro = (document.getElementById('historicoBusca').value || '').trim().toLowerCase();
  const todas = [];
  historicoBanco.forEach(h=> todas.push(...linhasDoHistorico(h)));
  const linhas = todas.filter(x=> !filtro || [x.quem, x.onde, x.campo, x.antes, x.depois].join(' ').toLowerCase().indexOf(filtro) !== -1);
  aviso.textContent = todas.length
    ? `${todas.length} alteração(ões) lidas, da mais nova para a mais antiga.` + (filtro ? ` ${linhas.length} com esse filtro.` : '')
    : 'Nenhuma alteração registrada ainda. A partir de agora, cada gravação entra aqui.';
  box.style.display = todas.length ? '' : 'none';
  if(!todas.length) return;
  box.innerHTML = (linhas.length ? `<table class="hist"><thead><tr><th>Quando</th><th>Quem</th><th>Onde</th><th>O quê</th><th>Antes</th><th>Depois</th></tr></thead><tbody>${
    linhas.slice(0, 1000).map(x=> `<tr><td class="nowrap">${esc(dataHora(x.quando))}</td><td>${esc(x.quem)}</td><td>${esc(x.onde)}</td><td>${esc(x.campo)}</td><td>${esc(x.antes)}</td><td>${esc(x.depois)}</td></tr>`).join('')
  }</tbody></table>` : '<p class="sub" style="padding:10px;">Nada encontrado com esse filtro nas alterações já lidas.</p>')
    + `<div class="form-actions" style="margin:10px;"><button class="btn small" id="historicoAtualizar">Atualizar</button>
        ${historicoAcabou ? '' : '<button class="btn small" id="historicoMais">Ler alterações mais antigas</button>'}</div>`;
  const mais = document.getElementById('historicoMais');
  if(mais) mais.onclick = ()=> carregarHistorico(true);
  const atu = document.getElementById('historicoAtualizar');
  if(atu) atu.onclick = ()=> carregarHistorico(false);
}

function renderUsuario(){
  const b = document.getElementById('usuarioBtn');
  if(!b) return;
  b.textContent = 'Você: ' + (usuario || '...') + ' (minha conta)';
}


// Formatadores criados uma vez só. toLocaleString monta um formatador novo a cada chamada, e numa
// tabela grande (milhares de valores) isso sozinho custava ~100 ms por desenho. Mesmo texto.
const FMT_BRL = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const FMT_PCT = new Intl.NumberFormat('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1});
const FMT_NUM2 = new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const FMT_ATE2 = new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2});
const brl = v => FMT_BRL.format(isFinite(v)?v:0);
const pct = v => FMT_PCT.format(isFinite(v)?v:0)+'%';
// Marketplace excluído deixa produtos órfãos. Antes o sistema caía no primeiro marketplace da
// lista e calculava com as taxas ERRADAS sem avisar; agora devolve um perfil neutro marcado
// como ausente, para a interface poder mostrar que aquele produto precisa ser reatribuído.
const MISSING_PROFILE = {id:'__missing__', label:'Marketplace removido', color:'#e2716b', confidence:'baixa', note:'',
  commission:0, service:0, transaction:0, fixedFee:0, dualAdPrice:false, variableFreight:false, variableFixedFee:false, missing:true};
const profileOf = id => state.profiles.find(p=>p.id===id) || MISSING_PROFILE;
const uid = () => 'id'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
function baseDoSku(sku){ return skuBase(sku, state.profiles); }
const mktSlug = id => String(id||'');

// Coloca "-ID do marketplace" no fim do SKU. Não duplica (SKU que já termina com o ID dele fica
// como está) e troca o "-ID" de outro marketplace pelo deste.
function applyMktSuffix(skuRaw, marketplaceId){
  const s = String(skuRaw||'').trim();
  const id = String(marketplaceId||'');
  if(s.toLowerCase().endsWith('-' + id.toLowerCase())) return s;
  return skuBase(s, state.profiles) + '-' + id;
}

// ---------- ID do marketplace ----------
function idUnico(base, exceto){
  if(!base) return '';
  let id = base, n = 2;
  while(state.profiles.some(x=> x !== exceto && String(x.id).toLowerCase() === id.toLowerCase())) id = base + (n++);
  return id;
}
// Troca o ID e leva junto tudo o que aponta para ele: os anúncios passam para o ID novo, e (se
// pedido) os SKUs que terminam em "-antigo" passam a terminar em "-novo".
function aplicarNovoIdMarketplace(pr, novo, trocarFinalDoSku){
  const antigo = pr.id, fim = '-' + antigo.toLowerCase();
  const res = {anuncios: 0, skusAnuncio: 0, skusProduto: 0};
  state.products.forEach(prod=>{
    prod.listings.forEach(l=>{
      if(l.marketplaceId !== antigo) return;
      l.marketplaceId = novo; res.anuncios++;
      if(trocarFinalDoSku && l.sku.toLowerCase().endsWith(fim)){ l.sku = l.sku.slice(0, -antigo.length) + novo; res.skusAnuncio++; }
    });
    if(trocarFinalDoSku && prod.sku.toLowerCase().endsWith(fim)){ prod.sku = prod.sku.slice(0, -antigo.length) + novo; res.skusProduto++; }
  });
  pr.id = novo;
  if(filtros.mkt === antigo) filtros.mkt = novo;
  return res;
}
function trocarIdMarketplace(idAtual, digitado, inp){
  const pr = state.profiles.find(x=> x.id === idAtual);
  if(!pr) return;
  const volta = ()=>{ inp.value = pr.id; };
  const novo = normalizaIdDigitado(digitado);
  if(!novo){ toast('O ID não pode ficar vazio.', 'err'); volta(); return; }
  if(novo === pr.id){ volta(); return; }
  if(state.profiles.some(x=> x !== pr && String(x.id).toLowerCase() === novo.toLowerCase())){
    toast(`Já existe um marketplace com o ID "${novo}". Cada marketplace precisa de um ID próprio.`, 'err'); volta(); return;
  }
  const antigo = pr.id;
  const vinculados = listagens().filter(s=> s.marketplaceId === antigo);
  if(vinculados.length && !confirm(`Trocar o ID do marketplace "${pr.label}" de "${antigo}" para "${novo}"?\n\nOs ${vinculados.length} anúncio(s) dele passam para o ID novo junto -- nenhum vínculo se perde.`)){ volta(); return; }
  const fim = '-' + antigo.toLowerCase();
  const comFinal = vinculados.filter(s=> s.sku.toLowerCase().endsWith(fim)).length
    + state.products.filter(prod=> prod.sku.toLowerCase().endsWith(fim)).length;
  let trocarFinal = false;
  if(comFinal){
    const ex = (vinculados.find(s=> s.sku.toLowerCase().endsWith(fim)) || state.products.find(prod=> prod.sku.toLowerCase().endsWith(fim))).sku;
    trocarFinal = confirm(`${comFinal} SKU(s) terminam em "-${antigo}" (ex.: ${ex}).\n\nTrocar o final para "-${novo}" também? (${ex} vira ${ex.slice(0, -antigo.length) + novo})\n\nOK = trocar o final dos SKUs\nCancelar = manter os SKUs como estão`);
  }
  const res = aplicarNovoIdMarketplace(pr, novo, trocarFinal);
  pr.idManual = true;
  if(novo !== String(digitado||'').trim()) toast(`ID ajustado para "${novo}" (minúsculo, sem espaços nem acentos).`, 'warn');
  saveState();
  renderMarketplaces();
  renderProdutos();
  toast(`ID trocado para "${novo}". ${res.anuncios} anúncio(s) acompanharam`
    + (res.skusAnuncio + res.skusProduto ? `, ${res.skusAnuncio + res.skusProduto} SKU(s) com o final trocado.` : '.'), 'ok', 'ID do marketplace');
}

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
  return {fixedCost: state.padroes.fixedCost, misc: state.padroes.misc, taxPct: state.padroes.taxPct, marketingPct: state.padroes.marketingPct};
}

// Marketplaces marcados como "taxa fixa variável por anúncio" cobram um valor fixo diferente
// para cada anúncio (faixa de preço, categoria, tipo de anúncio). Nesses, o valor vale por
// produto (sku.mktFixedFee); nos demais, vale o valor único do marketplace (profile.fixedFee).
// Em marketplaces com faixas de preço quem manda é a faixa, não este campo.
function effectiveFixedFee(profile, sku){
  return profile.variableFixedFee ? (Number(sku.mktFixedFee)||0) : (Number(profile.fixedFee)||0);
}

function tierRangeLabel(min, max){
  if(min<=0 && !isFinite(max)) return '';
  if(min<=0) return 'abaixo de ' + brl(max);
  if(!isFinite(max)) return 'a partir de ' + brl(min);
  return 'de ' + brl(min) + ' a ' + brl(max);
}

// Um "trecho" é um intervalo de preço em que o percentual e o valor fixo do marketplace são
// constantes. Marketplace sem faixas = um trecho só, de zero ao infinito, e a conta fica
// idêntica à de sempre. Marketplace com faixas (TikTok Shop, por exemplo) vira vários.
//
// O teto em R$ de uma taxa percentual (ex.: Programa de Envio 6% limitado a R$50 por item)
// também gera um trecho: a partir do preço em que o percentual bate no teto, aquela taxa
// para de crescer e passa a se comportar como um valor fixo.
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

function renderTopDisclaimer(){
  document.getElementById('topDisclaimer').innerHTML =
    '<svg class="bi"><use href="#i-warn"/></svg><div>Os percentuais pré-preenchidos por marketplace são valores de referência -- só os da Shopee foram conferidos contra um pedido real; os demais vêm de fontes de terceiros, não das páginas oficiais, e taxas mudam por categoria, tipo de anúncio e reputação do vendedor. Confira em <strong>Marketplaces</strong> com os valores exatos do seu Seller Center.</div>';
}

function wizardVisivel(){
  return ['skuForm','importWizard','exportWizard','unifyWizard','loteWizard'].some(id=>{
    const el = document.getElementById(id);
    return el && el.style.display === 'block';
  });
}

// ---------- painel lateral ----------
// Formulário de produto e assistentes de planilha deixam de empurrar a página: entram num
// painel que desliza por cima. Assim a tabela continua no lugar enquanto se edita.
function abrirPainel(titulo, subtitulo){
  document.getElementById('panelTitle').textContent = titulo;
  document.getElementById('panelSub').textContent = subtitulo || '';
  document.getElementById('panel').classList.add('open');
  document.getElementById('panel').setAttribute('aria-hidden','false');
  document.getElementById('scrim').classList.add('open');
  document.querySelector('.panel-body').scrollTop = 0;
}
function painelAberto(){ return document.getElementById('panel').classList.contains('open'); }
function fecharPainel(){
  document.getElementById('panel').classList.remove('open');
  document.getElementById('panel').setAttribute('aria-hidden','true');
  document.getElementById('scrim').classList.remove('open');
}
// Fechar o painel encerra o que estivesse aberto dentro dele, seja formulário ou assistente.
// Devolve false quando o editor em lote tinha algo não salvo e a pessoa preferiu ficar nele.
function fecharTudoDoPainel(){
  if(!closeLoteWizard()) return false;
  closeSkuForm(); closeImportWizard(); closeExportWizard(); closeUnifyWizard();
  return true;
}
document.getElementById('panelClose').onclick = fecharTudoDoPainel;
document.getElementById('scrim').onclick = fecharTudoDoPainel;
document.addEventListener('keydown', (e)=>{
  if(e.key === 'Escape' && painelAberto()) fecharTudoDoPainel();
});

// ---------- navegação e barra de título ----------
const VIEWS = {
  produtos:   {titulo:'Produtos', sub:'Margem sempre sobre o valor que sobra na sua mão, não sobre o preço de venda.'},
  marketplaces:{titulo:'Marketplaces', sub:'Taxas de cada canal. O que estiver aqui vale para todos os produtos do canal.'},
  padroes:    {titulo:'Custos da empresa', sub:'Valores que atravessam o catálogo inteiro.'},
  ml:         {titulo:'Mercado Livre', sub:'Vincula os anúncios pelo SKU e puxa a comissão e o custo fixo direto do Mercado Livre.'},
  historico:  {titulo:'Histórico', sub:'Quem mudou o quê e quando, e as alterações feitas ao mesmo tempo por duas pessoas.'},
  equipe:     {titulo:'Equipe', sub:'Quem acessa esta empresa e o que cada um pode fazer.'},
  conta:      {titulo:'Minha conta', sub:'Seu nome no histórico e a sua senha.'}
};
let viewAtual = 'produtos';

function topbarHtml(view){
  const v = VIEWS[view];
  const titulo = `<div><h1>${v.titulo}</h1><p class="sub" style="margin:1px 0 0;">${v.sub}</p></div>`;
  if(view === 'produtos'){
    return titulo + `<div class="grow"></div>
      <span class="searchbox"><svg class="ic"><use href="#i-search"/></svg><input type="text" id="search" placeholder="Buscar SKU ou nome"></span>
      <select id="filterMkt"></select>
      <select id="sortBy">
        <option value="margin_asc">Margem: menor primeiro</option>
        <option value="margin_desc">Margem: maior primeiro</option>
        <option value="name">Nome (A-Z)</option>
        <option value="profit_desc">Lucro: maior primeiro</option>
      </select>
      <select id="sheetActions">
        <option value="">Planilhas e catálogo...</option>
        <option value="template">Baixar modelo</option>
        <option value="import">Importar planilha</option>
        <option value="export">Exportar calculada</option>
        <option value="exportEdit">Exportar p/ edição em massa</option>
        <option value="unificar">Unificar produtos repetidos</option>
      </select>
      <button class="btn" id="loteBtn" title="Vários produtos de uma vez: cole os SKUs, marque os marketplaces e preencha em grade">Cadastro em lote</button>
      <button class="btn primary" id="newSkuBtn"><svg class="ic"><use href="#i-plus"/></svg>Novo produto</button>`;
  }
  if(view === 'marketplaces'){
    return titulo + `<div class="grow"></div>
      <div class="menu-wrap">
        <button class="btn primary" id="newMktBtn"><svg class="ic"><use href="#i-plus"/></svg>Adicionar marketplace</button>
        <div class="menu" id="newMktMenu" hidden></div>
      </div>`;
  }
  return titulo;
}

// A barra de título é redesenhada a cada troca de seção, então os controles dela são ligados
// aqui -- e não uma vez só no carregamento, como era quando tudo vivia na página.
function ligarControlesDaTopbar(view){
  if(view === 'produtos'){
    // a barra de título acabou de ser remontada: devolve a ela o que já estava filtrado
    document.getElementById('search').value = filtros.q;
    document.getElementById('sortBy').value = filtros.ordem;
    renderFilterOptions();
    const busca = document.getElementById('search');
    busca.addEventListener('input', debounce(()=>{ filtros.q = busca.value || ''; renderTable(); }, 120));
    document.getElementById('filterMkt').addEventListener('change', (e)=>{ filtros.mkt = e.target.value; renderTable(); });
    document.getElementById('sortBy').addEventListener('change', (e)=>{ filtros.ordem = e.target.value; renderTable(); });
        document.getElementById('sheetActions').addEventListener('change', (e)=>{
      const acao = e.target.value;
      e.target.value = '';   // o select é um menu de ações, não um estado
      if(acao === 'template') baixarModeloPlanilha();
      else if(acao === 'import') abrirImportacao();
      else if(acao === 'export') abrirExportCalculada();
      else if(acao === 'exportEdit') abrirExportEdicao();
      else if(acao === 'unificar') unificarProdutosRepetidos();
    });
    document.getElementById('newSkuBtn').onclick = ()=>{ if(fecharTudoDoPainel()) openSkuForm(null); };
    document.getElementById('loteBtn').onclick = ()=> abrirLote([]);
  }
  if(view === 'marketplaces'){
    const menu = document.getElementById('newMktMenu');
    menu.innerHTML = PRESETS.map(p=>
      `<button class="menu-item" data-preset="${esc(p.key)}"><strong>${esc(p.label)}</strong><span>${esc(p.hint)}</span></button>`).join('');
    document.getElementById('newMktBtn').onclick = (e)=>{ e.stopPropagation(); menu.hidden = !menu.hidden; };
    menu.addEventListener('click', (e)=>{
      const b = e.target.closest('[data-preset]');
      if(!b) return;
      menu.hidden = true;
      adicionarMarketplace(b.dataset.preset);
    });
  }
}

function irPara(view){
  viewAtual = view;
  document.querySelectorAll('.navitem').forEach(x=> x.classList.toggle('active', x.dataset.view===view));
  document.querySelectorAll('.view').forEach(x=> x.classList.remove('active'));
  document.getElementById('view-'+view).classList.add('active');
  document.getElementById('topbar').innerHTML = topbarHtml(view);
  ligarControlesDaTopbar(view);
  if(view==='marketplaces') renderMarketplaces();
  if(view==='padroes') renderPadroes();
  if(view==='produtos') renderProdutos();
  if(view==='ml'){ renderML(); mlAtualizarStatus(); }
  if(view==='historico') renderHistoricoView();
  if(view==='equipe') renderEquipe();
  if(view==='conta') renderConta();
  atualizarContadoresDoMenu();
}
document.querySelectorAll('.navitem').forEach(b=> b.onclick = ()=> irPara(b.dataset.view));
document.addEventListener('click', (e)=>{
  const menu = document.getElementById('newMktMenu');
  if(menu && !menu.hidden && !e.target.closest('.menu-wrap')) menu.hidden = true;
});

function atualizarContadoresDoMenu(){
  document.getElementById('navCountSkus').textContent = state.products.length;
  document.getElementById('navCountMkt').textContent = state.profiles.length;
}

// ---------- PRODUTOS VIEW ----------
// Um ciclo de desenho chama calcSku para a lista inteira duas vezes: uma nas métricas, outra
// na tabela. Com faixas de preço o cálculo ficou mais caro (resolve em cada faixa), então o
// resultado é reaproveitado dentro do mesmo ciclo. O cache vive só durante renderProdutos().
// O resultado de cada anúncio fica guardado até algum dado mudar. Toda alteração passa por
// saveState() (ou pela leitura da planilha), que avança versaoDados e descarta o cache -- então
// clicar numa linha ou trocar de marketplace no recibo não recalcula nada.
let cacheCalc = {versao: -1, mapa: new Map()};
function calcDoSku(sku){
  if(cacheCalc.versao !== versaoDados) cacheCalc = {versao: versaoDados, mapa: new Map()};
  let r = cacheCalc.mapa.get(sku.id);
  if(r === undefined){ r = calcSku(profileOf(sku.marketplaceId), sku); cacheCalc.mapa.set(sku.id, r); }
  return r;
}

// Busca, filtro e ordenação vivem aqui, não nos campos da tela. A barra de título é
// remontada a cada troca de seção, então ler direto do DOM quebrava o desenho do catálogo
// sempre que ele era disparado de fora da tela de Produtos -- e isso matava, em silêncio,
// os botões das telas de Marketplaces, Custos e Sincronização.
const filtros = {q:'', mkt:'', ordem:'margin_asc'};

// Uma linha por produto, com os anúncios dele dentro. Com um marketplace no filtro, cada produto
// mostra só o preço daquele canal -- e some da lista quem não é vendido nele.
function produtosFiltrados(){
  const q = filtros.q.toLowerCase();
  const mktFilter = filtros.mkt;
  const sortBy = filtros.ordem;
  const ordemMkt = id => { const i = state.profiles.findIndex(p=> p.id === id); return i === -1 ? 999 : i; };
  let linhas = state.products.map(prod=>{
    let ans = prod.listings
      .slice().sort((a,b)=> ordemMkt(a.marketplaceId) - ordemMkt(b.marketplaceId))
      .map(lst=>{ const v = visaoDoAnuncio(prod, lst); return {lst, v, r: calcDoSku(v)}; });
    if(mktFilter === '__missing__') ans = ans.filter(a=> profileOf(a.lst.marketplaceId).missing);
    else if(mktFilter) ans = ans.filter(a=> a.lst.marketplaceId === mktFilter);
    return {prod, ans};
  });
  if(mktFilter) linhas = linhas.filter(x=> x.ans.length);
  if(q) linhas = linhas.filter(x=> x.prod.sku.toLowerCase().includes(q) || x.prod.name.toLowerCase().includes(q)
    || x.prod.listings.some(l=> l.sku.toLowerCase().includes(q)));
  // ordenar produto por margem usa o pior anúncio (menor primeiro) ou o melhor (maior primeiro)
  const margens = x => x.ans.length ? x.ans.map(a=> a.r.error ? -Infinity : a.r.marginPct) : [-Infinity];
  const lucros  = x => x.ans.length ? x.ans.map(a=> a.r.error ? -Infinity : a.r.profit) : [-Infinity];
  linhas.sort((a,b)=>{
    if(sortBy==='margin_asc') return Math.min(...margens(a)) - Math.min(...margens(b));
    if(sortBy==='margin_desc') return Math.max(...margens(b)) - Math.max(...margens(a));
    if(sortBy==='profit_desc') return Math.max(...lucros(b)) - Math.max(...lucros(a));
    return a.prod.name.localeCompare(b.prod.name);
  });
  return linhas;
}

function renderMetrics(){
  const todos = listagens();
  const rows = todos.map(calcDoSku);
  const valid = rows.filter(r=>!r.error);
  const avgMargin = valid.length ? valid.reduce((a,r)=>a+r.marginPct,0)/valid.length : 0;
  const losing = rows.filter(r=>r.error || r.marginPct<0).length;
  const totalProfit = valid.reduce((a,r)=>a+r.profit,0);
  const orphans = todos.filter(s=>profileOf(s.marketplaceId).missing).length;
  const overrides = state.products.filter(s=>s.costOverride).length;
  const canais = new Set(todos.map(s=> s.marketplaceId)).size;
  document.getElementById('metrics').innerHTML = `
    <div class="metric"><div class="k">Produtos</div><div class="v">${state.products.length}</div>
      <div class="f">${rows.length} anúncio(s) em ${canais} marketplace(s)${overrides ? ' &middot; '+overrides+' com custo alterado' : ''}</div></div>
    <div class="metric ${avgMargin>=0?'ok':'bad'}"><div class="k">Margem média</div><div class="v">${pct(avgMargin)}</div>
      <div class="f">sobre o valor recebido, média dos anúncios</div></div>
    <div class="metric ${totalProfit>=0?'ok':'bad'}"><div class="k">Lucro somado por unidade</div><div class="v">${brl(totalProfit)}</div>
      <div class="f">uma venda de cada anúncio</div></div>
    <div class="metric ${losing?'bad':'ok'}"><div class="k">Anúncios no prejuízo</div><div class="v">${losing}</div>
      <div class="f">${orphans ? orphans+' sem marketplace válido' : (losing?'revise preço ou custo':'nenhum no vermelho')}</div></div>
  `;
}

function renderFilterOptions(){
  const sel = document.getElementById('filterMkt');
  const orfaos = listagens().some(s=>profileOf(s.marketplaceId).missing);
  const validos = [''].concat(state.profiles.map(p=>p.id), orfaos ? ['__missing__'] : []);
  // se o marketplace filtrado foi excluído, volta para todos em vez de deixar a tabela
  // vazia sem explicação
  if(validos.indexOf(filtros.mkt) === -1) filtros.mkt = '';
  if(!sel) return;   // a barra de título da seção de Produtos não está montada agora
  const current = filtros.mkt;
  sel.innerHTML = '<option value="">Todos os marketplaces</option>' +
    state.profiles.map(p=>`<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('') +
    (orfaos ? '<option value="__missing__">Sem marketplace válido</option>' : '');
  // se o marketplace filtrado foi excluído, o select ficaria em branco e a tabela vazia sem explicação
  sel.value = current;
}

function renderTable(){
  const linhas = produtosFiltrados();
  const wrap = document.getElementById('tableWrap');
  if(state.products.length===0){
    wrap.innerHTML = `<div class="empty"><div class="big">Nenhum produto cadastrado</div>
      Comece por "Novo produto" para um item, ou por "Planilhas &rarr; Importar planilha" para trazer o catálogo inteiro de uma vez.</div>`;
    return;
  }
  if(linhas.length===0){
    wrap.innerHTML = `<div class="empty"><div class="big">Nenhum produto com esse filtro</div>
      Ajuste a busca ou o marketplace selecionado na barra acima.</div>`;
    return;
  }
  // Só o primeiro lote entra agora; os seguintes chegam conforme a rolagem. Diagramar uma tabela
  // de 1.600 linhas custava ~100 ms ao navegador a cada desenho, e isso cresce com o catálogo.
  tabelaLinhas = linhas;
  tabelaMostrando = Math.min(LOTE_TABELA, linhas.length);
  const corpo = linhas.slice(0, tabelaMostrando).map(htmlDoProdutoNaTabela).join('');

  wrap.innerHTML = `<table class="tabela-produtos">
    <colgroup><col class="c-prod"><col class="c-custo"><col class="c-canal"><col class="c-num"><col class="c-num"><col class="c-marg"><col class="c-anun"><col class="c-acao"></colgroup>
    <thead><tr>
      <th><input type="checkbox" id="selTodos" class="sel-prod-todos" title="Selecionar todos os produtos da lista (com o filtro atual)"> Produto</th><th class="num">Custo</th><th>Marketplace</th>
      <th class="num">Preço</th><th class="num">Lucro</th><th class="num">Margem</th>
      <th class="num">Anúncio</th><th></th>
    </tr></thead>
    <tbody>${corpo}</tbody>
  </table>${rodapeDaTabela()}`;

  pidEmDestaque = null;   // a tabela é nova: nenhum produto aceso
  observarFimDaTabela();
  const todos = document.getElementById('selTodos');
  if(todos) todos.checked = linhas.length > 0 && linhas.every(x=> selecaoLote.has(x.prod.id));
  renderBarraLote();
}

// Tabela agrupada: as colunas do produto (SKU, nome, custo, ações) ocupam as linhas de todos os
// anúncios dele com rowspan; cada anúncio é uma linha própria, clicável, com o preço do canal.
function htmlDoProdutoNaTabela({prod, ans}){
    const tags = prod.costOverride ? ' <span class="tag">custo alterado</span>' : '';
    const n = Math.max(ans.length, 1);
    const colProduto = `<td class="cell-prod grp" rowspan="${n}" data-pid="${esc(prod.id)}" title="${esc(prod.sku)} -- ${esc(prod.name)}">
        <input type="checkbox" class="sel-prod" data-sel="${esc(prod.id)}" title="Selecionar para editar em lote" ${selecaoLote.has(prod.id) ? 'checked' : ''}><span class="sku">${esc(prod.sku)}</span>${tags}
        <span class="nm">${esc(prod.name)}</span></td>
      <td class="num grp" rowspan="${n}" data-pid="${esc(prod.id)}">${brl(prod.cogs)}</td>`;
    const colAcoes = `<td class="row-actions grp" rowspan="${n}"><button class="iconbtn" data-edit="${esc(prod.id)}" title="Editar produto e preços"><svg class="ic"><use href="#i-pencil"/></svg></button><button class="iconbtn danger" data-del="${esc(prod.id)}" title="Excluir produto"><svg class="ic"><use href="#i-trash"/></svg></button></td>`;
    if(ans.length === 0){
      return `<tr class="grupo-ini" data-pid="${esc(prod.id)}">${colProduto}<td colspan="5" class="muted">Sem anúncio em nenhum marketplace</td>${colAcoes}</tr>`;
    }
    return ans.map(({lst, v, r}, i)=>{
      const p = profileOf(lst.marketplaceId);
      const sel = lst.id === state.selectedSkuId ? ' selected' : '';
      const cls = (i === 0 ? 'grupo-ini' : 'grupo-seq') + sel;
      const canal = `<td class="canal-cell"><span class="mkt-dot" style="background:${esc(p.color)}"></span>${esc(p.label)}${p.missing ? ' <span class="tag tag-danger">removido</span>' : ''}</td>`;
      const numeros = r.error
        ? `<td class="num" colspan="4" style="color:var(--bad)">Margem inviável com essas taxas</td>`
        : (()=>{ const ad = adPrices(r.price, p); return `
          <td class="num">${brl(r.price)}</td>
          <td class="num ${r.profit>=0?'pos':'neg'}">${brl(r.profit)}</td>
          <td class="num ${r.marginPct>=0?'pos':'neg'}">${pct(r.marginPct)}</td>
          <td class="num">${brl(ad.p20)}${ad.p40!==null ? `<span class="sub-val">antes ${brl(ad.p40)}</span>` : ''}</td>`; })();
      return `<tr class="${cls}" data-lid="${esc(lst.id)}" data-pid="${esc(prod.id)}">${i === 0 ? colProduto : ''}${canal}${numeros}${i === 0 ? colAcoes : ''}</tr>`;
    }).join('');
}

const LOTE_TABELA = 60;
let tabelaLinhas = [];
let tabelaMostrando = 0;
let observadorTabela = null;
function rodapeDaTabela(){
  if(tabelaMostrando >= tabelaLinhas.length) return '';
  return `<div class="tabela-mais" id="tabelaMais">Mostrando ${tabelaMostrando} de ${tabelaLinhas.length} produtos
    <button class="btn small" id="btnMaisProdutos">Mostrar mais</button></div>`;
}
function mostrarMaisProdutos(){
  const tbody = document.querySelector('#tableWrap tbody');
  if(!tbody || tabelaMostrando >= tabelaLinhas.length) return;
  const proximos = tabelaLinhas.slice(tabelaMostrando, tabelaMostrando + LOTE_TABELA);
  tbody.insertAdjacentHTML('beforeend', proximos.map(htmlDoProdutoNaTabela).join(''));
  tabelaMostrando += proximos.length;
  const rodape = document.getElementById('tabelaMais');
  if(rodape) rodape.outerHTML = rodapeDaTabela();
  observarFimDaTabela();
}
// carrega o próximo lote um pouco antes de a rolagem chegar ao fim
function observarFimDaTabela(){
  if(observadorTabela) observadorTabela.disconnect();
  const alvo = document.getElementById('tabelaMais');
  if(!alvo || !('IntersectionObserver' in window)) return;
  observadorTabela = new IntersectionObserver(ents=>{
    if(ents.some(e=> e.isIntersecting)) mostrarMaisProdutos();
  }, {rootMargin: '700px 0px'});
  observadorTabela.observe(alvo);
}

// Trocar a seleção só move o destaque de uma linha para outra e redesenha o recibo. Antes, cada
// clique reconstruía a tabela inteira -- numa loja com centenas de produtos, ~270 ms por clique.
const salvarSelecaoDepois = debounce(()=>{ if(empresa) store.set(STORAGE_KEY + ':sel:' + empresa.id, state.selectedSkuId || ''); }, 400);
function selecionarAnuncio(lid){
  if(!lid) return;
  state.selectedSkuId = lid;
  const wrap = document.getElementById('tableWrap');
  wrap.querySelectorAll('tr.selected').forEach(tr=> tr.classList.remove('selected'));
  const alvo = wrap.querySelector(`tr[data-lid="${CSS.escape(lid)}"]`);
  if(alvo) alvo.classList.add('selected');
  renderReceiptPanel();
  // só lembra a seleção neste navegador, sem enviar à planilha: mandar tudo por causa de um
  // clique fazia uma aba desatualizada sobrescrever o que outro dispositivo tinha salvo
  salvarSelecaoDepois();
}

// Três ouvintes para a tabela inteira, ligados uma vez, em vez de três por linha a cada desenho
// (eram milhares num catálogo grande, e todos eram refeitos a cada clique).
let pidEmDestaque = null;
(function ligarTabelaDeProdutos(){
  const wrap = document.getElementById('tableWrap');
  wrap.addEventListener('click', (e)=>{
    if(e.target.closest('#btnMaisProdutos')){ mostrarMaisProdutos(); return; }
    // seleção para o editor em lote: não mexe no anúncio selecionado do recibo
    if(e.target.classList.contains('sel-prod')){
      const pid = e.target.dataset.sel;
      if(e.target.checked) selecaoLote.add(pid); else selecaoLote.delete(pid);
      renderBarraLote();
      return;
    }
    if(e.target.id === 'selTodos'){
      tabelaLinhas.forEach(x=>{ if(e.target.checked) selecaoLote.add(x.prod.id); else selecaoLote.delete(x.prod.id); });
      wrap.querySelectorAll('.sel-prod').forEach(c=> c.checked = e.target.checked);
      renderBarraLote();
      return;
    }
    const editar = e.target.closest('[data-edit]');
    if(editar){ openSkuForm(editar.dataset.edit); return; }
    const excluir = e.target.closest('[data-del]');
    if(excluir){ deleteSku(excluir.dataset.del); return; }
    if(e.target.closest('button')) return;
    const tr = e.target.closest('tbody tr');
    if(!tr) return;
    // clique nas colunas do produto seleciona o primeiro anúncio visível dele
    if(e.target.closest('td.grp')){
      const primeiro = wrap.querySelector(`tr[data-pid="${CSS.escape(tr.dataset.pid)}"][data-lid]`);
      if(primeiro) selecionarAnuncio(primeiro.dataset.lid);
      return;
    }
    if(tr.dataset.lid) selecionarAnuncio(tr.dataset.lid);
  });
  // passar o mouse em qualquer anúncio acende o produto inteiro; só mexe quando muda de produto
  const apagar = ()=> wrap.querySelectorAll('tr.hover-grp').forEach(x=> x.classList.remove('hover-grp'));
  wrap.addEventListener('mouseover', (e)=>{
    const tr = e.target.closest('tbody tr');
    const pid = tr ? tr.dataset.pid : null;
    if(pid === pidEmDestaque) return;
    apagar();
    pidEmDestaque = pid;
    if(pid) wrap.querySelectorAll(`tr[data-pid="${CSS.escape(pid)}"]`).forEach(x=> x.classList.add('hover-grp'));
  });
  wrap.addEventListener('mouseleave', ()=>{ pidEmDestaque = null; apagar(); });
})();

function renderReceiptPanel(){
  const outer = document.getElementById('receiptOuter');
  const achado = anuncioPorId(state.selectedSkuId);
  if(!achado){
    outer.innerHTML = `<div class="receipt-empty">Clique em um anúncio da tabela para ver o recibo completo &mdash; taxa por taxa, custo por custo, até o lucro final.</div>`;
    return;
  }
  const {prod, lst} = achado;
  const sku = visaoDoAnuncio(prod, lst);
  const profile = profileOf(sku.marketplaceId);
  const r = calcDoSku(sku);
  const line = (lbl, val, cls='') => `<div class="rline ${cls}"><span class="lbl">${lbl}</span><span class="val">${val<0?'-':''}${brl(Math.abs(val))}</span></div>`;
  // atalho para os outros marketplaces do mesmo produto, sem voltar à tabela
  const outros = prod.listings.length > 1 ? `<div class="rc-canais">${prod.listings.map(l=>{
      const pp = profileOf(l.marketplaceId);
      return `<button class="rc-canal${l.id===lst.id?' on':''}" data-lid="${esc(l.id)}"><span class="mkt-dot" style="background:${esc(pp.color)}"></span>${esc(pp.label)}</button>`;
    }).join('')}</div>` : '';
  const daML = lst.mlUsar && Array.isArray(lst.mlFaixas) && lst.mlFaixas.length
    ? `<br><span class="tag" title="Comissão e custo fixo vindos do próprio anúncio no Mercado Livre">taxas do anúncio no ML${lst.mlAtualizadoEm ? ' &middot; ' + esc(dataHora(lst.mlAtualizadoEm)) : ''}</span>` : '';
  const cab = `<h2>Recibo de precificação</h2><p class="mkt-name">${esc(prod.sku)} &middot; ${esc(prod.name)}<br>${esc(profile.label)} &middot; SKU no canal ${esc(lst.sku)}${daML}</p>${outros}`;
  const avisos = (profile.missing ? `<p class="warnline">O marketplace deste anúncio foi excluído. Os valores abaixo estão calculados sem nenhuma taxa &mdash; edite o produto e escolha um marketplace válido.</p>` : '')
               + (sku.costOverride ? `<p class="warnline">Custos da empresa alterados manualmente para este produto: mudar os padrões do sistema não afeta este item.</p>` : '');
  const ligarCanais = ()=> outer.querySelectorAll('.rc-canal').forEach(b=> b.onclick = ()=> selecionarAnuncio(b.dataset.lid));

  if(r.error){
    outer.innerHTML = `<div class="torn"></div><div class="receipt">${cab}${avisos}
      <div class="error-box">Não é possível atingir uma margem de ${pct(r.m*100)} sobre o valor recebido com essas taxas -- ou a conta fica negativa, ou não sobra nada de verdade na sua mão depois do marketplace. Taxas do marketplace: ${pct(r.mktPct*100)}. Imposto + marketing: ${pct((r.tax+r.mk)*100)}. Reduza a margem desejada ou revise as taxas.</div>
    </div><div class="torn bottom"></div>`;
    ligarCanais();
    return;
  }

  const heroLabel = sku.mode==='margin' ? 'Preço de venda necessário' : 'Preço de venda cadastrado';
  const ad = adPrices(r.price, profile);
  const fixedFeeLabel = profile.tiered ? 'Taxa fixa da faixa'
    : (profile.variableFixedFee ? 'Taxa fixa deste anúncio' : 'Taxa fixa por item');
  outer.innerHTML = `<div class="torn"></div><div class="receipt">
    ${cab}${avisos}
    <div class="price-hero"><div class="k">${heroLabel}</div><div class="v">${brl(r.price)}</div></div>
    ${line('Preço do produto', r.price)}
    ${r.freightNet !== 0 ? line('Frete: ganho/subsídio líquido', r.freightNet, r.freightNet<0?'neg':'pos') : ''}
    ${r.coupon !== 0 ? line('Cupom pago pelo vendedor', -r.coupon, 'neg') : ''}
    <div class="rline section"><span class="lbl">Taxas do marketplace${r.tierLabel ? ' &middot; faixa ' + esc(r.tierLabel) : ''}</span><span class="val">-${brl(r.commissionVal+r.serviceVal+r.transactionVal+r.fixedFee+r.freteML)}</span></div>
    ${line('Comissão ('+pct(r.rates.commission)+')', -r.commissionVal, 'neg')}
    ${r.rates.service ? line('Taxa de serviço / envio ('+pct(r.rates.service)+(r.capBinds?', no teto':'')+')', -r.serviceVal, 'neg') : ''}
    ${r.rates.transaction ? line('Taxa de transação ('+pct(r.rates.transaction)+')', -r.transactionVal, 'neg') : ''}
    ${line(fixedFeeLabel, -r.fixedFee, r.fixedFee>0?'neg':'')}
    ${r.freteML ? line('Envio, informado pelo Mercado Livre' + (lst.mlFreteGratis ? ' (frete grátis)' : ''), -r.freteML, 'neg') : ''}
    <div class="divider"></div>
    ${line('Valor que sobra na sua mão', r.netMarketplace, 'pos')}
    <div class="rline section"><span class="lbl">Custos da empresa</span><span class="val"></span></div>
    ${line('Custo do produto (CMV)', -r.cogs, r.cogs>0?'neg':'')}
    ${line('Custo fixo alocado', -r.fixedCost, r.fixedCost>0?'neg':'')}
    ${line('Outros custos diversos', -r.misc, r.misc>0?'neg':'')}
    ${line('Imposto sobre a venda', -r.taxVal, r.taxVal>0?'neg':'')}
    ${line('Marketing / Ads', -r.marketingVal, r.marketingVal>0?'neg':'')}
    <div class="totals">
      <div class="rline profit"><span class="lbl">Lucro líquido</span><span class="val" style="color:${r.profit>=0?'#3f7a4a':'#9c4a3f'}">${r.profit<0?'-':''}${brl(Math.abs(r.profit))}</span></div>
      <div class="rline"><span class="lbl">Margem sobre o valor que sobrou na mão</span><span class="val">${pct(r.marginOnNet)}</span></div>
      <div class="rline muted"><span class="lbl">Margem sobre o preço de venda (referência)</span><span class="val">${pct(r.marginOnPrice)}</span></div>
      <span class="badge-margin ${r.marginPct>=0?'badge-good':'badge-bad'}">${r.marginPct>=0?'Operação lucrativa':'Operação no prejuízo'}</span>
    </div>
    <div class="totals">
      <div class="rline"><span class="lbl">Valor sugerido de anúncio (+20%)</span><span class="val">${brl(ad.p20)}</span></div>
      ${profile.dualAdPrice ? `<div class="rline"><span class="lbl">Valor antes do anúncio (+40%)</span><span class="val">${brl(ad.p40)}</span></div>` : ''}
    </div>
    <div class="form-actions" style="margin-top:16px;">
      <button class="btn small" id="rc_edit">Editar produto e preços</button>
      <button class="btn small" id="rc_copy">Copiar resumo</button>
    </div>
  </div><div class="torn bottom"></div>`;

  ligarCanais();
  document.getElementById('rc_edit').onclick = ()=> openSkuForm(prod.id);
  document.getElementById('rc_copy').onclick = ()=>{
    const txt = [
      `${lst.sku} -- ${prod.name} (${profile.label})`,
      `Preço de venda: ${brl(r.price)}`,
      `Valor recebido: ${brl(r.netMarketplace)}`,
      `Lucro líquido: ${brl(r.profit)}`,
      `Margem sobre o recebido: ${pct(r.marginOnNet)}`,
      `Valor de anúncio (+20%): ${brl(ad.p20)}` + (profile.dualAdPrice ? ` | antes (+40%): ${brl(ad.p40)}` : '')
    ].join('\n');
    navigator.clipboard.writeText(txt)
      .then(()=> toast('Resumo copiado para a área de transferência.', 'ok'))
      .catch(()=> toast('O navegador bloqueou a cópia automática.', 'err'));
  };
}

// Formulário do produto pai. Em cima, o que é do produto (SKU base, nome, CMV, custos da
// empresa); embaixo, um bloco por marketplace com o preço ou a margem daquele canal. Mudar o CMV
// aqui recalcula na hora todos os marketplaces do produto.
function openSkuForm(id){
  closeImportWizard();
  closeExportWizard();
  const existente = id ? produtoPorId(id) : null;
  editingSkuId = existente ? existente.id : null;

  // rascunho: nada é gravado até clicar em Salvar
  const prod = existente
    ? JSON.parse(JSON.stringify(existente))
    : {id:null, sku:'', name:'', cogs:0, costOverride:false,
       fixedCost: state.padroes.fixedCost, misc: state.padroes.misc,
       taxPct: state.padroes.taxPct, marketingPct: state.padroes.marketingPct, listings:[]};
  let costUnlocked = !!prod.costOverride;
  const skuBaseOriginal = prod.sku;
  // como o produto estava ao abrir: ao salvar, só o que difere disto é gravado
  const original = existente ? JSON.parse(JSON.stringify(existente)) : null;

  const canais = {};
  state.profiles.forEach(p=>{
    const lst = prod.listings.find(l=> l.marketplaceId === p.id);
    canais[p.id] = lst
      ? {ativo:true, id:lst.id, sku:lst.sku, skuCustom: lst.sku !== applyMktSuffix(prod.sku, p.id),
         mode:lst.mode, price:lst.price, marginTarget:lst.marginTarget,
         coupon:lst.coupon, freightNet:lst.freightNet, mktFixedFee:lst.mktFixedFee, tocado:true}
      : {ativo:false, id:null, sku:'', skuCustom:false, mode:'price', price:0, marginTarget:20,
         coupon: state.padroes.coupon, freightNet: state.padroes.freightNet, mktFixedFee:0, tocado:false};
  });
  // anúncio cujo marketplace foi excluído: continua no produto até o usuário decidir
  const orfaos = prod.listings.filter(l=> !state.profiles.some(p=> p.id === l.marketplaceId));
  if(!existente) canais[state.profiles[0].id].ativo = true;
  let ultimoEditado = null;

  const form = document.getElementById('skuForm');
  form.style.display = 'block';
  abrirPainel(existente ? 'Editar produto' : 'Novo produto',
    'Custo uma vez só; preço ou margem em cada marketplace. Mudar o custo recalcula todos os canais.'
    + (existente ? ' ' + ultimaAlteracao(existente) : ''));

  function costBlockHtml(){
    if(costUnlocked){
      return `<div class="card inset" style="border-color:var(--brand);padding:14px 16px;margin:8px 0 4px;">
          <span class="confidence conf-media">Custo alterado manualmente para este produto</span>
          <p class="sub" style="margin:8px 0 2px;">Este produto deixa de acompanhar a aba "Custos da empresa" -- mudanças lá não vão mais afetá-lo.</p>
          <div class="grid2">
            <div class="field"><label>Custo fixo alocado -- R$</label><input type="number" step="0.01" id="f_fixedCost" value="${esc(prod.fixedCost)}"></div>
            <div class="field"><label>Outros custos diversos -- R$</label><input type="number" step="0.01" id="f_misc" value="${esc(prod.misc)}"></div>
            <div class="field"><label>Imposto sobre a venda -- %</label><input type="number" step="0.01" id="f_tax" value="${esc(prod.taxPct)}"></div>
            <div class="field"><label>Marketing / Ads -- %</label><input type="number" step="0.01" id="f_marketing" value="${esc(prod.marketingPct)}"></div>
          </div>
          <button type="button" class="btn small" id="f_relock" style="margin-top:10px;">Voltar a usar os custos da empresa</button>
        </div>`;
    }
    return `<div class="card inset" style="padding:14px 16px;margin:8px 0 4px;">
        <p class="sub" style="margin:0 0 9px;">Vinculado aos custos da empresa: custo fixo ${brl(state.padroes.fixedCost)} &middot; outros ${brl(state.padroes.misc)} &middot; imposto ${state.padroes.taxPct}% &middot; marketing ${state.padroes.marketingPct}%.</p>
        <button type="button" class="btn small" id="f_unlock">Desbloquear e editar só para este produto</button>
      </div>`;
  }

  function canalHtml(p){
    const c = canais[p.id];
    const valor = c.mode === 'margin' ? c.marginTarget : c.price;
    const mostraFrete = p.variableFreight;
    const mostraTaxa = p.variableFixedFee && !p.tiered;
    return `<div class="canal${c.ativo?' on':''}" data-mid="${esc(p.id)}">
      <label class="canal-head">
        <input type="checkbox" class="c-ativo" ${c.ativo?'checked':''}>
        <span class="mkt-dot" style="background:${esc(p.color)}"></span>
        <span class="canal-nome">${esc(p.label)}</span>
        ${p.tiered ? '<span class="tag" style="margin-left:0;">faixas</span>' : ''}
        <span class="canal-res" data-res></span>
      </label>
      <div class="canal-body">
        <div class="canal-grid">
          <div class="cg"><span class="cl">Definir por</span>
            <div class="mini-toggle">
              <button type="button" class="${c.mode==='price'?'on':''}" data-modo="price">Preço</button>
              <button type="button" class="${c.mode==='margin'?'on':''}" data-modo="margin">Margem</button>
            </div></div>
          <div class="cg"><span class="cl" data-rotulo-valor>${c.mode==='margin'?'Margem %':'Preço R$'}</span>
            <input type="number" step="0.01" data-f="valor" value="${esc(valor)}"></div>
          <div class="cg"><span class="cl">Cupom R$</span><input type="number" step="0.01" data-f="coupon" value="${esc(c.coupon)}"></div>
          ${mostraFrete ? `<div class="cg"><span class="cl">Frete líquido R$</span><input type="number" step="0.01" data-f="freightNet" value="${esc(c.freightNet)}"></div>` : ''}
          ${mostraTaxa ? `<div class="cg"><span class="cl">Taxa fixa R$</span><input type="number" step="0.01" data-f="mktFixedFee" value="${esc(c.mktFixedFee)}"></div>` : ''}
          <div class="cg cg-sku"><span class="cl">SKU neste canal</span><input type="text" data-f="sku" value="${esc(c.sku || applyMktSuffix(prod.sku, p.id))}"></div>
        </div>
      </div>
    </div>`;
  }

  form.innerHTML = `
    <div class="grid2">
      <div class="field"><label>SKU do produto<span class="hint">Cada canal ganha "-ID do marketplace" no final.</span></label><input type="text" id="f_sku" style="width:180px;text-align:left;" value="${esc(prod.sku)}"></div>
      <div class="field"><label>Nome do produto</label><input type="text" id="f_name" style="width:220px;text-align:left;" value="${esc(prod.name)}"></div>
    </div>
    <div class="section-label">Custo (vale para todos os marketplaces)</div>
    <div class="field"><label>Custo do produto (CMV) -- R$</label><input type="number" step="0.01" id="f_cogs" value="${esc(prod.cogs)}"></div>
    <div id="f_costBlockWrap">${costBlockHtml()}</div>
    <div class="section-label">Preço em cada marketplace</div>
    <p class="sub" style="margin:8px 0 10px;">Marque onde o produto é vendido. Ao marcar um canal novo, ele começa com o mesmo preço ou margem do último canal que você mexeu.</p>
    <div class="canais">${state.profiles.map(canalHtml).join('')}</div>
    ${orfaos.length ? `<p class="warnline" style="margin-top:10px;color:var(--warn);">${orfaos.length} anúncio(s) deste produto estão num marketplace que foi excluído e serão removidos ao salvar.</p>` : ''}
    <div class="form-actions">
      <button class="btn primary" id="f_save">Salvar produto</button>
      <button class="btn" id="f_cancel">Cancelar</button>
      <span style="font-size:11px;color:var(--ink-mute);">Ctrl+Enter salva &middot; Esc cancela</span>
    </div>
  `;

  const val = id => parseFloat((document.getElementById(id)||{}).value) || 0;
  function produtoDoRascunho(){
    return {
      id: prod.id, sku: document.getElementById('f_sku').value.trim(), name: document.getElementById('f_name').value.trim(),
      cogs: val('f_cogs'), costOverride: costUnlocked,
      fixedCost: costUnlocked ? val('f_fixedCost') : state.padroes.fixedCost,
      misc: costUnlocked ? val('f_misc') : state.padroes.misc,
      taxPct: costUnlocked ? val('f_tax') : state.padroes.taxPct,
      marketingPct: costUnlocked ? val('f_marketing') : state.padroes.marketingPct
    };
  }
  function anuncioDoRascunho(mid){
    const c = canais[mid];
    return {id: c.id || 'rascunho', marketplaceId: mid, sku: c.sku, mode: c.mode, price: c.price,
      marginTarget: c.marginTarget, coupon: c.coupon, freightNet: c.freightNet, mktFixedFee: c.mktFixedFee};
  }
  // resultado de cada canal na própria linha do canal, recalculado a cada tecla
  function atualizaResultados(){
    const pr = produtoDoRascunho();
    form.querySelectorAll('.canal').forEach(el=>{
      const mid = el.dataset.mid, c = canais[mid], alvo = el.querySelector('[data-res]');
      if(!c.ativo){ alvo.innerHTML = '<span class="muted">não vendido aqui</span>'; return; }
      const r = calcSku(profileOf(mid), visaoDoAnuncio(pr, anuncioDoRascunho(mid)));
      alvo.innerHTML = r.error
        ? '<span class="neg">margem inviável</span>'
        : `<b>${brl(r.price)}</b> <span class="${r.marginOnNet>=0?'pos':'neg'}">${pct(r.marginOnNet)}</span> <span class="muted">recebe ${brl(r.netMarketplace)}</span>`;
    });
  }

  function bindCostBlockEvents(){
    const unlockBtn = document.getElementById('f_unlock');
    if(unlockBtn) unlockBtn.onclick = ()=>{ costUnlocked = true; document.getElementById('f_costBlockWrap').innerHTML = costBlockHtml(); bindCostBlockEvents(); atualizaResultados(); };
    const relockBtn = document.getElementById('f_relock');
    if(relockBtn) relockBtn.onclick = ()=>{
      costUnlocked = false;
      prod.fixedCost = state.padroes.fixedCost; prod.misc = state.padroes.misc;
      prod.taxPct = state.padroes.taxPct; prod.marketingPct = state.padroes.marketingPct;
      document.getElementById('f_costBlockWrap').innerHTML = costBlockHtml(); bindCostBlockEvents(); atualizaResultados();
    };
    ['f_fixedCost','f_misc','f_tax','f_marketing'].forEach(id=>{
      const el = document.getElementById(id);
      if(el) el.addEventListener('input', ()=>{
        prod.fixedCost = val('f_fixedCost'); prod.misc = val('f_misc'); prod.taxPct = val('f_tax'); prod.marketingPct = val('f_marketing');
        atualizaResultados();
      });
    });
  }
  bindCostBlockEvents();

  form.querySelectorAll('.canal').forEach(el=>{
    const mid = el.dataset.mid, c = canais[mid];
    el.querySelector('.c-ativo').addEventListener('change', (e)=>{
      c.ativo = e.target.checked;
      el.classList.toggle('on', c.ativo);
      // canal recém-ligado herda preço/margem do último canal mexido, para não começar do zero
      if(c.ativo && !c.tocado){
        const modelo = ultimoEditado && canais[ultimoEditado].ativo ? canais[ultimoEditado]
          : Object.values(canais).find(x=> x.ativo && x !== c && x.tocado);
        if(modelo){ c.mode = modelo.mode; c.price = modelo.price; c.marginTarget = modelo.marginTarget; }
        c.tocado = true;
        const sub = el.querySelector('.canal-body');
        sub.querySelectorAll('[data-modo]').forEach(b=> b.classList.toggle('on', b.dataset.modo === c.mode));
        el.querySelector('[data-rotulo-valor]').textContent = c.mode === 'margin' ? 'Margem %' : 'Preço R$';
        el.querySelector('[data-f="valor"]').value = c.mode === 'margin' ? c.marginTarget : c.price;
      }
      if(!c.sku) c.sku = el.querySelector('[data-f="sku"]').value;
      atualizaResultados();
    });
    el.querySelectorAll('[data-modo]').forEach(b=> b.addEventListener('click', ()=>{
      c.mode = b.dataset.modo; c.tocado = true; ultimoEditado = mid;
      el.querySelectorAll('[data-modo]').forEach(x=> x.classList.toggle('on', x === b));
      el.querySelector('[data-rotulo-valor]').textContent = c.mode === 'margin' ? 'Margem %' : 'Preço R$';
      el.querySelector('[data-f="valor"]').value = c.mode === 'margin' ? c.marginTarget : c.price;
      atualizaResultados();
    }));
    el.querySelectorAll('[data-f]').forEach(inp=> inp.addEventListener('input', ()=>{
      const f = inp.dataset.f;
      if(f === 'sku'){ c.sku = inp.value.trim(); c.skuCustom = true; return; }
      const n = parseFloat(inp.value) || 0;
      if(f === 'valor'){ if(c.mode === 'margin') c.marginTarget = n; else c.price = n; }
      else c[f] = n;
      c.tocado = true; ultimoEditado = mid;
      atualizaResultados();
    }));
  });
  // SKU do produto mudou: os SKUs de canal que seguiam o padrão acompanham; os editados à mão não
  document.getElementById('f_sku').addEventListener('input', ()=>{
    const base = document.getElementById('f_sku').value.trim();
    form.querySelectorAll('.canal').forEach(el=>{
      const c = canais[el.dataset.mid];
      if(c.skuCustom) return;
      c.sku = applyMktSuffix(base, el.dataset.mid);
      el.querySelector('[data-f="sku"]').value = c.sku;
    });
  });
  ['f_cogs','f_name'].forEach(id=> document.getElementById(id).addEventListener('input', atualizaResultados));
  atualizaResultados();

  // onkeydown (e não addEventListener): o elemento do formulário é reaproveitado entre aberturas,
  // e addEventListener empilhava um ouvinte novo a cada vez
  form.onkeydown = (e)=>{
    if(e.key === 'Escape'){ e.preventDefault(); closeSkuForm(); }
    if(e.key === 'Enter' && (e.ctrlKey || e.metaKey)){ e.preventDefault(); document.getElementById('f_save').click(); }
  };
  document.getElementById('f_sku').focus();
  document.getElementById('f_cancel').onclick = closeSkuForm;

  document.getElementById('f_save').onclick = ()=>{
    const pr = produtoDoRascunho();
    if(!pr.sku || !pr.name){ toast('Preencha o SKU e o nome do produto.', 'err'); return; }
    const ativos = state.profiles.filter(p=> canais[p.id].ativo).map(p=> p.id);
    if(ativos.length === 0){ toast('Marque ao menos um marketplace onde o produto é vendido.', 'err'); return; }
    // SKU de canal vazio volta ao padrão
    ativos.forEach(mid=>{ if(!canais[mid].sku) canais[mid].sku = applyMktSuffix(pr.sku, mid); });

    const minhaBase = baseDoSku(pr.sku).toLowerCase();
    const outro = state.products.find(x=> x.id !== editingSkuId && baseDoSku(x.sku).toLowerCase() === minhaBase);
    if(outro && !confirm(`Já existe o produto "${outro.sku}" (${outro.name}), com anúncio em ${outro.listings.map(l=> profileOf(l.marketplaceId).label).join(', ') || 'nenhum marketplace'}.\n\nPara vender em mais um marketplace, o certo é abrir aquele produto e marcar o canal -- assim o custo fica num lugar só.\n\nSalvar assim mesmo como produto separado?`)) return;
    const conflitos = ativos.filter(mid=> state.products.some(x=> x.id !== editingSkuId
      && x.listings.some(l=> l.marketplaceId === mid && l.sku === canais[mid].sku)));
    if(conflitos.length && !confirm(`O SKU de canal já está em uso por outro produto em: ${conflitos.map(m=> profileOf(m).label).join(', ')}. Salvar assim mesmo?`)) return;
    const removidos = existente ? existente.listings.filter(l=> !ativos.includes(l.marketplaceId)) : [];
    const removidosValidos = removidos.filter(l=> state.profiles.some(p=> p.id === l.marketplaceId));
    if(removidosValidos.length && !confirm(`Remover o anúncio deste produto em: ${removidosValidos.map(l=> profileOf(l.marketplaceId).label).join(', ')}?`)) return;

    const listings = ativos.map(mid=>{
      const c = canais[mid];
      return normalizeListing({id: c.id || novoId(), marketplaceId: mid, sku: c.sku, mode: c.mode,
        price: c.price, marginTarget: c.marginTarget, coupon: c.coupon, freightNet: c.freightNet, mktFixedFee: c.mktFixedFee});
    });
    let alvo;
    if(existente){
      alvo = existente;
      if(state.products.indexOf(alvo) === -1){
        if(!confirm(`Enquanto este formulário estava aberto, o produto "${alvo.sku}" foi excluído por outra pessoa. Salvar vai recriá-lo com o que está no formulário. Continuar?`)) return;
        state.products.push(alvo);
      }
      // Grava só o que foi mudado NESTE formulário; o resto fica como está agora. Se outra pessoa
      // salvou algo enquanto o formulário estava aberto, aquilo não é desfeito sem ninguém ver.
      const mudouAqui = (a, b)=> canon(a) !== canon(b);
      Object.keys(pr).forEach(k=>{ if(k !== 'id' && mudouAqui(pr[k], original[k])) alvo[k] = pr[k]; });
      const antes = new Map(original.listings.map(l=> [l.id, l]));
      const novos = listings.map(l=>{
        const orig = antes.get(l.id), atual = alvo.listings.find(x=> x.id === l.id);
        if(!orig || !atual) return l;
        CAMPOS_ANUNCIO.forEach(k=>{ if(mudouAqui(l[k], orig[k])) atual[k] = l[k]; });   // campos do ML ficam intactos
        return normalizeListing(atual);
      });
      // anúncio que outra pessoa acrescentou com o formulário aberto continua
      const deOutros = alvo.listings.filter(x=> !antes.has(x.id) && !novos.some(n=> n.id === x.id || n.marketplaceId === x.marketplaceId));
      alvo.listings = novos.concat(deOutros);
    } else {
      alvo = normalizeProduct(Object.assign({}, pr, {id: novoId(), listings}));
      state.products.push(alvo);
    }
    normalizeProduct(alvo);
    if(!alvo.listings.some(l=> l.id === state.selectedSkuId)) state.selectedSkuId = alvo.listings[0].id;
    toast(existente
      ? `"${alvo.sku}" atualizado em ${listings.length} marketplace(s).` + (skuBaseOriginal !== alvo.sku ? ' SKU do produto alterado.' : '')
      : `"${alvo.sku}" criado com ${listings.length} anúncio(s).`, 'ok', 'Produto salvo');
    saveState();
    closeSkuForm();
    renderProdutos();
  };
}
function closeSkuForm(){
  editingSkuId = null;
  document.getElementById('skuForm').style.display='none';
  if(!wizardVisivel()) fecharPainel();
  document.getElementById('skuForm').innerHTML='';
}
function deleteSku(id){
  const prod = produtoPorId(id);
  if(!prod) return;
  const n = prod.listings.length;
  if(!confirm(`Excluir o produto "${prod.sku}" e ${n === 1 ? 'o anúncio dele' : 'os ' + n + ' anúncios dele'}? Essa ação não pode ser desfeita.`)) return;
  state.products = state.products.filter(p=> p.id !== id);
  if(!anuncioPorId(state.selectedSkuId)){
    const primeiro = state.products.find(p=> p.listings.length);
    state.selectedSkuId = primeiro ? primeiro.listings[0].id : null;
  }
  saveState();
  renderProdutos();
  toast(`"${prod.sku}" excluído.`, 'ok');
}

// Atalho: "/" foca a busca, como na maioria das ferramentas de catálogo
document.addEventListener('keydown', (e)=>{
  if(e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)){
    const s = document.getElementById('search');
    if(s && viewAtual === 'produtos'){ e.preventDefault(); s.focus(); s.select(); }
  }
});

// ---------- EDITOR EM LOTE ----------
// Uma grade: uma linha por produto, uma coluna por marketplace. Serve para cadastrar vários
// produtos de uma vez (cola os SKUs, um por linha) e para mexer em vários produtos que já existem
// (selecionados na tabela). "Preencher todos" aplica custo, preço/margem e o modo em todas as
// linhas; colar do Excel preenche várias linhas de uma vez; Enter desce para a linha de baixo.
let lote = null;

function celulaDoAnuncio(lst){
  return {ativo:true, lid: lst.id, mode: lst.mode, price: lst.price, marginTarget: lst.marginTarget};
}
function celulaNova(){ return {ativo:true, lid:null, mode:'margin', price:null, marginTarget:null}; }
function linhaDoProduto(prod){
  const canais = {};
  prod.listings.forEach(l=>{ if(!canais[l.marketplaceId]) canais[l.marketplaceId] = celulaDoAnuncio(l); });
  return {chave: 'r' + novoId(), pid: prod.id, sku: prod.sku, name: prod.name, cogs: prod.cogs, canais,
    original: JSON.parse(JSON.stringify({name: prod.name, cogs: prod.cogs, canais}))};
}
function linhaNova(sku){
  const canais = {};
  lote.mids.forEach(mid=> canais[mid] = celulaNova());
  return {chave: 'r' + novoId(), pid: null, sku, name: '', cogs: null, canais, original: null};
}
// mesma regra do resto do sistema: produto é o mesmo quando o SKU sem o "-ID" do marketplace bate
function produtoPeloSku(sku){
  const b = baseDoSku(sku).toLowerCase();
  return state.products.find(p=> baseDoSku(p.sku).toLowerCase() === b) || null;
}

function abrirLote(pids){
  if(!fecharTudoDoPainel()) return;
  const existentes = (pids || []).map(produtoPorId).filter(Boolean);
  let mids;
  if(existentes.length){
    const usados = new Set();
    existentes.forEach(p=> p.listings.forEach(l=> usados.add(l.marketplaceId)));
    mids = state.profiles.map(p=> p.id).filter(id=> usados.has(id));
  } else {
    mids = [];
  }
  lote = {mids, linhas: existentes.map(linhaDoProduto), sujo: false, preencher: {}};
  const box = document.getElementById('loteWizard');
  box.style.display = 'block';
  document.getElementById('panel').classList.add('larga');
  abrirPainel(existentes.length ? `Editar ${existentes.length} produto(s) em lote` : 'Cadastro em lote',
    'Uma linha por produto, uma coluna por marketplace. "Preencher todos" aplica em todas as linhas; colar do Excel preenche várias linhas; Enter desce.');
  desenharLote();
  if(!existentes.length) setTimeout(()=>{ const t = document.getElementById('lt_skus'); if(t) t.focus(); }, 50);
}

// Fechar com algo digitado e não salvo pergunta antes. Devolve false se a pessoa quis ficar.
function closeLoteWizard(){
  const box = document.getElementById('loteWizard');
  if(box.style.display !== 'block') return true;
  if(lote && lote.sujo && !confirm('Fechar o editor em lote sem salvar? O que foi preenchido nele se perde.')) return false;
  lote = null;
  box.style.display = 'none';
  box.innerHTML = '';
  document.getElementById('panel').classList.remove('larga');
  if(!wizardVisivel()) fecharPainel();
  return true;
}

// número digitado ("49,90", "49.90", "") -> número ou null
function numLote(v){
  if(v === null || v === undefined || String(v).trim() === '') return null;
  const n = parseNumberBR(v);
  return isNaN(n) ? null : n;
}
function valorDaCelula(c){ return c.mode === 'margin' ? c.marginTarget : c.price; }
function fmtCampo(v){ return (v === null || v === undefined) ? '' : String(round2(v)).replace('.', ','); }

// custos do produto da linha: os do produto (se existe) ou os padrões da empresa
function produtoDaLinha(r){
  const p = r.pid ? produtoPorId(r.pid) : null;
  const base = p || {costOverride:false, fixedCost: state.padroes.fixedCost, misc: state.padroes.misc,
    taxPct: state.padroes.taxPct, marketingPct: state.padroes.marketingPct};
  return {id: r.pid || 'novo', sku: r.sku, name: r.name, cogs: r.cogs || 0, costOverride: base.costOverride,
    fixedCost: base.costOverride ? base.fixedCost : state.padroes.fixedCost,
    misc: base.costOverride ? base.misc : state.padroes.misc,
    taxPct: base.costOverride ? base.taxPct : state.padroes.taxPct,
    marketingPct: base.costOverride ? base.marketingPct : state.padroes.marketingPct};
}
function calcDaCelula(r, mid){
  const c = r.canais[mid];
  if(!c || !c.ativo || valorDaCelula(c) === null) return null;
  const lstAtual = c.lid && r.pid ? (anuncioPorId(c.lid) || {}).lst : null;
  const lst = {id: c.lid || 'rascunho', marketplaceId: mid, sku: '', mode: c.mode,
    price: c.price || 0, marginTarget: c.marginTarget || 0,
    coupon: lstAtual ? lstAtual.coupon : state.padroes.coupon,
    freightNet: lstAtual ? lstAtual.freightNet : state.padroes.freightNet,
    mktFixedFee: lstAtual ? lstAtual.mktFixedFee : 0};
  return calcSku(profileOf(mid), visaoDoAnuncio(produtoDaLinha(r), lst));
}
function htmlResultado(r, mid){
  const c = r.canais[mid];
  if(!c || !c.ativo) return '<span class="muted">não vende</span>';
  const res = calcDaCelula(r, mid);
  if(!res) return '<span class="muted">preencha</span>';
  if(res.error) return '<span class="neg">inviável</span>';
  return c.mode === 'margin'
    ? `<b>${brl(res.price)}</b> <span class="muted">recebe ${brl(res.netMarketplace)}</span>`
    : `<b class="${res.marginPct >= 0 ? 'pos' : 'neg'}">${pct(res.marginPct)}</b> <span class="muted">recebe ${brl(res.netMarketplace)}</span>`;
}

function desenharLote(){
  const box = document.getElementById('loteWizard');
  const perfis = lote.mids.map(profileOf);
  const temNovas = lote.linhas.some(r=> !r.pid);
  const cabMkt = perfis.map(p=> `<th class="lt-mkt" data-mid="${esc(p.id)}"><span class="mkt-dot" style="background:${esc(p.color)}"></span>${esc(p.label)}</th>`).join('');
  const pre = lote.preencher;
  const preMkt = perfis.map(p=>{
    const f = pre[p.id] || {};
    return `<th class="lt-pre" data-mid="${esc(p.id)}">
      <div class="lt-cel">
        <input type="checkbox" class="lt-pre-ativo" title="Vender (marcado) ou não vender (desmarcado) neste marketplace em todas as linhas" checked>
        <select class="lt-pre-modo"><option value="margin"${f.mode !== 'price' ? ' selected' : ''}>Margem %</option><option value="price"${f.mode === 'price' ? ' selected' : ''}>Preço R$</option></select>
        <input type="text" inputmode="decimal" class="lt-pre-valor" placeholder="valor" value="${esc(f.valor || '')}">
      </div>
      <button class="btn small lt-pre-aplicar" type="button" title="Aplica o modo e o valor em todas as linhas que vendem neste marketplace. Valor vazio = só troca o modo, mantendo o preço de hoje.">Aplicar em todos</button>
    </th>`;
  }).join('');
  const linhas = lote.linhas.map((r, i)=>{
    const existe = !!r.pid;
    const celulas = perfis.map(p=>{
      const c = r.canais[p.id];
      const ativo = c && c.ativo;
      const modo = c ? c.mode : 'margin';
      return `<td class="lt-c${ativo ? '' : ' off'}" data-mid="${esc(p.id)}">
        <div class="lt-cel">
          <input type="checkbox" class="lt-ativo" ${ativo ? 'checked' : ''} title="Vende neste marketplace">
          <select class="lt-modo" ${ativo ? '' : 'disabled'}><option value="margin"${modo === 'margin' ? ' selected' : ''}>Margem %</option><option value="price"${modo === 'price' ? ' selected' : ''}>Preço R$</option></select>
          <input type="text" inputmode="decimal" class="lt-in lt-valor" data-col="v:${esc(p.id)}" value="${esc(c ? fmtCampo(valorDaCelula(c)) : '')}" ${ativo ? '' : 'disabled'}>
        </div>
        <div class="lt-res">${htmlResultado(r, p.id)}</div>
      </td>`;
    }).join('');
    return `<tr data-chave="${esc(r.chave)}" data-i="${i}">
      <td class="lt-sku">${existe ? `<span class="sku">${esc(r.sku)}</span><span class="tag">existente</span>`
        : `<input type="text" class="lt-in" data-col="sku" value="${esc(r.sku)}">`}</td>
      <td><input type="text" class="lt-in lt-nome" data-col="name" value="${esc(r.name)}" placeholder="Nome do produto"></td>
      <td><input type="text" inputmode="decimal" class="lt-in lt-num" data-col="cogs" value="${esc(fmtCampo(r.cogs))}" placeholder="0,00"></td>
      ${celulas}
      <td class="lt-x">${existe ? '' : '<button class="iconbtn danger" type="button" data-tirar title="Tirar esta linha"><svg class="ic"><use href="#i-x"/></svg></button>'}</td>
    </tr>`;
  }).join('');

  box.innerHTML = `
    <div class="lt-topo">
      <div class="lt-add">
        <label class="lt-rot">SKUs para ${lote.linhas.length ? 'acrescentar' : 'cadastrar'} <span class="hint">um por linha; pode colar do Excel. Pode vir "SKU [tab] nome [tab] custo". SKU que já existe entra como "existente", para editar.</span></label>
        <textarea id="lt_skus" rows="${lote.linhas.length ? 2 : 6}" placeholder="03-08-10&#10;03-08-11&#10;03-08-12"></textarea>
        <button class="btn" type="button" id="lt_addBtn">Acrescentar à lista</button>
      </div>
      <div class="lt-mkts">
        <span class="lt-rot">Marketplaces que vão trabalhar</span>
        <div class="mkt-checks">${state.profiles.map(p=> `<label class="mkt-check"><input type="checkbox" class="lt-mktchk" value="${esc(p.id)}" ${lote.mids.includes(p.id) ? 'checked' : ''}><span class="mkt-dot" style="background:${esc(p.color)}"></span>${esc(p.label)}</label>`).join('')}</div>
        <span class="hint">Marcar acrescenta a coluna e liga o marketplace nos produtos novos. Desmarcar só esconde a coluna: nenhum anúncio é apagado por isso.</span>
      </div>
    </div>
    ${lote.linhas.length ? `
    <div class="lt-wrap">
      <table class="lt">
        <thead>
          <tr><th>SKU</th><th>Nome</th><th>Custo (CMV)</th>${cabMkt}<th></th></tr>
          <tr class="lt-prelinha">
            <th class="lt-pre-rot">Preencher todos</th>
            <th></th>
            <th class="lt-pre"><div class="lt-cel"><input type="text" inputmode="decimal" id="lt_preCusto" placeholder="custo" value="${esc(pre.custo || '')}"></div><button class="btn small" type="button" id="lt_preCustoBtn">Aplicar em todos</button></th>
            ${preMkt}<th></th>
          </tr>
        </thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>
    <p class="lt-status" id="lt_status"></p>
    <div class="form-actions">
      <button class="btn primary" type="button" id="lt_salvar">${temNovas && lote.linhas.some(r=> r.pid) ? 'Salvar tudo' : (temNovas ? 'Cadastrar ' + lote.linhas.length + ' produto(s)' : 'Salvar alterações')}</button>
      <button class="btn" type="button" id="lt_cancelar">Cancelar</button>
    </div>` : `<div class="form-actions"><button class="btn" type="button" id="lt_cancelar">Cancelar</button></div>`}
  `;
  ligarLote();
  atualizaStatusLote();
}

function acrescentarSkus(texto){
  const linhas = String(texto || '').split(/\r?\n/).map(l=> l.split('\t').map(c=> c.trim())).filter(c=> c[0]);
  if(!linhas.length){ toast('Cole ao menos um SKU.', 'err'); return; }
  if(!lote.mids.length && linhas.length){
    // sem marketplace escolhido ainda: começa pelos que já têm anúncio (ou o primeiro cadastrado)
    const usados = state.profiles.filter(p=> listagens().some(v=> v.marketplaceId === p.id)).map(p=> p.id);
    lote.mids = usados.length ? usados : [state.profiles[0].id];
  }
  const naLista = new Set(lote.linhas.map(r=> baseDoSku(r.sku).toLowerCase()));
  let novos = 0, existentes = 0, repetidos = 0;
  linhas.forEach(([sku, nome, custo])=>{
    const k = baseDoSku(sku).toLowerCase();
    if(naLista.has(k)){ repetidos++; return; }
    naLista.add(k);
    const prod = produtoPeloSku(sku);
    let r;
    if(prod){ r = linhaDoProduto(prod); existentes++; }
    else { r = linhaNova(baseDoSku(sku)); novos++; }
    if(nome) r.name = nome;
    if(custo !== undefined && numLote(custo) !== null) r.cogs = numLote(custo);
    lote.linhas.push(r);
  });
  lote.sujo = true;
  desenharLote();
  toast(`${novos} novo(s)` + (existentes ? `, ${existentes} já existente(s) (entram para edição)` : '') + (repetidos ? `, ${repetidos} repetido(s) ignorado(s)` : '') + '.', 'ok', 'Lista montada');
  const primeiro = document.querySelector('#loteWizard tbody .lt-nome');
  if(primeiro && !primeiro.value) primeiro.focus();
}

// trocar Preço <-> Margem sem mudar o resultado: a margem passa a ser a de hoje (ou o preço, o de hoje)
function trocarModo(r, mid, novo){
  const c = r.canais[mid];
  if(!c || c.mode === novo) return;
  const res = calcDaCelula(r, mid);
  if(res && !res.error){
    if(novo === 'margin') c.marginTarget = res.marginOnNet;   // sem arredondar: o preço fica idêntico ao de hoje (a tela mostra 2 casas)
    else c.price = round2(res.price);
  }
  c.mode = novo;
}

function ligarLote(){
  const box = document.getElementById('loteWizard');
  const addBtn = document.getElementById('lt_addBtn');
  addBtn.onclick = ()=> acrescentarSkus(document.getElementById('lt_skus').value);
  document.getElementById('lt_skus').addEventListener('keydown', (e)=>{
    if(e.key === 'Enter' && (e.ctrlKey || e.metaKey)){ e.preventDefault(); addBtn.click(); }
  });
  document.getElementById('lt_cancelar').onclick = ()=>{ if(closeLoteWizard()) {} };
  box.querySelectorAll('.lt-mktchk').forEach(ch=> ch.onchange = ()=>{
    const mid = ch.value;
    if(ch.checked){
      lote.mids = state.profiles.map(p=> p.id).filter(id=> id === mid || lote.mids.includes(id));
      lote.linhas.forEach(r=>{ if(!r.pid && !r.canais[mid]) r.canais[mid] = celulaNova(); });
    } else {
      lote.mids = lote.mids.filter(id=> id !== mid);
    }
    desenharLote();
  });
  const salvar = document.getElementById('lt_salvar');
  if(!salvar) return;
  salvar.onclick = salvarLote;

  const tabela = box.querySelector('table.lt');
  const linhaDe = el=> lote.linhas[Number(el.closest('tr').dataset.i)];
  const atualizaLinha = tr=>{
    const r = lote.linhas[Number(tr.dataset.i)];
    tr.querySelectorAll('td.lt-c').forEach(td=> td.querySelector('.lt-res').innerHTML = htmlResultado(r, td.dataset.mid));
  };

  tabela.addEventListener('input', (e)=>{
    const inp = e.target;
    if(!inp.classList.contains('lt-in')) return;
    const r = linhaDe(inp), col = inp.dataset.col;
    if(col === 'sku') r.sku = inp.value.trim();
    else if(col === 'name') r.name = inp.value;
    else if(col === 'cogs') r.cogs = numLote(inp.value);
    else if(col.startsWith('v:')){
      const c = r.canais[col.slice(2)];
      if(!c) return;
      if(c.mode === 'margin') c.marginTarget = numLote(inp.value); else c.price = numLote(inp.value);
    }
    lote.sujo = true;
    atualizaLinha(inp.closest('tr'));
    atualizaStatusLote();
  });
  tabela.addEventListener('change', (e)=>{
    const el = e.target;
    const td = el.closest('td.lt-c');
    if(!td) return;
    const r = linhaDe(el), mid = td.dataset.mid;
    if(!r.canais[mid] && !el.classList.contains('lt-ativo')) return;
    if(el.classList.contains('lt-ativo')){
      if(!r.canais[mid]) r.canais[mid] = celulaNova();
      r.canais[mid].ativo = el.checked;
      td.classList.toggle('off', !el.checked);
      td.querySelector('.lt-modo').disabled = !el.checked;
      td.querySelector('.lt-valor').disabled = !el.checked;
    } else if(el.classList.contains('lt-modo')){
      trocarModo(r, mid, el.value);
      td.querySelector('.lt-valor').value = fmtCampo(valorDaCelula(r.canais[mid]));
    } else return;
    lote.sujo = true;
    atualizaLinha(el.closest('tr'));
    atualizaStatusLote();
  });
  tabela.addEventListener('click', (e)=>{
    if(e.target.closest('[data-tirar]')){
      const i = Number(e.target.closest('tr').dataset.i);
      lote.linhas.splice(i, 1);
      desenharLote();
      return;
    }
    const aplicar = e.target.closest('.lt-pre-aplicar');
    if(aplicar){
      const th = aplicar.closest('th'), mid = th.dataset.mid;
      const ativo = th.querySelector('.lt-pre-ativo').checked;
      const modo = th.querySelector('.lt-pre-modo').value;
      const txt = th.querySelector('.lt-pre-valor').value;
      const valor = numLote(txt);
      if(txt.trim() && valor === null){ toast('Valor inválido.', 'err'); return; }
      lote.preencher[mid] = {mode: modo, valor: txt};
      let n = 0;
      lote.linhas.forEach(r=>{
        if(!ativo){ if(r.canais[mid]){ r.canais[mid].ativo = false; n++; } return; }
        if(!r.canais[mid]) r.canais[mid] = celulaNova();
        const c = r.canais[mid];
        c.ativo = true;
        trocarModo(r, mid, modo);
        if(valor !== null){ if(modo === 'margin') c.marginTarget = valor; else c.price = valor; }
        n++;
      });
      lote.sujo = true;
      desenharLote();
      toast(ativo ? `${profileOf(mid).label}: ${modo === 'margin' ? 'margem' : 'preço'}${valor !== null ? ' ' + txt : ' (mantendo o preço de hoje)'} em ${n} linha(s).` : `${profileOf(mid).label} desligado em ${n} linha(s).`, 'ok');
      return;
    }
    if(e.target.closest('#lt_preCustoBtn')){
      const txt = document.getElementById('lt_preCusto').value;
      const v = numLote(txt);
      if(v === null){ toast('Digite o custo para aplicar.', 'err'); return; }
      lote.preencher.custo = txt;
      lote.linhas.forEach(r=> r.cogs = v);
      lote.sujo = true;
      desenharLote();
    }
  });
  // Enter desce para a mesma coluna na linha de baixo, como no Excel
  tabela.addEventListener('keydown', (e)=>{
    if(e.key !== 'Enter' || !e.target.classList.contains('lt-in')) return;
    e.preventDefault();
    const tr = e.target.closest('tr');
    const prox = (e.shiftKey ? tr.previousElementSibling : tr.nextElementSibling);
    const alvo = prox && prox.querySelector(`[data-col="${CSS.escape(e.target.dataset.col)}"]:not(:disabled)`);
    if(alvo){ alvo.focus(); alvo.select(); }
  });
  // Colar várias linhas (e colunas) do Excel: preenche a partir da célula onde se colou
  tabela.addEventListener('paste', (e)=>{
    const inp = e.target;
    if(!inp.classList.contains('lt-in')) return;
    const texto = (e.clipboardData || window.clipboardData).getData('text');
    if(!/[\t\n]/.test(texto.replace(/\r?\n$/, ''))) return;   // um valor só: colagem normal
    e.preventDefault();
    const grade = texto.replace(/\r?\n$/, '').split(/\r?\n/).map(l=> l.split('\t'));
    const trs = [...tabela.querySelectorAll('tbody tr')];
    const i0 = trs.indexOf(inp.closest('tr'));
    grade.forEach((vals, di)=>{
      const tr = trs[i0 + di];
      if(!tr) return;
      const campos = [...tr.querySelectorAll('.lt-in')];
      const j0 = [...inp.closest('tr').querySelectorAll('.lt-in')].indexOf(inp);
      vals.forEach((v, dj)=>{
        const alvo = campos[j0 + dj];
        if(!alvo || alvo.disabled) return;
        alvo.value = v.trim();
        alvo.dispatchEvent(new Event('input', {bubbles:true}));
      });
    });
    const sobra = grade.length - (trs.length - i0);
    if(sobra > 0) toast(`${sobra} linha(s) coladas a mais que a lista. Para cadastrar mais produtos, cole os SKUs no quadro de cima.`, 'warn');
  });
}

// O que falta para salvar, contado ao vivo
function problemasDoLote(){
  const erros = [];
  const skus = new Map();
  lote.linhas.forEach(r=>{
    const quem = r.sku || '(sem SKU)';
    if(!r.pid){
      if(!r.sku) erros.push({r, msg: 'linha sem SKU'});
      else {
        const k = baseDoSku(r.sku).toLowerCase();
        if(skus.has(k)) erros.push({r, msg: `${quem}: repetido na lista`});
        skus.set(k, true);
        const outro = produtoPeloSku(r.sku);
        if(outro) erros.push({r, msg: `${quem}: já existe (${outro.name}). Tire a linha e acrescente o SKU de novo para editá-lo`});
      }
      if(!r.name.trim()) erros.push({r, msg: `${quem}: sem nome`});
      if(r.cogs === null) erros.push({r, msg: `${quem}: sem custo`});
    }
    // colunas escondidas não contam: nelas nada é criado nem mudado
    const ativos = Object.keys(r.canais).filter(mid=> r.canais[mid].ativo && lote.mids.includes(mid));
    if(!r.pid && !ativos.length) erros.push({r, msg: `${quem}: nenhum marketplace marcado`});
    ativos.forEach(mid=>{
      const c = r.canais[mid];
      if(valorDaCelula(c) === null) erros.push({r, msg: `${quem}: falta ${c.mode === 'margin' ? 'a margem' : 'o preço'} em ${profileOf(mid).label}`});
    });
  });
  return erros;
}
function atualizaStatusLote(){
  const st = document.getElementById('lt_status');
  if(!st) return;
  const erros = problemasDoLote();
  document.querySelectorAll('#loteWizard tbody tr').forEach(tr=> tr.classList.remove('lt-erro'));
  const chaves = new Set(erros.map(x=> x.r.chave));
  document.querySelectorAll('#loteWizard tbody tr').forEach(tr=>{ if(chaves.has(tr.dataset.chave)) tr.classList.add('lt-erro'); });
  const novos = lote.linhas.filter(r=> !r.pid).length, exist = lote.linhas.length - novos;
  st.innerHTML = (erros.length
    ? `<span class="neg">Falta resolver ${erros.length} item(ns):</span> ${erros.slice(0, 4).map(x=> esc(x.msg)).join(' &middot; ')}${erros.length > 4 ? ' &middot; ...' : ''}`
    : `<span class="pos">Pronto para salvar.</span>`) + ` <span class="muted">${novos} novo(s), ${exist} existente(s).</span>`;
}

function salvarLote(){
  const erros = problemasDoLote();
  if(erros.length){ toast(erros.slice(0, 3).map(x=> x.msg).join(' · '), 'err', 'Confira as linhas marcadas'); atualizaStatusLote(); return; }
  // anúncios que existiam e foram desmarcados: pergunta antes de apagar
  const removidos = [];
  lote.linhas.forEach(r=>{
    if(!r.pid) return;
    Object.keys(r.original.canais).forEach(mid=>{ if(r.canais[mid] && !r.canais[mid].ativo) removidos.push(`${r.sku} em ${profileOf(mid).label}`); });
  });
  if(removidos.length && !confirm(`Remover ${removidos.length} anúncio(s)?\n\n${removidos.slice(0, 12).join('\n')}${removidos.length > 12 ? '\n...' : ''}`)) return;

  const muda = (a, b)=> canon(a) !== canon(b);
  let criados = 0, anunciosNovos = 0, alterados = 0;
  lote.linhas.forEach(r=>{
    const ativos = Object.keys(r.canais).filter(mid=> r.canais[mid].ativo && lote.mids.includes(mid) && !profileOf(mid).missing);
    if(!r.pid){
      const listings = ativos.map(mid=>{
        const c = r.canais[mid];
        return normalizeListing({id: novoId(), marketplaceId: mid, sku: applyMktSuffix(r.sku, mid), mode: c.mode,
          price: c.mode === 'price' ? c.price : (c.price || 0), marginTarget: c.mode === 'margin' ? c.marginTarget : (c.marginTarget || 20),
          coupon: state.padroes.coupon, freightNet: state.padroes.freightNet, mktFixedFee: 0});
      });
      state.products.push(normalizeProduct({id: novoId(), sku: r.sku, name: r.name.trim(), cogs: r.cogs, costOverride: false,
        fixedCost: state.padroes.fixedCost, misc: state.padroes.misc, taxPct: state.padroes.taxPct, marketingPct: state.padroes.marketingPct,
        listings}));
      criados++; anunciosNovos += listings.length;
      return;
    }
    // produto existente: grava só o que foi mudado aqui (o resto pode ter sido salvo por outra pessoa)
    const prod = produtoPorId(r.pid);
    if(!prod) return;
    let mexeu = false;
    if(muda(r.name, r.original.name) && r.name.trim()){ prod.name = r.name.trim(); mexeu = true; }
    if(muda(r.cogs, r.original.cogs) && r.cogs !== null){ prod.cogs = r.cogs; mexeu = true; }
    Object.keys(r.canais).forEach(mid=>{
      const c = r.canais[mid], o = r.original.canais[mid];
      const atual = prod.listings.find(l=> (c.lid && l.id === c.lid)) || prod.listings.find(l=> l.marketplaceId === mid);
      if(o && !c.ativo){
        if(atual){ prod.listings = prod.listings.filter(l=> l !== atual); mexeu = true; }
        return;
      }
      if(!c.ativo) return;
      if(!atual){
        prod.listings.push(normalizeListing({id: novoId(), marketplaceId: mid, sku: applyMktSuffix(prod.sku, mid), mode: c.mode,
          price: c.price || 0, marginTarget: c.marginTarget === null ? 20 : c.marginTarget,
          coupon: state.padroes.coupon, freightNet: state.padroes.freightNet, mktFixedFee: 0}));
        anunciosNovos++; mexeu = true;
        return;
      }
      ['mode','price','marginTarget'].forEach(k=>{
        if(c[k] === null || c[k] === undefined) return;
        if(!o || muda(c[k], o[k])){ if(muda(atual[k], c[k])){ atual[k] = c[k]; mexeu = true; } }
      });
    });
    if(mexeu) alterados++;
  });
  if(!anuncioPorId(state.selectedSkuId)){
    const primeiro = state.products.find(p=> p.listings.length);
    state.selectedSkuId = primeiro ? primeiro.listings[0].id : null;
  }
  selecaoLote.clear();
  saveState();
  lote.sujo = false;
  closeLoteWizard();
  renderProdutos();
  const partes = [criados ? `${criados} produto(s) cadastrado(s)` : '', anunciosNovos ? `${anunciosNovos} anúncio(s) novo(s)` : '', alterados ? `${alterados} produto(s) alterado(s)` : ''].filter(Boolean);
  toast(partes.length ? partes.join(', ') + '.' : 'Nada mudou.', 'ok', 'Lote salvo');
}

// ---------- seleção de produtos na tabela ----------
const selecaoLote = new Set();
function renderBarraLote(){
  const bar = document.getElementById('loteBar');
  if(!bar) return;
  // produto excluído (aqui ou por outra pessoa) sai da seleção
  [...selecaoLote].forEach(pid=>{ if(!produtoPorId(pid)) selecaoLote.delete(pid); });
  if(!selecaoLote.size){ bar.hidden = true; return; }
  bar.hidden = false;
  bar.innerHTML = `<b>${selecaoLote.size}</b> produto(s) selecionado(s)
    <button class="btn small primary" type="button" id="loteEditarSel">Editar em lote</button>
    <button class="btn small" type="button" id="loteLimparSel">Limpar seleção</button>`;
  document.getElementById('loteEditarSel').onclick = ()=> abrirLote([...selecaoLote]);
  document.getElementById('loteLimparSel').onclick = ()=>{
    selecaoLote.clear();
    document.querySelectorAll('#tableWrap .sel-prod, #selTodos').forEach(c=> c.checked = false);
    renderBarraLote();
  };
}

// ---------- INTEGRAÇÃO COM O MERCADO LIVRE ----------
// O anúncio vinculado passa a usar a comissão e o custo fixo que o próprio Mercado Livre informa
// para a categoria e o tipo dele (clássico/premium), em vez das taxas digitadas no cadastro do
// marketplace. O vínculo é feito pelo SKU: o que está no anúncio do ML contra o que está aqui.
const ML_TIPOS = {gold_special: 'Clássico', gold_pro: 'Premium', gold: 'Ouro', silver: 'Prata', bronze: 'Bronze', free: 'Grátis'};
function mlNomeDoTipo(t){ return ML_TIPOS[t] || t || '--'; }

let mlEstado = {status: null, itens: [], total: 0, carregando: false, filtro: '', mensagem: '', so: 'sem'};

// Qual marketplace do sistema é o Mercado Livre (marcado na tela da integração; na dúvida, o que
// tiver ID ou nome de Mercado Livre). Sem isso o sistema não teria como saber em qual canal mexer.
function mlMarketplace(){
  const marcado = state.profiles.find(p=> p.ehMercadoLivre);
  if(marcado) return marcado;
  return state.profiles.find(p=> ['meli','mercadolivre','mercadolibre','ml'].includes(String(p.id).toLowerCase()))
    || state.profiles.find(p=> slugDoRotulo(p.label).indexOf('mercadolivre') !== -1)
    || null;
}
function mlAnuncios(){
  const perfil = mlMarketplace();
  if(!perfil) return [];
  const out = [];
  state.products.forEach(prod=> prod.listings.forEach(l=>{ if(l.marketplaceId === perfil.id) out.push({prod, lst: l}); }));
  return out;
}
function mlChaveDoItem(it){ return it.id + (it.variacao ? '#' + it.variacao : ''); }
function mlAnuncioVinculado(chave){
  for(const prod of state.products){
    for(const l of prod.listings){ if(l.mlItemId && (l.mlItemId + (l.mlVarId ? '#' + l.mlVarId : '')) === chave) return {prod, lst: l}; }
  }
  return null;
}

// Taxas do anúncio, quando ele está vinculado e ligado. Devolve faixas no formato do cálculo.
function taxasDoAnuncio(sku){
  if(!sku || !sku.mlUsar || !Array.isArray(sku.mlFaixas) || !sku.mlFaixas.length) return null;
  return sku.mlFaixas.map(f=>({min: Number(f.min)||0, commission: Number(f.pct)||0, service: 0, transaction: 0,
    fixedFee: Number(f.fixo)||0, serviceCap: 0}));
}
// Custo do envio que o Mercado Livre informa para este anúncio, por faixa de preço.
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

// ---------- conversa com o servidor da integração (Edge Function "precificacao-ml") ----------
// A autorização de cada empresa e a senha da aplicação do Mercado Livre ficam no servidor, nunca
// nesta página. Os pedidos têm o mesmo formato da v1 ("ml=itens&offset=0&limit=50") e as
// respostas também: por isso o resto da integração (vínculos, taxas, envio, conferência,
// correção) é o mesmo código da v1.
async function mlChamar(params){
  if(!empresa) throw new Error('Abra uma empresa primeiro.');
  const corpo = {empresa_id: empresa.id};
  new URLSearchParams(params).forEach((v, k)=>{ corpo[k] = v; });
  const d = await V2.chamarML(corpo);
  if(d && d.erroML) throw new Error(d.erroML);
  if(d && d.ok === false) throw new Error(d.error || d.erro || 'O servidor da integração devolveu um erro.');
  if(!d || d.ok === undefined) throw new Error('O servidor da integração respondeu sem entender o pedido.');
  return d;
}
async function mlAtualizarStatus(mostrarErro){
  try{
    mlEstado.status = await mlChamar('ml=status');
  }catch(err){
    mlEstado.status = null;
    if(mostrarErro) toast(err.message, 'err', 'Mercado Livre');
  }
  renderML();
}

// ---------- ações ----------
async function mlConectar(){
  try{
    const d = await mlChamar('ml=auth');
    window.open(d.url, '_blank', 'noopener');
    toast('Autorize na aba que abriu. Quando ela disser que deu certo, volte para cá e clique em "Já autorizei".', 'ok', 'Mercado Livre');
  }catch(err){ toast(err.message, 'err', 'Mercado Livre'); }
}
async function mlDesconectar(){
  if(!confirm('Desconectar esta empresa da conta do Mercado Livre? Os vínculos e as taxas já puxadas continuam aqui.')) return;
  try{ await mlChamar('ml=desconectar'); toast('Desconectado.', 'ok'); await mlAtualizarStatus(); }
  catch(err){ toast(err.message, 'err', 'Mercado Livre'); }
}

async function mlCarregarItens(){
  if(mlEstado.carregando) return;
  mlEstado.carregando = true; mlEstado.mensagem = 'Buscando seus anúncios no Mercado Livre...';
  renderML();
  try{
    const itens = [];
    let offset = 0, total = 0;
    do{
      const d = await mlChamar('ml=itens&offset=' + offset + '&limit=50');
      total = d.total || 0;
      itens.push(...(d.itens || []));
      offset += 50;
      mlEstado.mensagem = `Buscando... ${itens.length} de ${total} anúncio(s).`;
      renderML();
    } while(offset < total && offset < 1000);
    mlEstado.itens = itens; mlEstado.total = total;
    mlEstado.mensagem = total > 1000 ? 'O Mercado Livre entrega no máximo 1000 anúncios por busca; trouxe os primeiros 1000.' : '';
    toast(`${itens.length} anúncio(s) trazidos do Mercado Livre.`, 'ok', 'Anúncios carregados');
  }catch(err){
    mlEstado.mensagem = '';
    toast(err.message, 'err', 'Mercado Livre');
  }
  mlEstado.carregando = false;
  renderML();
}

// Sugestão de vínculo: só pelo SKU, sem adivinhar por nome. Primeiro o SKU do anúncio aqui,
// depois o SKU do produto, depois o SKU sem o "-ID" do marketplace nas duas pontas.
function mlSugestao(it){
  const sku = String(it.sku || '').trim().toLowerCase();
  if(!sku) return null;
  const anuncios = mlAnuncios().filter(a=> !a.lst.mlItemId);   // já vinculado a outro item não é sugestão
  let achado = anuncios.find(a=> a.lst.sku.toLowerCase() === sku);
  if(achado) return {a: achado, regra: 'SKU do anúncio'};
  achado = anuncios.find(a=> a.prod.sku.toLowerCase() === sku);
  if(achado) return {a: achado, regra: 'SKU do produto'};
  const base = baseDoSku(sku).toLowerCase();
  achado = anuncios.find(a=> baseDoSku(a.lst.sku).toLowerCase() === base || a.prod.sku.toLowerCase() === base);
  if(achado) return {a: achado, regra: 'SKU sem o final do marketplace'};
  return null;
}

function mlVincular(chave, lid, silencioso){
  const alvo = anuncioPorId(lid);
  if(!alvo) return false;
  const it = mlEstado.itens.find(x=> mlChaveDoItem(x) === chave);
  if(!it) return false;
  const jaEra = mlAnuncioVinculado(chave);
  if(jaEra && jaEra.lst.id !== lid){ jaEra.lst.mlItemId = ''; jaEra.lst.mlVarId = ''; }
  const l = alvo.lst;
  l.mlItemId = it.id; l.mlVarId = it.variacao || '';
  l.mlTitulo = it.titulo || ''; l.mlTipo = it.tipo || ''; l.mlSituacao = it.situacao || '';
  l.mlPreco = Number(it.preco) || 0; l.mlCategoria = it.categoria || '';
  if(l.mlUsar === undefined || l.mlUsar === null) l.mlUsar = true;
  if(!silencioso){ saveState(); renderML(); renderProdutos(); }
  return true;
}
function mlDesvincular(lid){
  const alvo = anuncioPorId(lid);
  if(!alvo) return;
  ['mlItemId','mlVarId','mlTitulo','mlTipo','mlSituacao','mlCategoria','mlAtualizadoEm'].forEach(k=> alvo.lst[k] = '');
  alvo.lst.mlPreco = 0; alvo.lst.mlPct = 0; alvo.lst.mlFixo = 0; alvo.lst.mlFaixas = []; alvo.lst.mlUsar = false;
  saveState(); renderML(); renderProdutos();
  toast('Vínculo desfeito. Este anúncio volta a usar as taxas do cadastro do marketplace.', 'ok');
}

function mlVincularSugeridos(){
  let n = 0;
  mlEstado.itens.forEach(it=>{
    const chave = mlChaveDoItem(it);
    if(mlAnuncioVinculado(chave)) return;
    const s = mlSugestao(it);
    if(s && !s.a.lst.mlItemId && mlVincular(chave, s.a.lst.id, true)) n++;
  });
  if(!n){ toast('Nenhum vínculo novo pelo SKU. Os que sobraram você liga à mão, na coluna "produto deste sistema".', 'warn'); return; }
  saveState(); renderML(); renderProdutos();
  toast(`${n} anúncio(s) vinculados pelo SKU. Agora clique em "Atualizar taxas".`, 'ok', 'Vínculos feitos');
}

// ---------- taxas ----------
async function mlAtualizarTaxas(){
  const vinculados = mlAnuncios().filter(a=> a.lst.mlItemId);
  if(!vinculados.length){ toast('Nenhum anúncio vinculado. Vincule primeiro.', 'err'); return; }
  mlEstado.carregando = true;
  // O envio vem primeiro de propósito: ele relê cada anúncio no Mercado Livre e devolve a categoria
  // e o tipo de HOJE. Sondar as taxas com a categoria guardada no dia do vínculo deixava anúncio
  // que mudou de tipo (clássico/premium) ou de categoria com taxa errada para sempre.
  let envio = {ok: 0, erros: 0, mudancas: []};
  try{
    envio = await mlAtualizarFrete(vinculados);
  }catch(err){
    toast('O custo de envio não veio: ' + err.message, 'err', 'Envio');
  }
  const semCategoria = vinculados.filter(a=> !a.lst.mlCategoria || !a.lst.mlTipo).length;
  const comCategoria = vinculados.filter(a=> a.lst.mlCategoria && a.lst.mlTipo);
  const chaves = [...new Set(comCategoria.map(a=> a.lst.mlCategoria + '|' + a.lst.mlTipo))];
  const tabela = {};
  try{
    let restantes = chaves.slice();
    while(restantes.length){
      const lote = restantes.slice(0, 6);
      mlEstado.mensagem = `Consultando as taxas de ${Object.keys(tabela).length + lote.length} de ${chaves.length} categoria(s)...`;
      renderML();
      const d = await mlChamar('ml=taxas&chaves=' + encodeURIComponent(lote.join(',')));
      Object.assign(tabela, d.taxas || {});
      const faltou = d.faltou || [];
      restantes = restantes.slice(lote.length).concat(faltou);
    }
  }catch(err){
    mlEstado.carregando = false; mlEstado.mensagem = '';
    renderML();
    toast(err.message, 'err', 'Mercado Livre');
    return;
  }
  const agora = new Date().toISOString();
  const mudancas = [];
  let erros = 0;
  comCategoria.forEach(({prod, lst})=>{
    const t = tabela[lst.mlCategoria + '|' + lst.mlTipo];
    if(!t || t.erro || !t.faixas || !t.faixas.length){ erros++; return; }
    const antes = calcSku(profileOf(lst.marketplaceId), visaoDoAnuncio(prod, lst));
    lst.mlFaixas = t.faixas.map(f=>({min: Number(f.min)||0, pct: Number(f.pct)||0, fixo: Number(f.fixo)||0}));
    lst.mlUsar = true;
    lst.mlAtualizadoEm = agora;
    const atual = lst.mlFaixas.filter(f=> f.min <= (antes.error ? 0 : antes.price)).pop() || lst.mlFaixas[0];
    lst.mlPct = atual.pct; lst.mlFixo = atual.fixo;
    const depois = calcSku(profileOf(lst.marketplaceId), visaoDoAnuncio(prod, lst));
    if(!antes.error && !depois.error && Math.abs(antes.price - depois.price) > 0.005)
      mudancas.push(`${lst.sku}: ${brl(antes.price)} → ${brl(depois.price)}`);
  });
  saveState();
  mlEstado.carregando = false; mlEstado.mensagem = '';
  renderML(); renderProdutos();
  const todas = mudancas.concat(envio.mudancas);
  toast(`${comCategoria.length - erros} anúncio(s) com as taxas do Mercado Livre` + (envio.ok ? ` e ${envio.ok} com o custo de envio` : '') + '.'
    + (erros || envio.erros || semCategoria ? ` ${erros + envio.erros + semCategoria} sem resposta do ML.` : '')
    + (todas.length ? ` Preço mudou em ${new Set(todas.map(x=> x.split(':')[0])).size}: ${todas.slice(0, 3).join(' · ')}${todas.length > 3 ? '...' : ''}` : ' Nenhum preço mudou.'),
    (erros || envio.erros) ? 'warn' : 'ok', 'Taxas e envio atualizados');
}

function mlUsarNoAnuncio(lid, usar){
  const a = anuncioPorId(lid);
  if(!a) return;
  a.lst.mlUsar = !!usar;
  saveState(); renderML(); renderProdutos();
}
function mlUsarFreteNoAnuncio(lid, usar){
  const a = anuncioPorId(lid);
  if(!a) return;
  a.lst.mlUsarFrete = !!usar;
  saveState(); renderML(); renderProdutos();
}

// Custo do envio, anúncio por anúncio: o Mercado Livre responde por item (peso e dimensões contam),
// então aqui não dá para reaproveitar por categoria como nas taxas.
async function mlAtualizarFrete(vinculados){
  const alvos = vinculados.filter(a=> a.lst.mlItemId);
  if(!alvos.length) return {ok:0, erros:0, mudancas:[]};
  const tabela = {};
  let restantes = alvos.map(a=> a.lst.mlItemId + (a.lst.mlVarId ? ':' + a.lst.mlVarId : ''));
  while(restantes.length){
    const lote = restantes.slice(0, 4);
    mlEstado.mensagem = `Consultando o envio de ${Object.keys(tabela).length + lote.length} de ${alvos.length} anúncio(s)...`;
    renderML();
    const d = await mlChamar('ml=frete&itens=' + encodeURIComponent(lote.join(',')));
    Object.assign(tabela, d.frete || {});
    restantes = restantes.slice(lote.length).concat(d.faltou || []);
  }
  const agora = new Date().toISOString();
  const mudancas = [];
  let erros = 0, ok = 0;
  alvos.forEach(({prod, lst})=>{
    const t = tabela[lst.mlItemId + (lst.mlVarId ? ':' + lst.mlVarId : '')];
    if(!t || t.erro || !t.faixas || !t.faixas.length){ erros++; return; }
    const antes = calcSku(profileOf(lst.marketplaceId), visaoDoAnuncio(prod, lst));
    lst.mlFreteFaixas = t.faixas.map(f=>({min: Number(f.min)||0, custo: Number(f.custo)||0}));
    lst.mlFreteGratis = !!t.gratis;
    lst.mlLogistica = t.logistica || '';
    lst.mlFreteOutra = Number(t.outra) || 0;
    lst.mlUsarFrete = true;
    lst.mlFreteEm = agora;
    lst.mlFrete = freteNoPreco(lst.mlFreteFaixas, antes.error ? 0 : antes.price);
    const depois = calcSku(profileOf(lst.marketplaceId), visaoDoAnuncio(prod, lst));
    ok++;
    if(!antes.error && !depois.error && Math.abs(antes.price - depois.price) > 0.005)
      mudancas.push(`${lst.sku}: ${brl(antes.price)} → ${brl(depois.price)}`);
  });
  return {ok, erros, mudancas};
}

// O que o sistema calcula para um preço, com as faixas guardadas daquele anúncio.
function mlNossoNoPreco(lst, preco){
  const faixa = (lst.mlFaixas || []).filter(f=> f.min <= preco).pop() || (lst.mlFaixas || [])[0];
  const taxa = faixa ? (preco * (Number(faixa.pct) || 0) / 100 + (Number(faixa.fixo) || 0)) : null;
  const envio = (lst.mlFreteFaixas || []).length ? freteNoPreco(lst.mlFreteFaixas, preco) : 0;
  return {taxa, envio, recebe: taxa === null ? null : preco - taxa - envio};
}
const ML_TOLERANCIA = 0.01;   // um centavo: abaixo disso é arredondamento, não divergência

// Resultado da última conferência daquele anúncio contra o Mercado Livre.
function mlConferencia(lst){
  if(lst.mlConfErro) return `<span class="neg">não conferido</span><span class="sub-val">${esc(lst.mlConfErro)}</span>`;
  if(!lst.mlConfEm) return '<span class="muted">ainda não conferido</span>';
  const preco = Number(lst.mlConfPreco) || 0;
  const nosso = mlNossoNoPreco(lst, preco);
  const difTaxa = Math.abs((nosso.taxa === null ? 0 : nosso.taxa) - Number(lst.mlConfTaxa));
  const difEnvio = Math.abs(nosso.envio - Number(lst.mlConfEnvio));
  const recebeML = preco - Number(lst.mlConfTaxa) - Number(lst.mlConfEnvio);
  if(difTaxa <= ML_TOLERANCIA && difEnvio <= ML_TOLERANCIA)
    return `<b class="pos">bate</b><span class="sub-val">no preço de lá (${brl(preco)}) você recebe ${brl(recebeML)}</span>`;
  return `<b class="neg">difere ${brl(Math.max(difTaxa, difEnvio))}</b>
    <span class="sub-val">no preço de lá (${brl(preco)}) &middot; taxa: aqui ${brl(nosso.taxa || 0)} / ML ${brl(lst.mlConfTaxa)}
    &middot; envio: aqui ${brl(nosso.envio)} / ML ${brl(lst.mlConfEnvio)}</span>`;
}
function mlEstadoDaConferencia(lst){
  if(lst.mlConfErro) return 'erro';
  if(!lst.mlConfEm) return 'semconferir';
  const preco = Number(lst.mlConfPreco) || 0;
  const nosso = mlNossoNoPreco(lst, preco);
  const difTaxa = Math.abs((nosso.taxa === null ? 0 : nosso.taxa) - Number(lst.mlConfTaxa));
  const difEnvio = Math.abs(nosso.envio - Number(lst.mlConfEnvio));
  return (difTaxa <= ML_TOLERANCIA && difEnvio <= ML_TOLERANCIA) ? 'bate' : 'difere';
}

// Encaixa uma faixa descoberta pelo Mercado Livre (de min até max) numa lista de faixas já guardada,
// sem mexer no que vale fora dela.
function aplicarFaixaRefinada(faixas, min, max, valor, campos){
  const lista = (faixas || []).map(f=> Object.assign({}, f)).sort((a,b)=> a.min - b.min);
  const valorEm = preco=>{
    const f = lista.filter(x=> x.min <= preco).pop() || lista[0];
    return f ? Object.assign({}, f) : null;
  };
  const depois = max === null || max === undefined ? null : valorEm(max);
  const nova = lista.filter(f=> f.min < min);
  nova.push(Object.assign({min}, campos.reduce((o,k)=> (o[k] = valor[k], o), {})));
  if(max !== null && max !== undefined){
    const resto = lista.filter(f=> f.min > max);
    if(depois) nova.push(Object.assign({}, depois, {min: max}));
    resto.forEach(f=> nova.push(f));
  }
  // tira faixas seguidas com o mesmo valor
  return nova.sort((a,b)=> a.min - b.min).filter((f,i,arr)=>
    i === 0 || campos.some(k=> Math.abs((Number(f[k])||0) - (Number(arr[i-1][k])||0)) > 0.0001));
}

// Corrige, pelo próprio Mercado Livre, os anúncios que a conferência apontou como divergentes:
// descobre a faixa exata em volta do preço de cada um e encaixa no lugar da faixa errada.
async function mlCorrigirDivergentes(){
  const alvos = mlAnuncios().filter(a=> a.lst.mlItemId && mlEstadoDaConferencia(a.lst) === 'difere');
  if(!alvos.length){ toast('Nenhum anúncio divergente. Rode a conferência primeiro.', 'warn'); return; }
  mlEstado.carregando = true;
  const porChave = new Map();
  alvos.forEach(a=>{
    const preco = Number(a.lst.mlConfPreco) || Number(a.lst.mlPreco) || 0;
    porChave.set(a.lst.mlItemId + ':' + (a.lst.mlVarId || '') + ':' + preco, a);
  });
  let restantes = [...porChave.keys()];
  let corrigidos = 0, erros = 0, feitos = 0;
  try{
    while(restantes.length){
      const lote = restantes.slice(0, 2);   // cada anúncio custa várias consultas: vai de dois em dois
      mlEstado.mensagem = `Descobrindo a faixa certa de ${feitos + lote.length} de ${alvos.length} anúncio(s)...`;
      renderML();
      const d = await mlChamar('ml=refinar&itens=' + encodeURIComponent(lote.join(',')));
      const resp = d.refino || {};
      Object.keys(resp).forEach(chave=>{
        const alvo = porChave.get(chave);
        if(!alvo) return;
        const r = resp[chave], lst = alvo.lst;
        feitos++;
        if(r.erro || (!r.taxa && !r.envio)){ lst.mlConfErro = r.erro || 'o Mercado Livre não respondeu para este anúncio'; erros++; return; }
        if(r.categoria) lst.mlCategoria = r.categoria;
        if(r.tipo) lst.mlTipo = r.tipo;
        if(r.taxa) lst.mlFaixas = aplicarFaixaRefinada(lst.mlFaixas, r.taxa.min, r.taxa.max, r.taxa.dados, ['pct','fixo']);
        if(r.envio){
          lst.mlFreteFaixas = aplicarFaixaRefinada(lst.mlFreteFaixas, r.envio.min, r.envio.max, r.envio.dados, ['custo']);
          lst.mlFreteGratis = !!r.gratis;
        }
        lst.mlAtualizadoEm = new Date().toISOString();
        // a conferência guardada vale para o preço de lá: confere de novo com a faixa corrigida
        const nosso = mlNossoNoPreco(lst, Number(lst.mlConfPreco) || 0);
        if(Math.abs((nosso.taxa || 0) - Number(lst.mlConfTaxa)) <= ML_TOLERANCIA
          && Math.abs(nosso.envio - Number(lst.mlConfEnvio)) <= ML_TOLERANCIA) corrigidos++;
      });
      restantes = restantes.slice(lote.length).concat(d.faltou || []);
      saveState();
    }
  }catch(err){
    toast(err.message, 'err', 'Correção interrompida');
  }
  mlEstado.carregando = false; mlEstado.mensagem = '';
  renderML(); renderProdutos();
  const restam = mlAnuncios().filter(a=> a.lst.mlItemId && mlEstadoDaConferencia(a.lst) === 'difere').length;
  toast(`${corrigidos} anúncio(s) passaram a bater com o Mercado Livre.` + (restam ? ` ${restam} ainda divergem.` : '')
    + (erros ? ` ${erros} sem resposta.` : ''), restam || erros ? 'warn' : 'ok', 'Faixas corrigidas pelo ML');
}

// Confere todos os anúncios vinculados contra o Mercado Livre, em blocos. Grava a cada bloco: se
// parar no meio (aba fechada, conexão caindo), o que já foi conferido continua valendo, e clicar de
// novo continua de onde parou quando a opção "só o que falta" está marcada.
async function mlConferirTudo(quais){
  let alvos = mlAnuncios().filter(a=> a.lst.mlItemId);
  if(quais === 'faltando') alvos = alvos.filter(a=> !a.lst.mlConfEm || a.lst.mlConfErro);
  if(quais === 'divergentes') alvos = alvos.filter(a=> mlEstadoDaConferencia(a.lst) === 'difere');
  if(!alvos.length){ toast('Nada para conferir com esse filtro.', 'warn'); return; }
  mlEstado.carregando = true;
  const porChave = new Map(alvos.map(a=> [a.lst.mlItemId + (a.lst.mlVarId ? ':' + a.lst.mlVarId : ''), a]));
  let restantes = [...porChave.keys()];
  let batem = 0, diferem = 0, erros = 0, feitos = 0;
  try{
    while(restantes.length){
      const lote = restantes.slice(0, 8);
      mlEstado.mensagem = `Conferindo ${feitos + lote.length} de ${alvos.length} anúncio(s) com o Mercado Livre...`;
      renderML();
      const d = await mlChamar('ml=conferir&itens=' + encodeURIComponent(lote.join(',')));
      const resp = d.conferencia || {};
      Object.keys(resp).forEach(chave=>{
        const alvo = porChave.get(chave);
        if(!alvo) return;
        const r = resp[chave], lst = alvo.lst;
        lst.mlConfEm = new Date().toISOString();
        if(r.erro || r.taxa === null || r.taxa === undefined){
          lst.mlConfErro = r.erro || 'o Mercado Livre não devolveu a taxa deste anúncio';
          erros++;
        } else {
          lst.mlConfErro = '';
          lst.mlConfPreco = Number(r.preco) || 0;
          lst.mlConfTaxa = Number(r.taxa) || 0;
          lst.mlConfEnvio = Number(r.envio) || 0;
          if(r.tipo) lst.mlTipo = r.tipo;
          lst.mlPreco = Number(r.preco) || lst.mlPreco;
          lst.mlFreteGratis = !!r.gratis;
          if(mlEstadoDaConferencia(lst) === 'bate') batem++; else diferem++;
        }
        feitos++;
      });
      restantes = restantes.slice(lote.length).concat(d.faltou || []);
      saveState();   // grava o que já foi conferido antes de seguir
    }
  }catch(err){
    toast(err.message, 'err', 'Conferência interrompida');
  }
  mlEstado.carregando = false; mlEstado.mensagem = '';
  if(diferem) mlEstado.filtroConf = 'difere';
  renderML(); renderProdutos();
  toast(`${batem} anúncio(s) batem com o Mercado Livre` + (diferem ? `, ${diferem} divergem` : '') + (erros ? `, ${erros} sem resposta` : '') + '.'
    + (diferem ? ' Deixei a lista filtrada nos que divergem.' : ''), diferem || erros ? 'warn' : 'ok', 'Conferência com o Mercado Livre');
}

// ---------- tela ----------
function renderML(){
  const box = document.getElementById('view-ml');
  if(!box || !box.classList.contains('active')) return;
  const st = mlEstado.status;
  const perfil = mlMarketplace();
  const vinculados = mlAnuncios().filter(a=> a.lst.mlItemId);
  const comTaxas = vinculados.filter(a=> Array.isArray(a.lst.mlFaixas) && a.lst.mlFaixas.length);

  // Conexão da EMPRESA com a conta dela no Mercado Livre. A aplicação do ML (Client ID e Secret) é
  // uma só para todas as empresas e fica configurada no servidor pelo administrador.
  const conexao = !st
    ? `<p class="sub">Não consegui falar com o servidor da integração agora.</p>
       <div class="form-actions"><button class="btn" id="mlRecarregarStatus">Tentar de novo</button></div>`
    : !st.configurado
    ? `<p class="sub">A integração ainda não foi configurada no servidor: falta cadastrar a aplicação do Mercado Livre (Client ID e Client Secret). É o administrador quem faz, uma vez só, e vale para todas as empresas.</p>
       <div class="form-actions"><button class="btn" id="mlRecarregarStatus">Verificar de novo</button></div>`
    : `
      <div class="form-actions">
        <button class="btn primary" id="mlConectar" ${podeEditar ? '' : 'disabled title="Seu acesso é só de consulta"'}>${st.conectado ? 'Conectar outra conta' : 'Conectar ao Mercado Livre'}</button>
        <button class="btn" id="mlJaAutorizei">Já autorizei</button>
        ${st.conectado && podeEditar ? '<button class="btn danger" id="mlDesconectar">Desconectar</button>' : ''}
      </div>
      <p class="sub" style="margin:10px 0 0;">${st.conectado
        ? `<span class="pos">Conectado</span> na conta <b>${esc(st.apelido || st.userId)}</b>.`
        : 'Ainda não autorizado. Clique em Conectar, autorize na aba que abrir e volte aqui em "Já autorizei".'}</p>`;

  const escolhaMkt = `<div class="field"><label>Qual marketplace deste sistema é o Mercado Livre<span class="hint">É nele que os vínculos e as taxas entram.</span></label>
      <select id="mlPerfil">${state.profiles.map(p=> `<option value="${esc(p.id)}" ${perfil && p.id === perfil.id ? 'selected' : ''}>${esc(p.label)} (${esc(p.id)})</option>`).join('')}</select></div>`;

  const filtro = mlEstado.filtro.trim().toLowerCase();
  const itens = mlEstado.itens.filter(it=> !filtro
    || String(it.sku).toLowerCase().includes(filtro) || String(it.titulo).toLowerCase().includes(filtro) || String(it.id).toLowerCase().includes(filtro));
  const opcoes = mlAnuncios().map(a=> `<option value="${esc(a.lst.id)}">${esc(a.lst.sku)} — ${esc(a.prod.name)}</option>`).join('');
  const linhas = itens.slice(0, 300).map(it=>{
    const chave = mlChaveDoItem(it);
    const v = mlAnuncioVinculado(chave);
    const s = v ? null : mlSugestao(it);
    const destino = v
      ? `<b>${esc(v.lst.sku)}</b> <span class="muted">${esc(v.prod.name)}</span> <button class="btn small" data-mldesv="${esc(v.lst.id)}">Desvincular</button>`
      : `<select class="ml-alvo" data-mlchave="${esc(chave)}"><option value="">-- não vincular --</option>${opcoes}</select>`
        + (s ? ` <span class="tag" title="Encontrado por ${esc(s.regra)}">sugestão: ${esc(s.a.lst.sku)}</span>` : ' <span class="muted">sem SKU igual aqui</span>');
    return `<tr>
      <td class="cell-sku">${esc(it.sku || '(sem SKU)')}</td>
      <td class="cell-name">${esc(it.titulo)}${it.variacao ? ' <span class="tag">variação</span>' : ''}<span class="sub-val">${esc(it.id)}${it.variacao ? '/' + esc(it.variacao) : ''} · ${esc(mlNomeDoTipo(it.tipo))} · ${esc(it.situacao)}</span></td>
      <td class="num">${brl(it.preco)}</td>
      <td>${destino}</td>
    </tr>`;
  }).join('');

  // Em catálogo grande a tabela fica longa: o filtro deixa ir direto ao que precisa de atenção,
  // e a lista mostra até 300 linhas por vez.
  const filtroConf = mlEstado.filtroConf || 'todos';
  const contagem = {todos: comTaxas.length, difere: 0, semconferir: 0, erro: 0, bate: 0};
  comTaxas.forEach(a=> contagem[mlEstadoDaConferencia(a.lst)]++);
  const filtrados = filtroConf === 'todos' ? comTaxas : comTaxas.filter(a=> mlEstadoDaConferencia(a.lst) === filtroConf);
  const LIMITE_LINHAS = 300;
  const mostrados = filtrados.slice(0, LIMITE_LINHAS);
  const barraConf = comTaxas.length ? `<div class="form-actions" style="margin:0 0 10px;">
      <select id="mlFiltroConf">
        <option value="todos" ${filtroConf==='todos'?'selected':''}>Todos (${contagem.todos})</option>
        <option value="difere" ${filtroConf==='difere'?'selected':''}>Só os que divergem do ML (${contagem.difere})</option>
        <option value="bate" ${filtroConf==='bate'?'selected':''}>Só os que batem (${contagem.bate})</option>
        <option value="semconferir" ${filtroConf==='semconferir'?'selected':''}>Ainda não conferidos (${contagem.semconferir})</option>
        <option value="erro" ${filtroConf==='erro'?'selected':''}>Sem resposta do ML (${contagem.erro})</option>
      </select>
      <span class="muted">${filtrados.length} linha(s)${filtrados.length > LIMITE_LINHAS ? ', mostrando as ' + LIMITE_LINHAS + ' primeiras' : ''}</span>
    </div>` : '';

  const tabelaVinculos = comTaxas.length ? barraConf + `<div class="preview-scroll"><table>
      <thead><tr><th>SKU</th><th>Anúncio no ML</th><th>Tipo</th><th class="num">Comissão</th><th class="num">Custo fixo</th><th class="num">Envio</th><th class="num">Confere com o ML</th><th>Faixas</th><th>Usar</th></tr></thead>
      <tbody>${mostrados.map(({prod, lst})=>{
        const r = calcSku(profileOf(lst.marketplaceId), visaoDoAnuncio(prod, lst));
        const preco = r.error ? 0 : r.price;
        const faixa = (lst.mlFaixas || []).filter(f=> f.min <= preco).pop() || (lst.mlFaixas || [])[0] || {pct:0, fixo:0};
        const temFrete = (lst.mlFreteFaixas || []).length;
        const envio = temFrete ? freteNoPreco(lst.mlFreteFaixas, preco) : null;
        const conflito = lst.mlUsarFrete && lst.freightNet !== 0;
        return `<tr>
          <td class="cell-sku">${esc(lst.sku)}<span class="sub-val">${esc(prod.name)}</span></td>
          <td>${esc(lst.mlItemId)}${lst.mlVarId ? '/' + esc(lst.mlVarId) : ''}</td>
          <td>${esc(mlNomeDoTipo(lst.mlTipo))}</td>
          <td class="num">${pct(faixa.pct)}</td>
          <td class="num">${brl(faixa.fixo)}</td>
          <td class="num">${envio === null ? '<span class="muted">--</span>' : brl(envio)}
            <span class="sub-val">${lst.mlFreteGratis ? 'frete grátis' : 'envio por conta do comprador'}${lst.mlFreteOutra ? ' · na outra opção ' + brl(lst.mlFreteOutra) : ''}</span>
            ${conflito ? '<span class="sub-val neg">soma com o frete digitado neste anúncio</span>' : ''}</td>
          <td class="num">${mlConferencia(lst)}</td>
          <td class="muted">${(lst.mlFaixas || []).map(f=> `${f.min ? 'a partir de ' + brl(f.min) : 'até a próxima faixa'}: ${pct(f.pct)} + ${brl(f.fixo)}`).join('<br>')}
            ${temFrete > 1 ? '<br><span class="muted">envio: ' + lst.mlFreteFaixas.map(f=> (f.min ? 'a partir de ' + brl(f.min) : 'até a próxima') + ': ' + brl(f.custo)).join('; ') + '</span>' : ''}</td>
          <td><label class="ml-uso"><input type="checkbox" data-mlusar="${esc(lst.id)}" ${lst.mlUsar ? 'checked' : ''}> taxas</label>
            <label class="ml-uso"><input type="checkbox" data-mlusarfrete="${esc(lst.id)}" ${lst.mlUsarFrete ? 'checked' : ''} ${temFrete ? '' : 'disabled'}> envio</label></td>
        </tr>`;
      }).join('')}</tbody></table></div>
      <p class="sub" style="margin:8px 0 0;">Atualizado em ${esc(comTaxas.map(a=> a.lst.mlAtualizadoEm).sort().pop() ? dataHora(comTaxas.map(a=> a.lst.mlAtualizadoEm).sort().pop()) : '--')}. As taxas do Mercado Livre mudam de tempos em tempos: atualize quando desconfiar.</p>`
    : `<p class="sub">Nenhum anúncio com taxas do Mercado Livre ainda. Vincule e clique em "Atualizar taxas dos vinculados".</p>`;

  box.innerHTML = `
    <div class="card">
      <h2>Conexão com o Mercado Livre</h2>
      <p class="sub">A autorização fica guardada no servidor, nunca nesta página. É o servidor que conversa com o Mercado Livre, em nome desta empresa.</p>
      ${conexao}
    </div>

    <div class="card">
      <h2>Anúncios do Mercado Livre e vínculos</h2>
      ${escolhaMkt}
      <p class="sub">O vínculo é feito pelo <b>SKU</b>: o que está no anúncio do ML (campo SKU do vendedor) contra o SKU daqui. Nada é adivinhado por nome. O que não bater, você liga à mão na última coluna.</p>
      <div class="form-actions" style="margin-top:0;">
        <button class="btn primary" id="mlBuscar" ${st && st.conectado ? '' : 'disabled'}>${mlEstado.itens.length ? 'Recarregar anúncios' : 'Buscar meus anúncios'}</button>
        <button class="btn" id="mlVincularSugeridos" ${mlEstado.itens.length ? '' : 'disabled'}>Vincular todos pelo SKU</button>
        <span class="muted">${mlEstado.itens.length ? `${vinculados.length} vinculado(s) de ${mlEstado.itens.length} anúncio(s) trazidos` : ''}</span>
      </div>
      ${mlEstado.mensagem ? `<p class="sub">${esc(mlEstado.mensagem)}</p>` : ''}
      ${mlEstado.itens.length ? `
        <div class="field textrow" style="margin-top:12px;"><input type="text" id="mlBusca" placeholder="Buscar por SKU, título ou código do anúncio" value="${esc(mlEstado.filtro)}" style="width:100%;text-align:left;"></div>
        <div class="preview-scroll"><table>
          <thead><tr><th>SKU no ML</th><th>Anúncio</th><th class="num">Preço no ML</th><th>Produto deste sistema</th></tr></thead>
          <tbody>${linhas || '<tr><td colspan="4" class="muted">Nada encontrado com esse filtro.</td></tr>'}</tbody>
        </table></div>
        ${itens.length > 300 ? `<p class="sub">Mostrando 300 de ${itens.length}. Use a busca para achar o resto.</p>` : ''}` : ''}
    </div>

    <div class="card">
      <h2>Taxas puxadas do Mercado Livre</h2>
      <p class="sub">Comissão, custo fixo e custo de envio por faixa de preço, como o Mercado Livre informa para cada anúncio &mdash; os mesmos números que aparecem em "A pagar" na sua lista de anúncios. Enquanto marcado em "Usar", o cálculo daquele anúncio ignora as taxas digitadas no cadastro do marketplace. O envio é consultado anúncio a anúncio, porque depende do peso e das dimensões, e vem pela opção de envio que o anúncio usa hoje.</p>
      <div class="form-actions" style="margin-top:0;">
        <button class="btn primary" id="mlTaxas" ${vinculados.length && st && st.conectado ? '' : 'disabled'}>Atualizar taxas e envio dos vinculados</button>
        <button class="btn" id="mlConferir" ${comTaxas.length && st && st.conectado ? '' : 'disabled'} title="Pergunta ao Mercado Livre a taxa e o envio no preço atual de cada anúncio e compara com o que o sistema calcula">Conferir tudo com o Mercado Livre</button>
        <button class="btn small" id="mlConferirFaltando" ${comTaxas.length && st && st.conectado ? '' : 'disabled'} title="Continua de onde parou: só os que ainda não foram conferidos">Conferir só o que falta</button>
        <button class="btn" id="mlCorrigir" ${contagem.difere && st && st.conectado ? '' : 'disabled'} title="Descobre no Mercado Livre a faixa exata em volta do preço de cada anúncio divergente e corrige">Corrigir os ${contagem.difere} divergente(s) pelo ML</button>
      </div>
      ${tabelaVinculos}
    </div>`;

  ligarML();
}

function ligarML(){
  const q = id=> document.getElementById(id);
  const liga = (id, fn)=>{ const el = q(id); if(el) el.onclick = fn; };
  liga('mlRecarregarStatus', ()=> mlAtualizarStatus(true));
  liga('mlConectar', mlConectar);
  liga('mlJaAutorizei', ()=> mlAtualizarStatus(true));
  liga('mlDesconectar', mlDesconectar);
  liga('mlBuscar', mlCarregarItens);
  liga('mlVincularSugeridos', mlVincularSugeridos);
  liga('mlTaxas', mlAtualizarTaxas);
  liga('mlConferir', ()=> mlConferirTudo('todos'));
  liga('mlConferirFaltando', ()=> mlConferirTudo('faltando'));
  liga('mlCorrigir', mlCorrigirDivergentes);
  const filtroConf = q('mlFiltroConf');
  if(filtroConf) filtroConf.onchange = ()=>{ mlEstado.filtroConf = filtroConf.value; renderML(); };
  const urlAuth = q('mlUrlAuth');
  if(urlAuth) urlAuth.onclick = ()=> urlAuth.select();
  const perfilSel = q('mlPerfil');
  if(perfilSel) perfilSel.onchange = ()=>{
    state.profiles.forEach(p=> p.ehMercadoLivre = (p.id === perfilSel.value));
    saveState(); renderML();
  };
  const busca = q('mlBusca');
  if(busca) busca.addEventListener('input', debounce(()=>{
    mlEstado.filtro = busca.value;
    renderML();
    const novo = document.getElementById('mlBusca');
    if(novo){ novo.focus(); novo.setSelectionRange(novo.value.length, novo.value.length); }
  }, 250));
  const view = q('view-ml');
  view.querySelectorAll('.ml-alvo').forEach(sel=> sel.onchange = ()=>{
    if(!sel.value) return;
    if(mlVincular(sel.dataset.mlchave, sel.value)) toast('Vínculo feito. Clique em "Atualizar taxas dos vinculados" para puxar a comissão.', 'ok');
  });
  view.querySelectorAll('[data-mldesv]').forEach(b=> b.onclick = ()=> mlDesvincular(b.dataset.mldesv));
  view.querySelectorAll('[data-mlusar]').forEach(c=> c.onchange = ()=> mlUsarNoAnuncio(c.dataset.mlusar, c.checked));
  view.querySelectorAll('[data-mlusarfrete]').forEach(c=> c.onchange = ()=> mlUsarFreteNoAnuncio(c.dataset.mlusarfrete, c.checked));
}

// ---------- EXPORTAÇÃO DE PLANILHA ----------
function closeExportWizard(){
  document.getElementById('exportWizard').style.display='none';
  if(!wizardVisivel()) fecharPainel();
  document.getElementById('exportWizard').innerHTML='';
}
function openMarketplacePicker(titleText, subtitleText, confirmLabel, onConfirm){
  closeSkuForm();
  closeImportWizard();
  const box = document.getElementById('exportWizard');
  box.style.display = 'block';
  abrirPainel(titleText, subtitleText);
  box.innerHTML = `
    <div class="mkt-checks" style="margin-bottom:12px;">
      ${state.profiles.map(p=>{
        const n = listagens().filter(s=>s.marketplaceId===p.id).length;
        return `<label class="mkt-check"><input type="checkbox" value="${esc(p.id)}" class="exp-mkt-chk" ${n?'checked':''}><span class="mkt-dot" style="background:${esc(p.color)}"></span>${esc(p.label)} <span style="color:var(--ink-mute);font-size:10.5px;">(${n})</span></label>`;
      }).join('')}
    </div>
    <div class="form-actions" style="margin-bottom:10px;">
      <button class="btn small" id="exp_selectAll">Selecionar todos</button>
      <button class="btn small" id="exp_selectNone">Limpar seleção</button>
    </div>
    <div class="form-actions">
      <button class="btn primary" id="exp_confirm">${confirmLabel}</button>
      <button class="btn" id="exp_cancel">Cancelar</button>
    </div>
  `;
  document.getElementById('exp_cancel').onclick = closeExportWizard;
  document.getElementById('exp_selectAll').onclick = ()=> box.querySelectorAll('.exp-mkt-chk').forEach(c=>c.checked=true);
  document.getElementById('exp_selectNone').onclick = ()=> box.querySelectorAll('.exp-mkt-chk').forEach(c=>c.checked=false);
  document.getElementById('exp_confirm').onclick = ()=>{
    const chosen = Array.from(box.querySelectorAll('.exp-mkt-chk:checked')).map(c=>c.value);
    if(chosen.length===0){ toast('Selecione ao menos um marketplace.', 'err'); return; }
    onConfirm(chosen);
    closeExportWizard();
  };
}

function abrirExportCalculada(){
  openMarketplacePicker(
    'Exportar planilha',
    'Escolha de quais marketplaces você quer exportar os produtos, com preço, margem e valores de anúncio já calculados.',
    'Exportar (.csv)',
    exportSpreadsheet
  );
};

function abrirExportEdicao(){
  openMarketplacePicker(
    'Exportar planilha de edição em massa',
    'Gera uma planilha com os campos editáveis de cada produto (não os valores calculados). Edite no Excel/Sheets e reimporte pela opção "Importar planilha" -- escolhendo "sobrescrever" -- para atualizar tudo de uma vez.',
    'Exportar para edição (.xlsx)',
    exportEditSpreadsheet
  );
};

function exportSpreadsheet(marketplaceIds){
  const chosenSet = new Set(marketplaceIds);
  const rows = listagens().filter(s => chosenSet.has(s.marketplaceId));
  if(rows.length === 0){ toast('Nenhum produto cadastrado nos marketplaces selecionados.', 'err'); return; }
  const hasDualAny = marketplaceIds.some(id => profileOf(id).dualAdPrice);
  // Dois valores diferentes, com nomes que não deixam confundir: o que cai na mão depois das taxas
  // do marketplace (base da margem) e o que sobra depois de todos os custos.
  const header = ['SKU','Nome','Marketplace','Custo do Produto (CMV)','Preço de Venda',
    'Valor Recebido (após taxas do marketplace)','Lucro Líquido (após todos os custos)',
    'Margem (sobre valor recebido)','Margem (sobre preço de venda)','Valor Anúncio (+20%)'];
  if(hasDualAny) header.push('Valor Anúncio (+40%)');
  const numBR = v => FMT_NUM2.format(round2(v));
  const pctBR = v => FMT_PCT.format(round2(v))+'%';
  const data = [header];
  rows.forEach(sku=>{
    const p = profileOf(sku.marketplaceId);
    const r = calcSku(p, sku);
    if(r.error){
      const line = [sku.sku, sku.name, p.label, numBR(sku.cogs), 'inviável', 'inviável', 'inviável', 'inviável', 'inviável', ''];
      if(hasDualAny) line.push('');
      data.push(line);
      return;
    }
    const ad = adPrices(r.price, p);
    const line = [sku.sku, sku.name, p.label, numBR(sku.cogs), numBR(r.price), numBR(r.netMarketplace), numBR(r.profit),
      pctBR(r.marginOnNet), pctBR(r.marginOnPrice), numBR(ad.p20)];
    if(hasDualAny) line.push(ad.p40!==null ? numBR(ad.p40) : '');
    data.push(line);
  });
  const csv = '\uFEFF' + data.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(';')).join('\r\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0,10);
  a.href = url; a.download = `produtos-marketplaces-${stamp}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
function round2(v){ return Math.round((v+Number.EPSILON)*100)/100; }

function exportEditSpreadsheet(marketplaceIds){
  const chosenSet = new Set(marketplaceIds);
  const rows = listagens().filter(s => chosenSet.has(s.marketplaceId));
  if(rows.length === 0){ toast('Nenhum produto cadastrado nos marketplaces selecionados.', 'err'); return; }
  const num = v => round2(v);
  const header = ['SKU do Produto','SKU','Nome','Marketplace','Custo do Produto (CMV)','Preço de Venda','Margem Desejada (%)',
    'Cupom','Frete Líquido','Taxa Fixa do Anúncio',
    'Custo Fixo (só se custo alterado)','Outros Custos (só se custo alterado)','Imposto % (só se custo alterado)','Marketing % (só se custo alterado)'];
  const data = [header];
  rows.forEach(sku=>{
    const p = profileOf(sku.marketplaceId);
    data.push([
      sku.productSku, sku.sku, sku.name, p.label,
      num(sku.cogs),
      sku.mode==='price' ? num(sku.price) : '',
      sku.mode==='margin' ? Math.round(sku.marginTarget * 1e6) / 1e6 : '',   // margem exata: arredondar mudaria o preço em centavos na volta
      num(sku.coupon), num(sku.freightNet),
      p.variableFixedFee ? num(sku.mktFixedFee) : '',
      sku.costOverride ? num(sku.fixedCost) : '',
      sku.costOverride ? num(sku.misc) : '',
      sku.costOverride ? num(sku.taxPct) : '',
      sku.costOverride ? num(sku.marketingPct) : ''
    ]);
  });
  const stamp = new Date().toISOString().slice(0,10);
  baixarPlanilhaXlsx(`edicao-em-massa-${stamp}.xlsx`, 'Edição em massa', data, [0, 1, 2, 3],
    [16, 22, 34, 16, 12, 12, 12, 9, 10, 12, 14, 14, 14, 14]);
}

// Planilha .xlsx com as colunas de texto (SKU, nome, marketplace) gravadas como TEXTO. Num CSV o
// Excel adivinha o tipo de cada célula, e um SKU como 03-08-10 virava a data 03/08/2010. Além das
// linhas preenchidas, 1000 linhas vazias já vêm com essas colunas em texto, para o SKU digitado
// depois também não virar data. Números vão como número, com duas casas.
function baixarPlanilhaXlsx(nomeArquivo, nomeAba, linhas, colunasTexto, larguras){
  return carregarXLSX().then(XLSX=>{
    const ws = XLSX.utils.aoa_to_sheet(linhas);
    const ultima = linhas.length - 1 + 1000;
    const nCols = linhas[0].length;
    for(let r = 0; r <= ultima; r++){
      for(let c = 0; c < nCols; c++){
        const end = XLSX.utils.encode_cell({r, c});
        const cel = ws[end];
        const texto = colunasTexto.indexOf(c) !== -1 || r === 0;
        if(texto){
          if(cel){ cel.t = 's'; cel.v = String(cel.v === undefined || cel.v === null ? '' : cel.v); cel.z = '@'; }
          else if(r >= linhas.length) ws[end] = {t:'s', v:'', z:'@'};
        } else if(cel && cel.t === 'n'){
          cel.z = '0.00';
        }
      }
    }
    ws['!ref'] = XLSX.utils.encode_range({s:{r:0, c:0}, e:{r: ultima, c: nCols - 1}});
    ws['!cols'] = larguras.map(w=> ({wch: w}));
    ws['!freeze'] = {xSplit: 0, ySplit: 1};
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, nomeAba.slice(0, 31));
    XLSX.writeFile(wb, nomeArquivo);
  }).catch(err=> toast((err && err.message) || String(err), 'err', 'Não foi possível gerar a planilha'));
}

// ---------- IMPORTAÇÃO EM MASSA ----------
const IMPORT_FIELDS = [
  {key:'sku', label:'SKU / Referência', required:true, synonyms:['sku','referencia','ref','codigo','codigoproduto','codsku','codigodoproduto']},
  {key:'name', label:'Nome do produto', required:true, synonyms:['nome','produto','nomedoproduto','descricao','descricaodoproduto','titulo']},
  {key:'cogs', label:'Custo do produto (CMV)', required:true, synonyms:['custo','custoproduto','cmv','custocmv','custodoproduto','custounitario']},
  {key:'price', label:'Preço de venda', required:false, synonyms:['preco','precodevenda','valorvenda','precovenda']},
  {key:'marginTarget', label:'Margem desejada -- % sobre o valor recebido (%)', required:false, synonyms:['margem','margemdesejada','margemalvo','margemliquida','margem%']},
  {key:'fixedCost', label:'Custo fixo alocado', required:false, synonyms:['custofixo','custofixoalocado']},
  {key:'misc', label:'Outros custos', required:false, synonyms:['outroscustos','custosdiversos','outros']},
  {key:'taxPct', label:'Imposto (%)', required:false, synonyms:['imposto','impostos','taxaimposto','imposto%']},
  {key:'marketingPct', label:'Marketing (%)', required:false, synonyms:['marketing','ads','marketingads','marketing%']},
  {key:'coupon', label:'Cupom pago pelo vendedor', required:false, synonyms:['cupom','cupomvendedor']},
  {key:'freightNet', label:'Frete: ganho/subsídio líquido', required:false, synonyms:['frete','freteliquido','fretesubsidio','fretegratissubsidio']},
  {key:'mktFixedFee', label:'Taxa fixa do anúncio (marketplaces com taxa variável)', required:false, synonyms:['taxafixa','taxafixaanuncio','taxafixadoanuncio','tarifafixa','taxafixaporitem']},
  {key:'marketplace', label:'Marketplace da linha', required:false, synonyms:['marketplace','canal','plataforma','canaldevenda','loja']},
  {key:'productSku', label:'SKU do produto (pai)', required:false, synonyms:['skudoproduto','skuproduto','skupai','skubase','produtopai']}
];

function normalizeHeader(s){
  return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9%]/g,'');
}

function parseNumberBR(v){
  if(v === undefined || v === null || v==='') return NaN;
  if(typeof v === 'number') return v;
  let s = String(v).trim().replace(/R\$/gi,'').replace(/\s/g,'');
  if(s === '') return NaN;
  if(s.includes(',') && s.includes('.')){
    s = s.replace(/\./g,'').replace(',', '.'); // "1.234,56" -> "1234.56"
  } else if(s.includes(',')) {
    s = s.replace(',', '.'); // "22,50" -> "22.50"
  }
  return parseFloat(s);
}

function detectDelimiter(text){
  const firstLine = text.split(/\r?\n/)[0] || '';
  const semi = (firstLine.match(/;/g)||[]).length;
  const comma = (firstLine.match(/,/g)||[]).length;
  const tab = (firstLine.match(/\t/g)||[]).length;
  if(tab > semi && tab > comma) return '\t';
  return semi >= comma ? ';' : ',';
}

function parseCSVText(text, delimiter){
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for(let i=0;i<text.length;i++){
    const c = text[i];
    if(inQuotes){
      if(c === '"'){
        if(text[i+1] === '"'){ field+='"'; i++; } else { inQuotes = false; }
      } else field += c;
    } else {
      if(c === '"') inQuotes = true;
      else if(c === delimiter){ row.push(field); field=''; }
      else if(c === '\n'){ row.push(field); rows.push(row); row=[]; field=''; }
      else if(c === '\r'){ /* ignora, quebra tratada pelo \n */ }
      else field += c;
    }
  }
  if(field.length || row.length){ row.push(field); rows.push(row); }
  return rows;
}

let importState = null; // { headers, rows, mapping, marketplaces, mode, batchValue, dupStrategy, preview }

function baixarModeloPlanilha(){
  const headers = ['SKU','Nome','Marketplace','Custo do Produto (CMV)','Preço de Venda','Margem Desejada (%)','Cupom','Frete Líquido','Taxa Fixa do Anúncio','Custo Fixo','Outros Custos','Imposto (%)','Marketing (%)'];
  const example = ['03-08-10','Camiseta básica branca P', (state.profiles[0]||{}).label || 'Shopee',20,'',30,0,0,'','','','',''];
  baixarPlanilhaXlsx('modelo-importacao-produtos.xlsx', 'Produtos', [headers, example], [0, 1, 2],
    [16, 34, 16, 12, 12, 12, 9, 10, 12, 11, 11, 11, 11]);
};

function abrirImportacao(){
  closeSkuForm();
  closeExportWizard();
  document.getElementById('importFileInput').value = '';
  document.getElementById('importFileInput').click();
};
document.getElementById('importFileInput').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const isCsv = /\.csv$/i.test(file.name);
  if(isCsv){
    const reader = new FileReader();
    reader.onload = (ev)=>{
      try{
        let text = ev.target.result;
        if(text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
        const delim = detectDelimiter(text);
        const rows2d = parseCSVText(text, delim).map(r=>r.map(c=>c.trim()));
        handleParsedRows(rows2d);
      }catch(err){
        toast(err.message, 'err', 'Não foi possível ler este CSV');
      }
    };
    reader.readAsText(file, 'UTF-8');
  } else {
    const reader = new FileReader();
    reader.onload = (ev)=>{
      const data = new Uint8Array(ev.target.result);
      toast('Baixando o leitor de Excel (só nesta primeira vez)...', 'warn');
      carregarXLSX().then(XLSX=>{
        try{
          const wb = XLSX.read(data, {type:'array'});
          const ws = wb.Sheets[wb.SheetNames[0]];
          handleParsedRows(XLSX.utils.sheet_to_json(ws, {header:1, raw:true, defval:''}));
        }catch(err){
          toast(err.message + '. Confira se é um .xlsx/.xls válido.', 'err', 'Não foi possível ler o arquivo');
        }
      }).catch(err=> toast(err.message, 'err', 'Leitor de Excel indisponível'));
    };
    reader.readAsArrayBuffer(file);
  }
});

// Baixa o leitor de .xlsx só quando ele é realmente necessário, e uma vez só por sessão.
let xlsxPromise = null;
function carregarXLSX(){
  if(window.XLSX) return Promise.resolve(window.XLSX);
  if(!xlsxPromise){
    xlsxPromise = new Promise((resolve, reject)=>{
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = ()=> window.XLSX ? resolve(window.XLSX) : reject(new Error('O leitor carregou incompleto. Recarregue a página e tente de novo.'));
      s.onerror = ()=>{
        xlsxPromise = null;   // deixa tentar de novo numa próxima importação
        reject(new Error('Sem conexão com o CDN. Salve a planilha como .csv (separado por ponto e vírgula) e importe de novo -- CSV não precisa de download nenhum.'));
      };
      document.head.appendChild(s);
    });
  }
  return xlsxPromise;
}

function handleParsedRows(rows2d){
  rows2d = rows2d.filter(r => r.some(c => String(c).trim() !== ''));
  if(rows2d.length < 2){ toast('Inclua uma linha de cabeçalho e ao menos uma linha de produto.', 'err', 'Planilha vazia'); return; }
  const headers = rows2d[0].map(h=>String(h));
  const dataRows = rows2d.slice(1);
  const mapping = {};
  const normHeaders = headers.map(normalizeHeader);
  const usedHeaderIdx = new Set();
  // 1ª passada: correspondência exata
  IMPORT_FIELDS.forEach(f=>{
    const idx = normHeaders.findIndex((nh,i) => !usedHeaderIdx.has(i) && f.synonyms.includes(nh));
    if(idx !== -1){ mapping[f.key] = idx; usedHeaderIdx.add(idx); } else { mapping[f.key] = -1; }
  });
  // 2ª passada: correspondência por trecho, só para campos ainda sem coluna
  IMPORT_FIELDS.forEach(f=>{
    if(mapping[f.key] !== -1) return;
    const idx = normHeaders.findIndex((nh,i) => !usedHeaderIdx.has(i) && f.synonyms.some(syn => nh.includes(syn)));
    if(idx !== -1){ mapping[f.key] = idx; usedHeaderIdx.add(idx); }
  });
  // null = o usuário ainda não escolheu; o passo 2 decide o padrão a partir da planilha
  importState = {headers, rows: dataRows, mapping, marketplaces: [], mode:'price', batchValue: 20,
    dupStrategy:'overwrite', useRowMarketplace:null};
  renderImportStep1();
}

// Resolve o texto da coluna "Marketplace" para o id de um marketplace cadastrado.
// Sem isso, reimportar a planilha de edição em massa multiplicava cada linha por todos os
// marketplaces escolhidos -- uma linha que já era só da Shopee virava também "-mercadolivre".
function matchMarketplaceByName(texto){
  const t = String(texto||'').trim();
  if(!t) return null;
  const porId = state.profiles.find(pr=> String(pr.id).toLowerCase() === t.toLowerCase());
  if(porId) return porId.id;
  const alvo = normalizeHeader(t);
  const porNome = state.profiles.find(pr=> normalizeHeader(pr.label) === alvo);
  return porNome ? porNome.id : null;
}
function rowMarketplaceStats(){
  const idx = importState.mapping.marketplace;
  if(idx === undefined || idx === -1) return {mapped:false, ok:0, fail:0, ids:[]};
  let ok = 0, fail = 0; const ids = new Set();
  importState.rows.forEach(r=>{
    const id = matchMarketplaceByName(r[idx]);
    if(id){ ok++; ids.add(id); } else fail++;
  });
  return {mapped:true, ok, fail, ids:Array.from(ids)};
}

function closeImportWizard(){
  importState = null;
  document.getElementById('importWizard').style.display='none';
  if(!wizardVisivel()) fecharPainel();
  document.getElementById('importWizard').innerHTML='';
}

function renderImportStep1(){
  const box = document.getElementById('importWizard');
  box.style.display = 'block';
  abrirPainel('Importar planilha', 'Três passos: conferir colunas, escolher marketplaces e confirmar.');
  box.innerHTML = `
    ${wizardNavHtml(1)}
    <p class="sub">Detectei ${importState.rows.length} linha(s) de produto e tentei adivinhar as colunas pelo nome do cabeçalho. Confira e ajuste onde precisar. SKU, Nome e Custo são obrigatórios.</p>
    <div class="map-grid">
      ${IMPORT_FIELDS.map(f => `
        <div class="map-row">
          <label>${f.label}${f.required?' <span class="req">*</span>':''}</label>
          <select data-mapfield="${f.key}">
            <option value="-1">-- não usar --</option>
            ${importState.headers.map((h,i)=>`<option value="${i}" ${importState.mapping[f.key]===i?'selected':''}>${esc(h)}</option>`).join('')}
          </select>
        </div>`).join('')}
    </div>
    <div class="form-actions">
      <button class="btn primary" id="imp_step1_next">Continuar</button>
      <button class="btn" id="imp_cancel1">Cancelar</button>
    </div>
  `;
  box.querySelectorAll('[data-mapfield]').forEach(sel=>{
    sel.addEventListener('change', ()=> importState.mapping[sel.dataset.mapfield] = parseInt(sel.value));
  });
  document.getElementById('imp_cancel1').onclick = closeImportWizard;
  document.getElementById('imp_step1_next').onclick = ()=>{
    const missing = IMPORT_FIELDS.filter(f=>f.required && importState.mapping[f.key]===-1);
    if(missing.length){ toast('Falta mapear: ' + missing.map(f=>f.label).join(', '), 'err'); return; }
    renderImportStep2();
  };
}

function renderImportStep2(){
  const box = document.getElementById('importWizard');
  const colFillCount = (key) => {
    const idx = importState.mapping[key];
    if(idx===-1) return 0;
    return importState.rows.filter(r => String(r[idx]??'').trim()!=='').length;
  };
  const priceFill = colFillCount('price');
  const marginFill = colFillCount('marginTarget');
  const hasPriceCol = importState.mapping.price !== -1;
  const hasMarginCol = importState.mapping.marginTarget !== -1;
  const defaultMode = marginFill > priceFill ? 'margin' : 'price'; // decide pelo que está de fato preenchido, não só pela coluna existir
  const rowMkt = rowMarketplaceStats();
  const podeUsarLinha = rowMkt.mapped && rowMkt.ok > 0;
  // padrão: se a planilha traz a coluna Marketplace e ela bate, usar o marketplace da linha --
  // é o que faz o ciclo "exportar p/ edição em massa -> editar -> reimportar" fechar sem duplicar
  if(!podeUsarLinha) importState.useRowMarketplace = false;
  else if(importState.useRowMarketplace === null) importState.useRowMarketplace = (rowMkt.fail === 0);
  box.innerHTML = `
    ${wizardNavHtml(2)}
    <div class="wizard-step">
      <h3>Para quais marketplaces esses produtos valem?</h3>
      ${podeUsarLinha ? `
        <div class="radio-row">
          <label class="radio-opt"><input type="radio" name="mktsource" value="row" ${importState.useRowMarketplace?'checked':''}>
            <span>Usar a coluna "Marketplace" de cada linha <strong>(recomendado)</strong><br>
            <span style="color:var(--ink-mute);font-size:11px;">${rowMkt.ok} linha(s) reconhecida(s) em ${rowMkt.ids.length} marketplace(s)${rowMkt.fail?`; ${rowMkt.fail} linha(s) sem correspondência serão ignoradas`:''}. É o caminho certo para reimportar a planilha de edição em massa &mdash; cada linha volta para o marketplace de onde saiu, sem multiplicar cadastros.</span></span></label>
          <label class="radio-opt"><input type="radio" name="mktsource" value="pick" ${importState.useRowMarketplace?'':'checked'}>
            <span>Escolher os marketplaces manualmente abaixo<br>
            <span style="color:var(--ink-mute);font-size:11px;">Cada linha da planilha vira um cadastro em cada marketplace marcado.</span></span></label>
        </div>` : `<p class="sub">Selecione um ou mais. Se escolher mais de um, cada produto da planilha vira um cadastro separado por marketplace (com as taxas de cada um aplicadas automaticamente).</p>`}
      <div class="mkt-checks" id="imp_mktChecks" style="${podeUsarLinha && importState.useRowMarketplace ? 'display:none;' : ''}">
        ${state.profiles.map(p=>`<label class="mkt-check"><input type="checkbox" value="${esc(p.id)}" class="imp-mkt-chk"><span class="mkt-dot" style="background:${esc(p.color)}"></span>${esc(p.label)}</label>`).join('')}
      </div>
    </div>
    <div class="wizard-step">
      <h3>Modo de precificação desta importação</h3>
      <div class="radio-row">
        <label class="radio-opt"><input type="radio" name="impmode" value="price" ${defaultMode==='price'?'checked':''}> Usar preço de venda ${hasPriceCol ? `(preenchida em ${priceFill} de ${importState.rows.length} linhas)` : '-- planilha não tem essa coluna, defina um valor único abaixo'}</label>
        <label class="radio-opt"><input type="radio" name="impmode" value="margin" ${defaultMode==='margin'?'checked':''}> Usar margem desejada ${hasMarginCol ? `(preenchida em ${marginFill} de ${importState.rows.length} linhas)` : '-- planilha não tem essa coluna, defina um valor único abaixo'}</label>
      </div>
      <div class="field" id="imp_batchValueRow"><label id="imp_batchValueLabel">Valor único a aplicar a todas as linhas</label><input type="number" step="0.01" id="imp_batchValue" value="20"></div>
    </div>
    <div class="form-actions">
      <button class="btn primary" id="imp_step2_next">Gerar prévia</button>
      <button class="btn" id="imp_back1">Voltar</button>
      <button class="btn" id="imp_cancel2">Cancelar</button>
    </div>
  `;
  function syncBatchRowVisibility(){
    const mode = box.querySelector('input[name=impmode]:checked').value;
    const colMapped = mode==='price' ? hasPriceCol : hasMarginCol;
    document.getElementById('imp_batchValueRow').style.display = colMapped ? 'none' : 'flex';
    document.getElementById('imp_batchValueLabel').textContent = mode==='price' ? 'Preço de venda único (R$) para todas as linhas' : 'Margem desejada única (%, sobre o valor recebido) para todas as linhas';
  }
  box.querySelectorAll('input[name=impmode]').forEach(r=> r.addEventListener('change', syncBatchRowVisibility));
  syncBatchRowVisibility();
  box.querySelectorAll('input[name=mktsource]').forEach(r=> r.addEventListener('change', ()=>{
    importState.useRowMarketplace = box.querySelector('input[name=mktsource]:checked').value === 'row';
    document.getElementById('imp_mktChecks').style.display = importState.useRowMarketplace ? 'none' : 'flex';
  }));
  document.getElementById('imp_cancel2').onclick = closeImportWizard;
  document.getElementById('imp_back1').onclick = renderImportStep1;
  document.getElementById('imp_step2_next').onclick = ()=>{
    if(!importState.useRowMarketplace){
      const chosen = Array.from(box.querySelectorAll('.imp-mkt-chk:checked')).map(c=>c.value);
      if(chosen.length===0){ toast('Selecione ao menos um marketplace.', 'err'); return; }
      importState.marketplaces = chosen;
    } else {
      importState.marketplaces = [];
    }
    importState.mode = box.querySelector('input[name=impmode]:checked').value;
    importState.batchValue = parseFloat(document.getElementById('imp_batchValue').value)||0;
    renderImportStep3();
  };
}

function wizardNavHtml(atual){
  const passos = ['Colunas','Marketplaces','Confirmar'];
  return `<div class="wizard-nav">${passos.map((t,i)=>{
    const n = i+1;
    const cls = n===atual ? 'on' : (n<atual ? 'done' : '');
    return `<span class="wstep ${cls}"><span class="n">${n<atual?'&#10003;':n}</span>${t}</span>` + (n<passos.length?'<span class="sep">&rarr;</span>':'');
  }).join('')}</div>`;
}

function buildImportSku(row, marketplaceId){
  const g = (key) => {
    const idx = importState.mapping[key];
    if(idx===undefined || idx===-1) return undefined;
    const v = row[idx];
    return v===undefined || v==='' ? undefined : v;
  };
  const skuRaw = String(g('sku')||'').trim();
  // SKU que já é o de um anúncio neste marketplace entra como está. Forçar o sufixo sempre
  // duplicava, na reimportação, qualquer SKU fora do padrão (ex.: XPTO-99 virava XPTO-99-shein)
  const existente = listagens().find(v=> v.marketplaceId === marketplaceId && v.sku.toLowerCase() === skuRaw.toLowerCase());
  const sku = existente ? existente.sku : applyMktSuffix(skuRaw, marketplaceId);
  const num = (v, fallback) => { if(v===undefined) return fallback; const n = parseNumberBR(v); return isNaN(n) ? fallback : n; };
  const priceMapped = num(g('price'), null);
  const marginMapped = num(g('marginTarget'), null);
  // decide o modo por linha: usa o que essa linha específica tem preenchido, e só recorre à escolha do lote quando a linha não tem nenhum dos dois
  let mode, price = 0, marginTarget = 20;
  if(priceMapped!==null){ mode='price'; price = priceMapped; }
  else if(marginMapped!==null){ mode='margin'; marginTarget = marginMapped; }
  else if(importState.mode==='price'){ mode='price'; price = importState.batchValue; }
  else { mode='margin'; marginTarget = importState.batchValue; }
  const rowCostVals = {fixedCost:g('fixedCost'), misc:g('misc'), taxPct:g('taxPct'), marketingPct:g('marketingPct')};
  const rowHasCostOverride = Object.values(rowCostVals).some(v => v !== undefined);
  return {
    id: uid(), sku, name: String(g('name')||'').trim(), marketplaceId,
    cogs: num(g('cogs'), 0),
    costOverride: rowHasCostOverride,
    fixedCost: rowHasCostOverride ? num(rowCostVals.fixedCost, state.padroes.fixedCost) : state.padroes.fixedCost,
    misc: rowHasCostOverride ? num(rowCostVals.misc, state.padroes.misc) : state.padroes.misc,
    taxPct: rowHasCostOverride ? num(rowCostVals.taxPct, state.padroes.taxPct) : state.padroes.taxPct,
    marketingPct: rowHasCostOverride ? num(rowCostVals.marketingPct, state.padroes.marketingPct) : state.padroes.marketingPct,
    coupon: num(g('coupon'), state.padroes.coupon),
    freightNet: num(g('freightNet'), state.padroes.freightNet),
    mktFixedFee: num(g('mktFixedFee'), 0),
    mode, price, marginTarget,
    productSku: String(g('productSku')||'').trim()
  };
}

// Decide, antes de gravar qualquer coisa, para onde vai cada linha da planilha. A prévia mostra
// exatamente este plano, e o botão Confirmar aplica o mesmo plano -- não existe uma segunda regra
// escondida na hora de salvar.
//   atualizar -> já existe anúncio com esse SKU nesse marketplace
//   juntar    -> produto existente com o mesmo SKU base, sem anúncio nesse marketplace
//   novo      -> produto novo
//   agrupa    -> outro marketplace do mesmo produto novo criado por uma linha acima
//   repetida  -> mesma linha (SKU + marketplace) duas vezes na planilha; vale a última
//   pular     -> já existe e a escolha foi manter o que está
function planejarImportacao(candidates, strategy){
  const base = s => skuBase(s, state.profiles);
  const porCanal = new Map();
  state.products.forEach(p=> p.listings.forEach(l=> porCanal.set(l.marketplaceId + '::' + l.sku.toLowerCase(), {prod:p, lst:l})));
  const porBase = new Map();
  state.products.forEach(p=>{
    const k = base(p.sku).toLowerCase();
    if(!porBase.has(k)) porBase.set(k, []);
    porBase.get(k).push({prod:p, mids:new Set(p.listings.map(l=> l.marketplaceId)), sku:p.sku, cogs:p.cogs, novo:false});
  });
  const passos = [];
  candidates.forEach(c=>{
    const kc = c.marketplaceId + '::' + c.sku.toLowerCase();
    const ex = porCanal.get(kc);
    if(ex && ex.prod){
      passos.push({c, acao: strategy === 'skip' ? 'pular' : 'atualizar', prod: ex.prod, lst: ex.lst, custoAntes: ex.prod.cogs});
      return;
    }
    if(ex && ex.passo){ passos.push({c, acao:'repetida', anterior: ex.passo}); return; }
    const skuPai = base(c.productSku || c.sku);
    const k = skuPai.toLowerCase();
    if(!porBase.has(k)) porBase.set(k, []);
    const grupo = porBase.get(k);
    let alvo = grupo.find(x=> !x.mids.has(c.marketplaceId));
    let passo;
    if(alvo){
      alvo.mids.add(c.marketplaceId);
      passo = {c, acao: alvo.novo ? 'agrupa' : 'juntar', alvo, custoAntes: alvo.novo ? null : alvo.cogs};
    } else {
      alvo = {prod:null, mids:new Set([c.marketplaceId]), sku: skuPai, cogs: c.cogs, novo:true};
      grupo.push(alvo);
      passo = {c, acao:'novo', alvo};
    }
    passos.push(passo);
    porCanal.set(kc, {passo});
  });
  return passos;
}

function aplicarImportacao(passos, strategy){
  const cont = {novosProdutos:0, emExistentes:0, agrupados:0, atualizados:0, pulados:0};
  const custosVistos = new Map();
  const aplicaProduto = (prod, c)=>{
    prod.name = c.name || prod.name;
    prod.cogs = c.cogs; prod.costOverride = c.costOverride;
    prod.fixedCost = c.fixedCost; prod.misc = c.misc; prod.taxPct = c.taxPct; prod.marketingPct = c.marketingPct;
    if(!custosVistos.has(prod.id)) custosVistos.set(prod.id, new Set());
    custosVistos.get(prod.id).add(String(c.cogs));
  };
  const aplicaAnuncio = (lst, c)=>{
    lst.mode = c.mode; lst.price = c.price; lst.marginTarget = c.marginTarget;
    lst.coupon = c.coupon; lst.freightNet = c.freightNet; lst.mktFixedFee = c.mktFixedFee;
  };
  passos.forEach(pa=>{
    const c = pa.c;
    if(pa.acao === 'pular'){ cont.pulados++; return; }
    if(pa.acao === 'atualizar'){ aplicaProduto(pa.prod, c); aplicaAnuncio(pa.lst, c); cont.atualizados++; return; }
    if(pa.acao === 'repetida'){
      const a = pa.anterior;
      if(a.lstCriado){ aplicaAnuncio(a.lstCriado, c); aplicaProduto(a.alvo.prod, c); }
      cont.atualizados++;
      return;
    }
    const lst = normalizeListing({id: novoId(), marketplaceId: c.marketplaceId, sku: c.sku});
    aplicaAnuncio(lst, c);
    pa.lstCriado = lst;
    const alvo = pa.alvo;
    if(!alvo.prod){
      alvo.prod = normalizeProduct({id: novoId(), sku: alvo.sku, name: c.name, listings: []});
      aplicaProduto(alvo.prod, c);
      state.products.push(alvo.prod);
      cont.novosProdutos++;
    } else if(pa.acao === 'juntar'){
      // "manter o que já existe" também vale para o custo do produto que recebe o canal novo
      if(strategy !== 'skip') aplicaProduto(alvo.prod, c);
      cont.emExistentes++;
    } else {
      aplicaProduto(alvo.prod, c);
      cont.agrupados++;
    }
    alvo.prod.listings.push(lst);
  });
  let conflitosDeCusto = 0;
  custosVistos.forEach(s=>{ if(s.size > 1) conflitosDeCusto++; });
  cont.conflitosDeCusto = conflitosDeCusto;
  return cont;
}

function renderImportStep3(){
  const box = document.getElementById('importWizard');
  const pares = [];
  let ignoradas = 0;
  if(importState.useRowMarketplace){
    const idx = importState.mapping.marketplace;
    importState.rows.forEach(row=>{
      const mktId = matchMarketplaceByName(row[idx]);
      if(mktId) pares.push({row, mktId}); else ignoradas++;
    });
  } else {
    importState.rows.forEach(row=> importState.marketplaces.forEach(mktId=> pares.push({row, mktId})));
  }
  const candidates = pares.map(p=> buildImportSku(p.row, p.mktId));
  importState.preview = candidates;

  const temExistente = planejarImportacao(candidates, 'overwrite').some(pa=> pa.acao === 'atualizar');
  let strategy = 'overwrite';

  function desenhar(){
    const passos = planejarImportacao(candidates, strategy);
    const n = a => passos.filter(pa=> pa.acao === a).length;
    const mudaCusto = pa => (pa.acao === 'atualizar' || (pa.acao === 'juntar' && strategy !== 'skip'))
      && pa.custoAntes !== null && Math.abs(pa.custoAntes - pa.c.cogs) > 1e-9;
    const nMudaCusto = new Set(passos.filter(mudaCusto).map(pa=> (pa.prod || pa.alvo.prod).id)).size;
    const destino = pa=>{
      const custo = mudaCusto(pa) ? ` <span class="tag">custo ${brl(pa.custoAntes)} &rarr; ${brl(pa.c.cogs)}</span>` : '';
      if(pa.acao === 'atualizar') return 'Atualiza o anúncio' + custo;
      if(pa.acao === 'pular') return '<span class="muted">Pula (já existe)</span>';
      if(pa.acao === 'repetida') return '<span class="muted">Linha repetida: vale a última</span>';
      if(pa.acao === 'juntar') return `Junta em <b>${esc(pa.alvo.sku)}</b> (já existe)` + custo;
      if(pa.acao === 'agrupa') return `Mesmo produto novo <b>${esc(pa.alvo.sku)}</b>`;
      return `Produto novo <b>${esc(pa.alvo.sku)}</b>`;
    };
    const linhas = passos.map(pa=>{
      const c = pa.c, p = profileOf(c.marketplaceId), r = calcSku(p, c);
      return `<tr>
        <td class="cell-sku">${esc(c.sku)}</td>
        <td class="cell-name">${esc(c.name)}</td>
        <td><span class="mkt-dot" style="background:${esc(p.color)}"></span>${esc(p.label)}</td>
        <td>${destino(pa)}</td>
        <td class="num">${r.error ? '--' : brl(r.price)}</td>
        <td class="num ${!r.error && r.marginPct>=0?'pos':'neg'}">${r.error ? 'inviável' : pct(r.marginPct)}</td>
      </tr>`;
    }).join('');
    const produtosNovos = n('novo');
    box.innerHTML = `
      ${wizardNavHtml(3)}
      <div class="imp-resumo">
        <div><b>${produtosNovos}</b> produto(s) novo(s)${n('agrupa') ? `, com ${produtosNovos + n('agrupa')} anúncios agrupados` : ''}</div>
        <div><b>${n('juntar')}</b> anúncio(s) entram em produtos que já existem</div>
        <div><b>${n('atualizar') + n('repetida')}</b> atualização(ões)${n('pular') ? `, <b>${n('pular')}</b> pulada(s)` : ''}</div>
        ${ignoradas ? `<div class="neg">${ignoradas} linha(s) ignoradas: o marketplace da linha não bate com nenhum cadastrado</div>` : ''}
      </div>
      ${nMudaCusto ? `<p class="warnline" style="color:var(--warn);margin:0 0 12px;">${nMudaCusto} produto(s) vão mudar de custo com esta planilha. O custo vale para o produto inteiro, então o preço ou a margem dos outros marketplaces deles também muda.</p>` : ''}
      ${temExistente ? `
      <div class="radio-row">
        <label class="radio-opt"><input type="radio" name="dupstrategy" value="overwrite" ${strategy==='overwrite'?'checked':''}> Atualizar o que já existe com os dados da planilha</label>
        <label class="radio-opt"><input type="radio" name="dupstrategy" value="skip" ${strategy==='skip'?'checked':''}> Manter o que já existe (só acrescentar o que é novo)</label>
      </div>` : ''}
      <div class="preview-scroll">
        <table>
          <thead><tr><th>SKU</th><th>Nome</th><th>Marketplace</th><th>Destino</th><th class="num">Preço</th><th class="num">Margem</th></tr></thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>
      <div class="form-actions">
        <button class="btn primary" id="imp_confirm">Confirmar importação</button>
        <button class="btn" id="imp_back2">Voltar</button>
        <button class="btn" id="imp_cancel3">Cancelar</button>
      </div>`;
    box.querySelectorAll('input[name=dupstrategy]').forEach(rd=> rd.onchange = ()=>{ strategy = rd.value; desenhar(); });
    document.getElementById('imp_cancel3').onclick = closeImportWizard;
    document.getElementById('imp_back2').onclick = renderImportStep2;
    document.getElementById('imp_confirm').onclick = (e)=>{
      if(candidates.length === 0){ toast('Nenhuma linha válida para importar.', 'err'); return; }
      e.target.disabled = true;   // um clique só: dois cliques criariam tudo em dobro
      const cont = aplicarImportacao(planejarImportacao(candidates, strategy), strategy);
      if(!anuncioPorId(state.selectedSkuId)){
        const primeiro = state.products.find(p=> p.listings.length);
        state.selectedSkuId = primeiro ? primeiro.listings[0].id : null;
      }
      saveState();
      closeImportWizard();
      renderProdutos();
      toast(`${cont.novosProdutos} produto(s) novo(s), ${cont.emExistentes} anúncio(s) juntados a produtos existentes, ${cont.atualizados} atualizado(s), ${cont.pulados} pulado(s).`, 'ok', 'Importação concluída');
      if(cont.conflitosDeCusto) toast(`${cont.conflitosDeCusto} produto(s) vieram com custos diferentes em linhas diferentes da planilha. Valeu o da última linha para todos os marketplaces do produto.`, 'warn', 'Custos divergentes na planilha');
      avisaSeHaRepetidos();
    };
  }
  desenhar();
}

function renderProdutos(){
  renderFilterOptions();
  renderMetrics();
  renderTable();
  renderReceiptPanel();
}

// ---------- MARKETPLACES VIEW ----------
const fieldDefs = [
  {key:'commission', label:'Comissão sobre o preço -- %'},
  {key:'service', label:'Taxa de serviço -- %'},
  {key:'transaction', label:'Taxa de transação -- %'}
];
const mktToggles = [
  {key:'tiered', label:'Taxas por faixa de preço',
   hint:'Quando o marketplace cobra percentuais e taxa fixa diferentes conforme o valor do produto (caso do TikTok Shop). Substitui os percentuais únicos acima.'},
  {key:'dualAdPrice', label:'Constar valor antes do anúncio',
   hint:'Mostra também o valor +40% (preço "de"), além do +20%.'},
  {key:'variableFreight', label:'Frete variável por produto',
   hint:'Libera o campo de frete no cadastro de cada produto.'},
  {key:'variableFixedFee', label:'Taxa fixa variável por anúncio',
   hint:'Quando a taxa fixa muda de anúncio para anúncio, sem seguir faixa de preço. Libera o campo de taxa fixa dentro de cada produto. Ignorado se as faixas de preço estiverem ligadas.'}
];

// Editor das faixas de preço de um marketplace. Cada faixa vale do "preço a partir de" até o
// início da faixa seguinte; a primeira sempre começa em zero, por isso o campo dela fica travado.
function tierEditorHtml(p){
  const tiers = (p.tiers && p.tiers.length) ? p.tiers : [{min:0, commission:0, service:0, transaction:0, fixedFee:0, serviceCap:0}];
  const cel = (i, campo, val, extra='') =>
    `<td><input type="number" step="0.01" data-tier="${i}" data-tf="${campo}" value="${esc(val)}" ${extra}></td>`;
  const linhas = tiers.map((t,i)=>{
    const max = tiers[i+1] ? Number(tiers[i+1].min)||0 : Infinity;
    const total = (Number(t.commission)||0)+(Number(t.service)||0)+(Number(t.transaction)||0);
    return `<tr>
      <td class="tcol-faixa">${i===0
        ? `<span class="tier-fixed">R$ 0,00</span><span class="tier-note">base</span>`
        : `<input type="number" step="0.01" data-tier="${i}" data-tf="min" data-reorder value="${esc(t.min)}">`}</td>
      ${cel(i,'commission',t.commission)}
      ${cel(i,'service',t.service)}
      ${cel(i,'serviceCap',t.serviceCap)}
      ${cel(i,'transaction',t.transaction)}
      ${cel(i,'fixedFee',t.fixedFee)}
      <td class="tcol-resumo">${FMT_ATE2.format(total)}% + ${brl(Number(t.fixedFee)||0)}
        <span class="tier-note">${tierRangeLabel(i===0 ? 0 : (Number(t.min)||0), max) || 'todos os preços'}</span></td>
      <td class="tcol-x"><button class="btn small danger" data-deltier="${i}" ${tiers.length<=1?'disabled':''} title="Remover faixa">&times;</button></td>
    </tr>`;
  }).join('');
  return `<div class="section-label">Faixas de preço</div>
    <p class="sub" style="margin:8px 0 10px;">Uma linha por faixa. Cada uma vale do preço indicado até o início da faixa seguinte, e o sistema escolhe sozinho qual usar -- inclusive quando você informa a margem e ele precisa descobrir o preço.</p>
    <div class="tablewrap">
      <table class="tier-table">
        <thead><tr>
          <th>A partir de</th><th>Comissão %</th><th>Serviço %</th>
          <th title="Valor máximo em R$ que a taxa de serviço pode cobrar por item. 0 = sem teto.">Teto R$</th>
          <th>Transaç. %</th><th>Fixa R$</th><th>Resulta em</th><th></th>
        </tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>
    <div class="form-actions" style="margin-top:10px;"><button class="btn small" data-addtier="${esc(p.id)}">+ Adicionar faixa</button></div>
    <div class="tier-sim" data-tiersim></div>`;
}

// Mostra o que o vendedor recebe em alguns preços, para a faixa certa ficar visível na hora
// de conferir as regras -- é como o dono do sistema validou os números do TikTok Shop.
function tierSimHtml(p){
  if(!p.tiered) return '';
  const pontos = [];
  (p.tiers||[]).forEach((t,i)=>{
    const min = i===0 ? 0 : (Number(t.min)||0);
    pontos.push(min > 0 ? min : 40);
    if(min > 0) pontos.push(min * 2);
  });
  const svc = (p.tiers||[]).find(t=>Number(t.serviceCap)>0);
  if(svc && Number(svc.service)>0) pontos.push(Math.ceil(Number(svc.serviceCap)/(Number(svc.service)/100)/10)*10 + 100);
  const unicos = Array.from(new Set(pontos.filter(v=>v>0))).sort((a,b)=>a-b).slice(0,6);
  const linhas = unicos.map(preco=>{
    const r = calcSku(p, {cogs:0, fixedCost:0, misc:0, taxPct:0, marketingPct:0, coupon:0, freightNet:0,
      mktFixedFee:0, mode:'price', price:preco, marginTarget:0, costOverride:true});
    return `<tr><td class="num">${brl(preco)}</td><td class="num neg">-${brl(r.feesTotal)}</td>
      <td class="num pos">${brl(r.netMarketplace)}</td><td style="color:var(--ink-mute);font-size:11px;">${esc(r.tierLabel||'faixa única')}${r.capBinds?' &middot; teto aplicado':''}</td></tr>`;
  }).join('');
  return `<div class="section-label" style="margin-top:14px;">Conferência rápida</div>
    <p class="sub" style="margin:8px 0 8px;">Quanto sobra na sua mão em cada preço, sem contar custos da empresa, cupom ou frete.</p>
    <table><thead><tr><th class="num">Preço</th><th class="num">Taxas</th><th class="num">Você recebe</th><th>Faixa</th></tr></thead><tbody>${linhas}</tbody></table>`;
}

// Atualiza só a coluna "Resulta em" da linha editada, sem redesenhar a tabela inteira --
// redesenhar tiraria o foco do campo no meio da digitação.
function atualizaResumoDaLinha(inp, p, i){
  const linha = inp.closest('tr');
  const alvo = linha && linha.querySelector('.tcol-resumo');
  if(!alvo) return;
  const t = p.tiers[i];
  const total = (Number(t.commission)||0)+(Number(t.service)||0)+(Number(t.transaction)||0);
  const max = p.tiers[i+1] ? Number(p.tiers[i+1].min)||0 : Infinity;
  alvo.innerHTML = `${FMT_ATE2.format(total)}% + ${brl(Number(t.fixedFee)||0)}
    <span class="tier-note">${tierRangeLabel(i===0 ? 0 : (Number(t.min)||0), max) || 'todos os preços'}</span>`;
}

function renderMarketplaces(){
  const box = document.getElementById('mktCards');
  const usos = new Map();
  listagens().forEach(s=> usos.set(s.marketplaceId, (usos.get(s.marketplaceId)||0) + 1));
  const usageCount = id => usos.get(id) || 0;
  box.innerHTML = state.profiles.map(p=>{
    const used = usageCount(p.id);
    return `<div class="card${p.tiered?' wide':''}" data-mktid="${esc(p.id)}">
      <div style="display:flex;align-items:center;gap:9px;margin-bottom:12px;">
        <span class="mkt-dot" style="background:${esc(p.color)};width:10px;height:10px;margin:0;"></span>
        <span class="confidence conf-${esc(p.confidence)}">${p.confidence==='alta'?'Verificado':(p.confidence==='media'?'Fontes de terceiros':'Não oficial')}</span>
        <span style="flex:1;"></span>
        <span style="font-size:10.5px;color:var(--ink-mute);">${used} anúncio(s)</span>
      </div>
      <div class="field textrow"><label>Nome do marketplace</label><input type="text" data-mf="label" value="${esc(p.label)}" style="width:100%;text-align:left;"></div>
      <div class="field"><label>ID do marketplace<span class="hint">Os SKUs deste marketplace terminam em <code>-${esc(p.id)}</code>, e é por esse final que o sistema junta os anúncios no mesmo produto.${p.idManual === false && !used ? ' Enquanto você não escrever um ID e o marketplace não tiver anúncios, ele acompanha o nome.' : ' Trocar aqui atualiza todos os anúncios dele.'}</span></label><input type="text" data-id-mkt value="${esc(p.id)}" spellcheck="false" style="width:170px;text-align:left;font-family:var(--mono);"></div>
      <div class="field"><label>Cor de identificação</label><input type="text" data-mf="color" value="${esc(p.color)}" style="width:110px;text-align:left;"></div>
      <div class="field"><label>Nível de confiança do dado</label>
        <select data-mf="confidence">
          <option value="alta" ${p.confidence==='alta'?'selected':''}>Alta -- verificado</option>
          <option value="media" ${p.confidence==='media'?'selected':''}>Média -- terceiros</option>
          <option value="baixa" ${p.confidence==='baixa'?'selected':''}>Baixa -- não oficial</option>
        </select>
      </div>
      <div class="field textrow"><label>Observação / fonte</label><textarea data-mf="note">${esc(p.note)}</textarea></div>
      <div data-flatrates style="${p.tiered?'display:none;':''}">
        ${fieldDefs.map(f=>`<div class="field"><label>${f.label}</label><input type="number" step="0.01" data-mf="${f.key}" value="${esc(p[f.key])}"></div>`).join('')}
        <div class="field" data-fixedfeerow style="${p.variableFixedFee?'display:none;':''}"><label>Taxa fixa por item -- R$</label><input type="number" step="0.01" data-mf="fixedFee" value="${esc(p.fixedFee)}"></div>
      </div>
      <div data-tierblock style="${p.tiered?'':'display:none;'}">${tierEditorHtml(p)}</div>
      <div class="section-label">Comportamento</div>
      ${mktToggles.map(t=>`
        <div class="field">
          <label>${t.label}<span class="hint">${t.hint}</span></label>
          <label class="switch"><input type="checkbox" data-mfcheck="${t.key}" ${p[t.key]?'checked':''}><span class="track"></span></label>
        </div>`).join('')}
      <div class="form-actions">
        <button class="btn danger small" data-delmkt="${esc(p.id)}" ${state.profiles.length<=1?'disabled':''}>Excluir marketplace</button>
      </div>
    </div>`;
  }).join('');

  box.querySelectorAll('[data-mktid]').forEach(card=>{
    const id = card.dataset.mktid;
    // ID: aplica ao sair do campo (ou Enter), não a cada tecla -- a troca leva junto todos os anúncios
    const inpId = card.querySelector('[data-id-mkt]');
    if(inpId){
      inpId.addEventListener('change', ()=> trocarIdMarketplace(id, inpId.value, inpId));
      inpId.addEventListener('keydown', e=>{ if(e.key === 'Enter'){ e.preventDefault(); inpId.blur(); } });
    }
    // marketplace novo, sem anúncios e sem ID escrito: o ID acompanha o nome
    const inpNome = card.querySelector('[data-mf="label"]');
    if(inpNome) inpNome.addEventListener('change', ()=>{
      const pr = profileOf(id);
      if(pr.idManual !== false || listagens().some(s=> s.marketplaceId === pr.id)) return;
      const novo = idUnico(idPeloNome(pr.label), pr);
      if(!novo || novo === pr.id) return;
      aplicarNovoIdMarketplace(pr, novo, false);
      saveState(); renderMarketplaces(); renderProdutos();
    });
    card.querySelectorAll('[data-mf]').forEach(inp=>{
      inp.addEventListener('input', ()=>{
        const p = profileOf(id);
        const key = inp.dataset.mf;
        p[key] = (key==='label' || key==='note' || key==='confidence' || key==='color') ? inp.value : (parseFloat(inp.value)||0);
        saveState();
        if(key==='color'){
          const dot = card.querySelector('.mkt-dot');
          if(dot) dot.style.background = p.color;
        }
      });
    });
    // ---- faixas de preço ----
    const simBox = card.querySelector('[data-tiersim]');
    const atualizaSim = ()=>{ if(simBox) simBox.innerHTML = tierSimHtml(profileOf(id)); };
    atualizaSim();
    card.querySelectorAll('[data-tf]').forEach(inp=>{
      const i = parseInt(inp.dataset.tier);
      inp.addEventListener('input', ()=>{
        const p = profileOf(id);
        if(!p.tiers[i]) return;
        p.tiers[i][inp.dataset.tf] = parseFloat(inp.value)||0;
        saveState();
        atualizaResumoDaLinha(inp, p, i);
        atualizaSim();
        recalcularCatalogo();
      });
      // reordenar a cada tecla faria o campo perder o foco no meio da digitação,
      // então a lista só é reordenada e redesenhada quando o campo perde o foco
      if(inp.hasAttribute('data-reorder')) inp.addEventListener('blur', ()=>{
        normalizeProfile(profileOf(id)); saveState(); renderMarketplaces(); renderProdutos();
      });
    });
    card.querySelectorAll('[data-deltier]').forEach(b=>{
      b.onclick = ()=>{
        const p = profileOf(id);
        if(p.tiers.length<=1) return;
        p.tiers.splice(parseInt(b.dataset.deltier), 1);
        saveState(); renderMarketplaces(); renderProdutos();
      };
    });
    const addTier = card.querySelector('[data-addtier]');
    if(addTier) addTier.onclick = ()=>{
      const p = profileOf(id);
      const ultima = p.tiers[p.tiers.length-1] || {min:0, commission:0, service:0, transaction:0, fixedFee:0, serviceCap:0};
      p.tiers.push(Object.assign({}, ultima, {min: (Number(ultima.min)||0) + 50}));
      saveState(); renderMarketplaces(); renderProdutos();
    };

    card.querySelectorAll('[data-mfcheck]').forEach(chk=>{
      chk.addEventListener('change', ()=>{
        const p = profileOf(id);
        p[chk.dataset.mfcheck] = chk.checked;
        if(chk.dataset.mfcheck === 'tiered'){
          if(chk.checked && (!p.tiers || p.tiers.length === 0)){
            // começa a partir das taxas únicas que já estavam lá, para o número não mudar sozinho
            p.tiers = [{min:0, commission:p.commission, service:p.service, transaction:p.transaction, fixedFee:p.fixedFee, serviceCap:0}];
          }
          saveState(); renderMarketplaces(); renderProdutos();
          return;
        }
        if(chk.dataset.mfcheck === 'variableFixedFee'){
          const row = card.querySelector('[data-fixedfeerow]');
          if(row) row.style.display = chk.checked ? 'none' : 'flex';
          if(chk.checked){
            // primeira vez que liga: semeia cada produto com o valor único que valia antes,
            // para nenhum produto passar a calcular com taxa fixa zerada sem o usuário perceber
            let semeados = 0;
            state.products.forEach(prod=> prod.listings.forEach(s=>{
              if(s.marketplaceId===id && !Number(s.mktFixedFee)){ s.mktFixedFee = Number(p.fixedFee)||0; semeados++; }
            }));
            if(semeados && p.fixedFee) toast(`${semeados} produto(s) deste marketplace começaram com ${brl(p.fixedFee)} de taxa fixa. Ajuste um a um no formulário do produto.`, 'warn', 'Taxa fixa agora é por produto');
          }
        }
        saveState();
        renderProdutos();
      });
    });
  });
  box.querySelectorAll('[data-delmkt]').forEach(b=>{
    b.onclick = ()=>{
      if(state.profiles.length<=1) return;
      const id = b.dataset.delmkt;
      const orfaos = listagens().filter(s=>s.marketplaceId===id).length;
      const aviso = orfaos
        ? `\n\nATENÇÃO: ${orfaos} anúncio(s) estão cadastrados nele e ficarão órfãos -- vão aparecer marcados como "marketplace removido" e sem cálculo válido até você reatribuí-los.`
        : '';
      if(!confirm('Excluir o marketplace "' + profileOf(id).label + '"?' + aviso)) return;
      state.profiles = state.profiles.filter(p=>p.id!==id);
      saveState();
      renderMarketplaces();
      renderProdutos();
      toast('Marketplace excluído.', 'ok');
    };
  });
}
function adicionarMarketplace(presetKey){
  const palette = ['#c9a24a','#5dcaa5','#7f77dd','#d4537e','#3f9ee0','#e09f27'];
  const preset = PRESETS.find(x=>x.key===presetKey) || PRESETS[PRESETS.length-1];
  const base = JSON.parse(JSON.stringify(preset.data));   // cópia: faixas não podem compartilhar a lista do modelo
  const idNovo = idUnico(idPeloNome(base.label)) || idUnico('marketplace');
  if(state.profiles.some(p=> p.label.toLowerCase() === String(base.label).toLowerCase())){
    if(!confirm(`Já existe um marketplace chamado "${base.label}". Adicionar outro assim mesmo?\n\nO novo vai ganhar o ID "${idNovo}" (você pode trocar no cartão dele).`)) return;
  }
  const p = Object.assign({
    id: idNovo, uid: novoId(), idManual: false, color: palette[state.profiles.length % palette.length],
    dualAdPrice:false, variableFreight:false, variableFixedFee:false, tiered:false, tiers:[]
  }, base);
  normalizeProfile(p);
  state.profiles.push(p);
  saveState();
  renderMarketplaces();
  renderProdutos();
  toast(`"${p.label}" adicionado. Confira as taxas antes de usar.`, 'ok');
  const card = document.querySelector(`[data-mktid="${p.id}"]`);
  if(card) card.scrollIntoView({block:'center', behavior:'smooth'});
}
// ---------- PADRÕES VIEW ----------
function renderPadroes(){
  document.getElementById('pFixedCost').value = state.padroes.fixedCost;
  document.getElementById('pMisc').value = state.padroes.misc;
  document.getElementById('pTax').value = state.padroes.taxPct;
  document.getElementById('pMarketing').value = state.padroes.marketingPct;
  document.getElementById('pCoupon').value = state.padroes.coupon;
  document.getElementById('pFreight').value = state.padroes.freightNet;
  renderPadroesImpact();
}
function renderPadroesImpact(){
  const el = document.getElementById('padroesImpact');
  if(!el) return;
  const congelados = state.products.filter(s=>s.costOverride).length;
  const vinculados = state.products.length - congelados;
  el.innerHTML = `<strong>${vinculados}</strong> produto(s) acompanham estes valores em tempo real`
    + (congelados ? ` &middot; <strong style="color:var(--warn);">${congelados}</strong> estão congelados com custo próprio e não mudam daqui.` : '.');
}
['pFixedCost','pMisc','pTax','pMarketing','pCoupon','pFreight'].forEach(id=>{
  document.getElementById(id).addEventListener('input', ()=>{
    state.padroes.fixedCost = parseFloat(document.getElementById('pFixedCost').value)||0;
    state.padroes.misc = parseFloat(document.getElementById('pMisc').value)||0;
    state.padroes.taxPct = parseFloat(document.getElementById('pTax').value)||0;
    state.padroes.marketingPct = parseFloat(document.getElementById('pMarketing').value)||0;
    state.padroes.coupon = parseFloat(document.getElementById('pCoupon').value)||0;
    state.padroes.freightNet = parseFloat(document.getElementById('pFreight').value)||0;
    saveState();
    // os custos da empresa são vinculados ao vivo, mas redesenhar o catálogo a cada tecla
    // é trabalho jogado fora: espera a digitação parar
    recalcularCatalogo();
    renderPadroesImpact();
  });
});
document.getElementById('exportBtn').onclick = ()=>{
  const blob = new Blob([JSON.stringify(state, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'precificacao-backup.json';
  a.click();
  URL.revokeObjectURL(url);
};
document.getElementById('importBtn').onclick = ()=> document.getElementById('importFile').click();
// Restaurar um backup troca o catálogo inteiro da empresa, para todo mundo: só o dono (ou o
// administrador) pode, e com confirmação. A gravação é a de sempre (só o que difere do banco), e
// cada alteração fica no histórico.
document.getElementById('importFile').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  e.target.value = '';
  if(!file) return;
  if(!podeGerenciarEquipe()){ toast('Só o dono da empresa (ou o administrador) restaura um backup.', 'err'); return; }
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const parsed = normalizeState(JSON.parse(reader.result));
      if(!parsed) throw new Error('formato inválido -- o arquivo precisa ter as listas de marketplaces e produtos');
      if(!confirm(`Restaurar este backup troca TODO o catálogo de "${empresa.nome}" pelo do arquivo (${parsed.products.length} produto(s), ${parsed.profiles.length} marketplace(s)), para todas as pessoas da empresa. O que não estiver no arquivo será excluído. Tudo fica registrado no histórico.\n\nContinuar?`)) return;
      aplicarDados(dadosDe(parsed));
      saveState();
      toast('Backup restaurado. Gravando no banco...', 'ok');
    }catch(err){
      toast(err.message, 'err', 'Não foi possível importar o backup');
    }
  };
  reader.readAsText(file);
});


// ---------- unificação de produtos repetidos ----------
// Antes, produtos com o mesmo SKU base mas custo diferente (um centavo que fosse) eram deixados
// de fora sem aviso. Agora a análise separa três situações e mostra todas:
//   juntar com custo igual     -> marcado para juntar, nenhum número muda
//   juntar com custo diferente -> desmarcado; o usuário escolhe qual custo fica
//   não dá para juntar         -> os dois já têm anúncio no mesmo marketplace (motivo explícito)
function chaveDeCusto(pr){
  return pr.costOverride ? ['1', pr.cogs, pr.fixedCost, pr.misc, pr.taxPct, pr.marketingPct].join('|') : '0|' + pr.cogs;
}
function descreveCusto(pr){
  return brl(pr.cogs) + (pr.costOverride ? ' + custos destravados' : '');
}

function analiseDeUnificacao(){
  const grupos = new Map();
  state.products.forEach(p=>{
    const b = baseDoSku(p.sku), k = b.toLowerCase();
    if(!grupos.has(k)) grupos.set(k, {base: b, produtos: []});
    grupos.get(k).produtos.push(p);
  });
  const juntar = [], bloqueados = [], skusDeProduto = [];
  grupos.forEach(g=>{
    if(g.produtos.length === 1){
      if(g.produtos[0].sku !== g.base) skusDeProduto.push({prod: g.produtos[0], base: g.base});
      return;
    }
    // o produto com mais anúncios vira o destino; os outros entram se não repetirem marketplace
    const ordem = g.produtos.slice().sort((a,b)=> b.listings.length - a.listings.length);
    const destinos = [];
    ordem.forEach(p=>{
      const d = destinos.find(x=> !p.listings.some(l=> x.mids.has(l.marketplaceId)));
      if(d){ d.produtos.push(p); p.listings.forEach(l=> d.mids.add(l.marketplaceId)); }
      else destinos.push({produtos: [p], mids: new Set(p.listings.map(l=> l.marketplaceId))});
    });
    destinos.forEach(d=>{
      if(d.produtos.length > 1) juntar.push({base: g.base, produtos: d.produtos,
        custoIgual: new Set(d.produtos.map(chaveDeCusto)).size === 1});
    });
    destinos.slice(1).forEach(d=> d.produtos.forEach(p=>{
      const repetidos = p.listings.map(l=> l.marketplaceId).filter(m=> destinos[0].mids.has(m));
      bloqueados.push({base: g.base, prod: p, com: destinos[0].produtos[0], repetidos});
    }));
  });
  juntar.sort((a,b)=> (b.custoIgual - a.custoIgual) || a.base.localeCompare(b.base));
  return {juntar, bloqueados, skusDeProduto};
}

function aplicarRevisao(an, escolhas){
  const removidos = new Set();
  let anunciosComCustoNovo = 0;
  an.juntar.forEach((g, i)=>{
    if(!escolhas.juntar.has(i)) return;
    const destino = g.produtos[0];
    const fonte = g.produtos.find(p=> p.id === escolhas.custo.get(i)) || destino;
    g.produtos.forEach(p=>{ if(chaveDeCusto(p) !== chaveDeCusto(fonte)) anunciosComCustoNovo += p.listings.length; });
    ['cogs','costOverride','fixedCost','misc','taxPct','marketingPct'].forEach(k=> destino[k] = fonte[k]);
    destino.sku = g.base;
    g.produtos.slice(1).forEach(p=>{ destino.listings.push(...p.listings); removidos.add(p.id); });
  });
  let produtos = 0;
  an.skusDeProduto.forEach((x, i)=>{ if(escolhas.skuProd.has(i) && !removidos.has(x.prod.id)){ x.prod.sku = x.base; produtos++; } });
  state.products = state.products.filter(p=> !removidos.has(p.id));
  return {juntados: removidos.size, anunciosComCustoNovo, produtos};
}

function closeUnifyWizard(){
  const box = document.getElementById('unifyWizard');
  box.style.display = 'none';
  box.innerHTML = '';
  if(!wizardVisivel()) fecharPainel();
}

function unificarProdutosRepetidos(){
  closeSkuForm(); closeImportWizard(); closeExportWizard();
  const an = analiseDeUnificacao();
  const box = document.getElementById('unifyWizard');
  box.style.display = 'block';
  abrirPainel('Unificar produtos', 'Produtos com o mesmo SKU base. Confira e marque o que juntar; nada muda até você aplicar.');
  const nada = !an.juntar.length && !an.skusDeProduto.length && !an.bloqueados.length;
  if(nada){
    box.innerHTML = `<p class="sub">Nenhum produto repetido: cada SKU base (o SKU sem o "-ID" do marketplace no final) já está num produto só.</p>
      <div class="form-actions"><button class="btn" id="uni_fechar">Fechar</button></div>`;
    document.getElementById('uni_fechar').onclick = closeUnifyWizard;
    return;
  }
  const chips = p=> p.listings.map(l=>{ const pr = profileOf(l.marketplaceId);
    return `<span class="uni-chip"><span class="mkt-dot" style="background:${esc(pr.color)}"></span>${esc(pr.label)}</span>`; }).join('');
  const grupoHtml = (g, i)=>`<div class="uni-grupo${g.custoIgual?'':' uni-atencao'}">
      <label class="uni-head"><input type="checkbox" data-jun="${i}" checked>
        <span><b class="mono">${esc(g.base)}</b> &mdash; ${g.produtos.length} produtos viram 1</span>
        ${g.custoIgual ? '' : '<span class="tag">custo diferente</span>'}</label>
      ${g.produtos.map((p, j)=>`<div class="uni-prod">
          ${g.custoIgual ? '' : `<input type="radio" name="uni-custo-${i}" value="${esc(p.id)}" ${j===0?'checked':''} title="Usar o custo deste produto">`}
          <span class="mono">${esc(p.sku)}</span><span class="uni-chips">${chips(p)}</span><span class="uni-custo">${descreveCusto(p)}</span>
        </div>`).join('')}
      ${g.custoIgual ? '' : `<p class="hint" style="margin:6px 0 0;">Os custos são diferentes. Marque o custo que fica: os anúncios dos outros produtos passam a usá-lo, e o preço ou a margem deles muda.</p>`}
    </div>`;
  const iguais = an.juntar.map((g,i)=> g.custoIgual ? grupoHtml(g,i) : '').join('');
  const diferentes = an.juntar.map((g,i)=> g.custoIgual ? '' : grupoHtml(g,i)).join('');
  box.innerHTML = `
    <p class="sub" style="margin:0 0 6px;">Juntados pelo SKU sem o final <code>-ID</code> do marketplace. IDs cadastrados: ${idsDosMarketplaces(state.profiles).map(x=> '<code>' + esc(x) + '</code>').join(' ')}.</p>
    ${iguais ? `<div class="section-label">Mesmo SKU base, mesmo custo (nenhum número muda)</div>${iguais}` : ''}
    ${diferentes ? `<div class="section-label">Mesmo SKU base, custo diferente &mdash; confira qual custo fica</div>${diferentes}` : ''}
    ${an.skusDeProduto.length ? `<div class="section-label">SKU do produto com sufixo de marketplace</div>
      ${an.skusDeProduto.map((x,i)=>`<label class="uni-linha"><input type="checkbox" data-skuprod="${i}" checked>
        <span class="mono">${esc(x.prod.sku)}</span> &rarr; <span class="mono">${esc(x.base)}</span></label>`).join('')}` : ''}
    ${an.bloqueados.length ? `<div class="section-label">Não dá para juntar</div>
      ${an.bloqueados.map(x=>`<div class="uni-linha muted"><span class="mono">${esc(x.prod.sku)}</span>
        e <span class="mono">${esc(x.com.sku)}</span> já têm anúncio em ${x.repetidos.map(m=> esc(profileOf(m).label)).join(', ')}.
        Se forem o mesmo item, exclua o anúncio repetido e rode de novo.</div>`).join('')}` : ''}
    <div class="form-actions">
      <button class="btn primary" id="uni_aplicar">Aplicar</button>
      <button class="btn" id="uni_cancelar">Cancelar</button>
      <span class="muted" id="uni_resumo" style="font-size:12px;"></span>
    </div>`;
  const resumo = ()=>{
    const j = [...box.querySelectorAll('[data-jun]:checked')].reduce((a,el)=> a + an.juntar[+el.dataset.jun].produtos.length - 1, 0);
    const c = box.querySelectorAll('[data-skuprod]:checked').length;
    document.getElementById('uni_resumo').textContent = `${j} produto(s) serão juntados, ${c} SKU(s) corrigidos.`;
  };
  box.querySelectorAll('input').forEach(el=> el.addEventListener('change', resumo));
  resumo();
  document.getElementById('uni_cancelar').onclick = closeUnifyWizard;
  document.getElementById('uni_aplicar').onclick = (e)=>{
    const escolhas = {
      juntar: new Set([...box.querySelectorAll('[data-jun]:checked')].map(el=> +el.dataset.jun)),
      custo: new Map(an.juntar.map((g,i)=> [i, (box.querySelector(`input[name="uni-custo-${i}"]:checked`)||{}).value])),
      skuProd: new Set([...box.querySelectorAll('[data-skuprod]:checked')].map(el=> +el.dataset.skuprod))
    };
    if(!escolhas.juntar.size && !escolhas.skuProd.size){ toast('Nada marcado para aplicar.', 'warn'); return; }
    e.target.disabled = true;
    const res = aplicarRevisao(an, escolhas);
    if(!anuncioPorId(state.selectedSkuId)){
      const primeiro = state.products.find(p=> p.listings.length);
      state.selectedSkuId = primeiro ? primeiro.listings[0].id : null;
    }
    saveState();
    closeUnifyWizard();
    renderProdutos();
    toast(`${res.juntados} produto(s) juntados, ${res.produtos} SKU(s) de produto corrigidos.`
      + (res.anunciosComCustoNovo ? ` ${res.anunciosComCustoNovo} anúncio(s) passaram a usar o custo escolhido.` : ' Nenhum preço mudou.'), 'ok', 'Catálogo unificado');
  };
}

// Depois de importar (e uma vez ao abrir), avisa se há produtos com o mesmo SKU base separados.
let avisouRepetidosNaSessao = false;
function avisaSeHaRepetidos(){
  const an = analiseDeUnificacao();
  const n = an.juntar.reduce((a,g)=> a + g.produtos.length - 1, 0);
  if(!n) return;
  avisouRepetidosNaSessao = true;
  toast(`${n} produto(s) têm o mesmo SKU base de outro e estão separados. Veja em Planilhas e catálogo → Unificar produtos repetidos.`, 'warn', 'Possíveis repetidos');
}

// ---------- equipe (dono e administrador) ----------
const PAPEIS = {dono: 'Dono', editor: 'Editor', leitor: 'Leitor'};
function podeGerenciarEquipe(){ return papel === 'dono' || papel === 'admin'; }

async function renderEquipe(){
  const tab = document.getElementById('tabelaEquipe');
  if(!podeGerenciarEquipe()){ tab.innerHTML = '<p class="sub" style="padding:16px;">Só o dono da empresa (ou o administrador) gerencia a equipe.</p>'; return; }
  tab.innerHTML = '<p class="sub" style="padding:16px;">Carregando...</p>';
  let equipe;
  try{ equipe = await V2.listarEquipe(empresa.id); }
  catch(err){ tab.innerHTML = `<p class="neg" style="padding:16px;">${esc(err.message)}</p>`; return; }
  if(!equipe.length){ tab.innerHTML = '<p class="sub" style="padding:16px;">Ninguém na equipe ainda. Inclua o dono da empresa acima.</p>'; return; }
  const quando = t=> t ? dataHora(t) : 'nunca entrou';
  tab.innerHTML = `<table class="v2-equipe">
    <thead><tr><th>Nome</th><th class="col-email">E-mail</th><th>Papel</th><th class="col-acesso">Último acesso</th><th></th></tr></thead>
    <tbody>${equipe.map(m=> `<tr data-user="${esc(m.user_id)}" data-nome="${esc(m.nome)}" data-email="${esc(m.email)}" data-papel="${esc(m.papel)}" data-eu="${m.sou_eu ? 1 : 0}">
      <td>${esc(m.nome)}${m.sou_eu ? ' <span class="muted">(você)</span>' : ''}</td>
      <td class="col-email">${esc(m.email)}</td>
      <td><select data-acao="papel" aria-label="Papel de ${esc(m.nome)}">${Object.entries(PAPEIS).map(([v, r])=> `<option value="${v}"${v === m.papel ? ' selected' : ''}>${r}</option>`).join('')}</select></td>
      <td class="col-acesso muted">${esc(quando(m.ultimo_acesso))}</td>
      <td class="acoes">${m.pode_redefinir ? '<button class="btn small" type="button" data-acao="senha">Senha nova</button>' : ''}<button class="btn small danger" type="button" data-acao="tirar">Tirar</button></td>
    </tr>`).join('')}</tbody></table>`;
}

// Dados de acesso mostrados UMA vez, com "Copiar tudo" pronto para mandar à pessoa.
function mostrarCredencial(titulo, email, senha){
  const endereco = location.origin + location.pathname.replace(/[^/]*$/, '');
  const texto = `Acesso ao sistema de precificação\nEndereço: ${endereco}\nE-mail: ${email}\nSenha provisória: ${senha}\nNo primeiro acesso, o sistema pede para você criar a sua própria senha.`;
  const box = document.getElementById('credencial');
  box.innerHTML = `<div class="v2-credencial">
    <b>${esc(titulo)}</b> Passe estes dados para a pessoa. A senha não aparece de novo.
    <dl><dt>Endereço</dt><dd>${esc(endereco)}</dd><dt>E-mail</dt><dd>${esc(email)}</dd><dt>Senha provisória</dt><dd>${esc(senha)}</dd></dl>
    <button class="btn small" type="button" id="btnCopiarCredencial">Copiar tudo</button>
    <p class="sub">No primeiro acesso o sistema pede para ela criar uma senha própria.</p></div>`;
  document.getElementById('btnCopiarCredencial').onclick = async ()=>{
    try{ await navigator.clipboard.writeText(texto); document.getElementById('btnCopiarCredencial').textContent = 'Copiado'; }
    catch(_){ prompt('Copie os dados abaixo:', texto.replace(/\n/g, ' | ')); }
  };
  box.scrollIntoView({behavior: 'smooth', block: 'nearest'});
}

function ligarEquipe(){
  document.getElementById('formIncluir').onsubmit = async (e)=>{
    e.preventDefault();
    const botao = document.getElementById('btnIncluir');
    const nome = document.getElementById('novoNome').value.trim(), email = document.getElementById('novoEmail').value.trim();
    const pap = document.getElementById('novoPapel').value;
    document.getElementById('erroIncluir').textContent = '';
    document.getElementById('credencial').innerHTML = '';
    botao.disabled = true; botao.textContent = 'Incluindo...';
    try{
      const r = await V2.incluirNaEquipe(empresa.id, {nome, email, papel: pap});
      if(r.conta_nova) mostrarCredencial(`${nome} foi incluído(a) como ${PAPEIS[pap].toLowerCase()}.`, r.email, r.senha_provisoria);
      else document.getElementById('credencial').innerHTML = `<div class="v2-credencial"><b>${esc(nome)} foi incluído(a) como ${esc(PAPEIS[pap].toLowerCase())}.</b> Essa pessoa já tinha conta: ela entra com o e-mail <b>${esc(r.email)}</b> e a senha que já usa.</div>`;
      document.getElementById('formIncluir').reset();
      await renderEquipe();
    }catch(err){ document.getElementById('erroIncluir').textContent = err.message; }
    finally{ botao.disabled = false; botao.textContent = 'Incluir'; }
  };
  const tab = document.getElementById('tabelaEquipe');
  tab.addEventListener('change', async (e)=>{
    const sel = e.target.closest('select[data-acao="papel"]');
    if(!sel) return;
    const tr = sel.closest('tr'), novo = sel.value;
    const aviso = tr.dataset.eu === '1' && tr.dataset.papel === 'dono' && novo !== 'dono'
      ? 'Você vai deixar de ser dono e não verá mais esta tela. Continuar?' : `Mudar ${tr.dataset.nome} para ${PAPEIS[novo]}?`;
    if(!confirm(aviso)){ sel.value = tr.dataset.papel; return; }
    sel.disabled = true;
    try{
      await V2.alterarPapel(empresa.id, tr.dataset.user, novo);
      if(tr.dataset.eu === '1'){ location.reload(); return; }   // o próprio acesso mudou: recomeça
      await renderEquipe();
    }catch(err){ alert(err.message); sel.value = tr.dataset.papel; sel.disabled = false; }
  });
  tab.addEventListener('click', async (e)=>{
    const b = e.target.closest('button[data-acao]');
    if(!b) return;
    const tr = b.closest('tr');
    if(b.dataset.acao === 'senha'){
      if(!confirm(`Gerar uma senha provisória nova para ${tr.dataset.nome}? A senha atual deixa de funcionar e a pessoa sai de todos os aparelhos em até 1 hora.`)) return;
      b.disabled = true;
      try{ const r = await V2.gerarSenhaProvisoria(tr.dataset.user); mostrarCredencial(`Senha nova de ${tr.dataset.nome}.`, tr.dataset.email, r.senha_provisoria); }
      catch(err){ alert(err.message); }
      finally{ b.disabled = false; }
    }
    if(b.dataset.acao === 'tirar'){
      const eu = tr.dataset.eu === '1';
      if(!confirm(eu ? 'Tirar VOCÊ desta empresa? Você perde o acesso a ela na hora.'
                     : `Tirar ${tr.dataset.nome} da equipe? A pessoa perde o acesso a esta empresa na hora (a conta dela continua existindo).`)) return;
      b.disabled = true;
      try{
        await V2.removerDaEquipe(empresa.id, tr.dataset.user);
        if(eu){ V2.esquecerEmpresa(); location.reload(); return; }
        await renderEquipe();
      }catch(err){ alert(err.message); b.disabled = false; }
    }
  });
}

// ---------- minha conta ----------
function renderConta(){
  document.getElementById('meuNome').value = usuario;
  document.getElementById('contaEmail').value = V2.email || '';
  document.getElementById('senhaNova').value = ''; document.getElementById('senhaRepete').value = '';
  const m = document.getElementById('msgConta'); m.textContent = ''; m.className = '';
}
function avisoConta(texto, ok){ const m = document.getElementById('msgConta'); m.textContent = texto; m.className = ok ? 'pos' : 'neg'; }
function ligarConta(){
  document.getElementById('formSenha').onsubmit = async (e)=>{
    e.preventDefault();
    const s = document.getElementById('senhaNova').value;
    if(s.length < 8) return avisoConta('A senha precisa ter pelo menos 8 caracteres.');
    if(s !== document.getElementById('senhaRepete').value) return avisoConta('As duas senhas não são iguais.');
    try{ await V2.trocarMinhaSenha(s); document.getElementById('senhaNova').value = ''; document.getElementById('senhaRepete').value = ''; avisoConta('Senha trocada.', true); }
    catch(err){ avisoConta(err.message); }
  };
  document.getElementById('formNome').onsubmit = async (e)=>{
    e.preventDefault();
    const nome = document.getElementById('meuNome').value.trim();
    try{ await V2.alterarMeuNome(nome); usuario = nome; renderUsuario(); avisoConta('Nome salvo. As próximas alterações aparecem com ele no histórico.', true); }
    catch(err){ avisoConta(err.message); }
  };
}

function renderStorageNote(){
  document.getElementById('storageNote').textContent =
    'Os dados ficam no banco de dados, com histórico de cada alteração. Este navegador guarda só um rascunho do que ainda não foi enviado.';
}

// ---------- início ----------
// Chamado por js/inicio.js depois do login e da escolha da empresa, com a empresa inteira já lida.
async function iniciarSistema(b){
  empresa = b.empresa; papel = b.papel; meuId = b.usuario.id; usuario = b.usuario.nome;
  podeEditar = papel === 'admin' || papel === 'dono' || papel === 'editor';
  document.body.classList.toggle('somente-leitura', !podeEditar);
  CONFLITOS_KEY = 'precificacao_v2_conflitos:' + empresa.id;
  try{ conflitosRecentes = JSON.parse(store.get(CONFLITOS_KEY) || '[]') || []; }catch(e){ conflitosRecentes = []; }
  base = {linhas: linhasComoMapas(b.linhas), cache: {}};

  // Rascunho de uma sessão anterior que não chegou ao banco: junta com o que está lá agora.
  let dados = dadosDaBase(), rascunho = null;
  if(podeEditar){
    rascunho = await idb.get(chaveDoRascunho());
    if(rascunho && rascunho.local && rascunho.base){
      const antes = dadosDasLinhas(linhasComoMapas(rascunho.base));
      const r = mesclar(antes, rascunho.local, dadosDaBase());
      rascunho.conflitos = r.conflitos;
      rascunho.entidades = [entidades(antes), entidades(rascunho.local), entidades(dadosDaBase())];
      dados = r.dados;
    } else rascunho = null;
  }
  // empresa nova, sem marketplace nenhum: começa com os de fábrica, como a v1 (quem pode editar)
  state = normalizeState(Object.assign(JSON.parse(JSON.stringify(dados)),
    {selectedSkuId: store.get(STORAGE_KEY + ':sel:' + empresa.id) || null}), !podeEditar);
  versaoDados++;

  document.getElementById('empresaNome').textContent = empresa.nome;
  document.querySelectorAll('[data-so-gerente]').forEach(el=> el.hidden = !podeGerenciarEquipe());
  document.querySelectorAll('[data-so-admin]').forEach(el=> el.hidden = !b.admin);
  renderTopDisclaimer();
  renderStorageNote();
  renderUsuario();
  renderSyncPill();
  ligarEquipe();
  ligarConta();
  irPara('produtos');
  avisaMigracao();
  if(rascunho && rascunho.conflitos.length) registrarConflitos(rascunho.conflitos, ...rascunho.entidades);
  if(rascunho && temPendencia())
    toast('Havia alterações feitas neste navegador que não tinham chegado ao banco. Elas foram juntadas com o que está lá e estão sendo enviadas.', 'warn', 'Rascunho recuperado');
  if(temPendencia()) scheduleSync();
  else idb.del(chaveDoRascunho());
  setTimeout(()=>{ if(!avisouRepetidosNaSessao) avisaSeHaRepetidos(); }, 1200);
  try{ await V2.abrirCanal(empresa.id, aoAvisoDoBanco, aoStatusDoCanal); }
  catch(err){ console.warn('Aviso em tempo real indisponível agora.', err); }
}

// Aba que ficou escondida por um tempo: relê tudo (rede de segurança, caso algum aviso tenha se
// perdido no caminho).
let escondidaDesde = null;
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'hidden'){ escondidaDesde = Date.now(); return; }
  if(base && escondidaDesde && Date.now() - escondidaDesde > 60000) relerTudo();
  escondidaDesde = null;
});
// Fechar a aba com alteração ainda não enviada: o navegador pergunta. (Se fechar mesmo assim, o
// rascunho fica guardado aqui e vai para o banco na próxima vez que o sistema abrir.)
window.addEventListener('beforeunload', (e)=>{
  if(base && podeEditar && (syncOcupado() || temPendencia())){ e.preventDefault(); e.returnValue = ''; }
});
document.getElementById('usuarioBtn').onclick = ()=> irPara('conta');
document.getElementById('historicoBusca').addEventListener('input', debounce(renderHistorico, 150));
document.getElementById('conflitosLista').addEventListener('click', (e)=>{
  const usar = e.target.closest('[data-usar]'), visto = e.target.closest('[data-visto]');
  if(usar) usarValorDeles(Number(usar.dataset.usar));
  else if(visto){
    conflitosRecentes.splice(Number(visto.dataset.visto), 1);
    store.set(CONFLITOS_KEY, JSON.stringify(conflitosRecentes));
    renderConflitos();
  }
});
document.getElementById('conflitosLimpar').onclick = ()=>{
  conflitosRecentes = [];
  store.set(CONFLITOS_KEY, '[]');
  renderConflitos();
};
