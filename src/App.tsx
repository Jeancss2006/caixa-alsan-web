import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth, type Perfil } from './lib/auth';
import { supabaseConfigurado } from './lib/supabase';
import { Layout } from './components/Layout';
import { Carregando } from './components/ui';
import { Login } from './pages/Login';
import { Inicio } from './pages/Inicio';
import { Caixa } from './pages/Caixa';
import { Extrato } from './pages/Extrato';
import { Venda } from './pages/Venda';
import { Vendas } from './pages/Vendas';
import { OSLista } from './pages/OSLista';
import { OSNova } from './pages/OSNova';
import { OSDetalhe } from './pages/OSDetalhe';
import { ClientesPagina } from './pages/ClientesPagina';
import { Estoque } from './pages/Estoque';
import { Produtos } from './pages/Produtos';
import { Entradas } from './pages/Entradas';
import { Fornecedores } from './pages/Fornecedores';
import { CategoriasFinanceiras } from './pages/CategoriasFinanceiras';
import { Usuarios } from './pages/Usuarios';
import { Relatorios } from './pages/Relatorios';
import { Auditoria } from './pages/Auditoria';
import { Imprimir } from './pages/Imprimir';

/** RNF-01 / RNF-02: exige login e restringe a rota ao perfil */
function Protegida({ perfis, children }: { perfis: Perfil[]; children: ReactNode }) {
  const { pode } = useAuth();
  if (!pode(...perfis))
    return (
      <div className="vazio">
        <h2>Acesso não permitido</h2>
        <p>Esta funcionalidade não está disponível para o seu perfil.</p>
      </div>
    );
  return <>{children}</>;
}

const OP: Perfil[] = ['OPERADOR'];
const TODOS: Perfil[] = ['OPERADOR', 'TECNICO'];
const ADM: Perfil[] = [];

export function App() {
  const { usuario, carregando } = useAuth();

  if (!supabaseConfigurado)
    return (
      <div className="tela-login">
        <div className="cartao-login">
          <h1>Configuração pendente</h1>
          <p>
            Crie o arquivo <code>.env</code> com <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> (veja{' '}
            <code>.env.example</code> e o README).
          </p>
        </div>
      </div>
    );
  if (carregando) return <Carregando />;
  if (!usuario) return <Login />;

  const r = (perfis: Perfil[], el: ReactNode) => <Protegida perfis={perfis}>{el}</Protegida>;

  return (
    <Routes>
      <Route path="/imprimir/:tipo/:id" element={<Imprimir />} />
      <Route element={<Layout />}>
        <Route index element={<Inicio />} />
        <Route path="caixa" element={r(OP, <Caixa />)} />
        <Route path="extrato" element={r(OP, <Extrato />)} />
        <Route path="venda" element={r(OP, <Venda />)} />
        <Route path="vendas" element={r(OP, <Vendas />)} />
        <Route path="os" element={r(TODOS, <OSLista />)} />
        <Route path="os/nova" element={r(TODOS, <OSNova />)} />
        <Route path="os/:id" element={r(TODOS, <OSDetalhe />)} />
        <Route path="clientes" element={r(TODOS, <ClientesPagina />)} />
        <Route path="estoque" element={r(TODOS, <Estoque />)} />
        <Route path="produtos" element={r(OP, <Produtos />)} />
        <Route path="entradas" element={r(OP, <Entradas />)} />
        <Route path="fornecedores" element={r(OP, <Fornecedores />)} />
        <Route path="categorias-financeiras" element={r(ADM, <CategoriasFinanceiras />)} />
        <Route path="usuarios" element={r(ADM, <Usuarios />)} />
        <Route path="relatorios" element={r(ADM, <Relatorios />)} />
        <Route path="auditoria" element={r(ADM, <Auditoria />)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
