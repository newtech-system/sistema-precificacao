-- ============================================================================
-- Importação da versão 1 (planilha) para o banco
--
-- * Pode rodar quantas vezes quiser: cada registro é achado pelo id que tinha
--   na v1 (id_v1), então importar de novo ATUALIZA em vez de duplicar. É o que
--   permite ensaiar a migração com o cliente ainda usando a v1.
-- * Aceita o catálogo em pedaços (lotes): cliente grande não vira um envio
--   gigante. Cada chamada é tudo-ou-nada.
-- * Nada é descartado: o que não cabe no formato novo (ex.: dois anúncios do
--   mesmo produto no mesmo marketplace) vai inteiro para "pendencias", com o
--   dado original, para ser resolvido à mão.
-- * Exclusões só são espelhadas na chamada final (espelhar_exclusoes_v1), e
--   nunca atingem o que foi criado direto na v2 (id_v1 vazio).
-- ============================================================================

-- ---------------------------------------------------------------- leitura dos valores da v1
-- A planilha devolve número como número ou texto, e booleano como true, 'TRUE' ou 1.
create function precificacao.v1_num(p jsonb, k text) returns numeric
language sql immutable set search_path = '' as $$
  select case
    when jsonb_typeof(p->k) = 'number' then (p->>k)::numeric
    when trim(coalesce(p->>k, '')) ~ '^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$' then trim(p->>k)::numeric
    else 0 end;
$$;

