import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { brl } from '../lib/format';

export interface ProdutoResumo {
  id: number;
  codigo: string;
  codigo_barras: string | null;
  descricao: string;
  preco_venda: number;
  preco_custo: number;
  quantidade_estoque: number;
  estoque_minimo: number;
  unidade: string;
  ativo: boolean;
}

const CAMPOS = 'id, codigo, codigo_barras, descricao, preco_venda, preco_custo, quantidade_estoque, estoque_minimo, unidade, ativo';
const limpar = (t: string) => t.replace(/[,()%*]/g, ' ').trim();

/** Busca exata por código/código de barras – usada pelo leitor USB, que digita o código e envia Enter (RNF-13) */
export async function buscarPorCodigo(t: string): Promise<ProdutoResumo | null> {
  const s = limpar(t);
  if (!s) return null;
  const { data } = await supabase
    .from('produtos')
    .select(CAMPOS)
    .eq('ativo', true)
    .or(`codigo_barras.eq.${s},codigo.eq.${s}`)
    .limit(1);
  return (data?.[0] as ProdutoResumo) ?? null;
}

export async function buscarProdutos(t: string, somenteAtivos = true): Promise<ProdutoResumo[]> {
  const s = limpar(t);
  let qy = supabase.from('produtos').select(CAMPOS).order('descricao').limit(25);
  if (somenteAtivos) qy = qy.eq('ativo', true);
  if (s) qy = qy.or(`descricao.ilike.*${s}*,codigo.ilike.${s}*,codigo_barras.eq.${s}`);
  const { data } = await qy;
  return (data as ProdutoResumo[]) ?? [];
}

export interface ProdutoBuscaRef {
  focar: () => void;
}

/**
 * Campo de busca de produtos por código, código de barras ou nome.
 * Enter com código exato adiciona direto; caso contrário mostra a lista (setas + Enter).
 */
export const ProdutoBusca = forwardRef<ProdutoBuscaRef, {
  onSelecionar: (p: ProdutoResumo) => void;
  placeholder?: string;
  autoFocus?: boolean;
}>(function ProdutoBusca({ onSelecionar, placeholder, autoFocus }, ref) {
  const [texto, setTexto] = useState('');
  const [lista, setLista] = useState<ProdutoResumo[]>([]);
  const [aberto, setAberto] = useState(false);
  const [indice, setIndice] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const buscaId = useRef(0);

  useImperativeHandle(ref, () => ({ focar: () => inputRef.current?.focus() }));

  useEffect(() => {
    if (!texto.trim()) {
      setLista([]);
      return;
    }
    const id = ++buscaId.current;
    const t = setTimeout(async () => {
      const r = await buscarProdutos(texto);
      if (id === buscaId.current) {
        setLista(r);
        setIndice(0);
        setAberto(true);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [texto]);

  function escolher(p: ProdutoResumo) {
    onSelecionar(p);
    setTexto('');
    setLista([]);
    setAberto(false);
    buscaId.current++;
    inputRef.current?.focus();
  }

  async function aoEnter() {
    const exato = await buscarPorCodigo(texto);
    if (exato) return escolher(exato);
    if (lista[indice]) return escolher(lista[indice]);
  }

  return (
    <div className="busca">
      <input
        ref={inputRef}
        autoFocus={autoFocus}
        value={texto}
        placeholder={placeholder ?? 'Código, código de barras ou nome do produto'}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={() => setTimeout(() => setAberto(false), 150)}
        onFocus={() => lista.length && setAberto(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            aoEnter();
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setIndice((i) => Math.min(i + 1, lista.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setIndice((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Escape') setAberto(false);
        }}
      />
      {aberto && texto && (
        <ul className="busca-lista">
          {lista.length === 0 && <li className="muted">Nenhum produto encontrado</li>}
          {lista.map((p, i) => (
            <li
              key={p.id}
              className={i === indice ? 'ativo' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                escolher(p);
              }}
              onMouseEnter={() => setIndice(i)}
            >
              <div>
                <strong>{p.descricao}</strong>
                <small className="muted">
                  {' '}
                  {p.codigo}
                  {p.codigo_barras ? ' · ' + p.codigo_barras : ''}
                </small>
              </div>
              <div className="busca-dir">
                <span>{brl(p.preco_venda)}</span>
                <small className={p.quantidade_estoque <= p.estoque_minimo ? 'txt-alerta' : 'muted'}>
                  estoque {p.quantidade_estoque}
                </small>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
