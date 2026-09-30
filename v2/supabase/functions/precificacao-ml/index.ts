// ============================================================================
// Edge Function "precificacao-ml": a conversa com o Mercado Livre.
//
// É o que o Apps Script de cada planilha fazia na v1, com as mesmas regras (sondagem das faixas
// de taxa e de envio, conferência, correção pela faixa exata), só que num servidor só:
//   - a aplicação do ML (Client ID e Secret) é UMA, configurada nos segredos do servidor
//     (ML_CLIENT_ID, ML_CLIENT_SECRET) -- nunca na página;
//   - cada empresa autoriza a própria conta do ML, e os tokens ficam na tabela ml_conexoes, que
//     nenhuma tela lê.
// Os pedidos e as respostas têm o mesmo formato do Apps Script: a tela da v1 não precisou mudar.
//
// Publicada com verify_jwt = false porque confere o login ela mesma, direto no Auth.
// ============================================================================
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const ML_API = 'https://api.mercadolibre.com';
const ML_AUTH = 'https://auth.mercadolivre.com.br/authorization';
const ML_SITE = 'MLB';
// Preços de sondagem das faixas de custo fixo (o custo fixo muda por faixa de preço). Os pares logo
// antes/depois de cada degrau conhecido deixam a virada exata. Iguais aos da v1.
const ML_SONDAS = [5, 8, 12.49, 12.5, 20, 28.99, 29, 40, 49.99, 50, 65, 78.99, 79, 120, 300, 800];
// Preços de sondagem do envio: nos degraus que o ML usa (29, 50 e 79), com o centavo de antes.
const ML_SONDAS_FRETE = [10, 28.99, 29, 49.99, 50, 78.99, 79, 150, 400];
const ORCAMENTO_MS = 20000;   // cada chamada devolve o que deu em 20 s; o resto vem em "faltou"

// Lidos a cada pedido (e não uma vez ao carregar): um segredo cadastrado agora vale no próximo
// clique, mesmo que o servidor já estivesse rodando.
let CLIENT_ID = '', CLIENT_SECRET = '', REDIRECT = '';
function lerSegredos(){
  CLIENT_ID = (Deno.env.get('ML_CLIENT_ID') ?? '').trim();
  CLIENT_SECRET = (Deno.env.get('ML_CLIENT_SECRET') ?? '').trim();
  REDIRECT = (Deno.env.get('ML_REDIRECT_URI') ?? '').trim() || 'https://newtech-system.github.io/sistema-precificacao/v2/ml-retorno.html';
}

function chaveSecreta(): string {
  const novas = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (novas) {
    try { const k = JSON.parse(novas).default; if (k) return k; } catch (_) { /* cai na antiga */ }
  }
  const antiga = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (antiga) return antiga;
  throw new Error('Chave secreta do Supabase ausente no servidor.');
}
const admin = createClient(Deno.env.get('SUPABASE_URL')!, chaveSecreta(), {
  db: { schema: 'precificacao' },
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const resposta = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
class Recusa extends Error {
  constructor(public status: number, mensagem: string) { super(mensagem); }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms));
const msg = (err: unknown) => String(err && (err as Error).message ? (err as Error).message : err);

// ---------------------------------------------------------------- quem pode
async function papelNaEmpresa(user: string, empresa: string): Promise<string | null> {
  const { data: adm } = await admin.from('administradores').select('user_id').eq('user_id', user).maybeSingle();
  if (adm) return 'admin';
  const { data: m } = await admin.from('membros').select('papel').eq('user_id', user).eq('empresa_id', empresa).maybeSingle();
  return m ? m.papel : null;
}
const podeEditar = (p: string | null) => p === 'admin' || p === 'dono' || p === 'editor';

// ---------------------------------------------------------------- "state" assinado
// Leva a empresa e a pessoa até a página de retorno e volta, assinado com o Client Secret: ninguém
// consegue fabricar um retorno que ligue a conta do ML de alguém a outra empresa.
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
async function hmac(texto: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(CLIENT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(texto))));
}
async function assinarEstado(empresa: string, user: string): Promise<string> {
  const corpo = b64url(new TextEncoder().encode(JSON.stringify({ e: empresa, u: user, x: Date.now() + 15 * 60000 })));
  return corpo + '.' + (await hmac(corpo));
}
async function lerEstado(estado: string): Promise<{ e: string; u: string }> {
  const [corpo, assinatura] = String(estado || '').split('.');
  if (!corpo || !assinatura || (await hmac(corpo)) !== assinatura) throw new Recusa(400, 'Retorno do Mercado Livre inválido. Clique em Conectar de novo.');
  const d = JSON.parse(new TextDecoder().decode(deB64url(corpo)));
  if (!d.x || Date.now() > d.x) throw new Recusa(400, 'A autorização demorou mais de 15 minutos. Clique em Conectar de novo.');
  return d;
}

