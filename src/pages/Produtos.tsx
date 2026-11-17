import { useEffect, useState } from 'react';
import { q, supabase } from '../lib/supabase';
import { brl, lerValor, valorParaCampo } from '../lib/format';
import { Badge, Cabecalho, Campo, CampoValor, Carregando, Modal, useCarregar, useToast, Vazio } from '../components/ui';

/** Produtos (RF-07, RF-08, RF-09) e categorias de produto (RF-10) */
export function Produtos() {
  const [aba, setAba] = useState<'produtos' | 'categorias'>('produtos');
  return (
    <>
      <Cabecalho titulo="Produtos">
        <div className="seg">
          <button className={aba === 'produtos' ? 'on' : ''} onClick={() => setAba('produtos')}>
            Produtos
          </button>
          <button className={aba === 'categorias' ? 'on' : ''} onClick={() => setAba('categorias')}>
            Categorias
          </button>
        </div>
      </Cabecalho>
      {aba === 'produtos' ? <ListaProdutos /> : <Categorias />}
    </>
  );
}

function ListaProdutos() {
  const [busca, setBusca] = useState('');
  const [inativos, setInativos] = useState(false);
  const [editar, setEditar] = useState<any | null | undefined>(undefined);
  const lista = useCarregar(async () => {
    const s = busca.replace(/[,()%*]/g, ' ').trim();
    let qy = supabase.from('produtos').select('*, categoria:categorias_produto(nome)').order('descricao').limit(500);
    if (!inativos) qy = qy.eq('ativo', true);
    if (s) qy = qy.or(`descricao.ilike.*${s}*,codigo.ilike.*${s}*,codigo_barras.eq.${s}`);
    return q<any[]>(qy);
  }, [busca, inativos]);

  return (
    <>
      <div className="filtros">
        <input className="busca-grande" placeholder="Nome, código ou código de barras" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <label className="check">
          <input type="checkbox" checked={inativos} onChange={(e) => setInativos(e.target.checked)} /> Mostrar inativos
        </label>
        <button className="btn primario" onClick={() => setEditar(null)}>
          + Novo produto
        </button>
      </div>
      <section className="painel">
        {lista.carregando ? (
          <Carregando />
        ) : !lista.dados?.length ? (
          <Vazio>Nenhum produto.</Vazio>
        ) : (
          <div className="rolagem">
            <table className="tabela clicavel">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descrição</th>
                  <th>Categoria</th>
                  <th>Un.</th>
                  <th className="num">Custo</th>
                  <th className="num">Venda</th>
                  <th className="num">Margem</th>
                  <th className="num">Estoque</th>
                </tr>
              </thead>
              <tbody>
                {lista.dados.map((p) => (
                  <tr key={p.id} onClick={() => setEditar(p)} className={p.ativo ? '' : 'riscado'}>
                    <td>
                      {p.codigo}
                      <br />
                      <small className="muted">{p.codigo_barras}</small>
                    </td>
                    <td>
                      {p.descricao} {!p.ativo && <Badge cor="vermelho">inativo</Badge>}
                    </td>
                    <td>{p.categoria?.nome}</td>
                    <td>{p.unidade}</td>
                    <td className="num">{brl(p.preco_custo)}</td>
                    <td className="num">{brl(p.preco_venda)}</td>
                    <td className="num">{Number(p.preco_custo) > 0 ? `${(((p.preco_venda - p.preco_custo) / p.preco_custo) * 100).toFixed(0)}%` : '—'}</td>
                    <td className={'num ' + (p.quantidade_estoque <= p.estoque_minimo ? 'txt-alerta' : '')}>{p.quantidade_estoque}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <ProdutoForm produto={editar} onFechar={() => setEditar(undefined)} onSalvo={lista.recarregar} />
    </>
  );
}

function ProdutoForm({ produto, onFechar, onSalvo }: { produto: any | null | undefined; onFechar: () => void; onSalvo: () => void }) {
  const toast = useToast();
  const aberto = produto !== undefined;
  const vazio = { codigo: '', codigo_barras: '', descricao: '', categoria_id: '', unidade: 'UN', preco_custo: '', preco_venda: '', estoque_minimo: '0', ativo: true };
  const [f, setF] = useState(vazio);
  const categorias = useCarregar(() => q<any[]>(supabase.from('categorias_produto').select('id, nome').eq('ativo', true).order('nome')));

  useEffect(() => {
    if (!aberto) return;
    setF(
      produto
        ? {
            codigo: produto.codigo,
            codigo_barras: produto.codigo_barras ?? '',
            descricao: produto.descricao,
            categoria_id: produto.categoria_id ? String(produto.categoria_id) : '',
            unidade: produto.unidade,
            preco_custo: valorParaCampo(produto.preco_custo),
            preco_venda: valorParaCampo(produto.preco_venda),
            estoque_minimo: String(produto.estoque_minimo),
            ativo: produto.ativo,
          }
        : vazio,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, produto]);

  async function salvar() {
    const custo = f.preco_custo ? lerValor(f.preco_custo) : 0;
    const venda = lerValor(f.preco_venda);
    if (!f.codigo.trim() || !f.descricao.trim()) return toast.erro('Informe código e descrição.');
    if (isNaN(venda) || venda < 0 || isNaN(custo) || custo < 0) return toast.erro('Informe preços válidos.');
    if (venda < custo && !confirm('O preço de venda está abaixo do custo. Salvar mesmo assim?')) return;
    const dados = {
      codigo: f.codigo.trim(),
      codigo_barras: f.codigo_barras.trim() || null,
      descricao: f.descricao.trim(),
      categoria_id: f.categoria_id ? Number(f.categoria_id) : null,
      unidade: f.unidade.trim() || 'UN',
      preco_custo: custo,
      preco_venda: venda,
      estoque_minimo: parseInt(f.estoque_minimo) || 0,
      ativo: f.ativo,
    };
    try {
      if (produto) await q(supabase.from('produtos').update(dados).eq('id', produto.id));
      else await q(supabase.from('produtos').insert(dados));
      toast.ok('Produto salvo.');
      onSalvo();
      onFechar();
    } catch (e) {
      toast.erro(e);
    }
  }

  return (
    <Modal
      aberto={aberto}
      titulo={produto ? 'Editar produto' : 'Novo produto'}
      onFechar={onFechar}
      largura={640}
      rodape={
        <>
          <button className="btn" onClick={onFechar}>
            Cancelar
          </button>
          <button className="btn primario" onClick={salvar}>
            Salvar
          </button>
        </>
      }
    >
      <div className="grade-form duas">
        <Campo rotulo="Código *">
          <input autoFocus value={f.codigo} onChange={(e) => setF({ ...f, codigo: e.target.value })} />
        </Campo>
        <Campo rotulo="Código de barras" dica="Pode ser lido com o leitor USB">
          <input value={f.codigo_barras} onChange={(e) => setF({ ...f, codigo_barras: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()} />
        </Campo>
        <Campo rotulo="Descrição *">
          <input value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} />
        </Campo>
        <Campo rotulo="Categoria">
          <select value={f.categoria_id} onChange={(e) => setF({ ...f, categoria_id: e.target.value })}>
            <option value="">—</option>
            {categorias.dados?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Unidade">
          <input value={f.unidade} onChange={(e) => setF({ ...f, unidade: e.target.value.toUpperCase() })} />
        </Campo>
        <Campo rotulo="Estoque mínimo">
          <input inputMode="numeric" value={f.estoque_minimo} onChange={(e) => setF({ ...f, estoque_minimo: e.target.value.replace(/\D/g, '') })} />
        </Campo>
        <Campo rotulo="Preço de custo" dica="Atualizado automaticamente pelo custo médio a cada entrada">
          <CampoValor valor={f.preco_custo} onChange={(v) => setF({ ...f, preco_custo: v })} />
        </Campo>
        <Campo rotulo="Preço de venda *">
          <CampoValor valor={f.preco_venda} onChange={(v) => setF({ ...f, preco_venda: v })} />
        </Campo>
      </div>
      {produto && (
        <>
          <label className="check">
            <input type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} /> Produto ativo
          </label>
          <p className="muted pequeno">
            Produto inativo não pode ser vendido nem adicionado a OS; o histórico é mantido (RF-09). Estoque atual: {produto.quantidade_estoque}{' '}
            — use “Entrada de produtos” ou “Ajustar” para alterá-lo.
          </p>
        </>
      )}
    </Modal>
  );
}

function Categorias() {
  const toast = useToast();
  const [nome, setNome] = useState('');
  const lista = useCarregar(() => q<any[]>(supabase.from('categorias_produto').select('*').order('nome')));
  async function adicionar() {
    if (!nome.trim()) return;
    try {
      await q(supabase.from('categorias_produto').insert({ nome: nome.trim() }));
      setNome('');
      lista.recarregar();
    } catch (e) {
      toast.erro(e);
    }
  }
  async function alternar(c: any) {
    try {
      await q(supabase.from('categorias_produto').update({ ativo: !c.ativo }).eq('id', c.id));
      lista.recarregar();
    } catch (e) {
      toast.erro(e);
    }
  }
  async function renomear(c: any) {
    const n = prompt('Novo nome da categoria', c.nome);
    if (!n?.trim()) return;
    try {
      await q(supabase.from('categorias_produto').update({ nome: n.trim() }).eq('id', c.id));
      lista.recarregar();
    } catch (e) {
      toast.erro(e);
    }
  }
  return (
    <section className="painel estreito-largo">
      <div className="linha-busca">
        <input placeholder="Nova categoria (ex.: Periféricos)" value={nome} onChange={(e) => setNome(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && adicionar()} />
        <button className="btn primario" onClick={adicionar}>
          Adicionar
        </button>
      </div>
      <table className="tabela">
        <tbody>
          {lista.dados?.map((c) => (
            <tr key={c.id} className={c.ativo ? '' : 'riscado'}>
              <td>{c.nome}</td>
              <td className="num nowrap">
                <button className="btn pequeno" onClick={() => renomear(c)}>
                  Renomear
                </button>{' '}
                <button className="btn pequeno" onClick={() => alternar(c)}>
                  {c.ativo ? 'Inativar' : 'Reativar'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
