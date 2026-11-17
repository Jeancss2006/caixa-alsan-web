import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { q, rpc, supabase } from '../lib/supabase';
import { limitesPeriodo } from '../lib/caixa';
import { brl, dataHora, FORMAS, hojeISO } from '../lib/format';
import { Badge, Cabecalho, Campo, Carregando, Modal, MotivoModal, useCarregar, useToast, Vazio } from '../components/ui';

/** Vendas realizadas, detalhe, reimpressão e cancelamento (RF-37, RN-21) */
export function Vendas() {
  const { pode } = useAuth();
  const toast = useToast();
  const [filtro, setFiltro] = useState({ inicio: hojeISO(), fim: hojeISO(), status: '' });
  const [detalhe, setDetalhe] = useState<number | null>(null);
  const [cancelar, setCancelar] = useState<any>(null);

  const vendas = useCarregar(async () => {
    const { de, ate } = limitesPeriodo(filtro.inicio, filtro.fim);
    let qy = supabase
      .from('vendas')
      .select('*, cliente:clientes(nome), operador:usuarios!operador_id(nome)')
      .gte('data_hora', de)
      .lt('data_hora', ate)
      .order('id', { ascending: false });
    if (filtro.status) qy = qy.eq('status', filtro.status);
    return q<any[]>(qy);
  }, [JSON.stringify(filtro)]);

  const det = useCarregar(async () => {
    if (!detalhe) return null;
    const [venda, itens, pags] = await Promise.all([
      q<any>(supabase.from('vendas').select('*, cliente:clientes(nome), operador:usuarios!operador_id(nome)').eq('id', detalhe).single()),
      q<any[]>(supabase.from('itens_venda').select('*, produto:produtos(descricao, codigo)').eq('venda_id', detalhe)),
      q<any[]>(supabase.from('pagamentos').select('*').eq('venda_id', detalhe)),
    ]);
    return { venda, itens, pags };
  }, [detalhe]);

  return (
    <>
      <Cabecalho titulo="Vendas realizadas" />
      <div className="filtros">
        <Campo rotulo="De">
          <input type="date" value={filtro.inicio} onChange={(e) => setFiltro({ ...filtro, inicio: e.target.value })} />
        </Campo>
        <Campo rotulo="Até">
          <input type="date" value={filtro.fim} onChange={(e) => setFiltro({ ...filtro, fim: e.target.value })} />
        </Campo>
        <Campo rotulo="Situação">
          <select value={filtro.status} onChange={(e) => setFiltro({ ...filtro, status: e.target.value })}>
            <option value="">Todas</option>
            <option value="CONCLUIDA">Concluídas</option>
            <option value="CANCELADA">Canceladas</option>
          </select>
        </Campo>
      </div>
      <section className="painel">
        {vendas.carregando ? (
          <Carregando />
        ) : !vendas.dados?.length ? (
          <Vazio>Nenhuma venda no período.</Vazio>
        ) : (
          <div className="rolagem">
            <table className="tabela clicavel">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Data/hora</th>
                  <th>Cliente</th>
                  <th>Operador</th>
                  <th className="num">Desconto</th>
                  <th className="num">Total</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {vendas.dados.map((v) => (
                  <tr key={v.id} onClick={() => setDetalhe(v.id)} className={v.status === 'CANCELADA' ? 'riscado' : ''}>
                    <td>{v.id}</td>
                    <td>{dataHora(v.data_hora)}</td>
                    <td>{v.cliente?.nome ?? <span className="muted">—</span>}</td>
                    <td>{v.operador?.nome}</td>
                    <td className="num">{Number(v.desconto) ? brl(v.desconto) : ''}</td>
                    <td className="num">{brl(v.valor_total)}</td>
                    <td>
                      <Badge cor={v.status === 'CANCELADA' ? 'vermelho' : 'verde'}>{v.status === 'CANCELADA' ? 'Cancelada' : 'Concluída'}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal
        aberto={!!detalhe}
        titulo={`Venda #${detalhe ?? ''}`}
        onFechar={() => setDetalhe(null)}
        largura={640}
        rodape={
          det.dados && (
            <>
              <a className="btn" href={`/imprimir/venda/${detalhe}`} target="_blank" rel="noreferrer">
                Reimprimir comprovante
              </a>
              {pode() && det.dados.venda.status === 'CONCLUIDA' && (
                <button className="btn perigo" onClick={() => setCancelar(det.dados!.venda)}>
                  Cancelar venda
                </button>
              )}
            </>
          )
        }
      >
        {!det.dados ? (
          <Carregando />
        ) : (
          <>
            <p className="muted">
              {dataHora(det.dados.venda.data_hora)} · {det.dados.venda.operador?.nome}
              {det.dados.venda.cliente && ` · Cliente: ${det.dados.venda.cliente.nome}`}
            </p>
            {det.dados.venda.status === 'CANCELADA' && (
              <p className="aviso">
                Cancelada em {dataHora(det.dados.venda.cancelada_em)} — {det.dados.venda.motivo_cancelamento}
              </p>
            )}
            <table className="tabela compacta">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th className="num">Qtd.</th>
                  <th className="num">Unit.</th>
                  <th className="num">Desc.</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {det.dados.itens.map((i) => (
                  <tr key={i.id}>
                    <td>{i.produto?.descricao}</td>
                    <td className="num">{i.quantidade}</td>
                    <td className="num">{brl(i.preco_unitario)}</td>
                    <td className="num">{Number(i.desconto) ? brl(i.desconto) : ''}</td>
                    <td className="num">{brl(i.quantidade * i.preco_unitario - i.desconto)}</td>
                  </tr>
                ))}
                <tr className="forte">
                  <td colSpan={4}>Total</td>
                  <td className="num">{brl(det.dados.venda.valor_total)}</td>
                </tr>
              </tbody>
            </table>
            <h4>Pagamentos</h4>
            <ul className="lista-simples">
              {det.dados.pags.map((p) => (
                <li key={p.id}>
                  {FORMAS[p.forma]}: {brl(p.valor)}
                  {p.troco > 0 && ` (recebido ${brl(p.valor_recebido)}, troco ${brl(p.troco)})`}
                  {p.parcelas > 1 && ` em ${p.parcelas}x`}
                  {p.bandeira && ` · ${p.bandeira}`}
                </li>
              ))}
            </ul>
          </>
        )}
      </Modal>

      <MotivoModal
        aberto={!!cancelar}
        titulo={`Cancelar venda #${cancelar?.id ?? ''}`}
        descricao={`Os produtos voltam ao estoque e o valor de ${brl(cancelar?.valor_total)} é estornado no caixa (RN-21).`}
        textoBotao="Cancelar venda"
        onFechar={() => setCancelar(null)}
        onConfirmar={async (motivo) => {
          await rpc('cancelar_venda', { p_id: cancelar.id, p_motivo: motivo });
          toast.ok('Venda cancelada.');
          det.recarregar();
          vendas.recarregar();
        }}
      />
    </>
  );
}
