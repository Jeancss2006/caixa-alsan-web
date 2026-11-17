import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { q, rpc, supabase } from '../lib/supabase';
import { useMeuCaixa } from '../lib/caixa';
import { brl, centavos, dataHora, FORMAS, hojeISO, lerValor, reais } from '../lib/format';
import { Badge, Cabecalho, Campo, CampoValor, Carregando, Modal, Tecla, useAtalhos, useCarregar, useToast } from '../components/ui';

export function Caixa() {
  const { pode, usuario } = useAuth();
  const { caixa, carregando, recarregar, deOutroDia } = useMeuCaixa();
  const [saldoInicial, setSaldoInicial] = useState('');
  const [modal, setModal] = useState<'ENTRADA' | 'SAIDA' | 'FECHAR' | null>(null);
  const toast = useToast();

  const resumo = useCarregar(async () => (caixa ? rpc<any>('resumo_caixa', { p_caixa: caixa.id }) : null), [caixa?.id]);
  const lancs = useCarregar(
    async () =>
      caixa
        ? q<any[]>(
            supabase
              .from('lancamentos_financeiros')
              .select('*, categoria:categorias_financeiras(nome)')
              .eq('caixa_id', caixa.id)
              .order('id', { ascending: false }),
          )
        : [],
    [caixa?.id],
  );
  const anteriores = useCarregar(
    async () =>
      q<any[]>(
        supabase.from('caixas').select('*').eq('operador_id', usuario!.id).eq('status', 'FECHADO').order('id', { ascending: false }).limit(10),
      ),
    [caixa?.id],
  );

  const atualizar = () => {
    recarregar();
    resumo.recarregar();
    lancs.recarregar();
  };

  useAtalhos(
    {
      F2: () => caixa && !deOutroDia && setModal('ENTRADA'),
      F3: () => caixa && !deOutroDia && pode() && setModal('SAIDA'),
      F9: () => caixa && setModal('FECHAR'),
    },
    !modal,
  );

  async function abrir() {
    const v = lerValor(saldoInicial || '0');
    if (isNaN(v) || v < 0) return toast.erro('Informe um saldo inicial válido.');
    try {
      await rpc('abrir_caixa', { p_saldo_inicial: v });
      toast.ok('Caixa aberto.');
      setSaldoInicial('');
      atualizar();
    } catch (e) {
      toast.erro(e);
    }
  }

  if (carregando) return <Carregando />;

  if (!caixa)
    return (
      <>
        <Cabecalho titulo="Meu caixa" sub="Nenhum caixa aberto" />
        <section className="painel estreito">
          <h2>Abrir caixa</h2>
          <p className="muted">Informe o valor em dinheiro disponível na gaveta para iniciar o dia (RF-38).</p>
          <Campo rotulo="Saldo inicial em dinheiro">
            <CampoValor autoFocus valor={saldoInicial} onChange={setSaldoInicial} onEnter={abrir} />
          </Campo>
          <button className="btn primario grande largo" onClick={abrir}>
            Abrir caixa
          </button>
        </section>
        {!!anteriores.dados?.length && (
          <section className="painel">
            <h2>Caixas anteriores</h2>
            <table className="tabela">
              <thead>
                <tr>
                  <th>Abertura</th>
                  <th>Fechamento</th>
                  <th className="num">Saldo inicial</th>
                  <th className="num">Contado</th>
                  <th className="num">Diferença</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {anteriores.dados.map((c) => (
                  <tr key={c.id}>
                    <td>{dataHora(c.data_abertura)}</td>
                    <td>{dataHora(c.data_fechamento)}</td>
                    <td className="num">{brl(c.saldo_inicial)}</td>
                    <td className="num">{brl(c.valor_contado)}</td>
                    <td className={'num ' + (Number(c.diferenca) !== 0 ? 'txt-alerta' : '')}>{brl(c.diferenca)}</td>
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
        )}
      </>
    );

  const r = resumo.dados;
  return (
    <>
      <Cabecalho titulo="Meu caixa" sub={`Aberto em ${dataHora(caixa.data_abertura)}`}>
        <button className="btn" onClick={() => setModal('ENTRADA')} disabled={deOutroDia}>
          Registrar entrada <Tecla>F2</Tecla>
        </button>
        {pode() && (
          <button className="btn" onClick={() => setModal('SAIDA')} disabled={deOutroDia}>
            Registrar saída <Tecla>F3</Tecla>
          </button>
        )}
        <button className="btn perigo" onClick={() => setModal('FECHAR')}>
          Fechar caixa <Tecla>F9</Tecla>
        </button>
      </Cabecalho>

      {deOutroDia && (
        <p className="aviso">
          Este caixa foi aberto em outro dia. Feche-o e abra um novo caixa para registrar as movimentações de hoje (RN-01).
        </p>
      )}

      <div className="cards">
        <div className="card">
          <span>Saldo inicial</span>
          <strong>{brl(caixa.saldo_inicial)}</strong>
        </div>
        <div className="card ok">
          <span>Entradas</span>
          <strong>{brl(r?.total_entradas)}</strong>
        </div>
        <div className="card">
          <span>Saídas</span>
          <strong>{brl(r?.total_saidas)}</strong>
        </div>
        <div className="card destaque">
          <span>Dinheiro na gaveta</span>
          <strong>{brl(r?.saldo_dinheiro)}</strong>
          <small>saldo esperado em dinheiro</small>
        </div>
      </div>

      <div className="duas-colunas larga-esq">
        <section className="painel">
          <h2>Movimentações deste caixa</h2>
          <TabelaLancamentos lista={lancs.dados ?? []} />
        </section>
        <section className="painel">
          <h2>Por forma de pagamento</h2>
          <table className="tabela compacta">
            <thead>
              <tr>
                <th>Forma</th>
                <th className="num">Entradas</th>
                <th className="num">Saídas</th>
              </tr>
            </thead>
            <tbody>
              {(r?.por_forma ?? []).map((f: any) => (
                <tr key={f.forma}>
                  <td>{FORMAS[f.forma]}</td>
                  <td className="num">{brl(f.entradas)}</td>
                  <td className="num">{brl(f.saidas)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted pequeno">
            <Link to="/extrato" className="link">
              Ver extrato completo
            </Link>
          </p>
        </section>
      </div>

      <LancamentoModal
        tipo={modal === 'ENTRADA' || modal === 'SAIDA' ? modal : null}
        onFechar={() => setModal(null)}
        onSalvo={atualizar}
      />
      <FecharCaixaModal
        aberto={modal === 'FECHAR'}
        saldoEsperado={Number(r?.saldo_dinheiro ?? 0)}
        resumo={r}
        onFechar={() => setModal(null)}
        onFechado={(id) => {
          window.open(`/imprimir/fechamento/${id}`, '_blank');
          atualizar();
          anteriores.recarregar();
        }}
      />
    </>
  );
}

export function TabelaLancamentos({ lista, onEstornar }: { lista: any[]; onEstornar?: (l: any) => void }) {
  if (!lista.length) return <p className="muted">Nenhuma movimentação.</p>;
  return (
    <div className="rolagem">
      <table className="tabela">
        <thead>
          <tr>
            <th>#</th>
            <th>Data/hora</th>
            <th>Descrição</th>
            <th>Categoria</th>
            <th>Forma</th>
            {lista[0]?.usuario !== undefined && <th>Usuário</th>}
            <th className="num">Valor</th>
            {onEstornar && <th />}
          </tr>
        </thead>
        <tbody>
          {lista.map((l) => (
            <tr key={l.id} className={l.estornado ? 'riscado' : ''}>
              <td className="muted">{l.id}</td>
              <td className="nowrap">{dataHora(l.data_hora)}</td>
              <td>
                {l.descricao}
                {l.estornado && (
                  <>
                    {' '}
                    <Badge cor="vermelho">estornado</Badge>
                  </>
                )}
                {l.estorno_de_id && (
                  <>
                    {' '}
                    <Badge cor="laranja">estorno</Badge>
                  </>
                )}
              </td>
              <td>{l.categoria?.nome}</td>
              <td>{FORMAS[l.forma_pagamento]}</td>
              {l.usuario !== undefined && <td>{l.usuario?.nome}</td>}
              <td className={'num nowrap ' + (l.tipo === 'ENTRADA' ? 'txt-ok' : 'txt-saida')}>
                {l.tipo === 'ENTRADA' ? '+ ' : '− '}
                {brl(l.valor)}
              </td>
              {onEstornar && (
                <td>
                  {!l.estornado && !l.estorno_de_id && !l.venda_id && (
                    <button className="btn pequeno" onClick={() => onEstornar(l)}>
                      Estornar
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Registrar entrada (RF-40) ou saída (RF-41) com categoria (UC-22) e vínculo com fornecedor (UC-24) */
function LancamentoModal({ tipo, onFechar, onSalvo }: { tipo: 'ENTRADA' | 'SAIDA' | null; onFechar: () => void; onSalvo: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ categoria: '', valor: '', forma: 'DINHEIRO', descricao: '', data: hojeISO(), fornecedor: '', entrada: '' });
  const categorias = useCarregar(
    async () =>
      tipo
        ? q<any[]>(supabase.from('categorias_financeiras').select('*').eq('tipo', tipo).eq('ativo', true).is('codigo', null).order('nome'))
        : [],
    [tipo],
  );
  const fornecedorCat = useCarregar(async () =>
    q<any[]>(supabase.from('categorias_financeiras').select('id').eq('codigo', 'PAG_FORNECEDOR')),
  );
  const ehFornecedor = tipo === 'SAIDA' && Number(f.categoria) === fornecedorCat.dados?.[0]?.id;
  // A categoria "Pagamento de fornecedor" tem código de sistema; incluímos manualmente na lista de saídas
  const categoriasLista = [
    ...(tipo === 'SAIDA' && fornecedorCat.dados?.[0] ? [{ id: fornecedorCat.dados[0].id, nome: 'Pagamento de fornecedor' }] : []),
    ...(categorias.dados ?? []),
  ];
  const fornecedores = useCarregar(
    async () => (ehFornecedor ? q<any[]>(supabase.from('fornecedores').select('id, razao_social').eq('ativo', true).order('razao_social')) : []),
    [ehFornecedor],
  );
  const entradas = useCarregar(
    async () =>
      f.fornecedor
        ? q<any[]>(
            supabase
              .from('entradas_produto')
              .select('id, numero_nota_fiscal, data_entrada, valor_total')
              .eq('fornecedor_id', f.fornecedor)
              .order('id', { ascending: false })
              .limit(30),
          )
        : [],
    [f.fornecedor],
  );

  useEffect(() => {
    if (tipo) setF({ categoria: '', valor: '', forma: tipo === 'SAIDA' ? 'PIX' : 'DINHEIRO', descricao: '', data: hojeISO(), fornecedor: '', entrada: '' });
  }, [tipo]);

  async function salvar() {
    const valor = lerValor(f.valor);
    if (!f.categoria) return toast.erro('Selecione a categoria (RN-15).');
    if (isNaN(valor) || valor <= 0) return toast.erro('Informe o valor.');
    if (ehFornecedor && !f.fornecedor) return toast.erro('Selecione o fornecedor (RN-17).');
    try {
      await rpc('registrar_lancamento', {
        p_tipo: tipo,
        p_categoria_id: Number(f.categoria),
        p_valor: valor,
        p_forma: f.forma,
        p_descricao: f.descricao,
        p_data_referencia: f.data,
        p_fornecedor_id: ehFornecedor ? Number(f.fornecedor) : null,
        p_entrada_produto_id: ehFornecedor && f.entrada ? Number(f.entrada) : null,
      });
      toast.ok(tipo === 'ENTRADA' ? 'Entrada registrada.' : 'Saída registrada.');
      onSalvo();
      onFechar();
    } catch (e) {
      toast.erro(e);
    }
  }

  return (
    <Modal
      aberto={!!tipo}
      titulo={tipo === 'ENTRADA' ? 'Registrar entrada no caixa' : 'Registrar saída do caixa'}
      onFechar={onFechar}
      rodape={
        <>
          <button className="btn" onClick={onFechar}>
            Cancelar
          </button>
          <button className="btn primario" onClick={salvar}>
            Registrar
          </button>
        </>
      }
    >
      <div className="grade-form">
        <Campo rotulo="Categoria *">
          <select autoFocus value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value, fornecedor: '', entrada: '' })}>
            <option value="">Selecione…</option>
            {categoriasLista.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </Campo>
        {ehFornecedor && (
          <>
            <Campo rotulo="Fornecedor *">
              <select value={f.fornecedor} onChange={(e) => setF({ ...f, fornecedor: e.target.value, entrada: '' })}>
                <option value="">Selecione…</option>
                {fornecedores.dados?.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.razao_social}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo rotulo="Nota fiscal / entrada (opcional)">
              <select value={f.entrada} onChange={(e) => setF({ ...f, entrada: e.target.value })}>
                <option value="">—</option>
                {entradas.dados?.map((x) => (
                  <option key={x.id} value={x.id}>
                    NF {x.numero_nota_fiscal} · {brl(x.valor_total)}
                  </option>
                ))}
              </select>
            </Campo>
          </>
        )}
        <Campo rotulo="Valor *">
          <CampoValor valor={f.valor} onChange={(v) => setF({ ...f, valor: v })} onEnter={salvar} />
        </Campo>
        <Campo rotulo={tipo === 'ENTRADA' ? 'Forma de recebimento' : 'Forma de pagamento'}>
          <select value={f.forma} onChange={(e) => setF({ ...f, forma: e.target.value })}>
            {Object.entries(FORMAS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Data de referência">
          <input type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} />
        </Campo>
        <Campo rotulo="Descrição *">
          <input value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && salvar()} />
        </Campo>
      </div>
      {tipo === 'SAIDA' && f.forma === 'DINHEIRO' && <p className="muted pequeno">Saídas em dinheiro são limitadas ao saldo da gaveta (RN-18).</p>}
    </Modal>
  );
}

/** Fechamento (RF-39, RN-03, UC-12) */
function FecharCaixaModal({
  aberto,
  saldoEsperado,
  resumo,
  onFechar,
  onFechado,
}: {
  aberto: boolean;
  saldoEsperado: number;
  resumo: any;
  onFechar: () => void;
  onFechado: (id: number) => void;
}) {
  const [contado, setContado] = useState('');
  const [just, setJust] = useState('');
  const toast = useToast();
  useEffect(() => {
    if (aberto) {
      setContado('');
      setJust('');
    }
  }, [aberto]);
  const v = lerValor(contado);
  const dif = isNaN(v) ? null : reais(centavos(v) - centavos(saldoEsperado));

  async function fechar() {
    if (isNaN(v)) return toast.erro('Informe o valor contado em dinheiro.');
    if (dif !== 0 && !just.trim()) return toast.erro('Informe a justificativa da diferença (RN-03).');
    try {
      const id = await rpc<number>('fechar_caixa', { p_valor_contado: v, p_justificativa: just || null });
      toast.ok('Caixa fechado.');
      onFechar();
      onFechado(id);
    } catch (e) {
      toast.erro(e);
    }
  }

  return (
    <Modal
      aberto={aberto}
      titulo="Fechar caixa"
      onFechar={onFechar}
      rodape={
        <>
          <button className="btn" onClick={onFechar}>
            Cancelar
          </button>
          <button className="btn perigo" onClick={fechar}>
            Fechar caixa
          </button>
        </>
      }
    >
      <table className="tabela compacta">
        <tbody>
          {(resumo?.por_forma ?? []).map((f: any) => (
            <tr key={f.forma}>
              <td>{FORMAS[f.forma]}</td>
              <td className="num">{brl(Number(f.entradas) - Number(f.saidas))}</td>
            </tr>
          ))}
          <tr className="forte">
            <td>Saldo esperado em dinheiro</td>
            <td className="num">{brl(saldoEsperado)}</td>
          </tr>
        </tbody>
      </table>
      <Campo rotulo="Valor contado em dinheiro *">
        <CampoValor autoFocus valor={contado} onChange={setContado} />
      </Campo>
      {dif !== null && (
        <p className={dif === 0 ? 'txt-ok' : 'txt-alerta'}>
          Diferença: <strong>{brl(dif)}</strong> {dif > 0 ? '(sobra)' : dif < 0 ? '(falta)' : '(caixa confere)'}
        </p>
      )}
      {dif !== null && dif !== 0 && (
        <Campo rotulo="Justificativa da diferença *">
          <textarea rows={2} value={just} onChange={(e) => setJust(e.target.value)} />
        </Campo>
      )}
    </Modal>
  );
}