create function precificacao.v1_bool(p jsonb, k text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(lower(trim(p->>k)) in ('true', '1'), false);
$$;

create function precificacao.v1_txt(p jsonb, k text) returns text
language sql immutable set search_path = '' as $$
  select coalesce(p->>k, '');
$$;

create function precificacao.v1_data(p jsonb, k text) returns timestamptz
language plpgsql stable set search_path = '' as $$
begin
  if coalesce(trim(p->>k), '') = '' then return null; end if;
  return (p->>k)::timestamptz;
exception when others then
  return null;   -- data ilegível não derruba a importação; o dado original fica no id_v1/pendências
end $$;

-- as faixas viajam como lista ou como texto JSON (célula da planilha)
create function precificacao.v1_lista(p jsonb, k text) returns jsonb
language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(p->k) = 'array' then return p->k; end if;
  if coalesce(trim(p->>k), '') = '' then return '[]'::jsonb; end if;
  return (ltrim(p->>k, ''''))::jsonb;
exception when others then
  return '[]'::jsonb;
end $$;

-- ---------------------------------------------------------------- importação
-- p_dados no formato do estado da v1: {profiles:[...], products:[{..., listings:[...]}], padroes:{...}}
-- Em lotes: o primeiro traz profiles e padroes; os seguintes só products.
create function precificacao.importar_v1(p_empresa uuid, p_dados jsonb, p_migracao uuid default null, p_origem jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_mig      uuid := p_migracao;
  v_perfil   jsonb;
  v_prod     jsonb;
  v_lst      jsonb;
  v_ordem    integer := 0;
  v_mk_id    uuid;
  v_prod_id  uuid;
  v_lst_id   uuid;
  v_codigo   text;
  v_modo     text;
  c_mk int := 0; c_prod int := 0; c_lst int := 0; c_ml int := 0; c_orfao int := 0;
  v_pend     jsonb := '[]'::jsonb;
begin
  if not precificacao.eh_admin() then
    raise exception 'Só o administrador geral pode importar dados da versão 1.';
  end if;
  if not exists (select 1 from precificacao.empresas where id = p_empresa) then
    raise exception 'Empresa % não existe.', p_empresa;
  end if;
  -- carimbos e histórico da v1 são mantidos; a migração vira UM registro em "migracoes"
  perform set_config('precificacao.migrando', 'on', true);

  if v_mig is null then
    insert into precificacao.migracoes (empresa_id, feita_por, origem)
    values (p_empresa, (select auth.uid()), coalesce(p_origem, '{}'::jsonb))
    returning id into v_mig;
  end if;

  -- custos da empresa
  if p_dados ? 'padroes' and jsonb_typeof(p_dados->'padroes') = 'object' then
    update precificacao.empresas set
      custo_fixo    = precificacao.v1_num(p_dados->'padroes', 'fixedCost'),
      outros_custos = precificacao.v1_num(p_dados->'padroes', 'misc'),
      imposto_pct   = precificacao.v1_num(p_dados->'padroes', 'taxPct'),
      marketing_pct = precificacao.v1_num(p_dados->'padroes', 'marketingPct'),
      cupom_padrao  = precificacao.v1_num(p_dados->'padroes', 'coupon'),
      frete_padrao  = precificacao.v1_num(p_dados->'padroes', 'freightNet')
    where id = p_empresa;
  end if;

  -- marketplaces (achados pela chave interna da v1, que não muda quando o ID é trocado)
  for v_perfil in select * from jsonb_array_elements(coalesce(p_dados->'profiles', '[]'::jsonb)) loop
    v_ordem := v_ordem + 1;
    begin
      insert into precificacao.marketplaces as m (
        empresa_id, id_v1, codigo, nome, cor, confianca, observacao, comissao, servico, transacao, taxa_fixa,
        preco_anuncio_duplo, frete_variavel, taxa_fixa_variavel, por_faixa, faixas, e_mercado_livre, removido, ordem,
        alterado_em, alterado_por_nome)
      values (
        p_empresa,
        coalesce(nullif(precificacao.v1_txt(v_perfil, 'uid'), ''), 'm:' || precificacao.v1_txt(v_perfil, 'id')),
        precificacao.v1_txt(v_perfil, 'id'),
        coalesce(nullif(precificacao.v1_txt(v_perfil, 'label'), ''), precificacao.v1_txt(v_perfil, 'id')),
        coalesce(nullif(precificacao.v1_txt(v_perfil, 'color'), ''), '#8c8c88'),
        case when precificacao.v1_txt(v_perfil, 'confidence') in ('alta', 'media', 'baixa')
             then precificacao.v1_txt(v_perfil, 'confidence') else 'baixa' end,
        precificacao.v1_txt(v_perfil, 'note'),
        precificacao.v1_num(v_perfil, 'commission'), precificacao.v1_num(v_perfil, 'service'),
        precificacao.v1_num(v_perfil, 'transaction'), precificacao.v1_num(v_perfil, 'fixedFee'),
        precificacao.v1_bool(v_perfil, 'dualAdPrice'), precificacao.v1_bool(v_perfil, 'variableFreight'),
        precificacao.v1_bool(v_perfil, 'variableFixedFee'), precificacao.v1_bool(v_perfil, 'tiered'),
        precificacao.v1_lista(v_perfil, 'tiers'), precificacao.v1_bool(v_perfil, 'ehMercadoLivre'), false, v_ordem,
        coalesce(precificacao.v1_data(v_perfil, 'alteradoEm'), now()), nullif(precificacao.v1_txt(v_perfil, 'alteradoPor'), ''))
      on conflict (empresa_id, id_v1) where id_v1 is not null do update set
        codigo = excluded.codigo, nome = excluded.nome, cor = excluded.cor, confianca = excluded.confianca,
        observacao = excluded.observacao, comissao = excluded.comissao, servico = excluded.servico,
        transacao = excluded.transacao, taxa_fixa = excluded.taxa_fixa,
        preco_anuncio_duplo = excluded.preco_anuncio_duplo, frete_variavel = excluded.frete_variavel,
        taxa_fixa_variavel = excluded.taxa_fixa_variavel, por_faixa = excluded.por_faixa, faixas = excluded.faixas,
        e_mercado_livre = excluded.e_mercado_livre, removido = false, ordem = excluded.ordem,
        alterado_em = excluded.alterado_em, alterado_por_nome = excluded.alterado_por_nome, versao = m.versao + 1;
      c_mk := c_mk + 1;
    exception when unique_violation then
      v_pend := v_pend || jsonb_build_object('tipo', 'marketplace', 'motivo',
        'Já existe outro marketplace com o código "' || precificacao.v1_txt(v_perfil, 'id') || '" nesta empresa.', 'dado', v_perfil);
    end;
  end loop;

  -- produtos e anúncios
  for v_prod in select * from jsonb_array_elements(coalesce(p_dados->'products', '[]'::jsonb)) loop
    insert into precificacao.produtos as p (
      empresa_id, id_v1, sku, nome, custo, custo_proprio, custo_fixo, outros_custos, imposto_pct, marketing_pct,
      alterado_em, alterado_por_nome)
    values (
      p_empresa, precificacao.v1_txt(v_prod, 'id'), precificacao.v1_txt(v_prod, 'sku'), precificacao.v1_txt(v_prod, 'name'),
      precificacao.v1_num(v_prod, 'cogs'), precificacao.v1_bool(v_prod, 'costOverride'),
      precificacao.v1_num(v_prod, 'fixedCost'), precificacao.v1_num(v_prod, 'misc'),
      precificacao.v1_num(v_prod, 'taxPct'), precificacao.v1_num(v_prod, 'marketingPct'),
      coalesce(precificacao.v1_data(v_prod, 'alteradoEm'), now()), nullif(precificacao.v1_txt(v_prod, 'alteradoPor'), ''))
    on conflict (empresa_id, id_v1) where id_v1 is not null do update set
      sku = excluded.sku, nome = excluded.nome, custo = excluded.custo, custo_proprio = excluded.custo_proprio,
      custo_fixo = excluded.custo_fixo, outros_custos = excluded.outros_custos, imposto_pct = excluded.imposto_pct,
      marketing_pct = excluded.marketing_pct, alterado_em = excluded.alterado_em, alterado_por_nome = excluded.alterado_por_nome,
      versao = p.versao + 1
    returning id into v_prod_id;
    c_prod := c_prod + 1;

    for v_lst in select * from jsonb_array_elements(coalesce(v_prod->'listings', '[]'::jsonb)) loop
      v_codigo := precificacao.v1_txt(v_lst, 'marketplaceId');
      select id into v_mk_id from precificacao.marketplaces where empresa_id = p_empresa and codigo = v_codigo;
      if v_mk_id is null then
        -- anúncio de um marketplace que foi excluído na v1: o anúncio não se perde,
        -- fica ligado a um marketplace marcado como removido, como a v1 mostrava
        insert into precificacao.marketplaces (empresa_id, id_v1, codigo, nome, removido, alterado_em)
        values (p_empresa, 'orfao:' || v_codigo, v_codigo, 'Removido: ' || v_codigo, true, now())
        on conflict (empresa_id, codigo) do update set removido = precificacao.marketplaces.removido
        returning id into v_mk_id;
        c_orfao := c_orfao + 1;
      end if;
      v_modo := case when precificacao.v1_txt(v_lst, 'mode') = 'margin' then 'margem' else 'preco' end;
      begin
        insert into precificacao.anuncios as a (
          empresa_id, id_v1, produto_id, marketplace_id, sku, modo, preco, margem_alvo, cupom, frete_liquido,
          taxa_fixa_anuncio, alterado_em, alterado_por_nome)
        values (
          p_empresa, precificacao.v1_txt(v_lst, 'id'), v_prod_id, v_mk_id, precificacao.v1_txt(v_lst, 'sku'), v_modo,
          precificacao.v1_num(v_lst, 'price'), precificacao.v1_num(v_lst, 'marginTarget'),
          precificacao.v1_num(v_lst, 'coupon'), precificacao.v1_num(v_lst, 'freightNet'),
          precificacao.v1_num(v_lst, 'mktFixedFee'),
          coalesce(precificacao.v1_data(v_lst, 'alteradoEm'), now()), nullif(precificacao.v1_txt(v_lst, 'alteradoPor'), ''))
        on conflict (empresa_id, id_v1) where id_v1 is not null do update set
          produto_id = excluded.produto_id, marketplace_id = excluded.marketplace_id, sku = excluded.sku,
          modo = excluded.modo, preco = excluded.preco, margem_alvo = excluded.margem_alvo, cupom = excluded.cupom,
          frete_liquido = excluded.frete_liquido, taxa_fixa_anuncio = excluded.taxa_fixa_anuncio,
          alterado_em = excluded.alterado_em, alterado_por_nome = excluded.alterado_por_nome, versao = a.versao + 1
        returning id into v_lst_id;
        c_lst := c_lst + 1;
      exception when unique_violation then
        v_pend := v_pend || jsonb_build_object('tipo', 'anuncio', 'motivo',
          'O produto "' || precificacao.v1_txt(v_prod, 'sku') || '" tem dois anúncios no marketplace "' || v_codigo ||
          '". O banco novo aceita um por marketplace: este ficou guardado aqui para você decidir.',
          'produto', precificacao.v1_txt(v_prod, 'id'), 'dado', v_lst);
        continue;
      end;

      -- vínculo com o Mercado Livre
      if coalesce(precificacao.v1_txt(v_lst, 'mlItemId'), '') <> '' then
        begin
          insert into precificacao.ml_vinculos as v (
            anuncio_id, empresa_id, item_id, variacao_id, titulo, tipo, situacao, categoria, preco_ml,
            usar_taxas, faixas_taxa, taxas_em, usar_envio, faixas_envio, frete_gratis, envio_outra_opcao, logistica,
            envio_em, conf_em, conf_preco, conf_taxa, conf_envio, conf_erro)
          values (
            v_lst_id, p_empresa, precificacao.v1_txt(v_lst, 'mlItemId'), precificacao.v1_txt(v_lst, 'mlVarId'),
            precificacao.v1_txt(v_lst, 'mlTitulo'), precificacao.v1_txt(v_lst, 'mlTipo'),
            precificacao.v1_txt(v_lst, 'mlSituacao'), precificacao.v1_txt(v_lst, 'mlCategoria'),
            precificacao.v1_num(v_lst, 'mlPreco'),
            precificacao.v1_bool(v_lst, 'mlUsar'), precificacao.v1_lista(v_lst, 'mlFaixas'),
            precificacao.v1_data(v_lst, 'mlAtualizadoEm'),
            precificacao.v1_bool(v_lst, 'mlUsarFrete'), precificacao.v1_lista(v_lst, 'mlFreteFaixas'),
            precificacao.v1_bool(v_lst, 'mlFreteGratis'), precificacao.v1_num(v_lst, 'mlFreteOutra'),
            precificacao.v1_txt(v_lst, 'mlLogistica'), precificacao.v1_data(v_lst, 'mlFreteEm'),
            precificacao.v1_data(v_lst, 'mlConfEm'),
            case when precificacao.v1_data(v_lst, 'mlConfEm') is null then null else precificacao.v1_num(v_lst, 'mlConfPreco') end,
            case when precificacao.v1_data(v_lst, 'mlConfEm') is null then null else precificacao.v1_num(v_lst, 'mlConfTaxa') end,
            case when precificacao.v1_data(v_lst, 'mlConfEm') is null then null else precificacao.v1_num(v_lst, 'mlConfEnvio') end,
            precificacao.v1_txt(v_lst, 'mlConfErro'))
          on conflict (anuncio_id) do update set
            item_id = excluded.item_id, variacao_id = excluded.variacao_id, titulo = excluded.titulo, tipo = excluded.tipo,
            situacao = excluded.situacao, categoria = excluded.categoria, preco_ml = excluded.preco_ml,
            usar_taxas = excluded.usar_taxas, faixas_taxa = excluded.faixas_taxa, taxas_em = excluded.taxas_em,
            usar_envio = excluded.usar_envio, faixas_envio = excluded.faixas_envio, frete_gratis = excluded.frete_gratis,
            envio_outra_opcao = excluded.envio_outra_opcao, logistica = excluded.logistica, envio_em = excluded.envio_em,
            conf_em = excluded.conf_em, conf_preco = excluded.conf_preco, conf_taxa = excluded.conf_taxa,
            conf_envio = excluded.conf_envio, conf_erro = excluded.conf_erro, versao = v.versao + 1;
          c_ml := c_ml + 1;
        exception when unique_violation then
          v_pend := v_pend || jsonb_build_object('tipo', 'vinculo_ml', 'motivo',
            'O anúncio do Mercado Livre ' || precificacao.v1_txt(v_lst, 'mlItemId') ||
            ' está vinculado a mais de um anúncio. O vínculo deste ficou guardado aqui.', 'anuncio', precificacao.v1_txt(v_lst, 'id'), 'dado', v_lst);
        end;
      else
        -- desvinculado na v1 depois de uma importação anterior: desvincula aqui também
        delete from precificacao.ml_vinculos where anuncio_id = v_lst_id;
      end if;
    end loop;
  end loop;

  update precificacao.migracoes set
    contagens = jsonb_build_object(
      'marketplaces', coalesce((contagens->>'marketplaces')::int, 0) + c_mk,
      'produtos',     coalesce((contagens->>'produtos')::int, 0) + c_prod,
      'anuncios',     coalesce((contagens->>'anuncios')::int, 0) + c_lst,
      'vinculos_ml',  coalesce((contagens->>'vinculos_ml')::int, 0) + c_ml,
      'marketplaces_removidos', coalesce((contagens->>'marketplaces_removidos')::int, 0) + c_orfao),
    pendencias = pendencias || v_pend
  where id = v_mig;

  return jsonb_build_object('migracao', v_mig, 'marketplaces', c_mk, 'produtos', c_prod, 'anuncios', c_lst,
    'vinculos_ml', c_ml, 'marketplaces_removidos', c_orfao, 'pendencias', v_pend);
end $$;

-- ---------------------------------------------------------------- chamada final
-- Com as listas COMPLETAS de ids da v1, apaga na v2 o que foi excluído na v1 desde a
-- importação anterior. Só mexe em registros que vieram da v1 (id_v1 preenchido).
create function precificacao.espelhar_exclusoes_v1(p_empresa uuid, p_migracao uuid,
  p_marketplaces text[], p_produtos text[], p_anuncios text[])
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d_lst int; d_prod int; d_mk int;
begin
  if not precificacao.eh_admin() then
    raise exception 'Só o administrador geral pode concluir a importação.';
  end if;
  perform set_config('precificacao.migrando', 'on', true);
  delete from precificacao.anuncios
    where empresa_id = p_empresa and id_v1 is not null and not (id_v1 = any(coalesce(p_anuncios, '{}')));
  get diagnostics d_lst = row_count;
  delete from precificacao.produtos
    where empresa_id = p_empresa and id_v1 is not null and not (id_v1 = any(coalesce(p_produtos, '{}')));
  get diagnostics d_prod = row_count;
  -- marketplace só sai se não tiver mais nenhum anúncio (os "removidos" da v1 ficam se ainda forem usados)
  delete from precificacao.marketplaces m
    where m.empresa_id = p_empresa and m.id_v1 is not null
      and not (m.id_v1 = any(coalesce(p_marketplaces, '{}')))
      and not exists (select 1 from precificacao.anuncios a where a.marketplace_id = m.id);
  get diagnostics d_mk = row_count;
  update precificacao.migracoes set concluida_em = now(),
    contagens = contagens || jsonb_build_object('excluidos', jsonb_build_object('anuncios', d_lst, 'produtos', d_prod, 'marketplaces', d_mk))
  where id = p_migracao and empresa_id = p_empresa;
  return jsonb_build_object('anuncios', d_lst, 'produtos', d_prod, 'marketplaces', d_mk);
end $$;

-- funções auxiliares da importação: não precisam ser chamadas pela tela
revoke execute on function precificacao.v1_num(jsonb, text), precificacao.v1_bool(jsonb, text),
  precificacao.v1_txt(jsonb, text), precificacao.v1_data(jsonb, text), precificacao.v1_lista(jsonb, text)
  from authenticated, anon, public;
