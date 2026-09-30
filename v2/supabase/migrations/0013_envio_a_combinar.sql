-- ============================================================================
-- Entrega "combinar com o comprador" no Mercado Livre: o envio vira um percentual do preço de
-- venda (padrão 20%), ajustável por empresa na tela do Mercado Livre -- como na v1.
-- A coluna nova entra no "salvar" (que a tela usa para gravar) e na importação da v1.
-- ============================================================================
alter table precificacao.empresas add column envio_combinar_pct numeric not null default 20;

create or replace function precificacao.salvar(p_empresa uuid, p_ops jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_op     jsonb;
  v_i      int := -1;
  v_t      text;
  v_acao   text;
  v_id     uuid;
  v_versao int;
  v_campos jsonb;
  v_perm   text[];
  v_cols   text;
  v_pk     text;
  v_dono   text;
  v_nova   int;
  v_soft   boolean;
  v_atual  jsonb;
  v_res    jsonb := '[]'::jsonb;
  v_mudou  jsonb := '[]'::jsonb;
begin
  if p_ops is null or jsonb_typeof(p_ops) <> 'array' then
    raise exception 'Lote inválido.';
  end if;
  if jsonb_array_length(p_ops) > 1000 then
    raise exception 'No máximo 1000 alterações por lote.';
  end if;

  for v_op in select value from jsonb_array_elements(p_ops) loop
    v_i := v_i + 1;
    v_t := v_op->>'t';
    v_acao := v_op->>'acao';
    v_campos := coalesce(v_op->'campos', '{}'::jsonb);
    v_perm := case v_t
      when 'marketplaces' then array['codigo','nome','cor','confianca','observacao','comissao','servico','transacao',
        'taxa_fixa','preco_anuncio_duplo','frete_variavel','taxa_fixa_variavel','por_faixa','faixas','e_mercado_livre',
        'ordem','id_manual']
      when 'produtos' then array['sku','nome','custo','custo_proprio','custo_fixo','outros_custos','imposto_pct','marketing_pct']
      when 'anuncios' then array['produto_id','marketplace_id','sku','modo','preco','margem_alvo','cupom','frete_liquido',
        'taxa_fixa_anuncio']
      when 'ml_vinculos' then array['item_id','variacao_id','titulo','tipo','situacao','categoria','preco_ml','usar_taxas',
        'faixas_taxa','taxas_em','usar_envio','faixas_envio','frete_gratis','envio_outra_opcao','logistica','envio_em',
        'conf_em','conf_preco','conf_taxa','conf_envio','conf_erro','ml_pct','ml_fixo','ml_frete']
      when 'empresas' then array['custo_fixo','outros_custos','imposto_pct','marketing_pct','cupom_padrao','frete_padrao',
        'envio_combinar_pct']
      else null end;
    if v_perm is null or v_acao is null or v_acao not in ('inserir', 'alterar', 'excluir')
       or (v_t = 'empresas' and v_acao <> 'alterar') then
      v_res := v_res || jsonb_build_object('i', v_i, 'erro', 'operacao', 'msg', 'Operação desconhecida.');
      continue;
    end if;
    v_pk := case v_t when 'ml_vinculos' then 'anuncio_id' else 'id' end;
    v_dono := case v_t when 'empresas' then 'id' else 'empresa_id' end;
    select string_agg(format('%I', k), ', ') into v_cols
      from jsonb_object_keys(v_campos) as k where k = any(v_perm);

    begin
      v_id := case when v_t = 'empresas' then p_empresa else (v_op->>'id')::uuid end;
      v_versao := nullif(v_op->>'versao', '')::int;
      v_nova := null; v_soft := false; v_atual := null;

      if v_acao = 'inserir' then
        execute format(
          'insert into precificacao.%1$I (%2$I, empresa_id%3$s) select $1, $2%3$s
             from jsonb_populate_record(null::precificacao.%1$I, $3) returning versao',
          v_t, v_pk, coalesce(', ' || v_cols, ''))
          using v_id, p_empresa, v_campos into v_nova;

      elsif v_acao = 'alterar' then
        if v_cols is null then
          -- nada a gravar: só confere se a versão ainda é a mesma
          execute format('select versao from precificacao.%I where %I = $1 and %I = $2', v_t, v_pk, v_dono)
            using v_id, p_empresa into v_nova;
          if v_nova is distinct from v_versao then v_nova := null; end if;
        else
          execute format(
            'update precificacao.%1$I set (%2$s) = (select %2$s from jsonb_populate_record(null::precificacao.%1$I, $1))
              where %3$I = $2 and %4$I = $3 and versao = $4 returning versao',
            v_t, v_cols, v_pk, v_dono)
            using v_campos, v_id, p_empresa, v_versao into v_nova;
        end if;

      else  -- excluir
        begin
          execute format('delete from precificacao.%I where %I = $1 and empresa_id = $2 and versao = $3 returning versao',
                         v_t, v_pk)
            using v_id, p_empresa, v_versao into v_nova;
        exception when foreign_key_violation then
          -- marketplace que ainda tem anúncios: some da lista mas os anúncios ficam, marcados como
          -- "marketplace removido" -- exatamente o que a v1 faz. O código ganha um final para
          -- liberar o ID para um marketplace novo.
          update precificacao.marketplaces
             set removido = true, codigo = codigo || '~removido~' || left(id::text, 8)
           where id = v_id and empresa_id = p_empresa and versao = v_versao
          returning versao into v_nova;
          v_soft := v_nova is not null;
        end;
      end if;

      if v_nova is not null then
        if v_acao = 'excluir' and not v_soft then
          v_res := v_res || jsonb_build_object('i', v_i, 'ok', true);
          v_mudou := v_mudou || jsonb_build_object('t', v_t, 'id', v_id, 'v', null);
        else
          v_res := v_res || jsonb_build_object('i', v_i, 'ok', true, 'versao', v_nova, 'removido', v_soft);
          v_mudou := v_mudou || jsonb_build_object('t', v_t, 'id', v_id, 'v', v_nova);
        end if;
      else
        -- não gravou: por quê?
        execute format('select to_jsonb(x) from precificacao.%I x where %I = $1 and %I = $2', v_t, v_pk, v_dono)
          using v_id, p_empresa into v_atual;
        if v_atual is null then
          v_res := v_res || case when v_acao = 'excluir'
            then jsonb_build_object('i', v_i, 'ok', true)                 -- já não existia: o pedido está cumprido
            else jsonb_build_object('i', v_i, 'sumiu', true) end;
        elsif (v_atual->>'versao')::int = v_versao then
          -- mesma versão e mesmo assim não gravou: as regras de acesso barraram
          v_res := v_res || jsonb_build_object('i', v_i, 'erro', 'permissao', 'msg', 'Seu usuário não pode alterar isto nesta empresa.');
        else
          v_res := v_res || jsonb_build_object('i', v_i, 'conflito', true, 'atual', v_atual);
        end if;
      end if;

    exception
      when unique_violation then
        -- inserir de novo algo que já está lá (ex.: o envio anterior chegou e a resposta se perdeu):
        -- devolve o que está gravado, e a tela junta
        v_atual := null;
        if v_acao = 'inserir' then
          execute format('select to_jsonb(x) from precificacao.%I x where %I = $1 and %I = $2', v_t, v_pk, v_dono)
            using v_id, p_empresa into v_atual;
        end if;
        v_res := v_res || case when v_atual is not null
          then jsonb_build_object('i', v_i, 'conflito', true, 'atual', v_atual)
          else jsonb_build_object('i', v_i, 'erro', 'duplicado', 'msg', sqlerrm) end;
      when insufficient_privilege then
        v_res := v_res || jsonb_build_object('i', v_i, 'erro', 'permissao', 'msg', 'Seu usuário não pode alterar isto nesta empresa.');
      when others then
        v_res := v_res || jsonb_build_object('i', v_i, 'erro', sqlstate, 'msg', sqlerrm);
    end;
  end loop;

  if jsonb_array_length(v_mudou) > 0 then
    perform precificacao.avisar(p_empresa, v_mudou);
  end if;
  return v_res;
end $$;

create or replace function precificacao.importar_v1(p_empresa uuid, p_dados jsonb, p_migracao uuid default null, p_origem jsonb default '{}'::jsonb)
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
  v_ileg     jsonb;
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
    v_ileg := precificacao.v1_ilegiveis(p_dados->'padroes', array['fixedCost','misc','taxPct','marketingPct','coupon','freightNet','envioCombinarPct']);
    if jsonb_array_length(v_ileg) > 0 then
      v_pend := v_pend || jsonb_build_object('tipo', 'valor_ilegivel', 'registro', 'custos da empresa', 'campos', v_ileg,
        'motivo', 'Valor que não é número: gravado como 0 e o texto original ficou guardado aqui.');
    end if;
    update precificacao.empresas set
      custo_fixo    = precificacao.v1_num(p_dados->'padroes', 'fixedCost'),
      outros_custos = precificacao.v1_num(p_dados->'padroes', 'misc'),
      imposto_pct   = precificacao.v1_num(p_dados->'padroes', 'taxPct'),
      marketing_pct = precificacao.v1_num(p_dados->'padroes', 'marketingPct'),
      cupom_padrao  = precificacao.v1_num(p_dados->'padroes', 'coupon'),
      frete_padrao  = precificacao.v1_num(p_dados->'padroes', 'freightNet'),
      -- como na v1: sem valor gravado, vale o padrão de 20%
      envio_combinar_pct = case when precificacao.v1_txt(p_dados->'padroes', 'envioCombinarPct') = '' then 20
                                else precificacao.v1_num(p_dados->'padroes', 'envioCombinarPct') end
    where id = p_empresa;
  end if;

  -- marketplaces (achados pela chave interna da v1, que não muda quando o ID é trocado)
  for v_perfil in select * from jsonb_array_elements(coalesce(p_dados->'profiles', '[]'::jsonb)) loop
    v_ordem := v_ordem + 1;
    v_ileg := precificacao.v1_ilegiveis(v_perfil, array['commission','service','transaction','fixedFee']);
    if jsonb_array_length(v_ileg) > 0 then
      v_pend := v_pend || jsonb_build_object('tipo', 'valor_ilegivel', 'registro', 'marketplace ' || precificacao.v1_txt(v_perfil, 'id'),
        'campos', v_ileg, 'motivo', 'Valor que não é número: gravado como 0 e o texto original ficou guardado aqui.');
    end if;
    begin
      insert into precificacao.marketplaces as m (
        empresa_id, id_v1, codigo, nome, cor, confianca, observacao, comissao, servico, transacao, taxa_fixa,
        preco_anuncio_duplo, frete_variavel, taxa_fixa_variavel, por_faixa, faixas, e_mercado_livre, removido, ordem,
        id_manual, alterado_em, alterado_por_nome)
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
        -- como na v1: sem a informação, o ID é tratado como escrito à mão (nunca muda sozinho)
        case when precificacao.v1_txt(v_perfil, 'idManual') = '' then true else precificacao.v1_bool(v_perfil, 'idManual') end,
        coalesce(precificacao.v1_data(v_perfil, 'alteradoEm'), now()), nullif(precificacao.v1_txt(v_perfil, 'alteradoPor'), ''))
      on conflict (empresa_id, id_v1) where id_v1 is not null do update set
        codigo = excluded.codigo, nome = excluded.nome, cor = excluded.cor, confianca = excluded.confianca,
        observacao = excluded.observacao, comissao = excluded.comissao, servico = excluded.servico,
        transacao = excluded.transacao, taxa_fixa = excluded.taxa_fixa,
        preco_anuncio_duplo = excluded.preco_anuncio_duplo, frete_variavel = excluded.frete_variavel,
        taxa_fixa_variavel = excluded.taxa_fixa_variavel, por_faixa = excluded.por_faixa, faixas = excluded.faixas,
        e_mercado_livre = excluded.e_mercado_livre, removido = false, ordem = excluded.ordem, id_manual = excluded.id_manual,
        alterado_em = excluded.alterado_em, alterado_por_nome = excluded.alterado_por_nome, versao = m.versao + 1;
      c_mk := c_mk + 1;
    exception when unique_violation then
      v_pend := v_pend || jsonb_build_object('tipo', 'marketplace', 'motivo',
        'Já existe outro marketplace com o código "' || precificacao.v1_txt(v_perfil, 'id') || '" nesta empresa.', 'dado', v_perfil);
    end;
  end loop;

  -- produtos e anúncios
  for v_prod in select * from jsonb_array_elements(coalesce(p_dados->'products', '[]'::jsonb)) loop
    v_ileg := precificacao.v1_ilegiveis(v_prod, array['cogs','fixedCost','misc','taxPct','marketingPct']);
    if jsonb_array_length(v_ileg) > 0 then
      v_pend := v_pend || jsonb_build_object('tipo', 'valor_ilegivel', 'registro', 'produto ' || precificacao.v1_txt(v_prod, 'sku'),
        'id_v1', precificacao.v1_txt(v_prod, 'id'), 'campos', v_ileg,
        'motivo', 'Valor que não é número: gravado como 0 e o texto original ficou guardado aqui.');
    end if;
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
      v_ileg := precificacao.v1_ilegiveis(v_lst, array['price','marginTarget','coupon','freightNet','mktFixedFee',
        'mlPreco','mlFreteOutra','mlConfPreco','mlConfTaxa','mlConfEnvio']);
      if jsonb_array_length(v_ileg) > 0 then
        v_pend := v_pend || jsonb_build_object('tipo', 'valor_ilegivel', 'registro', 'anúncio ' || precificacao.v1_txt(v_lst, 'sku'),
          'id_v1', precificacao.v1_txt(v_lst, 'id'), 'campos', v_ileg,
          'motivo', 'Valor que não é número: gravado como 0 e o texto original ficou guardado aqui.');
      end if;
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
      if precificacao.v1_tem_ml(v_lst) then
        begin
          insert into precificacao.ml_vinculos as v (
            anuncio_id, empresa_id, item_id, variacao_id, titulo, tipo, situacao, categoria, preco_ml,
            usar_taxas, faixas_taxa, taxas_em, usar_envio, faixas_envio, frete_gratis, envio_outra_opcao, logistica,
            envio_em, conf_em, conf_preco, conf_taxa, conf_envio, conf_erro, ml_pct, ml_fixo, ml_frete)
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
            precificacao.v1_txt(v_lst, 'mlConfErro'),
            precificacao.v1_num(v_lst, 'mlPct'), precificacao.v1_num(v_lst, 'mlFixo'), precificacao.v1_num(v_lst, 'mlFrete'))
          on conflict (anuncio_id) do update set
            item_id = excluded.item_id, variacao_id = excluded.variacao_id, titulo = excluded.titulo, tipo = excluded.tipo,
            situacao = excluded.situacao, categoria = excluded.categoria, preco_ml = excluded.preco_ml,
            usar_taxas = excluded.usar_taxas, faixas_taxa = excluded.faixas_taxa, taxas_em = excluded.taxas_em,
            usar_envio = excluded.usar_envio, faixas_envio = excluded.faixas_envio, frete_gratis = excluded.frete_gratis,
            envio_outra_opcao = excluded.envio_outra_opcao, logistica = excluded.logistica, envio_em = excluded.envio_em,
            conf_em = excluded.conf_em, conf_preco = excluded.conf_preco, conf_taxa = excluded.conf_taxa,
            conf_envio = excluded.conf_envio, conf_erro = excluded.conf_erro, ml_pct = excluded.ml_pct,
            ml_fixo = excluded.ml_fixo, ml_frete = excluded.ml_frete, versao = v.versao + 1;
          c_ml := c_ml + 1;
        exception when unique_violation then
          v_pend := v_pend || jsonb_build_object('tipo', 'vinculo_ml', 'motivo',
            'O anúncio do Mercado Livre ' || precificacao.v1_txt(v_lst, 'mlItemId') ||
            ' está vinculado a mais de um anúncio. O vínculo deste ficou guardado aqui.', 'anuncio', precificacao.v1_txt(v_lst, 'id'), 'dado', v_lst);
        end;
      else
        -- sem nada do ML na v1 (nem o que sobra de um vínculo desfeito): tira daqui também
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

  perform set_config('precificacao.migrando', 'off', true);
  return jsonb_build_object('migracao', v_mig, 'marketplaces', c_mk, 'produtos', c_prod, 'anuncios', c_lst,
    'vinculos_ml', c_ml, 'marketplaces_removidos', c_orfao, 'pendencias', v_pend);
end $$;

