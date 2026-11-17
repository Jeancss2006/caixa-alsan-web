import { createClient } from '@supabase/supabase-js';
import { useEffect, useRef, useState } from 'react';
import { ErroNegocio } from '../lib/supabase';
import { brl, centavos, FORMAS, lerValor, reais, valorParaCampo } from '../lib/format';
import { CampoValor, Campo, Modal, Tecla, useAtalhos, useToast } from './ui';

export type FormaPagamento = 'DINHEIRO' | 'PIX' | 'CARTAO_DEBITO' | 'CARTAO_CREDITO';

export interface PagamentoEnvio {
  forma: FormaPagamento;
  valor: number;
  valor_recebido?: number;
  codigo_transacao?: string;
  bandeira?: string;
  parcelas?: number;
}

interface Linha {
  forma: FormaPagamento;
  valor: string;
  codigo_transacao: string;
  bandeira: string;
  parcelas: string;
}

const ORDEM: FormaPagamento[] = ['DINHEIRO', 'PIX', 'CARTAO_DEBITO', 'CARTAO_CREDITO'];

/**
 * Registrar pagamento (UC-14) com uma ou mais formas (RF-35) e cálculo de troco (UC-15 / RF-36).
 * Em dinheiro, informa-se o valor entregue pelo cliente; o sistema abate o restante e calcula o troco.
 */
