import { useState } from 'react';
import { q, rpc, supabase } from '../lib/supabase';
import { limitesPeriodo } from '../lib/caixa';
import { brl, data, dataHora, hojeISO, inicioDoMes } from '../lib/format';
import { Cabecalho, Campo, Carregando, useCarregar, Vazio } from '../components/ui';

type Aba = 'financeiro' | 'fechamento' | 'vendas' | 'estoque';
const ABAS: [Aba, string][] = [
  ['financeiro', 'Financeiro por categoria'],
  ['fechamento', 'Fechamento de caixa'],
  ['vendas', 'Vendas e serviços'],
  ['estoque', 'Posição de estoque'],
];

/** Relatórios do administrador (RF-48..RF-51, UC-27) */
export function Relatorios() {
  const [aba, setAba] = useState<Aba>('financeiro');
  const [periodo, setPeriodo] = useState({ inicio: inicioDoMes(), fim: hojeISO() });

  return (
    <>
      <Cabecalho titulo="Relatórios">
        <button className="btn" onClick={() => window.print()}>
          Imprimir
        </button>
      </Cabecalho>
      <div className="abas nao-imprimir">
        {ABAS.map(([k, v]) => (
          <button key={k} className={aba === k ? 'on' : ''} onClick={() => setAba(k)}>
            {v}
          </button>
        ))}
      </div>
      {aba !== 'estoque' && (
        <div className="filtros">
          <Campo rotulo="De">
            <input type="date" value={periodo.inicio} onChange={(e) => setPeriodo({ ...periodo, inicio: e.target.value })} />
          </Campo>
          <Campo rotulo="Até">
            <input type="date" value={periodo.fim} onChange={(e) => setPeriodo({ ...periodo, fim: e.target.value })} />
          </Campo>
          <span className="so-imprimir">
            Período: {data(periodo.inicio)} a {data(periodo.fim)}
          </span>
        </div>
      )}
      {aba === 'financeiro' && <Financeiro {...periodo} />}
      {aba === 'fechamento' && <Fechamentos {...periodo} />}
      {aba === 'vendas' && <VendasServicos {...periodo} />}
      {aba === 'estoque' && <PosicaoEstoque />}
    </>
  );
}

