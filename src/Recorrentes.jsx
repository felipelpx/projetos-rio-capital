import { useState, useMemo, useEffect, useRef } from "react";
import { CATEGORIAS, SUBCATEGORIAS } from "./categorias.js";
import { EMPRESAS, labelEmpresa } from "./empresas.js";
import { fmtEuro } from "./format.js";
import {
  PERIODICIDADES, TAXAS_IVA, rotuloPeriodicidade, ocorrenciasDe,
  resumoDaRegra, validarRegra, valorComIva, ivaDe, hojeISO,
} from "./recorrentes.js";

const fmtData = (iso) => {
  const s = String(iso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "—";
  const [a, m, d] = s.split("-");
  return `${d}/${m}/${a}`;
};

const VAZIA = {
  id: null, empresa: "", tipo: "saida", descricao: "",
  categoria: "", subcategoria: "", valor: "", taxa_iva: 23,
  data_inicio: hojeISO(), data_fim: "", periodicidade: "mensal",
  ativa: true, obs: "",
};

const campo = {
  width: "100%", boxSizing: "border-box", background: "#fafafa",
  border: "1px solid #e8e8e8", borderRadius: 8,
  padding: "8px 10px", fontSize: 12.5, outline: "none",
  color: "#1a1a2e", fontFamily: "inherit",
};
const Rotulo = ({ children, dica }) => (
  <div title={dica} style={{ fontSize: 9, color: "#aaa", textTransform: "uppercase",
                             letterSpacing: "0.1em", marginBottom: 5, fontWeight: 500,
                             fontFamily: "monospace" }}>{children}</div>
);

// ─── Botão da barra do Fluxo Futuro ─────────────────────────────────────────
export function BotaoRecorrentes({ empresa, recorrentes = [], onAbrir }) {
  // Uma despesa recorrente é de uma empresa. No consolidado o botão fica à
  // vista mas apagado, para se saber que existe e o que falta fazer.
  // Abre sempre. Antes ficava desativado com o filtro em "Todos os Projetos" e
  // não dizia porquê — clicava-se e não acontecia nada. Agora o modal abre e a
  // empresa escolhe-se lá dentro.
  const n = (recorrentes || []).filter(r => !empresa || empresa === "all" || r.empresa === empresa).length;
  return (
    <button onClick={onAbrir}
      title="Avenças, seguros, contratos — lançar uma vez e repetir sozinho"
      style={{ background: n ? "#eef2ff" : "#f0f4ff",
               border: "1px solid " + (n ? "#c7d2fe" : "#dde3f0"),
               color: "#4338ca", padding: "7px 14px", borderRadius: 8,
               fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
      ↻ Despesas recorrentes{n ? ` (${n})` : ""}
    </button>
  );
}

// ─── Modal ──────────────────────────────────────────────────────────────────
export default function ModalRecorrentes({
  empresa, recorrentes = [], currentUser, editarId,
  onGuardar, onApagar, onParar, onFechar, hoje = hojeISO(),
}) {
  // Empresa de trabalho do modal. Quando o fluxo está em "Todos os Projetos"
  // começa na primeira da lista, para nunca haver um formulário sem empresa.
  const empresaInicial = (empresa && empresa !== "all") ? empresa : (EMPRESAS[0]?.id || "");
  const [empresaSel, setEmpresaSel] = useState(empresaInicial);
  const [f, setF] = useState({ ...VAZIA, empresa: empresaInicial });
  const [aGravar, setAGravar] = useState(false);
  const [erros, setErros] = useState([]);
  // O formulário fica no topo e a lista por baixo. Quem carregava no lápis a
  // meio da lista não via nada acontecer — o formulário enchia-se fora do
  // ecrã. Estas referências servem para o trazer à vista.
  const areaRef = useRef(null);
  const formRef = useRef(null);

  // Fecha no Esc. Sair com o rato não fecha — perder-se-ia o que está escrito.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onFechar?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onFechar]);

  useEffect(() => { setF(x => ({ ...x, empresa: empresaSel })); }, [empresaSel]);

  const daEmpresa = useMemo(
    () => (recorrentes || []).filter(r => r.empresa === empresaSel),
    [recorrentes, empresaSel]
  );

  const base = parseFloat(String(f.valor).replace(",", ".")) || 0;
  const taxa = Number(f.taxa_iva) || 0;
  const total = valorComIva(base, taxa);
  const iva = ivaDe(base, taxa);
  const previsao = useMemo(
    () => resumoDaRegra({ ...f, valor: base }, hoje),
    [f, base, hoje]
  );

  const editar = (r) => {
    setErros([]);
    setEmpresaSel(r.empresa);
    setF({ ...VAZIA, ...r, valor: String(r.valor ?? ""), taxa_iva: r.taxa_iva ?? 23 });
    // Sem isto o formulário enchia-se no topo, fora do ecrã, e parecia que o
    // lápis não fazia nada.
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };
  const limpar = () => { setErros([]); setF({ ...VAZIA, empresa: empresaSel }); };

  // Aberto a partir de um lançamento do fluxo: já vem com a regra a editar.
  useEffect(() => {
    if (!editarId) return;
    const r = (recorrentes || []).find(x => String(x.id) === String(editarId));
    if (r) editar(r);
    // Só na abertura: depois disto quem manda é quem está a clicar na lista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editarId, recorrentes.length]);

  const guardar = async () => {
    const regra = {
      ...f,
      valor: base,
      taxa_iva: taxa,
      data_fim: f.data_fim || null,
      categoria: f.categoria || null,
      subcategoria: f.subcategoria || null,
      obs: (f.obs || "").trim() || null,
      criado_por: currentUser?.id || null,
    };
    const problemas = validarRegra(regra);
    setErros(problemas);
    if (problemas.length) return;

    setAGravar(true);
    const res = await onGuardar?.(regra);
    setAGravar(false);
    if (res?.semEfeito) {
      alert("Nada foi gravado.\n\nFalta a tabela 'despesas_recorrentes' ou a sua política de escrita. Abre /setup-recorrentes.html e corre o SQL.");
      return;
    }
    if (res?.error) {
      const msg = res.error.message || String(res.error);
      alert(/despesas_recorrentes|column|schema cache|does not exist/i.test(msg)
        ? "Falta a tabela 'despesas_recorrentes'.\n\nAbre /setup-recorrentes.html e corre o SQL indicado (uma vez só)."
        : "Erro ao gravar:\n\n" + msg);
      return;
    }
    limpar();
  };

  const apagar = async (r) => {
    if (!window.confirm(`Apagar a despesa "${r.descricao}"?\n\nSai do fluxo com todo o histórico. Se só quiseres pará-la daqui para a frente, usa "Parar" — mantém o que já passou.`)) return;
    const res = await onApagar?.(r.id);
    if (res?.semEfeito || res?.error) alert("Não foi apagada: " + (res?.error?.message || "falta permissão (RLS)"));
    else if (f.id === r.id) limpar();
  };

  const parar = async (r) => {
    const d = window.prompt("Parar a partir de que data? (aaaa-mm-dd)\n\nAs ocorrências até essa data mantêm-se.", hoje);
    if (!d) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { alert("Data inválida. Usa o formato aaaa-mm-dd."); return; }
    const res = await onParar?.(r.id, d);
    if (res?.semEfeito || res?.error) alert("Não foi possível parar: " + (res?.error?.message || "falta permissão (RLS)"));
  };

  const subcategorias = SUBCATEGORIAS[f.categoria] || [];

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 320,
                  display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 14, width: 1020, maxWidth: "97vw",
                    maxHeight: "92vh", display: "flex", flexDirection: "column",
                    boxShadow: "0 20px 60px rgba(0,0,0,0.25)", fontFamily: "'DM Sans', sans-serif" }}>

        <div style={{ padding: "20px 24px 14px", borderBottom: "1px solid #f0f0f0",
                      display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#1a1a2e", fontFamily: "Georgia, serif" }}>
              Despesas recorrentes
            </div>
            <div style={{ fontSize: 12, color: "#888", marginTop: 4, lineHeight: 1.5 }}>
              Lança-se a regra uma vez e o fluxo repete-a sozinho até à data limite
            </div>
          </div>
          <button onClick={onFechar} title="Fechar (Esc)"
            style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#aaa", lineHeight: 1 }}>✕</button>
        </div>

        <div ref={areaRef} style={{ flex: 1, overflowY: "auto", padding: "18px 24px" }}>

          {/* ── Formulário ──────────────────────────────────────────────── */}
          <div ref={formRef} style={{ background: f.id ? "#fffdf5" : "#fafbfc",
                        border: `1px solid ${f.id ? "#f0d9a0" : "#eef0f4"}`, borderRadius: 12, padding: 18,
                        scrollMarginTop: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#1a1a2e", marginBottom: 14,
                          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {f.id ? (
                <>
                  <span style={{ background: "#fef3c7", color: "#92400e", padding: "3px 9px", borderRadius: 5,
                                 fontSize: 10.5, fontFamily: "monospace" }}>a editar</span>
                  <span style={{ color: "#92400e" }}>{f.descricao || "(sem descrição)"}</span>
                  <button onClick={limpar} title="Deixar esta e voltar a criar uma nova"
                    style={{ background: "none", border: "none", color: "#4a6fa5", fontSize: 11,
                             cursor: "pointer", textDecoration: "underline", padding: 0 }}>
                    cancelar edição
                  </button>
                </>
              ) : "Nova despesa recorrente"}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
              <div>
                <Rotulo dica="A despesa pertence a esta empresa">Empresa *</Rotulo>
                <select value={empresaSel} onChange={e => setEmpresaSel(e.target.value)} style={campo}>
                  {EMPRESAS.map(e => <option key={e.id} value={e.id}>{labelEmpresa(e.id)}</option>)}
                </select>
              </div>

              <div style={{ gridColumn: "span 2", minWidth: 220 }}>
                <Rotulo dica="O que é — aparece assim em cada mês do fluxo">Descrição *</Rotulo>
                <input value={f.descricao} onChange={e => setF({ ...f, descricao: e.target.value })}
                  placeholder="ex.: Avença de contabilidade" style={campo} />
              </div>

              <div>
                <Rotulo dica="Entrada se for dinheiro a receber">Tipo</Rotulo>
                <select value={f.tipo} onChange={e => setF({ ...f, tipo: e.target.value })} style={campo}>
                  <option value="saida">Saída</option>
                  <option value="entrada">Entrada</option>
                </select>
              </div>

              <div>
                <Rotulo dica="Valor sem IVA">Valor base *</Rotulo>
                <input value={f.valor} onChange={e => setF({ ...f, valor: e.target.value })}
                  placeholder="0,00" inputMode="decimal"
                  style={{ ...campo, fontFamily: "monospace", textAlign: "right", fontWeight: 700 }} />
              </div>

              <div>
                <Rotulo dica="O fluxo conta o valor com IVA — é o que sai do banco">IVA a considerar</Rotulo>
                <select value={f.taxa_iva} onChange={e => setF({ ...f, taxa_iva: Number(e.target.value) })} style={campo}>
                  {TAXAS_IVA.map(t => <option key={t.taxa} value={t.taxa}>{t.rotulo}</option>)}
                </select>
              </div>

              <div>
                <Rotulo dica="De quanto em quanto tempo se repete">Periodicidade</Rotulo>
                <select value={f.periodicidade} onChange={e => setF({ ...f, periodicidade: e.target.value })} style={campo}>
                  {PERIODICIDADES.map(p => <option key={p.v} value={p.v}>{p.r}</option>)}
                </select>
              </div>

              <div>
                <Rotulo dica="Primeira ocorrência">Data de início *</Rotulo>
                <input type="date" value={f.data_inicio || ""}
                  onChange={e => setF({ ...f, data_inicio: e.target.value })}
                  style={{ ...campo, fontFamily: "monospace" }} />
              </div>

              <div>
                <Rotulo dica="Deixa em branco se não há fim previsto — repete-se até ao fim do horizonte do fluxo">Data limite</Rotulo>
                <input type="date" value={f.data_fim || ""} min={f.data_inicio || undefined}
                  onChange={e => setF({ ...f, data_fim: e.target.value })}
                  style={{ ...campo, fontFamily: "monospace" }} />
              </div>

              <div>
                <Rotulo>Categoria</Rotulo>
                <select value={f.categoria} onChange={e => setF({ ...f, categoria: e.target.value, subcategoria: "" })} style={campo}>
                  <option value="">— sem categoria —</option>
                  {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div>
                <Rotulo>Subcategoria</Rotulo>
                <select value={f.subcategoria} disabled={!f.categoria}
                  onChange={e => setF({ ...f, subcategoria: e.target.value })}
                  style={{ ...campo, background: f.categoria ? "#fafafa" : "#f2f2f2" }}>
                  <option value="">{f.categoria ? "— subcategoria —" : "escolhe a categoria"}</option>
                  {subcategorias.map(sc => <option key={sc} value={sc}>{sc}</option>)}
                </select>
              </div>

              <div style={{ gridColumn: "span 2", minWidth: 220 }}>
                <Rotulo>Observação</Rotulo>
                <input value={f.obs} onChange={e => setF({ ...f, obs: e.target.value })}
                  placeholder="opcional" style={campo} />
              </div>
            </div>

            {/* Contas à vista, para não ser preciso fazê-las de cabeça */}
            <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center",
                          background: "#fff", border: "1px solid #eef0f4", borderRadius: 9, padding: "10px 14px",
                          fontSize: 11.5, fontFamily: "monospace", color: "#555" }}>
              <span>Base <strong>{fmtEuro(base)}</strong></span>
              <span style={{ color: "#ccc" }}>+</span>
              <span>IVA {taxa}% <strong>{fmtEuro(iva)}</strong></span>
              <span style={{ color: "#ccc" }}>=</span>
              <span style={{ color: "#1a1a2e" }}>Sai do banco <strong>{fmtEuro(total)}</strong></span>
              {base > 0 && (
                <span style={{ marginLeft: "auto", color: previsao.semFim ? "#b45309" : "#16a34a" }}>
                  {previsao.semFim
                    ? `sem data limite → repete-se até ao fim do fluxo (${previsao.porVir}× = ${fmtEuro(previsao.total)})`
                    : `${previsao.porVir}× até ${fmtData(previsao.ultima)} = ${fmtEuro(previsao.total)}`}
                </span>
              )}
            </div>

            {erros.length > 0 && (
              <div style={{ marginTop: 12, background: "#fef2f2", border: "1px solid #fecaca",
                            color: "#991b1b", borderRadius: 8, padding: "10px 13px", fontSize: 12, lineHeight: 1.7 }}>
                {erros.map((e, i) => <div key={i}>• {e}</div>)}
              </div>
            )}

            <div style={{ marginTop: 14, display: "flex", gap: 8, justifyContent: "flex-end" }}>
              {f.id && (
                <button onClick={limpar}
                  style={{ background: "#f0f0f0", color: "#666", border: "none", padding: "9px 16px",
                           borderRadius: 8, cursor: "pointer", fontSize: 12.5 }}>
                  Cancelar edição
                </button>
              )}
              <button onClick={guardar} disabled={aGravar}
                style={{ background: aGravar ? "#ddd" : "#1a1a2e", color: aGravar ? "#999" : "#C8A96E",
                         border: "none", padding: "9px 22px", borderRadius: 8,
                         cursor: aGravar ? "default" : "pointer", fontSize: 12.5, fontWeight: 700 }}>
                {aGravar ? "A gravar…" : f.id ? "Guardar alterações" : "Criar despesa"}
              </button>
            </div>
          </div>

          {/* ── Lista ───────────────────────────────────────────────────── */}
          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#1a1a2e", marginBottom: 10 }}>
              Despesas de {labelEmpresa(empresaSel)} ({daEmpresa.length})
            </div>

            {daEmpresa.length === 0 ? (
              <div style={{ color: "#bbb", fontSize: 12.5, textAlign: "center", padding: "26px 0",
                            border: "1px dashed #eee", borderRadius: 10 }}>
                Ainda não há nenhuma. Cria a primeira no formulário acima.
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#fafafa" }}>
                    {["Descrição", "Periodicidade", "Base", "IVA", "Por mês/ocorrência", "Início", "Limite", "Por vir", ""].map(h => (
                      <th key={h} style={{ padding: "9px 10px", textAlign: "left", color: "#aaa", fontSize: 9.5,
                                           letterSpacing: "0.07em", textTransform: "uppercase", fontFamily: "monospace",
                                           borderBottom: "1px solid #f0f0f0", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {daEmpresa.map(r => {
                    const res = resumoDaRegra(r, hoje);
                    const terminada = r.data_fim && String(r.data_fim).slice(0, 10) < hoje;
                    const t = valorComIva(r.valor, r.taxa_iva);
                    return (
                      <tr key={r.id} style={{ borderBottom: "1px solid #fafafa", opacity: terminada ? 0.5 : 1,
                                              background: f.id === r.id ? "#fffdf5" : "transparent",
                                              boxShadow: f.id === r.id ? "inset 3px 0 0 #C8A96E" : "none" }}>
                        <td style={{ padding: "9px 10px", color: "#1a1a2e" }}>
                          {r.descricao}
                          {r.categoria && (
                            <div style={{ fontSize: 9.5, color: "#aaa", fontFamily: "monospace", marginTop: 2 }}>
                              {r.categoria}{r.subcategoria ? " · " + r.subcategoria : ""}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "9px 10px", color: "#666", whiteSpace: "nowrap" }}>{rotuloPeriodicidade(r.periodicidade)}</td>
                        <td style={{ padding: "9px 10px", fontFamily: "monospace", color: "#666", whiteSpace: "nowrap" }}>{fmtEuro(r.valor)}</td>
                        <td style={{ padding: "9px 10px", fontFamily: "monospace", color: "#888", whiteSpace: "nowrap" }}>{Number(r.taxa_iva) || 0}%</td>
                        <td style={{ padding: "9px 10px", fontFamily: "monospace", fontWeight: 700, whiteSpace: "nowrap",
                                     color: r.tipo === "entrada" ? "#16a34a" : "#dc2626" }}>{fmtEuro(t)}</td>
                        <td style={{ padding: "9px 10px", fontFamily: "monospace", color: "#888", whiteSpace: "nowrap" }}>{fmtData(r.data_inicio)}</td>
                        <td style={{ padding: "9px 10px", fontFamily: "monospace", whiteSpace: "nowrap",
                                     color: r.data_fim ? "#888" : "#b45309" }}>
                          {r.data_fim ? fmtData(r.data_fim) : "sem limite"}
                        </td>
                        <td style={{ padding: "9px 10px", fontFamily: "monospace", color: "#4338ca", whiteSpace: "nowrap" }}
                          title={res.porVir ? `${res.porVir} ocorrências, ${fmtEuro(res.total)} até ${fmtData(res.ultima)}` : "já não gera mais nada"}>
                          {res.porVir ? `${res.porVir}× ${fmtEuro(res.total)}` : "—"}
                        </td>
                        <td style={{ padding: "9px 10px", whiteSpace: "nowrap" }}>
                          <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                            <button onClick={() => editar(r)} title="Editar"
                              style={{ background: "#f0f4ff", border: "none", color: "#4a6fa5", padding: "3px 8px",
                                       borderRadius: 5, fontSize: 10, cursor: "pointer" }}>✎</button>
                            {!terminada && (
                              <button onClick={() => parar(r)} title="Parar a partir de uma data, mantendo o histórico"
                                style={{ background: "#fef3c7", border: "none", color: "#92400e", padding: "3px 8px",
                                         borderRadius: 5, fontSize: 10, cursor: "pointer", fontWeight: 600 }}>parar</button>
                            )}
                            <button onClick={() => apagar(r)} title="Apagar"
                              style={{ background: "#fff0f0", border: "none", color: "#dc2626", padding: "3px 8px",
                                       borderRadius: 5, fontSize: 10, cursor: "pointer" }}>✕</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div style={{ borderTop: "1px solid #f0f0f0", padding: "13px 24px",
                      display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 10, color: "#bbb", fontFamily: "monospace", lineHeight: 1.5, maxWidth: 560 }}>
            As ocorrências aparecem no fluxo mas não se gravam uma a uma. Para mudar só um mês, lança uma previsão normal.
          </div>
          <button onClick={onFechar}
            style={{ background: "#f0f0f0", color: "#666", border: "none", padding: "9px 20px",
                     borderRadius: 8, cursor: "pointer", fontSize: 12.5 }}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
