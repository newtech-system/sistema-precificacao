// ============================================================================
// Migração da versão 1 (planilha) para o banco -- só o administrador geral.
//
// 1. Lê os dados do cliente: pela URL do Apps Script da planilha dele, ou por um arquivo de
//    backup (JSON) exportado da v1. A leitura usa o MESMO código da v1 (v1-leitura.js), então
//    enxerga exatamente os produtos que o cliente vê hoje.
// 2. Importa em lotes (cada lote é tudo-ou-nada no banco). Pode repetir quantas vezes quiser:
//    cada registro é achado pelo id da v1, então repetir atualiza em vez de duplicar.
// 3. Espelha exclusões (o que foi apagado na v1 sai da v2), nunca tocando no que foi criado
//    direto na v2.
// 4. CONFERE: busca tudo de volta do banco e compara campo a campo com a v1, e recalcula o
//    preço e a margem de cada anúncio pelos dois lados. O resultado diz, em números, se
//    alguma coisa se perdeu ou mudou.
// ============================================================================
import { entrar, sair, usuarioAtual, ehAdmin, listarEmpresas, criarEmpresa, carregarEmpresa,
  importarLoteV1, espelharExclusoesV1, custosDaEmpresaV1, perfilV1, visaoV1, mensagemDeErro } from './banco.js';
import { normalizeState, visaoDoAnuncio, MISSING_PROFILE } from './v1-leitura.js';
import { calcSku, definirCustosDaEmpresa } from './calculo.js';

