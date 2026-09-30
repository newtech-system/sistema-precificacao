-- Toda função nasce executável por PUBLIC (padrão do Postgres). O visitante (anon) já é barrado
-- no schema, mas aqui fecha a segunda porta: ninguém executa nada por padrão, e cada função que
-- a tela usa é liberada nominalmente para quem está logado.
-- Migrations futuras: criar a função e, se a tela chama, dar "grant execute ... to authenticated".
revoke execute on all functions in schema precificacao from public, anon;

grant execute on function
  -- usadas pelas regras de acesso (RLS)
  precificacao.eh_admin(), precificacao.minhas_empresas(),
  precificacao.empresas_que_edito(), precificacao.empresas_que_administro(),
  -- chamadas pela tela
  precificacao.status_ml(uuid),
  precificacao.importar_v1(uuid, jsonb, uuid, jsonb),
  precificacao.espelhar_exclusoes_v1(uuid, uuid, text[], text[], text[]),
  precificacao.equipe(uuid), precificacao.meu_papel(uuid),
  precificacao.alterar_papel(uuid, uuid, precificacao.papel), precificacao.remover_da_equipe(uuid, uuid),
  precificacao.alterar_meu_nome(text)
to authenticated;
