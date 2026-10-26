import { useState, useMemo, useEffect } from "react";
import { useTodosMovimentos } from "./hooks.js";
import { CATEGORIAS, SUBCATEGORIAS } from "./categorias.js";
import { EMPRESAS, labelEmpresa } from "./empresas.js";
import { fmtEuro, fmtInt } from "./format.js";

// Mapa conta_id → { empresa, banco }. Uma só volta pelo empresas.js evita
// procurar a empresa de cada movimento linha a linha.
const CONTAS = {};
EMPRESAS.forEach(e => e.contas.forEach(c => {
  CONTAS[c.id] = { empresaId: e.id, empresa: labelEmpresa(e.id), empresaNome: e.nome, banco: c.banco };
}));

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
               "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

const fmtDataPT = (iso) => {
  if (!iso) return "—";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return d && m && a ? `${d}/${m}/${a}` : String(iso);
};

function loadSheetJS() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

// ─── Célula editável: grava já na tabela `movimentos` ────────────────────────
// É a mesma linha que o Extratos mostra, por isso a alteração aparece lá.
function CelulaSelect({ valor, opcoes, disabled, placeholder, onSave }) {
  const [v, setV] = useState(valor || "");
  const [estado, setEstado] = useState(null);   // "a gravar" | "ok" | "erro"
  useEffect(() => { setV(valor || ""); }, [valor]);

  const guardar = async (novo) => {
    setV(novo); setEstado("a gravar");
    const res = await onSave(novo);
    if (res?.semEfeito) {
      setEstado("erro"); setV(valor || "");
      alert("Nada foi gravado — falta a política de atualização na tabela 'movimentos' (RLS).");
      return;
    }
    if (res?.error) {
      setEstado("erro"); setV(valor || "");
      alert("Erro ao gravar:\n\n" + (res.error.message || res.error));
      return;
    }
    setEstado("ok");
    setTimeout(() => setEstado(null), 1200);
  };

  return (
    <select value={v} disabled={disabled} onChange={e => guardar(e.target.value)}
      style={{
        width: "100%", fontSize: 11, padding: "4px 6px", borderRadius: 6, outline: "none",
        border: "1px solid " + (estado === "ok" ? "#bbf7d0" : estado === "erro" ? "#fecaca" : "#eee"),
        background: disabled ? "#f4f4f6" : (estado === "ok" ? "#f0fdf4" : "#fafafa"),
        fontFamily: "inherit",
      }}>
      <option value="">{placeholder}</option>
      {/* Mantém visível um valor antigo que já não esteja nas listas atuais */}
      {v && !opcoes.includes(v) && <option value={v}>{v}</option>}
      {opcoes.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function CelulaTexto({ valor, onSave, placeholder }) {
  const [v, setV] = useState(valor || "");
  const [estado, setEstado] = useState(null);
  useEffect(() => { setV(valor || ""); }, [valor]);

  const guardar = async () => {
    if ((valor || "") === v) return;
    setEstado("a gravar");
    const res = await onSave(v);
    if (res?.semEfeito || res?.error) {
      setEstado("erro"); setV(valor || "");
      alert("Não foi gravado:\n\n" + (res?.error?.message || "falta permissão de escrita (RLS)"));
      return;
    }
    setEstado("ok");
    setTimeout(() => setEstado(null), 1200);
  };

  return (
    <input value={v} onChange={e => setV(e.target.value)} onBlur={guardar}
      onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setV(valor || ""); e.currentTarget.blur(); } }}
      placeholder={placeholder}
      style={{
        width: "100%", fontSize: 11, padding: "4px 6px", borderRadius: 6, outline: "none",
        border: "1px solid " + (estado === "ok" ? "#bbf7d0" : estado === "erro" ? "#fecaca" : "#eee"),
        background: estado === "ok" ? "#f0fdf4" : "#fafafa", fontFamily: "inherit",
      }} />
  );
}

