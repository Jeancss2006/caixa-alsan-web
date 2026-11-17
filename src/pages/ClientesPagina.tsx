import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { q, rpc, supabase } from '../lib/supabase';
import { mascararDoc } from '../lib/format';
import { ClienteForm, type Cliente } from '../components/Clientes';
import { Badge, Cabecalho, Carregando, useCarregar, useToast, Vazio } from '../components/ui';

/** Clientes (RF-19, RF-20) */
export function ClientesPagina() {
  const { pode } = useAuth();
  const toast = useToast();
  const [busca, setBusca] = useState('');
  const [inativos, setInativos] = useState(false);
  const [editar, setEditar] = useState<Cliente | null | undefined>(undefined);

  const lista = useCarregar(async () => {
    const s = busca.replace(/[,()%*]/g, ' ').trim();
    let qy = supabase.from('clientes').select('*').order('nome').limit(200);
    if (!inativos) qy = qy.eq('ativo', true);
    if (s) qy = qy.or(`nome.ilike.*${s}*,cpf_cnpj.ilike.*${s}*,telefone.ilike.*${s}*`);
    return q<Cliente[]>(qy);
  }, [busca, inativos]);

  return (
    <>
      <Cabecalho titulo="Clientes">
        {pode('OPERADOR') && (
          <button className="btn primario" onClick={() => setEditar(null)}>
            + Novo cliente
          </button>
        )}
      </Cabecalho>
      <div className="filtros">
        <input className="busca-grande" placeholder="Buscar por nome, CPF/CNPJ ou telefone" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <label className="check">
          <input type="checkbox" checked={inativos} onChange={(e) => setInativos(e.target.checked)} /> Mostrar inativos
        </label>
      </div>
      <section className="painel">
        {lista.carregando ? (
          <Carregando />
        ) : !lista.dados?.length ? (
          <Vazio>Nenhum cliente encontrado.</Vazio>
        ) : (
          <div className="rolagem">
            <table className="tabela clicavel">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>CPF/CNPJ</th>
                  <th>Telefone</th>
                  <th>E-mail</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lista.dados.map((c) => (
                  <tr key={c.id} onClick={() => setEditar(c)}>
                    <td>
                      {c.nome} {!c.ativo && <Badge cor="vermelho">inativo</Badge>}
                    </td>
                    <td>{mascararDoc(c.cpf_cnpj)}</td>
                    <td>{c.telefone}</td>
                    <td>{c.email}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {pode() && c.ativo && (
                        <button
                          className="btn pequeno"
                          title="LGPD: remove os dados pessoais e mantém o histórico"
                          onClick={async () => {
                            if (!confirm(`Anonimizar os dados pessoais de "${c.nome}"? Esta ação não pode ser desfeita.`)) return;
                            try {
                              await rpc('anonimizar_cliente', { p_id: c.id });
                              toast.ok('Dados do cliente anonimizados.');
                              lista.recarregar();
                            } catch (e) {
                              toast.erro(e);
                            }
                          }}
                        >
                          Anonimizar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <ClienteForm aberto={editar !== undefined} cliente={editar} onFechar={() => setEditar(undefined)} onSalvo={() => lista.recarregar()} />
    </>
  );
}