export function PagamentoModal({
  aberto,
  totalCentavos,
  titulo,
  onFechar,
  onConfirmar,
}: {
  aberto: boolean;
  totalCentavos: number;
  titulo: string;
  onFechar: () => void;
  onConfirmar: (pagamentos: PagamentoEnvio[]) => Promise<void>;
}) {
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [enviando, setEnviando] = useState(false);
  const toast = useToast();
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (aberto) setLinhas([]);
  }, [aberto]);

  const naoDinheiro = linhas.filter((l) => l.forma !== 'DINHEIRO').reduce((s, l) => s + centavos(lerValor(l.valor) || 0), 0);
  const dinheiroEntregue = linhas.filter((l) => l.forma === 'DINHEIRO').reduce((s, l) => s + centavos(lerValor(l.valor) || 0), 0);
  const restanteAposOutras = totalCentavos - naoDinheiro;
  const dinheiroAplicado = Math.max(0, Math.min(dinheiroEntregue, restanteAposOutras));
  const troco = dinheiroEntregue - dinheiroAplicado;
  const pago = naoDinheiro + dinheiroAplicado;
  const falta = totalCentavos - pago;
  const temDinheiro = linhas.some((l) => l.forma === 'DINHEIRO');

  let problema = '';
  if (naoDinheiro > totalCentavos) problema = 'Pagamentos em Pix/cartão ultrapassam o total (troco só é permitido em dinheiro).';
  else if (temDinheiro && dinheiroEntregue > 0 && dinheiroAplicado === 0) problema = 'Não há saldo a pagar em dinheiro.';
  else if (falta > 0) problema = `Falta ${brl(reais(falta))}`;

  function adicionar(forma: FormaPagamento) {
    const restante = Math.max(0, totalCentavos - pago);
    if (forma === 'DINHEIRO' && temDinheiro) {
      const i = linhas.findIndex((l) => l.forma === 'DINHEIRO');
      refs.current[i]?.focus();
      return;
    }
    setLinhas((ls) => [
      ...ls,
      { forma, valor: restante ? valorParaCampo(reais(restante)) : '', codigo_transacao: '', bandeira: '', parcelas: '1' },
    ]);
    setTimeout(() => {
      const el = refs.current[linhas.length];
      el?.focus();
      el?.select();
    }, 30);
  }

  async function confirmar() {
    if (problema) return toast.erro(problema);
    const envio: PagamentoEnvio[] = [];
    for (const l of linhas) {
      const v = centavos(lerValor(l.valor) || 0);
      if (v <= 0) continue;
      if (l.forma === 'DINHEIRO') {
        if (dinheiroAplicado > 0)
          envio.push({ forma: 'DINHEIRO', valor: reais(dinheiroAplicado), valor_recebido: reais(dinheiroEntregue) });
      } else
        envio.push({
          forma: l.forma,
          valor: reais(v),
          codigo_transacao: l.forma === 'PIX' ? l.codigo_transacao || undefined : undefined,
          bandeira: l.forma.startsWith('CARTAO') ? l.bandeira || undefined : undefined,
          parcelas: l.forma === 'CARTAO_CREDITO' ? Number(l.parcelas) || 1 : undefined,
        });
    }
    setEnviando(true);
    try {
      await onConfirmar(envio);
    } catch (e) {
      if (!(e instanceof ErroNegocio && e.codigo === 'CXAUT')) toast.erro(e);
    } finally {
      setEnviando(false);
    }
  }

  useAtalhos(
    {
      F1: () => adicionar('DINHEIRO'),
      F2: () => adicionar('PIX'),
      F3: () => adicionar('CARTAO_DEBITO'),
      F4: () => adicionar('CARTAO_CREDITO'),
      F10: () => confirmar(),
    },
    aberto,
  );

  return (
    <Modal
      aberto={aberto}
      titulo={titulo}
      onFechar={onFechar}
      largura={620}
      rodape={
        <>
          <button className="btn" onClick={onFechar}>
            Voltar <Tecla>Esc</Tecla>
          </button>
          <button className="btn primario grande" onClick={confirmar} disabled={enviando || !!problema}>
            Confirmar recebimento <Tecla>F10</Tecla>
          </button>
        </>
      }
    >
      <div className="pag-total">
        <span>Total a receber</span>
        <strong>{brl(reais(totalCentavos))}</strong>
      </div>
      <div className="pag-formas">
        {ORDEM.map((f, i) => (
          <button key={f} className="btn" onClick={() => adicionar(f)}>
            {FORMAS[f]} <Tecla>F{i + 1}</Tecla>
          </button>
        ))}
      </div>
      {linhas.length === 0 && <p className="muted centro">Escolha a forma de pagamento (é possível combinar mais de uma).</p>}
      {linhas.map((l, i) => (
        <div className="pag-linha" key={i}>
          <div className="pag-forma">{FORMAS[l.forma]}</div>
          <div className="pag-campos">
            <Campo rotulo={l.forma === 'DINHEIRO' ? 'Valor entregue pelo cliente' : 'Valor'}>
              <div className="input-moeda">
                <span>R$</span>
                <input
                  ref={(el) => (refs.current[i] = el)}
                  inputMode="decimal"
                  value={l.valor}
                  onChange={(e) =>
                    setLinhas((ls) => ls.map((x, j) => (j === i ? { ...x, valor: e.target.value.replace(/[^\d.,]/g, '') } : x)))
                  }
                  onKeyDown={(e) => e.key === 'Enter' && confirmar()}
                />
              </div>
            </Campo>
            {l.forma === 'PIX' && (
              <Campo rotulo="Código da transação">
                <input
                  value={l.codigo_transacao}
                  onChange={(e) => setLinhas((ls) => ls.map((x, j) => (j === i ? { ...x, codigo_transacao: e.target.value } : x)))}
                />
              </Campo>
            )}
            {l.forma.startsWith('CARTAO') && (
              <Campo rotulo="Bandeira">
                <input
                  value={l.bandeira}
                  placeholder="Visa, Master…"
                  onChange={(e) => setLinhas((ls) => ls.map((x, j) => (j === i ? { ...x, bandeira: e.target.value } : x)))}
                />
              </Campo>
            )}
            {l.forma === 'CARTAO_CREDITO' && (
              <Campo rotulo="Parcelas">
                <select
                  value={l.parcelas}
                  onChange={(e) => setLinhas((ls) => ls.map((x, j) => (j === i ? { ...x, parcelas: e.target.value } : x)))}
                >
                  {Array.from({ length: 12 }, (_, k) => (
                    <option key={k + 1} value={k + 1}>
                      {k + 1}x
                    </option>
                  ))}
                </select>
              </Campo>
            )}
          </div>
          <button className="btn-icone" onClick={() => setLinhas((ls) => ls.filter((_, j) => j !== i))} aria-label="Remover">
            ×
          </button>
        </div>
      ))}
      <div className="pag-resumo">
        <div>
          <span>Recebido</span>
          <strong>{brl(reais(pago))}</strong>
        </div>
        <div className={falta > 0 ? 'txt-alerta' : ''}>
          <span>Falta</span>
          <strong>{brl(reais(Math.max(falta, 0)))}</strong>
        </div>
        <div className={troco > 0 ? 'troco' : ''}>
          <span>Troco</span>
          <strong>{brl(reais(troco))}</strong>
        </div>
      </div>
      {problema && falta <= 0 && <p className="txt-erro">{problema}</p>}
    </Modal>
  );
}

