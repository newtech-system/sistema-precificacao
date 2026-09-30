-- ============================================================================
-- Acesso (RLS), carimbo de quem/quando/versão e histórico automático
-- ============================================================================

-- ---------------------------------------------------------------- permissões
-- Só usuários logados usam o sistema: o papel "anon" (visitante) não recebe
-- nada, nem para ler. As regras abaixo decidem o resto.
grant usage on schema precificacao to authenticated, service_role;
grant select, insert, update, delete on all tables in schema precificacao to authenticated;
grant all on all tables in schema precificacao to service_role;
grant usage, select on all sequences in schema precificacao to authenticated, service_role;
grant execute on all functions in schema precificacao to authenticated, service_role;
revoke all on schema precificacao from anon;
-- tabelas criadas em migrações futuras recebem as mesmas permissões (cada uma precisa ligar o RLS)
alter default privileges in schema precificacao grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema precificacao grant all on tables to service_role;
alter default privileges in schema precificacao grant usage, select on sequences to authenticated, service_role;

alter table precificacao.empresas        enable row level security;
alter table precificacao.administradores enable row level security;
alter table precificacao.membros         enable row level security;
alter table precificacao.marketplaces    enable row level security;
alter table precificacao.produtos        enable row level security;
alter table precificacao.anuncios        enable row level security;
alter table precificacao.ml_vinculos     enable row level security;
alter table precificacao.ml_conexoes     enable row level security;   -- sem regra nenhuma: só o servidor
alter table precificacao.historico       enable row level security;
alter table precificacao.migracoes       enable row level security;

-- administrador: cada um só vê a própria linha (é assim que a tela sabe se é admin)
create policy "vê o próprio registro" on precificacao.administradores
  for select to authenticated using (user_id = (select auth.uid()));

-- empresas
create policy "membro vê a empresa" on precificacao.empresas for select to authenticated
  using ((select precificacao.eh_admin()) or id in (select precificacao.minhas_empresas()));
create policy "editor altera custos da empresa" on precificacao.empresas for update to authenticated
  using ((select precificacao.eh_admin()) or id in (select precificacao.empresas_que_edito()))
  with check ((select precificacao.eh_admin()) or id in (select precificacao.empresas_que_edito()));
create policy "admin cria empresa" on precificacao.empresas for insert to authenticated
  with check ((select precificacao.eh_admin()));
create policy "admin apaga empresa" on precificacao.empresas for delete to authenticated
  using ((select precificacao.eh_admin()));

-- membros: todos da empresa veem a equipe; só o dono (ou o admin) mexe nela
create policy "membro vê a equipe" on precificacao.membros for select to authenticated
  using ((select precificacao.eh_admin()) or empresa_id in (select precificacao.minhas_empresas()));
create policy "dono inclui na equipe" on precificacao.membros for insert to authenticated
  with check ((select precificacao.eh_admin()) or empresa_id in (select precificacao.empresas_que_administro()));
create policy "dono altera a equipe" on precificacao.membros for update to authenticated
  using ((select precificacao.eh_admin()) or empresa_id in (select precificacao.empresas_que_administro()))
  with check ((select precificacao.eh_admin()) or empresa_id in (select precificacao.empresas_que_administro()));
create policy "dono tira da equipe" on precificacao.membros for delete to authenticated
  using ((select precificacao.eh_admin()) or empresa_id in (select precificacao.empresas_que_administro()));

-- dados do catálogo: membro lê; dono e editor escrevem; leitor só lê
do $$
declare t text;
begin
  foreach t in array array['marketplaces', 'produtos', 'anuncios', 'ml_vinculos'] loop
    execute format($f$
      create policy "membro lê" on precificacao.%1$I for select to authenticated
        using ((select precificacao.eh_admin()) or empresa_id in (select precificacao.minhas_empresas()));
      create policy "editor cria" on precificacao.%1$I for insert to authenticated
        with check ((select precificacao.eh_admin()) or empresa_id in (select precificacao.empresas_que_edito()));
      create policy "editor altera" on precificacao.%1$I for update to authenticated
        using ((select precificacao.eh_admin()) or empresa_id in (select precificacao.empresas_que_edito()))
        with check ((select precificacao.eh_admin()) or empresa_id in (select precificacao.empresas_que_edito()));
      create policy "editor exclui" on precificacao.%1$I for delete to authenticated
        using ((select precificacao.eh_admin()) or empresa_id in (select precificacao.empresas_que_edito()));
    $f$, t);
  end loop;
end $$;

