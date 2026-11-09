-- ============================================================================
-- Releitura automática do Mercado Livre, a cada 3 dias.
--
-- O que o botão "Atualizar taxas e envio dos vinculados" faz com a tela aberta, o servidor passa a
-- fazer sozinho, empresa por empresa. Como ele roda sem ninguém olhando, as regras são mais
-- cuidadosas que as do botão:
--   * só grava o que MUDOU de verdade (senão cada volta mexeria em todo vínculo: versão nova,
--     histórico novo e conflito nas telas abertas, sem nada de novo para mostrar);
--   * não liga de volta "usar as taxas do ML" / "usar o envio do ML": se alguém desligou de
--     propósito, continua desligado;
--   * anda em fatias pequenas e lembra onde parou (cursor), então um catálogo grande termina em
--     várias chamadas, e duas chamadas ao mesmo tempo nunca pegam a mesma empresa (reserva).
--
-- Quem chama é o agendador do banco (pg_cron), por uma Edge Function com um segredo próprio. O
-- agendamento em si fica em ../agendar-releitura.sql, porque leva o endereço do projeto.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------- andamento por empresa
create table precificacao.ml_releituras (
  empresa_id         uuid primary key references precificacao.empresas(id) on delete cascade,
  ultima_completa_em timestamptz,                   -- fim da última volta completa
  iniciada_em        timestamptz,                   -- começo da volta em andamento (null = nenhuma)
  cursor             uuid,                          -- último vínculo já relido nesta volta
  cache_taxas        jsonb not null default '{}'::jsonb,   -- "categoria|tipo" -> faixas, só durante a volta
  tentou_em          timestamptz,                   -- reserva: outra chamada espera alguns minutos
  volta_lidos        integer not null default 0,
  volta_alterados    integer not null default 0,
  volta_erros        integer not null default 0,
  resumo             jsonb not null default '{}'::jsonb,   -- números da última volta completa
  ultimo_erro        text not null default ''
);
alter table precificacao.ml_releituras enable row level security;   -- sem regra: só o servidor
revoke all on precificacao.ml_releituras from authenticated, anon;

-- ---------------------------------------------------------------- quem aparece no histórico
-- Sem pessoa logada (a releitura do servidor), o nome vem de um valor da própria transação.
create or replace function precificacao.nome_de_quem() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    case when (select auth.uid()) is null then nullif(current_setting('precificacao.ator_nome', true), '') end,
    (select m.nome from precificacao.membros m where m.user_id = (select auth.uid()) and m.nome is not null limit 1),
    (select nullif(btrim(u.raw_user_meta_data->>'nome'), '') from auth.users u where u.id = (select auth.uid())),
    (select u.email from auth.users u where u.id = (select auth.uid())));
$$;

-- ---------------------------------------------------------------- o segredo do agendador
-- O segredo mora no Vault (criado por ../agendar-releitura.sql, nunca num arquivo). Compara pelo
-- hash dos dois lados, para a comparação não depender de onde os textos começam a diferir.
create function precificacao.srv_conferir_segredo_releitura(p_segredo text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_segredo, '') <> '' and exists (
    select 1 from vault.decrypted_secrets s
    where s.name = 'releitura_segredo'
      and extensions.digest(convert_to(s.decrypted_secret, 'utf8'), 'sha256')
        = extensions.digest(convert_to(p_segredo, 'utf8'), 'sha256'));
$$;

-- ---------------------------------------------------------------- quem precisa de releitura
-- Empresa conectada ao ML, com vínculo, cuja última volta completa passou de 3 dias (ou que está
-- no meio de uma volta), e que ninguém reservou nos últimos minutos.
create function precificacao.releitura_pendente() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from precificacao.ml_conexoes c
    left join precificacao.ml_releituras r on r.empresa_id = c.empresa_id
    where c.refresh_token is not null
      and (r.tentou_em is null or r.tentou_em < now() - interval '3 minutes')
      and (r.empresa_id is null or r.iniciada_em is not null or r.ultima_completa_em is null
           or r.ultima_completa_em < now() - interval '3 days')
      and exists (select 1 from precificacao.ml_vinculos v where v.empresa_id = c.empresa_id and v.item_id <> ''));
$$;

