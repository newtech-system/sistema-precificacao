-- índice para a chave estrangeira de migrações (apontado pelo verificador de desempenho)
create index migracoes_por_empresa on precificacao.migracoes (empresa_id, iniciada_em desc);
