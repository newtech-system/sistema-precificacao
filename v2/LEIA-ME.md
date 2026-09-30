# Versão 2 — o sistema com banco de dados, login e equipe

A versão 1 (`/index.html`, dados na planilha do Google) continua sendo a oficial até a
migração de cada cliente. Nada aqui altera a v1.

A tela da v2 é **a mesma da v1**: o código da tela é gerado a partir da v1, trocando só o que
conversava com a planilha pela conversa com o banco. Cálculo, formulários, cadastro em lote,
importação e exportação de planilha, unificação, marketplaces com faixas, custos da empresa,
Mercado Livre (vínculos, taxas, envio, conferência e correção) funcionam igual.

## Onde está cada coisa

| | |
|---|---|
| Banco | Supabase, projeto **tudo-auto** (`zbvnybygbzkqxmarwhlc`), schema **`precificacao`** — provisório, durante a construção |
| Estrutura do banco | `supabase/migrations/*.sql`, aplicadas em ordem |
| Tela | `index.html` e `js/sistema.js` — **gerados** da v1 por `ferramentas/gerar-sistema.js`, não editar à mão |
| Trechos próprios da v2 na tela | `ferramentas/porte/*` (conversa com o banco, histórico, equipe, conta, Mercado Livre) |
| Entrada (login, empresa) | `js/inicio.js` |
| Tradução banco ⇄ formato da v1 | `js/modelo.js` (a mesma para a tela e para a conferência da migração) |
| Acesso ao banco | `js/banco.js` |
| Migração da v1 | `migrar.html` + `js/migrar.js` (só administrador) |
| Equipe (criar conta, senha provisória) | Edge Function `supabase/functions/precificacao-equipe` |
| Mercado Livre | Edge Function `supabase/functions/precificacao-ml` + página `ml-retorno.html` |
| Motor de cálculo (migração) | `js/calculo.js` — **gerado** da v1 |
| Leitura da planilha (migração) | `js/v1-leitura.js` — **gerado** da v1 |

## Como a tela grava

- A tela guarda a empresa inteira na memória (como a v1) e uma **base**: o banco como ela o viu
  da última vez, com a versão de cada registro.
- A cada alteração, compara a tela com a base e manda ao banco **só os campos que mudaram**, em
  lotes de até 400 operações (função `salvar`). Cada registro é gravado **só se ainda estiver na
  versão que a tela conhece**.
- Se outra pessoa gravou antes, aquele item volta como conflito: a tela lê o que está no banco e
  **junta** com a mesma regra da v1 (quem mudou um campo leva; se os dois mudaram o mesmo campo,
  fica o seu e o caso aparece em **Histórico → Conflitos**, com botão para usar o da outra pessoa).
- Cada gravação avisa, com **uma** mensagem por lote, quem está com a empresa aberta (canal
  privado `precificacao:<empresa>`): as outras telas buscam só o que mudou e juntam na hora. Se a
  conexão cair, ao voltar a tela relê tudo.
- O que ainda não chegou ao banco fica num **rascunho** neste navegador (IndexedDB). Se a aba
  fechar ou a internet cair, na próxima abertura o rascunho é juntado com o banco e enviado.
- Quem é **leitor** não altera: os botões de edição somem e qualquer alteração é desfeita com aviso.

## Regras do banco

- Cada cliente é uma **empresa**. As regras de acesso (RLS) garantem que um usuário só vê as
  empresas das quais é membro; o administrador geral vê todas.
- Papéis: **dono** (mexe na equipe), **editor** (mexe no catálogo), **leitor** (só vê).
- O **histórico** é escrito pelo próprio banco (gatilhos); nenhuma tela grava sem deixar rastro.
- Marketplace excluído que ainda tem anúncios fica **marcado como removido** (os anúncios
  continuam, como "marketplace removido" — igual à v1).
- Tokens do Mercado Livre (`ml_conexoes`) só são lidos pelo servidor, nunca pela tela.
- Nenhuma função é executável por padrão: cada função que a tela chama recebe
  `grant execute ... to authenticated` na própria migration (ver `0009`).

