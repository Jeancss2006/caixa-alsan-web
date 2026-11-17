import { useState } from 'react';
import { q, supabase } from '../lib/supabase';
import { limitesPeriodo } from '../lib/caixa';
import { dataHora, hojeISO } from '../lib/format';
import { Cabecalho, Campo, Carregando, Modal, useCarregar, Vazio } from '../components/ui';

const TABELAS: Record<string, string> = {
  produtos: 'Produtos',
  movimentacoes_estoque: 'Movimentação de estoque',
  entradas_produto: 'Entradas de produtos',
  ordens_servico: 'Ordens de serviço',
  itens_os: 'Produtos da OS',
  vendas: 'Vendas',
  caixas: 'Caixas',
  lancamentos_financeiros: 'Lançamentos financeiros',
  categorias_financeiras: 'Categorias financeiras',
  categorias_produto: 'Categorias de produto',
  clientes: 'Clientes',
  fornecedores: 'Fornecedores',
  usuarios: 'Usuários',
};
const OPS: Record<string, string> = { INSERT: 'Inclusão', UPDATE: 'Alteração', DELETE: 'Exclusão' };

/** Registro de auditoria (RNF-06) */
export function Auditoria() {
  const [f, setF] = useState({ inicio: hojeISO(), fim: hojeISO(), tabela: '', usuario: '' });
  const [ver, setVer] = useState<any>(null);
  const usuarios = useCarregar(() => q<any[]>(supabase.from('usuarios').select('id, nome').order('nome')));
  const nomes = Object.fromEntries((usuarios.dados ?? []).map((u) => [u.id, u.nome]));
  const lista = useCarregar(async () => {
    const { de, ate } = limitesPeriodo(f.inicio, f.fim);
    let qy = supabase.from('auditoria').select('*').gte('data_hora', de).lt('data_hora', ate).order('id', { ascending: false }).limit(500);
    if (f.tabela) qy = qy.eq('tabela', f.tabela);
    if (f.usuario) qy = qy.eq('usuario_id', f.usuario);
    return q<any[]>(qy);
  }, [JSON.stringify(f)]);

  const diff = (a: any, d: any) => {
    if (!a) return d;
    if (!d) return a;
    return Object.fromEntries(Object.keys(d).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(d[k])).map((k) => [k, { de: a[k], para: d[k] }]));
  };

  return (
    <>
      <Cabecalho titulo="Auditoria" sub="Quem alterou estoque, ordens de serviço, caixa e cadastros, e quando." />
      <div className="filtros">
        <Campo rotulo="De">
          <input type="date" value={f.inicio} onChange={(e) => setF({ ...f, inicio: e.target.value })} />
        </Campo>
        <Campo rotulo="Até">
          <input type="date" value={f.fim} onChange={(e) => setF({ ...f, fim: e.target.value })} />
        </Campo>
        <Campo rotulo="Área">
          <select value={f.tabela} onChange={(e) => setF({ ...f, tabela: e.target.value })}>
            <option value="">Todas</option>
            {Object.entries(TABELAS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Usuário">
          <select value={f.usuario} onChange={(e) => setF({ ...f, usuario: e.target.value })}>
            <option value="">Todos</option>
            {usuarios.dados?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nome}
              </option>
            ))}
          </select>
        </Campo>
      </div>
      <section className="painel">
        {lista.carregando ? (
          <Carregando />
        ) : !lista.dados?.length ? (
          <Vazio>Nenhum registro no período.</Vazio>
        ) : (
          <div className="rolagem">
            <table className="tabela clicavel compacta">
              <thead>
                <tr>
                  <th>Data/hora</th>
                  <th>Usuário</th>
                  <th>Área</th>
                  <th>Operação</th>
                  <th>Registro</th>
                </tr>
              </thead>
              <tbody>
                {lista.dados.map((a) => (
                  <tr key={a.id} onClick={() => setVer(a)}>
                    <td className="nowrap">{dataHora(a.data_hora)}</td>
                    <td>{nomes[a.usuario_id] ?? <span className="muted">sistema</span>}</td>
                    <td>{TABELAS[a.tabela] ?? a.tabela}</td>
                    <td>{OPS[a.operacao]}</td>
                    <td>#{a.registro_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <Modal aberto={!!ver} titulo={`${TABELAS[ver?.tabela] ?? ''} #${ver?.registro_id ?? ''} – ${OPS[ver?.operacao] ?? ''}`} onFechar={() => setVer(null)} largura={700}>
        <pre className="json">{ver && JSON.stringify(diff(ver.dados_antes, ver.dados_depois), null, 2)}</pre>
      </Modal>
    </>
  );
}
