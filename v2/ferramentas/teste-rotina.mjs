// Teste da regra da releitura automática (supabase/functions/precificacao-ml/rotina.ts), com um
// "Mercado Livre" de mentira. Uso (de dentro da pasta v2):  node ferramentas/teste-rotina.mjs
// Precisa do Node 22.18 ou mais novo (lê o arquivo .ts direto).
import assert from 'node:assert/strict';
import { relerFatia, montarLinha, precoDoRetrato, chaveDoItem, diferencas } from '../supabase/functions/precificacao-ml/rotina.ts';

let ok = 0;
const caso = async (nome, fn) => { await fn(); ok++; console.log('OK   ' + nome); };

const linha = (n, extra = {}) => ({ anuncio_id: 'a' + n, item_id: 'MLB' + n, variacao_id: '', categoria: 'CAT1', tipo: 'gold_pro',
  situacao: 'active', preco_ml: 100, modo: 'preco', preco_anuncio: 100, ...extra });
const freteOk = (extra = {}) => ({ faixas: [{ min: 0, custo: 10 }, { min: 79, custo: 20 }], gratis: false, logistica: 'xd', outra: 0,
  precoML: 100, categoria: 'CAT1', tipo: 'gold_pro', situacao: 'active', ...extra });
const taxasOk = { faixas: [{ min: 0, pct: 14, fixo: 6 }, { min: 79, pct: 14, fixo: 0 }] };

// ML de mentira: registra as chamadas
function fontes({ frete = {}, taxas = {}, faltouFrete = [], faltouTaxas = [] } = {}) {
  const chamadas = { frete: [], taxas: [] };
  return {
    chamadas,
    frete: async (chaves) => {
      chamadas.frete.push(chaves);
      const out = {}, faltou = [];
      chaves.forEach((c) => { if (faltouFrete.includes(c)) faltou.push(c); else out[c] = frete[c] || freteOk(); });
      return { frete: out, faltou };
    },
    taxas: async (chaves) => {
      chamadas.taxas.push(chaves);
      const out = {}, faltou = [];
      chaves.forEach((c) => { if (faltouTaxas.includes(c)) faltou.push(c); else out[c] = taxas[c] || taxasOk; });
      return { taxas: out, faltou };
    },
  };
}

await caso('uma categoria só consulta as taxas uma vez, e o envio de 4 em 4', async () => {
  const f = fontes();
  const r = await relerFatia([1, 2, 3, 4, 5].map((n) => linha(n)), {}, f);
  assert.equal(r.processadas, 5); assert.equal(r.aplicar.length, 5); assert.equal(r.erros, 0);
  assert.deepEqual(f.chamadas.frete.map((c) => c.length), [4, 1]);
  assert.deepEqual(f.chamadas.taxas, [['CAT1|gold_pro']]);
});

await caso('categoria que já está no cache da volta não é consultada de novo', async () => {
  const f = fontes();
  const r = await relerFatia([linha(1)], { 'CAT1|gold_pro': taxasOk }, f);
  assert.equal(f.chamadas.taxas.length, 0); assert.equal(r.aplicar.length, 1);
});

await caso('o ML devolve a categoria e o tipo de HOJE: as taxas vêm dela, e a linha grava a nova', async () => {
  const f = fontes({ frete: { MLB1: freteOk({ categoria: 'CAT9', tipo: 'gold_special' }) } });
  const r = await relerFatia([linha(1)], {}, f);
  assert.deepEqual(f.chamadas.taxas, [['CAT9|gold_special']]);
  assert.equal(r.aplicar[0].categoria, 'CAT9'); assert.equal(r.aplicar[0].tipo, 'gold_special');
});

await caso('anúncio com variação usa item:variação como chave', async () => {
  const l = linha(1, { variacao_id: '555' });
  assert.equal(chaveDoItem(l), 'MLB1:555');
  const f = fontes();
  await relerFatia([l], {}, f);
  assert.deepEqual(f.chamadas.frete, [['MLB1:555']]);
});

await caso('erro do ML num anúncio: conta o erro, grava os outros, e a fatia termina', async () => {
  const f = fontes({ frete: { MLB2: { erro: 'Mercado Livre respondeu 404' } } });
  const r = await relerFatia([1, 2, 3].map((n) => linha(n)), {}, f);
  assert.equal(r.processadas, 3); assert.equal(r.erros, 1); assert.equal(r.aplicar.length, 2);
  assert.match(r.ultimoErro, /404/);
  assert.deepEqual(r.aplicar.map((x) => x.anuncio_id), ['a1', 'a3']);
});

