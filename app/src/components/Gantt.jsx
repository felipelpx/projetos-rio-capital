import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { parseD, toISO, addDays, dayDelta, fmtShort, MESES_LONG, dias } from "../lib/dates.js";
import { slipDays, lateDays, lateStartDays, depViolated, violations } from "../lib/schedule.js";
import { Vazio } from "./Bits.jsx";

const ESCALAS = { dia: 30, semana: 11, mes: 3.6 };
const ALTURA_LINHA = 34;
const ALTURA_PROJETO = 30;

function intervalo(lista, hoje) {
  let min = null, max = null;
  for (const t of lista) {
    const a = parseD(t.inicio), b = parseD(t.fim);
    if (a && (!min || a < min)) min = a;
    if (b && (!max || b > max)) max = b;
    if (a && (!max || a > max)) max = a;
    if (b && (!min || b < min)) min = b;
  }
  if (!min) min = addDays(hoje, -7);
  if (!max) max = addDays(hoje, 30);
  if (hoje < min) min = addDays(hoje, -3);
  if (hoje > max) max = addDays(hoje, 3);
  min = addDays(min, -4);
  max = addDays(max, 6);
  min = new Date(min.getFullYear(), min.getMonth(), 1);
  return { inicio: min, fim: max, dias: dayDelta(min, max) + 1 };
}

