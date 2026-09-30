-- ============================================================================
-- Sistema de precificação, versão 2 -- estrutura do banco
--
-- Tudo mora no schema "precificacao": durante a construção o banco divide o
-- projeto com outro sistema, e o schema próprio garante que as tabelas não se
-- misturem. Para mover para um projeto só dele, basta rodar estes arquivos lá,
-- na ordem.
--
-- Princípios:
--  * Cada cliente é uma EMPRESA. O banco garante (RLS) que um usuário só enxerga
--    as empresas das quais é membro; o administrador geral enxerga todas.
--  * Cada alteração grava só a linha que mudou, com número de VERSÃO, para
--    detectar duas pessoas editando o mesmo registro ao mesmo tempo.
--  * O HISTÓRICO é escrito pelo próprio banco (gatilhos): nenhuma tela consegue
--    alterar algo sem deixar rastro.
--  * Números sem limite de casas (numeric): a migração da versão 1 não pode
--    arredondar nada.
--  * Cada registro guarda o id que tinha na versão 1 (id_v1): importar de novo
--    atualiza em vez de duplicar.
-- ============================================================================

create schema if not exists precificacao;

-- ---------------------------------------------------------------- empresas
create table precificacao.empresas (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null check (length(trim(nome)) > 0),
  -- "Custos da empresa": valem para todos os produtos que não destravaram o custo
  custo_fixo      numeric not null default 0,
  outros_custos   numeric not null default 0,
  imposto_pct     numeric not null default 0,
  marketing_pct   numeric not null default 0,
  cupom_padrao    numeric not null default 0,
  frete_padrao    numeric not null default 0,
  criado_em       timestamptz not null default now(),
  alterado_em     timestamptz not null default now(),
  alterado_por    uuid,
  alterado_por_nome text,
  versao          integer not null default 1
);

-- administrador geral: o fornecedor do sistema, enxerga todas as empresas.
-- Não há como virar administrador pela tela: só por SQL, no painel.
create table precificacao.administradores (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  criado_em timestamptz not null default now()
);

create type precificacao.papel as enum ('dono', 'editor', 'leitor');

create table precificacao.membros (
  empresa_id uuid not null references precificacao.empresas(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  papel      precificacao.papel not null default 'editor',
  nome       text,
  criado_em  timestamptz not null default now(),
  primary key (empresa_id, user_id)
);
create index membros_por_usuario on precificacao.membros (user_id);

-- ---------------------------------------------------------------- acesso
-- As regras de acesso usam estas funções. "security definer" com search_path
-- vazio: rodam com permissão para ler "membros" sem expor a tabela, e não podem
-- ser enganadas por um objeto com o mesmo nome em outro schema.
-- As que devolvem conjuntos (minhas_empresas) entram nas regras como
-- "empresa_id in (select ...)": o banco calcula a lista UMA vez por consulta,
-- e não uma vez por linha -- é o que mantém a velocidade com catálogo grande.
create function precificacao.eh_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from precificacao.administradores where user_id = (select auth.uid()));
$$;

create function precificacao.minhas_empresas() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select empresa_id from precificacao.membros where user_id = (select auth.uid());
$$;

create function precificacao.empresas_que_edito() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select empresa_id from precificacao.membros
  where user_id = (select auth.uid()) and papel in ('dono', 'editor');
$$;

create function precificacao.empresas_que_administro() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select empresa_id from precificacao.membros
  where user_id = (select auth.uid()) and papel = 'dono';
$$;

-- ---------------------------------------------------------------- marketplaces
create table precificacao.marketplaces (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid not null references precificacao.empresas(id) on delete cascade,
  codigo             text not null check (length(trim(codigo)) > 0),   -- o "ID do marketplace" (fim do SKU)
  nome               text not null,
  cor                text not null default '#8c8c88',
  confianca          text not null default 'baixa' check (confianca in ('alta', 'media', 'baixa')),
  observacao         text not null default '',
  comissao           numeric not null default 0,
  servico            numeric not null default 0,
  transacao          numeric not null default 0,
  taxa_fixa          numeric not null default 0,
  preco_anuncio_duplo boolean not null default false,
  frete_variavel     boolean not null default false,
  taxa_fixa_variavel boolean not null default false,
  por_faixa          boolean not null default false,
  faixas             jsonb not null default '[]'::jsonb,
  e_mercado_livre    boolean not null default false,
  removido           boolean not null default false,   -- veio da v1 só como referência de anúncio órfão
  ordem              integer not null default 0,
  id_v1              text,
  criado_em          timestamptz not null default now(),
  alterado_em        timestamptz not null default now(),
  alterado_por       uuid,
  alterado_por_nome  text,
  versao             integer not null default 1,
  unique (empresa_id, codigo)
);
create unique index marketplaces_id_v1 on precificacao.marketplaces (empresa_id, id_v1) where id_v1 is not null;

