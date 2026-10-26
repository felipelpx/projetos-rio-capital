import React, { useState, useMemo } from "react";
import { useVendas, useFracoes, useSaldosAtuais } from "./hooks.js";
import { faturaPaga, faturaAtrasada } from "./status.js";
import { fmtEuro, fmtNum, fmtPercent } from "./format.js";
import { REAL_ORCADO_PROJECTS } from "./planos.js";

const fmt = (v) => fmtEuro(v);
const fmt0 = (v) => fmtEuro(v, 0);
const fmtDate = (s) => {
  if (!s || typeof s !== "string" || s.length < 10) return s || "—";
  const m = s.substring(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
};

const NAVY = "#1a1a2e";
const OURO = "#C8A96E";
const VERDE = "#16a34a";
const VERMELHO = "#dc2626";
const AMBAR = "#b45309";

const ESTADO_VENDA = {
  "Disponível":  { fundo: "#f1f5f9", cor: "#64748b" },
  "Reservada":   { fundo: "#fef3c7", cor: "#b45309" },
  "CPCV":        { fundo: "#dbeafe", cor: "#1d4ed8" },
  "Escriturada": { fundo: "#dcfce7", cor: "#15803d" },
};

// Cartão com título, explicação em linguagem simples e conteúdo
function Bloco({ titulo, explica, children, acao }) {
  return (
    <section style={{ background: "#fff", borderRadius: 14, padding: "22px 24px", boxShadow: "0 1px 10px rgba(0,0,0,0.05)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, fontFamily: "Georgia, serif", color: NAVY }}>{titulo}</h2>
          {explica && <p style={{ margin: "4px 0 0", fontSize: 12, color: "#8a8a96", lineHeight: 1.5, maxWidth: 660 }}>{explica}</p>}
        </div>
        {acao}
      </div>
      {children}
    </section>
  );
}

// Número grande com legenda explicada
function Indicador({ rotulo, valor, ajuda, cor = NAVY, destaque }) {
  return (
    <div style={{
      background: destaque ? NAVY : "#fff",
      borderRadius: 12,
      padding: "16px 18px",
      boxShadow: "0 1px 10px rgba(0,0,0,0.05)",
      borderTop: `3px solid ${destaque ? OURO : cor}`,
    }}>
      <div style={{ fontSize: 12, color: destaque ? "#cfcfe0" : "#8a8a96", marginBottom: 6 }}>{rotulo}</div>
      <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "monospace", color: destaque ? "#fff" : cor, letterSpacing: "-0.02em" }}>
        {valor}
      </div>
      {ajuda && <div style={{ fontSize: 11, color: destaque ? "#9a9ab0" : "#b0b0bb", marginTop: 6, lineHeight: 1.45 }}>{ajuda}</div>}
    </div>
  );
}

function Barra({ parte, total, cor }) {
  const pct = total > 0 ? Math.min((Math.abs(parte) / Math.abs(total)) * 100, 100) : 0;
  return (
    <div style={{ height: 6, background: "#f0f0f3", borderRadius: 3, overflow: "hidden" }}>
      <div style={{ width: pct + "%", height: "100%", background: cor, borderRadius: 3 }} />
    </div>
  );
}

function Vazio({ children }) {
  return <div style={{ padding: "24px 4px", fontSize: 12, color: "#a0a0ac", textAlign: "center" }}>{children}</div>;
}

const th = { padding: "9px 12px", textAlign: "left", fontSize: 10, color: "#9a9aa6", fontWeight: 600, borderBottom: "1px solid #eee", whiteSpace: "nowrap" };
const td = { padding: "9px 12px", fontSize: 12, color: "#3a3a44", borderBottom: "1px solid #f6f6f8" };
const tdNum = { ...td, fontFamily: "monospace", whiteSpace: "nowrap", textAlign: "right" };

export default function BIView({ EMPRESAS = [], caixaUnico, faturas = [], pagamentosExtras = [] }) {
  const { vendas, loading: vendasLoading } = useVendas();
  const { fracoes } = useFracoes();

  const [modo, setModo] = useState("geral");          // geral | negocio
  const [secao, setSecao] = useState("corrente");     // corrente | orcamento | vendas
  const [empresaId, setEmpresaId] = useState(EMPRESAS[0]?.id || "");

  const hojeISO = new Date().toISOString().slice(0, 10);
  const em30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  // ── Saldos bancários reais (último movimento de cada conta) ────────────────
  const contasTodas = useMemo(() => {
    const out = [];
    EMPRESAS.forEach(e => {
      // As contas vêm de empresas.js, a fonte única. O snapshot estático ainda
      // guarda contas antigas ("Cartão 7449", "Caixa Livre") que já não existem.
      const contas = e.contas || [];
      contas.forEach(c => out.push({
        empresaId: e.id,
        empresa: e.nome,
        projeto: e.projeto,
        contaId: c.id || c.conta_id,
        banco: c.banco,
        saldoEstatico: parseFloat(c.saldo) || 0,
      }));
    });
    return out;
  }, [EMPRESAS, caixaUnico]);

  const { saldos } = useSaldosAtuais(contasTodas.map(c => c.contaId));
  const contas = contasTodas.map(c => ({
    ...c,
    // Só o saldo da base de dados. O snapshot estático guarda saldos de
    // importações antigas e mostrava valores de dados que já não existem.
    saldo: saldos && saldos[c.contaId] != null ? saldos[c.contaId] : 0,
  }));

  const empresaSel = EMPRESAS.find(e => e.id === empresaId) || EMPRESAS[0];
  const geral = modo === "geral";
  const projetoSel = empresaSel?.projeto || "";

  // ── Recortes conforme o modo ───────────────────────────────────────────────
  const contasVis = geral ? contas : contas.filter(c => c.empresaId === empresaId);
  const faturasVis = (faturas || []).filter(f => geral || f.empresa === empresaId);
  const extrasVis = (pagamentosExtras || []).filter(p => geral || p.empresa === empresaId);

  // As vendas ligam-se à empresa pelo nome do projeto da fração
  const vendasVis = useMemo(() => {
    const comFracao = (vendas || []).map(v => ({ ...v, _frac: fracoes.find(f => f.id === v.fracao_id) }));
    if (geral) return comFracao;
    return comFracao.filter(v => v._frac?.projeto && projetoSel && v._frac.projeto === projetoSel);
  }, [vendas, fracoes, geral, projetoSel]);

  // ── Totais ─────────────────────────────────────────────────────────────────
  const caixa = contasVis.reduce((s, c) => s + c.saldo, 0);

  // "Saldo fim de linha": a caixa das sociedades de topo, onde o dinheiro do
  // grupo efectivamente se acumula. As SPE de projeto ficam de fora.
  const FIM_DE_LINHA = ["barramansa", "nimitz", "visionary", "riocap"];
  const fimDeLinha = useMemo(() => {
    const linhas = FIM_DE_LINHA
      .map(id => {
        const e = EMPRESAS.find(x => x.id === id);
        if (!e) return null;
        const suas = contas.filter(c => c.empresaId === id);
        return { id, nome: e.nome, projeto: e.projeto, saldo: suas.reduce((s, c) => s + c.saldo, 0), nContas: suas.length };
      })
      .filter(Boolean);
    return { linhas, total: linhas.reduce((s, l) => s + l.saldo, 0), emFalta: FIM_DE_LINHA.filter(id => !EMPRESAS.some(e => e.id === id)) };
  }, [EMPRESAS, contas]);

  // Contas a pagar = apenas o que está no fluxo futuro: custo real (fatura por
  // liquidar) e forecast (previsão sem fatura). As comissões deixaram de ser
  // geridas à parte — entram como previsão e convertem-se em custo real quando
  // chega a fatura do mediador, por isso não são somadas aqui (duplicariam).
  const porPagar = useMemo(() => {
    const real = faturasVis.filter(f => !faturaPaga(f));
    const forecast = extrasVis.filter(p => p.tipo !== "entrada" && !["Paga", "Pago", "Convertida"].includes(p.status));
    return {
      faturas: real.reduce((s, f) => s + (parseFloat(f.valor) || 0), 0),
      previsto: forecast.reduce((s, p) => s + (parseFloat(p.valor) || 0), 0),
      nReal: real.length,
      nForecast: forecast.length,
      vencido: real.filter(f => f.vencimento && f.vencimento < hojeISO).reduce((s, f) => s + (parseFloat(f.valor) || 0), 0),
      proximos30: real.filter(f => f.vencimento && f.vencimento >= hojeISO && f.vencimento <= em30).reduce((s, f) => s + (parseFloat(f.valor) || 0), 0),
      lista: real,
    };
  }, [faturasVis, extrasVis, hojeISO, em30]);

  const porReceber = useMemo(() => {
    const vendasFalta = vendasVis.reduce((s, v) => s + (parseFloat(v.falta_receber) || 0), 0);
    const extrasEntrada = extrasVis.filter(p => p.tipo === "entrada" && !["Paga", "Pago", "Convertida"].includes(p.status));
    return {
      vendas: vendasFalta,
      outros: extrasEntrada.reduce((s, p) => s + (parseFloat(p.valor) || 0), 0),
      lista: vendasVis.filter(v => (parseFloat(v.falta_receber) || 0) > 0),
    };
  }, [vendasVis, extrasVis]);

  const totalPagar = porPagar.faturas + porPagar.previsto;
  const totalReceber = porReceber.vendas + porReceber.outros;
  const posicao = caixa + totalReceber - totalPagar;

  // Unidades (frações) do âmbito, por estado de comercialização
  const unidades = useMemo(() => {
    const lista = geral ? fracoes : fracoes.filter(f => projetoSel && f.projeto === projetoSel);
    const porEstado = {};
    lista.forEach(f => { porEstado[f.status || "—"] = (porEstado[f.status || "—"] || 0) + 1; });
    return { total: lista.length, porEstado };
  }, [fracoes, geral, projetoSel]);

  // Vendas agrupadas por sociedade, na mesma ordem da lista de empresas.
  // A ligação é o nome do projeto da fração; o que não corresponder a nenhuma
  // sociedade fica num grupo final em vez de desaparecer.
  const vendasPorEmpresa = useMemo(() => {
    const grupos = [];
    const usados = new Set();
    EMPRESAS.forEach(e => {
      if (!e.projeto) return;
      const linhas = vendasVis.filter(v => v._frac?.projeto === e.projeto);
      linhas.forEach(v => usados.add(v.id));
      if (linhas.length) grupos.push({ chave: e.id, titulo: `${e.nome} · ${e.projeto}`, linhas });
    });
    const orfas = vendasVis.filter(v => !usados.has(v.id));
    if (orfas.length) grupos.push({ chave: "__outros__", titulo: "Sem sociedade associada", linhas: orfas });
    return grupos.map(g => ({
      ...g,
      vgv: g.linhas.reduce((s, v) => s + (parseFloat(v.valor_venda) || 0), 0),
      recebido: g.linhas.reduce((s, v) => s + (parseFloat(v.recebemos) || 0), 0),
      falta: g.linhas.reduce((s, v) => s + (parseFloat(v.falta_receber) || 0), 0),
    }));
  }, [EMPRESAS, vendasVis]);

  const resumoVendas = useMemo(() => ({
    n: vendasVis.length,
    vgv: vendasVis.reduce((s, v) => s + (parseFloat(v.valor_venda) || 0), 0),
    recebido: vendasVis.reduce((s, v) => s + (parseFloat(v.recebemos) || 0), 0),
    falta: vendasVis.reduce((s, v) => s + (parseFloat(v.falta_receber) || 0), 0),
  }), [vendasVis]);

  // ── Plano de negócio ───────────────────────────────────────────────────────
  const planos = useMemo(() => {
    if (geral) return REAL_ORCADO_PROJECTS;
    return REAL_ORCADO_PROJECTS.filter(p =>
      p.nome === projetoSel || p.nome.toLowerCase().includes((projetoSel || "\u0000").toLowerCase())
    );
  }, [geral, projetoSel]);

  const resumoPlano = (dados) => {
    const rec = dados.filter(d => d.grupo === "receita" && d.categoria !== "VENDAS LÍQUIDAS");
    const cus = dados.filter(d => ["capex", "obra", "opex"].includes(d.grupo));
    const res = dados.find(d => d.grupo === "resultado");
    return {
      recOrcado: rec.reduce((s, d) => s + d.orcado, 0),
      recReal: rec.reduce((s, d) => s + d.realizado, 0),
      cusOrcado: Math.abs(cus.reduce((s, d) => s + d.orcado, 0)),
      cusReal: Math.abs(cus.reduce((s, d) => s + d.realizado, 0)),
      lucroOrcado: res?.orcado || 0,
      linhas: [...rec, ...cus],
    };
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

      {/* Escolha do âmbito */}
      <div style={{ background: "#fff", borderRadius: 14, padding: "18px 24px", boxShadow: "0 1px 10px rgba(0,0,0,0.05)" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={() => setModo("geral")}
            style={{ background: geral ? NAVY : "#f2f2f5", color: geral ? "#fff" : "#77777f", border: "none", padding: "10px 22px", borderRadius: 10, fontSize: 13, cursor: "pointer", fontWeight: 700, fontFamily: "Georgia, serif" }}>
            Geral
          </button>
          <button onClick={() => setModo("negocio")}
            style={{ background: !geral ? NAVY : "#f2f2f5", color: !geral ? "#fff" : "#77777f", border: "none", padding: "10px 22px", borderRadius: 10, fontSize: 13, cursor: "pointer", fontWeight: 700, fontFamily: "Georgia, serif" }}>
            Por negócio
          </button>
          <span style={{ fontSize: 12, color: "#9a9aa6", marginLeft: 4 }}>
            {geral ? "Tudo somado: as 11 sociedades do grupo." : "Uma sociedade de cada vez, com o seu projeto."}
          </span>
        </div>

        {!geral && (
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 14, paddingTop: 14, borderTop: "1px solid #f2f2f5" }}>
            {EMPRESAS.map(e => (
              <button key={e.id} onClick={() => setEmpresaId(e.id)}
                style={{ background: empresaId === e.id ? OURO : "#fff", color: empresaId === e.id ? "#fff" : "#66666e", border: `1px solid ${empresaId === e.id ? OURO : "#e8e8ee"}`, padding: "7px 13px", borderRadius: 8, fontSize: 12, cursor: "pointer", fontWeight: empresaId === e.id ? 700 : 400 }}>
                {e.nome}{e.projeto ? ` · ${e.projeto}` : ""}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* O que o utilizador quer ver */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {[
          ["corrente", "Conta corrente", "Caixa disponível por conta"],
          ["pagar", "Contas a pagar", "Faturas e previsões por liquidar"],
          ["receber", "A receber", "Dinheiro de vendas ainda por entrar"],
          ["orcamento", "Orçamento", "Plano de negócio: real contra orçado"],
          ["vendas", "Tabela de vendas", "Unidades, clientes e valores"],
        ].map(([id, titulo, sub]) => {
          const on = secao === id;
          return (
            <button key={id} onClick={() => setSecao(id)}
              style={{
                flex: "1 1 170px", textAlign: "left", cursor: "pointer",
                background: on ? "#fff" : "#fbfbfd",
                border: `1px solid ${on ? OURO : "#ececf2"}`,
                borderLeft: `4px solid ${on ? OURO : "#ececf2"}`,
                borderRadius: 11, padding: "13px 16px",
                boxShadow: on ? "0 2px 12px rgba(0,0,0,0.06)" : "none",
              }}>
              <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "Georgia, serif", color: on ? NAVY : "#8a8a96" }}>{titulo}</div>
              <div style={{ fontSize: 11, color: on ? "#9a9aa6" : "#b6b6c0", marginTop: 3 }}>{sub}</div>
            </button>
          );
        })}
      </div>

      {/* Os quatro números que resumem tudo */}
      {secao === "corrente" && (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(215px, 1fr))", gap: 12 }}>
        <Indicador rotulo="Dinheiro em caixa" valor={fmt(caixa)} cor={caixa >= 0 ? VERDE : VERMELHO}
          ajuda={`Soma de ${contasVis.length} ${contasVis.length === 1 ? "conta bancária" : "contas bancárias"}, pelo último movimento lançado.`} />
        <Indicador rotulo="Ainda vamos receber" valor={fmt(totalReceber)} cor={VERDE}
          ajuda="Vendas já fechadas cujo dinheiro ainda não entrou, mais outras entradas previstas." />
        <Indicador rotulo="Ainda temos de pagar" valor={fmt(totalPagar)} cor={VERMELHO}
          ajuda="Faturas por liquidar, comissões pendentes e pagamentos previstos." />
        <Indicador destaque rotulo="Posição no fim" valor={fmt(posicao)}
          ajuda="Caixa + o que há a receber − o que há a pagar. Se for negativo, falta dinheiro." />
      </div>
      )}

      {/* Saldo fim de linha */}
      {geral && secao === "corrente" && fimDeLinha.linhas.length > 0 && (
        <div style={{ background: NAVY, borderRadius: 14, padding: "20px 24px", boxShadow: "0 1px 10px rgba(0,0,0,0.08)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20, flexWrap: "wrap" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, fontFamily: "Georgia, serif", color: "#fff" }}>Saldo fim de linha</h2>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "#9a9ab0", lineHeight: 1.5, maxWidth: 520 }}>
                A caixa das sociedades onde o dinheiro do grupo se acumula. As SPE de cada projeto não entram nesta soma.
              </p>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11, color: "#9a9ab0" }}>Total</div>
              <div style={{ fontSize: 26, fontWeight: 700, fontFamily: "monospace", color: OURO, letterSpacing: "-0.02em" }}>{fmt(fimDeLinha.total)}</div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginTop: 16 }}>
            {fimDeLinha.linhas.map(l => (
              <div key={l.id} style={{ background: "rgba(255,255,255,0.06)", borderRadius: 10, padding: "11px 14px" }}>
                <div style={{ fontSize: 11, color: "#cfcfe0" }}>{l.nome}{l.projeto ? <span style={{ color: "#8a8a9e" }}> · {l.projeto}</span> : null}</div>
                <div style={{ fontSize: 15, fontWeight: 700, fontFamily: "monospace", color: l.saldo < 0 ? "#f87171" : "#fff" }}>{fmt(l.saldo)}</div>
                <div style={{ fontSize: 10, color: "#7a7a8e" }}>{l.nContas} {l.nContas === 1 ? "conta" : "contas"}</div>
              </div>
            ))}
          </div>
          {fimDeLinha.emFalta.length > 0 && (
            <div style={{ fontSize: 11, color: "#b45309", background: "#fffbeb", borderRadius: 8, padding: "8px 12px", marginTop: 12 }}>
              Fora da soma por não constar da lista de sociedades: {fimDeLinha.emFalta.join(", ")}.
            </div>
          )}
        </div>
      )}

      {/* Bancos */}
      {secao === "corrente" && (
      <Bloco titulo="O dinheiro que existe hoje"
        explica="Cada linha é uma conta bancária. O saldo vem do último movimento importado do extrato — se um extrato estiver por importar, o valor está desatualizado.">
        {contasVis.length === 0 ? <Vazio>Esta sociedade ainda não tem contas bancárias registadas.</Vazio> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={th}>Sociedade</th>
                <th style={th}>Projeto</th>
                <th style={th}>Banco</th>
                <th style={{ ...th, textAlign: "right" }}>Saldo</th>
                <th style={{ ...th, width: 130 }}>Peso no total</th>
              </tr></thead>
              <tbody>
                {EMPRESAS.map(e => {
                  const doGrupo = contasVis.filter(c => c.empresaId === e.id);
                  if (!doGrupo.length) return null;
                  const sub = doGrupo.reduce((s, c) => s + c.saldo, 0);
                  return (
                    <React.Fragment key={e.id}>
                      <tr style={{ background: "#fafafc" }}>
                        <td style={{ ...td, fontWeight: 700, color: NAVY, borderBottom: "1px solid #ececf2" }} colSpan={2}>
                          {e.nome}{e.projeto ? <span style={{ color: "#9a9aa6", fontWeight: 400 }}> · {e.projeto}</span> : null}
                        </td>
                        <td style={{ ...td, color: "#b0b0bb", borderBottom: "1px solid #ececf2" }}>
                          {doGrupo.length} {doGrupo.length === 1 ? "conta" : "contas"}
                        </td>
                        <td style={{ ...tdNum, fontWeight: 700, color: sub < 0 ? VERMELHO : NAVY, borderBottom: "1px solid #ececf2" }}>{fmt(sub)}</td>
                        <td style={{ ...td, borderBottom: "1px solid #ececf2" }}><Barra parte={sub} total={caixa} cor={OURO} /></td>
                      </tr>
                      {doGrupo.map(c => (
                        <tr key={c.contaId}>
                          <td style={{ ...td, color: "#c0c0c8" }} />
                          <td style={{ ...td, color: "#9a9aa6" }} />
                          <td style={{ ...td, paddingLeft: 24 }}>{c.banco}</td>
                          <td style={{ ...tdNum, color: c.saldo < 0 ? VERMELHO : "#5a5a66" }}>{fmt(c.saldo)}</td>
                          <td style={td} />
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
                <tr>
                  <td style={{ ...td, fontWeight: 700, color: NAVY, borderTop: "2px solid #eee" }} colSpan={3}>Total</td>
                  <td style={{ ...tdNum, fontWeight: 700, color: NAVY, borderTop: "2px solid #eee" }}>{fmt(caixa)}</td>
                  <td style={{ ...td, borderTop: "2px solid #eee" }} />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Bloco>
      )}

      {/* Unidades */}
      {secao === "vendas" && (
      <Bloco titulo="Unidades"
        explica="Todas as frações do empreendimento e em que ponto estão. «Disponível» ainda não tem comprador; «Escriturada» já mudou de dono.">
        {unidades.total === 0 ? <Vazio>Sem frações registadas neste âmbito.</Vazio> : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <div style={{ background: NAVY, borderRadius: 9, padding: "12px 15px" }}>
              <div style={{ fontSize: 11, color: "#cfcfe0" }}>Total de frações</div>
              <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "monospace", color: "#fff" }}>{fmtNum(unidades.total, 0)}</div>
            </div>
            {["Disponível", "Reservada", "CPCV", "Escriturada"].map(st => {
              const n = unidades.porEstado[st] || 0;
              const est = ESTADO_VENDA[st];
              const pct = unidades.total ? (n / unidades.total) * 100 : 0;
              return (
                <div key={st} style={{ background: est.fundo, borderRadius: 9, padding: "12px 15px" }}>
                  <div style={{ fontSize: 11, color: est.cor, fontWeight: 600 }}>{st}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "monospace", color: est.cor }}>{fmtNum(n, 0)}</div>
                  <div style={{ fontSize: 10, color: est.cor, opacity: 0.75, marginTop: 2 }}>{fmtPercent(pct, 0)} do total</div>
                </div>
              );
            })}
          </div>
        )}
      </Bloco>
      )}

      {/* Vendas */}
      {secao === "vendas" && (
      <Bloco titulo="Vendas"
        explica="Cada linha é uma fração vendida ou em negociação. «Já recebemos» é o dinheiro que entrou; «falta receber» normalmente só entra na escritura."
        acao={
          <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
            <div style={{ fontSize: 11, color: "#9a9aa6" }}>Valor total vendido</div>
            <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "monospace", color: NAVY }}>{fmt0(resumoVendas.vgv)}</div>
          </div>
        }>
        {vendasLoading ? <Vazio>A carregar…</Vazio> : vendasVis.length === 0 ? (
          <Vazio>{geral ? "Ainda não há vendas registadas." : `Sem vendas associadas ao projeto ${projetoSel || "desta sociedade"}.`}</Vazio>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 14 }}>
              {[
                ["Frações", fmtNum(resumoVendas.n, 0)],
                ["Valor vendido", fmt0(resumoVendas.vgv)],
                ["Já recebemos", fmt0(resumoVendas.recebido)],
                ["Falta receber", fmt0(resumoVendas.falta)],
              ].map(([k, v]) => (
                <div key={k} style={{ background: "#fafafc", borderRadius: 9, padding: "10px 14px" }}>
                  <div style={{ fontSize: 11, color: "#9a9aa6" }}>{k}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "monospace", color: NAVY }}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={th}>Cliente</th>
                  <th style={th}>Fração</th>
                  {geral && <th style={th}>Projeto</th>}
                  <th style={th}>Situação</th>
                  <th style={{ ...th, textAlign: "right" }}>Valor</th>
                  <th style={{ ...th, textAlign: "right" }}>Já recebemos</th>
                  <th style={{ ...th, textAlign: "right" }}>Falta receber</th>
                </tr></thead>
                <tbody>
                  {vendasPorEmpresa.map(g => (
                    <React.Fragment key={g.chave}>
                      {geral && (
                        <tr style={{ background: "#fafafc" }}>
                          <td style={{ ...td, fontWeight: 700, color: NAVY, borderBottom: "1px solid #ececf2" }} colSpan={4}>
                            {g.titulo}<span style={{ color: "#9a9aa6", fontWeight: 400 }}> · {g.linhas.length} {g.linhas.length === 1 ? "venda" : "vendas"}</span>
                          </td>
                          <td style={{ ...tdNum, fontWeight: 700, color: NAVY, borderBottom: "1px solid #ececf2" }}>{fmt(g.vgv)}</td>
                          <td style={{ ...tdNum, fontWeight: 700, color: VERDE, borderBottom: "1px solid #ececf2" }}>{fmt(g.recebido)}</td>
                          <td style={{ ...tdNum, fontWeight: 700, color: g.falta > 0 ? AMBAR : "#c4c4cc", borderBottom: "1px solid #ececf2" }}>{g.falta > 0 ? fmt(g.falta) : "—"}</td>
                        </tr>
                      )}
                      {g.linhas.map(v => {
                    const est = ESTADO_VENDA[v._frac?.status] || { fundo: "#f1f5f9", cor: "#64748b" };
                    const falta = parseFloat(v.falta_receber) || 0;
                    return (
                      <tr key={v.id}>
                        <td style={{ ...td, fontWeight: 600, color: NAVY, maxWidth: 190, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.cliente || "—"}</td>
                        <td style={td}>{v._frac?.fracao || "—"}</td>
                        {geral && <td style={{ ...td, color: "#9a9aa6" }}>{v._frac?.projeto || "—"}</td>}
                        <td style={td}>
                          <span style={{ background: est.fundo, color: est.cor, fontSize: 10, padding: "3px 9px", borderRadius: 20, fontWeight: 600 }}>
                            {v._frac?.status || "—"}
                          </span>
                        </td>
                        <td style={{ ...tdNum, fontWeight: 700, color: NAVY }}>{fmt(v.valor_venda)}</td>
                        <td style={{ ...tdNum, color: VERDE }}>{fmt(v.recebemos)}</td>
                        <td style={{ ...tdNum, color: falta > 0 ? AMBAR : "#c4c4cc", fontWeight: falta > 0 ? 700 : 400 }}>{falta > 0 ? fmt(falta) : "—"}</td>
                      </tr>
                    );
                      })}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Bloco>
      )}

      {/* Plano de negócio */}
      {secao === "orcamento" && (
      <Bloco titulo="Plano de negócio"
        explica="O que estava previsto no estudo de viabilidade, comparado com o que já aconteceu. A barra mostra quanto do orçamento já foi consumido — a vermelho quando passou do previsto.">
        {planos.length === 0 ? (
          <Vazio>Ainda não há estudo de viabilidade carregado para {projetoSel || "esta sociedade"}.</Vazio>
        ) : planos.map(p => {
          const r = resumoPlano(p.dados);
          const margem = r.recOrcado ? ((r.lucroOrcado / r.recOrcado) * 100) : 0;
          return (
            <div key={p.id} style={{ marginBottom: 26 }}>
              <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700, color: NAVY, fontFamily: "Georgia, serif" }}>{p.nome}</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 14 }}>
                {[
                  ["Vendas previstas", fmt0(r.recOrcado), `Já realizado: ${fmt0(r.recReal)}`, VERDE, r.recReal, r.recOrcado],
                  ["Custos previstos", fmt0(r.cusOrcado), `Já gasto: ${fmt0(r.cusReal)}`, VERMELHO, r.cusReal, r.cusOrcado],
                  ["Lucro previsto", fmt0(r.lucroOrcado), `Margem de ${fmtPercent(margem, 1)} sobre as vendas`, OURO, 0, 0],
                ].map(([k, v, sub, cor, feito, total]) => (
                  <div key={k} style={{ background: "#fafafc", borderRadius: 9, padding: "12px 14px" }}>
                    <div style={{ fontSize: 11, color: "#9a9aa6" }}>{k}</div>
                    <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "monospace", color: NAVY, margin: "2px 0 6px" }}>{v}</div>
                    <div style={{ fontSize: 11, color: "#9a9aa6", marginBottom: total ? 6 : 0 }}>{sub}</div>
                    {total ? <Barra parte={feito} total={total} cor={Math.abs(feito) > Math.abs(total) ? VERMELHO : cor} /> : null}
                  </div>
                ))}
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr>
                    <th style={th}>Rubrica</th>
                    <th style={{ ...th, textAlign: "right" }}>Previsto</th>
                    <th style={{ ...th, textAlign: "right" }}>Real até hoje</th>
                    <th style={{ ...th, textAlign: "right" }}>Diferença</th>
                    <th style={{ ...th, width: 120 }}>Execução</th>
                  </tr></thead>
                  <tbody>
                    {r.linhas.map((d, i) => {
                      const dif = d.realizado - d.orcado;
                      const excedeu = d.grupo !== "receita" && Math.abs(d.realizado) > Math.abs(d.orcado) && d.orcado !== 0;
                      return (
                        <tr key={i}>
                          <td style={{ ...td, color: NAVY }}>{d.categoria}</td>
                          <td style={tdNum}>{fmt0(d.orcado)}</td>
                          <td style={{ ...tdNum, fontWeight: 600 }}>{fmt0(d.realizado)}</td>
                          <td style={{ ...tdNum, color: excedeu ? VERMELHO : "#9a9aa6" }}>{dif === 0 ? "—" : fmt0(dif)}</td>
                          <td style={td}><Barra parte={d.realizado} total={d.orcado} cor={excedeu ? VERMELHO : "#4a6fa5"} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </Bloco>
      )}

      {/* Contas a pagar */}
      {secao === "pagar" && (
      <div style={{ display: "grid", gap: 18 }}>

        <Bloco titulo="Contas a pagar"
          explica="Só o que está no fluxo futuro: custo real (fatura já emitida, por liquidar) e forecast (previsto, ainda sem fatura). As vencidas já passaram da data.">
          <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            {[
              ["Já vencido", porPagar.vencido, VERMELHO],
              ["Próximos 30 dias", porPagar.proximos30, AMBAR],
              [`Custo real (${porPagar.nReal})`, porPagar.faturas, "#0369a1"],
              [`Forecast (${porPagar.nForecast})`, porPagar.previsto, "#64748b"],
            ].map(([k, v, cor]) => (
              <div key={k} style={{ flex: "1 1 130px", background: "#fafafc", borderRadius: 9, padding: "10px 13px", borderLeft: `3px solid ${cor}` }}>
                <div style={{ fontSize: 11, color: "#9a9aa6" }}>{k}</div>
                <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "monospace", color: NAVY }}>{fmt0(v)}</div>
              </div>
            ))}
          </div>
          {porPagar.lista.length === 0 ? <Vazio>Nada por pagar. </Vazio> : (
            <div style={{ overflowX: "auto", maxHeight: 320, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={th}>Fornecedor</th>
                  <th style={th}>Vencimento</th>
                  <th style={{ ...th, textAlign: "right" }}>Valor</th>
                </tr></thead>
                <tbody>
                  {[...porPagar.lista].sort((a, b) => (a.vencimento || "9999").localeCompare(b.vencimento || "9999")).map(f => {
                    const atrasada = f.vencimento && f.vencimento < hojeISO;
                    return (
                      <tr key={f.id}>
                        <td style={{ ...td, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {f.fornecedor || f.fatura || "—"}
                          {geral && f.empresa && <span style={{ color: "#c0c0c8", fontSize: 10, marginLeft: 6 }}>{f.projeto || ""}</span>}
                        </td>
                        <td style={{ ...td, color: atrasada ? VERMELHO : "#9a9aa6", fontWeight: atrasada ? 700 : 400, whiteSpace: "nowrap" }}>
                          {fmtDate(f.vencimento)}{atrasada ? " ⚠" : ""}
                        </td>
                        <td style={{ ...tdNum, fontWeight: 600, color: atrasada ? VERMELHO : NAVY }}>{fmt(f.valor)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Bloco>

      </div>
      )}

      {/* Contas a receber */}
      {secao === "receber" && (
      <div style={{ display: "grid", gap: 18 }}>
        <Bloco titulo="Contas a receber"
          explica="Dinheiro de vendas já fechadas que ainda não entrou. Costuma entrar na escritura.">
          <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            {[
              ["De vendas", porReceber.vendas, VERDE],
              ["Outras entradas", porReceber.outros, "#4a6fa5"],
            ].map(([k, v, cor]) => (
              <div key={k} style={{ flex: "1 1 130px", background: "#fafafc", borderRadius: 9, padding: "10px 13px", borderLeft: `3px solid ${cor}` }}>
                <div style={{ fontSize: 11, color: "#9a9aa6" }}>{k}</div>
                <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "monospace", color: NAVY }}>{fmt0(v)}</div>
              </div>
            ))}
          </div>
          {porReceber.lista.length === 0 ? <Vazio>Nada a receber de vendas.</Vazio> : (
            <div style={{ overflowX: "auto", maxHeight: 320, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={th}>Cliente</th>
                  <th style={th}>Escritura prevista</th>
                  <th style={{ ...th, textAlign: "right" }}>Falta receber</th>
                </tr></thead>
                <tbody>
                  {[...porReceber.lista].sort((a, b) => (a.previsao_escritura || "9999").localeCompare(b.previsao_escritura || "9999")).map(v => (
                    <tr key={v.id}>
                      <td style={{ ...td, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {v.cliente || "—"}
                        <span style={{ color: "#c0c0c8", fontSize: 10, marginLeft: 6 }}>{v._frac?.fracao || ""}</span>
                      </td>
                      <td style={{ ...td, color: "#9a9aa6", whiteSpace: "nowrap" }}>{fmtDate(v.previsao_escritura)}</td>
                      <td style={{ ...tdNum, fontWeight: 600, color: AMBAR }}>{fmt(v.falta_receber)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Bloco>
      </div>
      )}

      <p style={{ fontSize: 11, color: "#b0b0bb", textAlign: "center", margin: "4px 0 8px", lineHeight: 1.6 }}>
        Os saldos vêm dos extratos importados e as vendas do separador Comercial.
        Se um número parecer errado, o mais provável é faltar importar um extrato ou uma fatura.
      </p>
    </div>
  );
}
