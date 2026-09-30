// Gera js/sistema.js a partir da v1 (../index.html).
//
// A tela da v2 é a da v1. Em vez de uma cópia editada à mão (que ficaria para trás a cada correção
// na v1), este script pega o código da v1 e troca SÓ os trechos que conversavam com a planilha do
// Google -- cada troca achada por uma linha-âncora exata. Se a v1 mudar num desses trechos, o script
// para e avisa qual âncora sumiu, em vez de gerar algo pela metade.
//
// Uso: node ferramentas/gerar-sistema.js       (rodar de dentro da pasta v2)
// Os trechos novos ficam em ferramentas/porte/*.js.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const V1 = path.join(RAIZ, '..', 'index.html');
const PORTE = path.join(__dirname, 'porte');
const SAIDA = path.join(RAIZ, 'js', 'sistema.js');

const html = fs.readFileSync(V1, 'utf8').replace(/\r\n/g, '\n');
const ini = html.indexOf('<script>\n');
const fim = html.lastIndexOf('</script>');
if(ini < 0 || fim < 0) throw new Error('Não achei o <script> da v1.');
let linhas = html.slice(ini + '<script>\n'.length, fim).replace(/\n$/, '').split('\n');

const arquivo = nome => fs.readFileSync(path.join(PORTE, nome), 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '');

// Troca de "de" (linha exata, única no arquivo) até "ate": a própria linha (null), a primeira linha
// exata depois dela (texto), ou um caminho de linhas (lista: cada uma é a primeira depois da anterior).
// "fimDoArquivo": até a última linha.
function troca(nome, de, ate, por){
  const achadas = [];
  linhas.forEach((l, i)=>{ if(l === de) achadas.push(i); });
  if(achadas.length !== 1) throw new Error(`[${nome}] a linha-âncora aparece ${achadas.length} vez(es) na v1: ${JSON.stringify(de)}`);
  const i0 = achadas[0];
  let i1 = i0;
  if(ate === 'fimDoArquivo') i1 = linhas.length - 1;
  else if(ate !== null){
    for(const alvo of (Array.isArray(ate) ? ate : [ate])){
      const j = linhas.indexOf(alvo, i1 + 1);
      if(j < 0) throw new Error(`[${nome}] depois de ${JSON.stringify(de)} não achei ${JSON.stringify(alvo)}`);
      i1 = j;
    }
  }
  const novas = por === '' ? [] : por.split('\n');
  linhas.splice(i0, i1 - i0 + 1, ...novas);
}

// ---------------------------------------------------------------- as trocas
troca('chave local', "const STORAGE_KEY = 'mkt_pricing_system_v1';", null,
  "const STORAGE_KEY = 'precificacao_v2';");

troca('ids no formato do banco',
  "function novoId(){ return 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }", null,
  `// Na v2 os ids são UUID, o formato das chaves do banco: cada item já nasce com o id que terá lá.
function novoId(){
  if(window.crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x=> x.toString(16).padStart(2, '0')).join('');
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
}`);
troca('id de produto novo (normalizeProduct)', "  p.id = String(p.id || ('p_' + novoId()));", null, "  p.id = String(p.id || novoId());");
troca('id de produto novo (formulário)', "      alvo = normalizeProduct(Object.assign({}, pr, {id: 'p_' + novoId(), listings}));", null,
  "      alvo = normalizeProduct(Object.assign({}, pr, {id: novoId(), listings}));");
troca('id de produto novo (lote)',
  "      state.products.push(normalizeProduct({id: 'p_' + novoId(), sku: r.sku, name: r.name.trim(), cogs: r.cogs, costOverride: false,", null,
  "      state.products.push(normalizeProduct({id: novoId(), sku: r.sku, name: r.name.trim(), cogs: r.cogs, costOverride: false,");
troca('id de produto novo (importação)',
  "      alvo.prod = normalizeProduct({id: 'p_' + novoId(), sku: alvo.sku, name: c.name, listings: []});", null,
  "      alvo.prod = normalizeProduct({id: novoId(), sku: alvo.sku, name: c.name, listings: []});");
