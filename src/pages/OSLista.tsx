import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { q, supabase } from '../lib/supabase';
import { limitesPeriodo } from '../lib/caixa';
import { brl, data, STATUS_OS } from '../lib/format';
import { Badge, Cabecalho, Campo, Carregando, corStatusOS, useCarregar, Vazio } from '../components/ui';

/** Consultar ordens de serviço (RF-29) */
export function OSLista() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [f, setF] = useState({
    numero: '',
    cliente: '',
    equipamento: '',
    tecnico: '',
    status: params.get('status') ?? '',
    inicio: '',
    fim: '',
  });
  const tecnicos = useCarregar(() =>
    q<any[]>(supabase.from('usuarios').select('id, nome').in('perfil', ['TECNICO', 'ADMINISTRADOR']).order('nome')),
  );

  const lista = useCarregar(async () => {
    const limpa = (s: string) => s.replace(/[,()%*]/g, ' ').trim();
    let qy = supabase
      .from('ordens_servico')
      .select('id, numero, status, equipamento, data_abertura, valor_total, garantia_de_id, cliente:clientes!inner(nome), tecnico:usuarios!tecnico_id(nome)')
      .order('numero', { ascending: false })
      .limit(300);
    if (f.numero) qy = qy.eq('numero', Number(f.numero) || 0);
    if (f.cliente) qy = qy.ilike('cliente.nome', `%${limpa(f.cliente)}%`);
    if (f.equipamento) qy = qy.ilike('equipamento', `%${limpa(f.equipamento)}%`);
    if (f.tecnico === 'nenhum') qy = qy.is('tecnico_id', null);
    else if (f.tecnico) qy = qy.eq('tecnico_id', f.tecnico);
    if (f.status) qy = qy.eq('status', f.status);
    if (f.inicio || f.fim) {
      const { de, ate } = limitesPeriodo(f.inicio || '2000-01-01', f.fim || '2100-01-01');
      qy = qy.gte('data_abertura', de).lt('data_abertura', ate);
    }
    return q<any[]>(qy);
  }, [JSON.stringify(f)]);

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  return (
    <>
      <Cabecalho titulo="Ordens de serviço">
        <Link to="/os/nova" className="btn primario">
          + Abrir OS
        </Link>
      </Cabecalho>
      <div className="filtros">
        <Campo rotulo="Número">
          <input inputMode="numeric" value={f.numero} onChange={set('numero')} style={{ width: 90 }} />
        </Campo>
        <Campo rotulo="Cliente">
          <input value={f.cliente} onChange={set('cliente')} />
        </Campo>
        <Campo rotulo="Equipamento">
          <input value={f.equipamento} onChange={set('equipamento')} />
        </Campo>
        <Campo rotulo="Técnico">
          <select value={f.tecnico} onChange={set('tecnico')}>
            <option value="">Todos</option>
            <option value="nenhum">Sem técnico</option>
            {tecnicos.dados?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Status">
          <select value={f.status} onChange={set('status')}>
            <option value="">Todos</option>
            {Object.entries(STATUS_OS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Aberta de">
          <input type="date" value={f.inicio} onChange={set('inicio')} />
        </Campo>
        <Campo rotulo="até">
          <input type="date" value={f.fim} onChange={set('fim')} />
        </Campo>
      </div>
      <section className="painel">
        {lista.carregando ? (
          <Carregando />
        ) : !lista.dados?.length ? (
          <Vazio>Nenhuma ordem de serviço encontrada.</Vazio>
        ) : (
          <div className="rolagem">
            <table className="tabela clicavel">
              <thead>
                <tr>
                  <th>Nº</th>
                  <th>Abertura</th>
                  <th>Cliente</th>
                  <th>Equipamento</th>
                  <th>Técnico</th>
                  <th className="num">Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {lista.dados.map((o) => (
                  <tr key={o.id} onClick={() => nav(`/os/${o.id}`)}>
                    <td>
                      <strong>{o.numero}</strong>
                      {o.garantia_de_id && (
                        <>
                          {' '}
                          <Badge cor="azul">garantia</Badge>
                        </>
                      )}
                    </td>
                    <td>{data(o.data_abertura)}</td>
                    <td>{o.cliente?.nome}</td>
                    <td>{o.equipamento}</td>
                    <td>{o.tecnico?.nome ?? <span className="muted">—</span>}</td>
                    <td className="num">{brl(o.valor_total)}</td>
                    <td>
                      <Badge cor={corStatusOS[o.status]}>{STATUS_OS[o.status]}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
