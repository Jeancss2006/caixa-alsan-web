-- =====================================================================
-- Caixa Alsan – Sistema de Caixa da Loja de Informática
-- Migração 1: tipos, tabelas, índices e dados iniciais
-- Baseado no documento de análise (RF-01..RF-51, RNF-01..RNF-17, RN-01..RN-22)
-- =====================================================================

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------
-- Enumerações (diagramas de classes)
-- ---------------------------------------------------------------------
create type perfil_usuario    as enum ('ADMINISTRADOR', 'OPERADOR', 'TECNICO');           -- RNF-03
create type tipo_movimentacao as enum ('ENTRADA', 'SAIDA', 'AJUSTE');
create type forma_pagamento   as enum ('DINHEIRO', 'PIX', 'CARTAO_DEBITO', 'CARTAO_CREDITO');
create type tipo_lancamento   as enum ('ENTRADA', 'SAIDA');
create type status_caixa      as enum ('ABERTO', 'FECHADO');
create type status_os         as enum ('ABERTA', 'EM_MANUTENCAO', 'AGUARDANDO_PECA', 'CONCLUIDA', 'ENTREGUE', 'CANCELADA');
create type status_venda      as enum ('CONCLUIDA', 'CANCELADA');

-- RNF-16: fuso horário de referência do servidor para "o dia" do caixa
create or replace function app_tz() returns text language sql immutable as $$ select 'America/Sao_Paulo' $$;
create or replace function hoje() returns date language sql stable as $$ select (now() at time zone app_tz())::date $$;

