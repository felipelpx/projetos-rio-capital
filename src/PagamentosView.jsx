import { useState, useMemo, useEffect, useRef } from "react";
import { useMapasPagamento, useMapaItens, useVendas, useDespesasRecorrentes, usePrevisoesBaixas } from "./hooks.js";
import { ocorrenciasParaMapa, partirOcorrenciaId } from "./conciliacao.js";
import LigarFatura from "./LigarFatura.jsx";
import { ocorrenciasDe } from "./recorrentes.js";
import { supabase } from "./supabase.js";
import { faturaPaga, statusFatura, STATUS_FATURA, STATUS_STYLES } from "./status.js";
import { useItensEmMapa } from "./hooks.js";
import { fmtEuro } from "./format.js";
import { labelEmpresa } from "./empresas.js";

const fmtFull = (v) => fmtEuro(v);
const fmtDate = (s) => {
  if (!s || typeof s !== "string" || s.length < 10) return s || "—";
  const m = s.substring(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
};
const fmtDateTime = (s) => {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

const STATUS_INFO = {
  pendente_nivel_1: { label: "Pendente N1", color: "#f59e0b", bg: "#fef3c7" },
  pendente_nivel_2: { label: "Pendente N2", color: "#3b82f6", bg: "#dbeafe" },
  aprovado:         { label: "Aprovado",     color: "#16a34a", bg: "#dcfce7" },
  recusado:         { label: "Recusado",     color: "#dc2626", bg: "#fee2e2" },
};

export default function PagamentosView({ faturas, pagamentosExtras, currentUser, profiles = [], carregarAnexo }) {
  const { mapas, loading: mapasLoading, addMapa, updateMapa, deleteMapa } = useMapasPagamento();
  // As avenças e contratos que se repetem: entram no mapa mesmo sem fatura.
  const { recorrentes } = useDespesasRecorrentes();
  const { baixas, baixar: baixarPrevisao } = usePrevisoesBaixas();
  const { vendas } = useVendas();
  const [view, setView] = useState("lista");  // 'lista' | 'novo' | 'detalhe'
  const [activeMapaId, setActiveMapaId] = useState(null);

  // permissões
  const canCreate = currentUser?.can_create_mapas || currentUser?.role === "admin";
  const isN1 = currentUser?.approval_level === 1;
  const isN2 = currentUser?.approval_level === 2;

  const profileById = useMemo(() => {
    const map = {};
    (profiles || []).forEach(p => { map[p.id] = p; });
    return map;
  }, [profiles]);
  const nomeUser = (id) => profileById[id]?.email || profileById[id]?.nome || id || "—";

  // KPIs
  const kpis = useMemo(() => {
    const m = mapas || [];
    return {
      total: m.length,
      pendN1: m.filter(x => x.status === "pendente_nivel_1").length,
      pendN2: m.filter(x => x.status === "pendente_nivel_2").length,
      aprovados: m.filter(x => x.status === "aprovado").length,
      recusados: m.filter(x => x.status === "recusado").length,
    };
  }, [mapas]);

  if (view === "novo") {
    return <NovoMapa
      faturas={faturas} pagamentosExtras={pagamentosExtras} vendas={vendas}
      recorrentes={recorrentes} baixas={baixas}
      currentUser={currentUser}
      onCancel={() => setView("lista")}
      onCreated={async (mapa, itens) => {
        const res = await addMapa(mapa, itens);
        if (res.error) {
          alert("Erro ao criar mapa:\n\n" + (res.error.message || res.error));
          return;
        }
        setView("lista");
      }}
    />;
  }

  if (view === "detalhe" && activeMapaId) {
    return <DetalheMapa
      mapaId={activeMapaId}
      mapas={mapas}
      currentUser={currentUser}
      profileById={profileById}
      faturas={faturas}
      pagamentosExtras={pagamentosExtras}
      carregarAnexo={carregarAnexo}
      recorrentes={recorrentes} baixas={baixas} baixarPrevisao={baixarPrevisao}
      onClose={() => { setActiveMapaId(null); setView("lista"); }}
      onUpdate={updateMapa}
      onDelete={async (id, mapa) => {
        const emN2 = mapa?.status === "pendente_nivel_2";
        const aviso = "Eliminar este mapa? Esta ação é irreversível."
          + (emN2 ? "\n\nO mapa já tem aprovação de nível 1. Ao eliminar, essa aprovação perde-se e os itens voltam a ficar disponíveis para outro mapa." : "")
          + "\n\nOs itens do mapa são apagados com ele; as faturas e os pagamentos em si não são tocados.";
        if (!confirm(aviso)) return;
        const res = await deleteMapa(id);
        if (res.error) { alert("Erro ao eliminar:\n\n" + (res.error.message || res.error)); return; }
        // O Supabase devolve sucesso com zero linhas quando falta a política
        // DELETE — sem esta verificação o ecrã dizia que tinha apagado e o
        // mapa continuava lá.
        if (!res.data || res.data.length === 0) {
          alert("Nada foi eliminado.\n\nO mapa continua na base de dados. Isto costuma significar que falta a política DELETE na tabela 'mapas_pagamento' (Supabase → Authentication → Policies).");
          return;
        }
        setActiveMapaId(null); setView("lista");
      }}
    />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, fontFamily: "'DM Sans', sans-serif" }}>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0, fontFamily: "Georgia, serif", fontSize: 22, color: "#1a1a2e" }}>Mapas de Pagamento</h2>
        {canCreate && (
          <button onClick={() => setView("novo")}
            style={{ background: "#16a34a", color: "#fff", border: "none", padding: "9px 20px", borderRadius: 8, fontSize: 13, cursor: "pointer", fontWeight: 700 }}>
            + Novo Mapa
          </button>
        )}
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
        {[
          { label: "Total Mapas", value: kpis.total, color: "#1a1a2e" },
          { label: "Pendente N1", value: kpis.pendN1, color: "#f59e0b" },
          { label: "Pendente N2", value: kpis.pendN2, color: "#3b82f6" },
          { label: "Aprovados", value: kpis.aprovados, color: "#16a34a" },
          { label: "Recusados", value: kpis.recusados, color: "#dc2626" },
        ].map((k, i) => (
          <div key={i} style={{ background: "#fff", borderRadius: 10, padding: "14px 16px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)", borderTop: `3px solid ${k.color}` }}>
            <div style={{ fontSize: 10, color: "#aaa", textTransform: "uppercase", fontFamily: "monospace", marginBottom: 4 }}>{k.label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: k.color, fontFamily: "monospace" }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Tabela de mapas */}
      <div style={{ background: "#fff", borderRadius: 10, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #f0f0f0", fontWeight: 600, fontSize: 14, color: "#1a1a2e" }}>
          Lista de Mapas
        </div>
        {mapasLoading ? (
          <div style={{ padding: 32, textAlign: "center", color: "#888" }}>A carregar…</div>
        ) : (!mapas || mapas.length === 0) ? (
          <div style={{ padding: 32, textAlign: "center", color: "#888" }}>
            Ainda não há mapas de pagamento. {canCreate && "Clica em '+ Novo Mapa' para criar o primeiro."}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#fafafa", textAlign: "left" }}>
                <th style={{ padding: "10px 16px", fontWeight: 600, color: "#666", textTransform: "uppercase", fontSize: 10, fontFamily: "monospace" }}>Nº</th>
                <th style={{ padding: "10px 16px", fontWeight: 600, color: "#666", textTransform: "uppercase", fontSize: 10, fontFamily: "monospace" }}>Descrição</th>
                <th style={{ padding: "10px 16px", fontWeight: 600, color: "#666", textTransform: "uppercase", fontSize: 10, fontFamily: "monospace" }}>Criado por</th>
                <th style={{ padding: "10px 16px", fontWeight: 600, color: "#666", textTransform: "uppercase", fontSize: 10, fontFamily: "monospace" }}>Data</th>
                <th style={{ padding: "10px 16px", fontWeight: 600, color: "#666", textTransform: "uppercase", fontSize: 10, fontFamily: "monospace", textAlign: "right" }}>Total</th>
                <th style={{ padding: "10px 16px", fontWeight: 600, color: "#666", textTransform: "uppercase", fontSize: 10, fontFamily: "monospace" }}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {mapas.map(m => {
                const st = STATUS_INFO[m.status] || { label: m.status, color: "#888", bg: "#eee" };
                return (
                  <tr key={m.id}
                    onClick={() => { setActiveMapaId(m.id); setView("detalhe"); }}
                    style={{ borderBottom: "1px solid #f5f5f5", cursor: "pointer" }}
                    onMouseOver={e => e.currentTarget.style.background = "#fafafa"}
                    onMouseOut={e => e.currentTarget.style.background = "transparent"}>
                    <td style={{ padding: "10px 16px", fontFamily: "monospace", color: "#1a1a2e", fontWeight: 600 }}>{m.numero || m.id?.slice(0, 8)}</td>
                    <td style={{ padding: "10px 16px" }}>{m.descricao || "—"}</td>
                    <td style={{ padding: "10px 16px", color: "#666", fontSize: 11 }}>{nomeUser(m.created_by)}</td>
                    <td style={{ padding: "10px 16px", color: "#666", fontSize: 11 }}>{fmtDateTime(m.created_at)}</td>
                    <td style={{ padding: "10px 16px", textAlign: "right", fontFamily: "monospace", fontWeight: 600 }}>{fmtFull(m.total_valor)}</td>
                    <td style={{ padding: "10px 16px" }}>
                      <span style={{ background: st.bg, color: st.color, padding: "3px 8px", borderRadius: 4, fontSize: 10, fontFamily: "monospace", fontWeight: 700 }}>
                        {st.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Info de permissões */}
      <div style={{ background: "#f0f4ff", border: "1px solid #c7d2fe", borderRadius: 8, padding: "10px 14px", fontSize: 11, color: "#3730a3" }}>
        <strong>O teu nível:</strong> {isN1 ? "Aprovador Nível 1" : isN2 ? "Aprovador Nível 2" : "Sem aprovação"}
        {canCreate && " · Podes criar mapas"}
      </div>
    </div>
  );
}

// ─── Componente: criar novo mapa ─────────────────────────────────────────────
function NovoMapa({ faturas, pagamentosExtras, vendas, recorrentes = [], baixas = [], currentUser, onCancel, onCreated }) {
  // Itens que já estão noutro mapa não voltam a ser oferecidos — evita que o
  // mesmo pagamento siga em dois mapas. Um mapa recusado liberta os seus.
  const { chaves: jaEmMapa } = useItensEmMapa();
  const hoje = new Date().toISOString().slice(0, 10);
  const [descricao, setDescricao] = useState(`Mapa de ${hoje.split("-").reverse().join("-")}`);
  const [selected, setSelected] = useState({});  // key -> true
  const [filtro, setFiltro] = useState("");
  const [filtroEmpresa, setFiltroEmpresa] = useState("");
  const [filtroFornecedor, setFiltroFornecedor] = useState("");
  const [filtroVencDe, setFiltroVencDe] = useState("");
  const [filtroVencAte, setFiltroVencAte] = useState("");
  // Estados a incluir no mapa. Os bloqueados ficam de fora por defeito: não é
  // suposto pagá-los, e entrarem no mapa por engano levava-os a aprovação.
  const [estadosIncluidos, setEstadosIncluidos] = useState(
    () => new Set(STATUS_FATURA.filter(s => s !== "Pago" && s !== "Pagamento bloqueado" && s !== "Adicionado ao mapa"))
  );

  // Construir lista de candidatos: faturas pendentes + pagamentos manuais pendentes + comissões pendentes
  const candidatos = useMemo(() => {
    const out = [];

    // 1. Faturas (Contas a Pagar) que estão Pendente ou Vencida
    (faturas || []).forEach(f => {
      if (faturaPaga(f)) return;
      out.push({
        key: `fatura:${f.id}`,
        tipo_origem: "fatura",
        origem_id: f.id,
        descricao: f.fatura || "(sem fatura)",
        fornecedor: f.fornecedor || "",
        empresa: f.empresa || "",
        categoria: f.categoria || "",
        valor: parseFloat(f.valor) || 0,
        vencimento: f.vencimento,
        previsao: f.previsao_pagamento || null,
        estado: statusFatura(f),
        _label: "Fatura",
      });
    });

    // 2. Pagamentos extras Pendentes
    (pagamentosExtras || []).forEach(p => {
      // "Convertida" = a previsão já deu origem a uma fatura real, e é essa
      // fatura que entra no mapa. Sem esta exclusão o mesmo custo aparecia
      // duas vezes e podia ser pago a dobrar.
      if (["Paga", "Pago", "Convertida"].includes(p.status)) return;
      if (p.tipo === "entrada") return;  // só saídas vão para mapa
      out.push({
        key: `pagamento_extra:${p.id}`,
        tipo_origem: "pagamento_extra",
        origem_id: p.id,
        descricao: p.descricao || "",
        fornecedor: "",
        empresa: p.empresa || "",
        categoria: p.categoria || "",
        valor: parseFloat(p.valor) || 0,
        vencimento: p.data_inicio,
        _label: "Pagamento",
      });
    });

    // 3. Comissões pendentes de vendas (sinal e escritura)
    (vendas || []).forEach(v => {
      if (v.comissao_pendente_sinal > 0 && v.data_pagamento_sinal) {
        out.push({
          key: `comissao_sinal:${v.id}`,
          tipo_origem: "comissao_sinal",
          origem_id: String(v.id),
          descricao: `Comissão sinal · ${v.fracao} (${v.cliente || "—"})`,
          fornecedor: v.imobiliaria || "",
          empresa: v.projeto || "",
          categoria: "Comissão",
          valor: parseFloat(v.comissao_pendente_sinal) || 0,
          vencimento: v.data_pagamento_sinal,
          _label: "Comissão Sinal",
        });
      }
      if (v.comissao_pendente_escritura > 0 && v.data_pagamento_escritura) {
        out.push({
          key: `comissao_escritura:${v.id}`,
          tipo_origem: "comissao_escritura",
          origem_id: String(v.id),
          descricao: `Comissão escritura · ${v.fracao} (${v.cliente || "—"})`,
          fornecedor: v.imobiliaria || "",
          empresa: v.projeto || "",
          categoria: "Comissão",
          valor: parseFloat(v.comissao_pendente_escritura) || 0,
          vencimento: v.data_pagamento_escritura,
          _label: "Comissão Escritura",
        });
      }
    });


    // 4. Despesas recorrentes — a avença paga-se no dia certo, tenha ou não
    //    chegado a fatura. As que já têm fatura não entram aqui: entra a
    //    fatura, pelo Contas a Pagar.
    ocorrenciasParaMapa({ recorrentes, baixas, ocorrenciasDe }).forEach(oc => {
      out.push({
        key: `recorrente:${oc.ocorrenciaId}`,
        tipo_origem: "recorrente",
        origem_id: oc.ocorrenciaId,
        descricao: oc.descricao,
        fornecedor: "",
        empresa: oc.empresa,
        categoria: oc.categoria || "",
        valor: oc.valor,
        vencimento: oc.data,
        previsao: oc.data,
        estado: null,
        _label: "Recorrente",
        _semFatura: true,
      });
    });

    // Ordem de trabalho: a data em que tencionamos pagar. Sem previsão usa-se o
    // vencimento; sem nenhuma, vai para o fim.
    out.sort((a, b) => (a.previsao || a.vencimento || "9999").localeCompare(b.previsao || b.vencimento || "9999"));
    return out;
  }, [faturas, pagamentosExtras, vendas, recorrentes, baixas]);

  // Listas únicas para dropdowns
  const empresasUnicas = useMemo(() => {
    const set = new Set();
    candidatos.forEach(c => { if (c.empresa) set.add(c.empresa); });
    return [...set].sort();
  }, [candidatos]);

  const fornecedoresUnicos = useMemo(() => {
    const set = new Set();
    candidatos.forEach(c => { if (c.fornecedor) set.add(c.fornecedor); });
    return [...set].sort();
  }, [candidatos]);

  const candidatosFiltrados = useMemo(() => {
    return candidatos.filter(c => {
      // Já está noutro mapa
      if (jaEmMapa.has(`${c.tipo_origem}:${c.origem_id}`)) return false;
      // Texto
      if (filtro) {
        const f = filtro.toLowerCase();
        if (
          !(c.descricao || "").toLowerCase().includes(f) &&
          !(c.fornecedor || "").toLowerCase().includes(f) &&
          !(c.empresa || "").toLowerCase().includes(f) &&
          !(c.categoria || "").toLowerCase().includes(f)
        ) return false;
      }
      // Estado (faturas)
      if (c.estado && !estadosIncluidos.has(c.estado)) return false;
      // Empresa
      if (filtroEmpresa && c.empresa !== filtroEmpresa) return false;
      // Fornecedor
      if (filtroFornecedor && c.fornecedor !== filtroFornecedor) return false;
      // Vencimento de/até
      if (filtroVencDe && (!c.vencimento || c.vencimento < filtroVencDe)) return false;
      if (filtroVencAte && (!c.vencimento || c.vencimento > filtroVencAte)) return false;
      return true;
    });
  }, [candidatos, filtro, filtroEmpresa, filtroFornecedor, filtroVencDe, filtroVencAte, estadosIncluidos, jaEmMapa]);

  const totalSelecionado = useMemo(() => {
    return candidatos.filter(c => selected[c.key]).reduce((s, c) => s + c.valor, 0);
  }, [candidatos, selected]);

  const nSelecionados = Object.values(selected).filter(Boolean).length;

  // Quantos ficaram de fora por já estarem noutro mapa — dito ao utilizador,
  // para a lista não encolher sem explicação.
  const nJaEmMapa = useMemo(
    () => candidatos.filter(c => jaEmMapa.has(`${c.tipo_origem}:${c.origem_id}`)).length,
    [candidatos, jaEmMapa]
  );

  const toggleAll = () => {
    if (nSelecionados === candidatosFiltrados.length) {
      setSelected({});
    } else {
      const all = {};
      candidatosFiltrados.forEach(c => all[c.key] = true);
      setSelected(all);
    }
  };

  const submit = async () => {
    if (nSelecionados === 0) { alert("Seleciona pelo menos uma linha"); return; }
    const itens = candidatos.filter(c => selected[c.key]).map(c => ({
      tipo_origem: c.tipo_origem,
      origem_id: c.origem_id,
      descricao: c.descricao,
      fornecedor: c.fornecedor,
      empresa: c.empresa,
      categoria: c.categoria,
      valor: c.valor,
      vencimento: c.vencimento || null,
    }));
    const mapa = {
      descricao,
      status: "pendente_nivel_1",
      total_valor: totalSelecionado,
      created_by: currentUser?.id || null,
      // numero: vai ser preenchido por um trigger ou inferido depois (deixa null por agora)
    };
    await onCreated(mapa, itens);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0, fontFamily: "Georgia, serif", fontSize: 22, color: "#1a1a2e" }}>Novo Mapa de Pagamento</h2>
        <button onClick={onCancel} style={{ background: "#f0f0f0", color: "#666", border: "none", padding: "9px 20px", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>← Voltar</button>
      </div>

      {/* Header form */}
      <div style={{ background: "#fff", borderRadius: 10, padding: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
        <div style={{ fontSize: 10, color: "#888", textTransform: "uppercase", fontFamily: "monospace", marginBottom: 5 }}>Descrição do mapa</div>
        <input value={descricao} onChange={e => setDescricao(e.target.value)}
          style={{ width: "100%", padding: "9px 12px", border: "1px solid #e5e5e5", borderRadius: 6, fontSize: 13, fontFamily: "inherit" }} />
      </div>

      {/* Tabela de candidatos */}
      <div style={{ background: "#fff", borderRadius: 10, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
        <div style={{ padding: "12px 18px", borderBottom: "1px solid #f0f0f0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: "#1a1a2e" }}>
            Itens disponíveis ({candidatosFiltrados.length}{candidatosFiltrados.length !== candidatos.length ? ` de ${candidatos.length}` : ""}) · <span style={{ color: "#16a34a" }}>{nSelecionados} selecionados</span>
            {nJaEmMapa > 0 && (
              <span style={{ fontWeight: 400, fontSize: 11, color: "#0d9488", marginLeft: 8 }}>
                · {nJaEmMapa} já {nJaEmMapa === 1 ? "está noutro mapa" : "estão noutros mapas"}
              </span>
            )}
          </div>
          <input value={filtro} onChange={e => setFiltro(e.target.value)} placeholder="Pesquisa livre…"
            style={{ padding: "6px 10px", border: "1px solid #e5e5e5", borderRadius: 6, fontSize: 12, fontFamily: "inherit", width: 200 }} />
        </div>
        {/* Filtros estruturados */}
        <div style={{ padding: "10px 18px", borderBottom: "1px solid #f0f0f0", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", background: "#fafafa" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 10, color: "#888", textTransform: "uppercase", fontFamily: "monospace" }}>Empresa:</span>
            <select value={filtroEmpresa} onChange={e => setFiltroEmpresa(e.target.value)}
              style={{ padding: "5px 8px", border: "1px solid #e5e5e5", borderRadius: 6, fontSize: 11, fontFamily: "inherit", background: "#fff" }}>
              <option value="">Todas</option>
              {empresasUnicas.map(e => <option key={e} value={e}>{labelEmpresa(e)}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 10, color: "#888", textTransform: "uppercase", fontFamily: "monospace" }}>Fornecedor:</span>
            <select value={filtroFornecedor} onChange={e => setFiltroFornecedor(e.target.value)}
              style={{ padding: "5px 8px", border: "1px solid #e5e5e5", borderRadius: 6, fontSize: 11, fontFamily: "inherit", background: "#fff", maxWidth: 200 }}>
              <option value="">Todos</option>
              {fornecedoresUnicos.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 10, color: "#888", textTransform: "uppercase", fontFamily: "monospace" }}>Vencimento de:</span>
            <input type="date" value={filtroVencDe} onChange={e => setFiltroVencDe(e.target.value)}
              style={{ padding: "4px 6px", border: "1px solid #e5e5e5", borderRadius: 6, fontSize: 11, fontFamily: "monospace" }} />
            <span style={{ fontSize: 10, color: "#888", textTransform: "uppercase", fontFamily: "monospace" }}>até:</span>
            <input type="date" value={filtroVencAte} onChange={e => setFiltroVencAte(e.target.value)}
              style={{ padding: "4px 6px", border: "1px solid #e5e5e5", borderRadius: 6, fontSize: 11, fontFamily: "monospace" }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", flexBasis: "100%" }}>
            <span style={{ fontSize: 10, color: "#888", textTransform: "uppercase", fontFamily: "monospace", marginRight: 2 }}>Estado:</span>
            {STATUS_FATURA.filter(st => st !== "Pago" && st !== "Adicionado ao mapa").map(st => {
              const on = estadosIncluidos.has(st);
              const cor = STATUS_STYLES[st] || {};
              return (
                <button key={st}
                  onClick={() => setEstadosIncluidos(prev => {
                    const n = new Set(prev);
                    n.has(st) ? n.delete(st) : n.add(st);
                    return n;
                  })}
                  title={on ? "Incluído no mapa — clica para excluir" : "Excluído — clica para incluir"}
                  style={{
                    background: on ? cor.bg : "#fff", color: on ? cor.text : "#bbb",
                    border: `1px solid ${on ? cor.border : "#e5e5e5"}`,
                    textDecoration: on ? "none" : "line-through",
                    padding: "3px 9px", borderRadius: 20, fontSize: 10, cursor: "pointer", fontFamily: "monospace",
                  }}>
                  {on ? "✓ " : ""}{st}
                </button>
              );
            })}
          </div>
          {(filtro || filtroEmpresa || filtroFornecedor || filtroVencDe || filtroVencAte) && (
            <button onClick={() => { setFiltro(""); setFiltroEmpresa(""); setFiltroFornecedor(""); setFiltroVencDe(""); setFiltroVencAte(""); }}
              title="Limpar todos os filtros"
              style={{ background: "#fee2e2", color: "#dc2626", border: "none", padding: "4px 10px", borderRadius: 6, fontSize: 10, cursor: "pointer", fontWeight: 600 }}>
              ✕ Limpar filtros
            </button>
          )}
        </div>
        <div style={{ maxHeight: 500, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead style={{ background: "#fafafa", position: "sticky", top: 0 }}>
              <tr>
                <th style={{ padding: "8px 12px", textAlign: "center", width: 30 }}>
                  <input type="checkbox" checked={candidatosFiltrados.length > 0 && nSelecionados === candidatosFiltrados.length} onChange={toggleAll} />
                </th>
                <th style={{ padding: "8px 12px", fontWeight: 600, color: "#666", textTransform: "uppercase", fontSize: 9, fontFamily: "monospace", textAlign: "left" }}>Tipo</th>
                <th style={{ padding: "8px 12px", fontWeight: 600, color: "#666", textTransform: "uppercase", fontSize: 9, fontFamily: "monospace", textAlign: "left" }}>Vencimento</th>
                <th style={{ padding: "8px 12px", fontWeight: 600, color: "#666", textTransform: "uppercase", fontSize: 9, fontFamily: "monospace", textAlign: "left" }}>Prev. pagamento</th>
                <th style={{ padding: "8px 12px", fontWeight: 600, color: "#666", textTransform: "uppercase", fontSize: 9, fontFamily: "monospace", textAlign: "left" }}>Estado</th>
                <th style={{ padding: "8px 12px", fontWeight: 600, color: "#666", textTransform: "uppercase", fontSize: 9, fontFamily: "monospace", textAlign: "left" }}>Descrição</th>
                <th style={{ padding: "8px 12px", fontWeight: 600, color: "#666", textTransform: "uppercase", fontSize: 9, fontFamily: "monospace", textAlign: "left" }}>Empresa</th>
                <th style={{ padding: "8px 12px", fontWeight: 600, color: "#666", textTransform: "uppercase", fontSize: 9, fontFamily: "monospace", textAlign: "left" }}>Categoria</th>
                <th style={{ padding: "8px 12px", fontWeight: 600, color: "#666", textTransform: "uppercase", fontSize: 9, fontFamily: "monospace", textAlign: "right" }}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {candidatosFiltrados.map(c => {
                const isSel = !!selected[c.key];
                return (
                  <tr key={c.key}
                    onClick={() => setSelected(s => ({ ...s, [c.key]: !s[c.key] }))}
                    style={{ borderBottom: "1px solid #f5f5f5", cursor: "pointer", background: isSel ? "#f0fdf4" : "transparent" }}>
                    <td style={{ padding: "8px 12px", textAlign: "center" }}>
                      <input type="checkbox" checked={isSel} readOnly />
                    </td>
                    <td style={{ padding: "8px 12px", color: "#888", fontSize: 10, fontFamily: "monospace" }}>{c._label}</td>
                    <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: 10 }}>{fmtDate(c.vencimento)}</td>
                    <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: 10, color: c.previsao ? "#4a6fa5" : "#ddd", fontWeight: c.previsao ? 600 : 400 }}>
                      {c.previsao ? fmtDate(c.previsao) : "—"}
                    </td>
                    <td style={{ padding: "8px 12px" }}>
                      {c.estado ? (() => {
                        const cor = STATUS_STYLES[c.estado] || {};
                        return <span style={{ background: cor.bg, color: cor.text, border: `1px solid ${cor.border}`, padding: "1px 7px", borderRadius: 20, fontSize: 9, fontFamily: "monospace", whiteSpace: "nowrap" }}>{c.estado}</span>;
                      })() : <span style={{ color: "#ddd", fontSize: 10 }}>—</span>}
                    </td>
                    <td style={{ padding: "8px 12px" }}>{c.fornecedor && <span style={{ color: "#888", marginRight: 6 }}>{c.fornecedor} ·</span>}{c.descricao || "—"}</td>
                    <td style={{ padding: "8px 12px", color: "#666", fontSize: 10 }}>{c.empresa ? labelEmpresa(c.empresa) : "—"}</td>
                    <td style={{ padding: "8px 12px", color: "#666" }}><span style={{ background: "#fef3c7", color: "#92400e", padding: "1px 6px", borderRadius: 3, fontSize: 9, fontFamily: "monospace" }}>{c.categoria || "—"}</span></td>
                    <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "monospace", fontWeight: 600, color: "#dc2626" }}>{fmtFull(c.valor)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer com total e botão */}
      <div style={{ background: "#1a1a2e", color: "#fff", borderRadius: 10, padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <span style={{ color: "#aaa", fontSize: 11, fontFamily: "monospace", textTransform: "uppercase", marginRight: 10 }}>Total selecionado</span>
          <span style={{ fontFamily: "monospace", fontSize: 18, fontWeight: 700, color: "#C8A96E" }}>{fmtFull(totalSelecionado)}</span>
          <span style={{ color: "#aaa", marginLeft: 12, fontSize: 11 }}>({nSelecionados} itens)</span>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onCancel} style={{ background: "#3a3a4e", color: "#fff", border: "none", padding: "10px 20px", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>Cancelar</button>
          <button onClick={submit}
            disabled={nSelecionados === 0}
            style={{ background: nSelecionados === 0 ? "#555" : "#16a34a", color: "#fff", border: "none", padding: "10px 24px", borderRadius: 8, cursor: nSelecionados === 0 ? "default" : "pointer", fontSize: 13, fontWeight: 700 }}>
            Criar mapa e enviar para aprovação N1 →
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Componente: detalhe de um mapa ──────────────────────────────────────────
// ── Editar um item de um mapa ainda por aprovar ─────────────────────────────
function EditarItemMapa({ item, onGuardar, onFechar }) {
  const [valor, setValor] = useState(String(item.valor ?? ""));
  const [vencimento, setVencimento] = useState(item.vencimento || "");
  const [descricao, setDescricao] = useState(item.descricao || "");
  const [aGravar, setAGravar] = useState(false);
  const inp = { width: "100%", background: "#f8f8f8", border: "1px solid #e8e8e8", borderRadius: 8, padding: "9px 12px", fontSize: 13, outline: "none", boxSizing: "border-box" };
  const lbl = { fontSize: 10, color: "#aaa", fontFamily: "monospace", textTransform: "uppercase", marginBottom: 4, display: "block" };

  const guardar = async () => {
    const v = parseFloat(String(valor).replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(v) || v <= 0) return alert("Valor inválido.");
    setAGravar(true);
    const ok = await onGuardar({ valor: Math.round(v * 100) / 100, vencimento: vencimento || null, descricao });
    setAGravar(false);
    if (ok) onFechar();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 14, padding: 24, width: 460, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "Georgia,serif", color: "#1a1a2e", marginBottom: 4 }}>Editar pagamento no mapa</div>
        <div style={{ fontSize: 12, color: "#888", marginBottom: 16 }}>{item.fornecedor || item.tipo_origem}</div>
        <div style={{ display: "grid", gap: 12 }}>
          <div><label style={lbl}>Descrição</label><input value={descricao} onChange={e => setDescricao(e.target.value)} style={inp} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div><label style={lbl}>Valor (€)</label><input value={valor} onChange={e => setValor(e.target.value)} style={{ ...inp, fontFamily: "monospace" }} /></div>
            <div><label style={lbl}>Data</label><input type="date" value={vencimento || ""} onChange={e => setVencimento(e.target.value)} style={inp} /></div>
          </div>
        </div>
        <div style={{ fontSize: 11, color: "#a16207", background: "#fffbeb", borderRadius: 8, padding: "8px 12px", marginTop: 14, lineHeight: 1.5 }}>
          Altera só o que vai para aprovação neste mapa. A fatura ou o pagamento de origem ficam como estão.
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
          <button onClick={onFechar} style={{ background: "#f0f0f0", border: "none", color: "#666", padding: "9px 18px", borderRadius: 8, fontSize: 12, cursor: "pointer" }}>Cancelar</button>
          <button onClick={guardar} disabled={aGravar} style={{ background: "#1a1a2e", border: "none", color: "#fff", padding: "9px 18px", borderRadius: 8, fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
            {aGravar ? "A guardar…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Adicionar pagamentos a um mapa ainda por aprovar ────────────────────────
function AdicionarAoMapa({ faturas, pagamentosExtras, recorrentes = [], baixas = [], jaNoMapa, onAdicionar, onFechar }) {
  // Não basta excluir o que já está NESTE mapa: um pagamento que esteja noutro
  // mapa por aprovar não pode entrar aqui também, senão era pago duas vezes.
  const { chaves: emQualquerMapa } = useItensEmMapa();
  const [sel, setSel] = useState({});
  const [pesquisa, setPesquisa] = useState("");
  const [aGravar, setAGravar] = useState(false);
  // Um mapa é quase sempre de um tipo só: ou se pagam faturas que chegaram, ou
  // se cobre o forecast do mês. Com tudo misturado numa lista de 134 linhas não
  // se encontrava nada.
  const [fTipos, setFTipos] = useState(() => new Set(["fatura", "pagamento_extra", "recorrente"]));
  const [fEstados, setFEstados] = useState(() => new Set());   // vazio = todos
  const [fEmpresa, setFEmpresa] = useState("");
  const [fDe, setFDe] = useState("");
  const [fAte, setFAte] = useState("");
  const alterna = (setter) => (v) => setter(a => { const n = new Set(a); n.has(v) ? n.delete(v) : n.add(v); return n; });
  const limparFiltros = () => {
    setFTipos(new Set(["fatura", "pagamento_extra", "recorrente"]));
    setFEstados(new Set()); setFEmpresa(""); setFDe(""); setFAte(""); setPesquisa("");
  };

  const candidatos = useMemo(() => {
    const out = [];
    (faturas || []).forEach(f => {
      if (faturaPaga(f)) return;
      const estado = statusFatura(f);
      if (estado === "Pagamento bloqueado") return;           // não entram em mapas
      out.push({
        key: `fatura:${f.id}`, tipo_origem: "fatura", origem_id: f.id,
        descricao: f.fatura || "(sem fatura)", fornecedor: f.fornecedor || "",
        empresa: f.empresa || "", categoria: f.categoria || "",
        valor: parseFloat(f.valor) || 0, vencimento: f.vencimento,
        previsao: f.previsao_pagamento || null, estado, _label: "Fatura",
      });
    });
    (pagamentosExtras || []).forEach(p => {
      if (["Paga", "Pago", "Convertida"].includes(p.status) || p.tipo === "entrada") return;
      out.push({
        key: `pagamento_extra:${p.id}`, tipo_origem: "pagamento_extra", origem_id: p.id,
        descricao: p.descricao || "", fornecedor: "", empresa: p.empresa || "",
        categoria: p.categoria || "", valor: parseFloat(p.valor) || 0,
        vencimento: p.data_inicio, previsao: null, estado: null, _label: "Previsão",
      });
    });

    // 4. Despesas recorrentes — a avença paga-se no dia certo, tenha ou não
    //    chegado a fatura. As que já têm fatura não entram aqui: entra a
    //    fatura, pelo Contas a Pagar.
    ocorrenciasParaMapa({ recorrentes, baixas, ocorrenciasDe }).forEach(oc => {
      out.push({
        key: `recorrente:${oc.ocorrenciaId}`,
        tipo_origem: "recorrente",
        origem_id: oc.ocorrenciaId,
        descricao: oc.descricao,
        fornecedor: "",
        empresa: oc.empresa,
        categoria: oc.categoria || "",
        valor: oc.valor,
        vencimento: oc.data,
        previsao: oc.data,
        estado: null,
        _label: "Recorrente",
        _semFatura: true,
      });
    });

    return out
      .filter(c => {
        const k = `${c.tipo_origem}:${c.origem_id}`;
        return !jaNoMapa.has(k) && !emQualquerMapa.has(k);
      })
      .sort((a, b) => (a.previsao || a.vencimento || "9999").localeCompare(b.previsao || b.vencimento || "9999"));
  }, [faturas, pagamentosExtras, recorrentes, baixas, jaNoMapa, emQualquerMapa]);

  const empresasDisponiveis = useMemo(
    () => [...new Set(candidatos.map(c => c.empresa).filter(Boolean))].sort((a, b) => labelEmpresa(a).localeCompare(labelEmpresa(b))),
    [candidatos]
  );
  const estadosDisponiveis = useMemo(
    () => [...new Set(candidatos.map(c => c.estado).filter(Boolean))].sort(),
    [candidatos]
  );
  const contaPorTipo = useMemo(() => {
    const m = { fatura: 0, pagamento_extra: 0, recorrente: 0 };
    candidatos.forEach(c => { if (m[c.tipo_origem] != null) m[c.tipo_origem]++; });
    return m;
  }, [candidatos]);

  const visiveis = candidatos.filter(c => {
    if (!fTipos.has(c.tipo_origem)) return false;
    // O filtro de estado é dos documentos: previsões e recorrentes não têm
    // estado nenhum, por isso saem de cena assim que se escolhe um.
    if (fEstados.size && !(c.estado && fEstados.has(c.estado))) return false;
    if (fEmpresa && c.empresa !== fEmpresa) return false;
    const d = c.previsao || c.vencimento || "";
    if (fDe && (!d || d < fDe)) return false;
    if (fAte && (!d || d > fAte)) return false;
    if (pesquisa) {
      const q = pesquisa.toLowerCase();
      if (![c.descricao, c.fornecedor, c.categoria, labelEmpresa(c.empresa)].some(x => (x || "").toLowerCase().includes(q))) return false;
    }
    return true;
  });
  const totalVisivel = visiveis.reduce((t, c) => t + c.valor, 0);
  const temFiltro = fTipos.size < 3 || fEstados.size > 0 || fEmpresa || fDe || fAte || pesquisa;
  const escolhidos = candidatos.filter(c => sel[c.key]);
  const visiveisKeys = new Set(visiveis.map(c => c.key));
  const nEscondidosSelecionados = escolhidos.filter(c => !visiveisKeys.has(c.key)).length;
  const total = escolhidos.reduce((t, c) => t + c.valor, 0);

  const adicionar = async () => {
    setAGravar(true);
    const ok = await onAdicionar(escolhidos);
    setAGravar(false);
    if (ok) onFechar();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 14, padding: 24, width: 900, maxWidth: "96vw", maxHeight: "86vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "Georgia,serif", color: "#1a1a2e" }}>Adicionar pagamentos ao mapa</div>
            <div style={{ fontSize: 12, color: "#888" }}>
              {temFiltro
                ? <>{visiveis.length} de {candidatos.length} disponíveis · <strong style={{ color: "#1a1a2e", fontFamily: "monospace" }}>{fmtFull(totalVisivel)}</strong></>
                : <>{candidatos.length} disponíveis · os que já estão num mapa e os bloqueados não aparecem</>}
            </div>
          </div>
          <input value={pesquisa} onChange={e => setPesquisa(e.target.value)} placeholder="Pesquisar…"
            style={{ background: "#f8f8f8", border: "1px solid #e8e8e8", borderRadius: 8, padding: "8px 12px", fontSize: 12, outline: "none", width: 220 }} />
        </div>

        {/* ── Filtros ───────────────────────────────────────────────────────
            O tipo é o que mais separa: um mapa costuma ser só de faturas que
            chegaram, ou só do forecast do mês. O estado desce ao detalhe das
            faturas, para apanhar por exemplo só as vencidas. */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-end", padding: "12px 14px", background: "#fafbfd", border: "1px solid #f0f0f0", borderRadius: 10, marginBottom: 12 }}>

          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 9, color: "#aaa", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.06em" }}>Tipo</span>
            <div style={{ display: "flex", gap: 5 }}>
              {[["fatura", "Com fatura"], ["pagamento_extra", "Previsão"], ["recorrente", "Recorrente"]].map(([v, r]) => {
                const on = fTipos.has(v);
                return (
                  <button key={v} onClick={() => alterna(setFTipos)(v)}
                    title={on ? `Esconder ${r.toLowerCase()}` : `Mostrar ${r.toLowerCase()}`}
                    style={{ background: on ? "#1a1a2e" : "#fff", color: on ? "#fff" : "#888",
                             border: `1px solid ${on ? "#1a1a2e" : "#e4e4e8"}`, padding: "6px 11px", borderRadius: 7,
                             fontSize: 11, cursor: "pointer", fontWeight: on ? 600 : 400, whiteSpace: "nowrap" }}>
                    {r} <span style={{ opacity: 0.6 }}>({contaPorTipo[v] || 0})</span>
                  </button>
                );
              })}
            </div>
          </div>

          {estadosDisponiveis.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ fontSize: 9, color: "#aaa", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Estado da fatura {fEstados.size ? "" : "· todos"}
              </span>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {estadosDisponiveis.map(st => {
                  const on = fEstados.has(st);
                  const cor = STATUS_STYLES[st] || {};
                  return (
                    <button key={st} onClick={() => alterna(setFEstados)(st)}
                      style={{ background: on ? (cor.bg || "#eee") : "#fff", color: on ? (cor.text || "#333") : "#999",
                               border: `1px solid ${on ? (cor.text || "#ccc") : "#e4e4e8"}`, padding: "6px 10px", borderRadius: 7,
                               fontSize: 10.5, cursor: "pointer", fontFamily: "monospace", whiteSpace: "nowrap", fontWeight: on ? 700 : 400 }}>
                      {st}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <label htmlFor="fmEmp" style={{ fontSize: 9, color: "#aaa", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.06em" }}>Empresa</label>
            <select id="fmEmp" value={fEmpresa} onChange={e => setFEmpresa(e.target.value)}
              style={{ background: "#fff", border: "1px solid #e4e4e8", borderRadius: 7, padding: "7px 10px", fontSize: 11.5, outline: "none", minWidth: 170 }}>
              <option value="">Todas</option>
              {empresasDisponiveis.map(e => <option key={e} value={e}>{labelEmpresa(e)}</option>)}
            </select>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 9, color: "#aaa", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.06em" }}>Prev. pagamento</span>
            <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
              <input type="date" value={fDe} onChange={e => setFDe(e.target.value)} aria-label="Prev. pagamento desde"
                style={{ background: "#fff", border: "1px solid #e4e4e8", borderRadius: 7, padding: "6px 8px", fontSize: 11, outline: "none" }} />
              <span style={{ color: "#ccc", fontSize: 11 }}>até</span>
              <input type="date" value={fAte} onChange={e => setFAte(e.target.value)} aria-label="Prev. pagamento até"
                style={{ background: "#fff", border: "1px solid #e4e4e8", borderRadius: 7, padding: "6px 8px", fontSize: 11, outline: "none" }} />
            </div>
          </div>

          {temFiltro && (
            <button onClick={limparFiltros}
              style={{ background: "none", border: "none", color: "#4a6fa5", fontSize: 11, cursor: "pointer", padding: "7px 2px", textDecoration: "underline" }}>
              limpar filtros
            </button>
          )}
        </div>
        <div style={{ flex: 1, overflowY: "auto", border: "1px solid #f0f0f0", borderRadius: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead style={{ background: "#fafafa", position: "sticky", top: 0 }}>
              <tr>{["", "Prev. pag.", "Descrição", "Empresa", "Estado", "Valor"].map(h => (
                <th key={h} style={{ padding: "8px 10px", textAlign: h === "Valor" ? "right" : "left", fontSize: 9, color: "#666", fontFamily: "monospace", textTransform: "uppercase" }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {visiveis.map(c => (
                <tr key={c.key} onClick={() => setSel(x => ({ ...x, [c.key]: !x[c.key] }))}
                  style={{ borderBottom: "1px solid #f5f5f5", cursor: "pointer", background: sel[c.key] ? "#f0fdf4" : "#fff" }}>
                  <td style={{ padding: "7px 10px", textAlign: "center" }}><input type="checkbox" checked={!!sel[c.key]} readOnly /></td>
                  <td style={{ padding: "7px 10px", fontFamily: "monospace", color: c.previsao ? "#4a6fa5" : "#888" }}>{fmtDate(c.previsao || c.vencimento)}</td>
                  <td style={{ padding: "7px 10px" }}>{c.fornecedor && <span style={{ color: "#888", marginRight: 6 }}>{c.fornecedor} ·</span>}{c.descricao}</td>
                  <td style={{ padding: "7px 10px", color: "#666", fontSize: 10 }}>{c.empresa ? labelEmpresa(c.empresa) : "—"}</td>
                  <td style={{ padding: "7px 10px" }}>
                    {c.estado ? (() => { const cor = STATUS_STYLES[c.estado] || {};
                      return <span style={{ background: cor.bg, color: cor.text, padding: "1px 7px", borderRadius: 20, fontSize: 9, fontFamily: "monospace", whiteSpace: "nowrap" }}>{c.estado}</span>; })()
                      : <span style={{ background: c.tipo_origem === "recorrente" ? "#eef2ff" : "#fff7ed",
                                       color: c.tipo_origem === "recorrente" ? "#4338ca" : "#b45309",
                                       padding: "1px 7px", borderRadius: 20, fontSize: 9, fontFamily: "monospace", whiteSpace: "nowrap" }}>
                          {c.tipo_origem === "recorrente" ? "recorrente" : "previsão"}
                        </span>}
                  </td>
                  <td style={{ padding: "7px 10px", textAlign: "right", fontFamily: "monospace", fontWeight: 600, color: "#dc2626" }}>{fmtFull(c.valor)}</td>
                </tr>
              ))}
              {!visiveis.length && (
                <tr><td colSpan={6} style={{ padding: 30, textAlign: "center", color: "#aaa" }}>
                  {temFiltro ? "Nenhum pagamento corresponde aos filtros." : "Nada para adicionar."}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
          <div style={{ fontSize: 12, color: "#888", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span>{escolhidos.length} selecionados · <strong style={{ color: "#1a1a2e", fontFamily: "monospace" }}>{fmtFull(total)}</strong></span>
            {visiveis.length > 0 && (
              <button onClick={() => setSel(x => { const n = { ...x }; visiveis.forEach(c => { n[c.key] = true; }); return n; })}
                style={{ background: "none", border: "none", color: "#4a6fa5", fontSize: 11, cursor: "pointer", textDecoration: "underline", padding: 0 }}>
                selecionar os {visiveis.length} visíveis
              </button>
            )}
            {escolhidos.length > 0 && (
              <button onClick={() => setSel({})}
                style={{ background: "none", border: "none", color: "#999", fontSize: 11, cursor: "pointer", textDecoration: "underline", padding: 0 }}>
                limpar seleção
              </button>
            )}
            {/* Mudar o filtro não desfaz a seleção — mas convém dizer que há
                coisas selecionadas fora do que se está a ver. */}
            {nEscondidosSelecionados > 0 && (
              <span style={{ color: "#b45309" }}>
                ⚠ {nEscondidosSelecionados} selecionado{nEscondidosSelecionados === 1 ? "" : "s"} fora do filtro
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={onFechar} style={{ background: "#f0f0f0", border: "none", color: "#666", padding: "9px 18px", borderRadius: 8, fontSize: 12, cursor: "pointer" }}>Cancelar</button>
            <button onClick={adicionar} disabled={!escolhidos.length || aGravar}
              style={{ background: escolhidos.length ? "#1a1a2e" : "#ddd", border: "none", color: "#fff", padding: "9px 18px", borderRadius: 8, fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
              {aGravar ? "A adicionar…" : `Adicionar ${escolhidos.length || ""}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetalheMapa({ mapaId, mapas, currentUser, profileById, faturas = [], pagamentosExtras = [], onClose, onUpdate, onDelete, carregarAnexo, recorrentes = [], baixas = [], baixarPrevisao }) {
  const mapa = (mapas || []).find(m => m.id === mapaId);
  const { itens, loading: itensLoading, reload: reloadItens } = useMapaItens(mapaId);
  // Itens a meio de uma decisão, para o clique ter resposta imediata.
  const [aDecidir, setADecidir] = useState(() => new Set());
  const [previewItem, setPreviewItem] = useState(null);  // {item, fatura|pagamento}
  const [editItem, setEditItem] = useState(null);        // item do mapa em edição
  const [ligarItem, setLigarItem] = useState(null);      // item à espera de fatura
  const [mostrarAdicionar, setMostrarAdicionar] = useState(false);
  // Selecção de itens para aprovação parcial — por defeito TODOS selecionados
  const [selectedItens, setSelectedItens] = useState(null);   // Set<itemId> — null = ainda não inicializado
  // Inicializar quando itens carregarem
  const conhecidos = useRef(new Set());
  useEffect(() => {
    if (itens.length > 0 && selectedItens === null) {
      setSelectedItens(new Set(itens.map(i => i.id)));
      itens.forEach(i => conhecidos.current.add(i.id));
      return;
    }
    // itens novos (adicionados depois de abrir o mapa) entram selecionados
    const novos = itens.filter(i => !conhecidos.current.has(i.id));
    if (novos.length && selectedItens) {
      setSelectedItens(prev => { const n = new Set(prev); novos.forEach(i => n.add(i.id)); return n; });
    }
    itens.forEach(i => conhecidos.current.add(i.id));
  }, [itens, selectedItens]);
  const toggleItemSel = (id) => {
    setSelectedItens(prev => {
      const s = new Set(prev || []);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  };
  const numSelecionados = selectedItens ? selectedItens.size : 0;
  const totalSelecionado = selectedItens
    ? itens.filter(i => selectedItens.has(i.id)).reduce((s, i) => s + (parseFloat(i.valor) || 0), 0)
    : 0;
  const todosSelecionados = selectedItens && itens.length > 0 && itens.every(i => selectedItens.has(i.id));

  const nomeUser = (id) => profileById[id]?.email || profileById[id]?.nome || id || "—";

  // ── Decisão item a item ───────────────────────────────────────────────────
  // Cada pagamento do mapa é aprovado ou recusado por si. O mapa só avança de
  // nível quando não sobra nenhum por decidir. Um item recusado fica no mapa,
  // riscado e com o nome de quem recusou — não desaparece como antes.
  const nivelAtual = mapa?.status === "pendente_nivel_1" ? 1
                   : mapa?.status === "pendente_nivel_2" ? 2 : null;
  const decisaoDe = (it) => {
    if (it.recusado) return "recusado";
    if (nivelAtual === 1) return it.aprovado_n1 ? "aprovado" : "pendente";
    if (nivelAtual === 2) return it.aprovado_n2 ? "aprovado" : "pendente";
    return it.recusado ? "recusado" : "aprovado";
  };
  // Se o 'select *' não trouxe sequer o campo, a coluna não existe na base.
  const faltamColunasDecisao = itens.length > 0
    && itens.every(i => i.aprovado_n1 === undefined && i.recusado === undefined);
  const itensAtivos   = itens.filter(i => !i.recusado);
  const itensRecusados= itens.filter(i => i.recusado);
  const porDecidir    = itens.filter(i => decisaoDe(i) === "pendente");
  const jaAprovados   = itensAtivos.filter(i => decisaoDe(i) === "aprovado");
  const totalAtivo    = itensAtivos.reduce((s, i) => s + (parseFloat(i.valor) || 0), 0);
  const totalAprovado = jaAprovados.reduce((s, i) => s + (parseFloat(i.valor) || 0), 0);
  const tudoDecidido  = itens.length > 0 && porDecidir.length === 0;

  const avisoColunas = (e) => {
    const msg = (e?.message || "") + " " + (e?.details || "");
    if (/aprovado_n1|aprovado_n2|recusado|column|schema cache/i.test(msg)) {
      alert("Faltam colunas novas na tabela 'mapas_pagamento_itens'.\n\nAbre /setup-aprovacao-item.html e corre o SQL indicado (uma vez só).");
      return true;
    }
    return false;
  };

  // Grava a decisão de um item. nivel vem do estado do mapa.
  const decidirItem = async (it, decisao, emLote = false) => {
    if (!currentUser?.id) { alert("Sem utilizador autenticado."); return; }
    if (!nivelAtual) return;
    const agora = new Date().toISOString();
    let updates;
    if (decisao === "recusado") {
      updates = { recusado: true, recusado_por: currentUser.id, recusado_em: agora };
    } else if (decisao === "pendente") {
      updates = nivelAtual === 1
        ? { aprovado_n1: false, aprovado_n1_por: null, aprovado_n1_em: null, recusado: false, recusado_por: null, recusado_em: null }
        : { aprovado_n2: false, aprovado_n2_por: null, aprovado_n2_em: null, recusado: false, recusado_por: null, recusado_em: null };
    } else {
      updates = nivelAtual === 1
        ? { aprovado_n1: true, aprovado_n1_por: currentUser.id, aprovado_n1_em: agora, recusado: false, recusado_por: null, recusado_em: null }
        : { aprovado_n2: true, aprovado_n2_por: currentUser.id, aprovado_n2_em: agora, recusado: false, recusado_por: null, recusado_em: null };
    }
    setADecidir(s => new Set(s).add(it.id));
    try {
      const { data, error } = await supabase
        .from("mapas_pagamento_itens").update(updates).eq("id", it.id).select("id");
      if (error) { if (!avisoColunas(error)) alert("Erro ao gravar a decisão:\n\n" + error.message); return; }
      if (!data?.length) { avisoRLS("gravar a decisão"); return; }
      // Relê a lista em vez de esperar pelo tempo real. Se a tabela não estiver
      // na publicação do Supabase, a decisão gravava na base e o ecrã não
      // mexia — era o que parecia "não funcionar".
      if (!emLote) {
        await reloadItens();
        // O total do mapa passa a ser só o dos itens não recusados. Não se mexe
        // no estado do mapa: decidir um item não é editar o mapa.
        await recalcularTotalAtivo();
      }
    } finally {
      setADecidir(s => { const n = new Set(s); n.delete(it.id); return n; });
    }
  };

  // Decide de uma vez todos os que faltam
  const decidirRestantes = async (decisao) => {
    if (!porDecidir.length) return;
    const verbo = decisao === "aprovado" ? "Aprovar" : "Recusar";
    if (!window.confirm(`${verbo} os ${porDecidir.length} pagamentos que ainda não foram decididos?`)) return;
    for (const it of porDecidir) await decidirItem(it, decisao, true);
    await reloadItens();
    await recalcularTotalAtivo();
  };

  // Índices para lookup O(1) por id (origem_id vem do item)
  const faturasById = useMemo(() => {
    const m = {};
    (faturas || []).forEach(f => { if (f?.id) m[String(f.id)] = f; });
    return m;
  }, [faturas]);
  const pagamentosById = useMemo(() => {
    const m = {};
    (pagamentosExtras || []).forEach(p => { if (p?.id) m[String(p.id)] = p; });
    return m;
  }, [pagamentosExtras]);

  // O PDF da fatura não vem na lista (era o que a fazia demorar): vai-se
  // buscar aqui, quando alguém carrega em "ver".
  const abrirPreview = async (item) => {
    const idKey = String(item.origem_id || "");
    const src = item.fatura_id ? faturasById[String(item.fatura_id)]
              : item.tipo_origem === "fatura" ? faturasById[idKey]
              : item.tipo_origem === "pagamento_extra" ? pagamentosById[idKey]
              : null;
    setPreviewItem({ item, src });
    if (!src?.anexo_nome || src.anexo_b64) return;
    const res = await carregarAnexo?.(src.id);
    if (!res?.data?.anexo_b64) return;
    setPreviewItem(p => (p && p.item?.id === item.id)
      ? { ...p, src: { ...p.src, anexo_b64: res.data.anexo_b64 } } : p);
  };

  if (!mapa) {
    return (
      <div style={{ padding: 30 }}>
        <button onClick={onClose}>← Voltar</button>
        <p>Mapa não encontrado.</p>
      </div>
    );
  }

  const st = STATUS_INFO[mapa.status] || { label: mapa.status, color: "#888", bg: "#eee" };
  const isN1 = currentUser?.approval_level === 1;
  const isN2 = currentUser?.approval_level === 2;
  const podeAprovarN1 = isN1 && mapa.status === "pendente_nivel_1";
  const podeAprovarN2 = isN2 && mapa.status === "pendente_nivel_2";
  const podeRecusar = (podeAprovarN1 || podeAprovarN2);
  // Um mapa pode ser eliminado enquanto não estiver decidido — em Pendente N1
  // ou em Pendente N2. Depois de aprovado ou recusado fica como registo.
  const podeEliminar = (mapa.status === "pendente_nivel_1" || mapa.status === "pendente_nivel_2")
    && (currentUser?.id === mapa.created_by || currentUser?.role === "admin");
  // Edição do conteúdo: possível enquanto o mapa não estiver aprovado pelos
  // dois níveis. Se já tiver a aprovação do N1, qualquer alteração anula-a e o
  // mapa volta a Pendente N1 — o N2 nunca aprova algo diferente do que o N1 viu.
  const ehDono = currentUser?.id === mapa.created_by || currentUser?.role === "admin";
  const podeEditarMapa = ehDono && (mapa.status === "pendente_nivel_1" || mapa.status === "pendente_nivel_2");
  const anulaN1 = mapa.status === "pendente_nivel_2";

  // Confirmação extra quando a alteração custa uma aprovação já dada.
  const confirmarAnulacao = () => {
    if (!anulaN1) return true;
    const quem = nomeUser(mapa.aprovado_n1_por) || "N1";
    return window.confirm(
      `Este mapa já foi aprovado por ${quem} (N1).\n\n`
      + "Alterar o conteúdo anula essa aprovação: o mapa volta a Pendente N1 e "
      + "tem de ser aprovado de novo pelos dois níveis.\n\nContinuar?"
    );
  };

  // O total é sempre recalculado a partir dos itens reais na base, para nunca
  // divergir da soma do que lá está. Se havia aprovação N1, é retirada aqui.
  // Total dos itens que continuam de pé (os recusados saem da conta). Ao
  // contrário do recalcularTotal, não toca no estado nem nas aprovações.
  const recalcularTotalAtivo = async () => {
    const { data } = await supabase.from("mapas_pagamento_itens").select("valor, recusado").eq("mapa_id", mapaId);
    const total = Math.round((data || [])
      .filter(i => !i.recusado)
      .reduce((t, i) => t + (parseFloat(i.valor) || 0), 0) * 100) / 100;
    await onUpdate(mapaId, { total_valor: total });
  };

  const recalcularTotal = async () => {
    const { data } = await supabase.from("mapas_pagamento_itens").select("valor").eq("mapa_id", mapaId);
    const total = Math.round((data || []).reduce((t, i) => t + (parseFloat(i.valor) || 0), 0) * 100) / 100;
    const updates = { total_valor: total };
    if (anulaN1) {
      updates.status = "pendente_nivel_1";
      updates.aprovado_n1_por = null;
      updates.aprovado_n1_em = null;
    }
    await onUpdate(mapaId, updates);
  };

  const avisoRLS = (acao) => alert(
    `Não foi possível ${acao}: a base de dados não aplicou a alteração.\n\n`
    + "Falta uma política na tabela mapas_pagamento_itens. No SQL Editor do Supabase:\n\n"
    + 'create policy "gerir itens de mapa" on mapas_pagamento_itens\n'
    + "  for all to authenticated using (true) with check (true);"
  );

  // ── Ligar a fatura a um item que entrou sem ela ───────────────────────────
  // A avença entra no mapa na data em que se paga, tenha ou não chegado a
  // fatura. Quando ela chega, liga-se aqui: o item passa a ter o documento e a
  // ocorrência prevista sai do Fluxo Futuro, para o custo não contar duas vezes.
  const ligarFatura = async (it, f) => {
    const vItem = parseFloat(it.valor) || 0;
    const vFat = parseFloat(f.valor) || 0;
    let novoValor = null;
    if (Math.abs(vFat - vItem) > 0.005) {
      novoValor = window.confirm(
        `A fatura é de ${fmtFull(vFat)} e o item do mapa está em ${fmtFull(vItem)}.\n\n`
        + "OK: passar o item para o valor da fatura.\n"
        + "Cancelar: ligar a fatura e deixar o valor como está."
      ) ? vFat : null;
    }
    // Ligar a fatura é documentar; mudar o valor é alterar o mapa. Só o
    // segundo é que obriga a aprovar de novo.
    if (novoValor != null && !confirmarAnulacao()) return false;

    const alteracoes = { fatura_id: f.id };
    if (novoValor != null) alteracoes.valor = novoValor;
    const { data, error } = await supabase.from("mapas_pagamento_itens")
      .update(alteracoes).eq("id", it.id).select("id");
    if (error) {
      const msg = error.message || String(error);
      alert(/fatura_id/.test(msg)
        ? "Falta a coluna 'fatura_id' em mapas_pagamento_itens.\n\nAbre /setup-conciliacao.html e corre o SQL."
        : "Erro ao ligar a fatura:\n\n" + msg);
      return false;
    }
    if (!data?.length) { avisoRLS("ligar a fatura"); return false; }

    // E a previsão sai do fluxo.
    const dados = {
      fatura_id: f.id, empresa: it.empresa || f.empresa,
      valor_previsto: vItem, valor_fatura: vFat,
    };
    let res = null;
    if (it.tipo_origem === "recorrente") {
      const { regraId, data: dataOc } = partirOcorrenciaId(it.origem_id);
      res = await baixarPrevisao?.({ ...dados, origem: "recorrente", origem_id: regraId,
                                     data_ocorrencia: dataOc || it.vencimento });
    } else if (it.tipo_origem === "pagamento_extra") {
      res = await baixarPrevisao?.({ ...dados, origem: "manual", origem_id: String(it.origem_id),
                                     data_ocorrencia: it.vencimento });
    }
    if (res?.error || res?.semEfeito) {
      alert("A fatura ficou ligada ao item, mas a previsão NÃO saiu do Fluxo Futuro "
        + "— o custo vai aparecer duas vezes.\n\nFalta a tabela 'previsoes_baixas': "
        + "abre /setup-conciliacao.html e corre o SQL.");
    }
    await reloadItens();
    if (novoValor != null) await recalcularTotal();
    return true;
  };

  const removerItem = async (it) => {
    if (!window.confirm(`Retirar do mapa: ${it.fornecedor ? it.fornecedor + " · " : ""}${it.descricao} (${fmtFull(it.valor)})?`)) return;
    if (!confirmarAnulacao()) return;
    const { data, error } = await supabase.from("mapas_pagamento_itens").delete().eq("id", it.id).select("id");
    if (error) return alert("Erro: " + error.message);
    if (!data?.length) return avisoRLS("retirar o item");
    await reloadItens();
    await recalcularTotal();
  };

  const guardarItem = async (it, alteracoes) => {
    if (!confirmarAnulacao()) return false;
    const { data, error } = await supabase.from("mapas_pagamento_itens").update(alteracoes).eq("id", it.id).select("id");
    if (error) { alert("Erro: " + error.message); return false; }
    if (!data?.length) { avisoRLS("guardar a alteração"); return false; }
    await reloadItens();
    await recalcularTotal();
    return true;
  };

  const adicionarItens = async (novos) => {
    if (!confirmarAnulacao()) return false;
    const linhas = novos.map(c => ({
      mapa_id: mapaId, tipo_origem: c.tipo_origem, origem_id: c.origem_id,
      descricao: c.descricao, fornecedor: c.fornecedor, empresa: c.empresa,
      categoria: c.categoria, valor: c.valor, vencimento: c.vencimento || null,
    }));
    const { data, error } = await supabase.from("mapas_pagamento_itens").insert(linhas).select("id");
    if (error) { alert("Erro: " + error.message); return false; }
    if (!data?.length) { avisoRLS("adicionar os itens"); return false; }
    await reloadItens();
    await recalcularTotal();
    return true;
  };

  const aprovar = async (nivel) => {
    if (!currentUser?.id) {
      alert("Sem utilizador autenticado.");
      return;
    }
    console.log(`[aprovar] N${nivel}`, { mapaId, currentUser: { id: currentUser.id, email: currentUser.email, level: currentUser.approval_level } });
    const updates = {};
    if (nivel === 1) {
      updates.status = "pendente_nivel_2";
      updates.aprovado_n1_por = currentUser.id;
      updates.aprovado_n1_em = new Date().toISOString();
    } else {
      updates.status = "aprovado";
      updates.aprovado_n2_por = currentUser.id;
      updates.aprovado_n2_em = new Date().toISOString();
    }
    console.log(`[aprovar] updates:`, updates);
    const res = await onUpdate(mapaId, updates);
    console.log(`[aprovar] resultado:`, res);
    if (res?.error) {
      alert("Erro ao aprovar:\n\n" + (res.error.message || JSON.stringify(res.error)));
      return;
    }
    if (!res?.data || res.data.length === 0) {
      alert("Nada foi alterado.\n\nProvavelmente falta política UPDATE no RLS para 'mapas_pagamento', ou o currentUser.id não existe na tabela 'profiles' (chave estrangeira).\n\nUser id: " + currentUser.id);
      return;
    }
    // Se chegou aqui, sucesso — mas garantimos o feedback visual com um pequeno hint
    console.log(`[aprovar] N${nivel} → sucesso`);
  };

  // Aprovação PARCIAL: remove os itens não selecionados do mapa (voltam a estar disponíveis para incluir noutro mapa),
  // ajusta total_valor e depois aprova o mapa no nível correspondente.
  const aprovarSelecionados = async (nivel) => {
    if (!currentUser?.id) { alert("Sem utilizador autenticado."); return; }
    if (!selectedItens || selectedItens.size === 0) { alert("Selecciona pelo menos um item."); return; }
    if (selectedItens.size === itens.length) {
      // Todos selecionados → equivalente a "Aprovar Todos"
      return aprovar(nivel);
    }
    const removidos = itens.filter(i => !selectedItens.has(i.id));
    const mantidos  = itens.filter(i => selectedItens.has(i.id));
    const novoTotal = mantidos.reduce((s, i) => s + (parseFloat(i.valor) || 0), 0);
    const msg = `Vais aprovar ${mantidos.length} de ${itens.length} itens (${fmtFull(novoTotal)}).\n\n` +
                `Os ${removidos.length} não selecionados vão ser REMOVIDOS deste mapa e ficam disponíveis para incluir noutro mapa.\n\n` +
                `Confirmas?`;
    if (!confirm(msg)) return;

    // 1. Remove os não selecionados
    const idsRemover = removidos.map(i => i.id);
    const { error: eDel } = await supabase.from("mapas_pagamento_itens").delete().in("id", idsRemover);
    if (eDel) { alert("Erro ao remover itens:\n\n" + eDel.message); return; }

    // 2. Atualiza total_valor + aprova o nível
    const updates = { total_valor: novoTotal };
    if (nivel === 1) {
      updates.status = "pendente_nivel_2";
      updates.aprovado_n1_por = currentUser.id;
      updates.aprovado_n1_em = new Date().toISOString();
    } else {
      updates.status = "aprovado";
      updates.aprovado_n2_por = currentUser.id;
      updates.aprovado_n2_em = new Date().toISOString();
    }
    const res = await onUpdate(mapaId, updates);
    if (res?.error) { alert("Erro ao aprovar:\n\n" + (res.error.message || JSON.stringify(res.error))); return; }
    if (!res?.data || res.data.length === 0) {
      alert("Nada foi alterado (provavelmente RLS).");
      return;
    }
    console.log(`[aprovar parcial] N${nivel} → sucesso — ${mantidos.length} aprovados, ${removidos.length} removidos`);
  };

  const recusar = async () => {
    const motivo = prompt("Motivo da recusa (visível ao criador):");
    if (motivo === null) return;
    const updates = {
      status: "recusado",
      recusado_por: currentUser.id,
      recusado_em: new Date().toISOString(),
      motivo_recusa: motivo,
    };
    const res = await onUpdate(mapaId, updates);
    if (res?.error) {
      alert("Erro ao recusar:\n\n" + (res.error.message || JSON.stringify(res.error)));
      return;
    }
    if (!res?.data || res.data.length === 0) {
      alert("Nada foi alterado (provavelmente RLS).");
    }
  };

  // ─── Export PDF (abre janela de impressão com layout formal) ─────────
  const exportPDF = () => {
    // Agrupar itens por empresa
    const byEmpresa = {};
    itens.forEach(it => {
      const emp = it.empresa || "(sem empresa)";
      if (!byEmpresa[emp]) byEmpresa[emp] = { items: [], total: 0 };
      byEmpresa[emp].items.push(it);
      byEmpresa[emp].total += parseFloat(it.valor) || 0;
    });
    const empresas = Object.keys(byEmpresa).sort();
    const numeroAmigavel = mapa.numero || `MP-${(mapa.id || "").slice(0, 8).toUpperCase()}`;

    // Carimbo conforme estado
    let carimbo = "";
    if (mapa.status === "aprovado") {
      carimbo = `
        <div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-15deg);border:8px solid #16a34a;color:#16a34a;padding:30px 60px;font-size:62px;font-weight:900;font-family:Georgia,serif;letter-spacing:6px;opacity:0.18;pointer-events:none;z-index:1;border-radius:14px;">
          APROVADO
        </div>`;
    } else if (mapa.status === "recusado") {
      carimbo = `
        <div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-15deg);border:8px solid #dc2626;color:#dc2626;padding:30px 60px;font-size:62px;font-weight:900;font-family:Georgia,serif;letter-spacing:6px;opacity:0.18;pointer-events:none;z-index:1;border-radius:14px;">
          RECUSADO
        </div>`;
    } else if (mapa.status === "pendente_nivel_1" || mapa.status === "pendente_nivel_2") {
      carimbo = `
        <div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-15deg);border:8px solid #f59e0b;color:#f59e0b;padding:24px 50px;font-size:44px;font-weight:900;font-family:Georgia,serif;letter-spacing:4px;opacity:0.16;pointer-events:none;z-index:1;border-radius:14px;">
          PENDENTE
        </div>`;
    }

    let tabelaEmpresas = "";
    empresas.forEach(emp => {
      const grupo = byEmpresa[emp];
      tabelaEmpresas += `
        <thead>
          <tr style="background:#f0f4ff;border-top:2px solid #c7d2fe;">
            <th colspan="4" style="padding:10px 14px;text-align:left;color:#3730a3;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">
              ${labelEmpresa(emp)} (${grupo.items.length} ${grupo.items.length === 1 ? 'item' : 'itens'})
            </th>
            <th style="padding:10px 14px;text-align:right;color:#3730a3;font-size:13px;font-weight:700;font-family:monospace;">
              ${fmtFull(grupo.total)}
            </th>
          </tr>
        </thead>
        <tbody>
      `;
      grupo.items.forEach(it => {
        tabelaEmpresas += `
          <tr style="border-bottom:1px solid #eee;">
            <td style="padding:7px 14px 7px 28px;color:#888;font-size:10px;font-family:monospace;">${it.tipo_origem}</td>
            <td style="padding:7px 14px;font-family:monospace;font-size:11px;">${fmtDate(it.vencimento)}</td>
            <td style="padding:7px 14px;font-size:11px;">${(it.fornecedor ? `<span style="color:#888">${it.fornecedor} · </span>` : "")}${(it.descricao || "").replace(/</g, "&lt;")}</td>
            <td style="padding:7px 14px;font-size:10px;color:#92400e;">${it.categoria || "—"}</td>
            <td style="padding:7px 14px;text-align:right;font-family:monospace;font-weight:600;font-size:11px;color:#dc2626;">${fmtFull(it.valor)}</td>
          </tr>
        `;
      });
      tabelaEmpresas += "</tbody>";
    });

    const aprovacoesHtml = `
      <div style="margin-top:30px;display:grid;grid-template-columns:1fr 1fr;gap:24px;">
        <div style="border:1px solid #e5e5e5;border-radius:8px;padding:14px;${mapa.aprovado_n1_em ? 'background:#f0fdf4;border-color:#bbf7d0;' : ''}">
          <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:0.5px;font-family:monospace;margin-bottom:6px;">Aprovação Nível 1</div>
          ${mapa.aprovado_n1_em ? `
            <div style="color:#16a34a;font-weight:700;font-size:14px;">✓ ${nomeUser(mapa.aprovado_n1_por)}</div>
            <div style="color:#666;font-size:11px;">${fmtDateTime(mapa.aprovado_n1_em)}</div>
          ` : `<div style="color:#aaa;font-size:11px;font-style:italic;">a aguardar</div>`}
        </div>
        <div style="border:1px solid #e5e5e5;border-radius:8px;padding:14px;${mapa.aprovado_n2_em ? 'background:#f0fdf4;border-color:#bbf7d0;' : ''}">
          <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:0.5px;font-family:monospace;margin-bottom:6px;">Aprovação Nível 2 (Final)</div>
          ${mapa.aprovado_n2_em ? `
            <div style="color:#16a34a;font-weight:700;font-size:14px;">✓ ${nomeUser(mapa.aprovado_n2_por)}</div>
            <div style="color:#666;font-size:11px;">${fmtDateTime(mapa.aprovado_n2_em)}</div>
          ` : `<div style="color:#aaa;font-size:11px;font-style:italic;">a aguardar</div>`}
        </div>
      </div>
      ${mapa.status === "recusado" ? `
        <div style="margin-top:16px;border:1px solid #fecaca;background:#fef2f2;border-radius:8px;padding:14px;">
          <div style="font-size:10px;color:#dc2626;text-transform:uppercase;letter-spacing:0.5px;font-family:monospace;margin-bottom:6px;">Recusado</div>
          <div style="color:#dc2626;font-weight:700;font-size:14px;">✕ ${nomeUser(mapa.recusado_por)}</div>
          <div style="color:#666;font-size:11px;">${fmtDateTime(mapa.recusado_em)}</div>
          ${mapa.motivo_recusa ? `<div style="color:#7f1d1d;font-size:12px;margin-top:8px;font-style:italic;">"${mapa.motivo_recusa.replace(/</g, "&lt;")}"</div>` : ""}
        </div>
      ` : ""}
    `;

    const html = `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8">
  <title>${numeroAmigavel} — Mapa de Pagamento</title>
  <style>
    @page { size: A4; margin: 18mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Helvetica', Arial, sans-serif; color: #1a1a2e; margin: 0; padding: 0; }
    .header { border-bottom: 3px solid #1a1a2e; padding-bottom: 16px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-start; }
    .brand { font-family: Georgia, serif; font-size: 26px; font-weight: 700; color: #1a1a2e; letter-spacing: -0.5px; }
    .brand span { color: #C8A96E; }
    .subtitle { font-size: 11px; color: #888; margin-top: 4px; letter-spacing: 2px; text-transform: uppercase; }
    .doc-id { text-align: right; font-family: monospace; }
    .doc-id .num { font-size: 18px; font-weight: 700; color: #1a1a2e; }
    .doc-id .label { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 1px; }
    h1 { font-family: Georgia, serif; font-size: 22px; margin: 0 0 18px 0; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; background: #fafafa; padding: 14px; border-radius: 8px; margin-bottom: 20px; }
    .info-grid .label { font-size: 9px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; font-family: monospace; margin-bottom: 4px; }
    .info-grid .value { font-size: 13px; color: #1a1a2e; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; margin-top: 6px; }
    .footer { margin-top: 40px; border-top: 1px solid #e5e5e5; padding-top: 14px; font-size: 9px; color: #888; display: flex; justify-content: space-between; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  ${carimbo}

  <div class="header">
    <div>
      <div class="brand">RIO<span>CAPITAL</span></div>
      <div class="subtitle">Mapa de Pagamento</div>
    </div>
    <div class="doc-id">
      <div class="label">Nº</div>
      <div class="num">${numeroAmigavel}</div>
      <div style="font-size:10px;color:#888;margin-top:4px;">${fmtDateTime(mapa.created_at)}</div>
    </div>
  </div>

  <h1>${(mapa.descricao || "Mapa de Pagamento").replace(/</g, "&lt;")}</h1>

  <div class="info-grid">
    <div>
      <div class="label">Criado por</div>
      <div class="value">${nomeUser(mapa.created_by)}</div>
    </div>
    <div>
      <div class="label">Estado</div>
      <div class="value">${(STATUS_INFO[mapa.status]?.label) || mapa.status}</div>
    </div>
    <div>
      <div class="label">Total a Pagar</div>
      <div class="value" style="font-size:18px;color:#C8A96E;font-family:monospace;">${fmtFull(mapa.total_valor)}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr style="background:#1a1a2e;color:#fff;">
        <th style="padding:9px 14px;text-align:left;font-size:10px;text-transform:uppercase;font-family:monospace;letter-spacing:0.5px;">Tipo</th>
        <th style="padding:9px 14px;text-align:left;font-size:10px;text-transform:uppercase;font-family:monospace;letter-spacing:0.5px;">Vencimento</th>
        <th style="padding:9px 14px;text-align:left;font-size:10px;text-transform:uppercase;font-family:monospace;letter-spacing:0.5px;">Descrição</th>
        <th style="padding:9px 14px;text-align:left;font-size:10px;text-transform:uppercase;font-family:monospace;letter-spacing:0.5px;">Categoria</th>
        <th style="padding:9px 14px;text-align:right;font-size:10px;text-transform:uppercase;font-family:monospace;letter-spacing:0.5px;">Valor</th>
      </tr>
    </thead>
    ${tabelaEmpresas}
    <tfoot>
      <tr style="background:#1a1a2e;color:#fff;">
        <td colspan="4" style="padding:13px 14px;text-align:right;color:#aaa;font-size:11px;text-transform:uppercase;font-family:monospace;letter-spacing:0.8px;">Total Geral</td>
        <td style="padding:13px 14px;text-align:right;color:#C8A96E;font-size:18px;font-weight:700;font-family:monospace;">${fmtFull(mapa.total_valor)}</td>
      </tr>
    </tfoot>
  </table>

  ${aprovacoesHtml}

  <div class="footer">
    <div>Documento gerado em ${new Date().toLocaleString("pt-PT")}</div>
    <div>Rio Capital · Mapa ${numeroAmigavel}</div>
  </div>

  <script>
    window.onload = () => { setTimeout(() => window.print(), 400); };
  </script>
</body>
</html>`;

    const win = window.open("", "_blank");
    if (!win) { alert("O browser bloqueou a janela. Permite popups e tenta novamente."); return; }
    win.document.write(html);
    win.document.close();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0, fontFamily: "Georgia, serif", fontSize: 22, color: "#1a1a2e" }}>
          Mapa {mapa.numero || mapa.id?.slice(0, 8)}
        </h2>
        <button onClick={onClose} style={{ background: "#f0f0f0", color: "#666", border: "none", padding: "9px 20px", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>← Voltar</button>
      </div>

      {/* A aprovação item a item precisa de colunas que podem não existir.
          Mais vale dizê-lo aqui, de uma vez, do que só quando alguém carrega
          no ✓ e nada acontece. */}
      {faltamColunasDecisao && (
        <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderLeft: "4px solid #b45309",
                      borderRadius: 10, padding: "14px 18px", fontSize: 12.5, color: "#7c3a0a", lineHeight: 1.6 }}>
          <strong>A aprovação linha a linha não está ativa nesta base de dados.</strong><br />
          Faltam as colunas de decisão na tabela <code>mapas_pagamento_itens</code>, por isso o ✓ e o ✕ de cada
          pagamento não gravam. Abre <a href="/setup-aprovacao-item.html" target="_blank" rel="noreferrer"
          style={{ color: "#7c3a0a", fontWeight: 700 }}>/setup-aprovacao-item.html</a> e corre o SQL (uma vez só).
          Até lá, a aprovação do mapa inteiro continua a funcionar.
        </div>
      )}

      {/* Header */}
      <div style={{ background: "#fff", borderRadius: 10, padding: 18, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
          <div>
            <div style={{ fontSize: 10, color: "#aaa", textTransform: "uppercase", fontFamily: "monospace", marginBottom: 4 }}>Estado</div>
            <span style={{ background: st.bg, color: st.color, padding: "5px 12px", borderRadius: 4, fontSize: 12, fontFamily: "monospace", fontWeight: 700 }}>{st.label}</span>
          </div>
          <div>
            <div style={{ fontSize: 10, color: "#aaa", textTransform: "uppercase", fontFamily: "monospace", marginBottom: 4 }}>Total</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#1a1a2e", fontFamily: "monospace" }}>{fmtFull(mapa.total_valor)}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: "#aaa", textTransform: "uppercase", fontFamily: "monospace", marginBottom: 4 }}>Criado por</div>
            <div style={{ fontSize: 12 }}>{nomeUser(mapa.created_by)}</div>
            <div style={{ fontSize: 10, color: "#888" }}>{fmtDateTime(mapa.created_at)}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: "#aaa", textTransform: "uppercase", fontFamily: "monospace", marginBottom: 4 }}>Descrição</div>
            <div style={{ fontSize: 12 }}>{mapa.descricao || "—"}</div>
          </div>
        </div>

        {/* Trilha de aprovações */}
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #f0f0f0", display: "flex", gap: 24 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: "#aaa", textTransform: "uppercase", fontFamily: "monospace", marginBottom: 4 }}>Aprovação Nível 1</div>
            {mapa.aprovado_n1_em ? (
              <div>
                <div style={{ color: "#16a34a", fontSize: 12, fontWeight: 600 }}>✓ {nomeUser(mapa.aprovado_n1_por)}</div>
                <div style={{ fontSize: 10, color: "#888" }}>{fmtDateTime(mapa.aprovado_n1_em)}</div>
              </div>
            ) : (
              <div style={{ color: "#aaa", fontSize: 11, fontStyle: "italic" }}>a aguardar</div>
            )}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: "#aaa", textTransform: "uppercase", fontFamily: "monospace", marginBottom: 4 }}>Aprovação Nível 2</div>
            {mapa.aprovado_n2_em ? (
              <div>
                <div style={{ color: "#16a34a", fontSize: 12, fontWeight: 600 }}>✓ {nomeUser(mapa.aprovado_n2_por)}</div>
                <div style={{ fontSize: 10, color: "#888" }}>{fmtDateTime(mapa.aprovado_n2_em)}</div>
              </div>
            ) : (
              <div style={{ color: "#aaa", fontSize: 11, fontStyle: "italic" }}>a aguardar</div>
            )}
          </div>
          {mapa.status === "recusado" && (
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: "#dc2626", textTransform: "uppercase", fontFamily: "monospace", marginBottom: 4 }}>Recusado</div>
              <div style={{ color: "#dc2626", fontSize: 12, fontWeight: 600 }}>✕ {nomeUser(mapa.recusado_por)}</div>
              <div style={{ fontSize: 10, color: "#888" }}>{fmtDateTime(mapa.recusado_em)}</div>
              {mapa.motivo_recusa && <div style={{ fontSize: 11, color: "#dc2626", marginTop: 6, fontStyle: "italic" }}>"{mapa.motivo_recusa}"</div>}
            </div>
          )}
        </div>
      </div>

      {/* Ações */}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
        <button onClick={exportPDF}
          style={{ background: "#1a1a2e", color: "#C8A96E", border: "none", padding: "9px 20px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
          📄 Exportar PDF
        </button>
        {podeEliminar && (
          <button onClick={() => onDelete(mapa.id, mapa)}
            style={{ background: "#fee2e2", color: "#dc2626", border: "none", padding: "9px 20px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
            🗑️ Eliminar mapa
          </button>
        )}
        {podeRecusar && (
          <button onClick={recusar}
            style={{ background: "#dc2626", color: "#fff", border: "none", padding: "9px 20px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
            ✕ Recusar
          </button>
        )}
        {podeAprovarN1 && (
          <>
            <button onClick={() => aprovar(1)}
              disabled={!tudoDecidido}
              title={tudoDecidido
                ? `Fechar a aprovação deste nível: {jaAprovados.length} aprovados, {itensRecusados.length} recusados`
                : `Faltam decidir {porDecidir.length} pagamento(s) antes de fechar o nível`}
              style={{ background: tudoDecidido ? "#16a34a" : "#e5e7eb", color: tudoDecidido ? "#fff" : "#9ca3af", border: "none", padding: "9px 24px", borderRadius: 8, cursor: tudoDecidido ? "pointer" : "not-allowed", fontSize: 13, fontWeight: 700 }}>
              {tudoDecidido
                ? `✓ Concluir aprovação N1 (${jaAprovados.length} · ${fmtFull(totalAprovado)})`
                : `Faltam ${porDecidir.length} por decidir`}
            </button>
          </>
        )}
        {podeAprovarN2 && (
          <>
            <button onClick={() => aprovar(2)}
              disabled={!tudoDecidido}
              title={tudoDecidido
                ? `Fechar a aprovação deste nível: {jaAprovados.length} aprovados, {itensRecusados.length} recusados`
                : `Faltam decidir {porDecidir.length} pagamento(s) antes de fechar o nível`}
              style={{ background: tudoDecidido ? "#16a34a" : "#e5e7eb", color: tudoDecidido ? "#fff" : "#9ca3af", border: "none", padding: "9px 24px", borderRadius: 8, cursor: tudoDecidido ? "pointer" : "not-allowed", fontSize: 13, fontWeight: 700 }}>
              {tudoDecidido
                ? `✓ Concluir aprovação N2 Final (${jaAprovados.length} · ${fmtFull(totalAprovado)})`
                : `Faltam ${porDecidir.length} por decidir`}
            </button>
          </>
        )}
      </div>

      {editItem && (
        <EditarItemMapa item={editItem}
          onGuardar={(alt) => guardarItem(editItem, alt)}
          onFechar={() => setEditItem(null)} />
      )}
      {ligarItem && (
        <LigarFatura faturas={faturas}
          alvo={{ descricao: ligarItem.descricao, valor: ligarItem.valor,
                  data: ligarItem.vencimento, empresa: ligarItem.empresa }}
          excluir={new Set(itens.map(i => i.fatura_id).filter(Boolean).map(String))}
          nota="Ao ligar, a previsão correspondente sai do Fluxo Futuro — o custo passa a contar uma vez só."
          onLigar={async (f) => { const ok = await ligarFatura(ligarItem, f); if (ok) setLigarItem(null); }}
          onFechar={() => setLigarItem(null)} />
      )}
      {mostrarAdicionar && (
        <AdicionarAoMapa faturas={faturas} pagamentosExtras={pagamentosExtras}
          recorrentes={recorrentes} baixas={baixas}
          jaNoMapa={new Set(itens.map(i => `${i.tipo_origem}:${i.origem_id}`))}
          onAdicionar={adicionarItens}
          onFechar={() => setMostrarAdicionar(false)} />
      )}

      {/* Itens */}
      <div style={{ background: "#fff", borderRadius: 10, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #f0f0f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: "#1a1a2e" }}>
              Itens do mapa ({itens.length})
            </div>
            {podeEditarMapa && (
              <button onClick={() => setMostrarAdicionar(true)}
                style={{ background: "#1a1a2e", color: "#fff", border: "none", padding: "6px 14px", borderRadius: 7, fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
                + Adicionar pagamentos
              </button>
            )}
            {podeEditarMapa && (
              <span style={{ fontSize: 11, color: anulaN1 ? "#b45309" : "#888" }}>
                {anulaN1
                  ? "⚠ Alterar anula a aprovação N1 e devolve o mapa a Pendente N1"
                  : "Editável até à aprovação final"}
              </span>
            )}
          </div>
          {(podeAprovarN1 || podeAprovarN2) && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontSize: 11, fontFamily: "monospace", background: tudoDecidido ? "#f0fdf4" : "#eff6ff", color: tudoDecidido ? "#16a34a" : "#3b82f6", padding: "5px 12px", borderRadius: 6, fontWeight: 600 }}>
                {jaAprovados.length} aprovados · {fmtFull(totalAprovado)}
                {itensRecusados.length > 0 && <span style={{ color: "#dc2626", marginLeft: 8 }}>{itensRecusados.length} recusados</span>}
                {porDecidir.length > 0 && <span style={{ color: "#b45309", marginLeft: 8 }}>{porDecidir.length} por decidir</span>}
              </div>
              {porDecidir.length > 0 && (
                <button onClick={() => decidirRestantes("aprovado")}
                  title="Marcar como aprovados todos os que ainda não foram decididos"
                  style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#16a34a", padding: "5px 12px", borderRadius: 6, fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
                  ✓ Aprovar os {porDecidir.length} restantes
                </button>
              )}
            </div>
          )}
        </div>
        {itensLoading ? (
          <div style={{ padding: 30, textAlign: "center", color: "#888" }}>A carregar…</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#fafafa" }}>
                <th style={{ padding: "10px 8px", fontWeight: 600, color: "#666", textTransform: "uppercase", fontSize: 10, fontFamily: "monospace", textAlign: "center", width: 96 }}>Decisão</th>
                <th style={{ padding: "10px 16px", fontWeight: 600, color: "#666", textTransform: "uppercase", fontSize: 10, fontFamily: "monospace", textAlign: "left" }}>Tipo</th>
                <th style={{ padding: "10px 16px", fontWeight: 600, color: "#666", textTransform: "uppercase", fontSize: 10, fontFamily: "monospace", textAlign: "left" }}>Vencimento</th>
                <th style={{ padding: "10px 16px", fontWeight: 600, color: "#666", textTransform: "uppercase", fontSize: 10, fontFamily: "monospace", textAlign: "left" }}>Descrição</th>
                <th style={{ padding: "10px 16px", fontWeight: 600, color: "#666", textTransform: "uppercase", fontSize: 10, fontFamily: "monospace", textAlign: "left" }}>Categoria</th>
                <th style={{ padding: "10px 16px", fontWeight: 600, color: "#666", textTransform: "uppercase", fontSize: 10, fontFamily: "monospace", textAlign: "right" }}>Valor</th>
                <th style={{ padding: "10px 12px", fontWeight: 600, color: "#666", textTransform: "uppercase", fontSize: 10, fontFamily: "monospace", textAlign: "center", width: 80 }}>Fatura</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                // Agrupar por empresa
                const byEmpresa = {};
                itens.forEach(it => {
                  const emp = it.empresa || "(sem empresa)";
                  if (!byEmpresa[emp]) byEmpresa[emp] = { items: [], total: 0 };
                  byEmpresa[emp].items.push(it);
                  byEmpresa[emp].total += parseFloat(it.valor) || 0;
                });
                const empresasOrdenadas = Object.keys(byEmpresa).sort();
                const rows = [];
                empresasOrdenadas.forEach(emp => {
                  const grupo = byEmpresa[emp];
                  const podeSel = podeAprovarN1 || podeAprovarN2;
                  const gruposSelIds = grupo.items.map(i => i.id);
                  const todosGrupoSel = selectedItens && gruposSelIds.every(id => selectedItens.has(id));
                  const nenhumGrupoSel = selectedItens && gruposSelIds.every(id => !selectedItens.has(id));
                  // Cabeçalho da empresa
                  rows.push(
                    <tr key={`hdr_${emp}`} style={{ background: "#f0f4ff", borderTop: "2px solid #c7d2fe" }}>
                      {podeSel && (
                        <td style={{ padding: "8px 8px", textAlign: "center", background: "#f0f4ff" }}>
                          <input type="checkbox" checked={!!todosGrupoSel}
                            ref={el => { if (el) el.indeterminate = !todosGrupoSel && !nenhumGrupoSel; }}
                            onChange={e => {
                              setSelectedItens(prev => {
                                const s = new Set(prev || []);
                                if (e.target.checked) gruposSelIds.forEach(id => s.add(id));
                                else gruposSelIds.forEach(id => s.delete(id));
                                return s;
                              });
                            }}
                            style={{ cursor: "pointer", width: 14, height: 14 }}
                            title={`Selecionar/desselecionar todos de ${labelEmpresa(emp)}`} />
                        </td>
                      )}
                      <td colSpan={4} style={{ padding: "8px 16px", fontWeight: 700, color: "#3730a3", fontSize: 12, textTransform: "uppercase", fontFamily: "monospace", letterSpacing: 0.5 }}>
                        📂 {labelEmpresa(emp)} ({grupo.items.length})
                      </td>
                      <td style={{ padding: "8px 16px", textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: "#3730a3", fontSize: 12 }}>
                        {fmtFull(grupo.total)}
                      </td>
                      <td style={{ padding: "8px 12px", background: "#f0f4ff" }}></td>
                    </tr>
                  );
                  // Itens
                  grupo.items.forEach(it => {
                    const idKey = String(it.origem_id || "");
                    const src = it.fatura_id ? faturasById[String(it.fatura_id)]
                              : it.tipo_origem === "fatura" ? faturasById[idKey]
                              : it.tipo_origem === "pagamento_extra" ? pagamentosById[idKey]
                              : null;
                    // Um item que entrou sem fatura (avença, previsão) pode
                    // recebê-la depois, quando ela chegar.
                    const podeLigar = !it.fatura_id && it.tipo_origem !== "fatura";
                    const obs = src?.obs || src?.observacoes || "";
                    const temAnexo = !!src?.anexo_nome;
                    const decisao = decisaoDe(it);
                    const recusado = decisao === "recusado";
                    const porDecidirEste = decisao === "pendente";
                    const quemDecidiu = recusado ? it.recusado_por
                      : nivelAtual === 2 ? it.aprovado_n2_por : it.aprovado_n1_por;
                    rows.push(
                      <tr key={it.id} style={{
                        borderBottom: "1px solid #f5f5f5",
                        background: recusado ? "#fff8f8" : (podeSel && porDecidirEste ? "#fffdf5" : "#fff"),
                        opacity: recusado ? 0.6 : 1,
                      }}>
                        <td style={{ padding: "8px 8px", textAlign: "center", verticalAlign: "top" }}>
                          {podeSel ? (
                            <div style={{ display: "flex", gap: 3, justifyContent: "center" }}>
                              <button onClick={() => decidirItem(it, decisao === "aprovado" ? "pendente" : "aprovado")}
                                disabled={aDecidir.has(it.id)}
                                title={decisao === "aprovado" ? "Aprovado — clica para voltar atrás" : "Aprovar este pagamento"}
                                style={{ background: decisao === "aprovado" ? "#16a34a" : "#f0fdf4", color: decisao === "aprovado" ? "#fff" : "#16a34a", border: "1px solid #bbf7d0", padding: "3px 9px", borderRadius: 5, fontSize: 11, cursor: aDecidir.has(it.id) ? "wait" : "pointer", fontWeight: 700, opacity: aDecidir.has(it.id) ? 0.5 : 1 }}>✓</button>
                              <button onClick={() => decidirItem(it, recusado ? "pendente" : "recusado")}
                                disabled={aDecidir.has(it.id)}
                                title={recusado ? "Recusado — clica para voltar atrás" : "Recusar este pagamento"}
                                style={{ background: recusado ? "#dc2626" : "#fff0f0", color: recusado ? "#fff" : "#dc2626", border: "1px solid #fecaca", padding: "3px 9px", borderRadius: 5, fontSize: 11, cursor: aDecidir.has(it.id) ? "wait" : "pointer", fontWeight: 700, opacity: aDecidir.has(it.id) ? 0.5 : 1 }}>✕</button>
                            </div>
                          ) : (
                            <span title={quemDecidiu ? `por ${nomeUser(quemDecidiu)}` : undefined}
                              style={{ fontSize: 10, fontFamily: "monospace", fontWeight: 700,
                                color: recusado ? "#dc2626" : (decisao === "aprovado" ? "#16a34a" : "#ccc") }}>
                              {recusado ? "✕ recusado" : decisao === "aprovado" ? "✓" : "—"}
                            </span>
                          )}
                          {podeSel && quemDecidiu && (
                            <div style={{ fontSize: 9, color: "#bbb", fontFamily: "monospace", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 90 }}
                              title={nomeUser(quemDecidiu)}>{nomeUser(quemDecidiu)}</div>
                          )}
                        </td>
                        <td style={{ padding: "8px 16px 8px 32px", color: "#888", fontSize: 11, fontFamily: "monospace", verticalAlign: "top" }}>
                          {it.tipo_origem}
                          {it.fatura_id && (
                            <div style={{ fontSize: 9, color: "#047857", marginTop: 2 }} title="Fatura ligada depois de o item entrar no mapa">↔ c/ fatura</div>
                          )}
                        </td>
                        <td style={{ padding: "8px 16px", fontFamily: "monospace", fontSize: 11, verticalAlign: "top" }}>{fmtDate(it.vencimento)}</td>
                        <td style={{ padding: "8px 16px", verticalAlign: "top" }}>
                          <div style={recusado ? { textDecoration: "line-through" } : undefined}>{it.fornecedor && <span style={{ color: "#888", marginRight: 6 }}>{it.fornecedor} ·</span>}{it.descricao}</div>
                          {obs && (
                            <div style={{ fontSize: 10, color: "#888", marginTop: 3, fontStyle: "italic", lineHeight: 1.4 }}>
                              💬 {obs}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "8px 16px", verticalAlign: "top" }}><span style={{ background: "#fef3c7", color: "#92400e", padding: "2px 7px", borderRadius: 3, fontSize: 10, fontFamily: "monospace" }}>{it.categoria || "—"}</span></td>
                        <td style={{ padding: "8px 16px", textAlign: "right", fontFamily: "monospace", fontWeight: 600, color: "#dc2626", verticalAlign: "top", textDecoration: recusado ? "line-through" : undefined }}>{fmtFull(it.valor)}</td>
                        <td style={{ padding: "8px 8px", textAlign: "center", verticalAlign: "top" }}>
                          {podeEditarMapa && (
                            <div style={{ display: "flex", gap: 4, justifyContent: "center", marginBottom: 4 }}>
                              <button onClick={() => setEditItem(it)} title="Editar valor, data ou descrição"
                                style={{ background: "#f0f4ff", border: "none", color: "#4a6fa5", padding: "3px 8px", borderRadius: 5, fontSize: 10, cursor: "pointer" }}>✎</button>
                              <button onClick={() => removerItem(it)} title="Retirar do mapa"
                                style={{ background: "#fff0f0", border: "none", color: "#dc2626", padding: "3px 8px", borderRadius: 5, fontSize: 10, cursor: "pointer" }}>✕</button>
                            </div>
                          )}
                          {src ? (
                            <button onClick={() => abrirPreview(it)}
                              title={temAnexo ? `Ver anexo (${src.anexo_nome})` : "Ver detalhes da fatura"}
                              style={{ background: temAnexo ? "#e0e7ff" : "#f5f5f5", color: temAnexo ? "#3730a3" : "#888", border: "none", padding: "4px 10px", borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: "monospace" }}>
                              {temAnexo ? "📎 Ver" : "ℹ️ Info"}
                            </button>
                          ) : podeLigar && podeEditarMapa ? (
                            <button onClick={() => setLigarItem(it)}
                              title="A fatura já chegou? Liga-a a este pagamento"
                              style={{ background: "#fff7ed", color: "#b45309", border: "1px solid #fed7aa", padding: "4px 10px", borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: "monospace" }}>
                              🔗 ligar fatura
                            </button>
                          ) : (
                            <span style={{ color: "#ccc", fontSize: 10 }} title={podeLigar ? "Ainda sem fatura" : undefined}>
                              {podeLigar ? "sem fatura" : "—"}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  });
                });
                return rows;
              })()}
              <tr style={{ background: "#1a1a2e", color: "#fff" }}>
                <td style={{ background: "#1a1a2e" }}></td>
                <td colSpan={4} style={{ padding: "12px 16px", textAlign: "right", fontFamily: "monospace", color: "#aaa", textTransform: "uppercase", fontSize: 11, letterSpacing: 0.5 }}>
                  Total Geral{itensRecusados.length > 0 && <span style={{ textTransform: "none", marginLeft: 8, color: "#888" }}>(sem os {itensRecusados.length} recusados)</span>}
                </td>
                <td style={{ padding: "12px 16px", textAlign: "right", fontFamily: "monospace", fontSize: 15, fontWeight: 700, color: "#C8A96E" }}>{fmtFull(totalAtivo)}</td>
                <td style={{ background: "#1a1a2e" }}></td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {/* Modal preview da fatura */}
      {previewItem && (() => {
        const src = previewItem.src;
        const it = previewItem.item;
        const nome = src?.anexo_nome || "";
        const b64 = src?.anexo_b64 || "";
        const obs = src?.obs || src?.observacoes || "";
        const isPdf = /\.pdf$/i.test(nome) || /^data:application\/pdf/i.test(b64);
        const isImg = /\.(png|jpe?g|gif|webp|bmp)$/i.test(nome) || /^data:image\//i.test(b64);
        return (
          <div onClick={() => setPreviewItem(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
            <div onClick={e => e.stopPropagation()}
              style={{ background: "#fff", borderRadius: 12, width: "min(1000px, 100%)", maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.4)" }}>

              {/* Header */}
              <div style={{ padding: "16px 22px", borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fafafa" }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#1a1a2e", fontFamily: "'DM Sans', sans-serif" }}>
                    {src?.fornecedor || "—"} · {src?.fatura || it.descricao}
                  </div>
                  <div style={{ fontSize: 11, color: "#888", marginTop: 3, fontFamily: "monospace" }}>
                    {it.empresa ? labelEmpresa(it.empresa) : "—"} · Vencimento: {fmtDate(src?.vencimento || it.vencimento)} · <b>{fmtFull(src?.valor || it.valor)}</b>
                  </div>
                </div>
                <button onClick={() => setPreviewItem(null)}
                  style={{ background: "#f5f5f5", border: "none", padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  ✕ Fechar
                </button>
              </div>

              {/* Observações */}
              {obs && (
                <div style={{ padding: "12px 22px", borderBottom: "1px solid #f0f0f0", background: "#fffbeb" }}>
                  <div style={{ fontSize: 10, color: "#92400e", fontWeight: 700, textTransform: "uppercase", fontFamily: "monospace", letterSpacing: 0.5, marginBottom: 4 }}>💬 Observações</div>
                  <div style={{ fontSize: 13, color: "#1a1a2e", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{obs}</div>
                </div>
              )}

              {/* Preview */}
              <div style={{ flex: 1, overflow: "auto", background: "#f5f5f5", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, minHeight: 300 }}>
                {b64 ? (
                  isPdf ? (
                    <iframe src={b64} title={nome} style={{ width: "100%", height: "70vh", border: "none", background: "#fff", borderRadius: 6 }} />
                  ) : isImg ? (
                    <img src={b64} alt={nome} style={{ maxWidth: "100%", maxHeight: "70vh", objectFit: "contain", background: "#fff", padding: 10, borderRadius: 6, boxShadow: "0 2px 8px rgba(0,0,0,0.1)" }} />
                  ) : (
                    <div style={{ textAlign: "center", color: "#888" }}>
                      <div style={{ fontSize: 40, marginBottom: 8 }}>📄</div>
                      <div style={{ fontSize: 13, marginBottom: 12 }}>Formato não pré-visualizável</div>
                      <a href={b64} download={nome} style={{ display: "inline-block", background: "#3730a3", color: "#fff", padding: "8px 16px", borderRadius: 6, textDecoration: "none", fontSize: 12, fontWeight: 600 }}>⬇ Descarregar {nome}</a>
                    </div>
                  )
                ) : (
                  <div style={{ textAlign: "center", color: "#aaa", padding: 40 }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>📎</div>
                    <div style={{ fontSize: 13 }}>Esta fatura não tem anexo importado.</div>
                    {obs && <div style={{ fontSize: 11, marginTop: 6 }}>Vê as observações acima.</div>}
                  </div>
                )}
              </div>

              {/* Footer com download */}
              {b64 && (
                <div style={{ padding: "12px 22px", borderTop: "1px solid #eee", background: "#fafafa", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 11, color: "#888", fontFamily: "monospace" }}>{nome}</div>
                  <a href={b64} download={nome} style={{ background: "#1a1a2e", color: "#fff", padding: "6px 14px", borderRadius: 6, textDecoration: "none", fontSize: 11, fontWeight: 600, fontFamily: "monospace" }}>
                    ⬇ Descarregar
                  </a>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
