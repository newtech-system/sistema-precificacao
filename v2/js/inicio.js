// ============================================================================
// Porta de entrada da v2: login, senha própria no primeiro acesso e escolha da empresa. Depois
// disso lê a empresa inteira do banco e entrega para a tela (js/sistema.js, a tela da v1).
//
// window.V2 é a ponte: a tela da v1 é um script comum (sem import), e chama o banco por aqui.
// ============================================================================
import * as B from './banco.js';
import * as modelo from './modelo.js';

const $ = id => document.getElementById(id);
const esc = v => String(v === undefined || v === null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const CHAVE_EMPRESA = 'precificacao_v2_empresa';
// localStorage pode falhar (aba anônima, armazenamento bloqueado): tudo funciona sem ele
const guarda = {
  ler(){ try{ return localStorage.getItem(CHAVE_EMPRESA); }catch(_){ return null; } },
  gravar(v){ try{ localStorage.setItem(CHAVE_EMPRESA, v); }catch(_){ /* segue sem lembrar */ } },
  apagar(){ try{ localStorage.removeItem(CHAVE_EMPRESA); }catch(_){ /* idem */ } }
};

window.V2 = {
  modelo,
  carregarEmpresa: B.carregarEmpresa, lerPorIds: B.lerPorIds, lerEmpresa: B.lerEmpresa,
  salvarLote: B.salvarLote, abrirCanal: B.abrirCanal, listarHistorico: B.listarHistorico, chamarML: B.chamarML,
  listarEquipe: B.listarEquipe, incluirNaEquipe: B.incluirNaEquipe, gerarSenhaProvisoria: B.gerarSenhaProvisoria,
  alterarPapel: B.alterarPapel, removerDaEquipe: B.removerDaEquipe,
  alterarMeuNome: B.alterarMeuNome, trocarMinhaSenha: B.trocarMinhaSenha,
  esquecerEmpresa: ()=> guarda.apagar(),
  email: ''
};

function porta(tela){
  ['telaCarregando', 'telaLogin', 'telaSenha', 'telaEmpresas'].forEach(id=> $(id).hidden = id !== tela);
  $('porta').hidden = false;
}
function carregando(texto, erro){
  porta('telaCarregando');
  $('msgCarregando').innerHTML = erro
    ? `<span class="neg">${esc(texto)}</span><br><br><button class="btn" type="button" id="btnDeNovo">Tentar de novo</button> <button class="btn" type="button" data-sair>Sair</button>`
    : esc(texto);
  if(erro){ $('btnDeNovo').onclick = ()=> location.reload(); ligarSair(); }
}

async function comecar(){
  carregando('Carregando...');
  const u = await B.usuarioAtual();
  if(!u){ porta('telaLogin'); $('email').focus(); return; }
  window.V2.email = u.email;
  // entrou com senha provisória: primeiro cria a própria
  if(u.user_metadata && u.user_metadata.trocar_senha){ $('senhaNovaEmail').value = u.email; porta('telaSenha'); $('senhaNova1').focus(); return; }
  const [admin, empresas] = await Promise.all([B.ehAdmin(), B.listarEmpresas()]);
  const pedida = new URLSearchParams(location.search).get('empresa') || guarda.ler();
  const achada = empresas.find(e=> e.id === pedida) || (empresas.length === 1 ? empresas[0] : null);
  if(achada) return abrir(achada, u, admin);
  mostrarEmpresas(empresas, admin, u);
}

function mostrarEmpresas(empresas, admin, u){
  porta('telaEmpresas');
  $('quemPorta').textContent = u.email;
  $('subEmpresas').textContent = admin ? 'Como administrador, você vê todas.' : '';
  $('btnNovaEmpresa').hidden = !admin;
  $('lnkMigrarPorta').hidden = !admin;
  $('listaEmpresas').innerHTML = empresas.length
    ? empresas.map(e=> `<button class="card v2-empresa" type="button" data-empresa="${esc(e.id)}"><b>${esc(e.nome)}</b></button>`).join('')
    : '<p class="sub">Nenhuma empresa ainda.' + (admin ? ' Crie uma, ou use a Migração para trazer um cliente da versão 1.' : ' Peça ao responsável pela sua empresa para te incluir na equipe.') + '</p>';
  $('listaEmpresas').querySelectorAll('[data-empresa]').forEach(b=> b.onclick = ()=> abrir(empresas.find(e=> e.id === b.dataset.empresa), u, admin).catch(falhou));
  $('btnNovaEmpresa').onclick = async ()=>{
    const nome = prompt('Nome da empresa:');
    if(!nome || !nome.trim()) return;
    try{ const e = await B.criarEmpresa(nome.trim()); await abrir(e, u, admin); }
    catch(err){ alert(B.mensagemDeErro(err)); }
  };
}

async function abrir(emp, u, admin){
  carregando(`Abrindo ${emp.nome}...`);
  const [linhas, papel, nome] = await Promise.all([B.carregarEmpresa(emp.id), B.meuPapel(emp.id), B.meuNome(u)]);
  if(!papel) throw new Error('Seu usuário não tem acesso a esta empresa.');
  guarda.gravar(emp.id);
  await window.iniciarSistema({empresa: {id: emp.id, nome: linhas.empresa.nome}, papel, admin,
    usuario: {id: u.id, email: u.email, nome}, linhas});
  $('porta').hidden = true;
  document.body.classList.remove('carregando');
}

function falhou(err){
  carregando(B.mensagemDeErro(err), true);
}

// ---------------------------------------------------------------- ações da porta
$('formLogin').onsubmit = async (e)=>{
  e.preventDefault();
  $('erroLogin').textContent = '';
  $('btnEntrar').disabled = true;
  try{ await B.entrar($('email').value.trim(), $('senha').value); }
  catch(err){ $('erroLogin').textContent = B.mensagemDeErro(err); return; }
  finally{ $('btnEntrar').disabled = false; }
  comecar().catch(falhou);   // erro depois do login não é "senha errada": mostra o que foi
};
// Sem servidor de e-mail próprio o Supabase não entrega e-mails a clientes: a senha nova sai
// pela tela de Equipe, gerada por quem gerencia a empresa.
$('btnEsqueci').onclick = ()=>{
  $('erroLogin').textContent = 'Peça ao dono da sua empresa (ou ao administrador) uma senha provisória nova: fica em Equipe → Senha nova.';
};
$('formSenhaNova').onsubmit = async (e)=>{
  e.preventDefault();
  const s = $('senhaNova1').value;
  $('erroSenhaNova').textContent = '';
  if(s.length < 8){ $('erroSenhaNova').textContent = 'A senha precisa ter pelo menos 8 caracteres.'; return; }
  if(s !== $('senhaNova2').value){ $('erroSenhaNova').textContent = 'As duas senhas não são iguais.'; return; }
  try{ await B.trocarMinhaSenha(s); await comecar(); }
  catch(err){ $('erroSenhaNova').textContent = B.mensagemDeErro(err); }
};
function ligarSair(){
  document.querySelectorAll('[data-sair]').forEach(b=> b.onclick = async ()=>{ await B.sair(); guarda.apagar(); location.reload(); });
}
ligarSair();
// dentro do sistema (barra lateral)
$('btnSairSistema').onclick = async ()=>{
  if(window.temPendencia && window.temPendencia() && !confirm('Há alterações ainda sendo gravadas. Sair mesmo assim? (Elas ficam guardadas neste navegador e são enviadas na próxima vez.)')) return;
  await B.sair(); guarda.apagar(); location.href = location.pathname;
};
$('btnTrocarEmpresa').onclick = ()=>{ guarda.apagar(); location.href = location.pathname; };

comecar().catch(falhou);