/**
 * Autorização do administrador (RN-07 e desconto acima do limite).
 * O administrador digita login e senha; é gerado um token de uso único, válido por 5 minutos.
 */
export function AutorizacaoModal({
  aberto,
  motivo,
  onFechar,
  onAutorizado,
}: {
  aberto: boolean;
  motivo: string;
  onFechar: () => void;
  onAutorizado: (token: string) => void;
}) {
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (aberto) {
      setLogin('');
      setSenha('');
    }
  }, [aberto]);

  async function autorizar() {
    setEnviando(true);
    try {
      const resp = await fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ login, senha }),
      });
      const tokens = await resp.json();
      if (!resp.ok) throw new Error(tokens.erro || 'Falha na autenticação.');
      // cliente isolado: não altera a sessão do operador logado
      const temp = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, storageKey: 'autorizacao-temp' },
      });
      await temp.auth.setSession(tokens);
      const { data, error } = await temp.rpc('gerar_autorizacao');
      await temp.auth.signOut({ scope: 'local' });
      if (error) throw new Error(error.message.includes('perfil') ? 'Somente um administrador pode autorizar.' : error.message);
      onAutorizado(data as string);
    } catch (e) {
      toast.erro(e);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal
      aberto={aberto}
      titulo="Autorização do administrador"
      onFechar={onFechar}
      largura={420}
      rodape={
        <>
          <button className="btn" onClick={onFechar}>
            Cancelar
          </button>
          <button className="btn primario" onClick={autorizar} disabled={enviando || !login || !senha}>
            Autorizar
          </button>
        </>
      }
    >
      <p className="aviso">{motivo}</p>
      <Campo rotulo="Login do administrador">
        <input autoFocus value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="off" />
      </Campo>
      <Campo rotulo="Senha">
        <input
          type="password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && autorizar()}
          autoComplete="off"
        />
      </Campo>
    </Modal>
  );
}

/**
 * Executa uma operação; se o banco exigir autorização do administrador (código CXAUT),
 * abre o modal e repete a operação com o token.
 */
export function useAutorizacao() {
  const [pendente, setPendente] = useState<{ motivo: string; repetir: (t: string) => Promise<void> } | null>(null);
  const toast = useToast();

  async function executar(fn: (token?: string) => Promise<void>) {
    try {
      await fn();
    } catch (e) {
      if (e instanceof ErroNegocio && e.codigo === 'CXAUT') {
        setPendente({ motivo: e.message, repetir: (t) => fn(t) });
      }
      throw e;
    }
  }

  const modal = (
    <AutorizacaoModal
      aberto={!!pendente}
      motivo={pendente?.motivo ?? ''}
      onFechar={() => setPendente(null)}
      onAutorizado={async (token) => {
        const p = pendente;
        setPendente(null);
        try {
          await p?.repetir(token);
        } catch (e) {
          toast.erro(e);
        }
      }}
    />
  );
  return { executar, modal };
}

/** Campo de desconto em valor (R$) ou percentual (RF-34) */
export function DescontoCampo({
  brutoCentavos,
  onChange,
  inputId,
}: {
  brutoCentavos: number;
  onChange: (descontoCentavos: number) => void;
  inputId?: string;
}) {
  const [modo, setModo] = useState<'R$' | '%'>('R$');
  const [txt, setTxt] = useState('');
  useEffect(() => {
    const n = lerValor(txt);
    if (!txt || isNaN(n)) return onChange(0);
    onChange(modo === '%' ? Math.round((brutoCentavos * Math.min(n, 100)) / 100) : Math.min(centavos(n), brutoCentavos));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txt, modo, brutoCentavos]);
  return (
    <div className="desconto">
      <div className="seg">
        {(['R$', '%'] as const).map((m) => (
          <button key={m} type="button" className={modo === m ? 'on' : ''} onClick={() => setModo(m)}>
            {m}
          </button>
        ))}
      </div>
      {modo === 'R$' ? (
        <CampoValor id={inputId} valor={txt} onChange={setTxt} />
      ) : (
        <input id={inputId} inputMode="decimal" placeholder="0" value={txt} onChange={(e) => setTxt(e.target.value.replace(/[^\d.,]/g, ''))} />
      )}
    </div>
  );
}
