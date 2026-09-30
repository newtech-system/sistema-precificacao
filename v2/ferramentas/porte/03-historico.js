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