// ---------------------------------------------------------------- tokens
async function guardarTokens(empresa: string, d: Record<string, unknown>, codigo: number) {
  if (!d || !d.access_token) {
    throw new Error('O Mercado Livre recusou a autorização' + (d && d.message ? ': ' + d.message : ' (código ' + codigo + ')') +
      '. Confira se a URL de retorno cadastrada na aplicação é exatamente ' + REDIRECT + '.');
  }
  let apelido = '', user = String(d.user_id ?? '');
  try {
    const eu = await (await fetch(ML_API + '/users/me', { headers: { Authorization: 'Bearer ' + d.access_token } })).json();
    if (eu && eu.nickname) apelido = eu.nickname;
    if (eu && eu.id) user = String(eu.id);
  } catch (_) { /* sem o apelido, segue */ }
  const { error } = await admin.from('ml_conexoes').upsert({
    empresa_id: empresa, ml_user_id: user, apelido, access_token: d.access_token, refresh_token: d.refresh_token ?? null,
    expira_em: new Date(Date.now() + (Number(d.expires_in) || 21600) * 1000).toISOString(), atualizado_em: new Date().toISOString(),
  });
  if (error) throw error;
  return apelido;
}

async function conexao(empresa: string) {
  const { data, error } = await admin.from('ml_conexoes').select('*').eq('empresa_id', empresa).maybeSingle();
  if (error) throw error;
  return data;
}

// Renova a autorização. O Mercado Livre troca o refresh_token a cada renovação (o velho deixa de
// valer), e duas chamadas ao mesmo tempo renovando derrubariam a conexão. Por isso a gravação é
// "só se o refresh_token ainda for o que eu li": quem chegar depois usa o que o outro gravou.
async function renovar(empresa: string, lido: Record<string, string>): Promise<string> {
  const r = await fetch(ML_API + '/oauth/token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: lido.refresh_token }),
  });
  const d = await r.json().catch(() => ({}));
  if (!d.access_token) {
    const agora = await conexao(empresa);
    if (agora && agora.refresh_token && agora.refresh_token !== lido.refresh_token) return agora.access_token;   // outro renovou
    throw new Error('A autorização do Mercado Livre expirou ou foi revogada' + (d.message ? ' (' + d.message + ')' : '') + '. Clique em "Conectar ao Mercado Livre" de novo.');
  }
  const { data } = await admin.from('ml_conexoes').update({
    access_token: d.access_token, refresh_token: d.refresh_token ?? lido.refresh_token,
    expira_em: new Date(Date.now() + (Number(d.expires_in) || 21600) * 1000).toISOString(), atualizado_em: new Date().toISOString(),
  }).eq('empresa_id', empresa).eq('refresh_token', lido.refresh_token).select('access_token');
  if (data && data.length) return d.access_token;
  const agora = await conexao(empresa);
  return agora ? agora.access_token : d.access_token;
}

