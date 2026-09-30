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
  if(/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Sem conexão com o banco agora. Tente de novo em instantes.';
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
export async function redefinirSenha(email){
  return checa(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] }));
}

// ---------------------------------------------------------------- empresas
export async function listarEmpresas(){
  return checa(await sb.from('empresas').select('id, nome, criado_em').order('nome'));
}
export async function criarEmpresa(nome){
  return checa(await sb.from('empresas').insert({ nome }).select('id, nome').single());
}

// Lê uma tabela inteira da empresa em páginas de mil linhas (o limite por consulta do banco).
// Catálogo grande não trava a tela nem estoura o limite.
async function tudoDaEmpresa(tabela, empresaId, colunas = '*', ordem = null){
  const PAGINA = 1000;
  const saida = [];
  for(let de = 0; ; de += PAGINA){
    let q = sb.from(tabela).select(colunas).eq('empresa_id', empresaId).range(de, de + PAGINA - 1);
    if(ordem) q = q.order(ordem);
    const pagina = checa(await q);
    saida.push(...pagina);
    if(pagina.length < PAGINA) break;
  }
  return saida;
}

// Tudo o que a tela de produtos precisa de uma empresa, em paralelo.
export async function carregarEmpresa(empresaId){
  const [empresas, marketplaces, produtos, anuncios, vinculos] = await Promise.all([
    sb.from('empresas').select('*').eq('id', empresaId).then(checa),
    tudoDaEmpresa('marketplaces', empresaId, '*', 'ordem'),
    tudoDaEmpresa('produtos', empresaId, '*', 'sku'),
    tudoDaEmpresa('anuncios', empresaId),
    tudoDaEmpresa('ml_vinculos', empresaId)
  ]);
  if(!empresas.length) throw new Error('Empresa não encontrada ou sem acesso.');
  return { empresa: empresas[0], marketplaces, produtos, anuncios, vinculos };
}

// ---------------------------------------------------------------- tradução para o motor de cálculo
// O motor de cálculo é o MESMO da versão 1 (calculo.js é gerado a partir dela), e fala a
// língua da v1. Estas funções traduzem as linhas do banco para esse formato.
export function custosDaEmpresaV1(e){
  return { fixedCost: Number(e.custo_fixo), misc: Number(e.outros_custos), taxPct: Number(e.imposto_pct),
    marketingPct: Number(e.marketing_pct), coupon: Number(e.cupom_padrao), freightNet: Number(e.frete_padrao) };
}
export function perfilV1(m){
  return { id: m.codigo, label: m.nome, color: m.cor, missing: !!m.removido,
    commission: Number(m.comissao), service: Number(m.servico), transaction: Number(m.transacao), fixedFee: Number(m.taxa_fixa),
    dualAdPrice: m.preco_anuncio_duplo, variableFreight: m.frete_variavel, variableFixedFee: m.taxa_fixa_variavel,
    tiered: m.por_faixa, tiers: Array.isArray(m.faixas) ? m.faixas : [] };
}
export function visaoV1(produto, anuncio, vinculo){
  const v = vinculo || null;
  return {
    id: anuncio.id, productId: produto.id, productSku: produto.sku, sku: anuncio.sku, name: produto.nome,
    cogs: Number(produto.custo), costOverride: produto.custo_proprio,
    fixedCost: Number(produto.custo_fixo), misc: Number(produto.outros_custos),
    taxPct: Number(produto.imposto_pct), marketingPct: Number(produto.marketing_pct),
    coupon: Number(anuncio.cupom), freightNet: Number(anuncio.frete_liquido), mktFixedFee: Number(anuncio.taxa_fixa_anuncio),
    mode: anuncio.modo === 'margem' ? 'margin' : 'price', price: Number(anuncio.preco), marginTarget: Number(anuncio.margem_alvo),
    mlUsar: v ? v.usar_taxas : false, mlFaixas: v ? v.faixas_taxa : [],
    mlUsarFrete: v ? v.usar_envio : false, mlFreteFaixas: v ? v.faixas_envio : [], mlFreteGratis: v ? v.frete_gratis : false
  };
}

// ---------------------------------------------------------------- importação da v1 (só administrador)
export async function importarLoteV1(empresaId, dados, migracaoId, origem){
  return checa(await sb.rpc('importar_v1', { p_empresa: empresaId, p_dados: dados, p_migracao: migracaoId || null, p_origem: origem || {} }));
}
export async function espelharExclusoesV1(empresaId, migracaoId, ids){
  return checa(await sb.rpc('espelhar_exclusoes_v1', { p_empresa: empresaId, p_migracao: migracaoId,
    p_marketplaces: ids.marketplaces, p_produtos: ids.produtos, p_anuncios: ids.anuncios }));
}
