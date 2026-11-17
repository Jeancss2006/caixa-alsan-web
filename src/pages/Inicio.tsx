import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { q, supabase } from '../lib/supabase';
import { useMeuCaixa } from '../lib/caixa';
import { brl, dataHora, STATUS_OS } from '../lib/format';
import { Badge, Cabecalho, corStatusOS, Tecla, useCarregar } from '../components/ui';

export function Inicio() {
  const { usuario, pode } = useAuth();
  const { caixa, deOutroDia } = useMeuCaixa();

  const os = useCarregar(async () => {
    let qy = supabase
      .from('ordens_servico')
      .select('id, numero, status, equipamento, data_abertura, cliente:clientes(nome), tecnico_id')
      .in('status', ['ABERTA', 'EM_MANUTENCAO', 'AGUARDANDO_PECA', 'CONCLUIDA'])
      .order('numero', { ascending: false })
      .limit(200);
    if (usuario?.perfil === 'TECNICO') qy = qy.or(`tecnico_id.eq.${usuario.id},tecnico_id.is.null`);
    return q<any[]>(qy);
  }, [usuario?.id]);

  // RF-15: produtos no estoque mínimo ou abaixo
  const alertas = useCarregar(async () => {
    const lista = await q<any[]>(
      supabase.from('produtos').select('id, codigo, descricao, quantidade_estoque, estoque_minimo').eq('ativo', true).order('descricao'),
    );
    return lista.filter((p) => p.quantidade_estoque <= p.estoque_minimo);
  });

  const contagem = (s: string) => os.dados?.filter((o) => o.status === s).length ?? 0;

  return (
    <>
      <Cabecalho titulo={`Olá, ${usuario?.nome.split(' ')[0]}`} sub="Resumo do dia">
        {pode('OPERADOR') && (
          <Link className="btn primario" to="/venda">
            Nova venda <Tecla>F8</Tecla>
          </Link>
        )}
        <Link className="btn" to="/os/nova">
          Abrir OS
        </Link>
      </Cabecalho>

      <div className="cards">
        {pode('OPERADOR') && (
          <Link to="/caixa" className={'card ' + (caixa ? (deOutroDia ? 'alerta' : 'ok') : 'alerta')}>
            <span>Meu caixa</span>
            <strong>{caixa ? (deOutroDia ? 'Aberto em outro dia' : 'Aberto') : 'Fechado'}</strong>
            <small>{caixa ? `desde ${dataHora(caixa.data_abertura)}` : 'Abra o caixa para vender'}</small>
          </Link>
        )}
        {(['ABERTA', 'EM_MANUTENCAO', 'AGUARDANDO_PECA', 'CONCLUIDA'] as const).map((s) => (
          <Link key={s} to={`/os?status=${s}`} className="card">
            <span>OS – {STATUS_OS[s]}</span>
            <strong>{contagem(s)}</strong>
            <small>{s === 'CONCLUIDA' ? 'aguardando retirada' : usuario?.perfil === 'TECNICO' ? 'suas ou sem técnico' : 'em andamento'}</small>
          </Link>
        ))}
      </div>

      <div className="duas-colunas">
        <section className="painel">
          <h2>Estoque mínimo</h2>
          {alertas.dados?.length === 0 && <p className="muted">Nenhum produto abaixo do estoque mínimo.</p>}
          <table className="tabela compacta">
            <tbody>
              {alertas.dados?.slice(0, 12).map((p) => (
                <tr key={p.id} className="linha-alerta">
                  <td>
                    {p.descricao} <small className="muted">{p.codigo}</small>
                  </td>
                  <td className="num">
                    {p.quantidade_estoque} / mín. {p.estoque_minimo}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(alertas.dados?.length ?? 0) > 12 && (
            <Link to="/estoque?minimo=1" className="link">
              Ver todos ({alertas.dados?.length})
            </Link>
          )}
        </section>
        <section className="painel">
          <h2>Ordens de serviço recentes</h2>
          <table className="tabela compacta">
            <tbody>
              {os.dados?.slice(0, 10).map((o) => (
                <tr key={o.id}>
                  <td className="nowrap">
                    <Link to={`/os/${o.id}`} className="link">
                      nº {o.numero}
                    </Link>
                  </td>
                  <td>
                    {o.equipamento}
                    <br />
                    <small className="muted">{o.cliente?.nome}</small>
                  </td>
                  <td>
                    <Badge cor={corStatusOS[o.status]}>{STATUS_OS[o.status]}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {os.dados?.length === 0 && <p className="muted">Nenhuma OS em andamento.</p>}
        </section>
      </div>
      {pode('OPERADOR') && caixa && <p className="muted pequeno">Saldo inicial do caixa: {brl(caixa.saldo_inicial)}</p>}
    </>
  );
}
