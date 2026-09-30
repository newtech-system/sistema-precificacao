// Teste da tradução entre o banco e o formato da v1 (js/modelo.js), sem internet.
//
// 1. Ida e volta: um catálogo da v1 cheio de casos difíceis vira linhas do banco e volta; a
//    conferência (a mesma da migração) tem que dar zero diferença e o mesmo preço em tudo.
// 2. A conferência pega o que muda: estraga um campo de cada vez e ela tem que acusar.
// 3. O que gravar: mexe na tela e confere que as operações são exatamente as esperadas.
//
// Uso: node ferramentas/teste-modelo.mjs     (de dentro da pasta v2)
import * as modelo from '../js/modelo.js';
import { normalizeState, visaoDoAnuncio, MISSING_PROFILE } from '../js/v1-leitura.js';
import { calcSku, definirCustosDaEmpresa } from '../js/calculo.js';

const v1f = { normalizeState, calcSku, definirCustosDaEmpresa, visaoDoAnuncio, MISSING_PROFILE };
let falhas = 0;
const ok = (cond, texto) => { console.log((cond ? 'OK    ' : 'FALHA ') + texto); if(!cond) falhas++; };
const copia = o => JSON.parse(JSON.stringify(o));

// ---------------------------------------------------------------- um catálogo da v1 com casos difíceis
const v1cru = {
  padroes: { fixedCost: 1.5, misc: 0.25, taxPct: 7.3, marketingPct: 3, coupon: 0.5, freightNet: -2 },
  profiles: [
    { id: 'shopee', uid: 'm:shopee', label: 'Shopee', color: '#ee4d2d', confidence: 'alta', note: 'nota "com aspas"',
      commission: 17.63, service: 3.44, transaction: 1.96, fixedFee: 4, dualAdPrice: true, variableFreight: true, idManual: true },
    { id: 'meli', uid: 'u123', label: 'Mercado Livre', color: '#ffe600', confidence: 'baixa', note: '', commission: 13, service: 0,
      transaction: 0, fixedFee: 6.5, variableFixedFee: true, ehMercadoLivre: true, idManual: false },
    { id: 'tiktok', uid: 'm:tiktok', label: 'TikTok Shop', color: '#25f4ee', confidence: 'media', note: '', commission: 10, service: 6,
      transaction: 0, fixedFee: 4, tiered: true,
      tiers: [{ min: 50, commission: 6, service: 6, transaction: 0, fixedFee: 6, serviceCap: 50 },   // fora de ordem de propósito
              { min: 0, commission: 10, service: 6, transaction: 0, fixedFee: 4, serviceCap: 50 }] }
  ],
  products: [
    { id: 'p1', sku: '03-08-10', name: 'Camiseta "5" branca', cogs: 11.123456789012345, costOverride: false, fixedCost: 0, misc: 0,
      taxPct: 0, marketingPct: 0, alteradoPor: 'Ana', alteradoEm: '2026-09-01T10:00:00.000Z', listings: [
        { id: 'l1', marketplaceId: 'shopee', sku: '03-08-10-shopee', mode: 'margin', price: 0, marginTarget: 23.456789012345678,
          coupon: 0.88, freightNet: 1.5, mktFixedFee: 0 },
        { id: 'l2', marketplaceId: 'meli', sku: '03-08-10-meli', mode: 'price', price: 99.9, marginTarget: 20, coupon: 0,
          freightNet: 0, mktFixedFee: 5.75,
          mlItemId: 'MLB123', mlVarId: '987', mlTitulo: 'Camiseta', mlTipo: 'gold_special', mlSituacao: 'active', mlCategoria: 'MLB1',
          mlPreco: 99.9, mlPct: 12, mlFixo: 0, mlUsar: true, mlAtualizadoEm: '2026-09-29T23:14:05.123Z',
          mlFaixas: [{ min: 0, pct: 32.4, fixo: 0 }, { min: 12.5, pct: 12, fixo: 6.25 }, { min: 79, pct: 12, fixo: 0 }],
          mlUsarFrete: true, mlFreteFaixas: [{ min: 0, custo: 0 }, { min: 79, custo: 21.95 }], mlFreteGratis: true, mlFreteOutra: 12.5,
          mlLogistica: 'fulfillment', mlFreteEm: '2026-09-29T23:14:06.000Z', mlFrete: 21.95,
          mlConfEm: '2026-09-30T01:00:00.000Z', mlConfPreco: 99.9, mlConfTaxa: 11.99, mlConfEnvio: 21.95, mlConfErro: '' },
        { id: 'l3', marketplaceId: 'tiktok', sku: 'XPTO-99', mode: 'price', price: 49.99, marginTarget: 0, coupon: 0, freightNet: 0, mktFixedFee: 0 }
      ] },
    { id: 'p2', sku: '07-01-46', name: 'Produto com custo próprio', cogs: 20, costOverride: true, fixedCost: 2, misc: 1, taxPct: 12,
      marketingPct: 8, listings: [
        // desvinculado do ML, mas com o envio e a conferência que a v1 mantém (continuam no cálculo)
        { id: 'l4', marketplaceId: 'meli', sku: '07-01-46-meli', mode: 'margin', price: 0, marginTarget: 15, coupon: 0, freightNet: 0,
          mktFixedFee: 0, mlItemId: '', mlUsarFrete: true, mlFreteFaixas: [{ min: 0, custo: 19.9 }],
          mlConfEm: '2026-09-28T12:00:00.000Z', mlConfPreco: 80, mlConfTaxa: 9.6, mlConfEnvio: 19.9, mlConfErro: '' },
        // marketplace excluído na v1: anúncio órfão
        { id: 'l5', marketplaceId: 'amazonantiga', sku: '07-01-46-amazonantiga', mode: 'price', price: 60, marginTarget: 0,
          coupon: 0, freightNet: 0, mktFixedFee: 0 }
      ] },
    { id: 'p3', sku: 'SEM-ANUNCIO', name: 'Produto sem anúncio', cogs: 0, listings: [] }
  ],
  selectedSkuId: null
};
const v1 = normalizeState(copia(v1cru));