-- histórico: membro lê; ninguém escreve pela API (só os gatilhos)
create policy "membro lê o histórico" on precificacao.historico for select to authenticated
  using ((select precificacao.eh_admin()) or empresa_id in (select precificacao.minhas_empresas()));

-- migrações: só o administrador
create policy "admin vê migrações" on precificacao.migracoes for select to authenticated
  using ((select precificacao.eh_admin()));

-- ---------------------------------------------------------------- carimbo
-- Quem e quando, e a versão de cada registro. A versão sobe a cada alteração:
-- a tela grava "só se ainda estiver na versão que eu li" e, se outra pessoa
-- salvou antes, fica sabendo em vez de apagar o trabalho dela.
-- Na importação da v1 (precificacao.migrando = on) o carimbo original é mantido.
create function precificacao.nome_de_quem() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select m.nome from precificacao.membros m where m.user_id = (select auth.uid()) and m.nome is not null limit 1),
    (select u.email from auth.users u where u.id = (select auth.uid())));
$$;

create function precificacao.carimbar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('precificacao.migrando', true) = 'on' then
    return new;
  end if;
  new.alterado_em := now();
  new.alterado_por := (select auth.uid());
  new.alterado_por_nome := precificacao.nome_de_quem();
  if tg_op = 'UPDATE' then
    new.versao := old.versao + 1;
  else
    new.versao := 1;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['empresas', 'marketplaces', 'produtos', 'anuncios', 'ml_vinculos'] loop
    execute format('create trigger carimbar before insert or update on precificacao.%I
                    for each row execute function precificacao.carimbar()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- histórico automático
-- Guarda só os campos que mudaram (não a linha inteira), sem os campos de carimbo.
create function precificacao.registrar_historico() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_antes  jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_depois jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_ignorar text[] := array['alterado_em', 'alterado_por', 'alterado_por_nome', 'versao'];
  v_a jsonb := '{}'::jsonb;
  v_d jsonb := '{}'::jsonb;
  v_chave text;
  v_empresa uuid;
  v_registro uuid;
begin
  -- a importação da v1 registra UM evento na tabela de migrações, e não milhares aqui
  if current_setting('precificacao.migrando', true) = 'on' then
    return coalesce(new, old);
  end if;
  v_empresa := coalesce((v_depois->>'empresa_id')::uuid, (v_antes->>'empresa_id')::uuid,
                        (v_depois->>'id')::uuid, (v_antes->>'id')::uuid);
  v_registro := coalesce((v_depois->>'id')::uuid, (v_antes->>'id')::uuid,
                         (v_depois->>'anuncio_id')::uuid, (v_antes->>'anuncio_id')::uuid);
  if tg_op = 'UPDATE' then
    for v_chave in select jsonb_object_keys(v_depois) loop
      if v_chave <> all(v_ignorar) and (v_antes->v_chave) is distinct from (v_depois->v_chave) then
        v_a := v_a || jsonb_build_object(v_chave, v_antes->v_chave);
        v_d := v_d || jsonb_build_object(v_chave, v_depois->v_chave);
      end if;
    end loop;
    if v_d = '{}'::jsonb then return new; end if;   -- só mudou o carimbo: nada a registrar
  else
    v_a := v_antes; v_d := v_depois;
  end if;
  insert into precificacao.historico (empresa_id, tabela, registro_id, acao, quem, quem_nome, antes, depois)
  values (v_empresa, tg_table_name, v_registro,
          case tg_op when 'INSERT' then 'criou' when 'UPDATE' then 'alterou' else 'excluiu' end,
          (select auth.uid()), precificacao.nome_de_quem(), v_a, v_d);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['empresas', 'marketplaces', 'produtos', 'anuncios', 'ml_vinculos'] loop
    execute format('create trigger historico after insert or update or delete on precificacao.%I
                    for each row execute function precificacao.registrar_historico()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- Mercado Livre: status sem expor tokens
create function precificacao.status_ml(p_empresa uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case
    when not ((select precificacao.eh_admin()) or p_empresa in (select precificacao.minhas_empresas())) then null
    else coalesce(
      (select jsonb_build_object('conectado', c.refresh_token is not null, 'apelido', c.apelido, 'ml_user_id', c.ml_user_id)
         from precificacao.ml_conexoes c where c.empresa_id = p_empresa),
      jsonb_build_object('conectado', false))
  end;
$$;

-- ---------------------------------------------------------------- tempo real
-- Alterações de uma pessoa aparecem na tela das outras na hora, respeitando as regras acima.
alter publication supabase_realtime add table
  precificacao.empresas, precificacao.marketplaces, precificacao.produtos,
  precificacao.anuncios, precificacao.ml_vinculos;