troca('chave interna de marketplace novo',
  "    id: idNovo, uid: 'u' + novoId(), idManual: false, color: palette[state.profiles.length % palette.length],", null,
  "    id: idNovo, uid: novoId(), idManual: false, color: palette[state.profiles.length % palette.length],");

// A base (o banco como ele é) não ganha marketplaces de fábrica: só a tela de uma empresa vazia.
troca('normalizeState sem padrão', 'function normalizeState(s){', null, 'function normalizeState(s, semPadrao){');
troca('normalizeState sem padrão (2)', '  if(s.profiles.length === 0) s.profiles = defaultProfiles();', null,
  '  if(s.profiles.length === 0 && !semPadrao) s.profiles = defaultProfiles();');

troca('estado inicial vazio', 'function loadState(){', '}',
  `// Na v2 o estado vem do banco, ao abrir a empresa (iniciarSistema). Até lá, fica vazio.
function loadState(){
  return {profiles: [], products: [], padroes: normalizePadroes({}), selectedSkuId: null};
}`);
troca('aviso de reorganização sem gravar local', 'function avisaMigracao(){', '}',
  `function avisaMigracao(){
  const m = state._migracao;
  if(!m) return;
  delete state._migracao;
  toast(\`\${m.cadastros} cadastros por marketplace viraram \${m.produtos} produto(s), cada um com seus anúncios.\`
    + (m.separados ? \` \${m.separados} SKU(s) ficaram em mais de um produto porque o custo era diferente entre marketplaces -- confira e junte à mão se for o mesmo item.\` : ''),
    m.separados ? 'warn' : 'ok', 'Catálogo reorganizado');
}`);

troca('estado, gravação e fila', '// O que vai para a planilha: a lista de produtos achatada em uma linha por anúncio, com o',
  ['function scheduleSync(){', '}'], arquivo('01-estado.js'));

troca('base da planilha -> só o IndexedDB',
  '// ---------- a "base": como a planilha estava na última vez que este navegador falou com ela ----------',
  'function esquecerBase(){ baseSync = null; baseCarregada = Promise.resolve(); idb.del(BASE_KEY); store.del(BASE_KEY); }',
  '');
// o objeto idb continua (é usado pelo rascunho): ele estava dentro do trecho tirado acima
linhas.splice(linhas.indexOf('// Texto canônico (chaves em ordem) para comparar objetos sem depender da ordem das propriedades.'), 0,
  ...arquivo('00-idb.js').split('\n'), '');

troca('temPendencia da planilha',
  'function temPendencia(){ return !!baseSync && assinaturaDados(dadosDe(state)) !== assinaturaDados(baseSync.dados); }', null, '');
troca('autor sem carimbo novo',
  "  if(bo && ro && bo.alteradoEm === ro.alteradoEm && bo.alteradoPor === ro.alteradoPor) return 'alguém direto na planilha';", null,
  "  if(bo && ro && bo.alteradoEm === ro.alteradoEm && bo.alteradoPor === ro.alteradoPor) return 'a importação da versão 1';");
troca('aplicarDados sem gravar local', '  versaoDados++;   // dados novos: resultados guardados não valem mais',
  "  if(document.getElementById('view-padroes').classList.contains('active')) renderPadroes();",
  `  versaoDados++;   // dados novos: resultados guardados não valem mais
  renderProdutos();
  if(document.getElementById('view-marketplaces').classList.contains('active')) renderMarketplaces();
  if(document.getElementById('view-padroes').classList.contains('active')) renderPadroes();
  if(document.getElementById('view-ml').classList.contains('active')) renderML();`);
troca('aviso de formulário desatualizado',
  "  p.textContent = 'A planilha foi atualizada enquanto este formulário estava aberto, e os valores na tela podem estar velhos. Ao salvar, só o que você mudou aqui é gravado: o resto fica como está agora. Para ver os valores novos, cancele e abra de novo.';", null,
  "  p.textContent = 'Outra pessoa salvou alterações enquanto este formulário estava aberto, e os valores na tela podem estar velhos. Ao salvar, só o que você mudou aqui é gravado: o resto fica como está agora. Para ver os valores novos, cancele e abra de novo.';");
