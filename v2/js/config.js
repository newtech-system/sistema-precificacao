// Endereço do banco e chave PÚBLICA. Esta chave é feita para ficar na página: quem protege os
// dados são as regras de acesso do banco (cada usuário só enxerga as empresas das quais é membro).
// A chave secreta do banco nunca entra aqui.
export const SUPABASE_URL = 'https://zbvnybygbzkqxmarwhlc.supabase.co';
export const SUPABASE_CHAVE_PUBLICA = 'sb_publishable_t7zeViupfPtyQtgCZhjFGQ_BaO9h8rB';
export const SCHEMA = 'precificacao';

// Biblioteca do Supabase com versão FIXA: atualização automática de biblioteca em produção é
// fonte de defeito surpresa. Para atualizar, troque aqui de propósito e teste.
export const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
