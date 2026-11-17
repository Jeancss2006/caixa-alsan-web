import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { api, supabase } from './supabase';

export type Perfil = 'ADMINISTRADOR' | 'OPERADOR' | 'TECNICO';

export interface Usuario {
  id: string;
  nome: string;
  login: string;
  perfil: Perfil;
  ativo: boolean;
  limite_desconto: number;
  especialidade: string | null;
}

interface AuthCtx {
  session: Session | null;
  usuario: Usuario | null;
  carregando: boolean;
  entrar: (login: string, senha: string) => Promise<void>;
  sair: () => Promise<void>;
  /** Administrador é especialização do operador: herda tudo */
  pode: (...perfis: Perfil[]) => boolean;
}

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setCarregando(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_ev, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setUsuario(null);
      return;
    }
    setCarregando(true);
    supabase
      .from('usuarios')
      .select('id, nome, login, perfil, ativo, limite_desconto, especialidade')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data || !data.ativo) {
          supabase.auth.signOut();
          setUsuario(null);
        } else setUsuario(data as Usuario);
        setCarregando(false);
      });
  }, [session?.user.id]);

  async function entrar(login: string, senha: string) {
    const r = await api<{ access_token: string; refresh_token: string }>('login', 'POST', { login, senha });
    const { error } = await supabase.auth.setSession(r);
    if (error) throw error;
  }

  async function sair() {
    await supabase.auth.signOut();
  }

  const pode = (...perfis: Perfil[]) =>
    !!usuario && (usuario.perfil === 'ADMINISTRADOR' || perfis.includes(usuario.perfil));

  return <Ctx.Provider value={{ session, usuario, carregando, entrar, sair, pode }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