class ML {
  empresa: string;
  c: Record<string, string>;
  token = '';
  constructor(empresa: string, c: Record<string, string>) { this.empresa = empresa; this.c = c; }
  static async abrir(empresa: string) {
    const c = await conexao(empresa);
    if (!c || !c.refresh_token) throw new Error('Esta empresa ainda não está autorizada no Mercado Livre. Clique em "Conectar ao Mercado Livre".');
    const ml = new ML(empresa, c);
    ml.token = Date.now() < new Date(c.expira_em).getTime() - 60000 ? c.access_token : await renovar(empresa, c);
    return ml;
  }
  get uid() { return this.c.ml_user_id; }
  async renovar() { this.c = (await conexao(this.empresa)) || this.c; this.token = await renovar(this.empresa, this.c); }
  // um GET com as mesmas regras da v1: 401 renova e tenta de novo; 429 espera 3 s e tenta de novo
  async get(url: string, tentou = false): Promise<any> {
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + this.token } });
    if (r.status === 401 && !tentou) { await this.renovar(); return this.get(url, true); }
    if (r.status === 429 && !tentou) { await dorme(3000); return this.get(url, true); }
    const txt = await r.text();
    if (r.status >= 400) {
      let m = '';
      try { m = JSON.parse(txt).message || ''; } catch (_) { /* sem mensagem */ }
      throw new Error('Mercado Livre respondeu ' + r.status + (m ? ': ' + m : '') + ' (' + url.replace(ML_API, '') + ')');
    }
    return JSON.parse(txt);
  }
  // Várias consultas em paralelo (até 10 por vez). As que voltarem com 429 são refeitas em bloco
  // depois de 3 s, como o fetchAll da v1. Devolve {status, json} por consulta, na mesma ordem.
  async todos(urls: string[]): Promise<{ status: number; json: any }[]> {
    const um = async (u: string) => {
      try {
        const r = await fetch(u, { headers: { Authorization: 'Bearer ' + this.token } });
        const t = await r.text();
        let j: any = null;
        try { j = JSON.parse(t); } catch (_) { /* resposta sem JSON */ }
        return { status: r.status, json: j };
      } catch (_) { return { status: 599, json: null }; }
    };
    const saida: { status: number; json: any }[] = new Array(urls.length);
    for (let i = 0; i < urls.length; i += 10) {
      const lote = await Promise.all(urls.slice(i, i + 10).map(um));
      lote.forEach((r, k) => { saida[i + k] = r; });
    }
    const refazer = saida.map((r, i) => (r.status === 429 ? i : -1)).filter((i) => i >= 0);
    if (refazer.length) {
      await dorme(3000);
      const segunda = await Promise.all(refazer.map((i) => um(urls[i])));
      refazer.forEach((i, k) => { saida[i] = segunda[k]; });
    }
    return saida;
  }
}

// ---------------------------------------------------------------- taxas
// Transforma as sondagens em faixas. Dentro de uma faixa o ML pode cobrar um valor fixo OU um valor
// proporcional ao preço (itens baratos); o formato é descoberto comparando duas sondagens da mesma
// faixa. Mesma regra da v1 (mlFaixasDasAmostras).
function faixasDasAmostras(amostras: { preco: number; pct: number; fixo: number }[]) {
  const faixas: { min: number; pct: number; fixo: number }[] = [];
  let atual: any = null;
  const fecha = () => {
    if (!atual) return;
    const ratio = atual.forma === 'proporcional' ? atual.ratio : 0;
    faixas.push({ min: atual.min, pct: atual.pct + ratio * 100, fixo: atual.forma === 'proporcional' ? 0 : atual.fixo });
  };
  const perto = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.005, Math.abs(b) * 0.005);
  amostras.forEach((s, i) => {
    const ratio = s.preco > 0 ? s.fixo / s.preco : 0;
    if (!atual) { atual = { min: 0, pct: s.pct, fixo: s.fixo, ratio, forma: null }; return; }
    if (s.pct === atual.pct) {
      if (atual.forma === null && perto(s.fixo, atual.fixo)) return;
      if (atual.forma === null && perto(ratio, atual.ratio)) { atual.forma = 'proporcional'; return; }
      if (atual.forma === 'proporcional' && perto(ratio, atual.ratio)) return;
      if (atual.forma === 'fixo' && perto(s.fixo, atual.fixo)) return;
    }
    if (atual.forma === null) atual.forma = 'fixo';
    const anterior = amostras[i - 1];
    const inicio = (atual.forma === 'proporcional' && anterior && perto(anterior.fixo, s.fixo) && anterior.preco > atual.min)
      ? anterior.preco : s.preco;
    fecha();
    atual = { min: inicio, pct: s.pct, fixo: s.fixo, ratio, forma: null };
  });
  if (atual && atual.forma === null) atual.forma = 'fixo';
  fecha();
  return faixas;
}
function taxaDaResposta(r: { status: number; json: any }) {
  if (r.status >= 400 || !r.json) return null;
  const d = Array.isArray(r.json) ? r.json[0] : r.json;
  if (!d || !d.sale_fee_details) return null;
  return { pct: Number(d.sale_fee_details.percentage_fee) || 0, fixo: Number(d.sale_fee_details.fixed_fee) || 0,
    total: d.sale_fee_amount === undefined || d.sale_fee_amount === null ? null : Number(d.sale_fee_amount) };
}
const urlTaxa = (preco: number, categoria: string, tipo: string) =>
  ML_API + '/sites/' + ML_SITE + '/listing_prices?price=' + preco + '&category_id=' + encodeURIComponent(categoria) +
  '&listing_type_id=' + encodeURIComponent(tipo);

