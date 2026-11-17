import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { q, rpc, supabase } from '../lib/supabase';
import { useMeuCaixa } from '../lib/caixa';
import { brl, centavos, dataHora, data, FORMAS, lerValor, reais, STATUS_OS, valorParaCampo } from '../lib/format';
import { GARANTIA_DIAS } from '../config';
import { ProdutoBusca, type ProdutoResumo } from '../components/ProdutoBusca';
import { DescontoCampo, PagamentoModal, useAutorizacao, type PagamentoEnvio } from '../components/Pagamento';
import { Badge, Cabecalho, Campo, CampoValor, Carregando, corStatusOS, Modal, MotivoModal, useCarregar, useToast } from '../components/ui';

const EDITAVEL = ['ABERTA', 'EM_MANUTENCAO', 'AGUARDANDO_PECA'];
const PROXIMOS: Record<string, string[]> = {
  ABERTA: ['EM_MANUTENCAO'],
  EM_MANUTENCAO: ['AGUARDANDO_PECA', 'CONCLUIDA'],
  AGUARDANDO_PECA: ['EM_MANUTENCAO'],
};

export function OSDetalhe() {
  const { id } = useParams();
  const { pode } = useAuth();
  const toast = useToast();
  const os = useCarregar(async () => {
    const [o, itens, pags, filhas] = await Promise.all([
      q<any>(
        supabase
          .from('ordens_servico')
          .select('*, cliente:clientes(*), tecnico:usuarios!tecnico_id(nome), aberta:usuarios!aberta_por(nome), original:ordens_servico!garantia_de_id(numero)')
          .eq('id', id)
          .single(),
      ),
      q<any[]>(supabase.from('itens_os').select('*, produto:produtos(descricao, codigo)').eq('os_id', id).order('id')),
      pode('OPERADOR') ? q<any[]>(supabase.from('pagamentos').select('*').eq('os_id', id)) : Promise.resolve([]),
      q<any[]>(supabase.from('ordens_servico').select('id, numero, status').eq('garantia_de_id', id)),
    ]);
    return { o, itens, pags, filhas };
  }, [id]);
  const tecnicos = useCarregar(() =>
    q<any[]>(supabase.from('usuarios').select('id, nome').eq('ativo', true).in('perfil', ['TECNICO', 'ADMINISTRADOR']).order('nome')),
  );

  const [servico, setServico] = useState({ diagnostico: '', servico: '', mao: '' });
  const [qtd, setQtd] = useState('1');
  const [cancelar, setCancelar] = useState(false);
  const [finalizar, setFinalizar] = useState(false);

  const o = os.dados?.o;
  useEffect(() => {
    if (o) setServico({ diagnostico: o.diagnostico ?? '', servico: o.servico_executado ?? '', mao: valorParaCampo(o.valor_mao_de_obra) });
  }, [o?.id, o?.diagnostico, o?.servico_executado, o?.valor_mao_de_obra]);

  if (os.carregando && !os.dados) return <Carregando />;
  if (!o) return <div className="vazio">{os.erro ?? 'OS não encontrada.'}</div>;

  const editavel = EDITAVEL.includes(o.status);
  const itens = os.dados!.itens;
  const totalItens = itens.reduce((s, i) => s + centavos(i.preco_unitario) * i.quantidade, 0);
  const garantiaAte = o.data_entrega ? new Date(new Date(o.data_entrega).getTime() + GARANTIA_DIAS * 86400000) : null;
  const emGarantia = !!garantiaAte && garantiaAte > new Date();

  const acao = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast.ok(msg);
      os.recarregar();
    } catch (e) {
      toast.erro(e);
    }
  };

  async function adicionarProduto(p: ProdutoResumo) {
    const n = parseInt(qtd) || 1;
    await acao(() => rpc('os_adicionar_produto', { p_os: o.id, p_produto_id: p.id, p_quantidade: n }), `${p.descricao} adicionado.`);
    setQtd('1');
  }

  async function salvarServico() {
    const mao = servico.mao ? lerValor(servico.mao) : 0;
    if (isNaN(mao)) return toast.erro('Valor de mão de obra inválido.');
    await acao(
      () =>
        rpc('os_registrar_servico', {
          p_os: o.id,
          p_diagnostico: servico.diagnostico,
          p_servico_executado: servico.servico,
          p_valor_mao_de_obra: mao,
        }),
      'Diagnóstico e serviço salvos.',
    );
  }

  return (
    <>
      <Cabecalho
        titulo={`OS nº ${o.numero}`}
        sub={
          <>
            <Badge cor={corStatusOS[o.status]}>{STATUS_OS[o.status]}</Badge> Aberta em {dataHora(o.data_abertura)} por {o.aberta?.nome}
            {o.original && (
              <>
                {' · '}
                <Link className="link" to={`/os/${o.garantia_de_id}`}>
                  garantia da OS nº {o.original.numero}
                </Link>
              </>
            )}
          </>
        }
      >
        <a className="btn" href={`/imprimir/os-entrada/${o.id}`} target="_blank" rel="noreferrer">
          Comprovante de entrada
        </a>
        {o.status === 'ENTREGUE' && (
          <a className="btn" href={`/imprimir/os-entrega/${o.id}`} target="_blank" rel="noreferrer">
            Comprovante de entrega
          </a>
        )}
        {editavel && pode('OPERADOR') && (
          <button className="btn perigo" onClick={() => setCancelar(true)}>
            Cancelar OS
          </button>
        )}
        {o.status === 'CONCLUIDA' && pode('OPERADOR') && (
          <button className="btn primario" onClick={() => setFinalizar(true)}>
            Receber e entregar
          </button>
        )}
      </Cabecalho>

      {o.status === 'CANCELADA' && <p className="aviso">Cancelada: {o.motivo_cancelamento}</p>}
      {o.status === 'ENTREGUE' && (
        <p className={emGarantia ? 'info' : 'muted'}>
          Entregue em {dataHora(o.data_entrega)}.{' '}
          {emGarantia ? `Serviço em garantia até ${data(garantiaAte)}.` : `Garantia encerrada em ${data(garantiaAte)}.`}{' '}
          {emGarantia && (
            <Link className="link" to={`/os/nova?garantia=${o.id}`}>
              Abrir OS de garantia
            </Link>
          )}
        </p>
      )}

      <div className="duas-colunas">
        <section className="painel">
          <h2>Atendimento</h2>
          <dl className="dados">
            <dt>Cliente</dt>
            <dd>
              {o.cliente?.nome} <small className="muted">{o.cliente?.telefone}</small>
            </dd>
            <dt>Equipamento</dt>
            <dd>{o.equipamento}</dd>
            <dt>Defeito relatado</dt>
            <dd>{o.defeito_relatado}</dd>
            <dt>Acessórios</dt>
            <dd>{o.acessorios || '—'}</dd>
            <dt>Técnico</dt>
            <dd>
              {editavel && pode('OPERADOR', 'TECNICO') ? (
                <select
                  value={o.tecnico_id ?? ''}
                  onChange={(e) =>
                    acao(() => rpc('os_atribuir_tecnico', { p_os: o.id, p_tecnico_id: e.target.value || null }), 'Técnico atribuído.')
                  }
                >
                  <option value="">— sem técnico —</option>
                  {tecnicos.dados?.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nome}
                    </option>
                  ))}
                </select>
              ) : (
                o.tecnico?.nome ?? '—'
              )}
            </dd>
          </dl>
          {PROXIMOS[o.status] && pode('OPERADOR', 'TECNICO') && (
            <div className="status-acoes">
              <span className="muted">Atualizar status:</span>
              {PROXIMOS[o.status].map((s) => (
                <button
                  key={s}
                  className={'btn ' + (s === 'CONCLUIDA' ? 'primario' : '')}
                  onClick={() => acao(() => rpc('os_atualizar_status', { p_os: o.id, p_status: s }), `Status: ${STATUS_OS[s]}.`)}
                >
                  {STATUS_OS[s]}
                </button>
              ))}
            </div>
          )}
          {!!os.dados!.filhas.length && (
            <p className="muted pequeno">
              OS de garantia vinculadas:{' '}
              {os.dados!.filhas.map((f) => (
                <Link key={f.id} className="link" to={`/os/${f.id}`}>
                  nº {f.numero}{' '}
                </Link>
              ))}
            </p>
          )}
        </section>

        <section className="painel">
          <h2>Diagnóstico e serviço</h2>
          {editavel && pode('TECNICO') ? (
            <>
              <Campo rotulo="Diagnóstico">
                <textarea rows={3} value={servico.diagnostico} onChange={(e) => setServico({ ...servico, diagnostico: e.target.value })} />
              </Campo>
              <Campo rotulo="Serviço executado">
                <textarea rows={3} value={servico.servico} onChange={(e) => setServico({ ...servico, servico: e.target.value })} />
              </Campo>
              <Campo rotulo="Mão de obra" dica={o.garantia_de_id ? 'OS de garantia: sem cobrança de mão de obra (RN-14).' : undefined}>
                <CampoValor valor={servico.mao} onChange={(v) => setServico({ ...servico, mao: v })} />
              </Campo>
              <button className="btn primario" onClick={salvarServico}>
                Salvar
              </button>
            </>
          ) : (
            <dl className="dados">
              <dt>Diagnóstico</dt>
              <dd>{o.diagnostico || '—'}</dd>
              <dt>Serviço executado</dt>
              <dd>{o.servico_executado || '—'}</dd>
              <dt>Mão de obra</dt>
              <dd>{brl(o.valor_mao_de_obra)}</dd>
            </dl>
          )}
        </section>
      </div>

      <section className="painel">
        <h2>Produtos utilizados</h2>
        {editavel && pode('TECNICO', 'OPERADOR') && (
          <div className="linha-busca">
            <input className="qtd-campo" value={qtd} inputMode="numeric" onChange={(e) => setQtd(e.target.value.replace(/\D/g, ''))} aria-label="Quantidade" />
            <ProdutoBusca onSelecionar={adicionarProduto} placeholder="Adicionar produto: código, código de barras ou nome" />
          </div>
        )}
        <table className="tabela">
          <thead>
            <tr>
              <th>Produto</th>
              <th className="num">Qtd.</th>
              <th className="num">Unitário</th>
              <th className="num">Subtotal</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {itens.map((i) => (
              <tr key={i.id}>
                <td>
                  {i.produto?.descricao} <small className="muted">{i.produto?.codigo}</small>
                </td>
                <td className="num">{i.quantidade}</td>
                <td className="num">{brl(i.preco_unitario)}</td>
                <td className="num">{brl(i.quantidade * i.preco_unitario)}</td>
                <td>
                  {editavel && pode('TECNICO', 'OPERADOR') && (
                    <button
                      className="btn pequeno"
                      onClick={() => acao(() => rpc('os_remover_produto', { p_item_id: i.id }), 'Produto removido e devolvido ao estoque.')}
                    >
                      Remover
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!itens.length && (
              <tr>
                <td colSpan={5} className="muted">
                  Nenhum produto utilizado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="totais-os">
          <div>
            <span>Produtos</span>
            <strong>{brl(reais(totalItens))}</strong>
          </div>
          <div>
            <span>Mão de obra</span>
            <strong>{brl(o.valor_mao_de_obra)}</strong>
          </div>
          {Number(o.desconto) > 0 && (
            <div>
              <span>Desconto</span>
              <strong>− {brl(o.desconto)}</strong>
            </div>
          )}
          <div className="grande">
            <span>Total</span>
            <strong>{brl(o.valor_total)}</strong>
          </div>
        </div>
        {!!os.dados!.pags.length && (
          <p className="muted pequeno">
            Pagamentos:{' '}
            {os.dados!.pags.map((p) => `${FORMAS[p.forma]} ${brl(p.valor)}${p.parcelas > 1 ? ` (${p.parcelas}x)` : ''}`).join(' · ')}
          </p>
        )}
      </section>

      <MotivoModal
        aberto={cancelar}
        titulo={`Cancelar OS nº ${o.numero}`}
        descricao="Os produtos vinculados voltam ao estoque. O número da OS não será reaproveitado (RN-09, RN-12)."
        textoBotao="Cancelar OS"
        onFechar={() => setCancelar(false)}
        onConfirmar={async (motivo) => {
          await rpc('os_cancelar', { p_os: o.id, p_motivo: motivo });
          toast.ok('OS cancelada.');
          os.recarregar();
        }}
      />
      <FinalizarOS
        aberto={finalizar}
        os={o}
        brutoCentavos={totalItens + centavos(o.valor_mao_de_obra)}
        onFechar={() => setFinalizar(false)}
        onFinalizado={() => {
          setFinalizar(false);
          os.recarregar();
          window.open(`/imprimir/os-entrega/${o.id}`, '_blank');
        }}
      />
    </>
  );
}

/** Finalizar OS com recebimento (RF-32, UC-16, RN-13) */
function FinalizarOS({
  aberto,
  os,
  brutoCentavos,
  onFechar,
  onFinalizado,
}: {
  aberto: boolean;
  os: any;
  brutoCentavos: number;
  onFechar: () => void;
  onFinalizado: () => void;
}) {
  const { caixa, deOutroDia } = useMeuCaixa();
  const [desconto, setDesconto] = useState(0);
  const [pagando, setPagando] = useState(false);
  const { executar, modal } = useAutorizacao();
  const toast = useToast();
  const total = brutoCentavos - desconto;

  async function concluir(pagamentos: PagamentoEnvio[]) {
    await executar(async (token) => {
      await rpc('os_finalizar', { p_os: os.id, p_pagamentos: pagamentos, p_desconto: reais(desconto), p_autorizacao: token ?? null });
      toast.ok(`OS nº ${os.numero} entregue.`);
      setPagando(false);
      onFinalizado();
    });
  }

  return (
    <>
      <Modal
        aberto={aberto && !pagando}
        titulo={`Receber e entregar OS nº ${os.numero}`}
        onFechar={onFechar}
        rodape={
          <>
            <button className="btn" onClick={onFechar}>
              Cancelar
            </button>
            <button
              className="btn primario"
              disabled={!caixa || deOutroDia}
              onClick={() =>
                total > 0 ? setPagando(true) : concluir([]).catch((e) => toast.erro(e))
              }
            >
              {total > 0 ? 'Receber pagamento' : 'Entregar (sem valor a receber)'}
            </button>
          </>
        }
      >
        {(!caixa || deOutroDia) && <p className="aviso">Abra o caixa de hoje para receber o pagamento (RN-01).</p>}
        <div className="linha-total">
          <span>Produtos + mão de obra</span>
          <span>{brl(reais(brutoCentavos))}</span>
        </div>
        <Campo rotulo="Desconto">
          <DescontoCampo brutoCentavos={brutoCentavos} onChange={setDesconto} />
        </Campo>
        <div className="linha-total grande">
          <span>Total a receber</span>
          <strong>{brl(reais(total))}</strong>
        </div>
      </Modal>
      <PagamentoModal
        aberto={pagando}
        titulo={`Pagamento da OS nº ${os.numero}`}
        totalCentavos={total}
        onFechar={() => setPagando(false)}
        onConfirmar={concluir}
      />
      {modal}
    </>
  );
}
