// Gestão de usuários pelo administrador (RF-04, RF-05, RF-06)
// POST  /api/usuarios  { nome, login, senha, perfil, limite_desconto?, especialidade? }
// PATCH /api/usuarios  { id, nome?, perfil?, limite_desconto?, especialidade?, ativo?, senha?, desbloquear? }
import { adminClient, emailDoLogin, erro, exigirAdministrador, json, type Env } from './_lib';

const PERFIS = ['ADMINISTRADOR', 'OPERADOR', 'TECNICO'];

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const adminId = await exigirAdministrador(request, env);
  if (adminId instanceof Response) return adminId;
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const nome = String(b.nome ?? '').trim();
  const login = String(b.login ?? '').trim().toLowerCase();
  const senha = String(b.senha ?? '');
  const perfil = String(b.perfil ?? '');
  if (!nome) return erro('Informe o nome.');
  if (!/^[a-z0-9._-]{3,40}$/.test(login)) {
    return erro('O login deve ter de 3 a 40 caracteres (letras minúsculas, números, ponto, hífen ou sublinhado).');
  }
  if (senha.length < 6) return erro('A senha deve ter pelo menos 6 caracteres.');
  if (!PERFIS.includes(perfil)) return erro('Perfil inválido.');

  const admin = adminClient(env);
  const { data: existente } = await admin.from('usuarios').select('id').eq('login', login).maybeSingle();
  if (existente) return erro('Já existe um usuário com este login.');

  const { data: criado, error } = await admin.auth.admin.createUser({
    email: emailDoLogin(login),
    password: senha,
    email_confirm: true,
    user_metadata: { nome, login },
  });
  if (error || !criado.user) return erro('Não foi possível criar o usuário: ' + (error?.message ?? ''), 500);

  const { error: e2 } = await admin.from('usuarios').insert({
    id: criado.user.id,
    nome,
    login,
    perfil,
    limite_desconto: perfil === 'ADMINISTRADOR' ? 100 : Number(b.limite_desconto ?? 0),
    especialidade: (b.especialidade as string) || null,
  });
  if (e2) {
    await admin.auth.admin.deleteUser(criado.user.id);
    return erro('Não foi possível salvar o usuário: ' + e2.message, 500);
  }
  return json({ id: criado.user.id }, 201);
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  const adminId = await exigirAdministrador(request, env);
  if (adminId instanceof Response) return adminId;
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = String(b.id ?? '');
  if (!id) return erro('Usuário não informado.');
  if (id === adminId && (b.ativo === false || (b.perfil && b.perfil !== 'ADMINISTRADOR'))) {
    return erro('Você não pode desativar nem rebaixar o seu próprio usuário.');
  }

  const admin = adminClient(env);
  const patch: Record<string, unknown> = {};
  if (b.nome !== undefined) patch.nome = String(b.nome).trim();
  if (b.perfil !== undefined) {
    if (!PERFIS.includes(String(b.perfil))) return erro('Perfil inválido.');
    patch.perfil = b.perfil;
  }
  if (b.limite_desconto !== undefined) patch.limite_desconto = Number(b.limite_desconto);
  if (b.especialidade !== undefined) patch.especialidade = (b.especialidade as string) || null;
  if (b.ativo !== undefined) patch.ativo = !!b.ativo;
  if (b.desbloquear) Object.assign(patch, { tentativas_login: 0, bloqueado_ate: null });

  if (b.senha !== undefined && b.senha !== '') {
    if (String(b.senha).length < 6) return erro('A senha deve ter pelo menos 6 caracteres.');
    const { error } = await admin.auth.admin.updateUserById(id, { password: String(b.senha) });
    if (error) return erro('Não foi possível alterar a senha: ' + error.message, 500);
  }
  if (b.ativo !== undefined) {
    // RF-06: impede novos acessos sem apagar o histórico
    const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: b.ativo ? 'none' : '876000h' });
    if (error) return erro('Não foi possível alterar o acesso: ' + error.message, 500);
  }
  if (Object.keys(patch).length) {
    const { error } = await admin.from('usuarios').update(patch).eq('id', id);
    if (error) return erro('Não foi possível salvar: ' + error.message, 500);
  }
  return json({ ok: true });
};
