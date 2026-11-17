import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';

export function Login() {
  const { entrar } = useAuth();
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    setEnviando(true);
    try {
      await entrar(login, senha);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha no login.');
      setSenha('');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="tela-login">
      <form className="cartao-login" onSubmit={enviar}>
        <div className="marca grande">
          <span className="logo">A</span>
          <div>
            <strong>Caixa Alsan</strong>
            <small>Sistema de caixa · loja de informática</small>
          </div>
        </div>
        <label className="campo">
          <span>Login</span>
          <input autoFocus autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} />
        </label>
        <label className="campo">
          <span>Senha</span>
          <input type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
        </label>
        {erro && <p className="txt-erro">{erro}</p>}
        <button className="btn primario grande largo" disabled={enviando || !login || !senha}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
        <p className="muted pequeno centro">Após 5 tentativas sem sucesso, a conta é bloqueada por 15 minutos.</p>
      </form>
    </div>
  );
}