async function mlTaxas(ml: ML, chaves: string) {
  const lista = String(chaves || '').split(',').filter((x) => x);
  const saida: Record<string, unknown> = {};
  const faltou: string[] = [];
  const inicio = Date.now();
  for (const chave of lista) {
    if (Date.now() - inicio > ORCAMENTO_MS) { faltou.push(chave); continue; }
    const [categoria, tipo] = chave.split('|');
    try {
      const rs = await ml.todos(ML_SONDAS.map((p) => urlTaxa(p, categoria, tipo)));
      const amostras: { preco: number; pct: number; fixo: number }[] = [];
      rs.forEach((r, i) => { const t = taxaDaResposta(r); if (t) amostras.push({ preco: ML_SONDAS[i], pct: t.pct, fixo: t.fixo }); });
      const faixas = faixasDasAmostras(amostras);
      if (!faixas.length) throw new Error('o Mercado Livre não devolveu as taxas desta categoria');
      saida[chave] = { faixas };
    } catch (err) { saida[chave] = { erro: msg(err) }; }
  }
  return { ok: true, taxas: saida, faltou };
}

// ---------------------------------------------------------------- envio
// Custo do envio que o VENDEDOR paga, como o ML informa em /users/{id}/shipping_options/free (o
// mesmo número de "A pagar" na lista de anúncios), pela opção de envio que o anúncio usa hoje.
function custoDoEnvio(r: { status: number; json: any }) {
  if (!r || r.status >= 400 || !r.json) return null;
  const c = r.json.coverage && r.json.coverage.all_country;
  if (!c) return null;
  return Number(c.list_cost) || 0;
}
function baseDoEnvio(ml: ML, id: string, variacao: string, it: any, freteGratis?: boolean) {
  const env = it.shipping || {};
  return ML_API + '/users/' + ml.uid + '/shipping_options/free?item_id=' + encodeURIComponent(id) +
    (variacao ? '&variation_id=' + encodeURIComponent(variacao) : '') +
    '&listing_type_id=' + encodeURIComponent(it.listing_type_id || '') +
    '&condition=' + encodeURIComponent(it.condition || 'new') +
    '&mode=' + encodeURIComponent(env.mode || 'me2') +
    (env.logistic_type ? '&logistic_type=' + encodeURIComponent(env.logistic_type) : '') +
    (freteGratis === undefined ? '' : '&free_shipping=' + (freteGratis ? 'true' : 'false')) + '&verbose=true';
}
async function mlFrete(ml: ML, lista: string) {
  const saida: Record<string, unknown> = {};
  const faltou: string[] = [];
  const inicio = Date.now();
  for (const chave of String(lista || '').split(',').filter((x) => x)) {
    if (Date.now() - inicio > ORCAMENTO_MS) { faltou.push(chave); continue; }
    const [id, variacao = ''] = chave.split(':');
    try {
      const it = await ml.get(ML_API + '/items/' + id + '?attributes=id,price,listing_type_id,condition,shipping,category_id,status');
      const env = it.shipping || {};
      const gratis = !!env.free_shipping;
      const base = baseDoEnvio(ml, id, variacao, it);
      const urls = ML_SONDAS_FRETE.map((p) => base + '&item_price=' + p + '&free_shipping=' + (gratis ? 'true' : 'false'));
      urls.push(base + '&item_price=' + (Number(it.price) || 0) + '&free_shipping=' + (gratis ? 'false' : 'true'));
      const rs = await ml.todos(urls);
      const faixas: { min: number; custo: number }[] = [];
      for (let i = 0; i < ML_SONDAS_FRETE.length; i++) {
        const custo = custoDoEnvio(rs[i]);
        if (custo === null) continue;
        const ult = faixas[faixas.length - 1];
        if (ult && Math.abs(ult.custo - custo) < 0.005) continue;
        faixas.push({ min: faixas.length ? ML_SONDAS_FRETE[i] : 0, custo });
      }
      if (!faixas.length) throw new Error('o Mercado Livre não devolveu custo de envio para este anúncio');
      saida[chave] = { faixas, gratis, logistica: env.logistic_type || env.mode || '', outra: custoDoEnvio(rs[rs.length - 1]),
        precoML: Number(it.price) || 0, categoria: it.category_id || '', tipo: it.listing_type_id || '', situacao: it.status || '' };
    } catch (err) { saida[chave] = { erro: msg(err) }; }
  }
  return { ok: true, frete: saida, faltou };
}

