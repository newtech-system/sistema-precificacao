-- O nome em "alterado por" e no histórico: o da equipe; se a pessoa não está em equipe nenhuma
-- (o administrador geral), o nome que ela salvou em "Minha conta"; por último, o e-mail.
create or replace function precificacao.nome_de_quem() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select m.nome from precificacao.membros m where m.user_id = (select auth.uid()) and m.nome is not null limit 1),
    (select nullif(btrim(u.raw_user_meta_data->>'nome'), '') from auth.users u where u.id = (select auth.uid())),
    (select u.email from auth.users u where u.id = (select auth.uid())));
$$;
create or replace function precificacao.nome_do_usuario(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select m.nome from precificacao.membros m where m.user_id = p_user and m.nome is not null limit 1),
    (select nullif(btrim(u.raw_user_meta_data->>'nome'), '') from auth.users u where u.id = p_user),
    (select u.email from auth.users u where u.id = p_user));
$$;

-- A tela lê o histórico da empresa do mais novo para o mais antigo, em páginas: este índice deixa
-- essa leitura rápida mesmo com milhões de linhas.
create index historico_por_empresa_id on precificacao.historico (empresa_id, id desc);