-- ---------------------------------------------------------------------
-- Usuários (Usuario / OperadorCaixa / Tecnico / Administrador)
-- A senha fica no Supabase Auth (hash bcrypt – RNF-04); aqui ficam perfil e controle de acesso.
-- ---------------------------------------------------------------------
create table usuarios (
  id                uuid primary key references auth.users (id),
  nome              text not null,
  login             text not null unique check (login ~ '^[a-z0-9._-]{3,40}$'),
  perfil            perfil_usuario not null,
  ativo             boolean not null default true,
  tentativas_login  int not null default 0,
  bloqueado_ate     timestamptz,
  limite_desconto   numeric(5,2) not null default 0 check (limite_desconto between 0 and 100), -- % máximo (OperadorCaixa.limiteDesconto)
  especialidade     text,                                                                       -- Tecnico.especialidade
  criado_em         timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Produtos, estoque e fornecedores
-- ---------------------------------------------------------------------
create table categorias_produto (
  id    bigint generated always as identity primary key,
  nome  text not null unique,
  ativo boolean not null default true
);

create table produtos (
  id                 bigint generated always as identity primary key,
  codigo             text not null unique,
  codigo_barras      text unique,
  descricao          text not null,
  categoria_id       bigint references categorias_produto (id),
  unidade            text not null default 'UN',
  preco_custo        numeric(12,2) not null default 0 check (preco_custo >= 0),
  preco_venda        numeric(12,2) not null default 0 check (preco_venda >= 0),
  quantidade_estoque int not null default 0 check (quantidade_estoque >= 0),   -- RN-04
  estoque_minimo     int not null default 0 check (estoque_minimo >= 0),
  ativo              boolean not null default true,
  criado_em          timestamptz not null default now()
);
create index produtos_descricao_trgm on produtos using gin (descricao gin_trgm_ops);  -- RNF-12
create index produtos_categoria_idx on produtos (categoria_id);

create table fornecedores (
  id           bigint generated always as identity primary key,
  razao_social text not null,
  cnpj         text not null unique,
  telefone     text,
  email        text,
  endereco     text,
  ativo        boolean not null default true
);

create table entradas_produto (
  id                  bigint generated always as identity primary key,
  fornecedor_id       bigint not null references fornecedores (id),
  numero_nota_fiscal  text not null,
  data_entrada        date not null,
  valor_total         numeric(12,2) not null default 0,
  usuario_id          uuid not null references usuarios (id),
  criado_em           timestamptz not null default now()
);

create table itens_entrada (
  id              bigint generated always as identity primary key,
  entrada_id      bigint not null references entradas_produto (id),
  produto_id      bigint not null references produtos (id),
  quantidade      int not null check (quantidade > 0),
  custo_unitario  numeric(12,2) not null check (custo_unitario >= 0)
);

-- Histórico imutável de movimentações (RF-16, RN-06)
create table movimentacoes_estoque (
  id          bigint generated always as identity primary key,
  produto_id  bigint not null references produtos (id),
  tipo        tipo_movimentacao not null,
  quantidade  int not null check (quantidade <> 0),  -- positiva = entrou, negativa = saiu
  saldo_apos  int not null,
  data_hora   timestamptz not null default now(),
  origem      text not null,       -- ex.: 'Venda #12', 'OS #45', 'NF 1234', 'Ajuste: perda'
  motivo      text,
  usuario_id  uuid not null references usuarios (id),
  venda_id    bigint,
  os_id       bigint,
  entrada_id  bigint references entradas_produto (id)
);
create index movimentacoes_produto_idx on movimentacoes_estoque (produto_id, data_hora desc);

-- ---------------------------------------------------------------------
-- Clientes (RN-08, RNF-15)
-- ---------------------------------------------------------------------
create table clientes (
  id         bigint generated always as identity primary key,
  nome       text not null,
  cpf_cnpj   text unique,
  telefone   text,
  email      text,
  endereco   text,
  ativo      boolean not null default true,
  anonimizado_em timestamptz,
  criado_em  timestamptz not null default now()
);
create index clientes_nome_trgm on clientes using gin (nome gin_trgm_ops);

-- ---------------------------------------------------------------------
-- Caixa e financeiro
-- ---------------------------------------------------------------------
create table caixas (
  id               bigint generated always as identity primary key,
  operador_id      uuid not null references usuarios (id),
  data_abertura    timestamptz not null default now(),
  data_fechamento  timestamptz,
  saldo_inicial    numeric(12,2) not null check (saldo_inicial >= 0),
  saldo_esperado   numeric(12,2),
  valor_contado    numeric(12,2),
  diferenca        numeric(12,2),
  justificativa    text,
  status           status_caixa not null default 'ABERTO'
);
-- RN-02: um caixa aberto por operador
create unique index caixas_um_aberto_por_operador on caixas (operador_id) where status = 'ABERTO';

create table categorias_financeiras (
  id      bigint generated always as identity primary key,
  nome    text not null,
  tipo    tipo_lancamento not null,
  ativo   boolean not null default true,
  codigo  text unique,          -- categorias de sistema (RN-16, RN-03, RN-17)
  unique (nome, tipo)
);

create table vendas (
  id                   bigint generated always as identity primary key,
  caixa_id             bigint not null references caixas (id),
  operador_id          uuid not null references usuarios (id),
  cliente_id           bigint references clientes (id),       -- opcional (RN-08)
  data_hora            timestamptz not null default now(),
  subtotal             numeric(12,2) not null,
  desconto             numeric(12,2) not null default 0 check (desconto >= 0),
  valor_total          numeric(12,2) not null check (valor_total >= 0),
  status               status_venda not null default 'CONCLUIDA',
  motivo_cancelamento  text,
  cancelada_por        uuid references usuarios (id),
  cancelada_em         timestamptz,
  autorizado_por       uuid references usuarios (id)   -- RN-07 / limite de desconto
);
create index vendas_data_idx on vendas (data_hora desc);

create table itens_venda (
  id              bigint generated always as identity primary key,
  venda_id        bigint not null references vendas (id),
  produto_id      bigint not null references produtos (id),
  quantidade      int not null check (quantidade > 0),
  preco_unitario  numeric(12,2) not null,
  custo_unitario  numeric(12,2) not null,
  desconto        numeric(12,2) not null default 0
);

-- Contador sem lacunas para o número da OS (RN-09)
create table contadores (
  nome  text primary key,
  valor bigint not null
);
insert into contadores (nome, valor) values ('ordem_servico', 0);

create table ordens_servico (
  id                   bigint generated always as identity primary key,
  numero               bigint not null unique,
  cliente_id           bigint not null references clientes (id),      -- RN-08
  tecnico_id           uuid references usuarios (id),
  aberta_por           uuid not null references usuarios (id),
  data_abertura        timestamptz not null default now(),
  equipamento          text not null,
  defeito_relatado     text not null,
  acessorios           text,
  diagnostico          text,
  servico_executado    text,
  valor_mao_de_obra    numeric(12,2) not null default 0 check (valor_mao_de_obra >= 0),
  desconto             numeric(12,2) not null default 0 check (desconto >= 0),
  valor_total          numeric(12,2) not null default 0,
  status               status_os not null default 'ABERTA',
  data_conclusao       timestamptz,
  data_entrega         timestamptz,
  motivo_cancelamento  text,
  garantia_de_id       bigint references ordens_servico (id),        -- RN-14
  caixa_id             bigint references caixas (id),                 -- caixa que recebeu
  finalizada_por       uuid references usuarios (id),
  autorizado_por       uuid references usuarios (id)
);
create index os_status_idx on ordens_servico (status);
create index os_cliente_idx on ordens_servico (cliente_id);
create index os_data_idx on ordens_servico (data_abertura desc);

create table itens_os (
  id              bigint generated always as identity primary key,
  os_id           bigint not null references ordens_servico (id),
  produto_id      bigint not null references produtos (id),
  quantidade      int not null check (quantidade > 0),
  preco_unitario  numeric(12,2) not null,
  custo_unitario  numeric(12,2) not null,
  adicionado_por  uuid not null references usuarios (id),
  adicionado_em   timestamptz not null default now()
);

alter table movimentacoes_estoque
  add constraint mov_venda_fk foreign key (venda_id) references vendas (id),
  add constraint mov_os_fk foreign key (os_id) references ordens_servico (id);

-- Pagamento (abstrato) + especializações Dinheiro / Pix / Cartão em tabela única
create table pagamentos (
  id                bigint generated always as identity primary key,
  venda_id          bigint references vendas (id),
  os_id             bigint references ordens_servico (id),
  forma             forma_pagamento not null,
  valor             numeric(12,2) not null check (valor > 0),   -- valor efetivamente abatido
  data_hora         timestamptz not null default now(),
  valor_recebido    numeric(12,2),     -- PagamentoDinheiro
  troco             numeric(12,2),     -- PagamentoDinheiro
  codigo_transacao  text,              -- PagamentoPix
  bandeira          text,              -- PagamentoCartao
  parcelas          int,               -- PagamentoCartao
  check ((venda_id is null) <> (os_id is null))
);

create table lancamentos_financeiros (
  id                  bigint generated always as identity primary key,
  caixa_id            bigint not null references caixas (id),
  tipo                tipo_lancamento not null,
  categoria_id        bigint not null references categorias_financeiras (id),  -- RN-15
  valor               numeric(12,2) not null check (valor > 0),
  data_hora           timestamptz not null default now(),
  data_referencia     date not null default hoje(),
  descricao           text not null,
  forma_pagamento     forma_pagamento not null,
  usuario_id          uuid not null references usuarios (id),
  fornecedor_id       bigint references fornecedores (id),
  entrada_produto_id  bigint references entradas_produto (id),
  venda_id            bigint references vendas (id),
  os_id               bigint references ordens_servico (id),
  pagamento_id        bigint references pagamentos (id),
  estorno_de_id       bigint unique references lancamentos_financeiros (id),
  estornado           boolean not null default false,
  motivo_estorno      text,
  estornado_por       uuid references usuarios (id),
  estornado_em        timestamptz
);
create index lanc_caixa_idx on lancamentos_financeiros (caixa_id);
create index lanc_data_idx on lancamentos_financeiros (data_hora desc);

-- Autorizações pontuais do administrador (RN-07 e desconto acima do limite)
create table autorizacoes (
  token           uuid primary key default gen_random_uuid(),
  administrador_id uuid not null references usuarios (id),
  criada_em       timestamptz not null default now(),
  expira_em       timestamptz not null default now() + interval '5 minutes',
  usada_em        timestamptz
);

-- Registro de auditoria (RNF-06)
create table auditoria (
  id          bigint generated always as identity primary key,
  data_hora   timestamptz not null default now(),
  usuario_id  uuid,
  tabela      text not null,
  operacao    text not null,
  registro_id text,
  dados_antes jsonb,
  dados_depois jsonb
);
create index auditoria_data_idx on auditoria (data_hora desc);

-- ---------------------------------------------------------------------
-- Dados iniciais
-- ---------------------------------------------------------------------
insert into categorias_financeiras (nome, tipo, codigo) values
  ('Venda de produtos',        'ENTRADA', 'VENDA'),
  ('Ordem de serviço',         'ENTRADA', 'OS'),
  ('Aporte',                   'ENTRADA', null),
  ('Recebimento de cliente',   'ENTRADA', null),
  ('Sobra de caixa',           'ENTRADA', 'SOBRA'),
  ('Pagamento de fornecedor',  'SAIDA',   'PAG_FORNECEDOR'),
  ('Aluguel',                  'SAIDA',   null),
  ('Energia',                  'SAIDA',   null),
  ('Internet',                 'SAIDA',   null),
  ('Salários',                 'SAIDA',   null),
  ('Impostos',                 'SAIDA',   null),
  ('Retirada do proprietário', 'SAIDA',   null),
  ('Falta de caixa',           'SAIDA',   'FALTA');

insert into categorias_produto (nome) values
  ('Periféricos'), ('Componentes'), ('Cabos'), ('Acessórios');
