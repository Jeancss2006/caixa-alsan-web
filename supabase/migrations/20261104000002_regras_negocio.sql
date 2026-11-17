-- =====================================================================
-- Migração 2: regras de negócio (funções transacionais – RNF-07),
-- gatilhos de integridade/imutabilidade (RNF-08) e auditoria (RNF-06)
-- Todas as funções públicas são SECURITY DEFINER e validam o perfil do usuário.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Utilitários
-- ---------------------------------------------------------------------
create or replace function brl(v numeric) returns text language sql immutable as $$
  select 'R$ ' || replace(replace(replace(to_char(coalesce(v, 0), 'FM999,999,999,990.00'), ',', 'X'), '.', ','), 'X', '.')
$$;

create or replace function _erro(msg text) returns void language plpgsql as $$
begin
  raise exception using message = msg, errcode = 'P0001';
end $$;

create or replace function meu_perfil() returns perfil_usuario
language sql stable security definer set search_path = public as $$
  select perfil from usuarios where id = auth.uid() and ativo
$$;

-- Administrador é especialização de Operador de Caixa: tem acesso a tudo.
create or replace function tem_perfil(variadic perfis perfil_usuario[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select perfil = 'ADMINISTRADOR' or perfil = any (perfis)
                   from usuarios where id = auth.uid() and ativo), false)
$$;

create or replace function exigir_perfil(variadic perfis perfil_usuario[]) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v perfil_usuario;
begin
  v := meu_perfil();
  if v is null then
    raise exception using message = 'Usuário não autenticado ou inativo.', errcode = '42501';
  end if;
  if v <> 'ADMINISTRADOR' and not (v = any (perfis)) then
    raise exception using message = 'Operação não permitida para o seu perfil de acesso.', errcode = '42501';
  end if;
  return auth.uid();
end $$;

-- ---------------------------------------------------------------------
-- Caixa: saldo em dinheiro e exigência de caixa aberto (RN-01)
-- ---------------------------------------------------------------------
create or replace function saldo_dinheiro(p_caixa bigint) returns numeric
language sql stable security definer set search_path = public as $$
  select c.saldo_inicial + coalesce((
           select sum(case when l.tipo = 'ENTRADA' then l.valor else -l.valor end)
           from lancamentos_financeiros l
           where l.caixa_id = c.id and l.forma_pagamento = 'DINHEIRO'), 0)
  from caixas c where c.id = p_caixa
$$;

create or replace function exigir_caixa_aberto() returns bigint
language plpgsql stable security definer set search_path = public as $$
declare c caixas;
begin
  select * into c from caixas where operador_id = auth.uid() and status = 'ABERTO';
  if not found then
    perform _erro('É necessário abrir o caixa antes de registrar vendas, recebimentos ou lançamentos.');
  end if;
  if (c.data_abertura at time zone app_tz())::date <> hoje() then
    perform _erro(format('O caixa aberto é do dia %s. Feche-o e abra o caixa de hoje para continuar.',
                         to_char(c.data_abertura at time zone app_tz(), 'DD/MM/YYYY')));
  end if;
  return c.id;
end $$;

-- ---------------------------------------------------------------------
-- Estoque: movimentação única com verificação de saldo (RN-04)
-- ---------------------------------------------------------------------
create or replace function _movimentar_estoque(
  p_produto bigint, p_qtd int, p_tipo tipo_movimentacao, p_origem text,
  p_motivo text default null, p_venda bigint default null, p_os bigint default null, p_entrada bigint default null
) returns int language plpgsql security definer set search_path = public as $$
declare v_saldo int; p produtos;
begin
  if p_qtd = 0 then return null; end if;
  update produtos set quantidade_estoque = quantidade_estoque + p_qtd
   where id = p_produto and quantidade_estoque + p_qtd >= 0
  returning quantidade_estoque into v_saldo;
  if not found then
    select * into p from produtos where id = p_produto;
    if not found then perform _erro('Produto não encontrado.'); end if;
    perform _erro(format('Estoque insuficiente para "%s": disponível %s, solicitado %s.',
                         p.descricao, p.quantidade_estoque, -p_qtd));
  end if;
  insert into movimentacoes_estoque (produto_id, tipo, quantidade, saldo_apos, origem, motivo, usuario_id, venda_id, os_id, entrada_id)
  values (p_produto, p_tipo, p_qtd, v_saldo, p_origem, p_motivo, auth.uid(), p_venda, p_os, p_entrada);
  return v_saldo;
end $$;

-- ---------------------------------------------------------------------
-- Autorização do administrador (RN-07 e desconto acima do limite – RF-34)
-- ---------------------------------------------------------------------
create or replace function gerar_autorizacao() returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  perform exigir_perfil('ADMINISTRADOR');
  insert into autorizacoes (administrador_id) values (auth.uid()) returning token into v;
  return v;
end $$;

