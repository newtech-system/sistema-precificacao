// ============================================================================
// Tradução entre o banco e o formato da v1.
//
// A tela da v2 é a da v1 (js/sistema.js) e trabalha com o mesmo "estado" dela: marketplaces,
// produtos com anúncios dentro, e os custos da empresa. Este arquivo converte as linhas do banco
// nesse estado e de volta, campo por campo. É a MESMA tradução usada pela tela e pela conferência
// da migração: se as duas usassem regras diferentes, a conferência poderia aprovar algo que a tela
// mostra diferente.
//
// Nada aqui fala com o banco: são funções puras, testáveis sem internet.
// ============================================================================

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------- campos: v1 <-> banco
// [campo na v1, coluna no banco, tipo]
export const CAMPOS_MARKETPLACE = [
  ['id', 'codigo', 'txt'], ['label', 'nome', 'txt'], ['color', 'cor', 'txt'], ['confidence', 'confianca', 'txt'],
  ['note', 'observacao', 'txt'], ['commission', 'comissao', 'num'], ['service', 'servico', 'num'],
  ['transaction', 'transacao', 'num'], ['fixedFee', 'taxa_fixa', 'num'], ['dualAdPrice', 'preco_anuncio_duplo', 'bool'],
  ['variableFreight', 'frete_variavel', 'bool'], ['variableFixedFee', 'taxa_fixa_variavel', 'bool'],
  ['tiered', 'por_faixa', 'bool'], ['tiers', 'faixas', 'lista'], ['ehMercadoLivre', 'e_mercado_livre', 'bool'],
  ['idManual', 'id_manual', 'bool']
];
export const CAMPOS_PRODUTO = [
  ['sku', 'sku', 'txt'], ['name', 'nome', 'txt'], ['cogs', 'custo', 'num'], ['costOverride', 'custo_proprio', 'bool'],
  ['fixedCost', 'custo_fixo', 'num'], ['misc', 'outros_custos', 'num'], ['taxPct', 'imposto_pct', 'num'],
  ['marketingPct', 'marketing_pct', 'num']
];
export const CAMPOS_ANUNCIO = [
  ['sku', 'sku', 'txt'], ['mode', 'modo', 'modo'], ['price', 'preco', 'num'], ['marginTarget', 'margem_alvo', 'num'],
  ['coupon', 'cupom', 'num'], ['freightNet', 'frete_liquido', 'num'], ['mktFixedFee', 'taxa_fixa_anuncio', 'num']
];
export const CAMPOS_ML = [
  ['mlItemId', 'item_id', 'txt'], ['mlVarId', 'variacao_id', 'txt'], ['mlTitulo', 'titulo', 'txt'], ['mlTipo', 'tipo', 'txt'],
  ['mlSituacao', 'situacao', 'txt'], ['mlCategoria', 'categoria', 'txt'], ['mlPreco', 'preco_ml', 'num'],
  ['mlUsar', 'usar_taxas', 'bool'], ['mlFaixas', 'faixas_taxa', 'lista'], ['mlAtualizadoEm', 'taxas_em', 'data'],
  ['mlUsarFrete', 'usar_envio', 'bool'], ['mlFreteFaixas', 'faixas_envio', 'lista'], ['mlFreteGratis', 'frete_gratis', 'bool'],
  ['mlFreteOutra', 'envio_outra_opcao', 'num'], ['mlLogistica', 'logistica', 'txt'], ['mlFreteEm', 'envio_em', 'data'],
  ['mlConfEm', 'conf_em', 'data'], ['mlConfPreco', 'conf_preco', 'numnulo'], ['mlConfTaxa', 'conf_taxa', 'numnulo'],
  ['mlConfEnvio', 'conf_envio', 'numnulo'], ['mlConfErro', 'conf_erro', 'txt'], ['mlPct', 'ml_pct', 'num'],
  ['mlFixo', 'ml_fixo', 'num'], ['mlFrete', 'ml_frete', 'num']
];
export const CAMPOS_PADROES = [
  ['fixedCost', 'custo_fixo', 'num'], ['misc', 'outros_custos', 'num'], ['taxPct', 'imposto_pct', 'num'],
  ['marketingPct', 'marketing_pct', 'num'], ['coupon', 'cupom_padrao', 'num'], ['freightNet', 'frete_padrao', 'num']
];

