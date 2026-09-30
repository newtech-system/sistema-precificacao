// ============================================================================
// Camada de dados: tudo que conversa com o banco passa por aqui. As telas não montam
// consultas: pedem "carregue a empresa", "salve o produto" -- assim uma mudança no banco
// muda um arquivo só.
// ============================================================================
import { SUPABASE_URL, SUPABASE_CHAVE_PUBLICA, SCHEMA, SUPABASE_JS } from './config.js';

const { createClient } = await import(SUPABASE_JS);

export const sb = createClient(SUPABASE_URL, SUPABASE_CHAVE_PUBLICA, {
  db: { schema: SCHEMA },
  auth: { persistSession: true, autoRefreshToken: true }
});

// Erro do banco em português, com o que fazer quando dá para saber.
export function mensagemDeErro(err){
  const m = (err && (err.message || err.error_description)) || String(err);
  if(/Invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
  if(/Email not confirmed/i.test(m)) return 'E-mail ainda não confirmado. Veja a caixa de entrada.';
  if(/schema must be one of|Invalid schema|PGRST106/i.test(m))
    return 'O banco ainda não libera o compartimento "precificacao" para o sistema. No painel do Supabase: Project Settings → API (Data API) → Exposed schemas → acrescente "precificacao" e salve.';
  if(/Failed to fetch|NetworkError|Load failed|Failed to send a request/i.test(m)) return 'Sem conexão com o banco agora. Tente de novo em instantes.';
  if(/should be different from the old password/i.test(m)) return 'A senha nova precisa ser diferente da atual.';
  const curta = m.match(/Password should be at least (\d+)/i);
  if(curta) return `A senha precisa ter pelo menos ${curta[1]} caracteres.`;
  if(/weak|pwned|leaked/i.test(m)) return 'Senha fraca demais ou já vazada na internet. Escolha outra.';
  if(/row-level security|permission denied/i.test(m)) return 'Seu usuário não tem permissão para isso nesta empresa.';
  return m;
}
function checa({ data, error }){
  if(error) throw new Error(mensagemDeErro(error));
  return data;
}

// ---------------------------------------------------------------- sessão
export async function entrar(email, senha){
  return checa(await sb.auth.signInWithPassword({ email, password: senha }));
}
export async function sair(){ await sb.auth.signOut(); }
export async function usuarioAtual(){
  const { data } = await sb.auth.getUser();
  return data ? data.user : null;
}
export async function ehAdmin(){
  const u = await usuarioAtual();
  if(!u) return false;
  const linhas = checa(await sb.from('administradores').select('user_id').eq('user_id', u.id));
  return linhas.length > 0;
}
// Senha própria no lugar da provisória (ou troca normal). Desliga o aviso de "troque a senha".
export async function trocarMinhaSenha(senha){
  return checa(await sb.auth.updateUser({ password: senha, data: { trocar_senha: false } }));
}
// O nome que o banco grava em "alterado por": o da equipe, o da conta ou o e-mail (a mesma ordem
// da função nome_de_quem no banco).
export async function meuNome(u){
  const r = checa(await sb.from('membros').select('nome').eq('user_id', u.id).not('nome', 'is', null).limit(1));
  return (r[0] && r[0].nome) || (u.user_metadata && u.user_metadata.nome) || u.email;
}
// Nome que aparece no histórico ("alterado por"), em todas as empresas da pessoa.
export async function alterarMeuNome(nome){
  checa(await sb.rpc('alterar_meu_nome', { p_nome: nome }));
  checa(await sb.auth.updateUser({ data: { nome } }));
}

// ---------------------------------------------------------------- equipe
// Criar conta e gerar senha provisória exigem a chave secreta: vão pela Edge Function.
// O resto são funções do banco que conferem a permissão e registram no histórico.
async function chamarEquipe(corpo){
  const { data, error } = await sb.functions.invoke('precificacao-equipe', { body: corpo });
  if(error){
    let m = error.message;
    try{ const j = await error.context.json(); if(j && j.erro) m = j.erro; }catch(_){ /* resposta sem corpo */ }
    throw new Error(mensagemDeErro({ message: m }));
  }
  return data;
}
export function incluirNaEquipe(empresaId, { nome, email, papel }){
  return chamarEquipe({ acao: 'incluir', empresa_id: empresaId, nome, email, papel });
}
export function gerarSenhaProvisoria(userId){
  return chamarEquipe({ acao: 'redefinir_senha', user_id: userId });
}
// 'admin' (administrador geral), 'dono', 'editor', 'leitor' ou null (sem acesso)
export async function meuPapel(empresaId){
  return checa(await sb.rpc('meu_papel', { p_empresa: empresaId }));
}
export async function listarEquipe(empresaId){
  return checa(await sb.rpc('equipe', { p_empresa: empresaId }));
}
export async function alterarPapel(empresaId, userId, papel){
  checa(await sb.rpc('alterar_papel', { p_empresa: empresaId, p_user: userId, p_papel: papel }));
}
export async function removerDaEquipe(empresaId, userId){
  checa(await sb.rpc('remover_da_equipe', { p_empresa: empresaId, p_user: userId }));
}

// ---------------------------------------------------------------- empresas
export async function listarEmpresas(){
  return checa(await sb.from('empresas').select('id, nome, criado_em').order('nome'));
}
export async function criarEmpresa(nome){
  return checa(await sb.from('empresas').insert({ nome }).select('id, nome').single());
}

// Lê uma tabela inteira da empresa em páginas de mil linhas (o limite por consulta do banco).
// Catálogo grande não trava a tela nem estoura o limite. A ordem pela chave é obrigatória: sem
// ordem fixa, o banco pode devolver as páginas em ordens diferentes e repetir ou pular linhas.
const CHAVE = { ml_vinculos: 'anuncio_id' };
async function tudoDaEmpresa(tabela, empresaId, colunas = '*'){
  const PAGINA = 1000;
  const saida = [];
  for(let de = 0; ; de += PAGINA){
    const pagina = checa(await sb.from(tabela).select(colunas).eq('empresa_id', empresaId)
      .order(CHAVE[tabela] || 'id').range(de, de + PAGINA - 1));
    saida.push(...pagina);
    if(pagina.length < PAGINA) break;
  }
  return saida;
}

// Tudo de uma empresa, em paralelo (inclusive marketplaces removidos, dos anúncios órfãos).
export async function carregarEmpresa(empresaId){
  const [empresas, marketplaces, produtos, anuncios, vinculos] = await Promise.all([
    sb.from('empresas').select('*').eq('id', empresaId).then(checa),
    tudoDaEmpresa('marketplaces', empresaId),
    tudoDaEmpresa('produtos', empresaId),
    tudoDaEmpresa('anuncios', empresaId),
    tudoDaEmpresa('ml_vinculos', empresaId)
  ]);
  if(!empresas.length) throw new Error('Empresa não encontrada ou sem acesso.');
  return { empresa: empresas[0], marketplaces, produtos, anuncios, vinculos };
}

// Só algumas linhas, pelo id (o que outra pessoa acabou de mudar). Em blocos de 150 ids para a
// consulta não passar do tamanho de endereço que o servidor aceita.
export async function lerPorIds(tabela, ids){
  const saida = [];
  for(let i = 0; i < ids.length; i += 150){
    saida.push(...checa(await sb.from(tabela).select('*').in(CHAVE[tabela] || 'id', ids.slice(i, i + 150))));
  }
  return saida;
}
export async function lerEmpresa(empresaId){
  const r = checa(await sb.from('empresas').select('*').eq('id', empresaId));
  return r[0] || null;
}

// Grava um lote de alterações (ver a função "salvar" no banco). Devolve uma resposta por operação.
export async function salvarLote(empresaId, ops){
  return checa(await sb.rpc('salvar', { p_empresa: empresaId, p_ops: ops }));
}
export async function avisarRecarregar(empresaId){
  checa(await sb.rpc('avisar_recarregar', { p_empresa: empresaId }));
}

// Canal da empresa: cada gravação de qualquer pessoa manda UM aviso com a lista do que mudou.
// quandoMudar(payload) recebe {mudou:[{t,id,v}]} ou {recarregar:true}; quandoStatus(status) recebe
// 'SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT' ou 'CLOSED'.
export async function abrirCanal(empresaId, quandoMudar, quandoStatus){
  await sb.realtime.setAuth();
  const canal = sb.channel('precificacao:' + empresaId, { config: { private: true } })
    .on('broadcast', { event: 'mudou' }, (m)=> quandoMudar(m.payload || {}))
    .subscribe((status)=> quandoStatus && quandoStatus(status));
  return ()=> sb.removeChannel(canal);
}
// A sessão renova o token de tempos em tempos; o canal precisa do novo para não cair.
sb.auth.onAuthStateChange((evento, sessao)=>{
  if(evento === 'TOKEN_REFRESHED' && sessao) sb.realtime.setAuth(sessao.access_token);
});

// Histórico de alterações da empresa, do mais novo para o mais antigo, em páginas.
export async function listarHistorico(empresaId, { antesDoId = null, limite = 200 } = {}){
  let q = sb.from('historico').select('id, tabela, registro_id, acao, quem_nome, quando, antes, depois')
    .eq('empresa_id', empresaId).order('id', { ascending: false }).limit(limite);
  if(antesDoId) q = q.lt('id', antesDoId);
  return checa(await q);
}

// ---------------------------------------------------------------- Mercado Livre (Edge Function)
export async function chamarML(corpo){
  const { data, error } = await sb.functions.invoke('precificacao-ml', { body: corpo });
  if(error){
    let m = error.message;
    try{ const j = await error.context.json(); if(j && j.erro) m = j.erro; }catch(_){ /* resposta sem corpo */ }
    throw new Error(mensagemDeErro({ message: m }));
  }
  return data;
}

// ---------------------------------------------------------------- importação da v1 (só administrador)
export async function importarLoteV1(empresaId, dados, migracaoId, origem){
  return checa(await sb.rpc('importar_v1', { p_empresa: empresaId, p_dados: dados, p_migracao: migracaoId || null, p_origem: origem || {} }));
}
export async function espelharExclusoesV1(empresaId, migracaoId, ids){
  return checa(await sb.rpc('espelhar_exclusoes_v1', { p_empresa: empresaId, p_migracao: migracaoId,
    p_marketplaces: ids.marketplaces, p_produtos: ids.produtos, p_anuncios: ids.anuncios }));
}
