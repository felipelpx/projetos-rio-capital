import React, { useState, useMemo, useRef, useEffect } from "react";
import { fmtEuro } from "./format.js";

// ─────────────────────────────────────────────────────────────────────────────
// FLUXO FUTURO — VISTA EM MATRIZ
//
// A vista em lista mostra um mês de cada vez e obriga a abrir cada um para ver
// o que lá está. Esta mostra as despesas em linhas e os meses em colunas, como
// na folha de Excel: percebe-se de relance o que se repete, o que sobe e o que
// desaparece de um mês para o outro.
//
// Os dados são exactamente os mesmos — é só outra maneira de os desenhar. As
// ações de cada lançamento abrem ao clicar no valor da célula.
// ─────────────────────────────────────────────────────────────────────────────

// "Salário Davyd (2/4)" e "Salário Davyd (3/4)" são a mesma despesa em meses
// diferentes. Tirar o marcador de parcela é o que permite juntá-las na mesma
// linha, que é a razão de ser desta vista.
const SEM_PARCELA = /\s*\(\d+\/\d+\)\s*$/;
// As recorrentes trazem o IVA no fim da descrição; a linha é a mesma todos os meses.
const SEM_IVA = /\s*\(c\/\s*IVA\s*\d+%\)\s*$/i;

const nomeBase = (desc) =>
  String(desc || "(sem descrição)").replace(SEM_PARCELA, "").replace(SEM_IVA, "").trim() || "(sem descrição)";

const rotuloMes = (key) => {
  const [a, m] = String(key).split("-");
  return `${m}/${String(a).slice(-2)}`;
};

// SheetJS vem do CDN só quando alguém exporta — não pesa no arranque do ERP.
let _xlsxLoader = null;
function loadSheetJS() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (_xlsxLoader) return _xlsxLoader;
  _xlsxLoader = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error("Falha a carregar SheetJS do CDN"));
    document.head.appendChild(s);
  });
  return _xlsxLoader;
}

