import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { q, rpc, supabase } from '../lib/supabase';
import { limitesPeriodo } from '../lib/caixa';
import { brl, centavos, FORMAS, hojeISO, reais } from '../lib/format';
import { Cabecalho, Campo, Carregando, MotivoModal, useCarregar, useToast } from '../components/ui';
import { TabelaLancamentos } from './Caixa';

/** Extrato do caixa (RF-46) com filtros (RF-47) e estorno pelo administrador (RF-45) */
export function Extrato() {
  const { pode } = useAuth();
  const admin = pode();
  const toast = useToast();
  const [filtro, setFiltro] = useState({ inicio: hojeISO(), fim: hojeISO(), tipo: '', categoria: '', forma: '', usuario: '' });
  const [estornar, setEstornar] = useState<any>(null);

  const categorias = useCarregar(() => q<any[]>(supabase.from('categorias_financeiras').select('id, nome, tipo').order('tipo').order('nome')));
  const usuarios = useCarregar(async () => (admin ? q<any[]>(supabase.from('usuarios').select('id, nome').order('nome')) : []));

  const dados = useCarregar(async () => {
    const { de, ate } = limitesPeriodo(filtro.inicio, filtro.fim);
    let qy = supabase
      .from('lancamentos_financeiros')
      .select('*, categoria:categorias_financeiras(nome), usuario:usuarios!usuario_id(nome)')
      .gte('data_hora', de)
      .lt('data_hora', ate)
      .order('data_hora')
      .order('id');
    if (filtro.tipo) qy = qy.eq('tipo', filtro.tipo);
    if (filtro.categoria) qy = qy.eq('categoria_id', filtro.categoria);
    if (filtro.forma) qy = qy.eq('forma_pagamento', filtro.forma);
    if (filtro.usuario) qy = qy.eq('usuario_id', filtro.usuario);
    const lancamentos = await q<any[]>(qy);

    // saldo inicial do período = soma dos saldos iniciais dos caixas abertos no período
    let qc = supabase.from('caixas').select('saldo_inicial, operador_id').gte('data_abertura', de).lt('data_abertura', ate);
    if (filtro.usuario) qc = qc.eq('operador_id', filtro.usuario);
    const caixas = await q<any[]>(qc);
    return { lancamentos, saldoInicial: caixas.reduce((s, c) => s + centavos(c.saldo_inicial), 0) };
  }, [JSON.stringify(filtro)]);

  const lista = dados.dados?.lancamentos ?? [];
  const ent = lista.filter((l) => l.tipo === 'ENTRADA').reduce((s, l) => s + centavos(l.valor), 0);
  const sai = lista.filter((l) => l.tipo === 'SAIDA').reduce((s, l) => s + centavos(l.valor), 0);
  const ini = dados.dados?.saldoInicial ?? 0;
  const set = (k: keyof typeof filtro) => (e: { target: { value: string } }) => setFiltro({ ...filtro, [k]: e.target.value });

  return (
    <>
      <Cabecalho titulo="Extrato do caixa" sub={admin ? 'Todas as movimentações' : 'Movimentações dos seus caixas'} />
      <div className="filtros">
        <Campo rotulo="De">
          <input type="date" value={filtro.inicio} onChange={set('inicio')} />
        </Campo>
        <Campo rotulo="Até">
          <input type="date" value={filtro.fim} onChange={set('fim')} />
        </Campo>
        <Campo rotulo="Tipo">
          <select value={filtro.tipo} onChange={set('tipo')}>
            <option value="">Todos</option>
            <option value="ENTRADA">Entradas</option>
            <option value="SAIDA">Saídas</option>
          </select>
        </Campo>
        <Campo rotulo="Categoria">
          <select value={filtro.categoria} onChange={set('categoria')}>
            <option value="">Todas</option>
            {categorias.dados
              ?.filter((c) => !filtro.tipo || c.tipo === filtro.tipo)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.tipo === 'ENTRADA' ? '↑' : '↓'} {c.nome}
                </option>
              ))}
          </select>
        </Campo>
        <Campo rotulo="Forma">
          <select value={filtro.forma} onChange={set('forma')}>
            <option value="">Todas</option>
            {Object.entries(FORMAS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Campo>
        {admin && (
          <Campo rotulo="Usuário">
            <select value={filtro.usuario} onChange={set('usuario')}>
              <option value="">Todos</option>
              {usuarios.dados?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nome}
                </option>
              ))}
            </select>
          </Campo>
        )}
      </div>

      <div className="cards">
        <div className="card">
          <span>Saldo inicial</span>
          <strong>{brl(reais(ini))}</strong>
        </div>
        <div className="card ok">
          <span>Total de entradas</span>
          <strong>{brl(reais(ent))}</strong>
        </div>
        <div className="card">
          <span>Total de saídas</span>
          <strong>{brl(reais(sai))}</strong>
        </div>
        <div className="card destaque">
          <span>Saldo final</span>
          <strong>{brl(reais(ini + ent - sai))}</strong>
        </div>
      </div>

      <section className="painel">
        {dados.carregando ? <Carregando /> : <TabelaLancamentos lista={lista} onEstornar={admin ? setEstornar : undefined} />}
      </section>

      <MotivoModal
        aberto={!!estornar}
        titulo={`Estornar lançamento #${estornar?.id ?? ''}`}
        descricao={
          estornar && (
            <>
              Será gerado um lançamento inverso de {brl(estornar.valor)} na categoria “{estornar.categoria?.nome}”. O lançamento original é
              mantido no histórico (RN-20).
            </>
          )
        }
        textoBotao="Estornar"
        onFechar={() => setEstornar(null)}
        onConfirmar={async (motivo) => {
          await rpc('estornar_lancamento', { p_id: estornar.id, p_motivo: motivo });
          toast.ok('Lançamento estornado.');
          dados.recarregar();
        }}
      />
    </>
  );
}
