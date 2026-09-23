import { useState } from "react";
import { Avatares, Vazio } from "./Bits.jsx";
import { parseD, dayDelta, fmtShort, plural } from "../lib/dates.js";
import { lateDays, lateStartDays } from "../lib/schedule.js";
import { PRIORIDADES } from "../lib/format.js";

export function contarAlertas(base, statuses, hoje) {
  let n = 0;
  for (const t of base) {
    const s = statuses.find((x) => x.id === t.status_id);
    if (s?.conta_concluido) continue;
    if (lateDays(t, false, hoje) > 0 || lateStartDays(t, !!s?.conta_por_iniciar, hoje) > 0) n++;
  }
  return n;
}

function baldes(base, statuses, hoje, horizonte) {
  const atraso = [], comecar = [], terminar = [];
  for (const t of base) {
    const s = statuses.find((x) => x.id === t.status_id);
    if (s?.conta_concluido) continue;
    const ld = lateDays(t, false, hoje);
    const ls = lateStartDays(t, !!s?.conta_por_iniciar, hoje);
    if (ld > 0 || ls > 0) {
      atraso.push({
        t, n: Math.max(ld, ls), sev: "crit",
        porque: ld > 0
          ? `terminou há ${ld} ${plural(ld, "dia", "dias")}`
          : `devia ter arrancado há ${ls} ${plural(ls, "dia", "dias")}`,
        unidade: "dias de atraso"
      });
      continue;
    }
    const st = parseD(t.inicio), en = parseD(t.fim);
    if (st && s?.conta_por_iniciar) {
      const d = dayDelta(hoje, st);
      if (d >= 0 && d <= horizonte) {
        comecar.push({
          t, n: d, sev: d <= 1 ? "warn" : "soon",
          porque: d === 0 ? "começa hoje" : d === 1 ? "começa amanhã" : `faltam ${d} dias para começar`,
          unidade: d === 0 ? "hoje" : "para começar"
        });
        continue;
      }
    }
    if (en) {
      const e = dayDelta(hoje, en);
      if (e >= 0 && e <= horizonte) {
        terminar.push({
          t, n: e, sev: e <= 1 ? "warn" : "soon",
          porque: e === 0 ? "termina hoje" : e === 1 ? "termina amanhã" : `faltam ${e} dias para o fim`,
          unidade: e === 0 ? "hoje" : "para o fim"
        });
      }
    }
  }
  atraso.sort((a, b) => b.n - a.n);
  comecar.sort((a, b) => a.n - b.n);
  terminar.sort((a, b) => a.n - b.n);
  return { atraso, comecar, terminar };
}

export default function Alerts({ ctx }) {
  const { base, statuses, projects, pessoas, hoje, onAbrir, bloqueada } = ctx;
  const [horizonte, setHorizonte] = useState(() => Number(localStorage.getItem("pm:horizonte")) || 7);
  const B = baldes(base, statuses, hoje, horizonte);
  const total = B.atraso.length + B.comecar.length + B.terminar.length;

  const mudar = (v) => {
    const n = Math.min(Math.max(1, v), 365);
    setHorizonte(n);
    localStorage.setItem("pm:horizonte", String(n));
  };

  const linha = (it) => {
    const t = it.t;
    const p = projects.find((x) => x.id === t.project_id);
    const prio = t.prioridade || "media";
    return (
      <button className={"alrow " + it.sev} key={t.id} onClick={() => onAbrir(t.id)}>
        <span className="alsev" />
        <span className="almain">
          {p && (
            <span className="alproj">
              <i style={{ background: p.color }} />{p.nome}
              {p.empresa && <span className="co">· {p.empresa}</span>}
            </span>
          )}
          <h4>{t.titulo || "Sem título"}</h4>
          <span className="almeta">
            <span className="alwhen">{it.porque}</span>
            {(prio === "urgente" || prio === "alta") && (
              <span className={"pill p-" + prio}>{PRIORIDADES.find((x) => x.id === prio)?.label}</span>
            )}
            {bloqueada(t) && <span className="depchip blocked">↳ bloqueada</span>}
            {(t.inicio || t.fim) && (
              <span className="datechip">{fmtShort(t.inicio) || "?"} → {fmtShort(t.fim) || "?"}</span>
            )}
            <Avatares ids={t.assignees} pessoas={pessoas} />
          </span>
        </span>
        <span className="alnum"><b>{it.n}</b><small>{it.unidade}</small></span>
      </button>
    );
  };

  const grupo = (titulo, itens, dica) =>
    itens.length ? (
      <section className="algroup" key={titulo}>
        <div className="alhead-row">
          <h3>{titulo}</h3>
          <span className="n">{itens.length}</span>
          {dica && <span className="n">· {dica}</span>}
        </div>
        {itens.map(linha)}
      </section>
    ) : null;

  return (
    <div className="view">
      <div className="gbar-top">
        <span className="eyebrow">Horizonte</span>
        <div className="seg" role="group" aria-label="Prazo dos alertas">
          {[3, 7, 14, 30].map((v) => (
            <button key={v} aria-pressed={horizonte === v} onClick={() => mudar(v)}>{v} dias</button>
          ))}
        </div>
        <label className="hzc">
          ou <input className="field" type="number" min="1" max="365" value={horizonte}
            onChange={(e) => mudar(Number(e.target.value))} /> dias
        </label>
        <span className="spacer" />
        <span className="eyebrow">{total ? `${total} ${plural(total, "alerta", "alertas")}` : "sem alertas"}</span>
      </div>
      <div className="alwrap">
        {total ? (
          <>
            {grupo("Em atraso", B.atraso)}
            {grupo("A começar", B.comecar, `nos próximos ${horizonte} dias`)}
            {grupo("A terminar", B.terminar, `nos próximos ${horizonte} dias`)}
          </>
        ) : (
          <Vazio titulo="Nada a assinalar">
            Nenhuma tarefa está atrasada nem tem início ou fim nos próximos {horizonte} dias,
            com os filtros atuais.
          </Vazio>
        )}
      </div>
    </div>
  );
}
