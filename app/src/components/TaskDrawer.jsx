import { useEffect, useMemo, useRef, useState } from "react";
import { supabase, msgErro } from "../lib/supabase.js";
import { Avatar } from "./Bits.jsx";
import { fmtShort, dias } from "../lib/dates.js";
import { fmtSize, fmtWhen, PRIORIDADES } from "../lib/format.js";
import { slipDays, earliestStart, depViolated, wouldCycle } from "../lib/schedule.js";

const BUCKET = "pm-anexos";

/** Campo que só avisa o exterior quando a pessoa sai dele — senão cada
    tecla seria uma gravação, e o que vem do servidor apagava o que se escreve. */
function CampoLento({ valor, onGuardar, textarea, ...props }) {
  const [v, setV] = useState(valor ?? "");
  const focado = useRef(false);
  useEffect(() => { if (!focado.current) setV(valor ?? ""); }, [valor]);
  const comuns = {
    value: v,
    onFocus: () => { focado.current = true; },
    onChange: (e) => setV(e.target.value),
    onBlur: () => { focado.current = false; if ((valor ?? "") !== v) onGuardar(v); },
    ...props
  };
  return textarea ? <textarea className="field" {...comuns} /> : <input className="field" {...comuns} />;
}

export default function TaskDrawer({ ctx, tarefaId, onFechar, onAjustar }) {
  const {
    tasks, statuses, projects, pessoas, comments, attachments,
    podeEscrever,   // datas, dependências, apagar — editor e super admin
    podeCriar,      // criar e alterar tarefas — editor parcial para cima
    podeComentar,   // toda a gente com acesso, incluindo o visualizador
    souAdmin, patchTarefa, guardar, recarregar, sessaoUserId, hoje
  } = ctx;

  const t = tasks.find((x) => x.id === tarefaId);
  const [picker, setPicker] = useState(false);
  const [depPicker, setDepPicker] = useState(false);
  const [procura, setProcura] = useState("");
  const [rebase, setRebase] = useState(false);
  const [porque, setPorque] = useState("");
  const [erroRebase, setErroRebase] = useState(false);
  const [msgAnexo, setMsgAnexo] = useState("");
  const [comentario, setComentario] = useState("");
  const ficheiro = useRef(null);

  useEffect(() => {
    setPicker(false); setDepPicker(false); setRebase(false);
    setPorque(""); setErroRebase(false); setMsgAnexo(""); setComentario("");
  }, [tarefaId]);

  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") onFechar(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onFechar]);

  const meusComentarios = useMemo(
    () => comments.filter((c) => c.task_id === tarefaId),
    [comments, tarefaId]
  );
  const meusAnexos = useMemo(
    () => attachments.filter((a) => a.task_id === tarefaId),
    [attachments, tarefaId]
  );

  if (!t) return null;

  const estado = statuses.find((s) => s.id === t.status_id);
  const projeto = projects.find((p) => p.id === t.project_id);
  const sd = slipDays(t);
  const cedo = earliestStart(t, tasks);
  const arrancaCedoDemais = t.deps.some((d) => depViolated(t, d, tasks));
  const reposicoes = meusComentarios.filter((c) => c.tipo === "replaneamento").length;

  const patch = (campos) => patchTarefa(t.id, campos);

  async function mudarDatas(campo, valor) {
    const p = { [campo]: valor || null };
    if (campo === "inicio" && valor && t.fim && t.fim < valor) p.fim = valor;
    if (campo === "fim" && valor && t.inicio && t.inicio > valor) p.inicio = valor;
    /* A linha de base grava-se na primeira vez que há fim, e nunca mais muda. */
    if (campo === "fim" && valor && !t.fim_previsto) p.fim_previsto = valor;
    await patch(p);
  }

  async function reporPrevisto() {
    const j = porque.trim();
    if (!j) { setErroRebase(true); return; }
    await guardar(() => supabase.rpc("pm_repor_fim_previsto", { p_task: t.id, p_justificacao: j }));
    setRebase(false); setPorque(""); setErroRebase(false);
  }

  async function juntarDependencia(id) {
    setDepPicker(false); setProcura("");
    await guardar(() => supabase.from("pm_task_deps").insert({ task_id: t.id, depende_de: id, dias_espera: 0 }));
    onAjustar(t.id, true);
  }

  async function mudarEspera(depId, valor) {
    let n = parseInt(valor, 10);
    if (isNaN(n) || n < 0) n = 0;
    if (n > 365) n = 365;
    await guardar(() =>
      supabase.from("pm_task_deps").update({ dias_espera: n }).eq("task_id", t.id).eq("depende_de", depId)
    );
    onAjustar(t.id, true);
  }

  async function enviarFicheiro(files) {
    if (!files?.length) return;
    for (const f of files) {
      setMsgAnexo(`A carregar “${f.name}”…`);
      const caminho = `${t.id}/${Date.now()}-${f.name.replace(/[^\w.\-]/g, "_")}`;
      const up = await supabase.storage.from(BUCKET).upload(caminho, f);
      if (up.error) { setMsgAnexo(msgErro(up.error)); return; }
      const ins = await supabase.from("pm_attachments").insert({
        task_id: t.id, tipo: "ficheiro", nome: f.name,
        caminho, tamanho: f.size, mime: f.type, autor_id: sessaoUserId
      });
      if (ins.error) { setMsgAnexo(msgErro(ins.error)); return; }
    }
    setMsgAnexo("");
    recarregar();
  }

  async function descarregar(a) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(a.caminho, 60);
    if (error) { setMsgAnexo(msgErro(error)); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  async function removerAnexo(a) {
    await guardar(() => supabase.from("pm_attachments").delete().eq("id", a.id));
    if (a.tipo === "ficheiro") await supabase.storage.from(BUCKET).remove([a.caminho]);
  }

  async function comentar() {
    const texto = comentario.trim();
    if (!texto) return;
    setComentario("");
    await guardar(() =>
      supabase.from("pm_comments").insert({ task_id: t.id, autor_id: sessaoUserId, texto })
    );
  }

  const candidatas = tasks
    .filter((x) =>
      x.id !== t.id &&
      !t.deps.some((d) => d.depende_de === x.id) &&
      !wouldCycle(t.id, x.id, tasks) &&
      (!procura || (x.titulo || "").toLowerCase().includes(procura.toLowerCase()))
    )
    .sort((a, b) =>
      (a.project_id === t.project_id ? 0 : 1) - (b.project_id === t.project_id ? 0 : 1) ||
      String(a.titulo || "").localeCompare(String(b.titulo || ""), "pt")
    )
    .slice(0, 40);

  const livres = pessoas.filter((p) => !t.assignees.includes(p.id));

  return (
    <>
      <div className="scrim" onClick={onFechar} />
      <aside className="drawer" aria-label="Detalhe da tarefa">
        <div className="drawer-head">
          <span className="eyebrow">Tarefa</span>
          <span className="spacer" />
          <button className="icon-btn" onClick={onFechar} aria-label="Fechar">✕</button>
        </div>

        <div className="drawer-body">
          <div className="fgroup">
            <label htmlFor="d-titulo">Título</label>
            <CampoLento id="d-titulo" valor={t.titulo} disabled={!podeCriar}
              onGuardar={(v) => patch({ titulo: v })} />
          </div>

          <div className="frow">
            <div className="fgroup">
              <label htmlFor="d-proj">Projeto</label>
              <select className="field" id="d-proj" value={t.project_id || ""} disabled={!podeCriar}
                onChange={(e) => patch({ project_id: e.target.value || null })}>
                <option value="">— sem projeto —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.nome}{p.arquivado ? " (arquivado)" : ""}</option>
                ))}
              </select>
              {projeto?.empresa && <span className="co-note">Empresa: {projeto.empresa}</span>}
            </div>
            <div className="fgroup">
              <label htmlFor="d-estado">Estado</label>
              <select className="field" id="d-estado" value={t.status_id || ""} disabled={!podeCriar}
                onChange={(e) => {
                  const s = statuses.find((x) => x.id === e.target.value);
                  patch({ status_id: e.target.value, ...(s?.conta_concluido ? { progresso: 100 } : {}) });
                }}>
                {statuses.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
          </div>

          <div className="frow">
            <div className="fgroup">
              <label htmlFor="d-prio">Prioridade</label>
              <select className="field" id="d-prio" value={t.prioridade || "media"} disabled={!podeCriar}
                onChange={(e) => patch({ prioridade: e.target.value })}>
                {PRIORIDADES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <div className="fgroup">
              <label htmlFor="d-prog">Progresso</label>
              <div className="rangewrap">
                <input id="d-prog" type="range" min="0" max="100" step="5" value={t.progresso || 0}
                  disabled={!podeCriar}
                  onChange={(e) => patch({ progresso: Number(e.target.value) })} />
                <span className="val mono">{t.progresso || 0}%</span>
              </div>
            </div>
          </div>

          <div className="frow">
            <div className="fgroup">
              <label htmlFor="d-inicio">Início</label>
              <input className="field" id="d-inicio" type="date" value={t.inicio || ""} disabled={!podeEscrever}
                onChange={(e) => mudarDatas("inicio", e.target.value)} />
              {podeCriar && !podeEscrever && (
                <span className="co-note">O teu acesso não permite alterar datas.</span>
              )}
            </div>
            <div className="fgroup">
              <label htmlFor="d-fim">Fim (real)</label>
              <input className="field" id="d-fim" type="date" value={t.fim || ""} disabled={!podeEscrever}
                onChange={(e) => mudarDatas("fim", e.target.value)} />

              <span className={"co-note" + (sd > 0 ? " warnnote" : sd < 0 ? " oknote" : "")}>
                {!t.fim_previsto
                  ? "A data prevista fixa-se na primeira vez que guardares um fim."
                  : sd === 0
                    ? `Previsto: ${fmtShort(t.fim_previsto)} — a cumprir.`
                    : `Previsto: ${fmtShort(t.fim_previsto)} · ${sd > 0 ? "+" + dias(sd) + " de desvio" : dias(-sd) + " adiantado"}`}
                {reposicoes > 0 && <span className="rebadge"> reposta {reposicoes}×</span>}
              </span>

              {/* Repor a linha de base é só de super admin — é a única data que
                  exige justificação e deixa registo permanente. A base de dados
                  recusa na mesma se alguém contornar o botão. */}
              {t.fim_previsto && t.fim && sd !== 0 && !rebase && (
                souAdmin ? (
                  <button className="linkbtn" onClick={() => setRebase(true)}>Repor data prevista</button>
                ) : podeEscrever ? (
                  <span className="co-note">
                    Só um super admin pode repor a data prevista, com justificação.
                  </span>
                ) : null
              )}
              {rebase && (
                <div className="rebaseform">
                  <p className="hintline">
                    Fim previsto: {fmtShort(t.fim_previsto)} → {fmtShort(t.fim)}. A data antiga deixa de
                    servir de referência e o desvio passa a zero.
                  </p>
                  <textarea className="field" rows="2" value={porque} aria-label="Justificação"
                    placeholder="Porque é que o plano mudou? (obrigatório)"
                    onChange={(e) => { setPorque(e.target.value); setErroRebase(false); }} />
                  {erroRebase && (
                    <p className="hintline warnnote">Escreve a justificação — fica registada nos comentários.</p>
                  )}
                  <div className="row-end">
                    <button className="btn btn-sm" onClick={() => { setRebase(false); setErroRebase(false); }}>Cancelar</button>
                    <button className="btn btn-sm btn-primary" onClick={reporPrevisto}>Repor e registar</button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="fgroup">
            <label>Responsáveis</label>
            <div className="chips">
              {t.assignees.map((id) => {
                const p = pessoas.find((x) => x.id === id);
                if (!p) return null;
                return (
                  <span className="chip" key={id}>
                    <Avatar pessoa={p} sm />{p.nome}
                    {podeCriar && (
                      <button aria-label={"Remover " + p.nome} onClick={() =>
                        guardar(() => supabase.from("pm_task_assignees").delete()
                          .eq("task_id", t.id).eq("user_id", id))}>✕</button>
                    )}
                  </span>
                );
              })}
              {podeCriar && (
                <button className="chip-add" onClick={() => setPicker(!picker)}>+ Atribuir</button>
              )}
            </div>
            {picker && (
              <div className="picker">
                {livres.length ? livres.map((p) => (
                  <button key={p.id} onClick={() => {
                    setPicker(false);
                    guardar(() => supabase.from("pm_task_assignees").insert({ task_id: t.id, user_id: p.id }));
                  }}>
                    <Avatar pessoa={p} sm />{p.nome}
                  </button>
                )) : (
                  <p style={{ margin: "4px 7px", color: "var(--ink-3)", fontSize: 12.5 }}>
                    Toda a equipa já está atribuída.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="fgroup">
            <label>Depende de</label>
            <div className="chips">
              {t.deps.map((d) => {
                const p = tasks.find((x) => x.id === d.depende_de);
                const s = p && statuses.find((x) => x.id === p.status_id);
                const aberta = p && !s?.conta_concluido;
                return (
                  <span className="chip" key={d.depende_de}
                    style={aberta ? { borderColor: "var(--crit)" } : undefined}>
                    <span className="dot" style={{ width: 7, height: 7, borderRadius: "50%", flex: "none", background: s?.color || "#999" }} />
                    {p ? (p.titulo || "Sem título") : "tarefa removida"}
                    {podeEscrever ? (
                      <span className="lagw" title="Dias de espera entre o fim desta antecessora e o arranque da tarefa">
                        +<input className="laginp" type="number" min="0" max="365" step="1"
                          defaultValue={d.dias_espera || 0}
                          aria-label={"Dias de espera depois de " + (p?.titulo || "")}
                          onBlur={(e) => mudarEspera(d.depende_de, e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} /> d
                      </span>
                    ) : d.dias_espera > 0 ? (
                      <span className="lagw">+{d.dias_espera} d</span>
                    ) : null}
                    {podeEscrever && (
                      <button aria-label="Remover dependência" onClick={() =>
                        guardar(() => supabase.from("pm_task_deps").delete()
                          .eq("task_id", t.id).eq("depende_de", d.depende_de))}>✕</button>
                    )}
                  </span>
                );
              })}
              {podeEscrever && (
                <button className="chip-add" onClick={() => setDepPicker(!depPicker)}>+ Depende de</button>
              )}
              {!t.deps.length && !podeEscrever && <span className="dep-sub">Sem dependências.</span>}
            </div>

            {t.deps.length > 0 && (
              <p className="dep-sub" style={{ width: "100%", margin: "4px 0 0" }}>
                {podeEscrever && 'O "+ n d" é a espera entre o fim da antecessora e o arranque desta. '}
                {cedo && (arrancaCedoDemais ? (
                  <>
                    <span style={{ color: "var(--crit)" }}>
                      Pelas dependências, só devia arrancar a {fmtShort(cedo)}.
                    </span>
                    {podeEscrever && t.inicio && t.fim && (
                      <button className="linkbtn" style={{ display: "inline", margin: 0 }}
                        onClick={() => onAjustar(t.id)}> Empurrar para essa data</button>
                    )}
                  </>
                ) : `Pode arrancar a partir de ${fmtShort(cedo)}.`)}
              </p>
            )}

            {depPicker && (
              <div className="deprow">
                <input className="field dep-q" type="search" placeholder="Procurar tarefa…"
                  aria-label="Procurar tarefa" value={procura} autoFocus
                  onChange={(e) => setProcura(e.target.value)} />
                <div>
                  {candidatas.length ? (
                    <div className="picker">
                      {candidatas.map((x) => {
                        const s = statuses.find((y) => y.id === x.status_id);
                        const p = projects.find((y) => y.id === x.project_id);
                        return (
                          <button key={x.id} onClick={() => juntarDependencia(x.id)}>
                            <span className="dot" style={{ width: 7, height: 7, borderRadius: "50%", flex: "none", background: s?.color }} />
                            <span style={{ flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {x.titulo || "Sem título"}
                            </span>
                            {p && <span className="dep-sub">{p.nome}</span>}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="dep-sub" style={{ margin: "4px 2px" }}>
                      Nenhuma tarefa disponível. Uma tarefa não pode depender de si própria nem criar um ciclo.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="fgroup">
            <label>Anexos</label>
            {meusAnexos.length ? (
              <div className="att-list">
                {meusAnexos.map((a) => (
                  <div className="att" key={a.id}>
                    <span className="att-ico">{a.tipo === "link" ? "LINK" : (a.mime || "").split("/")[1]?.slice(0, 4).toUpperCase() || "FICH"}</span>
                    <span className="att-meta">
                      <span className="att-name">{a.nome}</span>
                      <span className="att-sub">
                        {a.tipo === "link" ? (a.url || "").replace(/^https?:\/\//, "").slice(0, 42) : fmtSize(a.tamanho)}
                      </span>
                    </span>
                    {a.tipo === "link" ? (
                      <a className="att-act" href={a.url} target="_blank" rel="noopener noreferrer" title="Abrir link">↗</a>
                    ) : (
                      <button className="att-act" title="Transferir" onClick={() => descarregar(a)}>↓</button>
                    )}
                    {podeEscrever && (
                      <button className="att-act rm" title="Remover" onClick={() => removerAnexo(a)}>✕</button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="att-empty">Sem anexos. Aqui o Excel e o Word funcionam.</p>
            )}
            {podeCriar && (
              <div className="att-actions">
                <button className="chip-add" onClick={() => ficheiro.current?.click()}>+ Carregar ficheiro</button>
                <input ref={ficheiro} type="file" multiple hidden
                  onChange={(e) => { enviarFicheiro([...e.target.files]); e.target.value = ""; }} />
              </div>
            )}
            {msgAnexo && <p className="att-msg busy">{msgAnexo}</p>}
          </div>

          <div className="fgroup">
            <label htmlFor="d-notas">Notas</label>
            <CampoLento id="d-notas" textarea rows="3" valor={t.notas} disabled={!podeCriar}
              placeholder="Contexto, links, próximos passos…" onGuardar={(v) => patch({ notas: v })} />
          </div>

          <div className="fgroup">
            <label>Comentários</label>
            {meusComentarios.length ? (
              <div className="cm-list">
                {meusComentarios.map((c) => {
                  const autor = pessoas.find((p) => p.id === c.autor_id);
                  const nome = autor?.nome || "Alguém";
                  if (c.tipo === "replaneamento") {
                    return (
                      <div className="cm log" key={c.id}>
                        <span className="cm-av" style={{ background: autor?.color || "#7C8B99" }}>
                          {nome.slice(0, 1).toUpperCase()}
                        </span>
                        <div className="cm-main">
                          <div className="cm-head">
                            <span className="cm-tag">Replaneamento</span>
                            <span className="cm-who">{nome}</span>
                            <span className="cm-when">{fmtWhen(c.criado_em)}</span>
                          </div>
                          <p className="cm-move">
                            Fim previsto: {fmtShort(c.de_data)} → {fmtShort(c.para_data)}
                          </p>
                          <p className="cm-text">{c.texto}</p>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div className="cm" key={c.id}>
                      <span className="cm-av" style={{ background: autor?.color || "#7C8B99" }}>
                        {nome.slice(0, 1).toUpperCase()}
                      </span>
                      <div className="cm-main">
                        <div className="cm-head">
                          <span className="cm-who">{nome}</span>
                          <span className="cm-when">{fmtWhen(c.criado_em)}</span>
                        </div>
                        <p className="cm-text">{c.texto}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="cm-empty">Ainda sem comentários.</p>
            )}
            {podeComentar && (
              <div className="composer">
                <textarea className="field" rows="2" placeholder="Escreve um comentário…"
                  value={comentario} onChange={(e) => setComentario(e.target.value)}
                  onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") comentar(); }} />
                <div className="row-end">
                  <span className="hintline">⌘/Ctrl + Enter para enviar</span>
                  <button className="btn btn-sm btn-primary" onClick={comentar}>Comentar</button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="drawer-foot">
          {podeEscrever ? (
            <button className="btn btn-danger btn-sm" onClick={async () => {
              await guardar(() => supabase.from("pm_tasks").delete().eq("id", t.id));
              onFechar();
            }}>Apagar tarefa</button>
          ) : (
            <span className="hintline">
              {podeCriar ? "O teu acesso não permite apagar." : "Podes ver e comentar."}
            </span>
          )}
          <button className="btn btn-sm" onClick={onFechar}>Fechar</button>
        </div>
      </aside>
    </>
  );
}