create or replace function _consumir_autorizacao(p_token uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_admin uuid;
begin
  update autorizacoes a set usada_em = now()
   where a.token = p_token and a.usada_em is null and a.expira_em > now()
     and exists (select 1 from usuarios u where u.id = a.administrador_id and u.ativo and u.perfil = 'ADMINISTRADOR')
  returning a.administrador_id into v_admin;
  if v_admin is null then perform _erro('Autorização do administrador inválida ou expirada.'); end if;
  return v_admin;
end $$;

-- Verifica limite de desconto do perfil e venda abaixo do custo.
-- Retorna o id do administrador que autorizou (ou null quando não foi necessário).
create or replace function _verificar_desconto(p_bruto numeric, p_desconto numeric, p_abaixo_custo boolean, p_autorizacao uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare u usuarios; v_pct numeric; v_motivo text;
begin
  if p_desconto < 0 or p_desconto > p_bruto then perform _erro('Desconto inválido.'); end if;
  select * into u from usuarios where id = auth.uid();
  if u.perfil = 'ADMINISTRADOR' then return null; end if;
  v_pct := case when p_bruto > 0 then round(p_desconto * 100 / p_bruto, 2) else 0 end;
  if v_pct > u.limite_desconto then
    v_motivo := format('Desconto de %s%% excede o seu limite de %s%%.', v_pct, u.limite_desconto);
  elsif p_abaixo_custo then
    v_motivo := 'O valor final de um item ficaria abaixo do preço de custo.';
  else
    return null;
  end if;
  if p_autorizacao is null then
    raise exception using message = v_motivo || ' É necessária a autorização de um administrador.', errcode = 'CXAUT';
  end if;
  return _consumir_autorizacao(p_autorizacao);
end $$;

-- ---------------------------------------------------------------------
-- Lançamentos financeiros
-- ---------------------------------------------------------------------
create or replace function _categoria_por_codigo(p_codigo text) returns bigint
language sql stable security definer set search_path = public as $$
  select id from categorias_financeiras where codigo = p_codigo
$$;

-- Validações de todo lançamento (RN-01, RN-15, RN-17, RN-18)
create or replace function _validar_lancamento() returns trigger
language plpgsql security definer set search_path = public as $$
declare c categorias_financeiras; v_status status_caixa;
begin
  select status into v_status from caixas where id = new.caixa_id;
  if v_status is distinct from 'ABERTO' then perform _erro('O lançamento exige um caixa aberto.'); end if;
  select * into c from categorias_financeiras where id = new.categoria_id;
  if not found then perform _erro('Categoria financeira obrigatória.'); end if;
  new.data_hora := now();
  if new.estorno_de_id is null then
    if c.tipo <> new.tipo then
      perform _erro(format('A categoria "%s" só pode ser usada em %s.', c.nome, lower(c.tipo::text) || 's'));
    end if;
    if not c.ativo then perform _erro(format('A categoria "%s" está inativa.', c.nome)); end if;
    if c.codigo = 'PAG_FORNECEDOR' and new.fornecedor_id is null then
      perform _erro('Saídas de pagamento de fornecedor devem estar vinculadas a um fornecedor.');
    end if;
    if new.tipo = 'SAIDA' and new.forma_pagamento = 'DINHEIRO' and coalesce(c.codigo, '') <> 'FALTA'
       and new.valor > saldo_dinheiro(new.caixa_id) then
      perform _erro(format('Saldo em dinheiro insuficiente no caixa (disponível %s).', brl(saldo_dinheiro(new.caixa_id))));
    end if;
  end if;
  return new;
end $$;
create trigger lancamentos_validar before insert on lancamentos_financeiros
  for each row execute function _validar_lancamento();

-- Imutabilidade (RNF-08): só é permitido marcar como estornado
create or replace function _lancamento_imutavel() returns trigger language plpgsql as $$
declare cols text[] := array['estornado', 'motivo_estorno', 'estornado_por', 'estornado_em'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Lançamentos financeiros não podem ser excluídos; utilize o estorno.';
  end if;
  if old.estornado or (to_jsonb(new) - cols) <> (to_jsonb(old) - cols) then
    raise exception 'Lançamentos financeiros não podem ser alterados; utilize o estorno.';
  end if;
  return new;
end $$;
create trigger lancamentos_imutavel before update or delete on lancamentos_financeiros
  for each row execute function _lancamento_imutavel();

-- Registros que nunca mudam (histórico)
create or replace function _somente_insercao() returns trigger language plpgsql as $$
begin
  raise exception 'Registros de % não podem ser alterados nem excluídos.', tg_table_name;
end $$;
create trigger movimentacoes_imutavel before update or delete on movimentacoes_estoque for each row execute function _somente_insercao();
create trigger pagamentos_imutavel     before update or delete on pagamentos            for each row execute function _somente_insercao();
create trigger itens_venda_imutavel    before update or delete on itens_venda           for each row execute function _somente_insercao();
create trigger itens_entrada_imutavel  before update or delete on itens_entrada         for each row execute function _somente_insercao();
create trigger auditoria_imutavel      before update or delete on auditoria             for each row execute function _somente_insercao();

-- O estorno é lançado no caixa original enquanto ele estiver aberto; senão, no caixa aberto de quem estorna.
create or replace function _estornar(p_lanc bigint, p_motivo text) returns bigint
language plpgsql security definer set search_path = public as $$
declare l lancamentos_financeiros; v_id bigint; v_caixa bigint;
begin
  select * into l from lancamentos_financeiros where id = p_lanc for update;
  if not found then perform _erro('Lançamento não encontrado.'); end if;
  if l.estornado then perform _erro(format('O lançamento #%s já foi estornado.', l.id)); end if;
  if l.estorno_de_id is not null then perform _erro('Um lançamento de estorno não pode ser estornado.'); end if;
  select id into v_caixa from caixas where id = l.caixa_id and status = 'ABERTO';
  if v_caixa is null then v_caixa := exigir_caixa_aberto(); end if;
  insert into lancamentos_financeiros (caixa_id, tipo, categoria_id, valor, descricao, forma_pagamento, usuario_id,
                                       fornecedor_id, entrada_produto_id, venda_id, os_id, estorno_de_id)
  values (v_caixa, case when l.tipo = 'ENTRADA' then 'SAIDA'::tipo_lancamento else 'ENTRADA'::tipo_lancamento end,
          l.categoria_id, l.valor, format('Estorno do lançamento #%s: %s', l.id, p_motivo), l.forma_pagamento, auth.uid(),
          l.fornecedor_id, l.entrada_produto_id, l.venda_id, l.os_id, l.id)
  returning id into v_id;
  update lancamentos_financeiros
     set estornado = true, motivo_estorno = p_motivo, estornado_por = auth.uid(), estornado_em = now()
   where id = l.id;
  return v_id;
end $$;

-- RF-45 / RN-20
create or replace function estornar_lancamento(p_id bigint, p_motivo text) returns bigint
language plpgsql security definer set search_path = public as $$
declare l lancamentos_financeiros;
begin
  perform exigir_perfil('ADMINISTRADOR');
  if coalesce(trim(p_motivo), '') = '' then perform _erro('Informe o motivo do estorno.'); end if;
  select * into l from lancamentos_financeiros where id = p_id;
  if l.venda_id is not null and l.estorno_de_id is null then
    perform _erro(format('Este lançamento pertence à venda #%s. Para estorná-lo, cancele a venda.', l.venda_id));
  end if;
  return _estornar(p_id, trim(p_motivo));
end $$;

-- RF-40 / RF-41 / RF-43 / UC-21..24
create or replace function registrar_lancamento(
  p_tipo tipo_lancamento, p_categoria_id bigint, p_valor numeric, p_forma forma_pagamento, p_descricao text,
  p_data_referencia date default null, p_fornecedor_id bigint default null, p_entrada_produto_id bigint default null
) returns bigint language plpgsql security definer set search_path = public as $$
declare v_caixa bigint; c categorias_financeiras; v_id bigint; v_forn bigint;
begin
  if p_tipo = 'SAIDA' then perform exigir_perfil('ADMINISTRADOR'); else perform exigir_perfil('OPERADOR'); end if;
  v_caixa := exigir_caixa_aberto();
  if coalesce(p_valor, 0) <= 0 then perform _erro('Informe um valor maior que zero.'); end if;
  if coalesce(trim(p_descricao), '') = '' then perform _erro('Informe a descrição do lançamento.'); end if;
  select * into c from categorias_financeiras where id = p_categoria_id;
  if c.codigo in ('VENDA', 'OS', 'SOBRA', 'FALTA') then
    perform _erro(format('A categoria "%s" é usada apenas em lançamentos automáticos.', c.nome));
  end if;
  if p_fornecedor_id is not null and not exists (select 1 from fornecedores where id = p_fornecedor_id and ativo) then
    perform _erro('Fornecedor inválido ou inativo.');
  end if;
  if p_entrada_produto_id is not null then
    select fornecedor_id into v_forn from entradas_produto where id = p_entrada_produto_id;
    if v_forn is distinct from p_fornecedor_id then
      perform _erro('A entrada de produtos selecionada não pertence a este fornecedor.');
    end if;
  end if;
  insert into lancamentos_financeiros (caixa_id, tipo, categoria_id, valor, data_referencia, descricao, forma_pagamento,
                                       usuario_id, fornecedor_id, entrada_produto_id)
  values (v_caixa, p_tipo, p_categoria_id, round(p_valor, 2), coalesce(p_data_referencia, hoje()), trim(p_descricao), p_forma,
          auth.uid(), p_fornecedor_id, p_entrada_produto_id)
  returning id into v_id;
  return v_id;
end $$;

-- Pagamentos (UC-14 / UC-15, RN-19) – gera um lançamento por forma de pagamento (RF-44, RN-16)
create or replace function _registrar_pagamentos(
  p_pagamentos jsonb, p_total numeric, p_venda bigint, p_os bigint, p_caixa bigint, p_cat_codigo text, p_descricao text
) returns void language plpgsql security definer set search_path = public as $$
declare e jsonb; v_forma forma_pagamento; v_valor numeric; v_receb numeric; v_troco numeric;
        v_soma numeric := 0; v_pag bigint; v_cat bigint := _categoria_por_codigo(p_cat_codigo);
begin
  for e in select * from jsonb_array_elements(coalesce(p_pagamentos, '[]'::jsonb)) loop
    v_forma := (e->>'forma')::forma_pagamento;
    v_valor := round((e->>'valor')::numeric, 2);
    if v_valor is null or v_valor <= 0 then perform _erro('Valor de pagamento inválido.'); end if;
    v_receb := null; v_troco := null;
    if v_forma = 'DINHEIRO' then
      v_receb := round(coalesce((e->>'valor_recebido')::numeric, v_valor), 2);
      if v_receb < v_valor then perform _erro('O valor recebido em dinheiro é menor que o valor do pagamento.'); end if;
      v_troco := v_receb - v_valor;
    end if;
    insert into pagamentos (venda_id, os_id, forma, valor, valor_recebido, troco, codigo_transacao, bandeira, parcelas)
    values (p_venda, p_os, v_forma, v_valor, v_receb, v_troco,
            nullif(e->>'codigo_transacao', ''), nullif(e->>'bandeira', ''),
            case when v_forma = 'CARTAO_CREDITO' then greatest(coalesce((e->>'parcelas')::int, 1), 1) end)
    returning id into v_pag;
    insert into lancamentos_financeiros (caixa_id, tipo, categoria_id, valor, descricao, forma_pagamento, usuario_id, venda_id, os_id, pagamento_id)
    values (p_caixa, 'ENTRADA', v_cat, v_valor, p_descricao, v_forma, auth.uid(), p_venda, p_os, v_pag);
    v_soma := v_soma + v_valor;
  end loop;
  if v_soma <> p_total then
    perform _erro(format('A soma das formas de pagamento (%s) deve ser igual ao valor total (%s).', brl(v_soma), brl(p_total)));
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Caixa: abertura e fechamento (RF-38, RF-39, RN-02, RN-03)
-- ---------------------------------------------------------------------
create or replace function abrir_caixa(p_saldo_inicial numeric) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  perform exigir_perfil('OPERADOR');
  if p_saldo_inicial is null or p_saldo_inicial < 0 then perform _erro('Informe um saldo inicial válido.'); end if;
  if exists (select 1 from caixas where operador_id = auth.uid() and status = 'ABERTO') then
    perform _erro('Você já possui um caixa aberto. Feche-o antes de abrir um novo.');
  end if;
  insert into caixas (operador_id, saldo_inicial) values (auth.uid(), round(p_saldo_inicial, 2)) returning id into v_id;
  return v_id;
end $$;

create or replace function fechar_caixa(p_valor_contado numeric, p_justificativa text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare c caixas; v_esperado numeric; v_dif numeric;
begin
  perform exigir_perfil('OPERADOR');
  select * into c from caixas where operador_id = auth.uid() and status = 'ABERTO' for update;
  if not found then perform _erro('Você não possui caixa aberto.'); end if;
  if p_valor_contado is null or p_valor_contado < 0 then perform _erro('Informe o valor contado em dinheiro.'); end if;
  v_esperado := saldo_dinheiro(c.id);
  v_dif := round(p_valor_contado, 2) - v_esperado;
  if v_dif <> 0 and coalesce(trim(p_justificativa), '') = '' then
    perform _erro(format('Há diferença de %s entre o valor contado e o esperado. Informe a justificativa.', brl(v_dif)));
  end if;
  if v_dif > 0 then
    insert into lancamentos_financeiros (caixa_id, tipo, categoria_id, valor, descricao, forma_pagamento, usuario_id)
    values (c.id, 'ENTRADA', _categoria_por_codigo('SOBRA'), v_dif, 'Sobra no fechamento: ' || trim(p_justificativa), 'DINHEIRO', auth.uid());
  elsif v_dif < 0 then
    insert into lancamentos_financeiros (caixa_id, tipo, categoria_id, valor, descricao, forma_pagamento, usuario_id)
    values (c.id, 'SAIDA', _categoria_por_codigo('FALTA'), -v_dif, 'Falta no fechamento: ' || trim(p_justificativa), 'DINHEIRO', auth.uid());
  end if;
  update caixas set status = 'FECHADO', data_fechamento = now(), saldo_esperado = v_esperado,
                    valor_contado = round(p_valor_contado, 2), diferenca = v_dif, justificativa = nullif(trim(p_justificativa), '')
   where id = c.id;
  return c.id;
end $$;

-- Resumo / relatório de fechamento (UC-12, RF-49)
create or replace function resumo_caixa(p_caixa bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c caixas; v jsonb;
begin
  perform exigir_perfil('OPERADOR');
  select * into c from caixas where id = p_caixa;
  if not found then perform _erro('Caixa não encontrado.'); end if;
  if c.operador_id <> auth.uid() and meu_perfil() <> 'ADMINISTRADOR' then
    perform _erro('Você só pode consultar o seu próprio caixa.');
  end if;
  select jsonb_build_object(
    'caixa', to_jsonb(c) || jsonb_build_object('operador', (select nome from usuarios where id = c.operador_id)),
    'saldo_dinheiro', saldo_dinheiro(c.id),
    'total_entradas', coalesce(sum(valor) filter (where tipo = 'ENTRADA'), 0),
    'total_saidas',   coalesce(sum(valor) filter (where tipo = 'SAIDA'), 0),
    'por_forma', coalesce((
        select jsonb_agg(jsonb_build_object('forma', f.forma, 'entradas', f.ent, 'saidas', f.sai) order by f.forma)
        from (select forma_pagamento as forma,
                     coalesce(sum(valor) filter (where tipo = 'ENTRADA'), 0) as ent,
                     coalesce(sum(valor) filter (where tipo = 'SAIDA'), 0) as sai
              from lancamentos_financeiros where caixa_id = c.id group by forma_pagamento) f), '[]'::jsonb)
  ) into v
  from lancamentos_financeiros where caixa_id = c.id;
  return v || jsonb_build_object('saldo_final', c.saldo_inicial + (v->>'total_entradas')::numeric - (v->>'total_saidas')::numeric);
end $$;

-- ---------------------------------------------------------------------
-- Estoque: entrada de produtos (RF-11, RN-05) e ajuste (RF-13, RN-06)
-- ---------------------------------------------------------------------
create or replace function registrar_entrada_produto(p_fornecedor_id bigint, p_numero_nf text, p_data date, p_itens jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint; e jsonb; p produtos; v_qtd int; v_custo numeric; v_total numeric := 0;
begin
  perform exigir_perfil('OPERADOR');
  if not exists (select 1 from fornecedores where id = p_fornecedor_id and ativo) then
    perform _erro('Selecione um fornecedor ativo.');
  end if;
  if coalesce(trim(p_numero_nf), '') = '' then perform _erro('Informe o número da nota fiscal.'); end if;
  if jsonb_array_length(coalesce(p_itens, '[]')) = 0 then perform _erro('Adicione ao menos um produto.'); end if;
  insert into entradas_produto (fornecedor_id, numero_nota_fiscal, data_entrada, usuario_id)
  values (p_fornecedor_id, trim(p_numero_nf), coalesce(p_data, hoje()), auth.uid()) returning id into v_id;
  for e in select * from jsonb_array_elements(p_itens) loop
    v_qtd := (e->>'quantidade')::int;
    v_custo := round((e->>'custo_unitario')::numeric, 2);
    if v_qtd is null or v_qtd <= 0 then perform _erro('Quantidade inválida na entrada.'); end if;
    if v_custo is null or v_custo < 0 then perform _erro('Custo unitário inválido na entrada.'); end if;
    select * into p from produtos where id = (e->>'produto_id')::bigint for update;
    if not found then perform _erro('Produto não encontrado.'); end if;
    -- RN-05: custo médio ponderado
    update produtos set preco_custo = case when p.quantidade_estoque > 0
             then round((p.quantidade_estoque * p.preco_custo + v_qtd * v_custo) / (p.quantidade_estoque + v_qtd), 2)
             else v_custo end
     where id = p.id;
    insert into itens_entrada (entrada_id, produto_id, quantidade, custo_unitario) values (v_id, p.id, v_qtd, v_custo);
    perform _movimentar_estoque(p.id, v_qtd, 'ENTRADA', 'Entrada NF ' || trim(p_numero_nf), null, null, null, v_id);
    v_total := v_total + v_qtd * v_custo;
  end loop;
  update entradas_produto set valor_total = v_total where id = v_id;
  return v_id;
end $$;

create or replace function ajustar_estoque(p_produto_id bigint, p_quantidade int, p_motivo text) returns int
language plpgsql security definer set search_path = public as $$
begin
  perform exigir_perfil('OPERADOR');
  if coalesce(trim(p_motivo), '') = '' then perform _erro('Informe o motivo do ajuste de estoque.'); end if;
  if coalesce(p_quantidade, 0) = 0 then perform _erro('Informe a quantidade do ajuste (positiva ou negativa).'); end if;
  return _movimentar_estoque(p_produto_id, p_quantidade, 'AJUSTE', 'Ajuste manual', trim(p_motivo));
end $$;

-- ---------------------------------------------------------------------
-- Vendas no balcão (RF-33..RF-37, RN-04, RN-07, RN-16, RN-19, RN-21)
-- p_itens: [{produto_id, quantidade}]
-- p_pagamentos: [{forma, valor, valor_recebido?, codigo_transacao?, bandeira?, parcelas?}]
-- ---------------------------------------------------------------------
create or replace function realizar_venda(
  p_itens jsonb, p_pagamentos jsonb, p_desconto numeric default 0, p_cliente_id bigint default null, p_autorizacao uuid default null
) returns bigint language plpgsql security definer set search_path = public as $$
declare v_caixa bigint; v_id bigint; v_subtotal numeric; v_desc numeric := round(coalesce(p_desconto, 0), 2);
        v_total numeric; v_abaixo boolean; v_aut uuid; r record; v_inativo text;
begin
  perform exigir_perfil('OPERADOR');
  v_caixa := exigir_caixa_aberto();
  if jsonb_array_length(coalesce(p_itens, '[]')) = 0 then perform _erro('Adicione ao menos um produto à venda.'); end if;
  if p_cliente_id is not null and not exists (select 1 from clientes where id = p_cliente_id and ativo) then
    perform _erro('Cliente inválido ou inativo.');
  end if;
  select string_agg(p.descricao, ', ') into v_inativo
    from jsonb_array_elements(p_itens) e join produtos p on p.id = (e->>'produto_id')::bigint where not p.ativo;
  if v_inativo is not null then perform _erro('Produto inativo não pode ser vendido: ' || v_inativo); end if;
  if exists (select 1 from jsonb_array_elements(p_itens) e where coalesce((e->>'quantidade')::int, 0) <= 0) then
    perform _erro('Quantidade inválida.');
  end if;

  if exists (select 1 from jsonb_array_elements(p_itens) e
              where not exists (select 1 from produtos p where p.id = (e->>'produto_id')::bigint)) then
    perform _erro('Produto não encontrado.');
  end if;

  select sum(x.qtd * p.preco_venda) into v_subtotal
    from (select (e->>'produto_id')::bigint as pid, sum((e->>'quantidade')::int) as qtd
            from jsonb_array_elements(p_itens) e group by 1) x
    join produtos p on p.id = x.pid;
  if v_desc < 0 or v_desc > v_subtotal then perform _erro('Desconto inválido.'); end if;

  insert into vendas (caixa_id, operador_id, cliente_id, subtotal, valor_total)
  values (v_caixa, auth.uid(), p_cliente_id, v_subtotal, v_subtotal) returning id into v_id;

  -- distribui o desconto proporcionalmente entre os itens (ItemVenda.desconto); o último item absorve o arredondamento
  insert into itens_venda (venda_id, produto_id, quantidade, preco_unitario, custo_unitario, desconto)
  select v_id, z.pid, z.qtd, z.pv, z.pc,
         case when z.rn = z.cnt
              then v_desc - coalesce(sum(z.rateio) over (order by z.pid rows between unbounded preceding and 1 preceding), 0)
              else z.rateio end
    from (select b.*, row_number() over (order by b.pid) as rn, count(*) over () as cnt,
                 coalesce(round(b.qtd * b.pv * v_desc / nullif(v_subtotal, 0), 2), 0) as rateio
            from (select x.pid, x.qtd, p.preco_venda as pv, p.preco_custo as pc
                    from (select (e->>'produto_id')::bigint as pid, sum((e->>'quantidade')::int) as qtd
                            from jsonb_array_elements(p_itens) e group by 1) x
                    join produtos p on p.id = x.pid) b) z
   order by z.pid;

  select bool_or(quantidade * preco_unitario - desconto < quantidade * custo_unitario) into v_abaixo
    from itens_venda where venda_id = v_id;
  v_aut := _verificar_desconto(v_subtotal, v_desc, v_abaixo, p_autorizacao);
  v_total := v_subtotal - v_desc;
  update vendas set subtotal = v_subtotal, desconto = v_desc, valor_total = v_total, autorizado_por = v_aut where id = v_id;

  for r in select produto_id, quantidade from itens_venda where venda_id = v_id loop
    perform _movimentar_estoque(r.produto_id, -r.quantidade, 'SAIDA', 'Venda #' || v_id, null, v_id);
  end loop;

  perform _registrar_pagamentos(p_pagamentos, v_total, v_id, null, v_caixa, 'VENDA', 'Venda #' || v_id);
  return v_id;
end $$;

create or replace function cancelar_venda(p_id bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v vendas; r record;
begin
  perform exigir_perfil('ADMINISTRADOR');
  if coalesce(trim(p_motivo), '') = '' then perform _erro('Informe o motivo do cancelamento.'); end if;
  select * into v from vendas where id = p_id for update;
  if not found then perform _erro('Venda não encontrada.'); end if;
  if v.status = 'CANCELADA' then perform _erro('Esta venda já está cancelada.'); end if;
  update vendas set status = 'CANCELADA', motivo_cancelamento = trim(p_motivo), cancelada_por = auth.uid(), cancelada_em = now()
   where id = p_id;
  for r in select produto_id, quantidade from itens_venda where venda_id = p_id loop
    perform _movimentar_estoque(r.produto_id, r.quantidade, 'ENTRADA', 'Cancelamento da venda #' || p_id, trim(p_motivo), p_id);
  end loop;
  for r in select id from lancamentos_financeiros
            where venda_id = p_id and estorno_de_id is null and not estornado loop
    perform _estornar(r.id, 'Cancelamento da venda: ' || trim(p_motivo));
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Ordens de serviço (RF-21..RF-32, RN-08..RN-14)
-- ---------------------------------------------------------------------
create or replace function _recalcular_os(p_os bigint) returns numeric
language plpgsql security definer set search_path = public as $$
declare v numeric;
begin
  update ordens_servico o
     set valor_total = coalesce((select sum(quantidade * preco_unitario) from itens_os where os_id = o.id), 0)
                       + o.valor_mao_de_obra - o.desconto
   where id = p_os returning valor_total into v;
  return v;
end $$;

create or replace function _os_para_edicao(p_os bigint) returns ordens_servico
language plpgsql security definer set search_path = public as $$
declare o ordens_servico;
begin
  select * into o from ordens_servico where id = p_os for update;
  if not found then perform _erro('Ordem de serviço não encontrada.'); end if;
  if o.status not in ('ABERTA', 'EM_MANUTENCAO', 'AGUARDANDO_PECA') then
    perform _erro(format('A OS nº %s está %s e não pode mais ser alterada.', o.numero, lower(replace(o.status::text, '_', ' '))));
  end if;
  return o;
end $$;

create or replace function _validar_tecnico(p_tecnico uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_tecnico is not null and not exists (select 1 from usuarios where id = p_tecnico and ativo and perfil in ('TECNICO', 'ADMINISTRADOR')) then
    perform _erro('Técnico inválido ou inativo.');
  end if;
end $$;

create or replace function abrir_os(
  p_cliente_id bigint, p_equipamento text, p_defeito_relatado text, p_acessorios text default null,
  p_tecnico_id uuid default null, p_garantia_de_id bigint default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_num bigint; v_id bigint; g ordens_servico;
begin
  perform exigir_perfil('OPERADOR', 'TECNICO');
  if not exists (select 1 from clientes where id = p_cliente_id and ativo) then
    perform _erro('Toda ordem de serviço deve estar vinculada a um cliente cadastrado e ativo.');
  end if;
  if coalesce(trim(p_equipamento), '') = '' then perform _erro('Informe o equipamento.'); end if;
  if coalesce(trim(p_defeito_relatado), '') = '' then perform _erro('Informe o defeito relatado.'); end if;
  perform _validar_tecnico(p_tecnico_id);
  if p_garantia_de_id is not null then
    select * into g from ordens_servico where id = p_garantia_de_id;
    if not found or g.status <> 'ENTREGUE' then perform _erro('A OS original da garantia deve estar entregue.'); end if;
    if g.cliente_id <> p_cliente_id then perform _erro('A OS de garantia deve ser do mesmo cliente da OS original.'); end if;
    if g.data_entrega < now() - interval '90 days' then
      perform _erro(format('A garantia da OS nº %s expirou em %s.', g.numero,
                           to_char((g.data_entrega + interval '90 days') at time zone app_tz(), 'DD/MM/YYYY')));
    end if;
  end if;
  update contadores set valor = valor + 1 where nome = 'ordem_servico' returning valor into v_num;  -- RN-09
  insert into ordens_servico (numero, cliente_id, tecnico_id, aberta_por, equipamento, defeito_relatado, acessorios, garantia_de_id)
  values (v_num, p_cliente_id, p_tecnico_id, auth.uid(), trim(p_equipamento), trim(p_defeito_relatado),
          nullif(trim(coalesce(p_acessorios, '')), ''), p_garantia_de_id)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'numero', v_num);
end $$;

create or replace function os_atribuir_tecnico(p_os bigint, p_tecnico_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform exigir_perfil('OPERADOR', 'TECNICO');
  perform _os_para_edicao(p_os);
  perform _validar_tecnico(p_tecnico_id);
  update ordens_servico set tecnico_id = p_tecnico_id where id = p_os;
end $$;

create or replace function os_registrar_servico(p_os bigint, p_diagnostico text, p_servico_executado text, p_valor_mao_de_obra numeric)
returns numeric language plpgsql security definer set search_path = public as $$
declare o ordens_servico;
begin
  perform exigir_perfil('TECNICO');
  o := _os_para_edicao(p_os);
  if coalesce(p_valor_mao_de_obra, 0) < 0 then perform _erro('Valor de mão de obra inválido.'); end if;
  if o.garantia_de_id is not null and coalesce(p_valor_mao_de_obra, 0) > 0 then
    perform _erro('OS em garantia não pode ter cobrança de mão de obra.');  -- RN-14
  end if;
  update ordens_servico set diagnostico = nullif(trim(coalesce(p_diagnostico, '')), ''),
                            servico_executado = nullif(trim(coalesce(p_servico_executado, '')), ''),
                            valor_mao_de_obra = round(coalesce(p_valor_mao_de_obra, 0), 2)
   where id = p_os;
  return _recalcular_os(p_os);
end $$;

create or replace function os_adicionar_produto(p_os bigint, p_produto_id bigint, p_quantidade int) returns numeric
language plpgsql security definer set search_path = public as $$
declare o ordens_servico; p produtos;
begin
  perform exigir_perfil('TECNICO', 'OPERADOR');
  o := _os_para_edicao(p_os);
  if coalesce(p_quantidade, 0) <= 0 then perform _erro('Quantidade inválida.'); end if;
  select * into p from produtos where id = p_produto_id;
  if not found or not p.ativo then perform _erro('Produto inativo não pode ser adicionado à OS.'); end if;
  perform _movimentar_estoque(p.id, -p_quantidade, 'SAIDA', 'OS nº ' || o.numero, null, null, o.id);  -- RN-11
  insert into itens_os (os_id, produto_id, quantidade, preco_unitario, custo_unitario, adicionado_por)
  values (o.id, p.id, p_quantidade, p.preco_venda, p.preco_custo, auth.uid());
  return _recalcular_os(o.id);
end $$;

create or replace function os_remover_produto(p_item_id bigint) returns numeric
language plpgsql security definer set search_path = public as $$
declare i itens_os; o ordens_servico;
begin
  perform exigir_perfil('TECNICO', 'OPERADOR');
  select * into i from itens_os where id = p_item_id;
  if not found then perform _erro('Item não encontrado.'); end if;
  o := _os_para_edicao(i.os_id);
  delete from itens_os where id = i.id;
  perform _movimentar_estoque(i.produto_id, i.quantidade, 'ENTRADA', 'Removido da OS nº ' || o.numero, null, null, o.id);
  return _recalcular_os(o.id);
end $$;

-- RN-10: aberta → em manutenção ⇄ aguardando peça → concluída → (entregue via finalização)
create or replace function os_atualizar_status(p_os bigint, p_status status_os) returns void
language plpgsql security definer set search_path = public as $$
declare o ordens_servico; ok boolean;
begin
  perform exigir_perfil('TECNICO', 'OPERADOR');
  select * into o from ordens_servico where id = p_os for update;
  if not found then perform _erro('Ordem de serviço não encontrada.'); end if;
  if p_status = 'ENTREGUE' then perform _erro('Para entregar, finalize a OS registrando o pagamento.'); end if;
  if p_status = 'CANCELADA' then perform _erro('Use a opção "Cancelar OS" informando o motivo.'); end if;
  ok := (o.status = 'ABERTA' and p_status = 'EM_MANUTENCAO')
     or (o.status = 'EM_MANUTENCAO' and p_status in ('AGUARDANDO_PECA', 'CONCLUIDA'))
     or (o.status = 'AGUARDANDO_PECA' and p_status = 'EM_MANUTENCAO');
  if not ok then
    perform _erro(format('Transição de status não permitida: %s → %s.', o.status, p_status));
  end if;
  update ordens_servico set status = p_status,
         data_conclusao = case when p_status = 'CONCLUIDA' then now() else data_conclusao end
   where id = p_os;
end $$;

create or replace function os_cancelar(p_os bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare o ordens_servico; r record;
begin
  perform exigir_perfil('OPERADOR');   -- RN-12: operador de caixa ou administrador
  if coalesce(trim(p_motivo), '') = '' then perform _erro('Informe o motivo do cancelamento.'); end if;
  o := _os_para_edicao(p_os);
  for r in select produto_id, quantidade from itens_os where os_id = o.id loop
    perform _movimentar_estoque(r.produto_id, r.quantidade, 'ENTRADA', 'Cancelamento da OS nº ' || o.numero, trim(p_motivo), null, o.id);
  end loop;
  update ordens_servico set status = 'CANCELADA', motivo_cancelamento = trim(p_motivo) where id = o.id;
end $$;

-- RF-32 / UC-16 / RN-13: recebe o pagamento integral e marca como entregue
create or replace function os_finalizar(p_os bigint, p_pagamentos jsonb, p_desconto numeric default 0, p_autorizacao uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare o ordens_servico; v_caixa bigint; v_itens numeric; v_bruto numeric; v_desc numeric := round(coalesce(p_desconto, 0), 2);
        v_total numeric; v_abaixo boolean; v_aut uuid;
begin
  perform exigir_perfil('OPERADOR');
  v_caixa := exigir_caixa_aberto();
  select * into o from ordens_servico where id = p_os for update;
  if not found then perform _erro('Ordem de serviço não encontrada.'); end if;
  if o.status <> 'CONCLUIDA' then perform _erro('Somente ordens de serviço concluídas podem ser finalizadas e entregues.'); end if;
  select coalesce(sum(quantidade * preco_unitario), 0) into v_itens from itens_os where os_id = o.id;
  v_bruto := v_itens + o.valor_mao_de_obra;
  if v_desc < 0 or v_desc > v_bruto then perform _erro('Desconto inválido.'); end if;
  select coalesce(bool_or(quantidade * preco_unitario * (1 - v_desc / nullif(v_bruto, 0)) < quantidade * custo_unitario), false)
    into v_abaixo from itens_os where os_id = o.id;
  v_aut := _verificar_desconto(v_bruto, v_desc, v_abaixo, p_autorizacao);
  v_total := v_bruto - v_desc;
  if v_total > 0 then
    perform _registrar_pagamentos(p_pagamentos, v_total, null, o.id, v_caixa, 'OS', 'OS nº ' || o.numero);
  elsif jsonb_array_length(coalesce(p_pagamentos, '[]')) > 0 then
    perform _erro('Esta OS não possui valor a receber.');
  end if;
  update ordens_servico set status = 'ENTREGUE', data_entrega = now(), desconto = v_desc, valor_total = v_total,
                            caixa_id = v_caixa, finalizada_por = auth.uid(), autorizado_por = v_aut
   where id = o.id;
end $$;

-- ---------------------------------------------------------------------
-- Clientes – LGPD (RNF-15): anonimização a pedido do titular
-- ---------------------------------------------------------------------
create or replace function anonimizar_cliente(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform exigir_perfil('ADMINISTRADOR');
  update clientes set nome = 'Cliente anonimizado #' || id, cpf_cnpj = null, telefone = null, email = null,
                      endereco = null, ativo = false, anonimizado_em = now()
   where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- Relatórios (RF-48, RF-50)
-- ---------------------------------------------------------------------
create or replace function relatorio_financeiro_categoria(p_inicio date, p_fim date)
returns table (tipo tipo_lancamento, categoria text, quantidade bigint, total numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform exigir_perfil('ADMINISTRADOR');
  return query
    select c.tipo, c.nome, count(*) filter (where l.estorno_de_id is null),
           sum(case when l.tipo = c.tipo then l.valor else -l.valor end)   -- estornos abatem da categoria
      from lancamentos_financeiros l join categorias_financeiras c on c.id = l.categoria_id
     where (l.data_hora at time zone app_tz())::date between p_inicio and p_fim
     group by c.tipo, c.nome
     order by c.tipo, 4 desc;
end $$;

create or replace function relatorio_vendas_servicos(p_inicio date, p_fim date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform exigir_perfil('ADMINISTRADOR');
  select jsonb_build_object(
    'vendas_quantidade',  count(*) filter (where status = 'CONCLUIDA'),
    'vendas_total',       coalesce(sum(valor_total) filter (where status = 'CONCLUIDA'), 0),
    'vendas_descontos',   coalesce(sum(desconto) filter (where status = 'CONCLUIDA'), 0),
    'vendas_canceladas',  count(*) filter (where status = 'CANCELADA'),
    'vendas_canceladas_total', coalesce(sum(valor_total) filter (where status = 'CANCELADA'), 0))
  into v from vendas where (data_hora at time zone app_tz())::date between p_inicio and p_fim;
  select v || jsonb_build_object(
    'os_quantidade',     count(*),
    'os_total',          coalesce(sum(valor_total), 0),
    'os_mao_de_obra',    coalesce(sum(valor_mao_de_obra), 0),
    'os_descontos',      coalesce(sum(desconto), 0),
    'os_produtos',       coalesce(sum(valor_total - valor_mao_de_obra + desconto), 0))
  into v from ordens_servico where status = 'ENTREGUE' and (data_entrega at time zone app_tz())::date between p_inicio and p_fim;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- Login com bloqueio por tentativas (RNF-05) – usadas apenas pela Cloudflare Function (service_role)
-- ---------------------------------------------------------------------
create or replace function login_registrar_falha(p_usuario uuid) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v timestamptz;
begin
  update usuarios set tentativas_login = tentativas_login + 1,
                      bloqueado_ate = case when tentativas_login + 1 >= 5 then now() + interval '15 minutes' else bloqueado_ate end
   where id = p_usuario returning bloqueado_ate into v;
  update usuarios set tentativas_login = 0 where id = p_usuario and tentativas_login >= 5;
  return v;
end $$;

create or replace function login_registrar_sucesso(p_usuario uuid) returns void
language sql security definer set search_path = public as $$
  update usuarios set tentativas_login = 0, bloqueado_ate = null where id = p_usuario
$$;

-- ---------------------------------------------------------------------
-- Auditoria (RNF-06): usuário, data e hora de toda alteração em estoque, OS e caixa
-- ---------------------------------------------------------------------
create or replace function _auditar() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_antes jsonb; v_depois jsonb;
begin
  if tg_op <> 'INSERT' then v_antes := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_depois := to_jsonb(new); end if;
  insert into auditoria (usuario_id, tabela, operacao, registro_id, dados_antes, dados_depois)
  values (auth.uid(), tg_table_name, tg_op, coalesce(v_depois, v_antes)->>'id', v_antes, v_depois);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['usuarios', 'produtos', 'categorias_produto', 'fornecedores', 'clientes', 'entradas_produto',
                           'movimentacoes_estoque', 'ordens_servico', 'itens_os', 'vendas', 'caixas',
                           'lancamentos_financeiros', 'categorias_financeiras'] loop
    execute format('create trigger %I after insert or update or delete on %I for each row execute function _auditar()',
                   t || '_auditoria', t);
  end loop;
end $$;
