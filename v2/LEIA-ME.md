# Versão 2 — banco de dados, login e contas

A versão 1 (`/index.html`, dados na planilha do Google) continua sendo a oficial até a
migração de cada cliente. Nada aqui altera a v1.

## Onde está cada coisa

| | |
|---|---|
| Banco | Supabase, projeto **tudo-auto** (`zbvnybygbzkqxmarwhlc`), schema **`precificacao`** — provisório, durante a construção |
| Estrutura do banco | `supabase/migrations/*.sql`, aplicadas em ordem |
| Tela | `index.html` + `js/app.js` |
| Migração da v1 | `migrar.html` + `js/migrar.js` (só administrador) |
| Equipe (criar conta, senha provisória) | Edge Function `supabase/functions/precificacao-equipe` |
| Motor de cálculo | `js/calculo.js` — **gerado** da v1, não editar à mão |
| Leitura da planilha | `js/v1-leitura.js` — **gerado** da v1, não editar à mão |

## Regras do banco

- Cada cliente é uma **empresa**. As regras de acesso (RLS) garantem que um usuário só vê as
  empresas das quais é membro; o administrador geral vê todas.
- Papéis: **dono** (mexe na equipe), **editor** (mexe no catálogo), **leitor** (só vê).
- Cada registro tem **versão**: gravar com versão velha não passa (edição simultânea detectada).
- O **histórico** é escrito pelo próprio banco (gatilhos); nenhuma tela grava sem deixar rastro.
- Tokens do Mercado Livre (`ml_conexoes`) só são lidos pelo servidor, nunca pela tela.
- Nenhuma função é executável por padrão: cada função que a tela chama recebe
  `grant execute ... to authenticated` na própria migration (ver `0009`).

## Equipe e contas

- **Quem gerencia:** o dono da empresa e o administrador geral, na tela **Equipe**.
- **Incluir:** nome, e-mail e papel. Se o e-mail ainda não tem conta, o sistema cria uma com
  **senha provisória**, mostrada uma vez só, com botão "Copiar tudo" para mandar à pessoa. No
  primeiro acesso ela é obrigada a criar a própria senha. Se o e-mail já tem conta (a pessoa
  trabalha em outra empresa), ela só ganha acesso a esta e entra com a senha que já usa.
- **Esqueci a senha:** sem servidor de e-mail próprio o Supabase não entrega e-mail a clientes,
  então quem gerencia gera uma **senha nova** na Equipe. Isso também derruba as sessões abertas
  da pessoa. O dono só consegue isso para quem trabalha exclusivamente nas empresas dele e cuja
  conta foi criada por este sistema; os demais casos ficam com o administrador.
- **Regras:** a empresa nunca fica sem dono (só o administrador pode deixar); toda inclusão,
  mudança de papel, remoção e senha nova vai para o histórico. Tirar da equipe corta o acesso
  na hora; a conta continua existindo.
- **Edge Function:** publicada com `verify_jwt = false` porque confere o login ela mesma
  (necessário com as chaves novas `sb_publishable`/`sb_secret`). Quem pode o quê é decidido no
  banco, nas funções `srv_*`, que só o servidor executa.

## Migração de um cliente

1. Em `migrar.html`: criar a empresa, colar a URL do Apps Script do cliente (ou um backup JSON),
   **Importar e conferir**.
2. A conferência busca tudo de volta e compara campo a campo, e recalcula preço e margem de cada
   anúncio pelos dois lados. Tem que dar zero diferença.
3. Pode repetir quantas vezes quiser: cada registro é achado pelo id da v1 (`id_v1`), então
   repetir atualiza em vez de duplicar. O que foi apagado na v1 sai da v2; o que foi criado direto
   na v2 nunca é tocado.
4. O que não cabe no formato novo (ex.: dois anúncios do mesmo produto no mesmo marketplace, ou
   um valor que não é número) vai inteiro para **pendências**, com o dado original.

## Ferramentas (`ferramentas/`)

Rodar depois de qualquer mudança no cálculo ou na leitura de dados da v1:

```
node ferramentas/extrair-calculo.js     # regera js/calculo.js a partir da v1
node ferramentas/extrair-v1.js          # regera js/v1-leitura.js a partir da v1
node ferramentas/diff-calculo.mjs       # 20 mil cálculos v1 x v2: tem que dar 0 diferenças
node ferramentas/teste-v1-leitura.mjs   # leitura da planilha no formato do Apps Script
```

## Antes de migrar clientes de verdade

- Mover o banco para um **projeto próprio** (plano Pro, com backup diário): rodar as migrations
  lá, na ordem, e trocar `js/config.js`.
- Ligar a proteção contra senhas vazadas (Auth → Password security) — disponível no Pro.
- Publicar a Edge Function `precificacao-equipe` no projeto novo (com `verify_jwt = false`).
- Opcional: configurar um SMTP próprio (Auth → SMTP) para o "Esqueci a senha" poder mandar
  e-mail direto ao cliente.
