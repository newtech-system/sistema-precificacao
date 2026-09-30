// ============================================================================
// Versão 2 -- login, escolha da empresa e catálogo com os preços calculados.
// Esta primeira etapa é só leitura: serve para validar banco, acesso e cálculo com dados
// reais migrados, antes de portar as telas de edição.
// ============================================================================
import { entrar, sair, usuarioAtual, ehAdmin, listarEmpresas, criarEmpresa, carregarEmpresa, redefinirSenha,
  custosDaEmpresaV1, perfilV1, visaoV1, mensagemDeErro } from './banco.js';
import { calcSku, definirCustosDaEmpresa, brl, pct } from './calculo.js';

const $ = id => document.getElementById(id);
const esc = v => String(v === undefined || v === null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const CHAVE_EMPRESA = 'precificacao_v2_empresa';
const LIMITE_LINHAS = 300;   // a tabela desenha em blocos; catálogo grande não trava

function mostra(tela){
  ['telaLogin', 'telaEmpresas', 'telaProdutos'].forEach(id=> $(id).hidden = id !== tela);
}

async function iniciar(){
  const u = await usuarioAtual();
  $('btnSair').hidden = !u;
  $('quem').textContent = u ? u.email : '';
  if(!u){ mostra('telaLogin'); return; }
  const admin = await ehAdmin();
  $('lnkMigrar').hidden = !admin;
  $('acoesAdmin').hidden = !admin;
  const empresas = await listarEmpresas();
  const guardada = localStorage.getItem(CHAVE_EMPRESA);
  if(empresas.length === 1) return abrirEmpresa(empresas[0].id);
  if(guardada && empresas.some(e=> e.id === guardada)) return abrirEmpresa(guardada);
  mostrarEmpresas(empresas, admin);
}

function mostrarEmpresas(empresas, admin){
  mostra('telaEmpresas');
  $('btnTrocar').hidden = true;
  $('titulo').textContent = 'Escolha a empresa';
  $('subtitulo').textContent = admin ? 'Como administrador, você vê todas.' : '';
  $('listaEmpresas').innerHTML = empresas.length
    ? empresas.map(e=> `<button class="card v2-empresa" type="button" data-empresa="${esc(e.id)}"><b>${esc(e.nome)}</b></button>`).join('')
    : '<p class="sub">Nenhuma empresa ainda.' + (admin ? ' Crie uma, ou use a Migração para trazer um cliente da versão 1.' : ' Peça ao administrador para te incluir numa.') + '</p>';
  $('listaEmpresas').querySelectorAll('[data-empresa]').forEach(b=> b.onclick = ()=> abrirEmpresa(b.dataset.empresa));
}

async function abrirEmpresa(id){
  mostra('telaProdutos');
  $('tabela').innerHTML = '<p class="sub" style="padding:16px;">Carregando...</p>';
  try{
    const d = await carregarEmpresa(id);
    localStorage.setItem(CHAVE_EMPRESA, id);
    $('titulo').textContent = d.empresa.nome;
    $('subtitulo').textContent = `${d.produtos.length} produto(s), ${d.anuncios.length} anúncio(s)`;
    $('btnTrocar').hidden = false;
    desenharProdutos(d);
  }catch(err){
    $('tabela').innerHTML = `<p class="neg" style="padding:16px;">${esc(mensagemDeErro(err))}</p>`;
  }
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
    <div class="metric ${validos && somaMargem / validos >= 0 ? 'ok' : 'bad'}"><div class="k">Margem média</div><div class="v">${pct(validos ? somaMargem / validos : 0)}</div><div class="f">sobre o valor recebido</div></div>
    <div class="metric ${prejuizo ? 'bad' : 'ok'}"><div class="k">Anúncios no prejuízo</div><div class="v">${prejuizo}</div><div class="f">${prejuizo ? 'revise preço ou custo' : 'nenhum no vermelho'}</div></div>`;
  const mostrar = linhas.slice(0, LIMITE_LINHAS);
  $('tabela').innerHTML = linhas.length ? `<table class="tabela-produtos">
      <thead><tr><th>Produto</th><th class="num">Custo</th><th>Marketplace</th><th class="num">Preço</th><th class="num">Lucro</th><th class="num">Margem</th></tr></thead>
      <tbody>${mostrar.join('')}</tbody></table>
      ${linhas.length > LIMITE_LINHAS ? `<p class="sub" style="padding:10px 14px;">Mostrando ${LIMITE_LINHAS} de ${linhas.length} anúncios.</p>` : ''}`
    : '<p class="sub" style="padding:16px;">Nenhum produto nesta empresa ainda.</p>';
}

// ---------------------------------------------------------------- ações
$('formLogin').onsubmit = async (e)=>{
  e.preventDefault();
  $('erroLogin').textContent = '';
  try{ await entrar($('email').value.trim(), $('senha').value); await iniciar(); }
  catch(err){ $('erroLogin').textContent = err.message; }
};
$('btnEsqueci').onclick = async ()=>{
  const email = $('email').value.trim();
  if(!email){ $('erroLogin').textContent = 'Digite o seu e-mail acima primeiro.'; return; }
  try{ await redefinirSenha(email); $('erroLogin').textContent = 'Se o e-mail estiver cadastrado, chega um link para criar uma senha nova.'; }
  catch(err){ $('erroLogin').textContent = err.message; }
};
$('btnSair').onclick = async ()=>{ await sair(); localStorage.removeItem(CHAVE_EMPRESA); location.reload(); };
$('btnTrocar').onclick = async ()=>{
  localStorage.removeItem(CHAVE_EMPRESA);
  mostrarEmpresas(await listarEmpresas(), await ehAdmin());
};
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