// ---------------------------------------------------------------- as linhas que o banco teria
function linhasDoBanco(estado){
  const mkPorCodigo = new Map(estado.profiles.map(p=> [p.id, p.uid]));
  mkPorCodigo.set('amazonantiga', 'mk-removido');
  const L = modelo.linhasDoEstado(estado, mkPorCodigo);
  const meta = (id, extra)=> Object.assign({ id, id_v1: id, empresa_id: 'e1', versao: 1, alterado_em: '2026-09-01T10:00:00.000Z',
    alterado_por_nome: 'Ana' }, extra);
  const marketplaces = [...L.mk].map(([id, r])=> meta(id, Object.assign({ removido: false }, r)));
  marketplaces.push(meta('mk-removido', { codigo: 'amazonantiga', nome: 'Removido: amazonantiga', removido: true, ordem: 0,
    cor: '#8c8c88', confianca: 'baixa', observacao: '', comissao: 0, servico: 0, transacao: 0, taxa_fixa: 0, faixas: [] }));
  return {
    empresa: Object.assign({ id: 'e1', nome: 'Teste', versao: 1 }, L.emp),
    marketplaces,
    produtos: [...L.pr].map(([id, r])=> meta(id, r)),
    anuncios: [...L.an].map(([id, r])=> meta(id, r)),
    vinculos: [...L.vi].map(([id, r])=> Object.assign({ anuncio_id: id, empresa_id: 'e1', versao: 1 }, r))
  };
}

