-- Funções que só rodam dentro dos gatilhos não precisam ser chamáveis pela API.
-- (As usadas pelas regras de acesso -- eh_admin, minhas_empresas e afins -- continuam
-- executáveis: o banco confere a permissão de quem faz a consulta ao avaliar a regra,
-- e elas só devolvem informação do próprio usuário.)
revoke execute on function precificacao.carimbar() from authenticated, anon, public;
revoke execute on function precificacao.registrar_historico() from authenticated, anon, public;
revoke execute on function precificacao.nome_de_quem() from authenticated, anon, public;