// Data do banco (com microssegundos e fuso) -> texto ISO da v1 (milissegundos, Z). Assim a mesma
// data tem sempre o mesmo texto, venha do banco ou da tela, e não parece "alterada" à toa.
export function isoOuVazio(v){
  if(v === null || v === undefined || v === '') return '';
  const d = new Date(v);
  return isNaN(d) ? '' : d.toISOString();
}

// banco -> v1
function paraV1(tipo, v){
  if(tipo === 'num') return Number(v) || 0;
  if(tipo === 'numnulo') return (v === null || v === undefined) ? 0 : (Number(v) || 0);
  if(tipo === 'bool') return v === true;
  if(tipo === 'lista') return Array.isArray(v) ? v : [];
  if(tipo === 'data') return isoOuVazio(v);
  if(tipo === 'modo') return v === 'margem' ? 'margin' : 'price';
  return (v === null || v === undefined) ? '' : String(v);
}
// v1 -> banco
function paraBanco(tipo, v, dono){
  if(tipo === 'num') return Number(v) || 0;
  // a conferência só vale junto com a data dela: sem data, fica vazio no banco (como na importação)
  if(tipo === 'numnulo') return dono && dono.mlConfEm ? (Number(v) || 0) : null;
  if(tipo === 'bool') return v === true;
  if(tipo === 'lista') return Array.isArray(v) ? v : [];
  if(tipo === 'data') return v ? isoOuVazio(v) || null : null;
  if(tipo === 'modo') return v === 'margin' ? 'margem' : 'preco';
  return (v === null || v === undefined) ? '' : String(v);
}

function copiaCampos(campos, origem, direcao, dono){
  const o = {};
  campos.forEach(([v1, db, tipo])=>{
    if(direcao === 'v1') o[v1] = paraV1(tipo, origem[db]);
    else o[db] = paraBanco(tipo, origem[v1], dono);
  });
  return o;
}

// Quem mexeu por último: o mais recente entre o anúncio e o vínculo dele com o ML.
function carimbo(...linhas){
  let quem = '', quando = '';
  linhas.forEach(l=>{
    if(!l) return;
    const q = isoOuVazio(l.alterado_em);
    if(q && q > quando){ quando = q; quem = l.alterado_por_nome || ''; }
  });
  return {alteradoPor: quem, alteradoEm: quando};
}

// ---------------------------------------------------------------- banco -> estado da v1
// linhas = {empresa, marketplaces, produtos, anuncios, vinculos} (todas as linhas da empresa,
// incluindo marketplaces removidos). Devolve o estado "cru"; quem chama passa pelo normalizeState.
export function estadoDoBanco(linhas){
  const codigoDoMk = new Map(linhas.marketplaces.map(m=> [m.id, m.codigo]));
  const vinc = new Map(linhas.vinculos.map(v=> [v.anuncio_id, v]));
  const profiles = linhas.marketplaces
    .filter(m=> !m.removido)
    .slice().sort((a, b)=> (a.ordem - b.ordem) || String(a.nome).localeCompare(String(b.nome)) || String(a.id).localeCompare(String(b.id)))
    .map(m=> Object.assign({uid: m.id}, copiaCampos(CAMPOS_MARKETPLACE, m, 'v1'), carimbo(m)));
  const porProduto = new Map();
  linhas.anuncios.forEach(a=>{
    if(!porProduto.has(a.produto_id)) porProduto.set(a.produto_id, []);
    porProduto.get(a.produto_id).push(a);
  });
  const products = linhas.produtos.map(p=> Object.assign({id: p.id}, copiaCampos(CAMPOS_PRODUTO, p, 'v1'), carimbo(p), {
    listings: (porProduto.get(p.id) || []).map(a=>{
      const v = vinc.get(a.id);
      const ml = v ? copiaCampos(CAMPOS_ML, v, 'v1') : {};
      // anúncio de marketplace removido continua apontando para o código dele, e a tela mostra
      // "marketplace removido" -- como a v1
      return Object.assign({id: a.id, marketplaceId: codigoDoMk.get(a.marketplace_id) || ''},
        copiaCampos(CAMPOS_ANUNCIO, a, 'v1'), ml, carimbo(a, v));
    })
  }));
  const padroes = copiaCampos(CAMPOS_PADROES, linhas.empresa, 'v1');
  return {profiles, products, padroes};
}