function Financeiro({ inicio, fim }: { inicio: string; fim: string }) {
  const r = useCarregar(() => rpc<any[]>('relatorio_financeiro_categoria', { p_inicio: inicio, p_fim: fim }), [inicio, fim]);
  if (r.carregando) return <Carregando />;
  if (r.erro) return <Vazio>{r.erro}</Vazio>;
  const ent = (r.dados ?? []).filter((x) => x.tipo === 'ENTRADA');
  const sai = (r.dados ?? []).filter((x) => x.tipo === 'SAIDA');
  const tot = (l: any[]) => l.reduce((s, x) => s + Number(x.total), 0);
  const bloco = (titulo: string, l: any[], classe: string) => {
    const t = tot(l);
    return (
      <section className="painel">
        <h2>{titulo}</h2>
        {!l.length && <p className="muted">Sem lançamentos.</p>}
        <table className="tabela">
          <tbody>
            {l.map((x) => (
              <tr key={x.categoria}>
                <td>
                  {x.categoria}
                  <div className="barra">
                    <div className={classe} style={{ width: t ? `${Math.max(0, (Number(x.total) / t) * 100)}%` : 0 }} />
                  </div>
                </td>
                <td className="num muted">{x.quantidade}×</td>
                <td className="num">{brl(x.total)}</td>
                <td className="num muted">{t ? ((Number(x.total) / t) * 100).toFixed(1) : 0}%</td>
              </tr>
            ))}
            <tr className="forte">
              <td colSpan={2}>Total</td>
              <td className="num">{brl(t)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </section>
    );
  };
  return (
    <>
      <div className="cards">
        <div className="card ok">
          <span>Entradas</span>
          <strong>{brl(tot(ent))}</strong>
        </div>
        <div className="card">
          <span>Saídas</span>
          <strong>{brl(tot(sai))}</strong>
        </div>
        <div className="card destaque">
          <span>Resultado</span>
          <strong>{brl(tot(ent) - tot(sai))}</strong>
        </div>
      </div>
      <p className="muted pequeno">Estornos são abatidos da categoria do lançamento original.</p>
      <div className="duas-colunas">
        {bloco('Origem do dinheiro (entradas)', ent, 'barra-ent')}
        {bloco('Destino do dinheiro (saídas)', sai, 'barra-sai')}
      </div>
    </>
  );
}

function Fechamentos({ inicio, fim }: { inicio: string; fim: string }) {
  const r = useCarregar(async () => {
    const { de, ate } = limitesPeriodo(inicio, fim);
    return q<any[]>(
      supabase
        .from('caixas')
        .select('*, operador:usuarios!operador_id(nome)')
        .gte('data_abertura', de)
        .lt('data_abertura', ate)
        .order('id', { ascending: false }),
    );
  }, [inicio, fim]);
  if (r.carregando) return <Carregando />;
  if (!r.dados?.length) return <Vazio>Nenhum caixa no período.</Vazio>;
  return (
    <section className="painel">
      <table className="tabela">
        <thead>
          <tr>
            <th>#</th>
            <th>Operador</th>
            <th>Abertura</th>
            <th>Fechamento</th>
            <th className="num">Saldo inicial</th>
            <th className="num">Esperado</th>
            <th className="num">Contado</th>
            <th className="num">Diferença</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {r.dados.map((c) => (
            <tr key={c.id}>
              <td>{c.id}</td>
              <td>{c.operador?.nome}</td>
              <td>{dataHora(c.data_abertura)}</td>
              <td>{c.status === 'ABERTO' ? <span className="txt-alerta">aberto</span> : dataHora(c.data_fechamento)}</td>
              <td className="num">{brl(c.saldo_inicial)}</td>
              <td className="num">{c.saldo_esperado !== null ? brl(c.saldo_esperado) : '—'}</td>
              <td className="num">{c.valor_contado !== null ? brl(c.valor_contado) : '—'}</td>
              <td className={'num ' + (Number(c.diferenca) ? 'txt-alerta' : '')}>{c.diferenca !== null ? brl(c.diferenca) : '—'}</td>
              <td>
                <a className="link" href={`/imprimir/fechamento/${c.id}`} target="_blank" rel="noreferrer">
                  Relatório
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function VendasServicos({ inicio, fim }: { inicio: string; fim: string }) {
  const r = useCarregar(() => rpc<any>('relatorio_vendas_servicos', { p_inicio: inicio, p_fim: fim }), [inicio, fim]);
  if (r.carregando) return <Carregando />;
  if (r.erro) return <Vazio>{r.erro}</Vazio>;
  if (!r.dados) return <Vazio>Sem dados para o período.</Vazio>;
  const d = r.dados;
  return (
    <>
      <div className="cards">
        <div className="card">
          <span>Vendas concluídas</span>
          <strong>{d.vendas_quantidade}</strong>
          <small>{brl(d.vendas_total)}</small>
        </div>
        <div className="card">
          <span>OS finalizadas</span>
          <strong>{d.os_quantidade}</strong>
          <small>{brl(d.os_total)}</small>
        </div>
        <div className="card destaque">
          <span>Faturamento total</span>
          <strong>{brl(Number(d.vendas_total) + Number(d.os_total))}</strong>
        </div>
      </div>
      <div className="duas-colunas">
        <section className="painel">
          <h2>Vendas de balcão</h2>
          <table className="tabela">
            <tbody>
              <tr>
                <td>Quantidade</td>
                <td className="num">{d.vendas_quantidade}</td>
              </tr>
              <tr>
                <td>Descontos concedidos</td>
                <td className="num">{brl(d.vendas_descontos)}</td>
              </tr>
              <tr>
                <td>Ticket médio</td>
                <td className="num">{brl(d.vendas_quantidade ? d.vendas_total / d.vendas_quantidade : 0)}</td>
              </tr>
              <tr>
                <td>Canceladas</td>
                <td className="num">
                  {d.vendas_canceladas} ({brl(d.vendas_canceladas_total)})
                </td>
              </tr>
              <tr className="forte">
                <td>Total</td>
                <td className="num">{brl(d.vendas_total)}</td>
              </tr>
            </tbody>
          </table>
        </section>
        <section className="painel">
          <h2>Ordens de serviço finalizadas</h2>
          <table className="tabela">
            <tbody>
              <tr>
                <td>Quantidade</td>
                <td className="num">{d.os_quantidade}</td>
              </tr>
              <tr>
                <td>Mão de obra</td>
                <td className="num">{brl(d.os_mao_de_obra)}</td>
              </tr>
              <tr>
                <td>Produtos utilizados</td>
                <td className="num">{brl(d.os_produtos)}</td>
              </tr>
              <tr>
                <td>Descontos</td>
                <td className="num">{brl(d.os_descontos)}</td>
              </tr>
              <tr className="forte">
                <td>Total</td>
                <td className="num">{brl(d.os_total)}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}

function PosicaoEstoque() {
  const r = useCarregar(() =>
    q<any[]>(
      supabase
        .from('produtos')
        .select('id, codigo, descricao, quantidade_estoque, estoque_minimo, preco_custo, preco_venda, categoria:categorias_produto(nome)')
        .eq('ativo', true)
        .order('descricao'),
    ),
  );
  if (r.carregando) return <Carregando />;
  const lista = r.dados ?? [];
  const valorCusto = lista.reduce((s, p) => s + p.quantidade_estoque * Number(p.preco_custo), 0);
  const valorVenda = lista.reduce((s, p) => s + p.quantidade_estoque * Number(p.preco_venda), 0);
  const abaixo = lista.filter((p) => p.quantidade_estoque <= p.estoque_minimo);
  return (
    <>
      <div className="cards">
        <div className="card">
          <span>Produtos ativos</span>
          <strong>{lista.length}</strong>
        </div>
        <div className="card destaque">
          <span>Valor em estoque (custo)</span>
          <strong>{brl(valorCusto)}</strong>
        </div>
        <div className="card">
          <span>Valor em estoque (venda)</span>
          <strong>{brl(valorVenda)}</strong>
        </div>
        <div className={'card ' + (abaixo.length ? 'alerta' : 'ok')}>
          <span>Abaixo do mínimo</span>
          <strong>{abaixo.length}</strong>
        </div>
      </div>
      {!!abaixo.length && (
        <section className="painel">
          <h2>Produtos abaixo do estoque mínimo</h2>
          <table className="tabela compacta">
            <thead>
              <tr>
                <th>Código</th>
                <th>Descrição</th>
                <th className="num">Estoque</th>
                <th className="num">Mínimo</th>
                <th className="num">Repor</th>
              </tr>
            </thead>
            <tbody>
              {abaixo.map((p) => (
                <tr key={p.id} className="linha-alerta">
                  <td>{p.codigo}</td>
                  <td>{p.descricao}</td>
                  <td className="num">{p.quantidade_estoque}</td>
                  <td className="num">{p.estoque_minimo}</td>
                  <td className="num">{Math.max(p.estoque_minimo - p.quantidade_estoque, 0) || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <section className="painel">
        <h2>Posição atual</h2>
        <table className="tabela compacta">
          <thead>
            <tr>
              <th>Código</th>
              <th>Descrição</th>
              <th>Categoria</th>
              <th className="num">Qtd.</th>
              <th className="num">Custo médio</th>
              <th className="num">Valor (custo)</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((p) => (
              <tr key={p.id}>
                <td>{p.codigo}</td>
                <td>{p.descricao}</td>
                <td>{p.categoria?.nome}</td>
                <td className="num">{p.quantidade_estoque}</td>
                <td className="num">{brl(p.preco_custo)}</td>
                <td className="num">{brl(p.quantidade_estoque * p.preco_custo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
