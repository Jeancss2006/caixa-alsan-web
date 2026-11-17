// Cria o primeiro administrador do sistema.
// Uso: npm run criar-admin -- "Nome Completo" login senha
// Lê SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY do ambiente ou do arquivo .dev.vars
import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';

if (existsSync('.dev.vars')) {
  for (const linha of readFileSync('.dev.vars', 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const [nome, login, senha] = process.argv.slice(2);
if (!nome || !login || !senha) {
  console.error('Uso: npm run criar-admin -- "Nome Completo" login senha');
  process.exit(1);
}
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (em .dev.vars).');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data, error } = await sb.auth.admin.createUser({
  email: `${login.toLowerCase()}@caixa.local`,
  password: senha,
  email_confirm: true,
  user_metadata: { nome, login },
});
if (error) {
  console.error('Erro ao criar no Auth:', error.message);
  process.exit(1);
}
const { error: e2 } = await sb.from('usuarios').insert({
  id: data.user.id,
  nome,
  login: login.toLowerCase(),
  perfil: 'ADMINISTRADOR',
  limite_desconto: 100,
});
if (e2) {
  console.error('Erro ao gravar usuário:', e2.message);
  await sb.auth.admin.deleteUser(data.user.id);
  process.exit(1);
}
console.log(`Administrador "${login}" criado com sucesso.`);
