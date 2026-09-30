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
