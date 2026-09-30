// ---------- equipe (dono e administrador) ----------
const PAPEIS = {dono: 'Dono', editor: 'Editor', leitor: 'Leitor'};
function podeGerenciarEquipe(){ return papel === 'dono' || papel === 'admin'; }

async function renderEquipe(){
  const tab = document.getElementById('tabelaEquipe');
  if(!podeGerenciarEquipe()){ tab.innerHTML = '<p class="sub" style="padding:16px;">Só o dono da empresa (ou o administrador) gerencia a equipe.</p>'; return; }
  tab.innerHTML = '<p class="sub" style="padding:16px;">Carregando...</p>';
  let equipe;
  try{ equipe = await V2.listarEquipe(empresa.id); }
  catch(err){ tab.innerHTML = `<p class="neg" style="padding:16px;">${esc(err.message)}</p>`; return; }
  if(!equipe.length){ tab.innerHTML = '<p class="sub" style="padding:16px;">Ninguém na equipe ainda. Inclua o dono da empresa acima.</p>'; return; }
  const quando = t=> t ? dataHora(t) : 'nunca entrou';
  tab.innerHTML = `<table class="v2-equipe">
    <thead><tr><th>Nome</th><th class="col-email">E-mail</th><th>Papel</th><th class="col-acesso">Último acesso</th><th></th></tr></thead>
    <tbody>${equipe.map(m=> `<tr data-user="${esc(m.user_id)}" data-nome="${esc(m.nome)}" data-email="${esc(m.email)}" data-papel="${esc(m.papel)}" data-eu="${m.sou_eu ? 1 : 0}">
      <td>${esc(m.nome)}${m.sou_eu ? ' <span class="muted">(você)</span>' : ''}</td>
      <td class="col-email">${esc(m.email)}</td>
      <td><select data-acao="papel" aria-label="Papel de ${esc(m.nome)}">${Object.entries(PAPEIS).map(([v, r])=> `<option value="${v}"${v === m.papel ? ' selected' : ''}>${r}</option>`).join('')}</select></td>
      <td class="col-acesso muted">${esc(quando(m.ultimo_acesso))}</td>
      <td class="acoes">${m.pode_redefinir ? '<button class="btn small" type="button" data-acao="senha">Senha nova</button>' : ''}<button class="btn small danger" type="button" data-acao="tirar">Tirar</button></td>
    </tr>`).join('')}</tbody></table>`;
}

// Dados de acesso mostrados UMA vez, com "Copiar tudo" pronto para mandar à pessoa.
function mostrarCredencial(titulo, email, senha){
  const endereco = location.origin + location.pathname.replace(/[^/]*$/, '');
  const texto = `Acesso ao sistema de precificação\nEndereço: ${endereco}\nE-mail: ${email}\nSenha provisória: ${senha}\nNo primeiro acesso, o sistema pede para você criar a sua própria senha.`;
  const box = document.getElementById('credencial');
  box.innerHTML = `<div class="v2-credencial">
    <b>${esc(titulo)}</b> Passe estes dados para a pessoa. A senha não aparece de novo.
    <dl><dt>Endereço</dt><dd>${esc(endereco)}</dd><dt>E-mail</dt><dd>${esc(email)}</dd><dt>Senha provisória</dt><dd>${esc(senha)}</dd></dl>
    <button class="btn small" type="button" id="btnCopiarCredencial">Copiar tudo</button>
    <p class="sub">No primeiro acesso o sistema pede para ela criar uma senha própria.</p></div>`;
  document.getElementById('btnCopiarCredencial').onclick = async ()=>{
    try{ await navigator.clipboard.writeText(texto); document.getElementById('btnCopiarCredencial').textContent = 'Copiado'; }
    catch(_){ prompt('Copie os dados abaixo:', texto.replace(/\n/g, ' | ')); }
  };
  box.scrollIntoView({behavior: 'smooth', block: 'nearest'});
}

