// Formatação no padrão brasileiro (RNF-10) e fuso do servidor (RNF-16)
export const TZ = 'America/Sao_Paulo';

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const brl = (v: number | string | null | undefined) => moeda.format(Number(v ?? 0));

export const data = (v: string | Date | null | undefined) =>
  v ? new Date(typeof v === 'string' && v.length === 10 ? v + 'T12:00:00' : v).toLocaleDateString('pt-BR', { timeZone: TZ }) : '';

export const dataHora = (v: string | Date | null | undefined) =>
  v
    ? new Date(v).toLocaleString('pt-BR', {
        timeZone: TZ,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

/** Data de hoje (aaaa-mm-dd) no fuso do servidor */
export const hojeISO = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
export const somarDias = (iso: string, dias: number) => {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
};
export const inicioDoMes = () => hojeISO().slice(0, 8) + '01';

/** Valores monetários são calculados em centavos inteiros para evitar erro de arredondamento (RNF-09) */
export const centavos = (v: number | string | null | undefined) => Math.round(Number(v ?? 0) * 100);
export const reais = (c: number) => c / 100;

/** Converte texto digitado ("1.234,56", "12,5", "12.50") em número; NaN se inválido */
export function lerValor(txt: string): number {
  let s = (txt ?? '').trim().replace(/[R$\s]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

export const valorParaCampo = (v: number | string | null | undefined) =>
  v === null || v === undefined || v === '' ? '' : Number(v).toFixed(2).replace('.', ',');

export const STATUS_OS: Record<string, string> = {
  ABERTA: 'Aberta',
  EM_MANUTENCAO: 'Em manutenção',
  AGUARDANDO_PECA: 'Aguardando peça',
  CONCLUIDA: 'Concluída',
  ENTREGUE: 'Entregue',
  CANCELADA: 'Cancelada',
};

export const FORMAS: Record<string, string> = {
  DINHEIRO: 'Dinheiro',
  PIX: 'Pix',
  CARTAO_DEBITO: 'Cartão de débito',
  CARTAO_CREDITO: 'Cartão de crédito',
};

export const PERFIS: Record<string, string> = {
  ADMINISTRADOR: 'Administrador',
  OPERADOR: 'Operador de caixa',
  TECNICO: 'Técnico',
};

/** LGPD (RNF-15): mascara CPF em listagens */
export function mascararDoc(doc: string | null | undefined) {
  if (!doc) return '';
  const d = doc.replace(/\D/g, '');
  if (d.length === 11) return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
  return doc;
}

export function formatarCpfCnpj(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 11)
    return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

export function formatarCnpj(v: string) {
  return v
    .replace(/\D/g, '')
    .slice(0, 14)
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

export function cpfCnpjValido(v: string) {
  const d = v.replace(/\D/g, '');
  if (d.length === 11) {
    if (/^(\d)\1+$/.test(d)) return false;
    const dv = (n: number) => {
      let s = 0;
      for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
      const r = (s * 10) % 11;
      return r === 10 ? 0 : r;
    };
    return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
  }
  if (d.length === 14) {
    if (/^(\d)\1+$/.test(d)) return false;
    const dv = (n: number) => {
      const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      const s = pesos.reduce((acc, p, i) => acc + Number(d[i]) * p, 0);
      const r = s % 11;
      return r < 2 ? 0 : 11 - r;
    };
    return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
  }
  return false;
}
