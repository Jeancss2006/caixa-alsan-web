import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { api, q, supabase } from '../lib/supabase';
import { dataHora, PERFIS } from '../lib/format';
import { Badge, Cabecalho, Campo, Carregando, Modal, useCarregar, useToast } from '../components/ui';

/** Usuários (RF-04, RF-05, RF-06) */
export function Usuarios() {
  const { usuario: eu } = useAuth();
  const toast = useToast();
  const [editar, setEditar] = useState<any | null | undefined>(undefined);
  const lista = useCarregar(() => q<any[]>(supabase.from('usuarios').select('*').order('ativo', { ascending: false }).order('nome')));

  async function alternarAcesso(u: any) {
    if (u.ativo && !confirm(`Desativar o acesso de "${u.nome}"? O histórico de operações será mantido.`)) return;
    try {
      await api('usuarios', 'PATCH', { id: u.id, ativo: !u.ativo });
      toast.ok(u.ativo ? 'Acesso desativado.' : 'Acesso reativado.');
      lista.recarregar();
    } catch (e) {
      toast.erro(e);
    }
  }

  return (
    <>
      <Cabecalho titulo="Usuários">
        <button className="btn primario" onClick={() => setEditar(null)}>
          + Novo usuário
        </button>
      </Cabecalho>
      <section className="painel">
        {lista.carregando ? (
          <Carregando />
        ) : (
          <div className="rolagem">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Login</th>
                  <th>Perfil</th>
                  <th className="num">Limite de desconto</th>
                  <th>Situação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lista.dados?.map((u) => {
                  const bloqueado = u.bloqueado_ate && new Date(u.bloqueado_ate) > new Date();
                  return (
                    <tr key={u.id} className={u.ativo ? '' : 'riscado'}>
                      <td>
                        {u.nome}
                        {u.especialidade && <small className="muted"> · {u.especialidade}</small>}
                      </td>
                      <td>{u.login}</td>
                      <td>{PERFIS[u.perfil]}</td>
                      <td className="num">{u.perfil === 'TECNICO' ? '—' : `${Number(u.limite_desconto)}%`}</td>
                      <td>
                        {!u.ativo ? (
                          <Badge cor="vermelho">desativado</Badge>
                        ) : bloqueado ? (
                          <Badge cor="laranja">bloqueado até {dataHora(u.bloqueado_ate)}</Badge>
                        ) : (
                          <Badge cor="verde">ativo</Badge>
                        )}
                      </td>
                      <td className="num nowrap">
                        <button className="btn pequeno" onClick={() => setEditar(u)}>
                          Editar
                        </button>{' '}
                        {bloqueado && (
                          <button
                            className="btn pequeno"
                            onClick={() =>
                              api('usuarios', 'PATCH', { id: u.id, desbloquear: true })
                                .then(() => (toast.ok('Usuário desbloqueado.'), lista.recarregar()))
                                .catch(toast.erro)
                            }
                          >
                            Desbloquear
                          </button>
                        )}{' '}
                        {u.id !== eu?.id && (
                          <button className={'btn pequeno ' + (u.ativo ? 'perigo' : '')} onClick={() => alternarAcesso(u)}>
                            {u.ativo ? 'Desativar' : 'Reativar'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <UsuarioForm usuario={editar} onFechar={() => setEditar(undefined)} onSalvo={lista.recarregar} />
    </>
  );
}

function UsuarioForm({ usuario, onFechar, onSalvo }: { usuario: any | null | undefined; onFechar: () => void; onSalvo: () => void }) {
  const toast = useToast();
  const aberto = usuario !== undefined;
  const [f, setF] = useState({ nome: '', login: '', senha: '', perfil: 'OPERADOR', limite_desconto: '5', especialidade: '' });
  useEffect(() => {
    if (aberto)
      setF({
        nome: usuario?.nome ?? '',
        login: usuario?.login ?? '',
        senha: '',
        perfil: usuario?.perfil ?? 'OPERADOR',
        limite_desconto: String(usuario?.limite_desconto ?? 5),
        especialidade: usuario?.especialidade ?? '',
      });
  }, [aberto, usuario]);

  async function salvar() {
    const corpo = {
      nome: f.nome,
      perfil: f.perfil,
      limite_desconto: f.perfil === 'ADMINISTRADOR' ? 100 : Number(f.limite_desconto.replace(',', '.')) || 0,
      especialidade: f.perfil === 'TECNICO' ? f.especialidade : '',
    };
    try {
      if (usuario) await api('usuarios', 'PATCH', { id: usuario.id, ...corpo, senha: f.senha || undefined });
      else await api('usuarios', 'POST', { ...corpo, login: f.login, senha: f.senha });
      toast.ok('Usuário salvo.');
      onSalvo();
      onFechar();
    } catch (e) {
      toast.erro(e);
    }
  }

  return (
    <Modal
      aberto={aberto}
      titulo={usuario ? 'Editar usuário' : 'Novo usuário'}
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
      <div className="grade-form duas">
        <Campo rotulo="Nome *">
          <input autoFocus value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />
        </Campo>
        <Campo rotulo="Login *" dica={usuario ? 'O login não pode ser alterado' : 'Letras minúsculas, números, ponto ou hífen'}>
          <input value={f.login} disabled={!!usuario} onChange={(e) => setF({ ...f, login: e.target.value.toLowerCase().replace(/\s/g, '') })} />
        </Campo>
        <Campo rotulo={usuario ? 'Nova senha (deixe em branco para manter)' : 'Senha *'} dica="Mínimo de 6 caracteres">
          <input type="password" autoComplete="new-password" value={f.senha} onChange={(e) => setF({ ...f, senha: e.target.value })} />
        </Campo>
        <Campo rotulo="Perfil de acesso *">
          <select value={f.perfil} onChange={(e) => setF({ ...f, perfil: e.target.value })}>
            {Object.entries(PERFIS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Campo>
        {f.perfil === 'OPERADOR' && (
          <Campo rotulo="Limite de desconto (%)" dica="Acima disso é necessária autorização do administrador">
            <input inputMode="decimal" value={f.limite_desconto} onChange={(e) => setF({ ...f, limite_desconto: e.target.value })} />
          </Campo>
        )}
        {f.perfil === 'TECNICO' && (
          <Campo rotulo="Especialidade">
            <input value={f.especialidade} onChange={(e) => setF({ ...f, especialidade: e.target.value })} />
          </Campo>
        )}
      </div>
    </Modal>
  );
}
