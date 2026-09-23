import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { subscrever, versaoAtual, ler, supabase } from "./supabase-falso.js";
import { today } from "../src/lib/dates.js";
import { PRIORIDADES } from "../src/lib/format.js";
import { cascade, resolveViolations } from "../src/lib/schedule.js";
import Sidebar from "../src/components/Sidebar.jsx";
import Board from "../src/components/Board.jsx";
import ProjectBoard from "../src/components/ProjectBoard.jsx";
import Gantt from "../src/components/Gantt.jsx";
import TaskList from "../src/components/TaskList.jsx";
import Alerts, { contarAlertas } from "../src/components/Alerts.jsx";
import TaskDrawer from "../src/components/TaskDrawer.jsx";
import MultiSelect from "../src/components/MultiSelect.jsx";
import * as F from "./dados.js";
import { NIVEIS, podeCriarCom, podeEscreverCom, podeComentarCom } from "../src/lib/format.js";
import Conta from "../src/components/Conta.jsx";

const VISTAS = [["quadro","Quadro"],["projetos","Projetos"],["gantt","Gantt"],["lista","Lista"],["alertas","Alertas"]];

/* Réplica do App, mas com as escritas a ficarem em memória: serve para ver
   as vistas a desenhar sem precisar de Supabase. */