// ---------------------------------------------------------------- estado da v1 -> linhas
// O anúncio tem algum dado do Mercado Livre? (então o vínculo existe no banco -- inclusive o que
// sobra depois de "Desvincular", que a v1 continua usando no cálculo do envio)
export function temDadosDoML(l){
  const vazio = copiaCampos(CAMPOS_ML, {}, 'v1');
  return CAMPOS_ML.some(([k, , tipo])=>{
    const a = tipo === 'lista' ? JSON.stringify(Array.isArray(l[k]) ? l[k] : []) : paraV1(tipo === 'numnulo' ? 'num' : tipo, l[k]);
    const b = tipo === 'lista' ? '[]' : vazio[k];
    return a !== b;
  });
}

// Estado (já normalizado) -> linhas no formato do banco, só com as colunas que a tela grava.
// mkPorCodigo: código do marketplace -> id no banco (inclui os removidos, dos anúncios órfãos).
export function linhasDoEstado(dados, mkPorCodigo){
  const mk = new Map(), pr = new Map(), an = new Map(), vi = new Map();
  dados.profiles.forEach((p, i)=> mk.set(p.uid, Object.assign(copiaCampos(CAMPOS_MARKETPLACE, p, 'banco'), {ordem: i + 1})));
  dados.products.forEach(p=>{
    pr.set(p.id, copiaCampos(CAMPOS_PRODUTO, p, 'banco'));
    (p.listings || []).forEach(l=>{
      an.set(l.id, Object.assign({produto_id: p.id, marketplace_id: mkPorCodigo.get(l.marketplaceId) || null},
        copiaCampos(CAMPOS_ANUNCIO, l, 'banco')));
      if(temDadosDoML(l)) vi.set(l.id, copiaCampos(CAMPOS_ML, l, 'banco', l));
    });
  });
  const emp = copiaCampos(CAMPOS_PADROES, dados.padroes || {}, 'banco');
  return {mk, pr, an, vi, emp};
}