// ---------------------------------------------------------------- 1. ida e volta
const linhas = linhasDoBanco(v1);
ok(linhas.vinculos.length === 2, 'vínculo guardado para o anúncio ligado e para o que sobrou do desvinculado (' + linhas.vinculos.length + ')');
ok(linhas.vinculos.find(v=> v.anuncio_id === 'l4').item_id === '', 'o que sobrou do desvinculado fica com anúncio do ML vazio');
const c = modelo.conferirComV1(v1, linhas, v1f);
ok(c.problemas.length === 0, 'ida e volta sem diferença nenhuma' + (c.problemas.length ? ': ' + c.problemas.slice(0, 5).join(' | ') : ''));
ok(c.anunciosConferidos === 5 && c.calculosIguais === 5, `5 anúncios conferidos, 5 cálculos iguais (${c.anunciosConferidos}/${c.calculosIguais})`);
const volta = normalizeState(Object.assign(modelo.estadoDoBanco(linhas), { selectedSkuId: null }));
ok(volta.products.find(p=> p.id === 'p1').cogs === 11.123456789012345, 'CMV com 15 casas volta exato');
ok(volta.products.find(p=> p.id === 'p3').listings.length === 0, 'produto sem anúncio continua existindo');
ok(volta.products.find(p=> p.id === 'p2').listings.find(l=> l.id === 'l5').marketplaceId === 'amazonantiga', 'anúncio órfão continua no código antigo');
ok(!volta.profiles.some(p=> p.id === 'amazonantiga'), 'marketplace removido não aparece na lista de marketplaces');
ok(modelo.canon(volta.profiles.map(p=> p.id)) === modelo.canon(['shopee', 'meli', 'tiktok']), 'ordem dos marketplaces mantida');

// ---------------------------------------------------------------- 2. a conferência pega o que muda
const estraga = [
  ['preço do anúncio', L=> { L.anuncios.find(a=> a.id === 'l3').preco = 50; }, /price/],
  ['faixa de taxa do ML', L=> { L.vinculos.find(v=> v.anuncio_id === 'l2').faixas_taxa[1].fixo = 6; }, /mlFaixas/],
  ['envio do desvinculado perdido', L=> { L.vinculos = L.vinculos.filter(v=> v.anuncio_id !== 'l4'); }, /mlFreteFaixas|mlUsarFrete/],
  ['custo da empresa', L=> { L.empresa.imposto_pct = 7.31; }, /taxPct/],
  ['faixa de preço do marketplace', L=> { L.marketplaces.find(m=> m.codigo === 'tiktok').faixas[0].commission = 9; }, /tiers/],
  ['produto sumiu', L=> { L.produtos = L.produtos.filter(p=> p.id !== 'p3'); }, /não está na v2/],
  ['anúncio mudou de marketplace', L=> { L.anuncios.find(a=> a.id === 'l1').marketplace_id = 'm:tiktok'; }, /marketplace/],
  ['data da conferência', L=> { L.vinculos.find(v=> v.anuncio_id === 'l2').conf_em = '2026-09-30T01:00:01Z'; }, /mlConfEm/]
];
estraga.forEach(([nome, mexe, espera])=>{
  const L = copia(linhas);
  mexe(L);
  const r = modelo.conferirComV1(v1, L, v1f);
  ok(r.problemas.some(p=> espera.test(p)), 'acusa: ' + nome + (r.problemas.length ? ' -> ' + r.problemas[0].slice(0, 90) : ''));
});
{
  const L = copia(linhas);
  L.anuncios.find(a=> a.id === 'l3').preco = 50;
  const r = modelo.conferirComV1(v1, L, v1f);
  ok(r.calculosDiferentes === 1, 'preço diferente também aparece no recálculo');
}

// ---------------------------------------------------------------- 3. o que gravar
const mk = new Map(v1.profiles.map(p=> [p.id, p.uid])); mk.set('amazonantiga', 'mk-removido');
const antes = modelo.linhasDoEstado(v1, mk);
const versoes = { mk: new Map([...antes.mk.keys()].map(k=> [k, 1])), pr: new Map([...antes.pr.keys()].map(k=> [k, 3])),
  an: new Map([...antes.an.keys()].map(k=> [k, 2])), vi: new Map([...antes.vi.keys()].map(k=> [k, 5])), emp: 9 };