-- Reserva UMA empresa para esta chamada (a que está há mais tempo sem releitura) e devolve onde
-- parou (r_empresa, r_cursor, r_cache). A reserva é um "insert ... on conflict ... where" numa só
-- instrução: se duas chamadas chegarem juntas, só uma leva.
create function precificacao.srv_pegar_releitura()
returns table (r_empresa uuid, r_cursor uuid, r_cache jsonb)
language plpgsql volatile security definer set search_path = '' as $$
declare v_emp uuid;
begin
  for v_emp in
    select c.empresa_id
    from precificacao.ml_conexoes c
    left join precificacao.ml_releituras r on r.empresa_id = c.empresa_id
    where c.refresh_token is not null
      and (r.tentou_em is null or r.tentou_em < now() - interval '3 minutes')
      and (r.empresa_id is null or r.iniciada_em is not null or r.ultima_completa_em is null
           or r.ultima_completa_em < now() - interval '3 days')
      and exists (select 1 from precificacao.ml_vinculos v where v.empresa_id = c.empresa_id and v.item_id <> '')
    order by coalesce(r.ultima_completa_em, '-infinity'::timestamptz), c.empresa_id
    limit 5
  loop
    return query
      insert into precificacao.ml_releituras as r (empresa_id, tentou_em, iniciada_em)
      values (v_emp, now(), now())
      on conflict (empresa_id) do update
        set tentou_em = now(), iniciada_em = coalesce(r.iniciada_em, now())
        where r.tentou_em is null or r.tentou_em < now() - interval '3 minutes'
      returning r.empresa_id, r.cursor, r.cache_taxas;
    if found then return; end if;
  end loop;
end $$;

-- As próximas linhas a reler, em ordem fixa (pelo id do anúncio), a partir do cursor.
create function precificacao.srv_proximos_vinculos(p_empresa uuid, p_cursor uuid, p_limite integer)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.anuncio_id), '[]'::jsonb)
  from (
    select v.anuncio_id, v.item_id, v.variacao_id, v.categoria, v.tipo, v.situacao, v.preco_ml,
           v.faixas_taxa, v.faixas_envio, v.frete_gratis, v.logistica, v.envio_outra_opcao,
           a.modo, a.preco as preco_anuncio
    from precificacao.ml_vinculos v
    join precificacao.anuncios a on a.id = v.anuncio_id
    where v.empresa_id = p_empresa and v.item_id <> ''
      and (p_cursor is null or v.anuncio_id > p_cursor)
    order by v.anuncio_id
    limit greatest(1, least(coalesce(p_limite, 10), 50))
  ) x;
$$;

