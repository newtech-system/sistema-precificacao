-- Senha provisória nova também encerra as sessões abertas da pessoa (em qualquer aparelho):
-- se a senha foi trocada porque vazou, quem estava usando a conta sai na hora em que o
-- acesso expira (até 1 hora), sem conseguir renovar.
create or replace function precificacao.srv_registrar_senha_redefinida(p_ator uuid, p_alvo uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from auth.sessions where user_id = p_alvo;   -- os refresh tokens caem junto (cascata)
  insert into precificacao.historico (empresa_id, tabela, registro_id, acao, quem, quem_nome, antes, depois)
  select m.empresa_id, 'membros', p_alvo, 'alterou', p_ator, precificacao.nome_do_usuario(p_ator),
         null, jsonb_build_object('senha', 'provisória nova')
  from precificacao.membros m
  where m.user_id = p_alvo and precificacao.administra(p_ator, m.empresa_id);
end $$;
