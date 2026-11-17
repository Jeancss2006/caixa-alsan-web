-- =====================================================================
-- Migração 3: controle de acesso por perfil (RNF-01, RNF-02) via RLS e GRANTs
-- Escritas transacionais só acontecem pelas funções da migração 2.
-- Nenhuma política de DELETE existe: cadastros são apenas inativados (RN-22).
-- =====================================================================

-- Fecha tudo por padrão
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- Leitura (sempre filtrada pelas políticas abaixo)
grant select on all tables in schema public to authenticated;
revoke select on autorizacoes, contadores from authenticated;

-- Cadastros simples com escrita direta (colunas controladas)
grant insert (nome, ativo), update (nome, ativo) on categorias_produto to authenticated;
grant insert (codigo, codigo_barras, descricao, categoria_id, unidade, preco_custo, preco_venda, estoque_minimo, ativo),
      update (codigo, codigo_barras, descricao, categoria_id, unidade, preco_custo, preco_venda, estoque_minimo, ativo)
   on produtos to authenticated;   -- quantidade_estoque só muda por movimentação
grant insert (razao_social, cnpj, telefone, email, endereco, ativo),
      update (razao_social, cnpj, telefone, email, endereco, ativo) on fornecedores to authenticated;
grant insert (nome, cpf_cnpj, telefone, email, endereco, ativo),
      update (nome, cpf_cnpj, telefone, email, endereco, ativo) on clientes to authenticated;
grant insert (nome, tipo, ativo), update (nome, ativo) on categorias_financeiras to authenticated;
grant update (nome, perfil, limite_desconto, especialidade) on usuarios to authenticated;

-- Funções disponíveis ao front-end
grant execute on function
  app_tz(), hoje(), brl(numeric), meu_perfil(), tem_perfil(perfil_usuario[]), saldo_dinheiro(bigint),
  gerar_autorizacao(), estornar_lancamento(bigint, text),
  registrar_lancamento(tipo_lancamento, bigint, numeric, forma_pagamento, text, date, bigint, bigint),
  abrir_caixa(numeric), fechar_caixa(numeric, text), resumo_caixa(bigint),
  registrar_entrada_produto(bigint, text, date, jsonb), ajustar_estoque(bigint, int, text),
  realizar_venda(jsonb, jsonb, numeric, bigint, uuid), cancelar_venda(bigint, text),
  abrir_os(bigint, text, text, text, uuid, bigint), os_atribuir_tecnico(bigint, uuid),
  os_registrar_servico(bigint, text, text, numeric), os_adicionar_produto(bigint, bigint, int),
  os_remover_produto(bigint), os_atualizar_status(bigint, status_os), os_cancelar(bigint, text),
  os_finalizar(bigint, jsonb, numeric, uuid), anonimizar_cliente(bigint),
  relatorio_financeiro_categoria(date, date), relatorio_vendas_servicos(date, date)
to authenticated;

grant execute on function login_registrar_falha(uuid), login_registrar_sucesso(uuid) to service_role;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['usuarios', 'categorias_produto', 'produtos', 'fornecedores', 'entradas_produto', 'itens_entrada',
                           'movimentacoes_estoque', 'clientes', 'caixas', 'categorias_financeiras', 'vendas', 'itens_venda',
                           'contadores', 'ordens_servico', 'itens_os', 'pagamentos', 'lancamentos_financeiros',
                           'autorizacoes', 'auditoria'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- Usuários: todos os autenticados ativos veem nomes/perfis; só o administrador edita
create policy usuarios_select on usuarios for select to authenticated using (meu_perfil() is not null);
create policy usuarios_update on usuarios for update to authenticated
  using (tem_perfil('ADMINISTRADOR')) with check (tem_perfil('ADMINISTRADOR'));

-- Produtos e categorias: consulta para todos (RF-14); cadastro por operador/administrador (RF-07..RF-10)
create policy cat_prod_select on categorias_produto for select to authenticated using (meu_perfil() is not null);
create policy cat_prod_insert on categorias_produto for insert to authenticated with check (tem_perfil('OPERADOR'));
create policy cat_prod_update on categorias_produto for update to authenticated using (tem_perfil('OPERADOR'));

create policy produtos_select on produtos for select to authenticated using (meu_perfil() is not null);
create policy produtos_insert on produtos for insert to authenticated with check (tem_perfil('OPERADOR'));
create policy produtos_update on produtos for update to authenticated using (tem_perfil('OPERADOR'));

-- Fornecedores (RF-17, RF-18)
create policy forn_select on fornecedores for select to authenticated using (tem_perfil('OPERADOR'));
create policy forn_insert on fornecedores for insert to authenticated with check (tem_perfil('OPERADOR'));
create policy forn_update on fornecedores for update to authenticated using (tem_perfil('OPERADOR'));

create policy entradas_select on entradas_produto for select to authenticated using (tem_perfil('OPERADOR'));
create policy itens_entrada_select on itens_entrada for select to authenticated using (tem_perfil('OPERADOR'));

-- Histórico de movimentação: administrador (RF-16)
create policy mov_select on movimentacoes_estoque for select to authenticated using (tem_perfil('ADMINISTRADOR'));

-- Clientes (RF-19, RF-20): cadastro por operador/adm; edição também pelo técnico
create policy clientes_select on clientes for select to authenticated using (meu_perfil() is not null);
create policy clientes_insert on clientes for insert to authenticated with check (tem_perfil('OPERADOR'));
create policy clientes_update on clientes for update to authenticated using (tem_perfil('OPERADOR', 'TECNICO'));

-- Caixa e financeiro: operador vê os próprios caixas; administrador vê todos (RF-46)
create policy caixas_select on caixas for select to authenticated
  using (tem_perfil('ADMINISTRADOR') or (operador_id = auth.uid() and tem_perfil('OPERADOR')));
create policy lanc_select on lancamentos_financeiros for select to authenticated
  using (tem_perfil('ADMINISTRADOR')
         or (tem_perfil('OPERADOR') and exists (select 1 from caixas c where c.id = caixa_id and c.operador_id = auth.uid())));
create policy cat_fin_select on categorias_financeiras for select to authenticated using (tem_perfil('OPERADOR'));
create policy cat_fin_insert on categorias_financeiras for insert to authenticated with check (tem_perfil('ADMINISTRADOR'));
create policy cat_fin_update on categorias_financeiras for update to authenticated
  using (tem_perfil('ADMINISTRADOR') and codigo is null);   -- categorias de sistema não são editáveis

-- Vendas e pagamentos
create policy vendas_select on vendas for select to authenticated using (tem_perfil('OPERADOR'));
create policy itens_venda_select on itens_venda for select to authenticated using (tem_perfil('OPERADOR'));
create policy pagamentos_select on pagamentos for select to authenticated using (tem_perfil('OPERADOR'));

-- Ordens de serviço: todos os perfis consultam (RF-29)
create policy os_select on ordens_servico for select to authenticated using (meu_perfil() is not null);
create policy itens_os_select on itens_os for select to authenticated using (meu_perfil() is not null);

-- Auditoria: administrador (RNF-06)
create policy auditoria_select on auditoria for select to authenticated using (tem_perfil('ADMINISTRADOR'));
