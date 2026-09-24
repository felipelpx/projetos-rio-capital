import { useState } from "react";
import FiltroBar from "./FiltroBar.jsx";
import { Avatares, Vazio } from "./Bits.jsx";
import { fmtShort } from "../lib/dates.js";
import { slipDays, lateDays, lateStartDays } from "../lib/schedule.js";
import { PRIORIDADES, SETORES, eurCurto } from "../lib/format.js";

const COLUNAS = [
  ["titulo", "Tarefa"], ["projeto", "Projeto"], ["estado", "Estado"], ["prioridade", "Prioridade"],
  ["setor", "Setor"],
  [null, "Responsáveis"], ["inicio", "Início"], ["fim_previsto", "Fim previsto"],
  ["fim", "Fim real"], ["custo_previsto", "Orçamento"], ["progresso", "Progresso"]
];

export default function TaskList({ ctx }) {
  const { listaFiltrada, statuses, projects, pessoas, hoje, onAbrir,
          contarComentarios, contarAnexos, filtros, ordemEstado } = ctx;
  const [ord, setOrd] = useState({ por: "fim", dir: "asc" });

  const estadoDe = (id) => statuses.find((s) => s.id === id) || statuses[0];
  const projetoDe = (id) => projects.find((p) => p.id === id);

  const lista = [...listaFiltrada].sort((a, b) => {
    const d = ord.dir === "asc" ? 1 : -1;
    let va, vb;
    if (ord.por === "titulo") { va = (a.titulo || "").toLowerCase(); vb = (b.titulo || "").toLowerCase(); }
    else if (ord.por === "projeto") {
      va = (projetoDe(a.project_id)?.nome || "zz").toLowerCase();
      vb = (projetoDe(b.project_id)?.nome || "zz").toLowerCase();
    }
    else if (ord.por === "estado") { va = ordemEstado(a.status_id); vb = ordemEstado(b.status_id); }
    else if (ord.por === "setor") {
      /* Sem setor vai para o fim, para as classificadas ficarem juntas em cima. */
      va = SETORES.findIndex((x) => x.id === a.setor); vb = SETORES.findIndex((x) => x.id === b.setor);
      if (va < 0) va = SETORES.length;
      if (vb < 0) vb = SETORES.length;
    }
    else if (ord.por === "prioridade") {
      va = PRIORIDADES.findIndex((p) => p.id === (a.prioridade || "media"));
      vb = PRIORIDADES.findIndex((p) => p.id === (b.prioridade || "media"));
    }
    else if (ord.por === "progresso") { va = a.progresso || 0; vb = b.progresso || 0; }
    else if (ord.por === "custo_previsto") {
      /* Sem orçamento vai para o fim, não para o princípio com valor zero. */
      va = a.custo_previsto == null ? Infinity : Number(a.custo_previsto);
      vb = b.custo_previsto == null ? Infinity : Number(b.custo_previsto);
    }
    else { va = a[ord.por] || "9999-99-99"; vb = b[ord.por] || "9999-99-99"; }
    if (va < vb) return -d;
    if (va > vb) return d;
    return 0;
  });

  const filtrando = filtros.estados != null || filtros.prioridades != null;

  return (
    <div className="view">
      <FiltroBar ctx={ctx} prefixo="l" />
      <div className="lwrap">
        {!lista.length ? (
          <Vazio titulo="Sem tarefas">
            {filtrando
              ? "Nenhuma tarefa com este estado e prioridade. Usa “Limpar” para voltar a ver tudo."
              : "Cria a primeira com “Nova tarefa”, ou limpa os filtros de projeto e responsável."}
          </Vazio>
        ) : (
          <table className="lst">
            <thead>
              <tr>
                {COLUNAS.map(([chave, rotulo]) =>
                  chave ? (
                    <th key={chave} onClick={() =>
                      setOrd((o) => o.por === chave ? { por: chave, dir: o.dir === "asc" ? "desc" : "asc" } : { por: chave, dir: "asc" })
                    }>
                      {rotulo}{ord.por === chave ? (ord.dir === "asc" ? " ↑" : " ↓") : ""}
                    </th>
                  ) : (
                    <th key={rotulo}>{rotulo}</th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {lista.map((t) => {
                const s = estadoDe(t.status_id);
                const p = projetoDe(t.project_id);
                const atraso = lateDays(t, !!s?.conta_concluido, hoje);
                const atrasoInicio = lateStartDays(t, !!s?.conta_por_iniciar, hoje);
                const sd = slipDays(t);
                const prio = t.prioridade || "media";
                return (
                  <tr key={t.id} className={s?.conta_concluido ? "done" : ""} onClick={() => onAbrir(t.id)}>
                    <td className="tname">
                      {t.titulo || "Sem título"}
                      {contarAnexos(t.id) > 0 && <span className="clip" title="Anexos"> 📎{contarAnexos(t.id)}</span>}
                      {contarComentarios(t.id) > 0 && <span className="cmclip" title="Comentários"> 💬{contarComentarios(t.id)}</span>}
                    </td>
                    <td>
                      {p ? (
                        <span className="st-chip">
                          <i style={{ background: p.color, borderRadius: 2 }} />
                          {p.nome}{p.empresa && <span className="co">· {p.empresa}</span>}
                        </span>
                      ) : <span style={{ color: "var(--ink-3)" }}>—</span>}
                    </td>
                    <td><span className="st-chip"><i style={{ background: s?.color }} />{s?.label}</span></td>
                    <td><span className={"pill p-" + prio}>{PRIORIDADES.find((x) => x.id === prio)?.label}</span></td>
                    <td>
                      {t.setor
                        ? <span className="setchip" data-setor={t.setor}>
                            {SETORES.find((x) => x.id === t.setor)?.label}
                          </span>
                        : <span style={{ color: "var(--ink-3)" }}>—</span>}
                    </td>
                    <td>
                      {t.assignees.length
                        ? <Avatares ids={t.assignees} pessoas={pessoas} />
                        : <span style={{ color: "var(--ink-3)" }}>—</span>}
                    </td>
                    <td className="mono" style={{ fontSize: 12, color: atrasoInicio ? "var(--crit)" : "var(--ink-2)" }}>
                      {fmtShort(t.inicio) || "—"}{atrasoInicio ? ` +${atrasoInicio}d` : ""}
                    </td>
                    <td className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>
                      {fmtShort(t.fim_previsto) || "—"}
                    </td>
                    <td className="mono" style={{ fontSize: 12, color: atraso ? "var(--crit)" : "var(--ink-2)" }}>
                      {fmtShort(t.fim) || "—"}
                      {atraso ? ` +${atraso}d` : ""}
                      {sd !== 0 && <span className={"slipnum" + (sd > 0 ? "" : " ok")}> {sd > 0 ? "+" : ""}{sd}</span>}
                    </td>
                    <td className="mono" style={{ fontSize: 12, textAlign: "right" }}>
                      {t.custo_previsto != null
                        ? eurCurto(t.custo_previsto)
                        : t.tem_custo
                          ? <span style={{ color: "var(--ink-3)" }} title="Tem custo, por orçamentar">€ ?</span>
                          : <span style={{ color: "var(--ink-3)" }}>—</span>}
                    </td>
                    <td>
                      <span className="mini-prog"><i style={{ width: (t.progresso || 0) + "%" }} /></span>{" "}
                      <span className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{t.progresso || 0}%</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