## Equipe e contas

- **Quem gerencia:** o dono da empresa e o administrador geral, na tela **Equipe**.
- **Incluir:** nome, e-mail e papel. Se o e-mail ainda não tem conta, o sistema cria uma com
  **senha provisória**, mostrada uma vez só, com botão "Copiar tudo". No primeiro acesso a pessoa
  é obrigada a criar a própria senha. Se o e-mail já tem conta, ela só ganha acesso a esta empresa.
- **Esqueci a senha:** quem gerencia gera uma **senha nova** na Equipe (derruba as sessões abertas).
  O dono só consegue para quem trabalha só nas empresas dele e cuja conta foi criada aqui.
- **Minha conta:** nome (o que aparece em "alterado por") e senha.

## Mercado Livre

- Uma aplicação do Mercado Livre para todas as empresas, configurada **no servidor**:
  segredos `ML_CLIENT_ID` e `ML_CLIENT_SECRET` da Edge Function (Supabase → Edge Functions →
  Secrets). Opcional: `ML_REDIRECT_URI` (o padrão é a página `v2/ml-retorno.html` publicada).
- Na aplicação do Mercado Livre, a URL de retorno cadastrada tem que ser exatamente
  `https://newtech-system.github.io/sistema-precificacao/v2/ml-retorno.html`.
- Cada empresa conecta a própria conta em **Mercado Livre → Conectar** (dono ou editor). O
  "state" da autorização é assinado pelo servidor: não dá para ligar a conta de alguém a outra
  empresa.
- As regras de sondagem, conferência e correção são as mesmas da v1 (o Apps Script foi portado).

## Migração de um cliente

1. Em `migrar.html`: criar a empresa, colar a URL do Apps Script do cliente (ou um backup JSON),
   **Importar e conferir**.
2. A conferência busca tudo de volta e compara **todos os campos** (inclusive os do Mercado
   Livre) com a mesma tradução que a tela usa, e recalcula preço e margem de cada anúncio pelos
   dois lados. Tem que dar zero diferença.
3. Pode repetir quantas vezes quiser: cada registro é achado pelo id da v1 (`id_v1`), então
   repetir atualiza em vez de duplicar. O que foi apagado na v1 sai da v2; o que foi criado direto
   na v2 nunca é tocado. Quem estiver com a empresa aberta na v2 relê tudo sozinho.
4. O que não cabe no formato novo vai inteiro para **pendências**, com o dado original.

## Ferramentas (`ferramentas/`)

Rodar depois de qualquer mudança na v1 (e antes de publicar a v2):

```
node ferramentas/gerar-sistema.js       # regera index.html e js/sistema.js a partir da v1
node ferramentas/extrair-calculo.js     # regera js/calculo.js a partir da v1
node ferramentas/extrair-v1.js          # regera js/v1-leitura.js a partir da v1
node ferramentas/diff-calculo.mjs       # 20 mil cálculos v1 x v2: tem que dar 0 diferenças
node ferramentas/teste-v1-leitura.mjs   # leitura da planilha no formato do Apps Script
node ferramentas/teste-modelo.mjs       # tradução banco ⇄ v1, conferência e o que gravar
```

O gerador para com erro se algum trecho da v1 que ele troca tiver mudado (em vez de gerar algo
pela metade): aí é ajustar a âncora em `gerar-sistema.js` ou o trecho em `porte/`.

## Antes de migrar clientes de verdade

- Mover o banco para um **projeto próprio** (plano Pro, com backup diário): rodar as migrations
  lá, na ordem, publicar as duas Edge Functions (`verify_jwt = false`) e trocar `js/config.js`.
- Ligar a proteção contra senhas vazadas (Auth → Password security) — disponível no Pro.
- Opcional: configurar um SMTP próprio (Auth → SMTP) para o "Esqueci a senha" mandar e-mail.
