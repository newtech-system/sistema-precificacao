// A leitura da v2 (código extraído da v1) remonta os produtos igual à v1?
import { normalizeState } from '../js/v1-leitura.js';

// linhas no formato do Apps Script: booleano como 'TRUE', faixas como texto JSON,
// produto sem anúncio como linha com marketplaceId vazio
const planilha = {
  profiles: [
    {id: 'shopee', uid: 'm:shopee', label: 'Shopee', commission: 17.63, service: 3.44, transaction: 1.96, fixedFee: 4, tiered: 'FALSE', tiers: '[]', dualAdPrice: 'FALSE'},
    {id: 'meli', uid: 'm:mercadolivre', label: 'Mercado Livre', commission: 13, fixedFee: 6.5, tiered: 'FALSE', tiers: '[]', ehMercadoLivre: 'TRUE'}
  ],
  skus: [
    {id: 'l1', productId: 'p1', productSku: '03-08-10', sku: '03-08-10-shopee', name: 'Caneca', marketplaceId: 'shopee', cogs: 10, mode: 'price', price: 43.89, coupon: 0.88, costOverride: 'FALSE'},
    {id: 'l2', productId: 'p1', productSku: '03-08-10', sku: '03-08-10-meli', name: 'Caneca', marketplaceId: 'meli', cogs: 10, mode: 'margin', marginTarget: 30, costOverride: 'FALSE',
     mlItemId: 'MLB100', mlUsar: 'TRUE', mlFaixas: '[{"min":0,"pct":12,"fixo":0}]', mlFreteFaixas: '[{"min":0,"custo":5.65}]'},
    {id: 'p0_p2', productId: 'p2', productSku: '03-08-11', sku: '03-08-11', name: 'Sem anúncio', marketplaceId: '', cogs: 5}
  ],
  padroes: {fixedCost: 1, misc: 0, taxPct: 6, marketingPct: 3, coupon: 0, freightNet: 0}
};
const st = normalizeState({profiles: planilha.profiles, skus: planilha.skus, padroes: planilha.padroes, selectedSkuId: null});
const ok = (cond, msg) => console.log((cond ? 'ok   ' : 'FALHA') + ' ' + msg);
ok(st.products.length === 2, 'dois produtos: ' + st.products.map(p => p.sku + ' (' + p.listings.length + ' anúncio)').join(', '));
const l2 = st.products[0].listings.find(l => l.id === 'l2');
ok(l2.mode === 'margin' && l2.marginTarget === 30, 'anúncio do ML em modo margem 30');
ok(l2.mlUsar === true && l2.mlFaixas.length === 1 && l2.mlFaixas[0].pct === 12, 'vínculo ML: faixas lidas do texto JSON');
ok(l2.mlFreteFaixas.length === 1 && l2.mlFreteFaixas[0].custo === 5.65, 'faixas de envio lidas do texto JSON');
ok(st.profiles.find(p => p.id === 'meli').ehMercadoLivre === true, "'TRUE' virou verdadeiro");
ok(st.profiles[0].tiered === false, "'FALSE' virou falso");
ok(st.products[1].listings.length === 0, 'produto sem anúncio mantido, sem anúncio inventado');
ok(st.padroes.taxPct === 6, 'custos da empresa lidos');
