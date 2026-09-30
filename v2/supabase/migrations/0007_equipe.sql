-- ============================================================================
-- Equipe: incluir usuários numa empresa, mudar o papel, tirar da equipe e gerar
-- senha provisória nova.
--
-- Criar a conta de login exige a chave secreta do Supabase, então a inclusão passa pela
-- Edge Function "precificacao-equipe", que chama as funções "srv_" abaixo (só o servidor
-- executa essas). O resto (ver a equipe, mudar papel, tirar) são funções chamadas pela tela.
-- Nenhuma tela grava direto em "membros": toda mudança passa por uma função que confere a
-- permissão e deixa registro no histórico.
-- ============================================================================

-- Contas criadas pela v2, e por quem. É o que limita o "gerar senha nova": só vale para
-- contas criadas aqui (nunca para uma conta que já existia, como a de outro sistema no
-- mesmo login) e só para quem a pessoa gerencia.
create table precificacao.usuarios (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  criado_por uuid references auth.users(id) on delete set null,
  criado_em  timestamptz not null default now()
);
create index usuarios_por_criador on precificacao.usuarios (criado_por);
alter table precificacao.usuarios enable row level security;   -- sem regra: só as funções leem
revoke all on precificacao.usuarios from authenticated, anon;

-- Toda escrita em "membros" passa pelas funções abaixo.
drop policy "dono inclui na equipe" on precificacao.membros;
drop policy "dono altera a equipe" on precificacao.membros;
drop policy "dono tira da equipe" on precificacao.membros;
revoke insert, update, delete on precificacao.membros from authenticated;