export default function Harness() {
  /* Tudo vem do armazém falso, como viria do Supabase. */
  const versao = useSyncExternalStore(subscrever, versaoAtual);
  const projects = useMemo(() => ler("pm_projects"), [versao]);
  const empresas = useMemo(() => ler("pm_empresas"), [versao]);
  const tasks = useMemo(() => {
    const assignees = ler("pm_task_assignees");
    const deps = ler("pm_task_deps");
    return ler("pm_tasks").map((t) => ({
      ...t,
      assignees: assignees.filter((a) => a.task_id === t.id).map((a) => a.user_id),
      deps: deps.filter((d) => d.task_id === t.id)
    }));
  }, [versao]);
  const [vista, setVista] = useState("quadro");
  const [filtroProjetos, setFiltroProjetos] = useState(null);
  const [filtros, setFiltros] = useState({ estados: null, prioridades: null, pessoas: null });
  const [abertoMulti, setAbertoMulti] = useState(null);
  const [aberta, setAberta] = useState(null);
  const [papel, setPapel] = useState("admin");
  const hoje = useMemo(() => today(new Date("2026-09-22T12:00:00")), []);

  const base = useMemo(() => tasks.filter((t) => {
    const p = projects.find((x) => x.id === t.project_id);
    if (filtroProjetos) return filtroProjetos.includes(t.project_id);
    return !p?.arquivado;
  }), [tasks, filtroProjetos]);

  const listaFiltrada = useMemo(() => base.filter((t) =>
    (!filtros.estados || filtros.estados.includes(t.status_id)) &&
    (!filtros.prioridades || filtros.prioridades.includes(t.prioridade || "media"))
  ), [base, filtros]);

  const comentarios = useMemo(() => ler("pm_comments"), [versao]);
  const anexos = useMemo(() => ler("pm_attachments"), [versao]);

  const guardar = useCallback(async (fn) => {
    const r = await fn();
    return { ok: true, data: r?.data };
  }, []);

  const patchTarefa = useCallback(async (id, campos) => {
    await supabase.from("pm_tasks").update(campos).eq("id", id);
    const depois = ler("pm_tasks").map((t) => ({
      ...t,
      deps: ler("pm_task_deps").filter((d) => d.task_id === t.id)
    }));
    for (const m of cascade(id, depois)) {
      const { id: mid, titulo, ...cs } = m;
      await supabase.from("pm_tasks").update(cs).eq("id", mid);
    }
    return { ok: true };
  }, []);

  const ajustar = useCallback(async (id) => {
    const atuais = ler("pm_tasks").map((t) => ({
      ...t, deps: ler("pm_task_deps").filter((d) => d.task_id === t.id)
    }));
    for (const m of resolveViolations(atuais, id ?? null)) {
      const { id: mid, titulo, ...cs } = m;
      await supabase.from("pm_tasks").update(cs).eq("id", mid);
    }
    return { ok: true };
  }, []);

  const itensEstado = F.statuses.map((s) => ({ id: s.id, nome: s.label, color: s.color, n: base.filter((t) => t.status_id === s.id).length }));
  const itensPrioridade = [...PRIORIDADES].reverse().map((p) => ({ id: p.id, nome: p.label, n: base.filter((t) => (t.prioridade || "media") === p.id).length }));
  const itensPessoa = [...F.pessoas.map((p) => ({ id: p.id, nome: p.nome, color: p.color, n: base.filter((t) => t.assignees.includes(p.id)).length })),
    { id: "__sem__", nome: "Sem responsável", n: base.filter((t) => !t.assignees.length).length }];

  const ctx = {
    base, listaFiltrada, tasks, statuses: F.statuses, projects, pessoas: F.pessoas,
    comments: comentarios, attachments: anexos, hoje, podeEscrever: podeEscreverCom(papel), podeCriar: podeCriarCom(papel),
    podeComentar: podeComentarCom(papel), souAdmin: papel === "admin",
    filtros, setFiltros, abertoMulti, setAbertoMulti, filtroProjetos,
    itensEstado, itensPrioridade, itensPessoa,
    contarComentarios: (id) => comentarios.filter((c) => c.task_id === id).length,
    contarAnexos: (id) => anexos.filter((a) => a.task_id === id).length,
    ordemEstado: (id) => F.statuses.findIndex((s) => s.id === id),
    bloqueada: (t) => t.deps.some((d) => {
      const p = tasks.find((x) => x.id === d.depende_de);
      return p && !F.statuses.find((s) => s.id === p.status_id)?.conta_concluido;
    }),
    onAbrir: setAberta, patchTarefa,
    guardar, recarregar: () => {}, sessaoUserId: "u1"
  };

  const nAlertas = contarAlertas(base, F.statuses, hoje);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><h1>Rio Capital</h1><span className="tag">gestão de projetos</span></div>
        <div className="seg" role="group" aria-label="Vista">
          {VISTAS.map(([k, r]) => (
            <button key={k} aria-pressed={vista === k} onClick={() => setVista(k)}>
              {r}{k === "alertas" && nAlertas > 0 && <span className="tabdot">{nAlertas}</span>}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <label className="userchip">
          Ver como
          <select className="field" value={papel} onChange={(e) => setPapel(e.target.value)}
            aria-label="Papel a simular">
            {["admin", "interact", "contrib", "view"].map((r) => <option key={r} value={r}>{NIVEIS[r]}</option>)}
          </select>
        </label>
        <MultiSelect rotuloTudo="Todos os colaboradores" plural="colaboradores" itens={itensPessoa}
          valor={filtros.pessoas} onChange={(v) => setFiltros({ ...filtros, pessoas: v })}
          aberto={abertoMulti === "top"} onAbrir={(a) => setAbertoMulti(a ? "top" : null)} />
        {podeCriarCom(papel) && <button className="btn btn-primary">Nova tarefa</button>}
        <Conta email="juliana@riocapital.pt" papel={papel} />
      </header>
      <div className="banner info">
        <span>
          <b>Pré-visualização do módulo novo</b> — dados de exemplo, nada fica guardado.
          É o código React que vai para o Netlify, ligado ao Supabase do ERP.
          Usa o <b>Ver como</b> à direita para experimentar os quatro papéis.
        </span>
      </div>
      <div className="main">
        <Sidebar projects={projects} empresas={empresas} tasks={tasks} statuses={F.statuses} pessoas={F.pessoas}
          acesso={{ role: papel }} filtroProjetos={filtroProjetos} setFiltroProjetos={setFiltroProjetos}
          podeCriar={podeCriarCom(papel)} podeEscrever={podeEscreverCom(papel)}
          sessaoUserId="u1" recarregar={() => {}} guardar={guardar} />
        <div className="content">
          {vista === "quadro" && <Board ctx={ctx} criarTarefa={() => {}} />}
          {vista === "projetos" && <ProjectBoard ctx={ctx} criarTarefa={() => {}} />}
          {vista === "gantt" && <Gantt ctx={ctx} onAjustar={ajustar} />}
          {vista === "lista" && <TaskList ctx={ctx} />}
          {vista === "alertas" && <Alerts ctx={ctx} />}
        </div>
      </div>
      {aberta && <TaskDrawer ctx={ctx} tarefaId={aberta} onFechar={() => setAberta(null)} onAjustar={ajustar} />}
    </div>
  );
}
