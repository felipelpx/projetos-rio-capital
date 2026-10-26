import { useState, useMemo } from "react";
import { useEntidades } from "./hooks.js";

const TIPOS = ["Cliente", "Fornecedor", "Empresa"];
const TIPO_COLORS = {
  "Cliente":    { bg: "#f0fdf4", text: "#16a34a", border: "#bbf7d0" },
  "Fornecedor": { bg: "#eff6ff", text: "#2563eb", border: "#bfdbfe" },
  "Empresa":    { bg: "#fffbeb", text: "#d97706", border: "#fde68a" },
};

const inp = { background: "#f8f8f8", border: "1px solid #eee", borderRadius: 7, padding: "8px 11px", fontSize: 12, outline: "none", width: "100%", boxSizing: "border-box" };
const lbl = { fontSize: 9, color: "#aaa", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 3 };

function EntidadeModal({ entidade, onSave, onClose }) {
  const [form, setForm] = useState(entidade || {
    tipo: "Cliente", nome: "", nome_fantasia: "", categoria: "", nif: "", email: "", telefone: "",
    morada: "", iban: "", notas: "",
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: 560, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 22 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#1a1a2e", fontFamily: "Georgia,serif" }}>
            {entidade ? "✎ Editar Entidade" : "+ Nova Entidade"}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#aaa" }}>✕</button>
        </div>

        {/* Tipo */}
        <div style={{ marginBottom: 16 }}>
          <label style={lbl}>Tipo *</label>
          <div style={{ display: "flex", gap: 8 }}>
            {TIPOS.map(t => (
              <button key={t} onClick={() => set("tipo", t)}
                style={{ flex: 1, padding: "8px", borderRadius: 8, border: `2px solid ${form.tipo === t ? TIPO_COLORS[t].border : "#eee"}`, background: form.tipo === t ? TIPO_COLORS[t].bg : "#fff", color: form.tipo === t ? TIPO_COLORS[t].text : "#888", fontSize: 12, fontWeight: form.tipo === t ? 700 : 400, cursor: "pointer" }}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ gridColumn: "1/-1" }}>
            <label style={lbl}>Razão social / Nome completo *</label>
            <input type="text" value={form.nome} onChange={e => set("nome", e.target.value)} style={{ ...inp, fontSize: 14 }} placeholder="Como consta na fatura e no registo comercial..." />
          </div>
          <div>
            <label style={lbl}>Categoria</label>
            <input type="text" value={form.categoria || ""} onChange={e => set("categoria", e.target.value)} style={inp}
              placeholder="Jurídico, Software, Construção..." />
          </div>
          <div style={{ gridColumn: "1/-1" }}>
            <label style={lbl}>Nome comercial</label>
            <input type="text" value={form.nome_fantasia || ""} onChange={e => set("nome_fantasia", e.target.value)} style={inp}
              placeholder="Como tratamos a empresa no dia a dia (opcional)" />
          </div>
          {[["NIF", "nif", "text"], ["Email", "email", "email"], ["Telefone", "telefone", "text"], ["IBAN", "iban", "text"]].map(([label, name, type]) => (
            <div key={name}>
              <label style={lbl}>{label}</label>
              <input type={type} value={form[name] || ""} onChange={e => set(name, e.target.value)} style={inp} />
            </div>
          ))}
          <div style={{ gridColumn: "1/-1" }}>
            <label style={lbl}>Morada</label>
            <input type="text" value={form.morada || ""} onChange={e => set("morada", e.target.value)} style={inp} />
          </div>
          <div style={{ gridColumn: "1/-1" }}>
            <label style={lbl}>Notas</label>
            <textarea value={form.notas || ""} onChange={e => set("notas", e.target.value)} rows={2}
              style={{ ...inp, resize: "vertical", fontFamily: "inherit" }} />
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
          <button onClick={onClose} style={{ background: "#f0f0f0", color: "#666", border: "none", padding: "10px 20px", borderRadius: 8, fontSize: 13, cursor: "pointer" }}>Cancelar</button>
          <button onClick={() => { if (!form.nome) return; onSave(form); }}
            style={{ background: "#1a1a2e", color: "#fff", border: "none", padding: "10px 24px", borderRadius: 8, fontSize: 13, cursor: "pointer", fontWeight: 700 }}>
            💾 Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

export default function EntidadesView({ currentUser }) {
  const { entidades, addEntidade, updateEntidade, deleteEntidade } = useEntidades();
  const [filterTipo, setFilterTipo] = useState("Todos");
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);

  const canEdit = currentUser?.role === "admin" || currentUser?.role === "gestor";

  const filtered = useMemo(() => entidades.filter(e =>
    (filterTipo === "Todos" || e.tipo === filterTipo) &&
    (!search || (e.nome || "").toLowerCase().includes(search.toLowerCase()) ||
      (e.nome_fantasia || "").toLowerCase().includes(search.toLowerCase()) ||
      (e.nif || "").includes(search) || (e.email || "").toLowerCase().includes(search.toLowerCase()))
  ), [entidades, filterTipo, search]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#1a1a2e", fontFamily: "Georgia,serif" }}>📋 Base de Dados de Entidades</div>
          <div style={{ fontSize: 12, color: "#aaa", marginTop: 2 }}>Clientes, Fornecedores e Empresas</div>
        </div>
        {canEdit && (
          <button onClick={() => { setEditItem(null); setShowModal(true); }}
            style={{ background: "#1a1a2e", color: "#fff", border: "none", padding: "9px 18px", borderRadius: 8, fontSize: 12, cursor: "pointer", fontWeight: 700 }}>
            + Nova Entidade
          </button>
        )}
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
        {[
          { label: "Total", value: entidades.length, color: "#1a1a2e" },
          { label: "Clientes", value: entidades.filter(e => e.tipo === "Cliente").length, color: "#16a34a" },
          { label: "Fornecedores", value: entidades.filter(e => e.tipo === "Fornecedor").length, color: "#2563eb" },
          { label: "Empresas", value: entidades.filter(e => e.tipo === "Empresa").length, color: "#d97706" },
        ].map((k, i) => (
          <div key={i} style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 10, padding: "12px 16px", borderTop: `3px solid ${k.color}` }}>
            <div style={{ fontSize: 9, color: "#aaa", textTransform: "uppercase", fontFamily: "monospace", marginBottom: 4 }}>{k.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: k.color, fontFamily: "monospace" }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Pesquisar nome, NIF, email..."
          style={{ flex: 2, minWidth: 180, ...inp, padding: "9px 14px" }} />
        {["Todos", ...TIPOS].map(t => (
          <button key={t} onClick={() => setFilterTipo(t)}
            style={{ background: filterTipo === t ? "#1a1a2e" : "#fff", color: filterTipo === t ? "#fff" : "#888", border: `1px solid ${filterTipo === t ? "#1a1a2e" : "#eee"}`, padding: "7px 16px", borderRadius: 8, fontSize: 12, cursor: "pointer" }}>
            {t}
          </button>
        ))}
      </div>

      {/* Table */}
      <div style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f8f9fc" }}>
                {["Tipo", "Nome", "NIF", "Email", "Telefone", "IBAN", "Notas", ...(canEdit ? ["Ações"] : [])].map(h => (
                  <th key={h} style={{ padding: "9px 14px", textAlign: "left", color: "#aaa", fontSize: 9, letterSpacing: "0.07em", textTransform: "uppercase", fontFamily: "monospace", borderBottom: "1px solid #f0f0f0", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: "48px", textAlign: "center", color: "#ccc" }}>
                  {entidades.length === 0 ? "Nenhuma entidade registada. Clica em \"+ Nova Entidade\"." : "Nenhum resultado para os filtros."}
                </td></tr>
              ) : filtered.map(e => {
                const tc = TIPO_COLORS[e.tipo] || TIPO_COLORS["Cliente"];
                return (
                  <tr key={e.id} style={{ borderBottom: "1px solid #fafafa" }}
                    onMouseEnter={el => el.currentTarget.style.background = "#f8f9fc"}
                    onMouseLeave={el => el.currentTarget.style.background = ""}>
                    <td style={{ padding: "10px 14px" }}>
                      <span style={{ background: tc.bg, color: tc.text, border: `1px solid ${tc.border}`, fontSize: 10, padding: "2px 9px", borderRadius: 20, fontFamily: "monospace", fontWeight: 600 }}>{e.tipo}</span>
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ fontWeight: 700, color: "#1a1a2e" }}>{e.nome_fantasia || e.nome}</div>
                      {e.nome_fantasia && <div style={{ fontSize: 10, color: "#bbb" }}>{e.nome}</div>}
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      {e.categoria ? <span style={{ background: "#f1f5f9", color: "#475569", fontSize: 10, padding: "2px 8px", borderRadius: 20 }}>{e.categoria}</span> : <span style={{ color: "#ddd" }}>—</span>}
                    </td>
                    <td style={{ padding: "10px 14px", color: "#888", fontFamily: "monospace" }}>{e.nif || "—"}</td>
                    <td style={{ padding: "10px 14px", color: "#555" }}>{e.email || "—"}</td>
                    <td style={{ padding: "10px 14px", color: "#888" }}>{e.telefone || "—"}</td>
                    <td style={{ padding: "10px 14px", color: "#888", fontFamily: "monospace", fontSize: 10 }}>{e.iban || "—"}</td>
                    <td style={{ padding: "10px 14px", color: "#aaa", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.notas || "—"}</td>
                    {canEdit && (
                      <td style={{ padding: "10px 14px" }}>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button onClick={() => { setEditItem(e); setShowModal(true); }}
                            style={{ background: "#f0f4ff", border: "none", color: "#4a6fa5", padding: "3px 8px", borderRadius: 5, fontSize: 10, cursor: "pointer" }}>✎</button>
                          <button onClick={async () => { if (window.confirm(`Eliminar ${e.nome}?`)) await deleteEntidade(e.id); }}
                            style={{ background: "#fff0f0", border: "none", color: "#dc2626", padding: "3px 8px", borderRadius: 5, fontSize: 10, cursor: "pointer" }}>✕</button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <EntidadeModal
          entidade={editItem}
          onSave={async form => {
            const res = editItem
              ? await updateEntidade(editItem.id, form)
              : await addEntidade(form);
            if (res?.error) {
              const msg = res.error.message || String(res.error);
              alert(/nome_fantasia|categoria/.test(msg)
                ? "Falta a coluna 'nome_fantasia' na tabela entidades. No SQL Editor do Supabase:\n\n"
                  + "alter table entidades add column if not exists nome_fantasia text;\n"
                  + "alter table entidades add column if not exists categoria text;"
                : "Erro ao guardar:\n\n" + msg);
              return;
            }
            setShowModal(false); setEditItem(null);
          }}
          onClose={() => { setShowModal(false); setEditItem(null); }}
        />
      )}
    </div>
  );
}
