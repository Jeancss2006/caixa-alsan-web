// POST /api/login  { login, senha }
// Autentica pelo login do usuário e aplica o bloqueio após 5 tentativas (RNF-05).
import { adminClient, anonClient, emailDoLogin, erro, json, type Env } from './_lib';

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: { login?: string; senha?: string };
  try {
    body = await request.json();
  } catch {
    return erro('Requisição inválida.');
  }
  const login = (body.login ?? '').trim().toLowerCase();
  const senha = body.senha ?? '';
  if (!login || !senha) return erro('Informe login e senha.');

  const admin = adminClient(env);
  const { data: u } = await admin.from('usuarios').select('id, ativo, bloqueado_ate').eq('login', login).maybeSingle();

  if (!u) return erro('Login ou senha inválidos.', 401);
  if (!u.ativo) return erro('Este usuário está desativado. Procure o administrador.', 403);
  if (u.bloqueado_ate && new Date(u.bloqueado_ate) > new Date()) {
    return erro(`Conta bloqueada por excesso de tentativas. Tente novamente após ${hora(u.bloqueado_ate)}.`, 423);
  }

  const { data, error } = await anonClient(env).auth.signInWithPassword({ email: emailDoLogin(login), password: senha });
  if (error || !data.session) {
    const { data: bloqueadoAte } = await admin.rpc('login_registrar_falha', { p_usuario: u.id });
    if (bloqueadoAte && new Date(bloqueadoAte as string) > new Date()) {
      return erro(`Conta bloqueada após 5 tentativas sem sucesso. Tente novamente após ${hora(bloqueadoAte as string)}.`, 423);
    }
    return erro('Login ou senha inválidos.', 401);
  }

  await admin.rpc('login_registrar_sucesso', { p_usuario: u.id });
  return json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
};