// ---------------------------------------------------------------- correção pela faixa exata
// Pergunta o valor no preço do anúncio e procura, em rodadas de 8 consultas paralelas, onde ele
// deixa de valer para cada lado (mesma regra da v1: mlBorda e mlFaixaExata).
type Valor = { chave: string; dados: Record<string, number> } | null;
async function borda(consulta: (p: number[]) => Promise<Valor[]>, alvo: string, baixo: number, alto: number, paraEsquerda: boolean) {
  for (let r = 0; r < 4 && (alto - baixo) > 0.02; r++) {
    const passos: number[] = [];
    for (let i = 1; i <= 8; i++) passos.push(Math.round((baixo + (alto - baixo) * i / 9) * 100) / 100);
    const vals = await consulta(passos);
    let novoBaixo = baixo, novoAlto = alto;
    passos.forEach((p, j) => {
      if (!vals[j]) return;
      const igual = vals[j]!.chave === alvo;
      if (paraEsquerda) { if (igual) novoAlto = Math.min(novoAlto, p); else novoBaixo = Math.max(novoBaixo, p); }
      else { if (igual) novoBaixo = Math.max(novoBaixo, p); else novoAlto = Math.min(novoAlto, p); }
    });
    if (novoAlto <= novoBaixo) break;
    baixo = novoBaixo; alto = novoAlto;
  }
  return paraEsquerda ? Math.round(alto * 100) / 100 : Math.round(baixo * 100) / 100;
}
async function faixaExata(consulta: (p: number[]) => Promise<Valor[]>, preco: number) {
  const alvo = (await consulta([preco]))[0];
  if (!alvo) return null;
  const noChao = (await consulta([0.5]))[0];
  const min = (noChao && noChao.chave === alvo.chave) ? 0 : await borda(consulta, alvo.chave, 0.5, preco, true);
  const teto = Math.max(preco * 3, 400);
  const noTeto = (await consulta([teto]))[0];
  const max = (noTeto && noTeto.chave === alvo.chave) ? null : await borda(consulta, alvo.chave, preco, teto, false);
  return { min, max, dados: alvo.dados };
}
function precoDoItem(it: any, variacao: string) {
  let preco = Number(it.price) || 0;
  if (variacao && it.variations) it.variations.forEach((v: any) => { if (String(v.id) === variacao && v.price) preco = Number(v.price); });
  return preco;
}
async function mlRefinar(ml: ML, lista: string) {
  const saida: Record<string, unknown> = {};
  const faltou: string[] = [];
  const inicio = Date.now();
  for (const pedido of String(lista || '').split(',').filter((x) => x)) {
    if (Date.now() - inicio > ORCAMENTO_MS) { faltou.push(pedido); continue; }
    const [id, variacao = '', precoTxt = ''] = pedido.split(':');
    try {
      const it = await ml.get(ML_API + '/items/' + id + '?attributes=id,price,listing_type_id,condition,category_id,shipping,variations');
      const preco = Number(precoTxt) || precoDoItem(it, variacao);
      const env = it.shipping || {};
      const consultaTaxa = async (precos: number[]): Promise<Valor[]> =>
        (await ml.todos(precos.map((p) => urlTaxa(p, it.category_id || '', it.listing_type_id || '')))).map((r) => {
          const t = taxaDaResposta(r);
          return t ? { chave: t.pct + '|' + t.fixo, dados: { pct: t.pct, fixo: t.fixo } } : null;
        });
      const baseEnvio = baseDoEnvio(ml, id, variacao, it, !!env.free_shipping);
      const consultaEnvio = async (precos: number[]): Promise<Valor[]> =>
        (await ml.todos(precos.map((p) => baseEnvio + '&item_price=' + p))).map((r) => {
          const c = custoDoEnvio(r);
          return c === null ? null : { chave: String(c), dados: { custo: c } };
        });
      saida[pedido] = { preco, categoria: it.category_id || '', tipo: it.listing_type_id || '', gratis: !!env.free_shipping,
        taxa: await faixaExata(consultaTaxa, preco), envio: await faixaExata(consultaEnvio, preco) };
    } catch (err) { saida[pedido] = { erro: msg(err) }; }
  }
  return { ok: true, refino: saida, faltou };
}

