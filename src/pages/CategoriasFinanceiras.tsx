import { useState } from 'react';
import { q, supabase } from '../lib/supabase';
import { Badge, Cabecalho, Carregando, useCarregar, useToast } from '../components/ui';

/** Categorias financeiras de entrada e saída (RF-42, UC-28) */
export function CategoriasFinanceiras() {
  const toast = useToast();
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState<'ENTRADA' | 'SAIDA'>('SAIDA');
  const lista = useCarregar(() => q<any[]>(supabase.from('categorias_financeiras').select('*').order('tipo').order('nome')));

  const exec = async (fn: () => PromiseLike<any>, msg?: string) => {
    try {
      await q(fn());
      if (msg) toast.ok(msg);
      lista.recarregar();
    } catch (e) {
      toast.erro(e);
    }
  };

  function adicionar() {
    if (!nome.trim()) return;
    exec(() => supabase.from('categorias_financeiras').insert({ nome: nome.trim(), tipo }), 'Categoria criada.').then(() => setNome(''));
  }

  const grupo = (t: 'ENTRADA' | 'SAIDA') => (
    <section className="painel">
      <h2>{t === 'ENTRADA' ? 'Entradas (origem do dinheiro)' : 'Saídas (destino do dinheiro)'}</h2>
      <table className="tabela">
        <tbody>
          {lista.dados
            ?.filter((c) => c.tipo === t)
            .map((c) => (
              <tr key={c.id} className={c.ativo ? '' : 'riscado'}>
                <td>
                  {c.nome} {c.codigo && <Badge cor="azul">sistema</Badge>} {!c.ativo && <Badge cor="vermelho">inativa</Badge>}
                </td>
                <td className="num nowrap">
                  {!c.codigo && (
                    <>
                      <button
                        className="btn pequeno"
                        onClick={() => {
                          const n = prompt('Novo nome', c.nome);
                          if (n?.trim()) exec(() => supabase.from('categorias_financeiras').update({ nome: n.trim() }).eq('id', c.id));
                        }}
                      >
                        Editar
                      </button>{' '}
                      <button
                        className="btn pequeno"
                        onClick={() => exec(() => supabase.from('categorias_financeiras').update({ ativo: !c.ativo }).eq('id', c.id))}
                      >
                        {c.ativo ? 'Inativar' : 'Reativar'}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </section>
  );

  return (
    <>
      <Cabecalho
        titulo="Categorias financeiras"
        sub="Categorias de sistema são usadas nos lançamentos automáticos (vendas, OS, sobra/falta de caixa) e não podem ser alteradas."
      />
      <div className="filtros">
        <select value={tipo} onChange={(e) => setTipo(e.target.value as 'ENTRADA' | 'SAIDA')}>
          <option value="ENTRADA">Entrada</option>
          <option value="SAIDA">Saída</option>
        </select>
        <input placeholder="Nome da nova categoria" value={nome} onChange={(e) => setNome(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && adicionar()} />
        <button className="btn primario" onClick={adicionar}>
          Adicionar
        </button>
      </div>
      {lista.carregando ? (
        <Carregando />
      ) : (
        <div className="duas-colunas">
          {grupo('ENTRADA')}
          {grupo('SAIDA')}
        </div>
      )}
    </>
  );
}