-- ---------------------------------------------------------------- produtos
create table precificacao.produtos (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references precificacao.empresas(id) on delete cascade,
  sku               text not null,
  nome              text not null default '',
  custo             numeric not null default 0,   -- CMV
  custo_proprio     boolean not null default false,  -- destravou os custos da empresa
  custo_fixo        numeric not null default 0,
  outros_custos     numeric not null default 0,
  imposto_pct       numeric not null default 0,
  marketing_pct     numeric not null default 0,
  id_v1             text,
  criado_em         timestamptz not null default now(),
  alterado_em       timestamptz not null default now(),
  alterado_por      uuid,
  alterado_por_nome text,
  versao            integer not null default 1
);
create index produtos_por_empresa_sku on precificacao.produtos (empresa_id, lower(sku));
create unique index produtos_id_v1 on precificacao.produtos (empresa_id, id_v1) where id_v1 is not null;

-- ---------------------------------------------------------------- anúncios
create table precificacao.anuncios (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references precificacao.empresas(id) on delete cascade,
  produto_id        uuid not null references precificacao.produtos(id) on delete cascade,
  -- ligado pelo id interno: trocar o "código" do marketplace nunca quebra o vínculo
  marketplace_id    uuid not null references precificacao.marketplaces(id) on delete restrict,
  sku               text not null default '',
  modo              text not null default 'preco' check (modo in ('preco', 'margem')),
  preco             numeric not null default 0,
  margem_alvo       numeric not null default 0,
  cupom             numeric not null default 0,
  frete_liquido     numeric not null default 0,
  taxa_fixa_anuncio numeric not null default 0,
  id_v1             text,
  criado_em         timestamptz not null default now(),
  alterado_em       timestamptz not null default now(),
  alterado_por      uuid,
  alterado_por_nome text,
  versao            integer not null default 1,
  unique (produto_id, marketplace_id)   -- um anúncio por marketplace em cada produto
);
create index anuncios_por_empresa on precificacao.anuncios (empresa_id);
create index anuncios_por_marketplace on precificacao.anuncios (marketplace_id);
create index anuncios_por_sku on precificacao.anuncios (empresa_id, lower(sku));
create unique index anuncios_id_v1 on precificacao.anuncios (empresa_id, id_v1) where id_v1 is not null;

-- ---------------------------------------------------------------- Mercado Livre
-- vínculo de um anúncio com o anúncio de verdade no ML, e as taxas puxadas de lá
create table precificacao.ml_vinculos (
  anuncio_id         uuid primary key references precificacao.anuncios(id) on delete cascade,
  empresa_id         uuid not null references precificacao.empresas(id) on delete cascade,
  item_id            text not null,
  variacao_id        text not null default '',
  titulo             text not null default '',
  tipo               text not null default '',
  situacao           text not null default '',
  categoria          text not null default '',
  preco_ml           numeric not null default 0,
  usar_taxas         boolean not null default true,
  faixas_taxa        jsonb not null default '[]'::jsonb,
  taxas_em           timestamptz,
  usar_envio         boolean not null default true,
  faixas_envio       jsonb not null default '[]'::jsonb,
  frete_gratis       boolean not null default false,
  envio_outra_opcao  numeric not null default 0,
  logistica          text not null default '',
  envio_em           timestamptz,
  conf_em            timestamptz,
  conf_preco         numeric,
  conf_taxa          numeric,
  conf_envio         numeric,
  conf_erro          text not null default '',
  alterado_em        timestamptz not null default now(),
  alterado_por       uuid,
  alterado_por_nome  text,
  versao             integer not null default 1
);
create unique index ml_vinculos_item on precificacao.ml_vinculos (empresa_id, item_id, variacao_id);

-- autorização de cada empresa no ML. Sem nenhuma regra de leitura: só as
-- funções do servidor (service role) enxergam os tokens.
create table precificacao.ml_conexoes (
  empresa_id    uuid primary key references precificacao.empresas(id) on delete cascade,
  ml_user_id    text,
  apelido       text,
  access_token  text,
  refresh_token text,
  expira_em     timestamptz,
  atualizado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------- histórico
create table precificacao.historico (
  id         bigint generated always as identity primary key,
  empresa_id uuid not null,
  tabela     text not null,
  registro_id uuid,
  acao       text not null check (acao in ('criou', 'alterou', 'excluiu')),
  quem       uuid,
  quem_nome  text,
  quando     timestamptz not null default now(),
  antes      jsonb,
  depois     jsonb
);
create index historico_por_empresa on precificacao.historico (empresa_id, quando desc);
create index historico_por_registro on precificacao.historico (registro_id, quando desc);

-- ---------------------------------------------------------------- migrações da v1
create table precificacao.migracoes (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references precificacao.empresas(id) on delete cascade,
  feita_por    uuid,
  iniciada_em  timestamptz not null default now(),
  concluida_em timestamptz,
  origem       jsonb not null default '{}'::jsonb,
  contagens    jsonb not null default '{}'::jsonb,
  pendencias   jsonb not null default '[]'::jsonb   -- o que não coube no formato novo, guardado inteiro
);
