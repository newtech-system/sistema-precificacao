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
  importarLoteV1, espelharExclusoesV1, avisarRecarregar, mensagemDeErro } from './banco.js';
import * as modelo from './modelo.js';
import { normalizeState, visaoDoAnuncio, MISSING_PROFILE } from './v1-leitura.js';
import { calcSku, definirCustosDaEmpresa } from './calculo.js';

const $ = id => document.getElementById(id);
const esc = v => String(v === undefined || v === null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const LOTE = 200;              // produtos por chamada: mantém cada envio pequeno e rápido

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
// Busca tudo de volta do banco e compara com a v1 (modelo.conferirComV1: todos os campos, e o
// preço e a margem de cada anúncio recalculados pelos dois lados).
async function conferir(empresaId, pendencias){
  const L = await carregarEmpresa(empresaId);
  // o que a importação guardou nas pendências não conta como "faltando": está guardado, esperando decisão
  const pendentes = new Set(pendencias.filter(p=> p.tipo === 'anuncio' && p.dado).map(p=> p.dado.id));
  return modelo.conferirComV1(v1, L, { normalizeState, calcSku, definirCustosDaEmpresa, visaoDoAnuncio, MISSING_PROFILE }, pendentes);
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
    // quem estiver com esta empresa aberta na v2 relê tudo
    await avisarRecarregar(empresaId).catch(()=>{});
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
