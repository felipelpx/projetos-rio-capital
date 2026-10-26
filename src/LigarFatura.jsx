import { useState, useMemo } from "react";
import { faturaPaga } from "./status.js";
import { pontuar } from "./conciliacao.js";
import { fmtEuro } from "./format.js";
import { labelEmpresa } from "./empresas.js";

// ─────────────────────────────────────────────────────────────────────────────
// LIGAR UMA FATURA A UM CUSTO PREVISTO
//
// O mesmo custo entra no ERP por dois caminhos — como previsão (avença
// recorrente ou pagamento manual) e, mais tarde, como fatura. Enquanto os dois
// estiverem de pé, o mês conta o custo a dobrar.
//
// Este seletor serve os dois sítios onde isso se resolve: o Fluxo Futuro, ao
// clicar numa ocorrência, e o mapa de pagamentos, num item que entrou sem
// fatura. A lista vem ordenada pelo que mais se parece com o custo — valor,
// data, palavras em comum — mas quem decide é sempre quem está a ver.
// ─────────────────────────────────────────────────────────────────────────────

const fmtData = (s) => {
  if (!s || typeof s !== "string" || s.length < 10) return s || "—";
  const m = s.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
};

/**
 * @param alvo      { descricao, valor, data, empresa } — o custo previsto
 * @param faturas   todas as faturas conhecidas
 * @param excluir   Set de ids de faturas já ligadas a outra coisa
 * @param nota      linha extra a explicar o que acontece ao ligar
 * @param onLigar   (fatura) => Promise<boolean>
 */
export default function LigarFatura({ alvo, faturas = [], excluir, nota, onLigar, onFechar }) {
  const [pesquisa, setPesquisa] = useState("");
  const [aGravar, setAGravar] = useState(false);
  const jaLigadas = excluir instanceof Set ? excluir : new Set();

  const ordenadas = useMemo(() => {
    const ref = {
      descricao: alvo?.descricao || "",
      valor: parseFloat(alvo?.valor) || 0,
      data: alvo?.data,
    };
    return (faturas || [])
      .filter(f => !faturaPaga(f))
      .filter(f => !jaLigadas.has(String(f.id)))
      // Empresa diferente é quase sempre engano, e um pagamento trocado entre
      // sociedades do grupo é dos erros mais caros de desfazer.
      .filter(f => !alvo?.empresa || !f.empresa || f.empresa === alvo.empresa)
      .map(f => ({ f, ...pontuar(ref, f) }))
      .sort((a, b) => b.score - a.score);
  }, [faturas, alvo, excluir]);   // eslint-disable-line react-hooks/exhaustive-deps

  const visiveis = ordenadas.filter(({ f }) => {
    if (!pesquisa) return true;
    const q = pesquisa.toLowerCase();
    return [f.fatura, f.fornecedor, f.categoria, labelEmpresa(f.empresa)]
      .some(x => (x || "").toLowerCase().includes(q));
  }).slice(0, 60);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 400,
                  display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 14, width: 760, maxWidth: "95vw", maxHeight: "86vh",
                    display: "flex", flexDirection: "column", boxShadow: "0 24px 70px rgba(0,0,0,0.3)",
                    fontFamily: "'DM Sans', sans-serif" }}>

        <div style={{ padding: "18px 22px 14px", borderBottom: "1px solid #f0f0f0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#1a1a2e", fontFamily: "Georgia,serif" }}>
              Ligar a fatura a este custo
            </div>
            <button onClick={onFechar} title="Fechar"
              style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#aaa", lineHeight: 1 }}>✕</button>
          </div>
          <div style={{ fontSize: 12, color: "#888", marginTop: 5, lineHeight: 1.5 }}>
            <strong style={{ color: "#444" }}>{alvo?.descricao}</strong> · {fmtEuro(alvo?.valor)} · {fmtData(alvo?.data)}
            {alvo?.empresa ? ` · ${labelEmpresa(alvo.empresa)}` : ""}
            {nota ? <><br />{nota}</> : null}
          </div>
          <input value={pesquisa} onChange={e => setPesquisa(e.target.value)} placeholder="Procurar fatura ou fornecedor…"
            style={{ marginTop: 12, width: "100%", boxSizing: "border-box", padding: "9px 12px",
                     border: "1px solid #e8e8e8", borderRadius: 8, fontSize: 13, outline: "none" }} />
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "6px 10px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
            <tbody>
              {visiveis.map(({ f, score, motivos }) => {
                const dif = (parseFloat(f.valor) || 0) - (parseFloat(alvo?.valor) || 0);
                return (
                  <tr key={f.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                    <td style={{ padding: "9px 10px" }}>
                      <div style={{ color: "#1a1a2e" }}>{f.fornecedor || "—"}{f.fatura ? ` · ${f.fatura}` : ""}</div>
                      <div style={{ fontSize: 10, color: "#aaa", fontFamily: "monospace", marginTop: 2 }}>
                        {fmtData(f.previsao_pagamento || f.vencimento)}
                        {f.categoria ? ` · ${f.categoria}` : ""}
                        {motivos.length ? ` · ${motivos.join(" · ")}` : ""}
                      </div>
                    </td>
                    <td style={{ padding: "9px 10px", textAlign: "right", whiteSpace: "nowrap" }}>
                      <div style={{ fontFamily: "monospace", fontWeight: 700, color: "#1a1a2e" }}>{fmtEuro(f.valor)}</div>
                      {Math.abs(dif) > 0.005 && (
                        <div style={{ fontSize: 9.5, fontFamily: "monospace", color: dif > 0 ? "#dc2626" : "#16a34a" }}>
                          {dif > 0 ? "+" : ""}{fmtEuro(dif)}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "9px 10px", textAlign: "right", whiteSpace: "nowrap" }}>
                      {score >= 0.8 && (
                        <span style={{ background: "#ecfdf5", color: "#047857", fontSize: 9, padding: "2px 7px",
                                       borderRadius: 4, fontFamily: "monospace", marginRight: 6 }}>provável</span>
                      )}
                      <button disabled={aGravar}
                        onClick={async () => { setAGravar(true); await onLigar(f); setAGravar(false); }}
                        style={{ background: "#1a1a2e", color: "#fff", border: "none", padding: "6px 13px",
                                 borderRadius: 7, fontSize: 11, cursor: aGravar ? "default" : "pointer", fontWeight: 600 }}>
                        Ligar
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!visiveis.length && (
                <tr><td colSpan={3} style={{ padding: 36, textAlign: "center", color: "#aaa", fontSize: 12 }}>
                  {pesquisa
                    ? "Nenhuma fatura corresponde à pesquisa."
                    : "Nenhuma fatura por pagar para esta empresa. Lança-a primeiro no Contas a Pagar."}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ padding: "13px 22px", borderTop: "1px solid #f0f0f0", display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onFechar}
            style={{ background: "#f4f4f6", border: "1px solid #e8e8e8", color: "#555", padding: "9px 18px",
                     borderRadius: 8, fontSize: 12.5, cursor: "pointer" }}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
