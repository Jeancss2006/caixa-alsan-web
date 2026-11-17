import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { q, rpc, supabase } from '../lib/supabase';
import { brl, dataHora } from '../lib/format';
import { Badge, Cabecalho, Campo, Carregando, Modal, useCarregar, useToast, Vazio } from '../components/ui';

/** Consultar estoque (RF-14), alerta de mínimo (RF-15), ajuste (RF-13) e histórico (RF-16) */
export function Estoque() {
  const { pode } = useAuth();
  const [params] = useSearchParams();
  const [busca, setBusca] = useState('');
  const [categoria, setCategoria] = useState('');
  const [soMinimo, setSoMinimo] = useState(params.get('minimo') === '1');
  const [ajuste, setAjuste] = useState<any>(null);
  const [historico, setHistorico] = useState<any>(null);

  const categorias = useCarregar(() => q<any[]>(supabase.from('categorias_produto').select('id, nome').order('nome')));
  const lista = useCarregar(async () => {
    const s = busca.replace(/[,()%*]/g, ' ').trim();
    let qy = supabase
      .from('produtos')
      .select('id, codigo, codigo_barras, descricao, unidade, preco_venda, preco_custo, quantidade_estoque, estoque_minimo, ativo, categoria:categorias_produto(nome)')
      .eq('ativo', true)
      .order('descricao')
      .limit(500);
    if (s) qy = qy.or(`descricao.ilike.*${s}*,codigo.ilike.*${s}*,codigo_barras.eq.${s}`);
    if (categoria) qy = qy.eq('categoria_id', categoria);
    const r = await q<any[]>(qy);
    return soMinimo ? r.filter((p) => p.quantidade_estoque <= p.estoque_minimo) : r;
  }, [busca, categoria, soMinimo]);

  return (
    <>
      <Cabecalho titulo="Estoque" sub="Quantidade disponível por produto. Linhas destacadas estão no estoque mínimo ou abaixo." />
      <div className="filtros">
        <input
          className="busca-grande"
          autoFocus
          placeholder="Nome, código ou código de barras"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
          <option value="">Todas as categorias</option>
          {categorias.dados?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={soMinimo} onChange={(e) => setSoMinimo(e.target.checked)} /> Somente abaixo do mínimo
        </label>
      </div>
      <section className="painel">
        {lista.carregando ? (
          <Carregando />
        ) : !lista.dados?.length ? (
          <Vazio>Nenhum produto encontrado.</Vazio>
        ) : (
          <div className="rolagem">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descrição</th>
                  <th>Categoria</th>
                  <th className="num">Preço</th>
                  <th className="num">Estoque</th>
                  <th className="num">Mínimo</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lista.dados.map((p) => {
                  const baixo = p.quantidade_estoque <= p.estoque_minimo;
                  return (
                    <tr key={p.id} className={baixo ? 'linha-alerta' : ''}>
                      <td>
                        {p.codigo}
                        <br />
                        <small className="muted">{p.codigo_barras}</small>
                      </td>
                      <td>
                        {p.descricao} {baixo && <Badge cor="laranja">repor</Badge>}
                      </td>
                      <td>{p.categoria?.nome}</td>
                      <td className="num">{brl(p.preco_venda)}</td>
                      <td className="num forte">
                        {p.quantidade_estoque} <small className="muted">{p.unidade}</small>
                      </td>
                      <td className="num">{p.estoque_minimo}</td>
                      <td className="nowrap">
                        {pode('OPERADOR') && (
                          <button className="btn pequeno" onClick={() => setAjuste(p)}>
                            Ajustar
                          </button>
                        )}{' '}
                        {pode() && (
                          <button className="btn pequeno" onClick={() => setHistorico(p)}>
                            Histórico
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <AjusteModal produto={ajuste} onFechar={() => setAjuste(null)} onSalvo={lista.recarregar} />
      <HistoricoModal produto={historico} onFechar={() => setHistorico(null)} />
    </>
  );
}

const MOTIVOS = ['Perda', 'Avaria', 'Devolução ao fornecedor', 'Uso interno', 'Correção de inventário'];

function AjusteModal({ produto, onFechar, onSalvo }: { produto: any; onFechar: () => void; onSalvo: () => void }) {
  const toast = useToast();
  const [tipo, setTipo] = useState<'-' | '+'>('-');
  const [qtd, setQtd] = useState('1');
  const [motivo, setMotivo] = useState(MOTIVOS[0]);
  const [obs, setObs] = useState('');

  async function salvar() {
    const n = parseInt(qtd);
    if (!n || n <= 0) return toast.erro('Informe a quantidade.');
    try {
      await rpc('ajustar_estoque', {
        p_produto_id: produto.id,
        p_quantidade: tipo === '-' ? -n : n,
        p_motivo: obs.trim() ? `${motivo}: ${obs.trim()}` : motivo,
      });
      toast.ok('Ajuste registrado.');
      onSalvo();
      onFechar();
    } catch (e) {
      toast.erro(e);
    }
  }

  return (
    <Modal
      aberto={!!produto}
      titulo={`Ajuste de estoque – ${produto?.descricao ?? ''}`}
      onFechar={onFechar}
      rodape={
        <>
          <button className="btn" onClick={onFechar}>
            Cancelar
          </button>
          <button className="btn primario" onClick={salvar}>
            Registrar ajuste
          </button>
        </>
      }
    >
      <p className="muted">Estoque atual: {produto?.quantidade_estoque}. O ajuste fica registrado com usuário, data e motivo e não pode ser excluído (RN-06).</p>
      <div className="grade-form duas">
        <Campo rotulo="Tipo">
          <select value={tipo} onChange={(e) => setTipo(e.target.value as '-' | '+')}>
            <option value="-">Retirar do estoque</option>
            <option value="+">Acrescentar ao estoque</option>
          </select>
        </Campo>
        <Campo rotulo="Quantidade">
          <input autoFocus inputMode="numeric" value={qtd} onChange={(e) => setQtd(e.target.value.replace(/\D/g, ''))} />
        </Campo>
        <Campo rotulo="Motivo *">
          <select value={motivo} onChange={(e) => setMotivo(e.target.value)}>
            {MOTIVOS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Observação">
          <input value={obs} onChange={(e) => setObs(e.target.value)} />
        </Campo>
      </div>
    </Modal>
  );
}

function HistoricoModal({ produto, onFechar }: { produto: any; onFechar: () => void }) {
  const movs = useCarregar(
    async () =>
      produto
        ? q<any[]>(
            supabase
              .from('movimentacoes_estoque')
              .select('*, usuario:usuarios(nome)')
              .eq('produto_id', produto.id)
              .order('data_hora', { ascending: false })
              .limit(300),
          )
        : [],
    [produto?.id],
  );
  return (
    <Modal aberto={!!produto} titulo={`Histórico – ${produto?.descricao ?? ''}`} onFechar={onFechar} largura={820}>
      {movs.carregando ? (
        <Carregando />
      ) : !movs.dados?.length ? (
        <Vazio>Sem movimentações.</Vazio>
      ) : (
        <div className="rolagem">
          <table className="tabela compacta">
            <thead>
              <tr>
                <th>Data/hora</th>
                <th>Tipo</th>
                <th>Origem</th>
                <th>Motivo</th>
                <th>Usuário</th>
                <th className="num">Qtd.</th>
                <th className="num">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {movs.dados.map((m) => (
                <tr key={m.id}>
                  <td className="nowrap">{dataHora(m.data_hora)}</td>
                  <td>
                    <Badge cor={m.tipo === 'ENTRADA' ? 'verde' : m.tipo === 'SAIDA' ? 'azul' : 'laranja'}>{m.tipo.toLowerCase()}</Badge>
                  </td>
                  <td>{m.origem}</td>
                  <td>{m.motivo}</td>
                  <td>{m.usuario?.nome}</td>
                  <td className={'num ' + (m.quantidade > 0 ? 'txt-ok' : 'txt-saida')}>{m.quantidade > 0 ? '+' + m.quantidade : m.quantidade}</td>
                  <td className="num">{m.saldo_apos}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