ok(modelo.operacoes(antes, modelo.linhasDoEstado(copia(v1), mk), versoes).length === 0, 'sem mudança, nada a gravar');
{
  const agora = copia(v1);
  agora.products[0].name = 'Novo nome';
  agora.products[0].listings[1].mlItemId = ''; agora.products[0].listings[1].mlVarId = '';   // desvincula (sobra o envio)
  agora.products[1].listings = agora.products[1].listings.filter(l=> l.id !== 'l5');         // tira o órfão
  agora.products = agora.products.filter(p=> p.id !== 'p3');                                    // exclui produto
  agora.products.push({ id: 'p9', sku: 'NOVO', name: 'Novo', cogs: 1, costOverride: false, fixedCost: 0, misc: 0, taxPct: 0, marketingPct: 0,
    listings: [{ id: 'l9', marketplaceId: 'shopee', sku: 'NOVO-shopee', mode: 'margin', price: 0, marginTarget: 30, coupon: 0, freightNet: 0, mktFixedFee: 0 }] });
  agora.padroes.coupon = 1;
  const ops = modelo.operacoes(antes, modelo.linhasDoEstado(normalizeState(agora), mk), versoes);
  const txt = ops.map(o=> `${o.t}:${o.acao}:${o.id || ''}:${o.versao || ''}:${Object.keys(o.campos || {}).sort().join(',')}`);
  const esperado = [
    'produtos:inserir:p9::' + modelo.CAMPOS_PRODUTO.map(c=> c[1]).sort().join(','),
    'produtos:alterar:p1:3:nome',
    'anuncios:excluir:l5:2:',
    'anuncios:inserir:l9::' + ['produto_id', 'marketplace_id'].concat(modelo.CAMPOS_ANUNCIO.map(c=> c[1])).sort().join(','),
    'ml_vinculos:alterar:l2:5:item_id,variacao_id',
    'produtos:excluir:p3:3:',
    'empresas:alterar::9:cupom_padrao'
  ];
  ok(modelo.canon(txt) === modelo.canon(esperado), 'operações exatas, na ordem certa' + (modelo.canon(txt) === modelo.canon(esperado) ? '' : '\n   ' + txt.join('\n   ')));
}
{
  // desvincular por completo (sem sobra nenhuma) apaga o vínculo
  const agora = copia(v1);
  const l = agora.products[1].listings.find(x=> x.id === 'l4');
  Object.assign(l, { mlUsarFrete: false, mlFreteFaixas: [], mlConfEm: '', mlConfPreco: 0, mlConfTaxa: 0, mlConfEnvio: 0 });
  const ops = modelo.operacoes(antes, modelo.linhasDoEstado(normalizeState(agora), mk), versoes);
  ok(ops.length === 1 && ops[0].t === 'ml_vinculos' && ops[0].acao === 'excluir' && ops[0].id === 'l4', 'sem nenhum dado do ML, o vínculo é apagado');
}
{
  // excluir o produto não gera exclusão separada dos anúncios nem dos vínculos (o banco apaga junto)
  const agora = copia(v1);
  agora.products = agora.products.filter(p=> p.id !== 'p1');
  const ops = modelo.operacoes(antes, modelo.linhasDoEstado(normalizeState(agora), mk), versoes);
  ok(ops.length === 1 && ops[0].t === 'produtos' && ops[0].acao === 'excluir', 'excluir produto = uma operação só (' + ops.length + ')');
}
{
  // trocar o ID (código) do marketplace: muda só o marketplace, os anúncios continuam ligados a ele
  const agora = copia(v1);
  agora.profiles[0].id = 'shp';
  agora.products.forEach(p=> p.listings.forEach(l=>{ if(l.marketplaceId === 'shopee') l.marketplaceId = 'shp'; }));
  const mkAgora = new Map(mk); mkAgora.set('shp', 'm:shopee');
  const ops = modelo.operacoes(antes, modelo.linhasDoEstado(normalizeState(agora), mkAgora), versoes);
  ok(ops.length === 1 && ops[0].t === 'marketplaces' && modelo.canon(ops[0].campos) === modelo.canon({ codigo: 'shp' }),
    'trocar o ID do marketplace = só o código muda (' + JSON.stringify(ops.map(o=> o.campos)) + ')');
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
