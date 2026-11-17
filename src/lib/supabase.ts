import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigurado = !!url && !!anonKey;

export const supabase = createClient(url || 'http://localhost:54321', anonKey || 'chave-nao-configurada', {
  auth: { persistSession: true, autoRefreshToken: true },
});

/** Erro de regra de negócio vindo do banco. `codigo === 'CXAUT'` indica que é preciso autorização do administrador. */
export class ErroNegocio extends Error {
  constructor(message: string, public codigo?: string) {
    super(message);
  }
}

function traduzir(e: { message: string; code?: string }): ErroNegocio {
  let msg = e.message;
  if (e.code === '23505') msg = 'Já existe um registro com este valor (código, CPF/CNPJ ou nome duplicado).';
  else if (e.code === '42501' && /row-level security|permission denied/i.test(msg))
    msg = 'Operação não permitida para o seu perfil de acesso.';
  else if (e.code === '23514') msg = 'Valor inválido: ' + msg;
  return new ErroNegocio(msg, e.code);
}

/** Chama uma função do banco (RPC) e lança ErroNegocio em caso de falha. */
export async function rpc<T = unknown>(nome: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(nome, args);
  if (error) throw traduzir(error);
  return data as T;
}

/** Executa uma consulta do supabase-js e lança ErroNegocio em caso de falha. */
export async function q<T = any>(promessa: PromiseLike<{ data: unknown; error: any }>): Promise<T> {
  const { data, error } = await promessa;
  if (error) throw traduzir(error);
  return data as T;
}

/** Chama as Cloudflare Pages Functions (/api/*) com o token do usuário logado. */
export async function api<T = unknown>(caminho: string, metodo: string, corpo?: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const resp = await fetch('/api/' + caminho, {
    method: metodo,
    headers: {
      'content-type': 'application/json',
      ...(data.session ? { authorization: 'Bearer ' + data.session.access_token } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new ErroNegocio((json as { erro?: string }).erro || `Erro ${resp.status}`);
  return json as T;
}