-- ---------------------------------------------------------------- gravar uma fatia
-- p_linhas: lista de {anuncio_id, categoria, tipo, situacao, faixas_taxa, faixas_envio, frete_gratis,
--                     logistica, envio_outra_opcao, ml_pct, ml_fixo, ml_frete}
-- Grava só quem mudou, deixa o histórico com o nome da rotina, e avisa as telas abertas.
-- p_fim = true fecha a volta (guarda o resumo e zera o andamento).
create function precificacao.srv_aplicar_releitura(
  p_empresa uuid, p_linhas jsonb, p_cursor uuid, p_cache jsonb, p_fim boolean,
  p_lidos integer, p_erros integer, p_ultimo_erro text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_l jsonb;
  v_o precificacao.ml_vinculos;
  v_cat text; v_tipo text; v_sit text;
  v_tx boolean; v_en boolean;
  v_versao integer;
  v_mudou jsonb := '[]'::jsonb;
  v_alterados integer := 0;
begin
  perform set_config('precificacao.ator_nome', 'Releitura automática (Mercado Livre)', true);

  for v_l in select value from jsonb_array_elements(coalesce(p_linhas, '[]'::jsonb)) loop
    select * into v_o from precificacao.ml_vinculos
     where anuncio_id = (v_l->>'anuncio_id')::uuid and empresa_id = p_empresa and item_id <> '' for update;
    if not found then continue; end if;

    v_cat  := coalesce(nullif(v_l->>'categoria', ''), v_o.categoria);
    v_tipo := coalesce(nullif(v_l->>'tipo', ''), v_o.tipo);
    v_sit  := coalesce(nullif(v_l->>'situacao', ''), v_o.situacao);
    v_tx := (v_l->'faixas_taxa') is not null and jsonb_typeof(v_l->'faixas_taxa') = 'array'
            and (v_o.faixas_taxa is distinct from (v_l->'faixas_taxa') or v_o.categoria is distinct from v_cat
                 or v_o.tipo is distinct from v_tipo);
    v_en := (v_l->'faixas_envio') is not null and jsonb_typeof(v_l->'faixas_envio') = 'array'
            and (v_o.faixas_envio is distinct from (v_l->'faixas_envio')
                 or v_o.frete_gratis is distinct from coalesce((v_l->>'frete_gratis')::boolean, v_o.frete_gratis)
                 or v_o.logistica is distinct from coalesce(v_l->>'logistica', v_o.logistica)
                 or v_o.envio_outra_opcao is distinct from coalesce((v_l->>'envio_outra_opcao')::numeric, v_o.envio_outra_opcao));
    if not (v_tx or v_en or v_o.situacao is distinct from v_sit) then continue; end if;

    update precificacao.ml_vinculos set
      categoria = v_cat, tipo = v_tipo, situacao = v_sit,
      faixas_taxa = case when v_tx then v_l->'faixas_taxa' else faixas_taxa end,
      taxas_em    = case when v_tx then now() else taxas_em end,
      faixas_envio = case when v_en then v_l->'faixas_envio' else faixas_envio end,
      frete_gratis = case when v_en then coalesce((v_l->>'frete_gratis')::boolean, frete_gratis) else frete_gratis end,
      logistica    = case when v_en then coalesce(v_l->>'logistica', logistica) else logistica end,
      envio_outra_opcao = case when v_en then coalesce((v_l->>'envio_outra_opcao')::numeric, envio_outra_opcao) else envio_outra_opcao end,
      envio_em     = case when v_en then now() else envio_em end,
      ml_pct   = case when v_tx then coalesce((v_l->>'ml_pct')::numeric, ml_pct) else ml_pct end,
      ml_fixo  = case when v_tx then coalesce((v_l->>'ml_fixo')::numeric, ml_fixo) else ml_fixo end,
      ml_frete = case when v_en then coalesce((v_l->>'ml_frete')::numeric, ml_frete) else ml_frete end
     where anuncio_id = v_o.anuncio_id
    returning versao into v_versao;

    v_alterados := v_alterados + 1;
    v_mudou := v_mudou || jsonb_build_object('t', 'ml_vinculos', 'id', v_o.anuncio_id, 'v', v_versao);
  end loop;

  -- quem está com a empresa aberta busca só o que mudou (a tela relê anúncio e vínculo juntos)
  if v_alterados > 0 then
    perform realtime.send(
      case when v_alterados > 300
        then jsonb_build_object('recarregar', true)
        else jsonb_build_object('mudou', v_mudou) end,
      'mudou', 'precificacao:' || p_empresa::text, true);
  end if;

  if p_fim then
    update precificacao.ml_releituras set
      ultima_completa_em = now(), iniciada_em = null, cursor = null, cache_taxas = '{}'::jsonb, tentou_em = null,
      resumo = jsonb_build_object('em', now(), 'lidos', volta_lidos + coalesce(p_lidos, 0),
                                  'alterados', volta_alterados + v_alterados, 'erros', volta_erros + coalesce(p_erros, 0)),
      volta_lidos = 0, volta_alterados = 0, volta_erros = 0,
      ultimo_erro = coalesce(p_ultimo_erro, '')
     where empresa_id = p_empresa;
  else
    update precificacao.ml_releituras set
      cursor = p_cursor, cache_taxas = coalesce(p_cache, '{}'::jsonb), tentou_em = null,
      volta_lidos = volta_lidos + coalesce(p_lidos, 0), volta_alterados = volta_alterados + v_alterados,
      volta_erros = volta_erros + coalesce(p_erros, 0), ultimo_erro = coalesce(p_ultimo_erro, '')
     where empresa_id = p_empresa;
  end if;
  return jsonb_build_object('alterados', v_alterados);
end $$;

-- A empresa inteira falhou (autorização revogada, ML fora do ar): anota e espera 6 horas antes de
-- tentar de novo, em vez de bater no ML a cada 10 minutos.
create function precificacao.srv_falha_releitura(p_empresa uuid, p_erro text) returns void
language sql volatile security definer set search_path = '' as $$
  update precificacao.ml_releituras
     set ultimo_erro = left(coalesce(p_erro, ''), 500),
         tentou_em = now() + interval '6 hours'   -- a reserva vale 3 min depois disto: 6 h 3 min de espera
   where empresa_id = p_empresa;
$$;

-- ---------------------------------------------------------------- quem executa o quê
revoke execute on function
  precificacao.srv_conferir_segredo_releitura(text), precificacao.releitura_pendente(),
  precificacao.srv_pegar_releitura(), precificacao.srv_proximos_vinculos(uuid, uuid, integer),
  precificacao.srv_aplicar_releitura(uuid, jsonb, uuid, jsonb, boolean, integer, integer, text),
  precificacao.srv_falha_releitura(uuid, text)
from public, anon, authenticated;
grant execute on function
  precificacao.srv_conferir_segredo_releitura(text), precificacao.releitura_pendente(),
  precificacao.srv_pegar_releitura(), precificacao.srv_proximos_vinculos(uuid, uuid, integer),
  precificacao.srv_aplicar_releitura(uuid, jsonb, uuid, jsonb, boolean, integer, integer, text),
  precificacao.srv_falha_releitura(uuid, text)
to service_role;
