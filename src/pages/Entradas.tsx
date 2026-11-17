import { useEffect, useState } from 'react';
import { q, rpc, supabase } from '../lib/supabase';
import { brl, centavos, data, dataHora, hojeISO, lerValor, reais, valorParaCampo } from '../lib/format';
import { ProdutoBusca, type ProdutoResumo } from '../components/ProdutoBusca';
import { Cabecalho, Campo, Carregando, Modal, useCarregar, useToast, Vazio } from '../components/ui';

/** Entrada de produtos (RF-11, UC-19) – atualiza estoque e custo médio (RN-05) */
export function Entradas() {
  const [nova, setNova] = useState(false);
  const [detalhe, setDetalhe] = useState<number | null>(null);
  const lista = useCarregar(() =>
    q<any[]>(
      supabase
        .from('entradas_produto')
        .select('*, fornecedor:fornecedores(razao_social), usuario:usuarios(nome)')
        .order('id', { ascending: false })
        .limit(200),
    ),
  );
  const det = useCarregar(
    async () =>
      detalhe ? q<any[]>(supabase.from('itens_entrada').select('*, produto:produtos(descricao, codigo)').eq('entrada_id', detalhe)) : [],
    [detalhe],
  );

  return (
    <>
      <Cabecalho titulo="Entrada de produtos">
        <button className="btn primario" onClick={() => setNova(true)}>
          + Registrar entrada
        </button>
      </Cabecalho>
      <section className="painel">
        {lista.carregando ? (
          <Carregando />
        ) : !lista.dados?.length ? (
          <Vazio>Nenhuma entrada registrada.</Vazio>
        ) : (
          <div className="rolagem">
            <table className="tabela clicavel">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Data</th>
                  <th>Nota fiscal</th>
                  <th>Fornecedor</th>
                  <th>Registrado por</th>
                  <th className="num">Valor total</th>
                </tr>
              </thead>
              <tbody>
                {lista.dados.map((e) => (
                  <tr key={e.id} onClick={() => setDetalhe(e.id)}>
                    <td>{e.id}</td>
                    <td>{data(e.data_entrada)}</td>
                    <td>{e.numero_nota_fiscal}</td>
                    <td>{e.fornecedor?.razao_social}</td>
                    <td>
                      {e.usuario?.nome} <small className="muted">{dataHora(e.criado_em)}</small>
                    </td>
                    <td className="num">{brl(e.valor_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <NovaEntrada aberto={nova} onFechar={() => setNova(false)} onSalvo={lista.recarregar} />
      <Modal aberto={!!detalhe} titulo={`Entrada #${detalhe ?? ''}`} onFechar={() => setDetalhe(null)} largura={600}>
        <table className="tabela compacta">
          <thead>
            <tr>
              <th>Produto</th>
              <th className="num">Qtd.</th>
              <th className="num">Custo unit.</th>
              <th className="num">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {det.dados?.map((i) => (
              <tr key={i.id}>
                <td>{i.produto?.descricao}</td>
                <td className="num">{i.quantidade}</td>
                <td className="num">{brl(i.custo_unitario)}</td>
                <td className="num">{brl(i.quantidade * i.custo_unitario)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Modal>
    </>
  );
}

interface ItemEntrada {
  produto: ProdutoResumo;
  quantidade: string;
  custo: string;
}

function NovaEntrada({ aberto, onFechar, onSalvo }: { aberto: boolean; onFechar: () => void; onSalvo: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ fornecedor: '', nf: '', data: hojeISO() });
  const [itens, setItens] = useState<ItemEntrada[]>([]);
  const [enviando, setEnviando] = useState(false);
  const fornecedores = useCarregar(() =>
    q<any[]>(supabase.from('fornecedores').select('id, razao_social').eq('ativo', true).order('razao_social')),
  );
  useEffect(() => {
    if (aberto) {
      setF({ fornecedor: '', nf: '', data: hojeISO() });
      setItens([]);
    }
  }, [aberto]);

  const total = itens.reduce((s, i) => s + centavos(lerValor(i.custo) || 0) * (parseInt(i.quantidade) || 0), 0);

  async function salvar() {
    if (!f.fornecedor) return toast.erro('Selecione o fornecedor.');
    if (!f.nf.trim()) return toast.erro('Informe o número da nota fiscal.');
    if (!itens.length) return toast.erro('Adicione os produtos recebidos.');
    const payload = itens.map((i) => ({ produto_id: i.produto.id, quantidade: parseInt(i.quantidade), custo_unitario: lerValor(i.custo) }));
    if (payload.some((p) => !p.quantidade || p.quantidade <= 0 || isNaN(p.custo_unitario))) return toast.erro('Revise quantidades e custos.');
    setEnviando(true);
    try {
      await rpc('registrar_entrada_produto', { p_fornecedor_id: Number(f.fornecedor), p_numero_nf: f.nf, p_data: f.data, p_itens: payload });
      toast.ok('Entrada registrada; estoque e custo médio atualizados.');
      onSalvo();
      onFechar();
    } catch (e) {
      toast.erro(e);
    } finally {
      setEnviando(false);
    }
  }

  const alterar = (idx: number, campo: 'quantidade' | 'custo', v: string) =>
    setItens((l) => l.map((x, j) => (j === idx ? { ...x, [campo]: v } : x)));

  return (
    <Modal
      aberto={aberto}
      titulo="Registrar entrada de produtos"
      onFechar={onFechar}
      largura={820}
      rodape={
        <>
          <span className="muted">Total da nota: {brl(reais(total))}</span>
          <button className="btn" onClick={onFechar}>
            Cancelar
          </button>
          <button className="btn primario" onClick={salvar} disabled={enviando}>
            Confirmar entrada
          </button>
        </>
      }
    >
      <div className="grade-form tres">
        <Campo rotulo="Fornecedor *">
          <select autoFocus value={f.fornecedor} onChange={(e) => setF({ ...f, fornecedor: e.target.value })}>
            <option value="">Selecione…</option>
            {fornecedores.dados?.map((x) => (
              <option key={x.id} value={x.id}>
                {x.razao_social}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Nº da nota fiscal *">
          <input value={f.nf} onChange={(e) => setF({ ...f, nf: e.target.value })} />
        </Campo>
        <Campo rotulo="Data de entrada">
          <input type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} />
        </Campo>
      </div>
      <ProdutoBusca
        placeholder="Adicionar produto recebido (código, código de barras ou nome)"
        onSelecionar={(p) =>
          setItens((l) =>
            l.some((x) => x.produto.id === p.id)
              ? l.map((x) => (x.produto.id === p.id ? { ...x, quantidade: String((parseInt(x.quantidade) || 0) + 1) } : x))
              : [...l, { produto: p, quantidade: '1', custo: valorParaCampo(p.preco_custo) }],
          )
        }
      />
      <table className="tabela compacta">
        <thead>
          <tr>
            <th>Produto</th>
            <th className="num">Estoque atual</th>
            <th className="num">Quantidade</th>
            <th className="num">Custo unitário</th>
            <th className="num">Subtotal</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {itens.map((i, idx) => (
            <tr key={i.produto.id}>
              <td>{i.produto.descricao}</td>
              <td className="num">{i.produto.quantidade_estoque}</td>
              <td className="num">
                <input className="mini" inputMode="numeric" value={i.quantidade} onChange={(e) => alterar(idx, 'quantidade', e.target.value.replace(/\D/g, ''))} />
              </td>
              <td className="num">
                <input className="mini" inputMode="decimal" value={i.custo} onChange={(e) => alterar(idx, 'custo', e.target.value.replace(/[^\d.,]/g, ''))} />
              </td>
              <td className="num">{brl(reais(centavos(lerValor(i.custo) || 0) * (parseInt(i.quantidade) || 0)))}</td>
              <td>
                <button className="btn-icone" onClick={() => setItens((l) => l.filter((_, j) => j !== idx))} aria-label="Remover">
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
