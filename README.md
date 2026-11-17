# Caixa Alsan – Sistema de caixa para loja de informática

Aplicação web de caixa com controle de estoque, ordens de serviço e financeiro, construída a partir do
documento de análise (RF-01..RF-51, RNF-01..RNF-17, RN-01..RN-22).

- **Front-end:** React + TypeScript + Vite (hospedado no **Cloudflare Pages**)
- **API privilegiada:** Cloudflare Pages Functions (`functions/api/*`) – login com bloqueio e gestão de usuários
- **Banco e autenticação:** **Supabase** (Postgres + Auth)

## Arquitetura

Toda regra de negócio crítica roda **dentro do banco**, em funções SQL transacionais
(`supabase/migrations/20261104000002_regras_negocio.sql`). Cada venda, finalização de OS ou lançamento é
uma única transação: estoque e caixa são gravados juntos ou nada é gravado (RNF-07). O front-end só
chama essas funções; ele não consegue, por exemplo, alterar o estoque ou um lançamento diretamente.

| Camada | Responsável por |
| --- | --- |
| `supabase/migrations/…01_schema.sql` | Tabelas, enums, índices e dados iniciais (categorias) |
| `supabase/migrations/…02_regras_negocio.sql` | Caixa, vendas, OS, estoque, estorno, relatórios, auditoria |
| `supabase/migrations/…03_seguranca.sql` | RLS e permissões por perfil (RNF-02) |
| `functions/api/login.ts` | Login por usuário com bloqueio após 5 tentativas (RNF-05) |
| `functions/api/usuarios.ts` | Cadastro/edição/desativação de usuários (RF-04..06) |
| `src/` | Interface (React) |

### Perfis (RNF-03)

- **Administrador** – herda tudo do operador e ainda: saídas de caixa, estornos, cancelar venda,
  categorias financeiras, usuários, relatórios, auditoria, histórico de estoque.
- **Operador de caixa** – caixa, vendas, OS, clientes, produtos, fornecedores, entradas e ajustes de estoque.
- **Técnico** – OS (abrir, diagnóstico, produtos, mão de obra, status), editar clientes, consultar estoque.

## Como rodar

### 1. Supabase

1. Crie um projeto em <https://supabase.com>.
2. Em **SQL Editor**, execute os três arquivos de `supabase/migrations/` **na ordem**
   (ou use a CLI: `supabase link` + `supabase db push`).
3. Em **Authentication → Providers → Email**, deixe *Email* habilitado e **desative "Confirm email"**
   e **desative o cadastro público ("Allow new users to sign up")** – os usuários são criados só pelo administrador.

### 2. Variáveis de ambiente

```bash
cp .env.example .env
cp .dev.vars.example .dev.vars
```

Preencha com a URL e as chaves do projeto (Project Settings → API). A `service_role` fica **somente** em
`.dev.vars` / nos segredos do Cloudflare – nunca no `.env` do front-end.

### 3. Primeiro administrador

```bash
npm install
npm run criar-admin -- "Seu Nome" admin suaSenha123
```

### 4. Desenvolvimento

São dois processos: o front-end (Vite) e as Functions (wrangler).

```bash
npm run build && npm run dev:api
```

```bash
npm run dev
```

Acesse <http://localhost:5173>.

### 5. Testes das regras de negócio

```bash
npm run test:sql
```

Executa as migrações num Postgres embutido (PGlite) e valida 61 cenários: caixa obrigatório, troco,
estoque não negativo, custo médio, desconto/autorização, estornos, fluxo de status da OS, garantia,
RLS por perfil, bloqueio de login etc.

## Deploy no Cloudflare Pages

1. Crie um projeto Pages ligado ao repositório (build: `npm run build`, saída: `dist`).
2. Em **Settings → Environment variables**, adicione `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
   (build) e `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (Functions, como segredos).
3. Ou pela linha de comando: `npm run deploy`.

## Backup (RNF-11)

O workflow `.github/workflows/backup.yml` faz `pg_dump` diário e guarda as cópias por 30 dias como
artefatos do GitHub Actions. Configure o segredo `SUPABASE_DB_URL` no repositório.

## Atalhos de teclado (RNF-17)

| Tela | Atalhos |
| --- | --- |
| Qualquer tela | **F8** nova venda · **F7** meu caixa |
| Venda | **F2** buscar produto · **F4** desconto · **F9** pagamento · **F6** limpar |
| Pagamento | **F1** dinheiro · **F2** Pix · **F3** débito · **F4** crédito · **F10** confirmar · **Esc** voltar |
| Caixa | **F2** entrada · **F3** saída (adm.) · **F9** fechar caixa |

O leitor de código de barras USB funciona em qualquer campo de busca de produto (ele "digita" o código e envia Enter).

## Decisões tomadas onde o documento deixa margem

- **Login:** o usuário entra com um *login* (não e-mail); internamente vira `login@caixa.local` no Supabase Auth.
- **Bloqueio de login:** 5 tentativas erradas bloqueiam a conta por **15 minutos**.
- **Limite de desconto:** percentual por usuário (cadastrado pelo administrador). Desconto acima do limite
  ou item abaixo do custo (RN-07) pede **login e senha de um administrador** na hora (autorização de uso único, válida por 5 min).
- **Desconto da venda** é rateado proporcionalmente entre os itens (ItemVenda.desconto) para validar o custo item a item.
- **Estorno/cancelamento:** o lançamento inverso vai para o caixa original se ele ainda estiver aberto; senão,
  para o caixa aberto do administrador. Lançamentos de venda só são estornados via "Cancelar venda".
- **OS:** produtos só podem ser adicionados/removidos até a OS ser concluída; "entregue" só via
  "Receber e entregar" (pagamento integral). O desconto da OS é dado no recebimento.
- **Caixa de outro dia:** se o operador esqueceu o caixa aberto de ontem, precisa fechá-lo antes de registrar algo hoje.
- **LGPD:** CPF mascarado nas listagens, dados de clientes só para usuários autenticados e opção de
  **anonimizar** cliente (administrador), mantendo o histórico.
- **Fuso horário:** `America/Sao_Paulo` em todo o sistema (função `app_tz()` no banco).
- Os dados da loja nos comprovantes ficam em `src/config.ts`.