// ---------------------------------------------------------------- conferência
// A taxa e o envio NO PREÇO QUE O ANÚNCIO TEM HOJE: duas consultas por anúncio.
async function mlConferir(ml: ML, lista: string) {
  const saida: Record<string, unknown> = {};
  const faltou: string[] = [];
  const inicio = Date.now();
  for (const chave of String(lista || '').split(',').filter((x) => x)) {
    if (Date.now() - inicio > ORCAMENTO_MS) { faltou.push(chave); continue; }
    const [id, variacao = ''] = chave.split(':');
    try {
      const it = await ml.get(ML_API + '/items/' + id + '?attributes=id,price,listing_type_id,condition,category_id,shipping,variations,status');
      const preco = precoDoItem(it, variacao);
      const env = it.shipping || {};
      const rs = await ml.todos([
        urlTaxa(preco, it.category_id || '', it.listing_type_id || ''),
        baseDoEnvio(ml, id, variacao, it, !!env.free_shipping) + '&item_price=' + preco,
      ]);
      const t = taxaDaResposta(rs[0]);
      const taxa = t ? (t.total === null ? preco * t.pct / 100 + t.fixo : t.total) : null;
      saida[chave] = { preco, taxa, pct: t ? t.pct : null, fixo: t ? t.fixo : null, envio: custoDoEnvio(rs[1]),
        gratis: !!env.free_shipping, tipo: it.listing_type_id || '', situacao: it.status || '' };
    } catch (err) { saida[chave] = { erro: msg(err) }; }
  }
  return { ok: true, conferencia: saida, faltou };
}

// ---------------------------------------------------------------- anúncios do vendedor
function atributo(lista: any[], id: string) {
  let achado = '';
  (lista || []).forEach((a) => { if (a && a.id === id && a.value_name) achado = String(a.value_name); });
  return achado;
}
// Anúncios com o SKU que o vendedor cadastrou (seller_custom_field ou atributo SELLER_SKU). Anúncio
// com variações devolve uma linha por variação, porque cada uma tem SKU próprio.
async function mlItens(ml: ML, offset: number, limit: number) {
  if (!ml.uid) throw new Error('Não sei o número da conta no Mercado Livre desta empresa. Conecte de novo.');
  const busca = await ml.get(ML_API + '/users/' + ml.uid + '/items/search?offset=' + offset + '&limit=' + limit);
  const ids: string[] = busca.results || [];
  const total = (busca.paging && busca.paging.total) || ids.length;
  if (!ids.length) return { ok: true, total, itens: [], offset };
  // a consulta de detalhes aceita no máximo 20 anúncios por vez
  const urls: string[] = [];
  for (let i = 0; i < ids.length; i += 20) {
    urls.push(ML_API + '/items?ids=' + ids.slice(i, i + 20).join(',') +
      '&attributes=id,title,price,status,category_id,listing_type_id,seller_custom_field,permalink,attributes,variations');
  }
  const dados: any[] = [];
  for (const u of urls) dados.push(...((await ml.get(u)) || []));
  const itens: any[] = [];
  dados.forEach((linha) => {
    const it = linha && (linha.body || linha);
    if (!it || !it.id) return;
    const skuPai = it.seller_custom_field || atributo(it.attributes, 'SELLER_SKU') || '';
    const comum = { id: it.id, titulo: it.title || '', categoria: it.category_id || '', tipo: it.listing_type_id || '',
      situacao: it.status || '', link: it.permalink || '' };
    if (it.variations && it.variations.length) {
      it.variations.forEach((v: any) => itens.push({ ...comum, variacao: String(v.id),
        sku: v.seller_custom_field || atributo(v.attributes, 'SELLER_SKU') || skuPai, preco: Number(v.price || it.price) || 0 }));
    } else {
      itens.push({ ...comum, variacao: '', sku: skuPai, preco: Number(it.price) || 0 });
    }
  });
  return { ok: true, total, itens, offset };
}

