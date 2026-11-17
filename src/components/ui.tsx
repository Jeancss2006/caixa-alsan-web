import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

// ---------------------------------------------------------------- Toast
type Toast = { id: number; tipo: 'ok' | 'erro'; texto: string };
const ToastCtx = createContext<(tipo: Toast['tipo'], texto: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [lista, setLista] = useState<Toast[]>([]);
  const add = useCallback((tipo: Toast['tipo'], texto: string) => {
    const id = Date.now() + Math.random();
    setLista((l) => [...l, { id, tipo, texto }]);
    setTimeout(() => setLista((l) => l.filter((t) => t.id !== id)), tipo === 'erro' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={add}>
      {children}
      <div className="toasts" role="status">
        {lista.map((t) => (
          <div key={t.id} className={'toast ' + t.tipo} onClick={() => setLista((l) => l.filter((x) => x.id !== t.id))}>
            {t.texto}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const add = useContext(ToastCtx);
  return {
    ok: (t: string) => add('ok', t),
    erro: (e: unknown) => add('erro', e instanceof Error ? e.message : String(e)),
  };
}

// ---------------------------------------------------------------- Modal
export function Modal({
  titulo,
  aberto,
  onFechar,
  children,
  largura = 520,
  rodape,
}: {
  titulo: string;
  aberto: boolean;
  onFechar: () => void;
  children: ReactNode;
  largura?: number;
  rodape?: ReactNode;
}) {
  useEffect(() => {
    if (!aberto) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onFechar();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [aberto, onFechar]);
  if (!aberto) return null;
  return (
    <div className="modal-fundo" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div className="modal" style={{ maxWidth: largura }} role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="modal-topo">
          <h3>{titulo}</h3>
          <button className="btn-icone" onClick={onFechar} aria-label="Fechar" title="Fechar (Esc)">
            ×
          </button>
        </div>
        <div className="modal-corpo">{children}</div>
        {rodape && <div className="modal-rodape">{rodape}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Diálogo de motivo (cancelamentos, estornos)
export function MotivoModal({
  aberto,
  titulo,
  descricao,
  onFechar,
  onConfirmar,
  textoBotao = 'Confirmar',
}: {
  aberto: boolean;
  titulo: string;
  descricao?: ReactNode;
  onFechar: () => void;
  onConfirmar: (motivo: string) => Promise<void>;
  textoBotao?: string;
}) {
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const toast = useToast();
  useEffect(() => setMotivo(''), [aberto]);
  async function confirmar() {
    if (!motivo.trim()) return toast.erro('Informe o motivo.');
    setEnviando(true);
    try {
      await onConfirmar(motivo.trim());
      onFechar();
    } catch (e) {
      toast.erro(e);
    } finally {
      setEnviando(false);
    }
  }
  return (
    <Modal
      aberto={aberto}
      titulo={titulo}
      onFechar={onFechar}
      rodape={
        <>
          <button className="btn" onClick={onFechar}>
            Voltar
          </button>
          <button className="btn perigo" onClick={confirmar} disabled={enviando}>
            {textoBotao}
          </button>
        </>
      }
    >
      {descricao && <p className="muted">{descricao}</p>}
      <label className="campo">
        <span>Motivo *</span>
        <textarea autoFocus rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </label>
    </Modal>
  );
}

// ---------------------------------------------------------------- Campos
export function Campo({ rotulo, children, dica }: { rotulo: string; children: ReactNode; dica?: string }) {
  return (
    <label className="campo">
      <span>{rotulo}</span>
      {children}
      {dica && <small className="muted">{dica}</small>}
    </label>
  );
}

export function CampoValor(props: {
  valor: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  placeholder?: string;
  id?: string;
  onEnter?: () => void;
}) {
  return (
    <div className="input-moeda">
      <span>R$</span>
      <input
        id={props.id}
        inputMode="decimal"
        autoFocus={props.autoFocus}
        placeholder={props.placeholder ?? '0,00'}
        value={props.valor}
        onChange={(e) => props.onChange(e.target.value.replace(/[^\d.,]/g, ''))}
        onKeyDown={(e) => e.key === 'Enter' && props.onEnter?.()}
      />
    </div>
  );
}

export function Cabecalho({ titulo, children, sub }: { titulo: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="cabecalho">
      <div>
        <h1>{titulo}</h1>
        {sub && <p className="muted">{sub}</p>}
      </div>
      <div className="acoes">{children}</div>
    </div>
  );
}

export function Vazio({ children }: { children: ReactNode }) {
  return <div className="vazio">{children}</div>;
}

export function Carregando() {
  return <div className="vazio">Carregando…</div>;
}

export function Badge({ children, cor = 'neutro' }: { children: ReactNode; cor?: string }) {
  return <span className={'badge ' + cor}>{children}</span>;
}

export const corStatusOS: Record<string, string> = {
  ABERTA: 'azul',
  EM_MANUTENCAO: 'amarelo',
  AGUARDANDO_PECA: 'laranja',
  CONCLUIDA: 'verde',
  ENTREGUE: 'neutro',
  CANCELADA: 'vermelho',
};

// ---------------------------------------------------------------- Atalhos de teclado (RNF-17)
export function useAtalhos(mapa: Record<string, (e: KeyboardEvent) => void>, ativo = true) {
  const ref = useRef(mapa);
  ref.current = mapa;
  useEffect(() => {
    if (!ativo) return;
    const h = (e: KeyboardEvent) => {
      const fn = ref.current[e.key];
      if (fn) {
        e.preventDefault();
        fn(e);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [ativo]);
}

export function Tecla({ children }: { children: ReactNode }) {
  return <kbd>{children}</kbd>;
}

/** Carrega dados assíncronos com recarga manual */
export function useCarregar<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [dados, setDados] = useState<T | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    fn()
      .then((d) => vivo && (setDados(d), setErro(null)))
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : String(e)))
      .finally(() => vivo && setCarregando(false));
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, versao]);
  return { dados, carregando, erro, recarregar: () => setVersao((v) => v + 1), setDados };
}