export default function FluxoMatriz({
  meses = [], isAdmin, currentUser, empresaNome, onEditarRecorrente, onLigarFatura,
  onMarcarPago, onConverter, onEditar, onEliminar,
  onMarcarFaturaPaga, onEliminarFatura,
}) {
  // Célula aberta: { linhaKey, mesKey }
  const [aberta, setAberta] = useState(null);
  const painelRef = useRef(null);

  // ── O que está aberto ─────────────────────────────────────────────────────
  // Com 127 despesas, abrir o fluxo com tudo aberto não se lê. Abre agrupado e
  // cada grupo expande-se por sua conta: abrir um nunca fecha outro, e o que
  // ficou aberto continua aberto ao voltar ao separador.
  const guardado = (chave) => {
    try { const v = JSON.parse(localStorage.getItem(chave) || "[]"); return new Set(Array.isArray(v) ? v : []); }
    catch { return new Set(); }
  };
  const [catsAbertas, setCatsAbertas] = useState(() => guardado("fluxoMatriz.cats"));
  const [subsAbertas, setSubsAbertas] = useState(() => guardado("fluxoMatriz.subs"));

  useEffect(() => {
    try { localStorage.setItem("fluxoMatriz.cats", JSON.stringify([...catsAbertas])); } catch { /* sem localStorage, não faz mal */ }
  }, [catsAbertas]);
  useEffect(() => {
    try { localStorage.setItem("fluxoMatriz.subs", JSON.stringify([...subsAbertas])); } catch { /* idem */ }
  }, [subsAbertas]);

  const alternar = (setter) => (chave) => setter(anterior => {
    const n = new Set(anterior);
    if (n.has(chave)) n.delete(chave); else n.add(chave);
    return n;
  });
  const alternarCat = alternar(setCatsAbertas);
  const alternarSub = alternar(setSubsAbertas);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") setAberta(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Montagem da matriz ────────────────────────────────────────────────────
  // Percorre-se uma vez os meses e arruma-se cada lançamento na sua linha.
  // A linha guarda os itens de cada mês, não só o total, porque é deles que
  // saem os botões quando se clica numa célula.
  const { secoes, totaisMes, totalGeral } = useMemo(() => {
    const linhas = new Map();   // chave -> { nome, cat, sub, tipo, porMes: Map }
    const totaisMes = new Map();
    let totalGeral = 0;

    meses.forEach(m => {
      let totalDoMes = 0;
      (m.items || []).forEach(it => {
        const nome = nomeBase(it.desc);
        const cat = it.cat || "— sem categoria —";
        // Sem subcategoria a linha fica logo debaixo da categoria, sem banda
        // intermédia vazia a ocupar espaço.
        const sub = String(it.subcat || "").trim();
        const chave = `${it.tipo}|${cat}|${sub}|${nome}`;
        if (!linhas.has(chave)) {
          linhas.set(chave, { chave, nome, cat, sub, tipo: it.tipo, porMes: new Map(), total: 0 });
        }
        const linha = linhas.get(chave);
        if (!linha.porMes.has(m.key)) linha.porMes.set(m.key, { valor: 0, itens: [] });
        const celula = linha.porMes.get(m.key);
        const v = parseFloat(it.valor) || 0;
        celula.valor += v;
        celula.itens.push(it);
        linha.total += v;

        const sinal = it.tipo === "entrada" ? v : -v;
        totalDoMes += sinal;
        totalGeral += sinal;
      });
      totaisMes.set(m.key, totalDoMes);
    });

    // Dois níveis, como na folha: categoria e, dentro dela, subcategoria.
    // Cada nível tem o seu subtotal por mês.
    const somaPorMes = (ls) => {
      const porMes = new Map();
      ls.forEach(l => l.porMes.forEach((c, k) => porMes.set(k, (porMes.get(k) || 0) + c.valor)));
      return porMes;
    };

    const porCat = new Map();
    [...linhas.values()].forEach(l => {
      if (!porCat.has(l.cat)) porCat.set(l.cat, []);
      porCat.get(l.cat).push(l);
    });

    const secoes = [...porCat.entries()]
      .map(([cat, ls]) => {
        const porSub = new Map();
        ls.forEach(l => {
          if (!porSub.has(l.sub)) porSub.set(l.sub, []);
          porSub.get(l.sub).push(l);
        });

        const grupos = [...porSub.entries()]
          .map(([sub, filhas]) => {
            filhas.sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome));
            return {
              sub, linhas: filhas, porMes: somaPorMes(filhas),
              total: filhas.reduce((s, l) => s + l.total, 0),
            };
          })
          // As linhas sem subcategoria ficam à cabeça, logo debaixo da categoria.
          .sort((a, b) => (a.sub === "" ? -1 : b.sub === "" ? 1 : 0)
                       || b.total - a.total || a.sub.localeCompare(b.sub));

        return {
          cat, grupos, porMes: somaPorMes(ls),
          nLinhas: ls.length,
          nSubs: grupos.filter(g => g.sub !== "").length,
          total: ls.reduce((s, l) => s + l.total, 0),
        };
      })
      .sort((a, b) => b.total - a.total || a.cat.localeCompare(b.cat));

    return { secoes, totaisMes, totalGeral };
  }, [meses]);

  const nLinhas = secoes.reduce((s, x) => s + x.nLinhas, 0);
  const nSubs = secoes.reduce((s, x) => s + x.nSubs, 0);

  const expandirTudo = () => {
    setCatsAbertas(new Set(secoes.map(s => s.cat)));
    setSubsAbertas(new Set(secoes.flatMap(s => s.grupos.filter(g => g.sub !== "").map(g => `${s.cat}|${g.sub}`))));
  };
  const recolherTudo = () => { setCatsAbertas(new Set()); setSubsAbertas(new Set()); setAberta(null); };
  const nAbertos = catsAbertas.size;

  // ── Exportar para Excel ───────────────────────────────────────────────────
  // Duas folhas com propósitos diferentes: "Matriz" é o quadro tal como está
  // no ecrã, para ler e imprimir; "Detalhe" é uma linha por lançamento, com os
  // valores já com sinal, para quem quiser fazer uma tabela dinâmica por cima.
  //
  // Exporta-se sempre tudo, mesmo o que está recolhido: recolher é uma ajuda a
  // ler o ecrã, não um filtro.
  const [aExportar, setAExportar] = useState(false);
  const exportarExcel = async () => {
    if (aExportar) return;
    setAExportar(true);
    try {
      const XLSX = await loadSheetJS();
      const cabecalho = ["Nível", "Categoria", "Subcategoria", "Despesa", "Tipo",
                         ...meses.map(m => rotuloMes(m.key)), "Total"];
      const matriz = [cabecalho];
      const detalhe = [["Categoria", "Subcategoria", "Despesa", "Mês", "Data",
                        "Descrição do lançamento", "Origem", "Natureza", "Tipo", "Valor (c/ sinal)"]];

      secoes.forEach(sec => {
        matriz.push(["Categoria", sec.cat, "", "", "",
                     ...meses.map(m => sec.porMes.get(m.key) || null), sec.total]);
        sec.grupos.forEach(g => {
          if (g.sub !== "") {
            matriz.push(["Subcategoria", sec.cat, g.sub, "", "",
                         ...meses.map(m => g.porMes.get(m.key) || null), g.total]);
          }
          g.linhas.forEach(l => {
            matriz.push(["Despesa", sec.cat, g.sub, l.nome, l.tipo === "entrada" ? "Entrada" : "Saída",
                         ...meses.map(m => l.porMes.get(m.key)?.valor ?? null), l.total]);
            meses.forEach(m => {
              (l.porMes.get(m.key)?.itens || []).forEach(it => {
                const v = parseFloat(it.valor) || 0;
                detalhe.push([sec.cat, g.sub, l.nome, rotuloMes(m.key),
                              it.vencimento ? String(it.vencimento).slice(0, 10) : "",
                              it.desc || "", it.origem || "", it.natureza || "",
                              it.tipo === "entrada" ? "Entrada" : "Saída",
                              it.tipo === "entrada" ? v : -v]);
              });
            });
          });
        });
      });

      matriz.push([]);
      matriz.push(["Líquido do mês", "", "", "", "",
                   ...meses.map(m => totaisMes.get(m.key) || 0), totalGeral]);

      const wb = XLSX.utils.book_new();
      const colunasValor = meses.length + 1;        // os meses mais a coluna Total

      const wsM = XLSX.utils.aoa_to_sheet(matriz);
      wsM["!cols"] = [{ wch: 13 }, { wch: 26 }, { wch: 22 }, { wch: 46 }, { wch: 9 },
                      ...meses.map(() => ({ wch: 14 })), { wch: 16 }];
      wsM["!freeze"] = { xSplit: 5, ySplit: 1, topLeftCell: "F2", activePane: "bottomRight", state: "frozen" };
      for (let r = 1; r < matriz.length; r++) {
        for (let c = 5; c < 5 + colunasValor; c++) {
          const cel = wsM[XLSX.utils.encode_cell({ r, c })];
          if (cel && cel.t === "n") cel.z = "#,##0.00";
        }
      }
      XLSX.utils.book_append_sheet(wb, wsM, "Matriz");

      const wsD = XLSX.utils.aoa_to_sheet(detalhe);
      wsD["!cols"] = [{ wch: 26 }, { wch: 22 }, { wch: 46 }, { wch: 10 }, { wch: 12 },
                      { wch: 52 }, { wch: 18 }, { wch: 12 }, { wch: 9 }, { wch: 16 }];
      wsD["!autofilter"] = { ref: `A1:J${detalhe.length}` };
      wsD["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" };
      for (let r = 1; r < detalhe.length; r++) {
        const cel = wsD[XLSX.utils.encode_cell({ r, c: 9 })];
        if (cel && cel.t === "n") cel.z = "#,##0.00";
      }
      XLSX.utils.book_append_sheet(wb, wsD, "Detalhe");

      const hoje = new Date().toISOString().slice(0, 10);
      const alcunha = String(empresaNome || "todos").normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").toLowerCase() || "todos";
      XLSX.writeFile(wb, `fluxo_futuro_${alcunha}_${hoje}.xlsx`);
    } catch (e) {
      alert("Não foi possível exportar:\n\n" + (e?.message || e)
        + "\n\nO Excel é gerado no browser a partir de uma biblioteca externa; sem internet não dá.");
    } finally {
      setAExportar(false);
    }
  };

  if (!meses.length || !nLinhas) {
    return (
      <div style={{ background: "#fff", borderRadius: 12, padding: 50, textAlign: "center",
                    color: "#bbb", fontSize: 13, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
        Não há lançamentos no período escolhido.
      </div>
    );
  }

  const celulaAberta = (() => {
    if (!aberta) return null;
    for (const s of secoes) {
      for (const g of s.grupos) {
        const l = g.linhas.find(x => x.chave === aberta.linhaKey);
        if (l) return { linha: l, mesKey: aberta.mesKey, celula: l.porMes.get(aberta.mesKey) };
      }
    }
    return null;
  })();

  const th = {
    padding: "9px 10px", color: "#aaa", fontSize: 9.5, letterSpacing: "0.06em",
    textTransform: "uppercase", fontFamily: "monospace", fontWeight: 500,
    borderBottom: "1px solid #ececf0", whiteSpace: "nowrap", background: "#fafafa",
  };
  const tdNum = {
    padding: "6px 10px", fontFamily: "monospace", fontSize: 11.5,
    textAlign: "right", whiteSpace: "nowrap", borderBottom: "1px solid #fafafa",
  };

  return (
    <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.05)", position: "relative" }}>

      <div style={{ padding: "13px 18px", borderBottom: "1px solid #f0f0f0",
                    display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#1a1a2e" }}>
          Despesas × meses
          <span style={{ fontWeight: 400, color: "#aaa", marginLeft: 8, fontSize: 11 }}>
            {nLinhas} despesas · {nSubs} subcategorias · {meses.length} meses
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontSize: 10.5, color: "#bbb", fontFamily: "monospace" }}>
            clica num valor para ver e tratar os lançamentos desse mês
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={expandirTudo} title="Abrir todas as categorias e subcategorias"
              style={{ background: "#f0f4ff", border: "1px solid #e0e8f8", color: "#4a6fa5", padding: "5px 11px",
                       borderRadius: 7, fontSize: 11, cursor: "pointer", fontFamily: "monospace" }}>
              ⊞ expandir tudo
            </button>
            <button onClick={exportarExcel} disabled={aExportar}
              title="Descarregar este quadro em Excel: uma folha com a matriz e outra com um lançamento por linha"
              style={{ background: "#ecfdf5", border: "1px solid #bbf7d0", color: "#047857", padding: "5px 11px",
                       borderRadius: 7, fontSize: 11, cursor: aExportar ? "default" : "pointer", fontFamily: "monospace" }}>
              {aExportar ? "a gerar…" : "⬇ excel"}
            </button>
            <button onClick={recolherTudo} disabled={!nAbertos}
              title={nAbertos ? "Voltar a ver só os totais por categoria" : "Já está tudo recolhido"}
              style={{ background: nAbertos ? "#f6f6f8" : "#fafafa", border: "1px solid #ececf0",
                       color: nAbertos ? "#777" : "#ccc", padding: "5px 11px", borderRadius: 7, fontSize: 11,
                       cursor: nAbertos ? "pointer" : "default", fontFamily: "monospace" }}>
              ⊟ recolher tudo
            </button>
          </div>
        </div>
      </div>

      <div style={{ overflowX: "auto", maxHeight: "72vh", overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12 }}>
          <thead>
            <tr>
              {/* A coluna das despesas fica fixa: com 15 meses, sem isto perde-se
                  a noção de que linha se está a ler ao rolar para a direita. */}
              <th style={{ ...th, position: "sticky", left: 0, zIndex: 3, textAlign: "left",
                           minWidth: 260, borderRight: "1px solid #ececf0" }}>Despesa</th>
              {meses.map(m => (
                <th key={m.key} style={{ ...th, textAlign: "right", minWidth: 92 }}>{rotuloMes(m.key)}</th>
              ))}
              <th style={{ ...th, textAlign: "right", minWidth: 100, borderLeft: "1px solid #ececf0" }}>Total</th>
            </tr>
          </thead>

          <tbody>
            {secoes.map(sec => {
              const catAberta = catsAbertas.has(sec.cat);
              return (
              <React.Fragment key={sec.cat}>
                {/* Cabeçalho da categoria, com o subtotal de cada mês */}
                <tr style={{ background: "#f4f6fa" }}>
                  <td style={{ padding: 0, fontSize: 10.5, fontWeight: 700, color: "#4a6fa5",
                               fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.05em",
                               position: "sticky", left: 0, zIndex: 2, background: "#f4f6fa",
                               borderRight: "1px solid #e4e8f0", borderBottom: "1px solid #e4e8f0", whiteSpace: "nowrap" }}>
                    <button onClick={() => alternarCat(sec.cat)} aria-expanded={catAberta}
                      title={catAberta ? `Recolher ${sec.cat}` : `Ver as ${sec.nLinhas} despesas de ${sec.cat}`}
                      style={{ width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer",
                               padding: "7px 10px", font: "inherit", color: "inherit", letterSpacing: "inherit",
                               textTransform: "inherit", display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 9, width: 9, display: "inline-block", color: "#8aa0c0" }}>
                        {catAberta ? "▼" : "▶"}
                      </span>
                      {sec.cat}
                      <span style={{ color: "#aaa", fontWeight: 400 }}>({sec.nLinhas})</span>
                    </button>
                  </td>
                  {meses.map(m => (
                    <td key={m.key} style={{ ...tdNum, background: "#f4f6fa", color: "#4a6fa5", fontWeight: 700,
                                             borderBottom: "1px solid #e4e8f0" }}>
                      {sec.porMes.get(m.key) ? fmtEuro(sec.porMes.get(m.key)) : ""}
                    </td>
                  ))}
                  <td style={{ ...tdNum, background: "#eef2f8", color: "#4a6fa5", fontWeight: 700,
                               borderLeft: "1px solid #e4e8f0", borderBottom: "1px solid #e4e8f0" }}>
                    {fmtEuro(sec.total)}
                  </td>
                </tr>

                {catAberta && sec.grupos.map(g => {
                  const kSub = sec.cat + "|" + g.sub;
                  // As linhas sem subcategoria não têm banda, por isso também não
                  // têm nada para recolher: aparecem assim que a categoria abre.
                  const subAberta = g.sub === "" || subsAbertas.has(kSub);
                  return (
                  <React.Fragment key={kSub}>
                  {g.sub !== "" && (
                    <tr style={{ background: "#fafbfd" }}>
                      <td style={{ padding: 0, fontSize: 10, fontWeight: 600, color: "#7a8aa0",
                                   fontFamily: "monospace", letterSpacing: "0.03em",
                                   position: "sticky", left: 0, zIndex: 2, background: "#fafbfd",
                                   borderRight: "1px solid #eef0f4", borderBottom: "1px solid #f2f4f8", whiteSpace: "nowrap" }}>
                        <button onClick={() => alternarSub(kSub)} aria-expanded={subAberta}
                          title={subAberta ? `Recolher ${g.sub}` : `Ver as ${g.linhas.length} despesas de ${g.sub}`}
                          style={{ width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer",
                                   padding: "5px 10px 5px 20px", font: "inherit", color: "inherit",
                                   letterSpacing: "inherit", display: "flex", alignItems: "center", gap: 5 }}>
                          <span style={{ fontSize: 8, width: 8, display: "inline-block", color: "#aab6c6" }}>
                            {subAberta ? "▼" : "▶"}
                          </span>
                          {g.sub}
                          <span style={{ color: "#c4c4cc", fontWeight: 400 }}>({g.linhas.length})</span>
                        </button>
                      </td>
                      {meses.map(m => (
                        <td key={m.key} style={{ ...tdNum, background: "#fafbfd", color: "#7a8aa0", fontWeight: 600,
                                                 fontSize: 10.5, borderBottom: "1px solid #f2f4f8" }}>
                          {g.porMes.get(m.key) ? fmtEuro(g.porMes.get(m.key)) : ""}
                        </td>
                      ))}
                      <td style={{ ...tdNum, background: "#f5f7fa", color: "#7a8aa0", fontWeight: 600, fontSize: 10.5,
                                   borderLeft: "1px solid #eef0f4", borderBottom: "1px solid #f2f4f8" }}>
                        {fmtEuro(g.total)}
                      </td>
                    </tr>
                  )}

                  {subAberta && g.linhas.map(l => (
                  <tr key={l.chave}>
                    <td style={{ padding: `6px 10px 6px ${g.sub !== "" ? 34 : 20}px`, color: "#333", position: "sticky", left: 0,
                                 zIndex: 1, background: "#fff", borderRight: "1px solid #f0f0f0",
                                 borderBottom: "1px solid #fafafa", maxWidth: 300, overflow: "hidden",
                                 textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      title={l.sub ? `${l.nome} — ${l.cat} › ${l.sub}` : `${l.nome} — ${l.cat}`}>
                      {l.tipo === "entrada" && <span style={{ color: "#16a34a", marginRight: 5 }}>▲</span>}
                      {l.nome}
                    </td>
                    {meses.map(m => {
                      const c = l.porMes.get(m.key);
                      const estaAberta = aberta?.linhaKey === l.chave && aberta?.mesKey === m.key;
                      if (!c) return <td key={m.key} style={{ ...tdNum, color: "#e8e8e8" }}>–</td>;
                      return (
                        <td key={m.key} style={{ ...tdNum, padding: 0 }}>
                          <button
                            onClick={() => setAberta(estaAberta ? null : { linhaKey: l.chave, mesKey: m.key })}
                            title={`${c.itens.length} lançamento(s) · clica para ver`}
                            style={{
                              width: "100%", border: "none", cursor: "pointer",
                              background: estaAberta ? "#1a1a2e" : "transparent",
                              color: estaAberta ? "#C8A96E" : (l.tipo === "entrada" ? "#16a34a" : "#dc2626"),
                              fontFamily: "monospace", fontSize: 11.5, fontWeight: 600,
                              padding: "6px 10px", textAlign: "right",
                            }}>
                            {fmtEuro(c.valor)}
                            {c.itens.length > 1 && (
                              <span style={{ fontSize: 8.5, opacity: 0.6, marginLeft: 3 }}>×{c.itens.length}</span>
                            )}
                          </button>
                        </td>
                      );
                    })}
                    <td style={{ ...tdNum, fontWeight: 700, color: "#1a1a2e",
                                 borderLeft: "1px solid #f0f0f0", background: "#fcfcfd" }}>
                      {fmtEuro(l.total)}
                    </td>
                  </tr>
                  ))}
                  </React.Fragment>
                  );
                })}
              </React.Fragment>
              );
            })}

            {/* Líquido do mês: entradas menos saídas */}
            <tr style={{ background: "#1a1a2e", position: "sticky", bottom: 0, zIndex: 2 }}>
              <td style={{ padding: "11px 10px", color: "#C8A96E", fontWeight: 700, fontSize: 11,
                           fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.06em",
                           position: "sticky", left: 0, zIndex: 3, background: "#1a1a2e", whiteSpace: "nowrap" }}>
                Líquido do mês
              </td>
              {meses.map(m => {
                const t = totaisMes.get(m.key) || 0;
                return (
                  <td key={m.key} style={{ ...tdNum, background: "#1a1a2e", borderBottom: "none",
                                           fontWeight: 700, color: t >= 0 ? "#4ade80" : "#fca5a5" }}>
                    {t ? fmtEuro(t) : "—"}
                  </td>
                );
              })}
              <td style={{ ...tdNum, background: "#13131f", borderBottom: "none", fontWeight: 700,
                           color: totalGeral >= 0 ? "#4ade80" : "#fca5a5" }}>
                {fmtEuro(totalGeral)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── Painel da célula ─────────────────────────────────────────────── */}
      {celulaAberta?.celula && (
        <div onClick={(e) => { if (e.target === e.currentTarget) setAberta(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 340,
                   display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div ref={painelRef}
            style={{ background: "#fff", borderRadius: 12, width: 620, maxWidth: "95vw", maxHeight: "80vh",
                     display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>

            <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid #f0f0f0",
                          display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#1a1a2e" }}>{celulaAberta.linha.nome}</div>
                <div style={{ fontSize: 11.5, color: "#888", marginTop: 4, fontFamily: "monospace" }}>
                  {rotuloMes(celulaAberta.mesKey)} · {celulaAberta.linha.cat}
                  {celulaAberta.linha.sub ? ` › ${celulaAberta.linha.sub}` : ""} ·{" "}
                  <strong style={{ color: celulaAberta.linha.tipo === "entrada" ? "#16a34a" : "#dc2626" }}>
                    {fmtEuro(celulaAberta.celula.valor)}
                  </strong>
                </div>
              </div>
              <button onClick={() => setAberta(null)} title="Fechar (Esc)"
                style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#aaa", lineHeight: 1 }}>✕</button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "14px 20px",
                          display: "flex", flexDirection: "column", gap: 8 }}>
              {celulaAberta.celula.itens.map((item, k) => (
                <div key={k} style={{ border: "1px solid #eef0f4", borderRadius: 9, padding: "11px 13px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, color: "#1a1a2e" }}>{item.desc}</div>
                      <div style={{ fontSize: 10, color: "#aaa", fontFamily: "monospace", marginTop: 3 }}>
                        {item.origem}{item.vencimento ? " · " + item.vencimento : ""}
                      </div>
                    </div>
                    <div style={{ fontFamily: "monospace", fontWeight: 700, whiteSpace: "nowrap",
                                  color: item.tipo === "entrada" ? "#16a34a" : "#dc2626" }}>
                      {item.tipo === "entrada" ? "+" : "-"}{fmtEuro(item.valor)}
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 9, flexWrap: "wrap" }}>
                    <span style={{ background: "#f0f4ff", color: "#4a6fa5", fontSize: 9,
                                   padding: "2px 7px", borderRadius: 3, fontFamily: "monospace" }}>{item.cat}</span>
                    {item.subcat && (
                      <span style={{ background: "#f7f8fb", color: "#7a8aa0", fontSize: 9,
                                     padding: "2px 7px", borderRadius: 3, fontFamily: "monospace" }}>{item.subcat}</span>
                    )}

                    {isAdmin && item.origem === "Manual" && item.pagamento && (
                      <>
                        <button onClick={() => { onMarcarPago?.(item.pagamento); setAberta(null); }}
                          title="Marcar como Pago (sai do fluxo)"
                          style={{ background: "#dcfce7", border: "none", color: "#16a34a", padding: "3px 9px",
                                   borderRadius: 5, fontSize: 10, cursor: "pointer", fontWeight: 700 }}>✓</button>
                        <button onClick={() => { onConverter?.(item.pagamento); setAberta(null); }}
                          title="Já recebi a fatura: converter esta previsão em custo real"
                          style={{ background: "#fef3c7", border: "none", color: "#b45309", padding: "3px 9px",
                                   borderRadius: 5, fontSize: 10, cursor: "pointer", fontWeight: 700 }}>→ fatura</button>
                        <button onClick={() => { onEditar?.(item.pagamento); setAberta(null); }}
                          title="Editar pagamento"
                          style={{ background: "#f0f4ff", border: "none", color: "#4a6fa5", padding: "3px 8px",
                                   borderRadius: 5, fontSize: 10, cursor: "pointer" }}>✎</button>
                        <button onClick={() => { onEliminar?.(item.pagamento); setAberta(null); }}
                          title="Eliminar pagamento"
                          style={{ background: "#fff0f0", border: "none", color: "#dc2626", padding: "3px 8px",
                                   borderRadius: 5, fontSize: 10, cursor: "pointer" }}>✕</button>
                      </>
                    )}

                    {isAdmin && (item.origem === "Contas a Pagar" || item.origem === "Vencida") && item.fatura && (
                      <>
                        <button onClick={() => { onMarcarFaturaPaga?.(item.fatura); setAberta(null); }}
                          title="Marcar fatura como Paga"
                          style={{ background: "#dcfce7", border: "none", color: "#16a34a", padding: "3px 9px",
                                   borderRadius: 5, fontSize: 10, cursor: "pointer", fontWeight: 700 }}>✓</button>
                        <button onClick={() => { onEliminarFatura?.(item.fatura); setAberta(null); }}
                          title="Eliminar fatura"
                          style={{ background: "#fff0f0", border: "none", color: "#dc2626", padding: "3px 8px",
                                   borderRadius: 5, fontSize: 10, cursor: "pointer" }}>✕</button>
                      </>
                    )}

                    {item.origem === "Recorrente" && (
                      <>
                        {isAdmin && item.recorrenteId && onLigarFatura && (
                          <button onClick={() => { onLigarFatura(item); setAberta(null); }}
                            title="A fatura deste mês já chegou? Liga-a a esta ocorrência"
                            style={{ background: "#fff7ed", border: "1px solid #fed7aa", color: "#b45309", padding: "3px 9px",
                                     borderRadius: 5, fontSize: 10, cursor: "pointer", fontWeight: 700 }}>🔗 ligar fatura</button>
                        )}
                        {isAdmin && item.recorrenteId && onEditarRecorrente && (
                          <button onClick={() => { onEditarRecorrente(item.recorrenteId); setAberta(null); }}
                            title="Editar a regra desta despesa recorrente"
                            style={{ background: "#eef2ff", border: "none", color: "#4338ca", padding: "3px 9px",
                                     borderRadius: 5, fontSize: 10, cursor: "pointer", fontWeight: 700 }}>✎ editar regra</button>
                        )}
                        <span style={{ fontSize: 10, color: "#4338ca", fontFamily: "monospace" }}>
                          altera todos os meses desta despesa
                        </span>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