troca('carimbo feito pelo banco',
  '// Marca quem mudou cada item alterado desde a última sincronização e monta as linhas do histórico.',
  ['function carimbarAlteracoes(){', '}'], '');
troca('conflitos: onde ver',
  "  toast(`${novos.length === 1 ? 'Um item foi alterado' : novos.length + ' itens foram alterados'} aqui e por outra pessoa ao mesmo tempo. Juntei tudo; confira em Sincronização → Conflitos.`, 'warn', 'Alterações juntadas');", null,
  "  toast(`${novos.length === 1 ? 'Um item foi alterado' : novos.length + ' itens foram alterados'} aqui e por outra pessoa ao mesmo tempo. Juntei tudo; confira em Histórico → Conflitos.`, 'warn', 'Alterações juntadas');");

troca('conversa com o banco', '// ---------- conversa com a planilha ----------', ['async function conferirSeMudou(){', '}'],
  arquivo('02-banco.js'));
troca('selo e tela de sincronização', 'function renderSyncPill(forceState){', ['function renderSyncView(){', '}'], '');
troca('histórico e usuário', 'function renderHistorico(){', ['function pedirNome(){', '}'], arquivo('03-historico.js'));

troca('seções novas',
  "  sync:       {titulo:'Sincronização', sub:'Planilha do Google como banco de dados, para os dados não morarem só neste navegador.'}", null,
  `  historico:  {titulo:'Histórico', sub:'Quem mudou o quê e quando, e as alterações feitas ao mesmo tempo por duas pessoas.'},
  equipe:     {titulo:'Equipe', sub:'Quem acessa esta empresa e o que cada um pode fazer.'},
  conta:      {titulo:'Minha conta', sub:'Seu nome no histórico e a sua senha.'}`);
troca('abrir seções novas', "  if(view==='sync') renderSyncView();", null,
  `  if(view==='historico') renderHistoricoView();
  if(view==='equipe') renderEquipe();
  if(view==='conta') renderConta();`);
troca('seleção lembrada por empresa',
  'const salvarSelecaoDepois = debounce(()=> store.set(STORAGE_KEY, JSON.stringify(state)), 400);', null,
  "const salvarSelecaoDepois = debounce(()=>{ if(empresa) store.set(STORAGE_KEY + ':sel:' + empresa.id, state.selectedSkuId || ''); }, 400);");

troca('Mercado Livre: servidor',
  '// Endereço da página retorno.html publicada junto com este sistema. É ela que permite usar uma URL',
  ['async function mlDesconectar(){', '}'], arquivo('04-ml.js'));
troca('Mercado Livre: conexão',
  '  // Script antigo na planilha: a tela é nova, mas quem guarda a URL de retorno e consulta o envio é',
  '      </ol>`;', arquivo('04b-ml-conexao.js'));
troca('Mercado Livre: texto da conexão',
  '      <p class="sub">A senha da sua aplicação (Client Secret) fica guardada na planilha, no Apps Script &mdash; nunca nesta página, que é pública. É o Apps Script que conversa com o Mercado Livre.</p>', null,
  '      <p class="sub">A autorização fica guardada no servidor, nunca nesta página. É o servidor que conversa com o Mercado Livre, em nome desta empresa.</p>');
troca('Mercado Livre: sem aviso de versão', '      ${avisoVersao}${conexao}', null, '      ${conexao}');
troca('Mercado Livre: sem guardar aplicação', "  liga('mlSalvarApp', mlGuardarApp);", null, '');
troca('Mercado Livre: sem retorno compartilhado', "  liga('mlUsarRetornoComum', ()=>{", '  });', '');

troca('backup: restaurar', "document.getElementById('importFile').addEventListener('change', (e)=>{", '});', arquivo('06-backup.js'));
troca('sem padrão de fábrica', "document.getElementById('resetBtn').onclick = ()=>{", '};', '');

