-- ============================================================================
-- Agendamento da releitura automática do Mercado Livre (a cada 3 dias por empresa).
--
-- NÃO é uma migração: leva o endereço do projeto e um segredo, então roda uma vez por projeto, à
-- mão, DEPOIS da migração 0014 e de publicar a Edge Function "precificacao-ml".
--
--   1. troque o endereço abaixo (https://<projeto>.supabase.co) se o projeto for outro;
--   2. rode este arquivo no SQL Editor do Supabase.
--
-- O que ele faz:
--   * cria (uma vez) o segredo "releitura_segredo" no Vault. O valor é sorteado pelo próprio banco e
--     nunca aparece num arquivo nem numa tela; só o agendador e a função o enxergam;
--   * agenda uma chamada a cada 5 minutos. Ela só acontece quando há empresa devendo releitura
--     (precificacao.releitura_pendente()): fora disso o agendador não chama nada.
--
-- Para pausar:   select cron.unschedule('precificacao-releitura-ml');
-- Para ver:      select * from cron.job where jobname = 'precificacao-releitura-ml';
--                select * from precificacao.ml_releituras;
-- ============================================================================

select case when exists (select 1 from vault.secrets where name = 'releitura_segredo') then 'segredo já existia'
  else 'segredo criado: ' || vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'),
         'releitura_segredo', 'Segredo do agendador da releitura automatica do Mercado Livre')::text end;

select cron.schedule(
  'precificacao-releitura-ml',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := 'https://zbvnybygbzkqxmarwhlc.supabase.co/functions/v1/precificacao-ml',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-rotina', (select decrypted_secret from vault.decrypted_secrets where name = 'releitura_segredo')),
    body := '{"ml":"rotina"}'::jsonb,
    timeout_milliseconds := 150000)
  where precificacao.releitura_pendente();
  $cron$);
