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
