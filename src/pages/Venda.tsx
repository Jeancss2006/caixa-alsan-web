import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { rpc } from '../lib/supabase';
import { useMeuCaixa } from '../lib/caixa';
import { brl, centavos, reais } from '../lib/format';
import { useAuth } from '../lib/auth';
import { ProdutoBusca, type ProdutoBuscaRef, type ProdutoResumo } from '../components/ProdutoBusca';
import { ClienteSelect, type Cliente } from '../components/Clientes';
import { DescontoCampo, PagamentoModal, useAutorizacao, type PagamentoEnvio } from '../components/Pagamento';
import { Cabecalho, Carregando, Modal, Tecla, useAtalhos, useToast } from '../components/ui';

interface Item {
  produto: ProdutoResumo;
  quantidade: number;
}

/** Venda no balcão (RF-33..RF-36, UC-13) */
export function Venda() {
  const { caixa, carregando, deOutroDia } = useMeuCaixa();
  const { usuario } = useAuth();
  const [itens, setItens] = useState<Item[]>([]);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [desconto, setDesconto] = useState(0);
  const [chaveDesconto, setChaveDesconto] = useState(0);
  const [pagando, setPagando] = useState(false);
  const [concluida, setConcluida] = useState<{ id: number; troco: number } | null>(null);
  const busca = useRef<ProdutoBuscaRef>(null);
  const toast = useToast();
  const { executar, modal: modalAutorizacao } = useAutorizacao();

  const subtotal = itens.reduce((s, i) => s + centavos(i.produto.preco_venda) * i.quantidade, 0);
  const total = subtotal - desconto;
  const pctDesconto = subtotal ? (desconto * 100) / subtotal : 0;

  function adicionar(p: ProdutoResumo) {
    setItens((lista) => {
      const i = lista.findIndex((x) => x.produto.id === p.id);
      const qtdAtual = i >= 0 ? lista[i].quantidade : 0;
      if (qtdAtual + 1 > p.quantidade_estoque) {
        toast.erro(`Estoque insuficiente para "${p.descricao}" (disponível: ${p.quantidade_estoque}).`);
        return lista;
      }
      if (i >= 0) return lista.map((x, j) => (j === i ? { ...x, quantidade: x.quantidade + 1 } : x));
      return [...lista, { produto: p, quantidade: 1 }];
    });
  }

  function alterarQtd(idx: number, qtd: number) {
    setItens((lista) =>
      lista.map((x, j) => {
        if (j !== idx) return x;
        const q = Math.max(1, Math.min(qtd || 1, x.produto.quantidade_estoque));
        if (qtd > x.produto.quantidade_estoque) toast.erro(`Disponível em estoque: ${x.produto.quantidade_estoque}.`);
        return { ...x, quantidade: q };
      }),
    );
  }

  function limpar() {
    setItens([]);
    setCliente(null);
    setDesconto(0);
    setChaveDesconto((k) => k + 1);
    setTimeout(() => busca.current?.focar(), 50);
  }

  function irParaPagamento() {
    if (!itens.length) return toast.erro('Adicione ao menos um produto.');
    if (total < 0) return toast.erro('Desconto maior que o subtotal.');
    setPagando(true);
  }

  async function confirmar(pagamentos: PagamentoEnvio[]) {
    const troco = pagamentos.reduce((s, p) => s + (p.valor_recebido ? centavos(p.valor_recebido) - centavos(p.valor) : 0), 0);
    await executar(async (token) => {
      const id = await rpc<number>('realizar_venda', {
        p_itens: itens.map((i) => ({ produto_id: i.produto.id, quantidade: i.quantidade })),
        p_pagamentos: pagamentos,
        p_desconto: reais(desconto),
        p_cliente_id: cliente?.id ?? null,
        p_autorizacao: token ?? null,
      });
      setPagando(false);
      setConcluida({ id, troco });
      limpar();
    });
  }

  const bloqueado = !caixa || deOutroDia;
  useAtalhos(
    {
      F2: () => busca.current?.focar(),
      F4: () => document.getElementById('campo-desconto')?.focus(),
      F9: () => irParaPagamento(),
      F6: () => itens.length && confirm('Limpar a venda atual?') && limpar(),
    },
    !pagando && !concluida && !bloqueado,
  );

  if (carregando) return <Carregando />;
  if (bloqueado)
    return (
      <>
        <Cabecalho titulo="Nova venda" />
        <div className="vazio">
          <h2>{caixa ? 'Caixa aberto em outro dia' : 'Caixa fechado'}</h2>
          <p>{caixa ? 'Feche o caixa anterior e abra o caixa de hoje.' : 'É necessário abrir o caixa antes de registrar vendas (RN-01).'}</p>
          <Link to="/caixa" className="btn primario">
            Ir para o caixa
          </Link>
        </div>
      </>
    );

  return (
    <>
      <Cabecalho titulo="Nova venda" sub={`Operador: ${usuario?.nome}`}>
        <span className="atalhos-ajuda">
          <Tecla>F2</Tecla> buscar <Tecla>F4</Tecla> desconto <Tecla>F9</Tecla> pagamento <Tecla>F6</Tecla> limpar
        </span>
      </Cabecalho>
      <div className="pdv">
        <section className="painel pdv-itens">
          <ProdutoBusca ref={busca} autoFocus onSelecionar={adicionar} />
          <div className="rolagem">
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
                {itens.map((i, idx) => (
                  <tr key={i.produto.id}>
                    <td>
                      {i.produto.descricao}
                      <br />
                      <small className="muted">
                        {i.produto.codigo} · estoque {i.produto.quantidade_estoque}
                      </small>
                    </td>
                    <td className="num">
                      <div className="qtd">
                        <button onClick={() => alterarQtd(idx, i.quantidade - 1)} aria-label="Diminuir">
                          −
                        </button>
                        <input
                          value={i.quantidade}
                          inputMode="numeric"
                          onChange={(e) => alterarQtd(idx, parseInt(e.target.value.replace(/\D/g, '')) || 1)}
                        />
                        <button onClick={() => alterarQtd(idx, i.quantidade + 1)} aria-label="Aumentar">
                          +
                        </button>
                      </div>
                    </td>
                    <td className="num">{brl(i.produto.preco_venda)}</td>
                    <td className="num">{brl(reais(centavos(i.produto.preco_venda) * i.quantidade))}</td>
                    <td>
                      <button className="btn-icone" onClick={() => setItens((l) => l.filter((_, j) => j !== idx))} aria-label="Remover">
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!itens.length && <div className="vazio">Leia o código de barras ou busque o produto pelo nome.</div>}
          </div>
        </section>

        <aside className="painel pdv-resumo">
          <h2>Cliente (opcional)</h2>
          <ClienteSelect valor={cliente} onChange={setCliente} />
          <div className="linha-total">
            <span>Itens</span>
            <span>{itens.reduce((s, i) => s + i.quantidade, 0)}</span>
          </div>
          <div className="linha-total">
            <span>Subtotal</span>
            <span>{brl(reais(subtotal))}</span>
          </div>
          <label className="campo">
            <span>
              Desconto <Tecla>F4</Tecla>
              {desconto > 0 && <small className="muted"> ({pctDesconto.toFixed(1)}% · seu limite {usuario?.limite_desconto}%)</small>}
            </span>
            <DescontoCampo key={chaveDesconto} brutoCentavos={subtotal} onChange={setDesconto} inputId="campo-desconto" />
          </label>
          <div className="linha-total grande">
            <span>Total</span>
            <strong>{brl(reais(total))}</strong>
          </div>
          <button className="btn primario grande largo" onClick={irParaPagamento} disabled={!itens.length}>
            Receber pagamento <Tecla>F9</Tecla>
          </button>
        </aside>
      </div>

      <PagamentoModal
        aberto={pagando}
        titulo="Pagamento da venda"
        totalCentavos={total}
        onFechar={() => setPagando(false)}
        onConfirmar={confirmar}
      />
      {modalAutorizacao}
      <Modal
        aberto={!!concluida}
        titulo="Venda concluída"
        onFechar={() => setConcluida(null)}
        largura={420}
        rodape={
          <>
            <a className="btn" href={`/imprimir/venda/${concluida?.id}`} target="_blank" rel="noreferrer">
              Imprimir comprovante
            </a>
            <button className="btn primario" autoFocus onClick={() => setConcluida(null)}>
              Nova venda (Enter)
            </button>
          </>
        }
      >
        <p>
          Venda <strong>#{concluida?.id}</strong> registrada com sucesso.
        </p>
        {!!concluida?.troco && (
          <div className="pag-total troco">
            <span>Troco</span>
            <strong>{brl(reais(concluida.troco))}</strong>
          </div>
        )}
      </Modal>
    </>
  );
}