function ligarEquipe(){
  document.getElementById('formIncluir').onsubmit = async (e)=>{
    e.preventDefault();
    const botao = document.getElementById('btnIncluir');
    const nome = document.getElementById('novoNome').value.trim(), email = document.getElementById('novoEmail').value.trim();
    const pap = document.getElementById('novoPapel').value;
    document.getElementById('erroIncluir').textContent = '';
    document.getElementById('credencial').innerHTML = '';
    botao.disabled = true; botao.textContent = 'Incluindo...';
    try{
      const r = await V2.incluirNaEquipe(empresa.id, {nome, email, papel: pap});
      if(r.conta_nova) mostrarCredencial(`${nome} foi incluído(a) como ${PAPEIS[pap].toLowerCase()}.`, r.email, r.senha_provisoria);
      else document.getElementById('credencial').innerHTML = `<div class="v2-credencial"><b>${esc(nome)} foi incluído(a) como ${esc(PAPEIS[pap].toLowerCase())}.</b> Essa pessoa já tinha conta: ela entra com o e-mail <b>${esc(r.email)}</b> e a senha que já usa.</div>`;
      document.getElementById('formIncluir').reset();
      await renderEquipe();
    }catch(err){ document.getElementById('erroIncluir').textContent = err.message; }
    finally{ botao.disabled = false; botao.textContent = 'Incluir'; }
  };
  const tab = document.getElementById('tabelaEquipe');
  tab.addEventListener('change', async (e)=>{
    const sel = e.target.closest('select[data-acao="papel"]');
    if(!sel) return;
    const tr = sel.closest('tr'), novo = sel.value;
    const aviso = tr.dataset.eu === '1' && tr.dataset.papel === 'dono' && novo !== 'dono'
      ? 'Você vai deixar de ser dono e não verá mais esta tela. Continuar?' : `Mudar ${tr.dataset.nome} para ${PAPEIS[novo]}?`;
    if(!confirm(aviso)){ sel.value = tr.dataset.papel; return; }
    sel.disabled = true;
    try{
      await V2.alterarPapel(empresa.id, tr.dataset.user, novo);
      if(tr.dataset.eu === '1'){ location.reload(); return; }   // o próprio acesso mudou: recomeça
      await renderEquipe();
    }catch(err){ alert(err.message); sel.value = tr.dataset.papel; sel.disabled = false; }
  });
  tab.addEventListener('click', async (e)=>{
    const b = e.target.closest('button[data-acao]');
    if(!b) return;
    const tr = b.closest('tr');
    if(b.dataset.acao === 'senha'){
      if(!confirm(`Gerar uma senha provisória nova para ${tr.dataset.nome}? A senha atual deixa de funcionar e a pessoa sai de todos os aparelhos em até 1 hora.`)) return;
      b.disabled = true;
      try{ const r = await V2.gerarSenhaProvisoria(tr.dataset.user); mostrarCredencial(`Senha nova de ${tr.dataset.nome}.`, tr.dataset.email, r.senha_provisoria); }
      catch(err){ alert(err.message); }
      finally{ b.disabled = false; }
    }
    if(b.dataset.acao === 'tirar'){
      const eu = tr.dataset.eu === '1';
      if(!confirm(eu ? 'Tirar VOCÊ desta empresa? Você perde o acesso a ela na hora.'
                     : `Tirar ${tr.dataset.nome} da equipe? A pessoa perde o acesso a esta empresa na hora (a conta dela continua existindo).`)) return;
      b.disabled = true;
      try{
        await V2.removerDaEquipe(empresa.id, tr.dataset.user);
        if(eu){ V2.esquecerEmpresa(); location.reload(); return; }
        await renderEquipe();
      }catch(err){ alert(err.message); b.disabled = false; }
    }
  });
}

// ---------- minha conta ----------
function renderConta(){
  document.getElementById('meuNome').value = usuario;
  document.getElementById('contaEmail').value = V2.email || '';
  document.getElementById('senhaNova').value = ''; document.getElementById('senhaRepete').value = '';
  const m = document.getElementById('msgConta'); m.textContent = ''; m.className = '';
}
function avisoConta(texto, ok){ const m = document.getElementById('msgConta'); m.textContent = texto; m.className = ok ? 'pos' : 'neg'; }
function ligarConta(){
  document.getElementById('formSenha').onsubmit = async (e)=>{
    e.preventDefault();
    const s = document.getElementById('senhaNova').value;
    if(s.length < 8) return avisoConta('A senha precisa ter pelo menos 8 caracteres.');
    if(s !== document.getElementById('senhaRepete').value) return avisoConta('As duas senhas não são iguais.');
    try{ await V2.trocarMinhaSenha(s); document.getElementById('senhaNova').value = ''; document.getElementById('senhaRepete').value = ''; avisoConta('Senha trocada.', true); }
    catch(err){ avisoConta(err.message); }
  };
  document.getElementById('formNome').onsubmit = async (e)=>{
    e.preventDefault();
    const nome = document.getElementById('meuNome').value.trim();
    try{ await V2.alterarMeuNome(nome); usuario = nome; renderUsuario(); avisoConta('Nome salvo. As próximas alterações aparecem com ele no histórico.', true); }
    catch(err){ avisoConta(err.message); }
  };
}

function renderStorageNote(){
  document.getElementById('storageNote').textContent =
    'Os dados ficam no banco de dados, com histórico de cada alteração. Este navegador guarda só um rascunho do que ainda não foi enviado.';
}