const $ = id => document.getElementById(id);
const esc = v => String(v === undefined || v === null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const LOTE = 200;              // produtos por chamada: mantém cada envio pequeno e rápido
const TOL = 1e-9;              // números iguais = diferença menor que isso (arredondamento de ponto flutuante)

let v1 = null;                 // estado da v1 lido (formato da v1)
let origem = {};

function registro(txt, tipo = ''){
  const li = document.createElement('li');
  li.className = tipo;
  li.textContent = txt;
  $('log').appendChild(li);
  li.scrollIntoView({ block: 'nearest' });
}

// ---------------------------------------------------------------- leitura da v1
async function lerDaPlanilha(url){
  const res = await fetch(url);
  const texto = await res.text();
  let d;
  try{ d = JSON.parse(texto); }
  catch(e){ throw new Error('A URL não devolveu dados. Confira se é a URL /exec do Apps Script do cliente, com acesso "Qualquer pessoa".'); }
  if(!d.profiles || !d.skus) throw new Error('A resposta não tem o formato da planilha do sistema.');
  origem = { tipo: 'planilha', url, versao_script: d.version, revisao: d.rev, lido_em: new Date().toISOString() };
  return normalizeState({ profiles: d.profiles, skus: d.skus, padroes: d.padroes || {}, selectedSkuId: null });
}
async function lerDoArquivo(arquivo){
  const d = JSON.parse(await arquivo.text());
  origem = { tipo: 'backup', arquivo: arquivo.name, lido_em: new Date().toISOString() };
  const st = normalizeState(d);
  if(!st) throw new Error('O arquivo não é um backup do sistema (faltam marketplaces e produtos).');
  return st;
}
function contarV1(st){
  const anuncios = st.products.reduce((s, p)=> s + p.listings.length, 0);
  const vinculos = st.products.reduce((s, p)=> s + p.listings.filter(l=> l.mlItemId).length, 0);
  return { marketplaces: st.profiles.length, produtos: st.products.length, anuncios, vinculos };
}

// ---------------------------------------------------------------- importação
async function importar(empresaId){
  const produtos = v1.products;
  let migracao = null;
  const pendencias = [];
  const total = Math.max(1, Math.ceil(produtos.length / LOTE));
  for(let i = 0; i < total; i++){
    const pedaco = produtos.slice(i * LOTE, (i + 1) * LOTE);
    const dados = i === 0 ? { padroes: v1.padroes, profiles: v1.profiles, products: pedaco } : { products: pedaco };
    const r = await importarLoteV1(empresaId, dados, migracao, origem);
    migracao = r.migracao;
    pendencias.push(...(r.pendencias || []));
    registro(`Lote ${i + 1} de ${total}: ${r.produtos} produto(s), ${r.anuncios} anúncio(s)` +
      (r.vinculos_ml ? `, ${r.vinculos_ml} vínculo(s) com o ML` : '') +
      (r.pendencias && r.pendencias.length ? `, ${r.pendencias.length} pendência(s)` : '') + '.');
  }
  const ids = {
    marketplaces: v1.profiles.map(p=> p.uid || ('m:' + p.id)),
    produtos: produtos.map(p=> p.id),
    anuncios: produtos.flatMap(p=> p.listings.map(l=> l.id))
  };
  const exc = await espelharExclusoesV1(empresaId, migracao, ids);
  if(exc.produtos || exc.anuncios || exc.marketplaces)
    registro(`Apagados na v2 porque não existem mais na v1: ${exc.produtos} produto(s), ${exc.anuncios} anúncio(s), ${exc.marketplaces} marketplace(s).`);
  return { migracao, pendencias };
}

// ---------------------------------------------------------------- conferência
function igualNum(a, b){ return Math.abs(Number(a) - Number(b)) <= TOL; }
// O banco guarda listas (as faixas) sem preservar a ordem das chaves de cada item: compara
// em forma canônica, com as chaves ordenadas, senão acusaria diferença que não existe.
function canon(v){
  if(Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if(v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k=> JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(typeof v === 'number' ? Number(v) : v);
}
function igualJson(a, b){ return canon(a || []) === canon(b || []); }

async function conferir(empresaId, pendencias){
  const v2 = await carregarEmpresa(empresaId);
  const problemas = [];
  const anota = (onde, campo, a, b)=> problemas.push(`${onde}: ${campo} era ${JSON.stringify(a)} na v1 e está ${JSON.stringify(b)} na v2`);

  // o que a importação guardou nas pendências não conta como "faltando": está guardado, esperando decisão
  const pendentes = new Set(pendencias.filter(p=> p.tipo === 'anuncio' && p.dado).map(p=> p.dado.id));

  const e = v2.empresa;
  [['fixedCost','custo_fixo'], ['misc','outros_custos'], ['taxPct','imposto_pct'], ['marketingPct','marketing_pct'],
   ['coupon','cupom_padrao'], ['freightNet','frete_padrao']].forEach(([k1, k2])=>{
    if(!igualNum(v1.padroes[k1], e[k2])) anota('Custos da empresa', k2, v1.padroes[k1], e[k2]);
  });

  const mkPorIdV1 = new Map(v2.marketplaces.map(m=> [m.id_v1, m]));
  const mkPorId = new Map(v2.marketplaces.map(m=> [m.id, m]));
  v1.profiles.forEach(p=>{
    const m = mkPorIdV1.get(p.uid || ('m:' + p.id));
    if(!m){ problemas.push(`Marketplace ${p.label} (${p.id}) não está na v2`); return; }
    if(m.codigo !== p.id) anota('Marketplace ' + p.label, 'código', p.id, m.codigo);
    if(m.nome !== p.label) anota('Marketplace ' + p.label, 'nome', p.label, m.nome);
    [['commission','comissao'], ['service','servico'], ['transaction','transacao'], ['fixedFee','taxa_fixa']].forEach(([k1, k2])=>{
      if(!igualNum(p[k1], m[k2])) anota('Marketplace ' + p.label, k2, p[k1], m[k2]);
    });
    if(!!p.tiered !== !!m.por_faixa) anota('Marketplace ' + p.label, 'por_faixa', p.tiered, m.por_faixa);
    if(!igualJson(p.tiers, m.faixas)) anota('Marketplace ' + p.label, 'faixas', p.tiers, m.faixas);
  });

  const prodPorIdV1 = new Map(v2.produtos.map(p=> [p.id_v1, p]));
  const anPorIdV1 = new Map(v2.anuncios.map(a=> [a.id_v1, a]));
  const vincPorAnuncio = new Map(v2.vinculos.map(v=> [v.anuncio_id, v]));
  const perfilV1PorCodigo = new Map(v1.profiles.map(p=> [p.id, p]));

  let anunciosConferidos = 0, calculosIguais = 0, calculosDiferentes = 0;
  v1.products.forEach(p=>{
    const q = prodPorIdV1.get(p.id);
    if(!q){ problemas.push(`Produto ${p.sku} não está na v2`); return; }
    if(q.sku !== p.sku) anota('Produto ' + p.sku, 'sku', p.sku, q.sku);
    if(q.nome !== p.name) anota('Produto ' + p.sku, 'nome', p.name, q.nome);
    if(q.custo_proprio !== !!p.costOverride) anota('Produto ' + p.sku, 'custo_proprio', p.costOverride, q.custo_proprio);
    [['cogs','custo'], ['fixedCost','custo_fixo'], ['misc','outros_custos'], ['taxPct','imposto_pct'], ['marketingPct','marketing_pct']].forEach(([k1, k2])=>{
      if(!igualNum(p[k1], q[k2])) anota('Produto ' + p.sku, k2, p[k1], q[k2]);
    });

    p.listings.forEach(l=>{
      if(pendentes.has(l.id)) return;
      const a = anPorIdV1.get(l.id);
      if(!a){ problemas.push(`Anúncio ${l.sku} (${l.marketplaceId}) não está na v2`); return; }
      anunciosConferidos++;
      const onde = 'Anúncio ' + l.sku;
      if(a.produto_id !== q.id) anota(onde, 'produto', p.sku, '(outro produto)');
      const m = mkPorId.get(a.marketplace_id);
      if(!m || m.codigo !== l.marketplaceId) anota(onde, 'marketplace', l.marketplaceId, m ? m.codigo : '(nenhum)');
      if(a.sku !== l.sku) anota(onde, 'sku', l.sku, a.sku);
      if(a.modo !== (l.mode === 'margin' ? 'margem' : 'preco')) anota(onde, 'modo', l.mode, a.modo);
      [['price','preco'], ['marginTarget','margem_alvo'], ['coupon','cupom'], ['freightNet','frete_liquido'], ['mktFixedFee','taxa_fixa_anuncio']].forEach(([k1, k2])=>{
        if(!igualNum(l[k1], a[k2])) anota(onde, k2, l[k1], a[k2]);
      });
      const v = vincPorAnuncio.get(a.id);
      if(l.mlItemId){
        if(!v) anota(onde, 'vínculo com o ML', l.mlItemId, '(sem vínculo)');
        else {
          if(v.item_id !== l.mlItemId) anota(onde, 'anúncio do ML', l.mlItemId, v.item_id);
          if(v.usar_taxas !== !!l.mlUsar) anota(onde, 'usar taxas do ML', l.mlUsar, v.usar_taxas);
          if(!igualJson(l.mlFaixas, v.faixas_taxa)) anota(onde, 'faixas de taxa do ML', l.mlFaixas, v.faixas_taxa);
          if(v.usar_envio !== !!l.mlUsarFrete) anota(onde, 'usar envio do ML', l.mlUsarFrete, v.usar_envio);
          if(!igualJson(l.mlFreteFaixas, v.faixas_envio)) anota(onde, 'faixas de envio do ML', l.mlFreteFaixas, v.faixas_envio);
        }
      } else if(v) anota(onde, 'vínculo com o ML', '(sem vínculo)', v.item_id);

      // o teste que importa: preço e margem calculados pelos dois lados
      definirCustosDaEmpresa(v1.padroes);
      const r1 = calcSku(perfilV1PorCodigo.get(l.marketplaceId) || MISSING_PROFILE, visaoDoAnuncio(p, l));
      definirCustosDaEmpresa(custosDaEmpresaV1(e));
      const r2 = calcSku(m ? perfilV1(m) : MISSING_PROFILE, visaoV1(q, a, v));
      const iguais = (!!r1.error === !!r2.error) && (r1.error || (igualNum(r1.price, r2.price) && igualNum(r1.marginOnNet, r2.marginOnNet)
        && igualNum(r1.netMarketplace, r2.netMarketplace)));
      if(iguais) calculosIguais++;
      else { calculosDiferentes++; anota(onde, 'preço calculado', r1.error ? 'inviável' : r1.price, r2.error ? 'inviável' : r2.price); }
    });
  });

  // o que está na v2 com origem na v1 mas não existe mais na v1
  const idsV1 = new Set(v1.products.map(p=> p.id));
  v2.produtos.filter(q=> q.id_v1 && !idsV1.has(q.id_v1)).forEach(q=> problemas.push(`Produto ${q.sku} está na v2 mas não existe mais na v1`));

  return { problemas, anunciosConferidos, calculosIguais, calculosDiferentes,
    contagemV2: { marketplaces: v2.marketplaces.filter(m=> !m.removido).length, produtos: v2.produtos.length,
      anuncios: v2.anuncios.length, vinculos: v2.vinculos.length } };
}

// ---------------------------------------------------------------- tela
async function mostrarEmpresas(){
  const empresas = await listarEmpresas();
  $('empresa').innerHTML = '<option value="">Escolha a empresa de destino...</option>' +
    empresas.map(e=> `<option value="${esc(e.id)}">${esc(e.nome)}</option>`).join('');
}

async function iniciar(){
  const u = await usuarioAtual();
  $('telaLogin').hidden = !!u;
  $('telaMigracao').hidden = !u;
  if(!u) return;
  $('quem').textContent = u.email;
  if(!(await ehAdmin())){
    $('telaMigracao').innerHTML = '<div class="card"><h2>Sem permissão</h2><p class="sub">A migração é só para o administrador geral do sistema.</p></div>';
    return;
  }
  await mostrarEmpresas();
}

$('formLogin').onsubmit = async (e)=>{
  e.preventDefault();
  $('erroLogin').textContent = '';
  try{ await entrar($('email').value.trim(), $('senha').value); await iniciar(); }
  catch(err){ $('erroLogin').textContent = err.message; }
};
$('btnSair').onclick = async ()=>{ await sair(); location.reload(); };

$('btnNovaEmpresa').onclick = async ()=>{
  const nome = prompt('Nome da empresa (o cliente) na versão 2:');
  if(!nome || !nome.trim()) return;
  try{
    const e = await criarEmpresa(nome.trim());
    await mostrarEmpresas();
    $('empresa').value = e.id;
    registro(`Empresa "${e.nome}" criada.`, 'ok');
  }catch(err){ registro(err.message, 'erro'); }
};

$('btnLer').onclick = async ()=>{
  $('resumoV1').textContent = 'Lendo...';
  $('btnImportar').disabled = true;
  try{
    const url = $('urlPlanilha').value.trim(), arq = $('arquivo').files[0];
    if(!url && !arq) throw new Error('Cole a URL do Apps Script do cliente ou escolha um arquivo de backup.');
    v1 = arq ? await lerDoArquivo(arq) : await lerDaPlanilha(url);
    const c = contarV1(v1);
    $('resumoV1').innerHTML = `Na v1: <b>${c.marketplaces}</b> marketplace(s), <b>${c.produtos}</b> produto(s), <b>${c.anuncios}</b> anúncio(s), <b>${c.vinculos}</b> vínculo(s) com o Mercado Livre.`;
    $('btnImportar').disabled = false;
  }catch(err){
    v1 = null;
    $('resumoV1').innerHTML = `<span class="neg">${esc(mensagemDeErro(err))}</span>`;
  }
};

$('btnImportar').onclick = async ()=>{
  const empresaId = $('empresa').value;
  if(!empresaId){ registro('Escolha a empresa de destino.', 'erro'); return; }
  if(!v1){ registro('Leia os dados da v1 primeiro.', 'erro'); return; }
  const nomeEmpresa = $('empresa').selectedOptions[0].textContent;
  if(!confirm(`Importar para "${nomeEmpresa}"?\n\nPode repetir sem duplicar. O que foi apagado na v1 desde a última importação também sai da v2 (só o que veio da v1).`)) return;
  $('btnImportar').disabled = true;
  $('log').innerHTML = '';
  $('resultado').innerHTML = '';
  try{
    registro('Importando...');
    const { pendencias } = await importar(empresaId);
    registro('Conferindo tudo de volta, campo a campo, e recalculando cada preço pelos dois lados...');
    const c = await conferir(empresaId, pendencias);
    const cv1 = contarV1(v1);
    const ok = c.problemas.length === 0 && c.calculosDiferentes === 0;
    $('resultado').innerHTML = `
      <div class="card ${ok ? 'conf-ok' : 'conf-falha'}">
        <h2>${ok ? 'Migração conferida: nada se perdeu' : 'Migração com diferenças'}</h2>
        <table class="conf">
          <tr><th></th><th class="num">v1</th><th class="num">v2</th></tr>
          <tr><td>Marketplaces</td><td class="num">${cv1.marketplaces}</td><td class="num">${c.contagemV2.marketplaces}</td></tr>
          <tr><td>Produtos</td><td class="num">${cv1.produtos}</td><td class="num">${c.contagemV2.produtos}</td></tr>
          <tr><td>Anúncios</td><td class="num">${cv1.anuncios}</td><td class="num">${c.contagemV2.anuncios}</td></tr>
          <tr><td>Vínculos com o ML</td><td class="num">${cv1.vinculos}</td><td class="num">${c.contagemV2.vinculos}</td></tr>
        </table>
        <p class="sub">${c.anunciosConferidos} anúncio(s) conferidos campo a campo. Preço e margem recalculados pelos dois lados:
          <b>${c.calculosIguais} iguais</b>${c.calculosDiferentes ? `, <span class="neg">${c.calculosDiferentes} diferentes</span>` : ''}.</p>
        ${pendencias.length ? `<h3>Pendências (${pendencias.length}) &mdash; guardadas inteiras, esperando decisão</h3>
          <ul class="pend">${pendencias.map(p=> `<li>${esc(p.motivo)}${p.campos ? ' ' + esc(JSON.stringify(p.campos)) : ''}</li>`).join('')}</ul>` : ''}
        ${c.problemas.length ? `<h3>Diferenças (${c.problemas.length})</h3>
          <ul class="pend">${c.problemas.slice(0, 200).map(x=> `<li>${esc(x)}</li>`).join('')}</ul>
          ${c.problemas.length > 200 ? `<p class="sub">e mais ${c.problemas.length - 200}.</p>` : ''}` : ''}
      </div>`;
    registro(ok ? 'Pronto. Nenhuma diferença.' : 'Terminou com diferenças: veja abaixo.', ok ? 'ok' : 'erro');
  }catch(err){
    registro(mensagemDeErro(err), 'erro');
  }
  $('btnImportar').disabled = false;
};

iniciar().catch(err=> registro(mensagemDeErro(err), 'erro'));
