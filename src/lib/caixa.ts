import { useAuth } from './auth';
import { q, supabase } from './supabase';
import { useCarregar } from '../components/ui';
import { hojeISO, somarDias, TZ } from './format';

export interface CaixaRow {
  id: number;
  operador_id: string;
  data_abertura: string;
  data_fechamento: string | null;
  saldo_inicial: number;
  saldo_esperado: number | null;
  valor_contado: number | null;
  diferenca: number | null;
  justificativa: string | null;
  status: 'ABERTO' | 'FECHADO';
}

/** Caixa aberto do usuário logado (RN-01 / RN-02) */
export function useMeuCaixa() {
  const { usuario } = useAuth();
  const r = useCarregar(async () => {
    if (!usuario) return null;
    const lista = await q<CaixaRow[]>(
      supabase.from('caixas').select('*').eq('operador_id', usuario.id).eq('status', 'ABERTO').limit(1),
    );
    return lista[0] ?? null;
  }, [usuario?.id]);
  const caixa = r.dados;
  const deOutroDia =
    !!caixa && new Date(caixa.data_abertura).toLocaleDateString('sv-SE', { timeZone: TZ }) !== hojeISO();
  return { ...r, caixa, deOutroDia };
}

/** Limites de um período de datas (dd inclusivo) no fuso de Brasília, para filtrar colunas timestamptz */
export function limitesPeriodo(inicio: string, fim: string) {
  return { de: `${inicio}T00:00:00-03:00`, ate: `${somarDias(fim, 1)}T00:00:00-03:00` };
}