export default function CaixaUnicoView() {
  const { movimentos, loading, erro, desatualizado, reload, updateMovimento } = useTodosMovimentos();

  const [fEmpresa, setFEmpresa] = useState("");
  const [fBanco, setFBanco] = useState("");
  const [fCategoria, setFCategoria] = useState("");
  const [fSubcategoria, setFSubcategoria] = useState("");
  const [fAno, setFAno] = useState("");
  const [fMes, setFMes] = useState("");
  // Intervalo de datas. Pôr a mesma data nos dois campos isola um único dia.
  const [fDataDe, setFDataDe] = useState("");
  const [fDataAte, setFDataAte] = useState("");
  // Valor: compara-se sempre o valor ABSOLUTO. Quem procura 6.839,93 está a
  // conferir um movimento, e não quer ter de se lembrar se era entrada ou saída.
  const [fValorDe, setFValorDe] = useState("");
  const [fValorAte, setFValorAte] = useState("");
  const [fSinal, setFSinal] = useState("");        // "" | "entrada" | "saida"
  const [busca, setBusca] = useState("");
  const [perPage, setPerPage] = useState(50);
  const [page, setPage] = useState(1);

  // Junta a cada movimento a empresa e o banco a que a conta pertence
  const linhas = useMemo(() => movimentos.map(m => {
    const c = CONTAS[m.conta_id] || {};
    return {
      ...m,
      _empresaId: c.empresaId || "",
      _empresa: c.empresa || m.conta_id || "—",
      _banco: c.banco || "—",
      _ano: String(m.data || "").slice(0, 4),
      _mes: String(m.data || "").slice(5, 7),
    };
  }), [movimentos]);

  // Opções dos filtros, a partir do que realmente existe nos dados
  const bancos = useMemo(() => [...new Set(linhas.map(l => l._banco))].filter(Boolean).sort(), [linhas]);
  const anos = useMemo(() => [...new Set(linhas.map(l => l._ano))].filter(Boolean).sort().reverse(), [linhas]);
  const categoriasUsadas = useMemo(() => {
    const usadas = new Set(linhas.map(l => l.categoria).filter(Boolean));
    return [...new Set([...CATEGORIAS, ...usadas])].sort();
  }, [linhas]);
  const subcategoriasDisponiveis = useMemo(() => {
    if (fCategoria) return SUBCATEGORIAS[fCategoria] || [];
    return [...new Set(linhas.map(l => l.subcategoria).filter(Boolean))].sort();
  }, [fCategoria, linhas]);

  // Aceita "1.234,56" e "1234.56": escreve-se o valor como ele aparece na
  // tabela, com vírgula, sem ter de o traduzir.
  const numeroDe = (t) => {
    const limpo = String(t ?? "").trim().replace(/[€\s]/g, "");
    if (!limpo) return null;
    const n = parseFloat(limpo.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
    return Number.isFinite(n) ? Math.abs(n) : null;
  };

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const nValorDe = numeroDe(fValorDe);
    const nValorAte = numeroDe(fValorAte);
    return linhas.filter(l => {
      if (fEmpresa && l._empresaId !== fEmpresa) return false;
      if (fBanco && l._banco !== fBanco) return false;
      if (fCategoria && (l.categoria || "") !== fCategoria) return false;
      if (fSubcategoria && (l.subcategoria || "") !== fSubcategoria) return false;
      if (fAno && l._ano !== fAno) return false;
      if (fMes && l._mes !== fMes) return false;
      // Datas em ISO (aaaa-mm-dd) comparam-se como texto, sem fusos pelo meio.
      const dia = String(l.data || "").slice(0, 10);
      if (fDataDe && (!dia || dia < fDataDe)) return false;
      if (fDataAte && (!dia || dia > fDataAte)) return false;
      const v = Math.abs(parseFloat(l.valor) || 0);
      if (nValorDe != null && v < nValorDe - 0.005) return false;
      if (nValorAte != null && v > nValorAte + 0.005) return false;
      if (fSinal === "entrada" && !((parseFloat(l.valor) || 0) > 0)) return false;
      if (fSinal === "saida" && !((parseFloat(l.valor) || 0) < 0)) return false;
      if (q) {
        const alvo = `${l.movimento || ""} ${l.detalhes || ""} ${l.fornecedor || ""}`.toLowerCase();
        if (!alvo.includes(q)) return false;
      }
      return true;
    });
  }, [linhas, fEmpresa, fBanco, fCategoria, fSubcategoria, fAno, fMes, fDataDe, fDataAte, fValorDe, fValorAte, fSinal, busca]);

  // Qualquer mudança de filtro volta à primeira página
  useEffect(() => { setPage(1); }, [fEmpresa, fBanco, fCategoria, fSubcategoria, fAno, fMes, fDataDe, fDataAte, fValorDe, fValorAte, fSinal, busca, perPage]);

  const totais = useMemo(() => {
    let entradas = 0, saidas = 0;
    filtradas.forEach(l => {
      const v = parseFloat(l.valor) || 0;
      if (v >= 0) entradas += v; else saidas += v;
    });
    return { entradas, saidas, liquido: entradas + saidas, n: filtradas.length };
  }, [filtradas]);

  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / perPage));
  const slice = filtradas.slice((page - 1) * perPage, page * perPage);

  const limparFiltros = () => {
    setFEmpresa(""); setFBanco(""); setFCategoria(""); setFSubcategoria("");
    setFAno(""); setFMes(""); setFDataDe(""); setFDataAte(""); setBusca("");
    setFValorDe(""); setFValorAte(""); setFSinal("");
  };
  const temFiltro = fEmpresa || fBanco || fCategoria || fSubcategoria || fAno || fMes || fDataDe || fDataAte || fValorDe || fValorAte || fSinal || busca;

  // Exporta exatamente o que está filtrado — não a tabela toda
  const exportar = async () => {
    await loadSheetJS();
    const dados = filtradas.map(l => ({
      Data: String(l.data || "").slice(0, 10),
      Empresa: l._empresa,
      Banco: l._banco,
      Descrição: l.movimento || "",
      Valor: parseFloat(l.valor) || 0,
      Saldo: parseFloat(l.saldo) || 0,
      Categoria: l.categoria || "",
      Subcategoria: l.subcategoria || "",
      Fornecedor: l.fornecedor || "",
      Observação: l.detalhes || "",
    }));
    const ws = window.XLSX.utils.json_to_sheet(dados);
    ws["!cols"] = [{ wch: 11 }, { wch: 30 }, { wch: 16 }, { wch: 46 }, { wch: 13 }, { wch: 13 }, { wch: 22 }, { wch: 22 }, { wch: 24 }, { wch: 28 }];
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, "Caixa Único");
    const partes = ["Caixa_Unico"];
    if (fEmpresa) partes.push(fEmpresa);
    if (fAno) partes.push(fAno);
    if (fMes) partes.push(fMes);
    if (fDataDe || fDataAte) partes.push(`${fDataDe || "inicio"}_a_${fDataAte || "fim"}`);
    if (fValorDe || fValorAte) partes.push(`valor_${fValorDe || "0"}_a_${fValorAte || "max"}`.replace(/[^\w.]+/g, ""));
    window.XLSX.writeFile(wb, partes.join("_") + ".xlsx");
  };

  const guardarCampo = (id, campo) => (v) => updateMovimento(id, { [campo]: v || null });

  const rotulo = { fontSize: 9, color: "#aaa", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 4 };
  const selectStyle = { width: "100%", background: "#fafafa", border: "1px solid #eee", borderRadius: 7, padding: "7px 9px", fontSize: 12, outline: "none", fontFamily: "inherit" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, fontFamily: "'DM Sans', sans-serif" }}>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: "Georgia, serif", fontSize: 22, color: "#1a1a2e" }}>Caixa Único</h2>
          <div style={{ fontSize: 12, color: "#aaa", marginTop: 3 }}>
            Todos os lançamentos, de todas as empresas e bancos. O que alterares aqui altera o extrato original.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={reload}
            title={desatualizado ? "Há alterações feitas noutro ecrã" : "Voltar a ler os movimentos"}
            style={{ background: desatualizado ? "#fef3c7" : "#f0f4ff", border: "1px solid " + (desatualizado ? "#fde68a" : "#dde3f0"), color: desatualizado ? "#92400e" : "#4a6fa5", padding: "8px 16px", borderRadius: 8, fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
            ↻ {desatualizado ? "Há alterações novas — atualizar" : "Atualizar"}
          </button>
          <button onClick={exportar} disabled={!filtradas.length}
            style={{ background: filtradas.length ? "#16a34a" : "#ddd", border: "none", color: "#fff", padding: "8px 18px", borderRadius: 8, fontSize: 12, cursor: filtradas.length ? "pointer" : "default", fontWeight: 700 }}>
            ↓ Exportar Excel
          </button>
        </div>
      </div>

      {erro && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: 10, padding: "12px 16px", fontSize: 12, lineHeight: 1.6 }}>
          Não foi possível carregar os movimentos: {erro}
        </div>
      )}

      {/* ─── Filtros ─────────────────────────────────────────────────────── */}
      <div style={{ background: "#fff", borderRadius: 12, padding: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
          <div>
            <label style={rotulo}>Empresa</label>
            <select value={fEmpresa} onChange={e => setFEmpresa(e.target.value)} style={selectStyle}>
              <option value="">Todas</option>
              {EMPRESAS.map(e => <option key={e.id} value={e.id}>{labelEmpresa(e.id)}</option>)}
            </select>
          </div>
          <div>
            <label style={rotulo}>Banco</label>
            <select value={fBanco} onChange={e => setFBanco(e.target.value)} style={selectStyle}>
              <option value="">Todos</option>
              {bancos.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label style={rotulo}>Categoria</label>
            <select value={fCategoria} onChange={e => { setFCategoria(e.target.value); setFSubcategoria(""); }} style={selectStyle}>
              <option value="">Todas</option>
              {categoriasUsadas.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label style={rotulo}>Subcategoria</label>
            <select value={fSubcategoria} onChange={e => setFSubcategoria(e.target.value)} style={selectStyle}>
              <option value="">Todas</option>
              {subcategoriasDisponiveis.map(sc => <option key={sc} value={sc}>{sc}</option>)}
            </select>
          </div>
          <div>
            <label style={rotulo}>Ano</label>
            <select value={fAno} onChange={e => setFAno(e.target.value)} style={selectStyle}>
              <option value="">Todos</option>
              {anos.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label style={rotulo}>Mês</label>
            <select value={fMes} onChange={e => setFMes(e.target.value)} style={selectStyle}>
              <option value="">Todos</option>
              {MESES.map((nome, i) => {
                const v = String(i + 1).padStart(2, "0");
                return <option key={v} value={v}>{nome}</option>;
              })}
            </select>
          </div>
          <div>
            <label style={rotulo}>Data de</label>
            <input type="date" value={fDataDe} onChange={e => setFDataDe(e.target.value)}
              max={fDataAte || undefined}
              style={{ ...selectStyle, fontFamily: "monospace" }} />
            {fDataDe && fDataAte !== fDataDe && (
              <button onClick={() => setFDataAte(fDataDe)}
                title="Mostrar apenas os lançamentos deste dia"
                style={{ background: "none", border: "none", color: "#4a6fa5", cursor: "pointer", fontSize: 10, padding: "3px 0 0", textDecoration: "underline", fontFamily: "monospace" }}>
                só este dia
              </button>
            )}
          </div>
          <div>
            <label style={rotulo}>Data até</label>
            <input type="date" value={fDataAte} onChange={e => setFDataAte(e.target.value)}
              min={fDataDe || undefined}
              style={{ ...selectStyle, fontFamily: "monospace" }} />
          </div>
          <div>
            <label style={rotulo}>Valor de</label>
            <input value={fValorDe} onChange={e => setFValorDe(e.target.value)} placeholder="0,00" inputMode="decimal"
              style={{ ...selectStyle, fontFamily: "monospace" }} />
            {fValorDe && fValorAte !== fValorDe && (
              <button onClick={() => setFValorAte(fValorDe)}
                title="Mostrar apenas os lançamentos exatamente deste valor"
                style={{ background: "none", border: "none", color: "#4a6fa5", cursor: "pointer", fontSize: 10, padding: "3px 0 0", textDecoration: "underline", fontFamily: "monospace" }}>
                só este valor
              </button>
            )}
          </div>
          <div>
            <label style={rotulo}>Valor até</label>
            <input value={fValorAte} onChange={e => setFValorAte(e.target.value)} placeholder="sem limite" inputMode="decimal"
              style={{ ...selectStyle, fontFamily: "monospace" }} />
          </div>
          <div>
            <label style={rotulo}>Entrada / Saída</label>
            <select value={fSinal} onChange={e => setFSinal(e.target.value)} style={selectStyle}>
              <option value="">Ambas</option>
              <option value="entrada">Só entradas</option>
              <option value="saida">Só saídas</option>
            </select>
          </div>
          <div style={{ gridColumn: "span 2", minWidth: 200 }}>
            <label style={rotulo}>Procurar na descrição</label>
            <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="descrição, observação ou fornecedor…"
              style={selectStyle} />
          </div>
        </div>

        {temFiltro && (
          <button onClick={limparFiltros}
            style={{ marginTop: 10, background: "#f7f7f7", border: "none", color: "#888", padding: "6px 14px", borderRadius: 7, fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
            ✕ Limpar filtros
          </button>
        )}
      </div>

      {/* ─── Totais do que está filtrado ─────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
        {[
          { label: "Lançamentos", valor: fmtInt(totais.n), cor: "#1a1a2e" },
          { label: "Entradas", valor: fmtEuro(totais.entradas), cor: "#16a34a" },
          { label: "Saídas", valor: fmtEuro(totais.saidas), cor: "#dc2626" },
          { label: "Líquido", valor: fmtEuro(totais.liquido), cor: totais.liquido >= 0 ? "#16a34a" : "#dc2626" },
        ].map(k => (
          <div key={k.label} style={{ background: "#fff", borderRadius: 10, padding: "14px 18px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
            <div style={{ fontSize: 9, color: "#aaa", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.07em" }}>{k.label}</div>
            <div style={{ fontSize: 19, fontWeight: 700, color: k.cor, fontFamily: "monospace", marginTop: 5 }}>{k.valor}</div>
          </div>
        ))}
      </div>

      {/* ─── Tabela ──────────────────────────────────────────────────────── */}
      <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "#bbb", fontSize: 13 }}>A carregar os movimentos…</div>
        ) : filtradas.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "#bbb", fontSize: 13 }}>
            {linhas.length === 0 ? "Não há movimentos." : "Nenhum lançamento corresponde a estes filtros."}
          </div>
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#fafafa" }}>
                    {["Data", "Empresa", "Banco", "Descrição", "Valor", "Saldo", "Categoria", "Subcategoria", "Observação"].map(h => (
                      <th key={h} style={{ padding: "9px 12px", textAlign: "left", color: "#aaa", fontSize: 10, letterSpacing: "0.07em", textTransform: "uppercase", fontFamily: "monospace", borderBottom: "1px solid #f0f0f0", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {slice.map(l => (
                    <tr key={l.id} style={{ borderBottom: "1px solid #fafafa" }}>
                      <td style={{ padding: "8px 12px", color: "#888", fontFamily: "monospace", whiteSpace: "nowrap" }}>{fmtDataPT(l.data)}</td>
                      <td style={{ padding: "8px 12px", color: "#1a1a2e", fontSize: 11, whiteSpace: "nowrap" }}>{l._empresa}</td>
                      <td style={{ padding: "8px 12px" }}>
                        <span style={{ background: "#f4f4f6", color: "#666", fontSize: 10, padding: "2px 8px", borderRadius: 4, fontFamily: "monospace", whiteSpace: "nowrap" }}>{l._banco}</span>
                      </td>
                      <td style={{ padding: "8px 12px", color: "#333", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={l.movimento}>{l.movimento}</td>
                      <td style={{ padding: "8px 12px", fontFamily: "monospace", fontWeight: 700, whiteSpace: "nowrap", color: (parseFloat(l.valor) || 0) < 0 ? "#dc2626" : "#16a34a" }}>
                        {fmtEuro(l.valor)}
                      </td>
                      <td style={{ padding: "8px 12px", color: "#666", fontFamily: "monospace", whiteSpace: "nowrap" }}>{fmtEuro(l.saldo)}</td>
                      <td style={{ padding: "5px 8px", minWidth: 160 }}>
                        <CelulaSelect valor={l.categoria} opcoes={CATEGORIAS} placeholder="— sem categoria —"
                          onSave={guardarCampo(l.id, "categoria")} />
                      </td>
                      <td style={{ padding: "5px 8px", minWidth: 155 }}>
                        <CelulaSelect valor={l.subcategoria} opcoes={SUBCATEGORIAS[l.categoria] || []}
                          disabled={!l.categoria}
                          placeholder={l.categoria ? "— subcategoria —" : "escolhe a categoria"}
                          onSave={guardarCampo(l.id, "subcategoria")} />
                      </td>
                      <td style={{ padding: "5px 8px", minWidth: 170 }}>
                        <CelulaTexto valor={l.detalhes} placeholder="Observação…" onSave={guardarCampo(l.id, "detalhes")} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderTop: "1px solid #f0f0f0", flexWrap: "wrap", gap: 10 }}>
              <div style={{ fontSize: 11, color: "#aaa", fontFamily: "monospace" }}>
                {fmtInt(filtradas.length)} de {fmtInt(linhas.length)} lançamentos
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <select value={perPage} onChange={e => setPerPage(Number(e.target.value))}
                  style={{ background: "#fafafa", border: "1px solid #eee", borderRadius: 6, padding: "5px 8px", fontSize: 11, outline: "none" }}>
                  {[25, 50, 100, 250].map(n => <option key={n} value={n}>{n} por página</option>)}
                </select>
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                  style={{ background: page <= 1 ? "#f7f7f7" : "#f0f4ff", border: "none", color: page <= 1 ? "#ddd" : "#4a6fa5", padding: "5px 11px", borderRadius: 6, fontSize: 12, cursor: page <= 1 ? "default" : "pointer" }}>‹</button>
                <span style={{ fontSize: 11, color: "#888", fontFamily: "monospace", whiteSpace: "nowrap" }}>Pág. {page} / {totalPaginas}</span>
                <button onClick={() => setPage(p => Math.min(totalPaginas, p + 1))} disabled={page >= totalPaginas}
                  style={{ background: page >= totalPaginas ? "#f7f7f7" : "#f0f4ff", border: "none", color: page >= totalPaginas ? "#ddd" : "#4a6fa5", padding: "5px 11px", borderRadius: 6, fontSize: 12, cursor: page >= totalPaginas ? "default" : "pointer" }}>›</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