// ---------- início ----------
// Chamado por js/inicio.js depois do login e da escolha da empresa, com a empresa inteira já lida.
async function iniciarSistema(b){
  empresa = b.empresa; papel = b.papel; meuId = b.usuario.id; usuario = b.usuario.nome;
  podeEditar = papel === 'admin' || papel === 'dono' || papel === 'editor';
  document.body.classList.toggle('somente-leitura', !podeEditar);
  CONFLITOS_KEY = 'precificacao_v2_conflitos:' + empresa.id;
  try{ conflitosRecentes = JSON.parse(store.get(CONFLITOS_KEY) || '[]') || []; }catch(e){ conflitosRecentes = []; }
  base = {linhas: linhasComoMapas(b.linhas), cache: {}};

  // Rascunho de uma sessão anterior que não chegou ao banco: junta com o que está lá agora.
  let dados = dadosDaBase(), rascunho = null;
  if(podeEditar){
    rascunho = await idb.get(chaveDoRascunho());
    if(rascunho && rascunho.local && rascunho.base){
      const antes = dadosDasLinhas(linhasComoMapas(rascunho.base));
      const r = mesclar(antes, rascunho.local, dadosDaBase());
      rascunho.conflitos = r.conflitos;
      rascunho.entidades = [entidades(antes), entidades(rascunho.local), entidades(dadosDaBase())];
      dados = r.dados;
    } else rascunho = null;
  }
  // empresa nova, sem marketplace nenhum: começa com os de fábrica, como a v1 (quem pode editar)
  state = normalizeState(Object.assign(JSON.parse(JSON.stringify(dados)),
    {selectedSkuId: store.get(STORAGE_KEY + ':sel:' + empresa.id) || null}), !podeEditar);
  versaoDados++;

  document.getElementById('empresaNome').textContent = empresa.nome;
  document.querySelectorAll('[data-so-gerente]').forEach(el=> el.hidden = !podeGerenciarEquipe());
  document.querySelectorAll('[data-so-admin]').forEach(el=> el.hidden = !b.admin);
  renderTopDisclaimer();
  renderStorageNote();
  renderUsuario();
  renderSyncPill();
  ligarEquipe();
  ligarConta();
  irPara('produtos');
  avisaMigracao();
  if(rascunho && rascunho.conflitos.length) registrarConflitos(rascunho.conflitos, ...rascunho.entidades);
  if(rascunho && temPendencia())
    toast('Havia alterações feitas neste navegador que não tinham chegado ao banco. Elas foram juntadas com o que está lá e estão sendo enviadas.', 'warn', 'Rascunho recuperado');
  if(temPendencia()) scheduleSync();
  else idb.del(chaveDoRascunho());
  setTimeout(()=>{ if(!avisouRepetidosNaSessao) avisaSeHaRepetidos(); }, 1200);
  try{ await V2.abrirCanal(empresa.id, aoAvisoDoBanco, aoStatusDoCanal); }
  catch(err){ console.warn('Aviso em tempo real indisponível agora.', err); }
}

// Aba que ficou escondida por um tempo: relê tudo (rede de segurança, caso algum aviso tenha se
// perdido no caminho).
let escondidaDesde = null;
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'hidden'){ escondidaDesde = Date.now(); return; }
  if(base && escondidaDesde && Date.now() - escondidaDesde > 60000) relerTudo();
  escondidaDesde = null;
});
// Fechar a aba com alteração ainda não enviada: o navegador pergunta. (Se fechar mesmo assim, o
// rascunho fica guardado aqui e vai para o banco na próxima vez que o sistema abrir.)
window.addEventListener('beforeunload', (e)=>{
  if(base && podeEditar && (syncOcupado() || temPendencia())){ e.preventDefault(); e.returnValue = ''; }
});
document.getElementById('usuarioBtn').onclick = ()=> irPara('conta');
document.getElementById('historicoBusca').addEventListener('input', debounce(renderHistorico, 150));
document.getElementById('conflitosLista').addEventListener('click', (e)=>{
  const usar = e.target.closest('[data-usar]'), visto = e.target.closest('[data-visto]');
  if(usar) usarValorDeles(Number(usar.dataset.usar));
  else if(visto){
    conflitosRecentes.splice(Number(visto.dataset.visto), 1);
    store.set(CONFLITOS_KEY, JSON.stringify(conflitosRecentes));
    renderConflitos();
  }
});
document.getElementById('conflitosLimpar').onclick = ()=>{
  conflitosRecentes = [];
  store.set(CONFLITOS_KEY, '[]');
  renderConflitos();
};