// ---------------------------------------------------------------- entrada
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return resposta(405, { erro: 'Use POST.' });
  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) throw new Recusa(401, 'Entre no sistema de novo.');
    const { data: quem, error: semLogin } = await admin.auth.getUser(token);
    if (semLogin || !quem?.user) throw new Recusa(401, 'Sua sessão expirou. Entre de novo.');
    const user = quem.user.id;
    const c = await req.json().catch(() => ({}));
    const acao = String(c.ml || '');
    lerSegredos();
    const configurado = !!CLIENT_ID && !!CLIENT_SECRET;
    // só o NOME do que falta, nunca o valor
    const faltando = [!CLIENT_ID && 'ML_CLIENT_ID', !CLIENT_SECRET && 'ML_CLIENT_SECRET'].filter(Boolean);

    // volta da autorização (página ml-retorno.html): a empresa vem no "state" assinado
    if (acao === 'conectar') {
      if (!configurado) throw new Recusa(400, 'A aplicação do Mercado Livre não está configurada no servidor.');
      const est = await lerEstado(String(c.state || ''));
      if (est.u !== user) throw new Recusa(403, 'Esta autorização foi pedida por outra pessoa. Entre com a mesma conta que clicou em Conectar.');
      if (!podeEditar(await papelNaEmpresa(user, est.e))) throw new Recusa(403, 'Seu usuário não pode conectar o Mercado Livre desta empresa.');
      const r = await fetch(ML_API + '/oauth/token', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
          code: String(c.code || ''), redirect_uri: REDIRECT }),
      });
      const apelido = await guardarTokens(est.e, await r.json().catch(() => ({})), r.status);
      const { data: emp } = await admin.from('empresas').select('nome').eq('id', est.e).maybeSingle();
      return resposta(200, { ok: true, apelido, empresa: emp ? emp.nome : '' });
    }

    const empresa = String(c.empresa_id || '');
    if (!UUID.test(empresa)) throw new Recusa(400, 'Empresa inválida.');
    const papel = await papelNaEmpresa(user, empresa);
    if (!papel) throw new Recusa(403, 'Seu usuário não tem acesso a esta empresa.');

    if (acao === 'status') {
      const cx = await conexao(empresa);
      return resposta(200, { ok: true, configurado, faltando, redirect: REDIRECT, conectado: !!(cx && cx.refresh_token),
        apelido: (cx && cx.apelido) || '', userId: (cx && cx.ml_user_id) || '' });
    }
    if (!podeEditar(papel)) throw new Recusa(403, 'Seu acesso a esta empresa é só de consulta.');
    if (!configurado) throw new Recusa(400, 'A aplicação do Mercado Livre não está configurada no servidor.');

    if (acao === 'auth') {
      const url = ML_AUTH + '?response_type=code&client_id=' + encodeURIComponent(CLIENT_ID) +
        '&redirect_uri=' + encodeURIComponent(REDIRECT) + '&state=' + encodeURIComponent(await assinarEstado(empresa, user));
      return resposta(200, { ok: true, url });
    }
    if (acao === 'desconectar') {
      const { error } = await admin.from('ml_conexoes').delete().eq('empresa_id', empresa);
      if (error) throw error;
      return resposta(200, { ok: true, conectado: false });
    }

    // daqui para baixo, o erro do Mercado Livre volta como na v1 ({erroML}), para a tela mostrar
    try {
      const ml = await ML.abrir(empresa);
      if (acao === 'itens') return resposta(200, await mlItens(ml, Math.max(0, Number(c.offset) || 0), Math.min(50, Number(c.limit) || 50)));
      if (acao === 'taxas') return resposta(200, await mlTaxas(ml, String(c.chaves || '')));
      if (acao === 'frete') return resposta(200, await mlFrete(ml, String(c.itens || '')));
      if (acao === 'conferir') return resposta(200, await mlConferir(ml, String(c.itens || '')));
      if (acao === 'refinar') return resposta(200, await mlRefinar(ml, String(c.itens || '')));
    } catch (err) {
      return resposta(200, { ok: false, erroML: msg(err) });
    }
    throw new Recusa(400, 'Pedido desconhecido: ' + acao);
  } catch (err) {
    if (err instanceof Recusa) return resposta(err.status, { erro: err.message });
    console.error(err);
    return resposta(500, { erro: 'Erro no servidor: ' + msg(err) });
  }
});