await caso('taxas com erro: o anúncio é erro, não grava só o envio', async () => {
  const f = fontes({ taxas: { 'CAT1|gold_pro': { erro: 'sem taxas' } } });
  const r = await relerFatia([linha(1)], {}, f);
  assert.equal(r.erros, 1); assert.equal(r.aplicar.length, 0);
});

await caso('faltou tempo no envio: a fatia termina ANTES da linha que faltou (ordem preservada)', async () => {
  const f = fontes({ faltouFrete: ['MLB3'] });
  const r = await relerFatia([1, 2, 3, 4, 5].map((n) => linha(n)), {}, f);
  assert.equal(r.processadas, 2);
  assert.deepEqual(r.aplicar.map((x) => x.anuncio_id), ['a1', 'a2']);
  assert.equal(f.chamadas.frete.length, 1, 'não segue para o próximo grupo depois de faltar');
});

await caso('faltou tempo nas taxas de uma categoria: termina antes da primeira linha que precisa dela', async () => {
  const f = fontes({
    frete: { MLB2: freteOk({ categoria: 'CAT2' }) },
    faltouTaxas: ['CAT2|gold_pro'],
  });
  const r = await relerFatia([1, 2, 3].map((n) => linha(n)), {}, f);
  assert.equal(r.processadas, 1);
  assert.deepEqual(r.aplicar.map((x) => x.anuncio_id), ['a1']);
});

await caso('retrato (ml_pct, ml_fixo, ml_frete) na faixa do preço do anúncio', async () => {
  const fr = freteOk();
  const baixo = montarLinha(linha(1, { preco_anuncio: 50 }), fr, taxasOk.faixas);
  assert.equal(baixo.ml_fixo, 6); assert.equal(baixo.ml_frete, 10);
  const alto = montarLinha(linha(1, { preco_anuncio: 100 }), fr, taxasOk.faixas);
  assert.equal(alto.ml_fixo, 0); assert.equal(alto.ml_frete, 20);
});

await caso('modo margem (sem preço próprio): o retrato usa o preço do ML', async () => {
  assert.equal(precoDoRetrato(linha(1, { modo: 'margem', preco_anuncio: 0, preco_ml: 80 }), freteOk()), 80);
  assert.equal(precoDoRetrato(linha(1, { modo: 'margem', preco_anuncio: 0, preco_ml: 0 }), freteOk({ precoML: 55 })), 55);
});

await caso('entrega a combinar mantém a marca "combinar" e custo zero', async () => {
  const fr = freteOk({ faixas: [{ min: 0, custo: 0, combinar: true }], logistica: 'not_specified' });
  const l = montarLinha(linha(1), fr, taxasOk.faixas);
  assert.deepEqual(l.faixas_envio, [{ min: 0, custo: 0, combinar: true }]);
  assert.equal(l.ml_frete, 0); assert.equal(l.logistica, 'not_specified');
});

await caso('a linha não carrega os campos "usar": a releitura nunca religa o que alguém desligou', async () => {
  const l = montarLinha(linha(1), freteOk(), taxasOk.faixas);
  assert.equal('usar_taxas' in l, false); assert.equal('usar_envio' in l, false);
});

await caso('simulação: acha só o que mudaria', async () => {
  const atual = { categoria: 'CAT1', tipo: 'gold_pro', situacao: 'active', faixas_taxa: [{ min: 0, pct: 14, fixo: 6 }, { min: 79, pct: 14, fixo: 0 }],
    faixas_envio: [{ min: 0, custo: 10 }, { min: 79, custo: 20 }], frete_gratis: false, logistica: 'xd', envio_outra_opcao: 0 };
  assert.deepEqual(diferencas(atual, montarLinha(linha(1), freteOk(), taxasOk.faixas)), {});
  const d = diferencas(atual, montarLinha(linha(1), freteOk({ gratis: true }), taxasOk.faixas));
  assert.deepEqual(Object.keys(d), ['frete_gratis']);
});

console.log(`\nTudo certo (${ok} casos).`);
