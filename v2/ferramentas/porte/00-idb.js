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