-- ---------------------------------------------------------------- funções internas
-- p_ator pode mexer na equipe desta empresa? (administrador geral ou dono dela)
create function precificacao.administra(p_ator uuid, p_empresa uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_ator is not null and (
    exists (select 1 from precificacao.administradores where user_id = p_ator)
    or exists (select 1 from precificacao.membros
               where empresa_id = p_empresa and user_id = p_ator and papel = 'dono'));
$$;

-- p_ator pode gerar senha nova para p_alvo? Só se a conta foi criada pela v2, não é de um
-- administrador e -- para quem não é administrador -- se TODAS as empresas do alvo são
-- empresas que o ator administra. Assim o dono de uma empresa nunca mexe na senha de alguém
-- que também trabalha em outra empresa.
create function precificacao.pode_redefinir(p_ator uuid, p_alvo uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_ator is not null and p_alvo is not null and p_ator <> p_alvo
    and exists (select 1 from precificacao.usuarios where user_id = p_alvo)
    and not exists (select 1 from precificacao.administradores where user_id = p_alvo)
    and exists (select 1 from precificacao.membros where user_id = p_alvo)
    and (
      exists (select 1 from precificacao.administradores where user_id = p_ator)
      or not exists (
        select 1 from precificacao.membros alvo
        where alvo.user_id = p_alvo
          and not exists (select 1 from precificacao.membros eu
                          where eu.empresa_id = alvo.empresa_id and eu.user_id = p_ator and eu.papel = 'dono')));
$$;

create function precificacao.nome_do_usuario(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select m.nome from precificacao.membros m where m.user_id = p_user and m.nome is not null limit 1),
    (select u.email from auth.users u where u.id = p_user));
$$;

-- Mudanças na equipe vão para o mesmo histórico do catálogo (tabela "membros",
-- registro = a pessoa afetada).
create function precificacao.registrar_equipe(p_empresa uuid, p_ator uuid, p_alvo uuid, p_acao text,
                                              p_antes jsonb, p_depois jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into precificacao.historico (empresa_id, tabela, registro_id, acao, quem, quem_nome, antes, depois)
  values (p_empresa, 'membros', p_alvo, p_acao, p_ator, precificacao.nome_do_usuario(p_ator), p_antes, p_depois);
$$;

-- Trava os donos da empresa antes de conferir "vai sobrar algum dono?". Sem isso, dois donos
-- tirando um ao outro ao mesmo tempo deixariam a empresa sem nenhum.
create function precificacao.sobra_dono_sem(p_empresa uuid, p_user uuid) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform 1 from precificacao.membros where empresa_id = p_empresa and papel = 'dono' for update;
  return exists (select 1 from precificacao.membros
                 where empresa_id = p_empresa and papel = 'dono' and user_id <> p_user);
end $$;

-- ---------------------------------------------------------------- chamadas pela tela
-- A equipe de uma empresa, com e-mail e último acesso (só para o dono e o administrador).
create function precificacao.equipe(p_empresa uuid)
returns table (user_id uuid, nome text, email text, papel precificacao.papel, criado_em timestamptz,
               ultimo_acesso timestamptz, pode_redefinir boolean, sou_eu boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_eu uuid := (select auth.uid());
begin
  if not precificacao.administra(v_eu, p_empresa) then
    raise exception 'Só o dono da empresa (ou o administrador) vê e gerencia a equipe.' using errcode = '42501';
  end if;
  return query
    select m.user_id, coalesce(m.nome, u.email::text), u.email::text, m.papel, m.criado_em, u.last_sign_in_at,
           precificacao.pode_redefinir(v_eu, m.user_id), m.user_id = v_eu
    from precificacao.membros m
    join auth.users u on u.id = m.user_id
    where m.empresa_id = p_empresa
    order by m.papel, lower(coalesce(m.nome, u.email::text));
end $$;

-- Meu papel nesta empresa ('admin' para o administrador geral; null se não tenho acesso).
create function precificacao.meu_papel(p_empresa uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from precificacao.administradores where user_id = (select auth.uid())) then 'admin'
    else (select papel::text from precificacao.membros where empresa_id = p_empresa and user_id = (select auth.uid()))
  end;
$$;

create function precificacao.alterar_papel(p_empresa uuid, p_user uuid, p_papel precificacao.papel) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_eu uuid := (select auth.uid());
  v_antes precificacao.papel;
begin
  if not precificacao.administra(v_eu, p_empresa) then
    raise exception 'Só o dono da empresa (ou o administrador) muda papéis.' using errcode = '42501';
  end if;
  select papel into v_antes from precificacao.membros where empresa_id = p_empresa and user_id = p_user for update;
  if not found then raise exception 'Essa pessoa não faz parte da equipe.'; end if;
  if v_antes = p_papel then return; end if;
  if v_antes = 'dono' and not precificacao.sobra_dono_sem(p_empresa, p_user)
     and not exists (select 1 from precificacao.administradores where user_id = v_eu) then
    raise exception 'A empresa precisa ter pelo menos um dono. Torne outra pessoa dona antes.';
  end if;
  update precificacao.membros set papel = p_papel where empresa_id = p_empresa and user_id = p_user;
  perform precificacao.registrar_equipe(p_empresa, v_eu, p_user, 'alterou',
    jsonb_build_object('papel', v_antes), jsonb_build_object('papel', p_papel));
end $$;

create function precificacao.remover_da_equipe(p_empresa uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_eu uuid := (select auth.uid());
  v_linha precificacao.membros;
begin
  if not precificacao.administra(v_eu, p_empresa) then
    raise exception 'Só o dono da empresa (ou o administrador) tira alguém da equipe.' using errcode = '42501';
  end if;
  select * into v_linha from precificacao.membros where empresa_id = p_empresa and user_id = p_user for update;
  if not found then return; end if;   -- já saiu: nada a fazer
  if v_linha.papel = 'dono' and not precificacao.sobra_dono_sem(p_empresa, p_user)
     and not exists (select 1 from precificacao.administradores where user_id = v_eu) then
    raise exception 'A empresa precisa ter pelo menos um dono. Torne outra pessoa dona antes.';
  end if;
  delete from precificacao.membros where empresa_id = p_empresa and user_id = p_user;
  perform precificacao.registrar_equipe(p_empresa, v_eu, p_user, 'excluiu',
    jsonb_build_object('nome', v_linha.nome, 'papel', v_linha.papel), null);
end $$;

-- O nome que aparece no histórico ("alterado por"), em todas as empresas da pessoa.
create function precificacao.alterar_meu_nome(p_nome text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_nome text := nullif(btrim(p_nome), '');
begin
  if v_nome is null or length(v_nome) > 80 then raise exception 'Nome entre 1 e 80 letras.'; end if;
  update precificacao.membros set nome = v_nome where user_id = (select auth.uid());
end $$;

-- ---------------------------------------------------------------- só o servidor (Edge Function)
create function precificacao.srv_usuario_por_email(p_email text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from auth.users where email = lower(btrim(p_email)) and not is_sso_user limit 1;
$$;

create function precificacao.srv_pode_administrar(p_ator uuid, p_empresa uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select precificacao.administra(p_ator, p_empresa);
$$;

create function precificacao.srv_pode_redefinir(p_ator uuid, p_alvo uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select precificacao.pode_redefinir(p_ator, p_alvo);
$$;

-- Inclui p_user na equipe. p_criado = a conta acabou de ser criada pela v2 (registra em "usuarios").
create function precificacao.srv_incluir_membro(p_ator uuid, p_empresa uuid, p_user uuid,
                                                p_papel precificacao.papel, p_nome text, p_criado boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_nome text := nullif(btrim(p_nome), '');
begin
  if not precificacao.administra(p_ator, p_empresa) then
    raise exception 'Só o dono da empresa (ou o administrador) inclui pessoas.' using errcode = '42501';
  end if;
  if exists (select 1 from precificacao.membros where empresa_id = p_empresa and user_id = p_user) then
    raise exception 'Essa pessoa já faz parte da equipe.' using errcode = '23505';
  end if;
  -- quem já tem nome em outra empresa mantém o mesmo nome
  v_nome := coalesce(v_nome, (select m.nome from precificacao.membros m where m.user_id = p_user and m.nome is not null limit 1));
  insert into precificacao.membros (empresa_id, user_id, papel, nome) values (p_empresa, p_user, p_papel, v_nome);
  if p_criado then
    insert into precificacao.usuarios (user_id, criado_por) values (p_user, p_ator) on conflict (user_id) do nothing;
  end if;
  perform precificacao.registrar_equipe(p_empresa, p_ator, p_user, 'criou', null,
    jsonb_build_object('nome', v_nome, 'papel', p_papel, 'conta_nova', p_criado));
end $$;

-- Registra, em cada empresa do alvo que o ator enxerga, que a senha foi redefinida.
create function precificacao.srv_registrar_senha_redefinida(p_ator uuid, p_alvo uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into precificacao.historico (empresa_id, tabela, registro_id, acao, quem, quem_nome, antes, depois)
  select m.empresa_id, 'membros', p_alvo, 'alterou', p_ator, precificacao.nome_do_usuario(p_ator),
         null, jsonb_build_object('senha', 'provisória nova')
  from precificacao.membros m
  where m.user_id = p_alvo and precificacao.administra(p_ator, m.empresa_id);
end $$;

-- ---------------------------------------------------------------- quem executa o quê
-- Funções novas nascem executáveis por todos (padrão do Postgres): fecha e abre só o necessário.
revoke execute on function
  precificacao.administra(uuid, uuid), precificacao.pode_redefinir(uuid, uuid),
  precificacao.nome_do_usuario(uuid), precificacao.registrar_equipe(uuid, uuid, uuid, text, jsonb, jsonb),
  precificacao.sobra_dono_sem(uuid, uuid),
  precificacao.srv_usuario_por_email(text), precificacao.srv_pode_administrar(uuid, uuid),
  precificacao.srv_pode_redefinir(uuid, uuid),
  precificacao.srv_incluir_membro(uuid, uuid, uuid, precificacao.papel, text, boolean),
  precificacao.srv_registrar_senha_redefinida(uuid, uuid)
from public, anon, authenticated;

grant execute on function
  precificacao.srv_usuario_por_email(text), precificacao.srv_pode_administrar(uuid, uuid),
  precificacao.srv_pode_redefinir(uuid, uuid),
  precificacao.srv_incluir_membro(uuid, uuid, uuid, precificacao.papel, text, boolean),
  precificacao.srv_registrar_senha_redefinida(uuid, uuid)
to service_role;

revoke execute on function
  precificacao.equipe(uuid), precificacao.meu_papel(uuid),
  precificacao.alterar_papel(uuid, uuid, precificacao.papel), precificacao.remover_da_equipe(uuid, uuid),
  precificacao.alterar_meu_nome(text)
from public, anon;
grant execute on function
  precificacao.equipe(uuid), precificacao.meu_papel(uuid),
  precificacao.alterar_papel(uuid, uuid, precificacao.papel), precificacao.remover_da_equipe(uuid, uuid),
  precificacao.alterar_meu_nome(text)
to authenticated;
