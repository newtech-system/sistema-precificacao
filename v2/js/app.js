// ============================================================================
// Versão 2 -- login, escolha da empresa, catálogo com os preços calculados, equipe e conta.
// O catálogo ainda é só leitura: serve para validar banco, acesso e cálculo com dados
// reais migrados, antes de portar as telas de edição.
// ============================================================================
import { entrar, sair, usuarioAtual, ehAdmin, listarEmpresas, criarEmpresa, carregarEmpresa,
  custosDaEmpresaV1, perfilV1, visaoV1, mensagemDeErro,
  trocarMinhaSenha, alterarMeuNome, meuPapel, listarEquipe, incluirNaEquipe, gerarSenhaProvisoria,
  alterarPapel, removerDaEquipe } from './banco.js';
import { calcSku, definirCustosDaEmpresa, brl, pct } from './calculo.js';

const $ = id => document.getElementById(id);
const esc = v => String(v === undefined || v === null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const CHAVE_EMPRESA = 'precificacao_v2_empresa';
const LIMITE_LINHAS = 300;   // a tabela desenha em blocos; catálogo grande não trava
const TELAS = ['telaLogin', 'telaEmpresas', 'telaProdutos', 'telaEquipe', 'telaConta'];
const PAPEIS = { dono: 'Dono', editor: 'Editor', leitor: 'Leitor' };

// empresa aberta agora: guardada para voltar da equipe/conta sem recarregar o catálogo inteiro
const atual = { id: null, nome: '', papel: null, dados: null };

// localStorage pode falhar (janela anônima, armazenamento bloqueado): a tela funciona sem ele
const guarda = {
  ler(){ try{ return localStorage.getItem(CHAVE_EMPRESA); }catch(_){ return null; } },
  gravar(v){ try{ localStorage.setItem(CHAVE_EMPRESA, v); }catch(_){ /* segue sem lembrar */ } },
  apagar(){ try{ localStorage.removeItem(CHAVE_EMPRESA); }catch(_){ /* idem */ } }
};

function mostra(tela){
  TELAS.forEach(id=> $(id).hidden = id !== tela);
  $('btnEquipe').hidden = !(atual.id && (atual.papel === 'dono' || atual.papel === 'admin')) || tela === 'telaEquipe';
}

async function iniciar(){
  const u = await usuarioAtual();
  $('btnSair').hidden = !u;
  $('btnConta').hidden = !u;
  $('quem').textContent = u ? u.email : '';
  if(!u){ mostra('telaLogin'); return; }
  // entrou com senha provisória: primeiro cria a própria
  if(u.user_metadata && u.user_metadata.trocar_senha) return abrirConta(true);
  const admin = await ehAdmin();
  $('lnkMigrar').hidden = !admin;
  $('acoesAdmin').hidden = !admin;
  const empresas = await listarEmpresas();
  const guardada = guarda.ler();
  if(empresas.length === 1) return abrirEmpresa(empresas[0].id);
  if(guardada && empresas.some(e=> e.id === guardada)) return abrirEmpresa(guardada);
  mostrarEmpresas(empresas, admin);
}

function mostrarEmpresas(empresas, admin){
  Object.assign(atual, { id: null, nome: '', papel: null, dados: null });
  mostra('telaEmpresas');
  $('btnTrocar').hidden = true;
  $('titulo').textContent = 'Escolha a empresa';
  $('subtitulo').textContent = admin ? 'Como administrador, você vê todas.' : '';
  $('listaEmpresas').innerHTML = empresas.length
    ? empresas.map(e=> `<button class="card v2-empresa" type="button" data-empresa="${esc(e.id)}"><b>${esc(e.nome)}</b></button>`).join('')
    : '<p class="sub">Nenhuma empresa ainda.' + (admin ? ' Crie uma, ou use a Migração para trazer um cliente da versão 1.' : ' Peça ao responsável pela sua empresa para te incluir na equipe.') + '</p>';
  $('listaEmpresas').querySelectorAll('[data-empresa]').forEach(b=> b.onclick = ()=> abrirEmpresa(b.dataset.empresa));
}

async function abrirEmpresa(id){
  Object.assign(atual, { id, nome: '', papel: null, dados: null });
  mostra('telaProdutos');
  $('tabela').innerHTML = '<p class="sub" style="padding:16px;">Carregando...</p>';
  try{
    const [d, papel] = await Promise.all([carregarEmpresa(id), meuPapel(id)]);
    Object.assign(atual, { nome: d.empresa.nome, papel, dados: d });
    guarda.gravar(id);
    mostrarProdutos();
  }catch(err){
    $('tabela').innerHTML = `<p class="neg" style="padding:16px;">${esc(mensagemDeErro(err))}</p>`;
  }
}

function mostrarProdutos(){
  const d = atual.dados;
  mostra('telaProdutos');
  $('titulo').textContent = d.empresa.nome;
  $('subtitulo').textContent = `${d.produtos.length} produto(s), ${d.anuncios.length} anúncio(s)`;
  $('btnTrocar').hidden = false;
  desenharProdutos(d);
}

function desenharProdutos(d){
  definirCustosDaEmpresa(custosDaEmpresaV1(d.empresa));
  const mk = new Map(d.marketplaces.map(m=> [m.id, m]));
  const vinc = new Map(d.vinculos.map(v=> [v.anuncio_id, v]));
  const anunciosPorProduto = new Map();
  d.anuncios.forEach(a=>{
    if(!anunciosPorProduto.has(a.produto_id)) anunciosPorProduto.set(a.produto_id, []);
    anunciosPorProduto.get(a.produto_id).push(a);
  });
  let somaMargem = 0, validos = 0, prejuizo = 0;
  const linhas = [];
  d.produtos.forEach(p=>{
    const ans = (anunciosPorProduto.get(p.id) || []).sort((a, b)=> (mk.get(a.marketplace_id) || {}).ordem - (mk.get(b.marketplace_id) || {}).ordem);
    ans.forEach((a, i)=>{
      const m = mk.get(a.marketplace_id);
      const r = calcSku(perfilV1(m), visaoV1(p, a, vinc.get(a.id)));
      if(!r.error){ somaMargem += r.marginPct; validos++; if(r.marginPct < 0) prejuizo++; } else prejuizo++;
      linhas.push(`<tr class="${i === 0 ? 'grupo-ini' : 'grupo-seq'}">
        ${i === 0 ? `<td class="cell-prod" rowspan="${ans.length}"><span class="sku">${esc(p.sku)}</span><span class="nm">${esc(p.nome)}</span></td>
          <td class="num" rowspan="${ans.length}">${brl(Number(p.custo))}</td>` : ''}
        <td class="canal-cell"><span class="mkt-dot" style="background:${esc(m.cor)}"></span>${esc(m.nome)}${m.removido ? ' <span class="tag tag-danger">removido</span>' : ''}${vinc.has(a.id) ? ' <span class="tag">ML</span>' : ''}</td>
        ${r.error ? '<td class="num" colspan="3" style="color:var(--bad)">Margem inviável com essas taxas</td>'
          : `<td class="num">${brl(r.price)}</td><td class="num ${r.profit >= 0 ? 'pos' : 'neg'}">${brl(r.profit)}</td>
             <td class="num ${r.marginPct >= 0 ? 'pos' : 'neg'}">${pct(r.marginPct)}</td>`}
      </tr>`);
    });
  });
  $('metricas').innerHTML = `
    <div class="metric"><div class="k">Produtos</div><div class="v">${d.produtos.length}</div><div class="f">${d.anuncios.length} anúncio(s)</div></div>
    <div class="metric ${!validos ? '' : somaMargem / validos >= 0 ? 'ok' : 'bad'}"><div class="k">Margem média</div><div class="v">${pct(validos ? somaMargem / validos : 0)}</div><div class="f">sobre o valor recebido</div></div>
    <div class="metric ${prejuizo ? 'bad' : 'ok'}"><div class="k">Anúncios no prejuízo</div><div class="v">${prejuizo}</div><div class="f">${prejuizo ? 'revise preço ou custo' : 'nenhum no vermelho'}</div></div>`;
  const mostrar = linhas.slice(0, LIMITE_LINHAS);
  $('tabela').innerHTML = linhas.length ? `<table class="tabela-produtos">
      <thead><tr><th>Produto</th><th class="num">Custo</th><th>Marketplace</th><th class="num">Preço</th><th class="num">Lucro</th><th class="num">Margem</th></tr></thead>
      <tbody>${mostrar.join('')}</tbody></table>
      ${linhas.length > LIMITE_LINHAS ? `<p class="sub" style="padding:10px 14px;">Mostrando ${LIMITE_LINHAS} de ${linhas.length} anúncios.</p>` : ''}`
    : '<p class="sub" style="padding:16px;">Nenhum produto nesta empresa ainda.' + (atual.papel === 'admin' || atual.papel === 'dono' ? ' Use <b>Equipe</b> para incluir quem vai trabalhar nela.' : '') + '</p>';
}

// ---------------------------------------------------------------- equipe
async function abrirEquipe(){
  mostra('telaEquipe');
  $('titulo').textContent = 'Equipe — ' + atual.nome;
  $('subtitulo').textContent = 'Quem acessa esta empresa e o que cada um pode fazer.';
  $('credencial').innerHTML = '';
  $('erroIncluir').textContent = '';
  await desenharEquipe();
}

async function desenharEquipe(){
  $('tabelaEquipe').innerHTML = '<p class="sub" style="padding:16px;">Carregando...</p>';
  let equipe;
  try{ equipe = await listarEquipe(atual.id); }
  catch(err){ $('tabelaEquipe').innerHTML = `<p class="neg" style="padding:16px;">${esc(mensagemDeErro(err))}</p>`; return; }
  if(!equipe.length){
    $('tabelaEquipe').innerHTML = '<p class="sub" style="padding:16px;">Ninguém na equipe ainda. Inclua o dono da empresa acima.</p>';
    return;
  }
  const quando = t => t ? new Date(t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'nunca entrou';
  $('tabelaEquipe').innerHTML = `<table class="v2-equipe">
    <thead><tr><th>Nome</th><th class="col-email">E-mail</th><th>Papel</th><th class="col-acesso">Último acesso</th><th></th></tr></thead>
    <tbody>${equipe.map(m=> `<tr data-user="${esc(m.user_id)}" data-nome="${esc(m.nome)}" data-email="${esc(m.email)}" data-papel="${esc(m.papel)}" data-eu="${m.sou_eu ? 1 : 0}">
      <td>${esc(m.nome)}${m.sou_eu ? ' <span class="muted">(você)</span>' : ''}</td>
      <td class="col-email">${esc(m.email)}</td>
      <td><select data-acao="papel" aria-label="Papel de ${esc(m.nome)}">${Object.entries(PAPEIS).map(([v, r])=> `<option value="${v}"${v === m.papel ? ' selected' : ''}>${r}</option>`).join('')}</select></td>
      <td class="col-acesso muted">${esc(quando(m.ultimo_acesso))}</td>
      <td class="acoes">${m.pode_redefinir ? '<button class="btn small" type="button" data-acao="senha">Senha nova</button>' : ''}<button class="btn small danger" type="button" data-acao="tirar">Tirar</button></td>
    </tr>`).join('')}</tbody></table>`;
}

// Mostra os dados de acesso UMA vez, com botão de copiar tudo pronto para mandar à pessoa.
function mostrarCredencial(titulo, email, senha){
  const endereco = location.origin + location.pathname.replace(/[^/]*$/, '');
  const texto = `Acesso ao sistema de precificação\nEndereço: ${endereco}\nE-mail: ${email}\nSenha provisória: ${senha}\nNo primeiro acesso, o sistema pede para você criar a sua própria senha.`;
  $('credencial').innerHTML = `<div class="v2-credencial">
    <b>${esc(titulo)}</b> Passe estes dados para a pessoa. A senha não aparece de novo.
    <dl><dt>Endereço</dt><dd>${esc(endereco)}</dd><dt>E-mail</dt><dd>${esc(email)}</dd><dt>Senha provisória</dt><dd>${esc(senha)}</dd></dl>
    <button class="btn small" type="button" id="btnCopiarCredencial">Copiar tudo</button>
    <p class="sub">No primeiro acesso o sistema pede para ela criar uma senha própria.</p></div>`;
  $('btnCopiarCredencial').onclick = async ()=>{
    try{ await navigator.clipboard.writeText(texto); $('btnCopiarCredencial').textContent = 'Copiado'; }
    catch(_){ prompt('Copie os dados abaixo:', texto.replace(/\n/g, ' | ')); }
  };
  $('credencial').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

$('formIncluir').onsubmit = async (e)=>{
  e.preventDefault();
  const botao = $('btnIncluir');
  const nome = $('novoNome').value.trim(), email = $('novoEmail').value.trim(), papel = $('novoPapel').value;
  $('erroIncluir').textContent = '';
  $('credencial').innerHTML = '';
  botao.disabled = true; botao.textContent = 'Incluindo...';
  try{
    const r = await incluirNaEquipe(atual.id, { nome, email, papel });
    if(r.conta_nova) mostrarCredencial(`${nome} foi incluído(a) como ${PAPEIS[papel].toLowerCase()}.`, r.email, r.senha_provisoria);
    else $('credencial').innerHTML = `<div class="v2-credencial"><b>${esc(nome)} foi incluído(a) como ${esc(PAPEIS[papel].toLowerCase())}.</b> Essa pessoa já tinha conta: ela entra com o e-mail <b>${esc(r.email)}</b> e a senha que já usa.</div>`;
    $('formIncluir').reset();
    await desenharEquipe();
  }catch(err){
    $('erroIncluir').textContent = err.message;
  }finally{
    botao.disabled = false; botao.textContent = 'Incluir';
  }
};

$('tabelaEquipe').addEventListener('change', async (e)=>{
  const sel = e.target.closest('select[data-acao="papel"]');
  if(!sel) return;
  const tr = sel.closest('tr'), novo = sel.value;
  const aviso = tr.dataset.eu === '1' && tr.dataset.papel === 'dono' && novo !== 'dono'
    ? 'Você vai deixar de ser dono e não verá mais esta tela. Continuar?'
    : `Mudar ${tr.dataset.nome} para ${PAPEIS[novo]}?`;
  if(!confirm(aviso)){ sel.value = tr.dataset.papel; return; }
  sel.disabled = true;
  try{
    await alterarPapel(atual.id, tr.dataset.user, novo);
    if(tr.dataset.eu === '1'){ atual.papel = await meuPapel(atual.id); if(atual.papel !== 'dono' && atual.papel !== 'admin') return mostrarProdutos(); }
    await desenharEquipe();
  }catch(err){
    alert(err.message);
    sel.value = tr.dataset.papel; sel.disabled = false;
  }
});

$('tabelaEquipe').addEventListener('click', async (e)=>{
  const b = e.target.closest('button[data-acao]');
  if(!b) return;
  const tr = b.closest('tr');
  if(b.dataset.acao === 'senha'){
    if(!confirm(`Gerar uma senha provisória nova para ${tr.dataset.nome}? A senha atual deixa de funcionar e a pessoa sai de todos os aparelhos em até 1 hora.`)) return;
    b.disabled = true;
    try{
      const r = await gerarSenhaProvisoria(tr.dataset.user);
      mostrarCredencial(`Senha nova de ${tr.dataset.nome}.`, tr.dataset.email, r.senha_provisoria);
    }catch(err){ alert(err.message); }
    finally{ b.disabled = false; }
  }
  if(b.dataset.acao === 'tirar'){
    const eu = tr.dataset.eu === '1';
    if(!confirm(eu ? 'Tirar VOCÊ desta empresa? Você perde o acesso a ela na hora.'
                   : `Tirar ${tr.dataset.nome} da equipe? A pessoa perde o acesso a esta empresa na hora (a conta dela continua existindo).`)) return;
    b.disabled = true;
    try{
      await removerDaEquipe(atual.id, tr.dataset.user);
      if(eu){ guarda.apagar(); location.reload(); return; }
      await desenharEquipe();
    }catch(err){ alert(err.message); b.disabled = false; }
  }
});

// ---------------------------------------------------------------- minha conta
// obrigatoria = entrou com senha provisória: só sai daqui criando a própria senha (ou saindo)
async function abrirConta(obrigatoria){
  const u = await usuarioAtual();
  mostra('telaConta');
  $('btnTrocar').hidden = true;
  $('btnConta').hidden = obrigatoria;
  $('titulo').textContent = obrigatoria ? 'Bem-vindo(a)' : 'Minha conta';
  $('subtitulo').textContent = u.email;
  $('tituloConta').textContent = obrigatoria ? 'Crie a sua senha' : 'Minha conta';
  $('avisoConta').textContent = obrigatoria ? 'Você entrou com uma senha provisória. Crie uma senha só sua para continuar.' : '';
  $('formNome').hidden = obrigatoria;
  $('rodapeConta').hidden = obrigatoria;
  $('meuNome').value = (u.user_metadata && u.user_metadata.nome) || '';
  $('contaEmail').value = u.email;
  $('senhaNova').value = ''; $('senhaRepete').value = '';
  $('msgConta').textContent = ''; $('msgConta').className = '';
  $('formSenha').dataset.obrigatoria = obrigatoria ? '1' : '';
}
function avisoConta(texto, ok){ $('msgConta').textContent = texto; $('msgConta').className = ok ? 'pos' : 'neg'; }

$('formSenha').onsubmit = async (e)=>{
  e.preventDefault();
  const s = $('senhaNova').value;
  if(s.length < 8) return avisoConta('A senha precisa ter pelo menos 8 caracteres.');
  if(s !== $('senhaRepete').value) return avisoConta('As duas senhas não são iguais.');
  try{
    await trocarMinhaSenha(s);
    $('senhaNova').value = ''; $('senhaRepete').value = '';
    if($('formSenha').dataset.obrigatoria){ $('btnConta').hidden = false; await iniciar(); return; }
    avisoConta('Senha trocada.', true);
  }catch(err){ avisoConta(err.message); }
};
$('formNome').onsubmit = async (e)=>{
  e.preventDefault();
  try{ await alterarMeuNome($('meuNome').value.trim()); avisoConta('Nome salvo.', true); }
  catch(err){ avisoConta(err.message); }
};
$('btnVoltarConta').onclick = ()=> atual.dados ? mostrarProdutos() : iniciar();

// ---------------------------------------------------------------- ações
$('formLogin').onsubmit = async (e)=>{
  e.preventDefault();
  $('erroLogin').textContent = '';
  try{ await entrar($('email').value.trim(), $('senha').value); await iniciar(); }
  catch(err){ $('erroLogin').textContent = err.message; }
};
// Sem servidor de e-mail próprio o Supabase não entrega e-mails a clientes: a senha nova
// sai pela tela de Equipe, gerada por quem gerencia a empresa.
$('btnEsqueci').onclick = ()=>{
  $('erroLogin').textContent = 'Peça ao dono da sua empresa (ou ao administrador) uma senha provisória nova: fica em Equipe → Senha nova.';
};
$('btnSair').onclick = async ()=>{ await sair(); guarda.apagar(); location.reload(); };
$('btnTrocar').onclick = async ()=>{
  guarda.apagar();
  mostrarEmpresas(await listarEmpresas(), await ehAdmin());
};
$('btnEquipe').onclick = ()=> abrirEquipe();
$('btnVoltarProdutos').onclick = ()=> mostrarProdutos();
$('btnConta').onclick = ()=> abrirConta(false);
$('btnNovaEmpresa').onclick = async ()=>{
  const nome = prompt('Nome da empresa:');
  if(!nome || !nome.trim()) return;
  try{ const e = await criarEmpresa(nome.trim()); abrirEmpresa(e.id); }
  catch(err){ alert(mensagemDeErro(err)); }
};

iniciar().catch(err=>{
  mostra('telaLogin');
  $('erroLogin').textContent = mensagemDeErro(err);
});
