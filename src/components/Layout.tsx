import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth, type Perfil } from '../lib/auth';
import { PERFIS } from '../lib/format';
import { useAtalhos } from './ui';

interface Item {
  para: string;
  rotulo: string;
  perfis: Perfil[];
  icone: string;
}

// Perfis listados podem acessar; o administrador acessa tudo (RNF-02)
const MENU: { grupo: string; itens: Item[] }[] = [
  {
    grupo: 'Atendimento',
    itens: [
      { para: '/', rotulo: 'Início', perfis: ['OPERADOR', 'TECNICO'], icone: '⌂' },
      { para: '/venda', rotulo: 'Nova venda', perfis: ['OPERADOR'], icone: '🛒' },
      { para: '/os', rotulo: 'Ordens de serviço', perfis: ['OPERADOR', 'TECNICO'], icone: '🔧' },
      { para: '/clientes', rotulo: 'Clientes', perfis: ['OPERADOR', 'TECNICO'], icone: '👤' },
    ],
  },
  {
    grupo: 'Caixa',
    itens: [
      { para: '/caixa', rotulo: 'Meu caixa', perfis: ['OPERADOR'], icone: '💵' },
      { para: '/extrato', rotulo: 'Extrato do caixa', perfis: ['OPERADOR'], icone: '📄' },
      { para: '/vendas', rotulo: 'Vendas realizadas', perfis: ['OPERADOR'], icone: '🧾' },
    ],
  },
  {
    grupo: 'Estoque',
    itens: [
      { para: '/estoque', rotulo: 'Consultar estoque', perfis: ['OPERADOR', 'TECNICO'], icone: '📦' },
      { para: '/produtos', rotulo: 'Produtos', perfis: ['OPERADOR'], icone: '🏷' },
      { para: '/entradas', rotulo: 'Entrada de produtos', perfis: ['OPERADOR'], icone: '📥' },
      { para: '/fornecedores', rotulo: 'Fornecedores', perfis: ['OPERADOR'], icone: '🚚' },
    ],
  },
  {
    grupo: 'Administração',
    itens: [
      { para: '/relatorios', rotulo: 'Relatórios', perfis: [], icone: '📊' },
      { para: '/categorias-financeiras', rotulo: 'Categorias financeiras', perfis: [], icone: '🗂' },
      { para: '/usuarios', rotulo: 'Usuários', perfis: [], icone: '🔑' },
      { para: '/auditoria', rotulo: 'Auditoria', perfis: [], icone: '🛡' },
    ],
  },
];

export function Layout() {
  const { usuario, sair, pode } = useAuth();
  const nav = useNavigate();
  const [menuAberto, setMenuAberto] = useState(false);

  // Atalhos globais: F8 nova venda, F7 meu caixa
  useAtalhos({
    F8: () => pode('OPERADOR') && nav('/venda'),
    F7: () => pode('OPERADOR') && nav('/caixa'),
  });

  return (
    <div className="app">
      <aside className={'lateral' + (menuAberto ? ' aberto' : '')}>
        <div className="marca">
          <span className="logo">A</span>
          <div>
            <strong>Caixa Alsan</strong>
            <small>Loja de informática</small>
          </div>
        </div>
        <nav onClick={() => setMenuAberto(false)}>
          {MENU.map((g) => {
            const itens = g.itens.filter((i) => pode(...i.perfis));
            if (!itens.length) return null;
            return (
              <div key={g.grupo} className="grupo">
                <span className="grupo-titulo">{g.grupo}</span>
                {itens.map((i) => (
                  <NavLink key={i.para} to={i.para} end={i.para === '/'}>
                    <span className="ico" aria-hidden>
                      {i.icone}
                    </span>
                    {i.rotulo}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="usuario">
          <div>
            <strong>{usuario?.nome}</strong>
            <small>{usuario && PERFIS[usuario.perfil]}</small>
          </div>
          <button className="btn pequeno" onClick={() => sair()}>
            Sair
          </button>
        </div>
      </aside>
      <div className="conteudo">
        <header className="topo-movel">
          <button className="btn-icone" onClick={() => setMenuAberto((v) => !v)} aria-label="Menu">
            ☰
          </button>
          <strong>Caixa Alsan</strong>
        </header>
        <main>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