troca('planilha do Google', '// ---------- SINCRONIZAÇÃO (Google Sheets) ----------', ['function renderStorageNote(){', '}'], '');
troca('início', '// ---------- init ----------', 'fimDoArquivo', arquivo('05-inicio.js'));

// ---------------------------------------------------------------- confere e grava
const texto = linhas.join('\n');
const proibidos = ['gasUrl', 'baseSync', 'revPlanilha', 'GAS_CODE', 'pullFromSheets', 'Apps Script da planilha', 'resetBtn'];
const sobrou = proibidos.filter(p=> texto.includes(p));
if(sobrou.length) throw new Error('Ainda há restos da planilha no código gerado: ' + sobrou.join(', '));

const cabecalho = `// ============================================================================
// GERADO por ferramentas/gerar-sistema.js a partir da v1 (index.html). NÃO EDITE À MÃO:
// mude a v1 ou os trechos em ferramentas/porte/ e rode o gerador de novo.
//
// É o código da tela da v1, com a conversa com a planilha do Google trocada pela conversa com o
// banco de dados (ferramentas/porte/02-banco.js).
// ============================================================================
`;
fs.writeFileSync(SAIDA, cabecalho + texto + '\n');
console.log('js/sistema.js gerado: ' + linhas.length + ' linhas.');

// ---------------------------------------------------------------- a página (index.html)
// O corpo da página da v1 (ícones, menu, seções, painel lateral), com as mesmas trocas: a seção
// da planilha vira Histórico, Equipe e Minha conta, e a porta de entrada (login) vem na frente.
const corpoIni = html.indexOf('<svg style="display:none">');
const corpoFim = html.indexOf('<script>\n');
linhas = html.slice(corpoIni, corpoFim).replace(/\n+$/, '').split('\n');
const htmlArquivo = nome => arquivo(nome);

troca('menu: histórico e equipe',
  '    <button class="navitem" data-view="sync"><svg class="ic"><use href="#i-sync"/></svg>Sincronização</button>', null,
  `    <button class="navitem" data-view="historico"><svg class="ic"><use href="#i-sync"/></svg>Histórico</button>
    <button class="navitem" data-view="equipe" data-so-gerente hidden><svg class="ic"><use href="#i-box"/></svg>Equipe</button>
    <a class="navlink" href="migrar.html" data-so-admin hidden><svg class="ic"><use href="#i-sync"/></svg>Migração da v1</a>`);
troca('rodapé: empresa e sair', '    <button class="userbtn" id="usuarioBtn" type="button"></button>', null,
  `    <button class="userbtn" id="usuarioBtn" type="button"></button>
    <div class="empresa-atual"><span class="muted">Empresa</span> <b id="empresaNome"></b>
      <button class="btn small ghost" type="button" id="btnTrocarEmpresa">Trocar</button>
      <button class="btn small ghost" type="button" id="btnSairSistema">Sair</button></div>`);
troca('backup: texto',
  '        <p class="sub">O arquivo é local a este navegador. Exporte um backup em JSON antes de limpar o cache, trocar de computador ou atualizar este arquivo HTML.</p>', null,
  '        <p class="sub">Os dados ficam no banco de dados. O backup em JSON é uma cópia extra, para guardar onde você quiser. Restaurar troca o catálogo inteiro da empresa (só o dono ou o administrador).</p>');
troca('backup: sem padrão de fábrica', '          <button class="btn danger" id="resetBtn">Restaurar padrão de fábrica</button>', null, '');
troca('seções novas', '    <section id="view-sync" class="view">', '    </section>', htmlArquivo('html-secoes.html'));

const pagina = htmlArquivo('html-cabeca.html') + '\n' + linhas.join('\n') + '\n' + htmlArquivo('html-porta.html') + `

<script src="js/sistema.js"></script>
<script type="module" src="js/inicio.js"></script>
</body>
</html>
`;
if(/gasUrlInput|resetBtn|view-sync/.test(pagina)) throw new Error('Ainda há restos da planilha na página gerada.');
fs.writeFileSync(path.join(RAIZ, 'index.html'), pagina);
console.log('index.html gerado.');
