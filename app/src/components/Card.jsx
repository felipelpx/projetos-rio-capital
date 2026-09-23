import { Avatares } from "./Bits.jsx";
import { PRIORIDADES } from "../lib/format.js";
import { fmtShort } from "../lib/dates.js";
import { lateDays, lateStartDays } from "../lib/schedule.js";

export default function Card({ t, projeto, estado, pessoas, porProjeto, hoje, nComentarios, nAnexos, onAbrir, bloqueada }) {
  const concluida = !!estado?.conta_concluido;
  const atraso = lateDays(t, concluida, hoje);
  const atrasoInicio = lateStartDays(t, !!estado?.conta_por_iniciar, hoje);
  const prio = t.prioridade || "media";
  const rotuloPrio = PRIORIDADES.find((p) => p.id === prio)?.label || "";

  return (
    <article className={"card" + (concluida ? " done" : "")} style={{ borderLeftColor: estado?.color }}>
      <div className="card-body" onClick={() => onAbrir(t.id)} role="button" tabIndex={0}
           onKeyDown={(e) => { if (e.key === "Enter") onAbrir(t.id); }}>
        {porProjeto ? (
          <div className="card-proj">
            <i style={{ background: estado?.color, borderRadius: "50%" }} />
            <span>{estado?.label}</span>
          </div>
        ) : projeto ? (
          <div className="card-proj">
            <i style={{ background: projeto.color }} />
            <span>
              {projeto.nome}
              {projeto.empresa && <span className="co"> · {projeto.empresa}</span>}
            </span>
          </div>
        ) : null}

        <h4 className="card-title">{t.titulo || "Sem título"}</h4>

        <div className="card-meta">
          {prio !== "media" && <span className={"pill p-" + prio}>{rotuloPrio}</span>}
          {t.fim && (
            <span className={"datechip" + (atraso ? " late" : "")}>
              {fmtShort(t.fim)}{atraso ? ` +${atraso}d` : ""}
            </span>
          )}
          {nAnexos > 0 && <span className="clip" title="Anexos">📎{nAnexos}</span>}
          {nComentarios > 0 && <span className="cmclip" title="Comentários">💬{nComentarios}</span>}
          {atrasoInicio > 0 && (
            <span className="pill startpill" title="Devia ter arrancado">◤ início +{atrasoInicio}d</span>
          )}
          {t.deps.length > 0 && (
            <span
              className={"depchip" + (bloqueada ? " blocked" : "")}
              title={bloqueada ? "Bloqueada por outra tarefa" : "Dependências concluídas"}
            >
              ↳ {t.deps.length}
            </span>
          )}
          <Avatares ids={t.assignees} pessoas={pessoas} />
        </div>

        {t.progresso > 0 && (
          <div className="prog"><i style={{ width: t.progresso + "%" }} /></div>
        )}
      </div>
    </article>
  );
}
