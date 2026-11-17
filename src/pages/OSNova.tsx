import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { q, rpc, supabase } from '../lib/supabase';
import { data } from '../lib/format';
import { GARANTIA_DIAS } from '../config';
import { ClienteSelect, type Cliente } from '../components/Clientes';
import { Cabecalho, Campo, useCarregar, useToast } from '../components/ui';

/** Abrir ordem de serviço (RF-21, UC-05) – com cadastro de cliente na mesma tela (UC-06) e OS de garantia (RN-14) */
export function OSNova() {
  const { usuario } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [f, setF] = useState({
    equipamento: '',
    defeito: '',
    acessorios: '',
    tecnico: usuario?.perfil === 'TECNICO' ? usuario.id : '',
    garantia: params.get('garantia') ?? '',
  });
  const [enviando, setEnviando] = useState(false);

  const tecnicos = useCarregar(() =>
    q<any[]>(supabase.from('usuarios').select('id, nome, perfil').eq('ativo', true).in('perfil', ['TECNICO', 'ADMINISTRADOR']).order('nome')),
  );

  // OS de garantia vinda do detalhe da OS original
  useEffect(() => {
    const g = params.get('garantia');
    if (!g) return;
    supabase
      .from('ordens_servico')
      .select('equipamento, cliente:clientes(*)')
      .eq('id', g)
      .single()
      .then(({ data: o }: any) => {
        if (o) {
          setCliente(o.cliente);
          setF((x) => ({ ...x, equipamento: o.equipamento }));
        }
      });
  }, [params]);

  // OS entregues do cliente ainda dentro da garantia
  const elegiveis = useCarregar(async () => {
    if (!cliente) return [];
    const limite = new Date(Date.now() - GARANTIA_DIAS * 86400000).toISOString();
    return q<any[]>(
      supabase
        .from('ordens_servico')
        .select('id, numero, equipamento, data_entrega')
        .eq('cliente_id', cliente.id)
        .eq('status', 'ENTREGUE')
        .gte('data_entrega', limite)
        .order('numero', { ascending: false }),
    );
  }, [cliente?.id]);

  async function salvar() {
    if (!cliente) return toast.erro('Selecione ou cadastre o cliente (RN-08).');
    if (!f.equipamento.trim() || !f.defeito.trim()) return toast.erro('Informe o equipamento e o defeito relatado.');
    setEnviando(true);
    try {
      const r = await rpc<{ id: number; numero: number }>('abrir_os', {
        p_cliente_id: cliente.id,
        p_equipamento: f.equipamento,
        p_defeito_relatado: f.defeito,
        p_acessorios: f.acessorios,
        p_tecnico_id: f.tecnico || null,
        p_garantia_de_id: f.garantia ? Number(f.garantia) : null,
      });
      toast.ok(`OS nº ${r.numero} aberta.`);
      window.open(`/imprimir/os-entrada/${r.id}`, '_blank');
      nav(`/os/${r.id}`);
    } catch (e) {
      toast.erro(e);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <Cabecalho titulo="Abrir ordem de serviço" />
      <section className="painel estreito-largo">
        <Campo rotulo="Cliente *">
          <ClienteSelect valor={cliente} onChange={(c) => setCliente(c)} autoFocus />
        </Campo>
        <div className="grade-form duas">
          <Campo rotulo="Equipamento *">
            <input
              value={f.equipamento}
              placeholder="Ex.: Notebook Dell Inspiron 15, nº de série…"
              onChange={(e) => setF({ ...f, equipamento: e.target.value })}
            />
          </Campo>
          <Campo rotulo="Técnico responsável">
            <select value={f.tecnico} onChange={(e) => setF({ ...f, tecnico: e.target.value })}>
              <option value="">Definir depois</option>
              {tecnicos.dados?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                </option>
              ))}
            </select>
          </Campo>
        </div>
        <Campo rotulo="Defeito relatado pelo cliente *">
          <textarea rows={3} value={f.defeito} onChange={(e) => setF({ ...f, defeito: e.target.value })} />
        </Campo>
        <Campo rotulo="Acessórios entregues">
          <input value={f.acessorios} placeholder="Ex.: carregador, bolsa, mouse" onChange={(e) => setF({ ...f, acessorios: e.target.value })} />
        </Campo>
        {!!elegiveis.dados?.length && (
          <Campo rotulo="Retorno em garantia?" dica={`Garantia de ${GARANTIA_DIAS} dias; a nova OS não cobra mão de obra (RN-14).`}>
            <select value={f.garantia} onChange={(e) => setF({ ...f, garantia: e.target.value })}>
              <option value="">Não – nova OS</option>
              {elegiveis.dados.map((o) => (
                <option key={o.id} value={o.id}>
                  Garantia da OS nº {o.numero} – {o.equipamento} (entregue {data(o.data_entrega)})
                </option>
              ))}
            </select>
          </Campo>
        )}
        <div className="acoes-form">
          <button className="btn" onClick={() => nav(-1)}>
            Cancelar
          </button>
          <button className="btn primario grande" onClick={salvar} disabled={enviando}>
            Abrir OS e imprimir comprovante
          </button>
        </div>
      </section>
    </>
  );
}