// Texto canônico (chaves em ordem): {a:1,b:2} e {b:2,a:1} são iguais.
export function canon(v){
  if(Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if(v && typeof v === 'object'){
    return '{' + Object.keys(v).filter(k=> v[k] !== undefined).sort().map(k=> JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}

// Colunas que mudaram de a para b
function mudancas(a, b){
  const c = {};
  Object.keys(b).forEach(k=>{ if(canon(a[k]) !== canon(b[k])) c[k] = b[k]; });
  return c;
}

// ---------------------------------------------------------------- o que gravar
// Compara o estado de antes (base, como o banco estava) com o de agora e devolve as operações
// para o "salvar", na ordem em que o banco aceita: marketplaces e produtos antes dos anúncios que
// apontam para eles; vínculos desfeitos antes de ligar o mesmo anúncio do ML em outro lugar;
// exclusões de produto e marketplace por último.
// versoes: {mk, pr, an, vi: Map(id -> versao), emp: versao}
export function operacoes(antes, agora, versoes){
  const ops = {mkIns: [], mkAlt: [], prIns: [], prAlt: [], viExc: [], anExc: [], anIns: [], anAlt: [], viIns: [], viAlt: [],
    prExc: [], mkExc: [], emp: []};
  const compara = (t, mapaA, mapaB, mapaV, ins, alt, exc)=>{
    mapaB.forEach((linha, id)=>{
      const velha = mapaA.get(id);
      if(!velha) ins.push({t, acao: 'inserir', id, campos: linha});
      else {
        const c = mudancas(velha, linha);
        if(Object.keys(c).length) alt.push({t, acao: 'alterar', id, versao: mapaV.get(id), campos: c});
      }
    });
    mapaA.forEach((linha, id)=>{ if(!mapaB.has(id)) exc.push({t, acao: 'excluir', id, versao: mapaV.get(id)}); });
  };
  compara('marketplaces', antes.mk, agora.mk, versoes.mk, ops.mkIns, ops.mkAlt, ops.mkExc);
  compara('produtos', antes.pr, agora.pr, versoes.pr, ops.prIns, ops.prAlt, ops.prExc);
  compara('anuncios', antes.an, agora.an, versoes.an, ops.anIns, ops.anAlt, ops.anExc);
  compara('ml_vinculos', antes.vi, agora.vi, versoes.vi, ops.viIns, ops.viAlt, ops.viExc);
  // anúncio que sai junto com o produto não precisa de operação própria (o banco apaga em cascata)
  const prSaindo = new Set(ops.prExc.map(o=> o.id));
  ops.anExc = ops.anExc.filter(o=> !prSaindo.has((antes.an.get(o.id) || {}).produto_id));
  const anSaindo = new Set(ops.anExc.map(o=> o.id).concat([...antes.an.keys()].filter(id=> prSaindo.has(antes.an.get(id).produto_id))));
  ops.viExc = ops.viExc.filter(o=> !anSaindo.has(o.id));
  const c = mudancas(antes.emp, agora.emp);
  if(Object.keys(c).length) ops.emp.push({t: 'empresas', acao: 'alterar', versao: versoes.emp, campos: c});
  return [].concat(ops.mkIns, ops.mkAlt, ops.prIns, ops.prAlt, ops.viExc, ops.anExc, ops.anIns, ops.anAlt,
    ops.viIns, ops.viAlt, ops.prExc, ops.mkExc, ops.emp);
}

// ---------------------------------------------------------------- conferência com a v1
// Compara o estado da v1 (já normalizado) com o que está no banco, campo a campo -- TODOS os campos
// que a tela usa, inclusive os do Mercado Livre --, casando cada item pelo id que ele tinha na v1.
// Depois recalcula o preço e a margem de cada anúncio pelos dois lados. Os dois lados passam pela
// mesma normalização e pelo mesmo cálculo (os da v1), recebidos em "v1f" para esta função não
// depender de tela nenhuma.
//   v1f = {normalizeState, calcSku, definirCustosDaEmpresa, visaoDoAnuncio, MISSING_PROFILE}
//   pendentes = ids (da v1) de anúncios que a importação guardou nas pendências
export function conferirComV1(v1, linhas, v1f, pendentes = new Set()){
  const TOL = 1e-9;
  const igualNum = (a, b)=> Math.abs(Number(a) - Number(b)) <= TOL;
  const igual = (a, b)=>{
    if(typeof a === 'number' || typeof b === 'number') return igualNum(a, b);
    if((a && typeof a === 'object') || (b && typeof b === 'object')) return canon(a) === canon(b);
    return a === b;
  };
  const mostra = v=> JSON.stringify(v === undefined ? null : v);
  const problemas = [];
  const anota = (onde, campo, a, b)=> problemas.push(`${onde}: ${campo} era ${mostra(a)} na v1 e está ${mostra(b)} na v2`);

  // o banco no formato da v1, com os ids da v1
  const idV1 = new Map();
  [linhas.marketplaces, linhas.produtos, linhas.anuncios].forEach(lista=> lista.forEach(r=>{ if(r.id_v1) idV1.set(r.id, r.id_v1); }));
  const cru = estadoDoBanco(linhas);
  cru.profiles.forEach(p=>{ p.uid = idV1.get(p.uid) || p.uid; });
  cru.products.forEach(p=>{ p.id = idV1.get(p.id) || p.id; p.listings.forEach(l=>{ l.id = idV1.get(l.id) || l.id; }); });
  const v2 = v1f.normalizeState(Object.assign(cru, {selectedSkuId: null}));

  CAMPOS_PADROES.forEach(([k])=>{ if(!igual(v1.padroes[k], v2.padroes[k])) anota('Custos da empresa', k, v1.padroes[k], v2.padroes[k]); });

  const mk2 = new Map(v2.profiles.map(p=> [p.uid, p]));
  v1.profiles.forEach(p=>{
    const q = mk2.get(p.uid || ('m:' + p.id));
    if(!q){ problemas.push(`Marketplace ${p.label} (${p.id}) não está na v2`); return; }
    CAMPOS_MARKETPLACE.forEach(([k])=>{ if(!igual(p[k], q[k])) anota('Marketplace ' + p.label, k, p[k], q[k]); });
  });

  const pr2 = new Map(v2.products.map(p=> [p.id, p]));
  const an2 = new Map();
  v2.products.forEach(p=> p.listings.forEach(l=> an2.set(l.id, {prod: p, lst: l})));
  const perfil1 = new Map(v1.profiles.map(p=> [p.id, p]));
  const perfil2 = new Map(v2.profiles.map(p=> [p.id, p]));
  let anunciosConferidos = 0, calculosIguais = 0, calculosDiferentes = 0;
  v1.products.forEach(p=>{
    const q = pr2.get(p.id);
    if(!q){ problemas.push(`Produto ${p.sku} não está na v2`); return; }
    CAMPOS_PRODUTO.forEach(([k])=>{ if(!igual(p[k], q[k])) anota('Produto ' + p.sku, k, p[k], q[k]); });
    p.listings.forEach(l=>{
      if(pendentes.has(l.id)) return;
      const achado = an2.get(l.id);
      if(!achado){ problemas.push(`Anúncio ${l.sku} (${l.marketplaceId}) não está na v2`); return; }
      anunciosConferidos++;
      const onde = 'Anúncio ' + l.sku, lq = achado.lst;
      if(achado.prod.id !== p.id) anota(onde, 'produto', p.sku, achado.prod.sku);
      if(lq.marketplaceId !== l.marketplaceId) anota(onde, 'marketplace', l.marketplaceId, lq.marketplaceId);
      CAMPOS_ANUNCIO.concat(CAMPOS_ML).forEach(([k])=>{ if(!igual(l[k], lq[k])) anota(onde, k, l[k], lq[k]); });
      // o teste que importa: preço e margem calculados pelos dois lados
      v1f.definirCustosDaEmpresa(v1.padroes);
      const r1 = v1f.calcSku(perfil1.get(l.marketplaceId) || v1f.MISSING_PROFILE, v1f.visaoDoAnuncio(p, l));
      v1f.definirCustosDaEmpresa(v2.padroes);
      const r2 = v1f.calcSku(perfil2.get(lq.marketplaceId) || v1f.MISSING_PROFILE, v1f.visaoDoAnuncio(achado.prod, lq));
      const iguais = (!!r1.error === !!r2.error) && (r1.error || (igualNum(r1.price, r2.price) && igualNum(r1.marginOnNet, r2.marginOnNet)
        && igualNum(r1.netMarketplace, r2.netMarketplace) && igualNum(r1.profit, r2.profit)));
      if(iguais) calculosIguais++;
      else { calculosDiferentes++; anota(onde, 'preço calculado', r1.error ? 'inviável' : r1.price, r2.error ? 'inviável' : r2.price); }
    });
  });
  // o que está na v2 com origem na v1 mas não existe mais na v1
  const idsV1 = new Set(v1.products.map(p=> p.id));
  linhas.produtos.filter(q=> q.id_v1 && !idsV1.has(q.id_v1)).forEach(q=> problemas.push(`Produto ${q.sku} está na v2 mas não existe mais na v1`));

  return {problemas, anunciosConferidos, calculosIguais, calculosDiferentes,
    contagemV2: {marketplaces: linhas.marketplaces.filter(m=> !m.removido).length, produtos: linhas.produtos.length,
      anuncios: linhas.anuncios.length, vinculos: linhas.vinculos.filter(v=> v.item_id).length}};
}
