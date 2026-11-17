// Testa as migrações e regras de negócio num Postgres embutido (PGlite),
// simulando o ambiente do Supabase (schema auth, roles e auth.uid()).
// Uso: npm run test:sql
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const db = new PGlite({ extensions: { pg_trgm } });

let passed = 0;
let failed = 0;
const ok = (cond, name) => {
  if (cond) { passed++; console.log('  ✔', name); }
  else { failed++; console.log('  ✘', name); }
};

// ---- stub do Supabase ----
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated, anon, service_role;
  grant execute on function auth.uid() to authenticated, anon, service_role;
  grant usage on schema public to authenticated, anon, service_role;
`);

for (const f of readdirSync(join(root, 'supabase/migrations')).sort()) {
  await db.exec(readFileSync(join(root, 'supabase/migrations', f), 'utf8'));
  console.log('migração aplicada:', f);
}

// ---- usuários ----
const ids = {};
for (const [login, perfil, limite] of [['admin', 'ADMINISTRADOR', 100], ['oper', 'OPERADOR', 10], ['tecnico', 'TECNICO', 0]]) {
  const { rows } = await db.query(`insert into auth.users (email) values ($1) returning id`, [`${login}@caixa.local`]);
  ids[login] = rows[0].id; ids[login.slice(0, login === 'oper' ? 2 : 3)] = rows[0].id;
  await db.query(`insert into usuarios (id, nome, login, perfil, limite_desconto) values ($1,$2,$3,$4,$5)`,
    [ids[login], login.toUpperCase(), login, perfil, limite]);
}

async function as(user, sql, params = []) {
  await db.exec(`reset role`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [ids[user]]);
  await db.exec(`set role authenticated`);
  try {
    const r = await db.query(sql, params);
    return r.rows;
  } finally {
    await db.exec(`reset role`);
  }
}
async function fails(user, sql, params, match, name) {
  try {
    await as(user, sql, params);
    ok(false, name + ' (não falhou)');
  } catch (e) {
    const good = !match || e.message.includes(match) || e.code === match;
    if (!good) console.log('     erro recebido:', e.code, e.message);
    ok(good, name);
  }
}
const one = async (...a) => (await as(...a))[0];
const scalar = async (...a) => Object.values((await as(...a))[0])[0];

console.log('\nCadastros e permissões');
const cat = await scalar('op', `select id from categorias_produto where nome = 'Periféricos'`);
const p1 = await scalar('op', `insert into produtos (codigo, codigo_barras, descricao, categoria_id, preco_custo, preco_venda, estoque_minimo)
  values ('MOU01', '7890000000011', 'Mouse USB', $1, 0, 100, 3) returning id`, [cat]);
const p2 = await scalar('op', `insert into produtos (codigo, descricao, preco_custo, preco_venda) values ('SSD01', 'SSD 240GB', 0, 200) returning id`);
ok(p1 && p2, 'operador cadastra produtos');
await fails('tec', `insert into produtos (codigo, descricao) values ('X', 'Y')`, [], 'row-level security', 'técnico não cadastra produto');
await fails('op', `update produtos set quantidade_estoque = 99 where id = $1`, [p1], 'permission denied', 'estoque não é editável diretamente');
const forn = await scalar('op', `insert into fornecedores (razao_social, cnpj) values ('Distribuidora X', '12.345.678/0001-90') returning id`);
const cli = await scalar('op', `insert into clientes (nome, cpf_cnpj, telefone) values ('João Silva', '123.456.789-00', '11999990000') returning id`);
await fails('tec', `insert into clientes (nome) values ('Z')`, [], 'row-level security', 'técnico não cadastra cliente');
const upd = await as('tec', `update clientes set telefone = '11888880000' where id = $1 returning id`, [cli]);
ok(upd.length === 1, 'técnico edita cliente (RF-20)');
await fails('op', `delete from produtos where id = $1`, [p1], 'permission denied', 'não é possível excluir produto (RN-22)');

console.log('\nEntrada de produtos e custo médio (RN-05)');
await as('op', `select registrar_entrada_produto($1, 'NF-100', null, $2)`, [forn, JSON.stringify([{ produto_id: p1, quantidade: 10, custo_unitario: 50 }, { produto_id: p2, quantidade: 5, custo_unitario: 150 }])]);
await as('op', `select registrar_entrada_produto($1, 'NF-101', null, $2)`, [forn, JSON.stringify([{ produto_id: p1, quantidade: 10, custo_unitario: 70 }])]);
let prod = await one('op', `select * from produtos where id = $1`, [p1]);
ok(prod.quantidade_estoque === 20 && Number(prod.preco_custo) === 60, `estoque 20 e custo médio 60 (obtido ${prod.quantidade_estoque} / ${prod.preco_custo})`);

console.log('\nCaixa (RN-01, RN-02)');
await fails('op', `select realizar_venda($1, $2)`, [JSON.stringify([{ produto_id: p1, quantidade: 1 }]), JSON.stringify([{ forma: 'PIX', valor: 100 }])], 'abrir o caixa', 'venda sem caixa aberto é bloqueada');
await as('op', `select abrir_caixa(100)`);
await fails('op', `select abrir_caixa(50)`, [], 'já possui um caixa aberto', 'apenas um caixa aberto por operador');
await fails('tec', `select abrir_caixa(50)`, [], 'não permitida', 'técnico não abre caixa');

console.log('\nVenda no balcão');
const v1 = await scalar('op', `select realizar_venda($1, $2)`, [
  JSON.stringify([{ produto_id: p1, quantidade: 2 }]),
  JSON.stringify([{ forma: 'PIX', valor: 50 }, { forma: 'DINHEIRO', valor: 150, valor_recebido: 200 }]),
]);
prod = await one('op', `select quantidade_estoque from produtos where id = $1`, [p1]);
ok(prod.quantidade_estoque === 18, 'baixa automática de estoque (RF-12)');
const pagDin = await one('op', `select * from pagamentos where venda_id = $1 and forma = 'DINHEIRO'`, [v1]);
ok(Number(pagDin.troco) === 50, 'troco calculado (RF-36)');
const lancs = await as('op', `select l.*, c.nome cat from lancamentos_financeiros l join categorias_financeiras c on c.id = l.categoria_id where venda_id = $1`, [v1]);
ok(lancs.length === 2 && lancs.every((l) => l.cat === 'Venda de produtos'), 'lançamentos automáticos categorizados (RN-16)');

await fails('op', `select realizar_venda($1, $2)`, [JSON.stringify([{ produto_id: p1, quantidade: 1 }]), JSON.stringify([{ forma: 'PIX', valor: 90 }])], 'soma das formas', 'soma dos pagamentos deve fechar o total (RN-19)');
prod = await one('op', `select quantidade_estoque from produtos where id = $1`, [p1]);
ok(prod.quantidade_estoque === 18, 'venda com erro não grava nada (RNF-07)');
await fails('op', `select realizar_venda($1, $2)`, [JSON.stringify([{ produto_id: p1, quantidade: 999 }]), JSON.stringify([{ forma: 'PIX', valor: 99900 }])], 'Estoque insuficiente', 'estoque não negativo (RN-04)');
await fails('op', `select realizar_venda($1, $2, 20)`, [JSON.stringify([{ produto_id: p1, quantidade: 1 }]), JSON.stringify([{ forma: 'PIX', valor: 80 }])], 'CXAUT', 'desconto acima do limite exige autorização');
ok(!!(await scalar('op', `select realizar_venda($1, $2, 5)`, [JSON.stringify([{ produto_id: p2, quantidade: 1 }]), JSON.stringify([{ forma: 'PIX', valor: 195 }])])), 'desconto dentro do limite é aceito');
const p3 = await scalar('op', `insert into produtos (codigo, descricao, preco_venda) values ('CAB01', 'Cabo HDMI', 100) returning id`);
await as('op', `select registrar_entrada_produto($1, 'NF-102', null, $2)`, [forn, JSON.stringify([{ produto_id: p3, quantidade: 5, custo_unitario: 120 }])]);
await fails('op', `select realizar_venda($1, $2)`, [JSON.stringify([{ produto_id: p3, quantidade: 1 }]), JSON.stringify([{ forma: 'PIX', valor: 100 }])], 'CXAUT', 'venda abaixo do custo exige autorização (RN-07)');
const aut = await scalar('admin', `select gerar_autorizacao()`);
const v2 = await scalar('op', `select realizar_venda($1, $2, 20, null, $3)`, [JSON.stringify([{ produto_id: p1, quantidade: 1 }]), JSON.stringify([{ forma: 'CARTAO_DEBITO', valor: 80 }]), aut]);
ok(!!v2, 'venda com autorização do administrador');
await fails('op', `select realizar_venda($1, $2, 20, null, $3)`, [JSON.stringify([{ produto_id: p1, quantidade: 1 }]), JSON.stringify([{ forma: 'CARTAO_DEBITO', valor: 80 }]), aut], 'inválida ou expirada', 'autorização não pode ser reutilizada');
await fails('tec', `select gerar_autorizacao()`, [], 'não permitida', 'somente administrador gera autorização');

console.log('\nLançamentos e estorno (RN-15, RN-17, RN-18, RN-20, RNF-08)');
const catAluguel = await scalar('admin', `select id from categorias_financeiras where nome = 'Aluguel'`);
const catForn = await scalar('admin', `select id from categorias_financeiras where codigo = 'PAG_FORNECEDOR'`);
const catAporte = await scalar('admin', `select id from categorias_financeiras where nome = 'Aporte'`);
await fails('op', `select registrar_lancamento('SAIDA', $1, 10, 'PIX', 'aluguel')`, [catAluguel], 'não permitida', 'operador não registra saída (RF-41)');
await fails('op', `select registrar_lancamento('ENTRADA', $1, 10, 'PIX', 'x')`, [catAluguel], 'só pode ser usada', 'categoria de saída não pode ser usada em entrada');
const lAporte = await scalar('op', `select registrar_lancamento('ENTRADA', $1, 30, 'DINHEIRO', 'Aporte do dono')`, [catAporte]);
ok(!!lAporte, 'operador registra entrada (RF-40)');
await as('admin', `select abrir_caixa(0)`);
await fails('admin', `select registrar_lancamento('SAIDA', $1, 10, 'PIX', 'boleto')`, [catForn], 'vinculadas a um fornecedor', 'pagamento de fornecedor exige fornecedor (RN-17)');
await fails('admin', `select registrar_lancamento('SAIDA', $1, 10, 'DINHEIRO', 'aluguel')`, [catAluguel], 'Saldo em dinheiro insuficiente', 'saída em dinheiro limitada ao saldo (RN-18)');
const entradaId = await scalar('admin', `select id from entradas_produto where numero_nota_fiscal = 'NF-100'`);
ok(!!(await scalar('admin', `select registrar_lancamento('SAIDA', $1, 1250, 'PIX', 'NF-100', null, $2, $3)`, [catForn, forn, entradaId])), 'saída vinculada a fornecedor e nota (RF-43)');
await fails('admin', `update lancamentos_financeiros set valor = 1 where id = $1`, [lAporte], 'permission denied', 'lançamento não pode ser editado (RNF-08)');
await db.exec('reset role');
try { await db.query(`update lancamentos_financeiros set valor = 1 where id = $1`, [lAporte]); ok(false, 'trigger de imutabilidade'); }
catch (e) { ok(e.message.includes('não podem ser alterados'), 'trigger bloqueia alteração mesmo com privilégio'); }
await fails('op', `select estornar_lancamento($1, 'erro')`, [lAporte], 'não permitida', 'operador não estorna (RN-20)');
const est = await scalar('admin', `select estornar_lancamento($1, 'lançado errado')`, [lAporte]);
const orig = await one('admin', `select * from lancamentos_financeiros where id = $1`, [lAporte]);
const inv = await one('admin', `select * from lancamentos_financeiros where id = $1`, [est]);
ok(orig.estornado && inv.tipo === 'SAIDA' && Number(inv.valor) === 30 && inv.categoria_id === orig.categoria_id, 'estorno gera lançamento inverso na mesma categoria');
await fails('admin', `select estornar_lancamento($1, 'de novo')`, [lAporte], 'já foi estornado', 'não estorna duas vezes');
await fails('admin', `select estornar_lancamento($1, 'x')`, [lancs[0].id], 'cancele a venda', 'lançamento de venda só via cancelamento');

console.log('\nCancelamento de venda (RN-21)');
await fails('op', `select cancelar_venda($1, 'x')`, [v1], 'não permitida', 'operador não cancela venda');
await as('admin', `select cancelar_venda($1, 'cliente desistiu')`, [v1]);
prod = await one('admin', `select quantidade_estoque from produtos where id = $1`, [p1]);
const vend = await one('admin', `select status from vendas where id = $1`, [v1]);
const estornos = await scalar('admin', `select count(*)::int from lancamentos_financeiros where venda_id = $1 and estorno_de_id is not null`, [v1]);
ok(vend.status === 'CANCELADA' && prod.quantidade_estoque === 19 && estornos === 2, 'venda cancelada devolve estoque e estorna caixa');

console.log('\nOrdens de serviço');
const os1 = await scalar('tec', `select abrir_os($1, 'Notebook Dell', 'Não liga', 'Carregador', $2)`, [cli, ids.tec]);
const os2 = await scalar('op', `select abrir_os($1, 'PC Gamer', 'Tela azul')`, [cli]);
ok(os1.numero === 1 && os2.numero === 2, 'numeração sequencial (RN-09)');
await fails('op', `select abrir_os(null, 'X', 'Y')`, [], 'cliente cadastrado', 'cliente obrigatório (RN-08)');
await as('tec', `select os_adicionar_produto($1, $2, 1)`, [os1.id, p2]);
await as('tec', `select os_registrar_servico($1, 'Fonte queimada', 'Troca do SSD e limpeza', 120)`, [os1.id]);
let os = await one('tec', `select * from ordens_servico where id = $1`, [os1.id]);
ok(Number(os.valor_total) === 320, `total da OS = produtos + mão de obra (RF-27) (${os.valor_total})`);
await fails('tec', `select os_atualizar_status($1, 'CONCLUIDA')`, [os1.id], 'Transição', 'não pula de aberta para concluída (RN-10)');
await as('tec', `select os_atualizar_status($1, 'EM_MANUTENCAO')`, [os1.id]);
await as('tec', `select os_atualizar_status($1, 'AGUARDANDO_PECA')`, [os1.id]);
await as('tec', `select os_atualizar_status($1, 'EM_MANUTENCAO')`, [os1.id]);
await as('tec', `select os_atualizar_status($1, 'CONCLUIDA')`, [os1.id]);
await fails('tec', `select os_atualizar_status($1, 'EM_MANUTENCAO')`, [os1.id], 'Transição', 'não volta após concluída');
await fails('tec', `select os_atualizar_status($1, 'ENTREGUE')`, [os1.id], 'finalize', 'entregue só com pagamento (RN-13)');
await fails('tec', `select os_adicionar_produto($1, $2, 1)`, [os1.id, p1], 'não pode mais ser alterada', 'OS concluída não recebe produtos');
await fails('op', `select os_finalizar($1, $2)`, [os1.id, JSON.stringify([{ forma: 'PIX', valor: 300 }])], 'soma das formas', 'pagamento integral exigido');
await as('op', `select os_finalizar($1, $2)`, [os1.id, JSON.stringify([{ forma: 'CARTAO_CREDITO', valor: 320, parcelas: 3, bandeira: 'Visa' }])]);
os = await one('op', `select * from ordens_servico where id = $1`, [os1.id]);
const lOs = await one('op', `select c.nome from lancamentos_financeiros l join categorias_financeiras c on c.id = l.categoria_id where os_id = $1`, [os1.id]);
ok(os.status === 'ENTREGUE' && lOs.nome === 'Ordem de serviço', 'OS finalizada gera entrada "Ordem de serviço" (RF-32)');

await as('op', `select os_adicionar_produto($1, $2, 2)`, [os2.id, p1]);
await as('op', `select os_remover_produto(id) from itens_os where os_id = $1`, [os2.id]);
await as('op', `select os_adicionar_produto($1, $2, 3)`, [os2.id, p1]);
await fails('tec', `select os_cancelar($1, 'x')`, [os2.id], 'não permitida', 'técnico não cancela OS (RN-12)');
await as('op', `select os_cancelar($1, 'cliente desistiu')`, [os2.id]);
prod = await one('op', `select quantidade_estoque from produtos where id = $1`, [p1]);
ok(prod.quantidade_estoque === 19, 'cancelamento/remoção devolvem produtos ao estoque (RN-11)');
const os3 = await scalar('op', `select abrir_os($1, 'PC Gamer', 'Tela azul')`, [cli]);
ok(os3.numero === 3, 'número não é reaproveitado após cancelamento');

const osG = await scalar('tec', `select abrir_os($1, 'Notebook Dell', 'Não liga de novo', null, null, $2)`, [cli, os1.id]);
await fails('tec', `select os_registrar_servico($1, 'x', 'y', 50)`, [osG.id], 'garantia', 'garantia sem mão de obra (RN-14)');

console.log('\nAjuste de estoque (RF-13, RN-06)');
await fails('op', `select ajustar_estoque($1, -1, '')`, [p1], 'motivo', 'ajuste exige motivo');
await as('op', `select ajustar_estoque($1, -1, 'avaria')`, [p1]);
const movs = await scalar('admin', `select count(*)::int from movimentacoes_estoque where produto_id = $1`, [p1]);
ok(movs > 5, `histórico de movimentações registrado (${movs})`);
ok((await as('op', `select * from movimentacoes_estoque`)).length === 0, 'histórico visível só ao administrador (RF-16)');

console.log('\nFechamento de caixa (RN-03)');
const res = await scalar('op', `select resumo_caixa(id) from caixas where operador_id = $1 and status = 'ABERTO'`, [ids.op]);
ok(Number(res.saldo_dinheiro) === 100, `saldo esperado em dinheiro = 100 (obtido ${res.saldo_dinheiro})`);
await fails('op', `select fechar_caixa(90)`, [], 'justificativa', 'diferença exige justificativa');
const cx = await scalar('op', `select fechar_caixa(90, 'troco errado')`);
const caixa = await one('op', `select * from caixas where id = $1`, [cx]);
const falta = await one('op', `select c.nome, l.valor from lancamentos_financeiros l join categorias_financeiras c on c.id = l.categoria_id where caixa_id = $1 and c.codigo = 'FALTA'`, [cx]);
ok(caixa.status === 'FECHADO' && Number(caixa.diferenca) === -10 && Number(falta.valor) === 10, 'falta de caixa registrada como lançamento');
ok((await as('tec', `select * from caixas`)).length === 0, 'técnico não vê caixas');

console.log('\nRelatórios');
const rf = await as('admin', `select * from relatorio_financeiro_categoria(hoje() - 1, hoje() + 1)`);
ok(rf.length > 0, 'relatório financeiro por categoria');
const rv = await scalar('admin', `select relatorio_vendas_servicos(hoje() - 1, hoje() + 1)`);
ok(rv.vendas_quantidade === 2 && rv.vendas_canceladas === 1 && rv.os_quantidade === 1, 'relatório de vendas e serviços');
await fails('op', `select * from relatorio_financeiro_categoria(hoje(), hoje())`, [], 'não permitida', 'relatórios só para administrador');

console.log('\nAuditoria e login');
ok((await scalar('admin', `select count(*)::int from auditoria`)) > 10, 'auditoria registrada (RNF-06)');
await db.exec('reset role');
for (let i = 0; i < 5; i++) await db.query(`select login_registrar_falha($1)`, [ids.tec]);
const tec = (await db.query(`select bloqueado_ate from usuarios where id = $1`, [ids.tec])).rows[0];
ok(tec.bloqueado_ate && new Date(tec.bloqueado_ate) > new Date(), 'bloqueio após 5 tentativas (RNF-05)');

console.log(`\n${passed} passaram, ${failed} falharam`);
process.exit(failed ? 1 : 0);