export default function Gantt({ ctx, onAjustar }) {
  const { base, statuses, projects, hoje, onAbrir, podeEscrever, tasks } = ctx;
  const [escala, setEscala] = useState(() => localStorage.getItem("pm:escala") || "dia");
  const [notasAbertas, setNotasAbertas] = useState(() => localStorage.getItem("pm:notas") !== "0");
  const [mesVisivel, setMesVisivel] = useState("");
  const wrap = useRef(null);
  const jaCentrou = useRef(false);

  const dayW = ESCALAS[escala] || 30;
  const R = useMemo(() => intervalo(base, hoje), [base, hoje]);
  const trackW = Math.max(R.dias * dayW, 300);
  const nameW = typeof window !== "undefined" && window.innerWidth < 600 ? 148 : 214;
  const todayX = dayDelta(R.inicio, hoje) * dayW;

  const estadoDe = (id) => statuses.find((s) => s.id === id) || statuses[0];
  const porFazer = (t) => !!estadoDe(t.status_id)?.conta_por_iniciar;
  const concluida = (t) => !!estadoDe(t.status_id)?.conta_concluido;

  /* Linhas agrupadas por projeto, com a geometria de cada barra guardada
     para depois desenhar as setas por cima. */
  const { linhas, geom, altura } = useMemo(() => {
    const grupos = new Map();
    for (const t of base) {
      const k = t.project_id || "__sem__";
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(t);
    }
    const ordenados = [...grupos.entries()].sort((a, b) => {
      const pa = projects.find((p) => p.id === a[0]);
      const pb = projects.find((p) => p.id === b[0]);
      return String(pa?.nome || "zzz").localeCompare(String(pb?.nome || "zzz"), "pt");
    });

    const linhas = [];
    const geom = new Map();
    let y = 0;

    for (const [pid, tarefas] of ordenados) {
      const p = projects.find((x) => x.id === pid);
      const cor = p?.color || "#7C8B99";
      let gs = null, ge = null;
      for (const t of tarefas) {
        const a = parseD(t.inicio), b = parseD(t.fim);
        if (a && (!gs || a < gs)) gs = a;
        if (b) {
          const ld = lateDays(t, concluida(t), hoje);
          const eff = ld > 0 ? addDays(b, ld) : b;
          if (!ge || eff > ge) ge = eff;
        }
      }
      linhas.push({
        tipo: "projeto", id: pid, nome: p?.nome || "Sem projeto", empresa: p?.empresa, cor,
        sumX: gs ? dayDelta(R.inicio, gs) * dayW : 0,
        sumW: gs && ge ? Math.max((dayDelta(gs, ge) + 1) * dayW, 6) : 0
      });
      y += ALTURA_PROJETO;

      for (const t of [...tarefas].sort((a, b) =>
        String(a.inicio || "9999").localeCompare(String(b.inicio || "9999")) ||
        (a.posicao || 0) - (b.posicao || 0)
      )) {
        const a = parseD(t.inicio);
        let b = parseD(t.fim);
        const linha = { tipo: "tarefa", t, cor, estado: estadoDe(t.status_id) };
        if (a && b) {
          if (b < a) b = a;
          const x = dayDelta(R.inicio, a) * dayW;
          const w = Math.max((dayDelta(a, b) + 1) * dayW, 10);
          linha.x = x; linha.w = w;
          geom.set(t.id, { y: y + 17, x1: x, x2: x + w });

          const ls = lateStartDays(t, porFazer(t), hoje);
          linha.startW = ls > 0 ? Math.max(Math.min(ls * dayW, w), 6) : 0;
          linha.startDias = ls;

          const sd = slipDays(t);
          linha.slip = sd;
          if (sd > 0) {
            const be = parseD(t.fim_previsto);
            const off = be ? (dayDelta(a, be) + 1) * dayW : 0;
            if (be && off < w) linha.slipSegX = Math.max(off, 0);
          }
          if (sd !== 0 && t.fim_previsto) {
            linha.baseX = (dayDelta(R.inicio, parseD(t.fim_previsto)) + 1) * dayW;
            if (sd < 0) linha.aheadW = -sd * dayW;
          }
          const ld = lateDays(t, concluida(t), hoje);
          linha.atraso = ld;
          linha.atrasoW = ld * dayW;
        }
        linhas.push(linha);
        y += ALTURA_LINHA;
      }
    }
    return { linhas, geom, altura: y };
  }, [base, projects, statuses, hoje, dayW, R]);

  /* Setas de dependência. Só entre barras visíveis. */
  const setas = useMemo(() => {
    const out = [];
    for (const t of base) {
      const para = geom.get(t.id);
      if (!para) continue;
      for (const d of t.deps) {
        const de = geom.get(d.depende_de);
        if (!de) continue;
        const mau = depViolated(t, d, tasks);
        const espera = Math.max(0, Number(d.dias_espera) || 0);
        const x1 = de.x2, y1 = de.y, x2 = para.x1, y2 = para.y, pad = 10, cab = 6;
        let caminho, runA = null, runB = null;
        if (x2 - x1 > pad + cab) {
          caminho = `M${x1},${y1} H${x1 + pad} V${y2} H${x2 - cab}`;
          runA = x1 + pad; runB = x2 - cab;
        } else {
          const midY = y1 + (y2 - y1) / 2;
          caminho = `M${x1},${y1} H${x1 + pad} V${midY} H${x2 - pad - cab} V${y2} H${x2 - cab}`;
        }
        out.push({
          chave: t.id + "|" + d.depende_de, caminho, mau, x2, y2, cab, espera,
          etiquetaX: runA != null && runB - runA > 26 ? (runA + runB) / 2 : null
        });
      }
    }
    return out;
  }, [base, geom, tasks]);

  /* Escala de cima: meses, dias e fins de semana. */
  const { meses, marcas, faixas, linhasMes } = useMemo(() => {
    const meses = [], marcas = [], faixas = [], linhasMes = [];
    let cur = new Date(R.inicio.getFullYear(), R.inicio.getMonth(), 1);
    while (cur <= R.fim) {
      const x = dayDelta(R.inicio, cur) * dayW;
      const prox = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      const w = Math.min(dayDelta(R.inicio, prox), R.dias) * dayW - x;
      if (w > 26) {
        meses.push({
          x, w,
          texto: MESES_LONG[cur.getMonth()] + (escala === "mes" ? " ’" + String(cur.getFullYear()).slice(2) : "")
        });
      }
      if (x > 0) linhasMes.push(x);
      cur = prox;
    }
    if (escala === "dia") {
      for (let i = 0; i < R.dias; i++) {
        const d = addDays(R.inicio, i);
        const fds = d.getDay() === 0 || d.getDay() === 6;
        marcas.push({ x: i * dayW, w: dayW, texto: d.getDate(), fds, hoje: dayDelta(R.inicio, hoje) === i });
        if (fds) faixas.push({ x: i * dayW, w: dayW });
      }
    } else if (escala === "semana") {
      for (let i = 0; i < R.dias; i++) {
        const d = addDays(R.inicio, i);
        if (d.getDay() === 1) marcas.push({ x: i * dayW, w: 7 * dayW, texto: d.getDate(), semana: true });
        if (d.getDay() === 0 || d.getDay() === 6) faixas.push({ x: i * dayW, w: dayW });
      }
    }
    return { meses, marcas, faixas, linhasMes };
  }, [R, dayW, escala, hoje]);

  const irParaHoje = () => {
    const el = wrap.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, todayX - el.clientWidth / 3);
  };

  useLayoutEffect(() => {
    if (!jaCentrou.current && base.length) { jaCentrou.current = true; irParaHoje(); }
  });

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const aoRolar = () => {
      const d = addDays(R.inicio, Math.floor(Math.max(el.scrollLeft, 0) / dayW));
      setMesVisivel(MESES_LONG[d.getMonth()] + " " + d.getFullYear());
    };
    aoRolar();
    el.addEventListener("scroll", aoRolar, { passive: true });
    return () => el.removeEventListener("scroll", aoRolar);
  }, [R, dayW]);

  /* Só o que está em cima da mesa: com nota, por concluir e já arrancado. */
  const notas = useMemo(() => {
    const hojeISO = toISO(hoje);
    const comNota = base.filter((t) =>
      (t.notas || "").trim() && !concluida(t) && !(t.inicio && t.inicio > hojeISO)
    );
    const grupos = new Map();
    for (const t of comNota) {
      const k = t.project_id || "__sem__";
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(t);
    }
    return [...grupos.entries()].sort((a, b) => {
      const pa = projects.find((p) => p.id === a[0]);
      const pb = projects.find((p) => p.id === b[0]);
      return String(pa?.nome || "zzz").localeCompare(String(pb?.nome || "zzz"), "pt");
    });
  }, [base, projects, statuses, hoje]);

  const nViolacoes = podeEscrever ? violations(tasks).length : 0;

  if (!base.length) {
    return (
      <div className="view">
        <Vazio titulo="Nada para mostrar no cronograma">
          Cria tarefas com data de início e fim, ou limpa os filtros ativos.
        </Vazio>
      </div>
    );
  }

  return (
    <div className="view">
      <div className="gbar-top">
        <span className="eyebrow">Escala</span>
        <div className="seg" role="group" aria-label="Escala do Gantt">
          {[["dia", "Dias"], ["semana", "Semanas"], ["mes", "Meses"]].map(([k, r]) => (
            <button key={k} aria-pressed={escala === k}
              onClick={() => { setEscala(k); localStorage.setItem("pm:escala", k); jaCentrou.current = false; }}>
              {r}
            </button>
          ))}
        </div>
        <span className="glegend"><i aria-hidden="true" />fim em atraso</span>
        <span className="glegend"><i className="start-swatch" aria-hidden="true" />início em atraso</span>
        <span className="glegend"><i className="plan-swatch" aria-hidden="true" />desvio face ao previsto</span>
        <span className="glegend"><i className="lag-swatch" aria-hidden="true">+n d</i>espera entre tarefas</span>
        <span className="spacer" />
        {nViolacoes > 0 && (
          <button className="btn btn-sm btn-fix" onClick={() => onAjustar(null)}
            title="Empurrar para a frente as tarefas que arrancam antes das antecessoras permitirem">
            {nViolacoes === 1 ? "Ajustar 1 dependência" : `Ajustar ${nViolacoes} dependências`}
          </button>
        )}
        <button className="btn btn-sm" onClick={irParaHoje}>Ir para hoje</button>
      </div>

      <div className="gwrap" ref={wrap}>
        <div className="ginner" style={{ "--namew": nameW + "px", "--trackw": trackW + "px" }}>
          <div className="ghead">
            <div className="gname-head">
              <span className="eyebrow">Tarefa</span>
              <span className="eyebrow gmonth">{mesVisivel}</span>
            </div>
            <div className="gscale">
              <div className="months">
                {meses.map((m, i) => (
                  <span key={i} style={{ left: m.x, width: m.w }}>{m.texto}</span>
                ))}
              </div>
              <div className="ticks">
                {marcas.map((m, i) => (
                  <span key={i}
                    className={(m.fds ? "we" : "") + (m.hoje ? " tdy" : "")}
                    style={{
                      left: m.x, width: m.w,
                      ...(m.semana ? { justifyContent: "flex-start", paddingLeft: 5 } : {})
                    }}>
                    {m.texto}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="gbody">
            <div className="glayer">
              {faixas.map((f, i) => <div className="gband" key={i} style={{ left: f.x, width: f.w }} />)}
              {linhasMes.map((x, i) => <div className="gmonthline" key={i} style={{ left: x }} />)}
              {/* O dia inteiro, não uma linha na fronteira entre dois dias:
                  assim não há dúvida sobre qual deles é hoje. */}
              {todayX >= 0 && todayX <= trackW && (
                <div className="gtoday" style={{ left: todayX, width: Math.max(2, dayW) }} />
              )}
            </div>

            {linhas.map((l, i) =>
              l.tipo === "projeto" ? (
                <div className="grow projrow" key={"p" + l.id + i}>
                  <div className="gname">
                    <span className="dot" style={{ width: 8, height: 8, borderRadius: 2, background: l.cor, flex: "none" }} />
                    <span className="txt">
                      {l.nome}{l.empresa && <span className="co"> · {l.empresa}</span>}
                    </span>
                  </div>
                  <div className="gtrack">
                    {l.sumW > 0 && <div className="gsum" style={{ left: l.sumX, width: l.sumW, background: l.cor }} />}
                  </div>
                </div>
              ) : (
                <div className="grow" key={l.t.id}>
                  <div className="gname" onClick={() => onAbrir(l.t.id)} role="button" tabIndex={0}
                       onKeyDown={(e) => { if (e.key === "Enter") onAbrir(l.t.id); }}>
                    <span className="dot" style={{ width: 6, height: 6, borderRadius: "50%", background: l.estado?.color, flex: "none" }} />
                    <span className="txt">{l.t.titulo || "Sem título"}</span>
                    {l.startDias > 0 && <span className="startflag" title="início em atraso">◤</span>}
                  </div>
                  <div className="gtrack">
                    {l.w ? (
                      <>
                        <div
                          className={"gbar" + (l.estado?.conta_concluido ? " dn" : "")}
                          style={{
                            left: l.x, width: l.w, background: l.cor,
                            ...(l.startW ? { "--startpad": Math.round(l.startW + 4) + "px" } : {})
                          }}
                          title={l.t.titulo}
                          onClick={() => onAbrir(l.t.id)}
                        >
                          {l.t.progresso > 0 && <span className="fill" style={{ width: l.t.progresso + "%" }} />}
                          {l.slipSegX != null && <span className="slipseg" style={{ left: l.slipSegX }} />}
                          <span className={"lbl" + (l.startW ? " shifted" : "")}>{l.t.titulo || ""}</span>
                        </div>
                        {l.startW > 0 && (
                          <div className="gstart" style={{ left: l.x, width: l.startW }}
                               title={"devia ter arrancado há " + dias(l.startDias)}>
                            {l.startW > 58 && <span className="tag">início +{l.startDias} d</span>}
                          </div>
                        )}
                        {l.aheadW > 0 && (
                          <div className="gahead" style={{ left: l.x + l.w, width: l.aheadW }}
                               title={`${Math.abs(l.slip)} ${Math.abs(l.slip) === 1 ? "dia" : "dias"} adiantado`} />
                        )}
                        {l.baseX != null && (
                          <div className="gbase" style={{ left: l.baseX }}
                               title={`${l.slip > 0 ? "+" : ""}${dias(l.slip)} face ao previsto (${fmtShort(l.t.fim_previsto)})`} />
                        )}
                        {l.atraso > 0 && (
                          <div className="gslip" style={{ left: l.x + l.w, width: l.atrasoW }}
                               onClick={() => onAbrir(l.t.id)}
                               title={dias(l.atraso) + " para lá da data de fim"}>
                            {l.atrasoW > 54 && <span className="tag">+{l.atraso} d</span>}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="gghost" style={{ left: Math.max(todayX, 0), width: 5 * dayW }}
                           onClick={() => onAbrir(l.t.id)}>
                        definir datas
                      </div>
                    )}
                  </div>
                </div>
              )
            )}

            {setas.length > 0 && (
              <svg className="gdeps" height={altura} aria-hidden="true">
                {setas.map((s) => (
                  <g key={s.chave}>
                    <path className={s.mau ? "bad" : ""} d={s.caminho} />
                    <polygon className={s.mau ? "bad" : ""}
                      points={`${s.x2},${s.y2} ${s.x2 - s.cab},${s.y2 - 3.5} ${s.x2 - s.cab},${s.y2 + 3.5}`} />
                    {s.espera > 0 && s.etiquetaX != null && (
                      <text className="glag" x={s.etiquetaX} y={s.y2 - 4} textAnchor="middle">+{s.espera} d</text>
                    )}
                  </g>
                ))}
              </svg>
            )}
          </div>
        </div>
      </div>

      {notas.length > 0 && (
        <section className={"gnotes" + (notasAbertas ? "" : " shut")}>
          <button className="gnotes-head" aria-expanded={notasAbertas}
            onClick={() => { setNotasAbertas(!notasAbertas); localStorage.setItem("pm:notas", notasAbertas ? "0" : "1"); }}>
            <span className="eyebrow">Notas</span>
            <span className="n">
              {notas.reduce((n, g) => n + g[1].length, 0)}{" "}
              {notas.reduce((n, g) => n + g[1].length, 0) === 1 ? "atividade" : "atividades"}
            </span>
            <span className="n gnotes-sub">em curso, por concluir</span>
            <span className="chev" aria-hidden="true">▾</span>
          </button>
          <div className="gnotes-body">
            {notas.map(([pid, itens]) => {
              const p = projects.find((x) => x.id === pid);
              const cor = p?.color || "#7C8B99";
              return (
                <div className="gnote-group" key={pid}>
                  <h4>
                    <i style={{ background: cor }} />
                    {p?.nome || "Sem projeto"}
                    {p?.empresa && <span className="co"> · {p.empresa}</span>}
                  </h4>
                  {itens.map((t) => (
                    <button className="gnote" key={t.id} style={{ borderLeftColor: cor }} onClick={() => onAbrir(t.id)}>
                      <b>{t.titulo || "Sem título"}</b>
                      <span>{t.notas}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
