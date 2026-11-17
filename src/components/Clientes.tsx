import { useEffect, useRef, useState } from 'react';
import { q, supabase } from '../lib/supabase';
import { cpfCnpjValido, formatarCpfCnpj, mascararDoc } from '../lib/format';
import { useAuth } from '../lib/auth';
import { Campo, Modal, useToast } from './ui';

export interface Cliente {
  id: number;
  nome: string;
  cpf_cnpj: string | null;
  telefone: string | null;
  email: string | null;
  endereco: string | null;
  ativo: boolean;
}

/** Cadastro/edição de cliente (RF-19, RF-20, UC-06, UC-09) */
export function ClienteForm({
  aberto,
  cliente,
  onFechar,
  onSalvo,
}: {
  aberto: boolean;
  cliente?: Cliente | null;
  onFechar: () => void;
  onSalvo: (c: Cliente) => void;
}) {
  const [f, setF] = useState({ nome: '', cpf_cnpj: '', telefone: '', email: '', endereco: '', ativo: true });
  const [salvando, setSalvando] = useState(false);
  const toast = useToast();
  const { pode } = useAuth();

  useEffect(() => {
    if (aberto)
      setF({
        nome: cliente?.nome ?? '',
        cpf_cnpj: cliente?.cpf_cnpj ?? '',
        telefone: cliente?.telefone ?? '',
        email: cliente?.email ?? '',
        endereco: cliente?.endereco ?? '',
        ativo: cliente?.ativo ?? true,
      });
  }, [aberto, cliente]);

  async function salvar() {
    if (!f.nome.trim()) return toast.erro('Informe o nome do cliente.');
    if (f.cpf_cnpj && !cpfCnpjValido(f.cpf_cnpj)) return toast.erro('CPF/CNPJ inválido.');
    setSalvando(true);
    const dados = {
      nome: f.nome.trim(),
      cpf_cnpj: f.cpf_cnpj ? formatarCpfCnpj(f.cpf_cnpj) : null,
      telefone: f.telefone.trim() || null,
      email: f.email.trim() || null,
      endereco: f.endereco.trim() || null,
      ativo: f.ativo,
    };
    try {
      const salvo = cliente
        ? await q<Cliente>(supabase.from('clientes').update(dados).eq('id', cliente.id).select().single())
        : await q<Cliente>(supabase.from('clientes').insert(dados).select().single());
      toast.ok(cliente ? 'Cliente atualizado.' : 'Cliente cadastrado.');
      onSalvo(salvo);
      onFechar();
    } catch (e) {
      toast.erro(e);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal
      aberto={aberto}
      titulo={cliente ? 'Editar cliente' : 'Novo cliente'}
      onFechar={onFechar}
      rodape={
        <>
          <button className="btn" onClick={onFechar}>
            Cancelar
          </button>
          <button className="btn primario" onClick={salvar} disabled={salvando}>
            Salvar
          </button>
        </>
      }
    >
      <div className="grade-form">
        <Campo rotulo="Nome *">
          <input autoFocus value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />
        </Campo>
        <Campo rotulo="CPF ou CNPJ">
          <input value={f.cpf_cnpj} onChange={(e) => setF({ ...f, cpf_cnpj: formatarCpfCnpj(e.target.value) })} />
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
        {cliente && pode('OPERADOR') && (
          <label className="check">
            <input type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} /> Cliente ativo
          </label>
        )}
      </div>
      <p className="muted pequeno">
        Os dados pessoais são usados apenas para identificação nas vendas e ordens de serviço (LGPD).
      </p>
    </Modal>
  );
}

/** Seleção de cliente com busca e cadastro rápido sem sair da tela (UC-06 «extend») */
export function ClienteSelect({
  valor,
  onChange,
  permitirNovo = true,
  autoFocus,
}: {
  valor: Cliente | null;
  onChange: (c: Cliente | null) => void;
  permitirNovo?: boolean;
  autoFocus?: boolean;
}) {
  const [texto, setTexto] = useState('');
  const [lista, setLista] = useState<Cliente[]>([]);
  const [aberto, setAberto] = useState(false);
  const [novo, setNovo] = useState(false);
  const { pode } = useAuth();
  const seq = useRef(0);

  useEffect(() => {
    const s = texto.replace(/[,()%*]/g, ' ').trim();
    if (!s) return setLista([]);
    const id = ++seq.current;
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('clientes')
        .select('*')
        .eq('ativo', true)
        .or(`nome.ilike.*${s}*,cpf_cnpj.ilike.*${s}*,telefone.ilike.*${s}*`)
        .order('nome')
        .limit(15);
      if (id === seq.current) {
        setLista((data as Cliente[]) ?? []);
        setAberto(true);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [texto]);

  if (valor)
    return (
      <div className="cliente-sel">
        <div>
          <strong>{valor.nome}</strong>
          <small className="muted">
            {' '}
            {mascararDoc(valor.cpf_cnpj)} {valor.telefone}
          </small>
        </div>
        <button className="btn pequeno" onClick={() => onChange(null)}>
          Trocar
        </button>
      </div>
    );

  return (
    <div className="linha-busca">
      <div className="busca">
        <input
          autoFocus={autoFocus}
          placeholder="Buscar cliente por nome, CPF/CNPJ ou telefone"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onBlur={() => setTimeout(() => setAberto(false), 150)}
          onFocus={() => lista.length && setAberto(true)}
        />
        {aberto && texto && (
          <ul className="busca-lista">
            {lista.length === 0 && <li className="muted">Nenhum cliente encontrado</li>}
            {lista.map((c) => (
              <li
                key={c.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(c);
                  setTexto('');
                }}
              >
                <strong>{c.nome}</strong>
                <small className="muted">
                  {mascararDoc(c.cpf_cnpj)} {c.telefone}
                </small>
              </li>
            ))}
          </ul>
        )}
      </div>
      {permitirNovo && pode('OPERADOR') && (
        <button className="btn" type="button" onClick={() => setNovo(true)}>
          + Novo cliente
        </button>
      )}
      <ClienteForm aberto={novo} onFechar={() => setNovo(false)} onSalvo={(c) => onChange(c)} />
    </div>
  );
}
