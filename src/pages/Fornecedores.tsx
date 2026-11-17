import { useEffect, useState } from 'react';
import { q, supabase } from '../lib/supabase';
import { cpfCnpjValido, formatarCnpj } from '../lib/format';
import { Badge, Cabecalho, Campo, Carregando, Modal, useCarregar, useToast, Vazio } from '../components/ui';

/** Fornecedores (RF-17, RF-18, UC-18) */
export function Fornecedores() {
  const [inativos, setInativos] = useState(false);
  const [editar, setEditar] = useState<any | null | undefined>(undefined);
  const lista = useCarregar(async () => {
    let qy = supabase.from('fornecedores').select('*').order('razao_social');
    if (!inativos) qy = qy.eq('ativo', true);
    return q<any[]>(qy);
  }, [inativos]);

  return (
    <>
      <Cabecalho titulo="Fornecedores">
        <label className="check">
          <input type="checkbox" checked={inativos} onChange={(e) => setInativos(e.target.checked)} /> Mostrar inativos
        </label>
        <button className="btn primario" onClick={() => setEditar(null)}>
          + Novo fornecedor
        </button>
      </Cabecalho>
      <section className="painel">
        {lista.carregando ? (
          <Carregando />
        ) : !lista.dados?.length ? (
          <Vazio>Nenhum fornecedor cadastrado.</Vazio>
        ) : (
          <div className="rolagem">
            <table className="tabela clicavel">
              <thead>
                <tr>
                  <th>Razão social</th>
                  <th>CNPJ</th>
                  <th>Telefone</th>
                  <th>E-mail</th>
                  <th>Endereço</th>
                </tr>
              </thead>
              <tbody>
                {lista.dados.map((f) => (
                  <tr key={f.id} onClick={() => setEditar(f)} className={f.ativo ? '' : 'riscado'}>
                    <td>
                      {f.razao_social} {!f.ativo && <Badge cor="vermelho">inativo</Badge>}
                    </td>
                    <td>{f.cnpj}</td>
                    <td>{f.telefone}</td>
                    <td>{f.email}</td>
                    <td>{f.endereco}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <FornecedorForm fornecedor={editar} onFechar={() => setEditar(undefined)} onSalvo={lista.recarregar} />
    </>
  );
}

function FornecedorForm({ fornecedor, onFechar, onSalvo }: { fornecedor: any | null | undefined; onFechar: () => void; onSalvo: () => void }) {
  const toast = useToast();
  const aberto = fornecedor !== undefined;
  const [f, setF] = useState({ razao_social: '', cnpj: '', telefone: '', email: '', endereco: '', ativo: true });
  useEffect(() => {
    if (aberto)
      setF({
        razao_social: fornecedor?.razao_social ?? '',
        cnpj: fornecedor?.cnpj ?? '',
        telefone: fornecedor?.telefone ?? '',
        email: fornecedor?.email ?? '',
        endereco: fornecedor?.endereco ?? '',
        ativo: fornecedor?.ativo ?? true,
      });
  }, [aberto, fornecedor]);

  async function salvar() {
    if (!f.razao_social.trim()) return toast.erro('Informe a razão social.');
    if (f.cnpj.replace(/\D/g, '').length !== 14 || !cpfCnpjValido(f.cnpj)) return toast.erro('CNPJ inválido.');
    const dados = { ...f, razao_social: f.razao_social.trim(), telefone: f.telefone || null, email: f.email || null, endereco: f.endereco || null };
    try {
      if (fornecedor) await q(supabase.from('fornecedores').update(dados).eq('id', fornecedor.id));
      else await q(supabase.from('fornecedores').insert(dados));
      toast.ok('Fornecedor salvo.');
      onSalvo();
      onFechar();
    } catch (e) {
      toast.erro(e);
    }
  }

  return (
    <Modal
      aberto={aberto}
      titulo={fornecedor ? 'Editar fornecedor' : 'Novo fornecedor'}
      onFechar={onFechar}
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
      <div className="grade-form">
        <Campo rotulo="Razão social *">
          <input autoFocus value={f.razao_social} onChange={(e) => setF({ ...f, razao_social: e.target.value })} />
        </Campo>
        <Campo rotulo="CNPJ *">
          <input value={f.cnpj} onChange={(e) => setF({ ...f, cnpj: formatarCnpj(e.target.value) })} />
        </Campo>
        <Campo rotulo="Telefone">
          <input value={f.telefone} onChange={(e) => setF({ ...f, telefone: e.target.value })} />
        </Campo>
        <Campo rotulo="E-mail">
          <input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Campo>
        <Campo rotulo="Endereço">
          <input value={f.endereco} onChange={(e) => setF({ ...f, endereco: e.target.value })} />
        </Campo>
        {fornecedor && (
          <label className="check">
            <input type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} /> Fornecedor ativo
          </label>
        )}
      </div>
    </Modal>
  );
}
