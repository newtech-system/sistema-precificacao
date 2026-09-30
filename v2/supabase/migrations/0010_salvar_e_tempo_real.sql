-- ============================================================================
-- Gravação do sistema e aviso em tempo real.
--
-- A tela da v2 é a mesma da v1: guarda o catálogo inteiro na memória e, a cada alteração,
-- manda ao banco SÓ o que mudou (campo a campo), num lote. "salvar" aplica o lote numa
-- transação, conferindo a versão de cada registro: se outra pessoa gravou antes, aquele item
-- volta como conflito, com o valor atual, e a tela junta as duas alterações (a mesma junção da
-- v1) em vez de apagar uma delas.
--
-- Roda com a permissão de quem chama (security invoker): as regras de acesso (RLS) valem para
-- cada linha, e o carimbo e o histórico continuam sendo feitos pelos gatilhos.
--
-- Ao terminar, avisa quem está com a empresa aberta com UMA mensagem por lote (não uma por
-- linha): a lista do que mudou, para cada tela buscar só aquilo.
-- ============================================================================

-- ---------------------------------------------------------------- campos que a v1 guarda
-- "ID acompanha o nome" do marketplace novo, e o retrato da faixa do ML no último "Atualizar taxas".
alter table precificacao.marketplaces add column id_manual boolean not null default true;
alter table precificacao.ml_vinculos
  add column ml_pct   numeric not null default 0,
  add column ml_fixo  numeric not null default 0,
  add column ml_frete numeric not null default 0;

-- Na v1, "Desvincular" apaga o anúncio do ML mas mantém o envio puxado de lá (e a conferência).
-- Para guardar isso, o vínculo pode existir sem anúncio do ML; a regra "um anúncio do ML para um
-- anúncio daqui" só vale quando há anúncio do ML.
drop index precificacao.ml_vinculos_item;
create unique index ml_vinculos_item on precificacao.ml_vinculos (empresa_id, item_id, variacao_id) where item_id <> '';

-- ---------------------------------------------------------------- mesma empresa
-- Um anúncio só pode apontar para produto e marketplace da própria empresa (a chave estrangeira
-- sozinha aceitaria o de outra empresa).
create function precificacao.conferir_empresa() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'anuncios' then
    if not exists (select 1 from precificacao.produtos where id = new.produto_id and empresa_id = new.empresa_id)
       or not exists (select 1 from precificacao.marketplaces where id = new.marketplace_id and empresa_id = new.empresa_id) then
      raise exception 'Anúncio ligado a produto ou marketplace de outra empresa.' using errcode = '23503';
    end if;
  else
    if not exists (select 1 from precificacao.anuncios where id = new.anuncio_id and empresa_id = new.empresa_id) then
      raise exception 'Vínculo do Mercado Livre ligado a anúncio de outra empresa.' using errcode = '23503';
    end if;
  end if;
  return new;
end $$;
create trigger conferir_empresa before insert or update of empresa_id, produto_id, marketplace_id
  on precificacao.anuncios for each row execute function precificacao.conferir_empresa();
create trigger conferir_empresa before insert or update of empresa_id, anuncio_id
  on precificacao.ml_vinculos for each row execute function precificacao.conferir_empresa();

-- ---------------------------------------------------------------- aviso em tempo real
-- Canal privado "precificacao:<empresa>": só quem é da empresa (ou o administrador) recebe.
create function precificacao.avisar(p_empresa uuid, p_mudou jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not ((select precificacao.eh_admin()) or p_empresa in (select precificacao.minhas_empresas())) then
    return;
  end if;
  perform realtime.send(
    case when p_mudou is null or jsonb_array_length(p_mudou) > 300
      then jsonb_build_object('por', (select auth.uid()), 'recarregar', true)   -- lote grande: cada tela relê tudo
      else jsonb_build_object('por', (select auth.uid()), 'mudou', p_mudou) end,
    'mudou', 'precificacao:' || p_empresa::text, true);
end $$;

create policy "precificacao: membro recebe os avisos da empresa" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() like 'precificacao:%'
    and (
      (select precificacao.eh_admin())
      or substr(realtime.topic(), 14) in (select e::text from precificacao.minhas_empresas() e)
    )
  );

-- O aviso agora sai do "salvar". Tirar as tabelas da publicação poupa o servidor de tempo real
-- de examinar cada linha gravada (o que pesa com muitos clientes).
alter publication supabase_realtime drop table
  precificacao.empresas, precificacao.marketplaces, precificacao.produtos,
  precificacao.anuncios, precificacao.ml_vinculos;

-- ---------------------------------------------------------------- salvar
-- p_ops: lista de {t, acao: inserir|alterar|excluir, id, versao, campos}
--   t = marketplaces | produtos | anuncios | ml_vinculos (id = anuncio_id) | empresas (id = a empresa)
-- Devolve uma resposta por operação, na mesma ordem:
--   {i, ok, versao}           gravou (versao nova; em exclusão, sem versao)
--   {i, ok, removido, versao} marketplace com anúncios: ficou marcado como removido, como na v1
--   {i, conflito, atual}      alguém gravou antes: "atual" é o registro como está agora
--   {i, sumiu}                o registro foi excluído por outra pessoa
--   {i, erro, msg}            não gravou (permissão, valor inválido, duplicado...)
create function precificacao.salvar(p_empresa uuid, p_ops jsonb) returns jsonb
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
      when 'empresas' then array['custo_fixo','outros_custos','imposto_pct','marketing_pct','cupom_padrao','frete_padrao']
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

-- Depois de uma importação da v1 (fora do "salvar"): manda todo mundo reler.
create function precificacao.avisar_recarregar(p_empresa uuid) returns void
language sql security invoker set search_path = '' as $$
  select precificacao.avisar(p_empresa, null);
$$;

-- ---------------------------------------------------------------- quem executa o quê
revoke execute on function precificacao.conferir_empresa(), precificacao.avisar(uuid, jsonb),
  precificacao.salvar(uuid, jsonb), precificacao.avisar_recarregar(uuid)
from public, anon;
grant execute on function precificacao.avisar(uuid, jsonb), precificacao.salvar(uuid, jsonb),
  precificacao.avisar_recarregar(uuid)
to authenticated;
revoke execute on function precificacao.conferir_empresa() from authenticated;
