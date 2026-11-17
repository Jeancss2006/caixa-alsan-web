import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

/** Os usuários fazem login por "login"; no Supabase Auth ele vira um e-mail técnico. */
export const LOGIN_EMAIL_DOMAIN = 'caixa.local';
export const emailDoLogin = (login: string) => `${login.trim().toLowerCase()}@${LOGIN_EMAIL_DOMAIN}`;

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

export const erro = (mensagem: string, status = 400) => json({ erro: mensagem }, status);

export function adminClient(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function anonClient(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Garante que a requisição vem de um administrador ativo. Retorna o id dele. */
export async function exigirAdministrador(request: Request, env: Env): Promise<string | Response> {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return erro('Não autenticado.', 401);
  const admin = adminClient(env);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return erro('Sessão inválida.', 401);
  const { data: u } = await admin.from('usuarios').select('perfil, ativo').eq('id', data.user.id).single();
  if (!u || !u.ativo || u.perfil !== 'ADMINISTRADOR') return erro('Somente o administrador pode gerenciar usuários.', 403);
  return data.user.id;
}
