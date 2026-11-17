import { useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { q, rpc, supabase } from '../lib/supabase';
import { brl, data, dataHora, FORMAS } from '../lib/format';
import { GARANTIA_DIAS, LOJA } from '../config';
import { Carregando, useCarregar } from '../components/ui';

type Formato = '80mm' | 'A4';

/** Comprovantes compatíveis com impressora térmica 80 mm e A4 (RF-30, RNF-14) */
export function Imprimir() {
  const { tipo, id } = useParams();
  const [formato, setFormato] = useState<Formato>(() => {
    try {
      return (localStorage.getItem('formato-impressao') as Formato) || '80mm';
    } catch {
      return '80mm';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('formato-impressao', formato);
    } catch {
      /* sem armazenamento */
    }
    const st = document.createElement('style');
    st.textContent = formato === '80mm' ? '@page { size: 80mm auto; margin: 3mm; }' : '@page { size: A4; margin: 15mm; }';
    document.head.appendChild(st);
    return () => st.remove();
  }, [formato]);

  const conteudo =
    tipo === 'venda' ? (
      <ComprovanteVenda id={Number(id)} />
    ) : tipo === 'os-entrada' ? (
      <ComprovanteOS id={Number(id)} entrega={false} />
    ) : tipo === 'os-entrega' ? (
      <ComprovanteOS id={Number(id)} entrega />
    ) : tipo === 'fechamento' ? (
      <RelatorioFechamento id={Number(id)} />
    ) : (
      <p>Documento desconhecido.</p>
    );

  return (
    <div className={'impressao ' + (formato === '80mm' ? 'termica' : 'a4')}>
      <div className="barra-impressao nao-imprimir">
        <div className="seg">
          {(['80mm', 'A4'] as Formato[]).map((f) => (
            <button key={f} className={formato === f ? 'on' : ''} onClick={() => setFormato(f)}>
              {f === '80mm' ? 'Térmica 80 mm' : 'Papel A4'}
            </button>
          ))}
        </div>
        <button className="btn primario" onClick={() => window.print()}>
          Imprimir
        </button>
        <button className="btn" onClick={() => window.close()}>
          Fechar
        </button>
      </div>
      <div className="papel">{conteudo}</div>
    </div>
  );
}

function CabecalhoLoja({ titulo }: { titulo: string }) {
  return (
    <header className="cab-loja">
      <strong className="loja-nome">{LOJA.nome}</strong>
      <div>CNPJ {LOJA.cnpj}</div>
      <div>{LOJA.endereco}</div>
      <div>{LOJA.telefone}</div>
      <h2>{titulo}</h2>
    </header>
  );
}

function Linha({ e, d, forte }: { e: ReactNode; d: ReactNode; forte?: boolean }) {
  return (
    <div className={'p-linha' + (forte ? ' forte' : '')}>
      <span>{e}</span>
      <span>{d}</span>
    </div>
  );
}

function useAutoPrint(pronto: boolean) {
  useEffect(() => {
    if (pronto) setTimeout(() => window.print(), 400);
  }, [pronto]);
}

function ComprovanteVenda({ id }: { id: number }) {
  const d = useCarregar(async () => {
    const [v, itens, pags] = await Promise.all([
      q<any>(supabase.from('vendas').select('*, cliente:clientes(nome, cpf_cnpj), operador:usuarios!operador_id(nome)').eq('id', id).single()),
      q<any[]>(supabase.from('itens_venda').select('*, produto:produtos(descricao, codigo)').eq('venda_id', id).order('id')),
      q<any[]>(supabase.from('pagamentos').select('*').eq('venda_id', id).order('id')),
    ]);
    return { v, itens, pags };
  });
  useAutoPrint(!!d.dados);
  if (!d.dados) return <Carregando />;
  const { v, itens, pags } = d.dados;
  return (
    <>
      <CabecalhoLoja titulo={`Comprovante de venda nº ${v.id}`} />
      <p className="centro">Não é documento fiscal</p>
      <Linha e="Data" d={dataHora(v.data_hora)} />
      <Linha e="Operador" d={v.operador?.nome} />
      {v.cliente && <Linha e="Cliente" d={v.cliente.nome} />}
      {v.status === 'CANCELADA' && <p className="p-cancelado">VENDA CANCELADA</p>}
      <hr />
      {itens.map((i) => (
        <div key={i.id} className="p-item">
          <div>{i.produto?.descricao}</div>
          <Linha e={`${i.quantidade} x ${brl(i.preco_unitario)}`} d={brl(i.quantidade * i.preco_unitario)} />
        </div>
      ))}
      <hr />
      <Linha e="Subtotal" d={brl(v.subtotal)} />
      {Number(v.desconto) > 0 && <Linha e="Desconto" d={'- ' + brl(v.desconto)} />}
      <Linha e="TOTAL" d={brl(v.valor_total)} forte />
      <hr />
      {pags.map((p) => (
        <div key={p.id}>
          <Linha e={FORMAS[p.forma] + (p.parcelas > 1 ? ` ${p.parcelas}x` : '')} d={brl(p.valor_recebido ?? p.valor)} />
          {Number(p.troco) > 0 && <Linha e="Troco" d={brl(p.troco)} />}
        </div>
      ))}
      <p className="centro p-rodape">Obrigado pela preferência!</p>
    </>
  );
}

function ComprovanteOS({ id, entrega }: { id: number; entrega: boolean }) {
  const d = useCarregar(async () => {
    const [o, itens, pags] = await Promise.all([
      q<any>(
        supabase
          .from('ordens_servico')
          .select('*, cliente:clientes(*), tecnico:usuarios!tecnico_id(nome), original:ordens_servico!garantia_de_id(numero)')
          .eq('id', id)
          .single(),
      ),
      q<any[]>(supabase.from('itens_os').select('*, produto:produtos(descricao)').eq('os_id', id).order('id')),
      entrega ? q<any[]>(supabase.from('pagamentos').select('*').eq('os_id', id).order('id')) : Promise.resolve([]),
    ]);
    return { o, itens, pags };
  });
  useAutoPrint(!!d.dados);
  if (!d.dados) return <Carregando />;
  const { o, itens, pags } = d.dados;
  const garantiaAte = o.data_entrega ? new Date(new Date(o.data_entrega).getTime() + GARANTIA_DIAS * 86400000) : null;
  return (
    <>
      <CabecalhoLoja titulo={`${entrega ? 'Comprovante de entrega' : 'Comprovante de entrada'} – OS nº ${o.numero}`} />
      {o.original && <p className="centro">Retorno em garantia da OS nº {o.original.numero}</p>}
      <Linha e="Abertura" d={dataHora(o.data_abertura)} />
      {entrega && <Linha e="Entrega" d={dataHora(o.data_entrega)} />}
      <hr />
      <Linha e="Cliente" d={o.cliente?.nome} />
      {o.cliente?.telefone && <Linha e="Telefone" d={o.cliente.telefone} />}
      <hr />
      <div className="p-bloco">
        <strong>Equipamento:</strong> {o.equipamento}
      </div>
      <div className="p-bloco">
        <strong>Defeito relatado:</strong> {o.defeito_relatado}
      </div>
      <div className="p-bloco">
        <strong>Acessórios entregues:</strong> {o.acessorios || 'nenhum'}
      </div>
      {entrega ? (
        <>
          {o.diagnostico && (
            <div className="p-bloco">
              <strong>Diagnóstico:</strong> {o.diagnostico}
            </div>
          )}
          {o.servico_executado && (
            <div className="p-bloco">
              <strong>Serviço executado:</strong> {o.servico_executado}
            </div>
          )}
          <Linha e="Técnico" d={o.tecnico?.nome ?? '—'} />
          <hr />
          {itens.map((i) => (
            <div key={i.id} className="p-item">
              <div>{i.produto?.descricao}</div>
              <Linha e={`${i.quantidade} x ${brl(i.preco_unitario)}`} d={brl(i.quantidade * i.preco_unitario)} />
            </div>
          ))}
          <Linha e="Mão de obra" d={brl(o.valor_mao_de_obra)} />
          {Number(o.desconto) > 0 && <Linha e="Desconto" d={'- ' + brl(o.desconto)} />}
          <Linha e="TOTAL" d={brl(o.valor_total)} forte />
          <hr />
          {pags.map((p) => (
            <div key={p.id}>
              <Linha e={FORMAS[p.forma] + (p.parcelas > 1 ? ` ${p.parcelas}x` : '')} d={brl(p.valor_recebido ?? p.valor)} />
              {Number(p.troco) > 0 && <Linha e="Troco" d={brl(p.troco)} />}
            </div>
          ))}
          <p className="p-rodape">
            Garantia de {GARANTIA_DIAS} dias para o serviço executado, válida até {data(garantiaAte)}, para o mesmo defeito.
          </p>
        </>
      ) : (
        <p className="p-rodape">
          Apresente este comprovante para retirar o equipamento. Equipamentos não retirados em até 90 dias após a conclusão poderão ter
          cobrança de armazenagem.
        </p>
      )}
      <div className="assinatura">Assinatura do cliente</div>
    </>
  );
}

function RelatorioFechamento({ id }: { id: number }) {
  const d = useCarregar(() => rpc<any>('resumo_caixa', { p_caixa: id }));
  useAutoPrint(!!d.dados);
  if (d.erro) return <p>{d.erro}</p>;
  if (!d.dados) return <Carregando />;
  const r = d.dados;
  const c = r.caixa;
  return (
    <>
      <CabecalhoLoja titulo={`Fechamento de caixa nº ${c.id}`} />
      <Linha e="Operador" d={c.operador} />
      <Linha e="Abertura" d={dataHora(c.data_abertura)} />
      <Linha e="Fechamento" d={c.data_fechamento ? dataHora(c.data_fechamento) : 'em aberto'} />
      <hr />
      <Linha e="Saldo inicial" d={brl(c.saldo_inicial)} />
      <Linha e="Total de entradas" d={brl(r.total_entradas)} />
      <Linha e="Total de saídas" d={brl(r.total_saidas)} />
      <Linha e="Saldo final" d={brl(r.saldo_final)} forte />
      <hr />
      <strong>Totais por forma de pagamento</strong>
      {(r.por_forma ?? []).map((f: any) => (
        <Linha key={f.forma} e={FORMAS[f.forma]} d={`${brl(f.entradas)} / -${brl(f.saidas)}`} />
      ))}
      <hr />
      {c.status === 'FECHADO' && (
        <>
          <Linha e="Esperado em dinheiro" d={brl(c.saldo_esperado)} />
          <Linha e="Contado em dinheiro" d={brl(c.valor_contado)} />
          <Linha e="Diferença" d={brl(c.diferenca)} forte />
          {c.justificativa && (
            <div className="p-bloco">
              <strong>Justificativa:</strong> {c.justificativa}
            </div>
          )}
        </>
      )}
      <div className="assinatura">Assinatura do operador</div>
    </>
  );
}
