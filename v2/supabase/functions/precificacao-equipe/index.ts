// ============================================================================
// Edge Function "precificacao-equipe": o que exige a chave secreta do Supabase.
//   acao "incluir"          -> cria a conta de login (se o e-mail ainda não tem) e põe na equipe
//   acao "redefinir_senha"  -> gera senha provisória nova e encerra as sessões abertas
// Quem pode o quê é decidido no banco (funções srv_* da migration 0007): esta função só
// confirma quem está chamando e executa. Publicada com verify_jwt = false porque confere o
// login ela mesma, direto no Auth (funciona com as chaves novas sb_publishable/sb_secret).
// ============================================================================
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

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

// O login vai no cabeçalho Authorization (não em cookie), então liberar qualquer origem não
// abre brecha: sem o token de uma sessão válida nada acontece.
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

const PAPEIS = ['dono', 'editor', 'leitor'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Sorteio sem viés: descarta os valores do fim da faixa que não fecham um múltiplo de n.
function aleatorio(n: number): number {
  const limite = Math.floor(0x100000000 / n) * n;
  const b = new Uint32Array(1);
  for (;;) { crypto.getRandomValues(b); if (b[0] < limite) return b[0] % n; }
}

// 12 caracteres sem os que se confundem ao ditar ou digitar (0/O, 1/l/I), com pelo menos
// uma minúscula, uma maiúscula e um número.
function senhaProvisoria(): string {
  const grupos = ['abcdefghijkmnpqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789'];
  const todos = grupos.join('');
  const c = grupos.map((g) => g[aleatorio(g.length)]);
  while (c.length < 12) c.push(todos[aleatorio(todos.length)]);
  for (let i = c.length - 1; i > 0; i--) { const j = aleatorio(i + 1); [c[i], c[j]] = [c[j], c[i]]; }
  return c.join('');
}

async function rpc(nome: string, args: Record<string, unknown>) {
  const { data, error } = await admin.rpc(nome, args);
  if (error) throw error;
  return data;
}

function traduzAuth(m: string): string {
  if (/password/i.test(m)) return 'A senha provisória não passou nas regras de senha do Supabase: ' + m;
  if (/email/i.test(m)) return 'E-mail recusado pelo Supabase: ' + m;
  return m;
}

async function incluir(ator: string, c: Record<string, unknown>) {
  const empresa = String(c.empresa_id ?? '');
  const email = String(c.email ?? '').trim().toLowerCase();
  const nome = String(c.nome ?? '').trim();
  const papel = String(c.papel ?? '');
  if (!UUID.test(empresa)) throw new Recusa(400, 'Empresa inválida.');
  if (!EMAIL.test(email) || email.length > 254) throw new Recusa(400, 'E-mail inválido.');
  if (!nome || nome.length > 80) throw new Recusa(400, 'Informe o nome (até 80 letras).');
  if (!PAPEIS.includes(papel)) throw new Recusa(400, 'Papel inválido.');

  // confere ANTES de criar qualquer conta
  if (!(await rpc('srv_pode_administrar', { p_ator: ator, p_empresa: empresa }))) {
    throw new Recusa(403, 'Só o dono da empresa (ou o administrador) inclui pessoas.');
  }

  let userId: string | null = await rpc('srv_usuario_por_email', { p_email: email });
  let senha: string | null = null;
  let criado = false;
  if (!userId) {
    senha = senhaProvisoria();
    const { data, error } = await admin.auth.admin.createUser({
      email, password: senha, email_confirm: true, user_metadata: { nome, trocar_senha: true },
    });
    if (error) {
      // outra inclusão do mesmo e-mail pode ter criado a conta neste mesmo instante
      userId = await rpc('srv_usuario_por_email', { p_email: email });
      if (!userId) throw new Recusa(400, traduzAuth(error.message));
      senha = null;
    } else {
      userId = data.user.id;
      criado = true;
    }
  }

  try {
    await rpc('srv_incluir_membro', {
      p_ator: ator, p_empresa: empresa, p_user: userId, p_papel: papel, p_nome: nome, p_criado: criado,
    });
  } catch (err) {
    // conta recém-criada não fica solta, sem empresa nenhuma
    if (criado) await admin.auth.admin.deleteUser(userId!).catch(() => {});
    throw err;
  }
  return { ok: true, conta_nova: criado, email, senha_provisoria: senha };
}

async function redefinirSenha(ator: string, c: Record<string, unknown>) {
  const alvo = String(c.user_id ?? '');
  if (!UUID.test(alvo)) throw new Recusa(400, 'Pessoa inválida.');
  if (!(await rpc('srv_pode_redefinir', { p_ator: ator, p_alvo: alvo }))) {
    throw new Recusa(403, 'Você não pode gerar senha para essa pessoa: ela também trabalha em outra empresa, ' +
      'ou a conta não foi criada por este sistema. Peça ao administrador.');
  }
  const senha = senhaProvisoria();
  const { error } = await admin.auth.admin.updateUserById(alvo, {
    password: senha, user_metadata: { trocar_senha: true },
  });
  if (error) throw new Recusa(400, traduzAuth(error.message));
  await rpc('srv_registrar_senha_redefinida', { p_ator: ator, p_alvo: alvo });
  return { ok: true, senha_provisoria: senha };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return resposta(405, { erro: 'Use POST.' });
  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) throw new Recusa(401, 'Entre no sistema de novo.');
    const { data: quem, error: semLogin } = await admin.auth.getUser(token);
    if (semLogin || !quem?.user) throw new Recusa(401, 'Sua sessão expirou. Entre de novo.');
    const ator = quem.user.id;

    const corpo = await req.json().catch(() => ({}));
    if (corpo.acao === 'incluir') return resposta(200, await incluir(ator, corpo));
    if (corpo.acao === 'redefinir_senha') return resposta(200, await redefinirSenha(ator, corpo));
    throw new Recusa(400, 'Ação desconhecida.');
  } catch (err) {
    if (err instanceof Recusa) return resposta(err.status, { erro: err.message });
    const e = err as { code?: string; message?: string };
    if (e?.code === '42501') return resposta(403, { erro: e.message });
    if (e?.code === '23505') return resposta(409, { erro: e.message });
    console.error(err);
    return resposta(500, { erro: 'Erro no servidor: ' + (e?.message ?? String(err)) });
  }
});
