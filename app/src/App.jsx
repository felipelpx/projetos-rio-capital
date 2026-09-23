import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, configurado } from "./lib/supabase.js";
import { useBoard } from "./data/useBoard.js";
import { today } from "./lib/dates.js";
import { PRIORIDADES } from "./lib/format.js";
import Auth from "./components/Auth.jsx";
import Sidebar from "./components/Sidebar.jsx";
import Board from "./components/Board.jsx";
import ProjectBoard from "./components/ProjectBoard.jsx";
import Gantt from "./components/Gantt.jsx";
import TaskList from "./components/TaskList.jsx";
import Alerts, { contarAlertas } from "./components/Alerts.jsx";
import TaskDrawer from "./components/TaskDrawer.jsx";
import MultiSelect from "./components/MultiSelect.jsx";
import { Banner } from "./components/Bits.jsx";

const VISTAS = [
  ["quadro", "Quadro"], ["projetos", "Projetos"], ["gantt", "Gantt"],
  ["lista", "Lista"], ["alertas", "Alertas"]
];

function SemConfiguracao() {
  return (
    <div className="auth-wrap">
      <div className="auth-box">
        <h1>Falta a configuração</h1>
        <p>
          Esta aplicação precisa de saber onde está o Supabase. Copia o ficheiro{" "}
          <code>.env.example</code> para <code>.env.local</code> e preenche{" "}
          <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code>.
        </p>
        <p>
          No Netlify, os mesmos dois valores entram em <b>Site settings → Environment variables</b>.
          A <code>service_role key</code> nunca entra aqui.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [prontoAuth, setProntoAuth] = useState(false);

  useEffect(() => {
    if (!supabase) { setProntoAuth(true); return; }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setProntoAuth(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!configurado) return <SemConfiguracao />;
  if (!prontoAuth) return <div className="loading">A carregar…</div>;
  if (!session) return <Auth />;
  return <Quadro session={session} />;
}

function Quadro({ session }) {
  const dados = useBoard(session);
  const {
    projects, statuses, tasks, comments, attachments, pessoas,
    carregado, erro, aviso, setAviso, setErro, podeEscrever, souAdmin,
    patchTarefa, guardar, recarregar, ajustarDependencias, acesso
  } = dados;

  const [vista, setVista] = useState(() => localStorage.getItem("pm:vista") || "quadro");
  const [filtroProjetos, setFiltroProjetos] = useState(null);
  const [filtros, setFiltros] = useState({ estados: null, prioridades: null, pessoas: null });
  const [abertoMulti, setAbertoMulti] = useState(null);
  const [aberta, setAberta] = useState(null);
  const [procura, setProcura] = useState("");
  const [menuLateral, setMenuLateral] = useState(false);

  const hoje = useMemo(() => today(), []);

  const mudarVista = (v) => { setVista(v); localStorage.setItem("pm:vista", v); };

  /* Base: o que os filtros de projeto, pesquisa e colaborador deixam passar.
     Estado e prioridade filtram-se depois, para as contagens não mentirem. */
  const base = useMemo(() => {
    const q = procura.trim().toLowerCase();
    return tasks.filter((t) => {
      const p = projects.find((x) => x.id === t.project_id);
      if (filtroProjetos) { if (!filtroProjetos.includes(t.project_id)) return false; }
      else if (p?.arquivado) return false;
      if (filtros.pessoas) {
        const tem = t.assignees.length
          ? t.assignees.some((id) => filtros.pessoas.includes(id))
          : filtros.pessoas.includes("__sem__");
        if (!tem) return false;
      }
      if (q) {
        const palha = `${t.titulo || ""} ${t.notas || ""} ${p?.nome || ""}`.toLowerCase();
        if (!palha.includes(q)) return false;
      }
      return true;
    });
  }, [tasks, projects, filtroProjetos, filtros.pessoas, procura]);

  const listaFiltrada = useMemo(
    () => base.filter((t) =>
      (!filtros.estados || filtros.estados.includes(t.status_id)) &&
      (!filtros.prioridades || filtros.prioridades.includes(t.prioridade || "media"))
    ),
    [base, filtros.estados, filtros.prioridades]
  );

  const contarComentarios = useCallback(
    (id) => comments.filter((c) => c.task_id === id).length, [comments]);
  const contarAnexos = useCallback(
    (id) => attachments.filter((a) => a.task_id === id).length, [attachments]);
  const ordemEstado = useCallback(
    (id) => { const i = statuses.findIndex((s) => s.id === id); return i < 0 ? statuses.length : i; },
    [statuses]);
  const bloqueada = useCallback((t) =>
    t.deps.some((d) => {
      const p = tasks.find((x) => x.id === d.depende_de);
      return p && !statuses.find((s) => s.id === p.status_id)?.conta_concluido;
    }), [tasks, statuses]);

  const itensEstado = useMemo(() => statuses.map((s) => ({
    id: s.id, nome: s.label, color: s.color, n: base.filter((t) => t.status_id === s.id).length
  })), [statuses, base]);

  const itensPrioridade = useMemo(() => [...PRIORIDADES].reverse().map((p) => ({
    id: p.id, nome: p.label, n: base.filter((t) => (t.prioridade || "media") === p.id).length
  })), [base]);

  const itensPessoa = useMemo(() => [
    ...pessoas.map((p) => ({
      id: p.id, nome: p.nome, color: p.color,
      n: base.filter((t) => t.assignees.includes(p.id)).length
    })),
    { id: "__sem__", nome: "Sem responsável", n: base.filter((t) => !t.assignees.length).length }
  ], [pessoas, base]);

  async function criarTarefa(statusId, projectId) {
    const status = statusId || statuses[0]?.id;
    if (!status) return;
    const pid = projectId
      ?? (filtroProjetos?.length === 1 ? filtroProjetos[0] : projects.find((p) => !p.arquivado)?.id ?? null);
    const maior = Math.max(0, ...tasks.filter((t) => t.status_id === status).map((t) => t.posicao || 0));
    const r = await guardar(async () => {
      const ins = await supabase.from("pm_tasks")
        .insert({ titulo: "", project_id: pid, status_id: status, prioridade: "media", progresso: 0, posicao: maior + 1000 })
        .select("id").single();
      if (ins.error) return ins;
      setAberta(ins.data.id);
      return ins;
    });
    return r;
  }

  const ajustar = useCallback(async (id, silencioso) => {
    const r = await ajustarDependencias(id ?? null);
    return r;
  }, [ajustarDependencias]);

  const ctx = {
    base, listaFiltrada, tasks, statuses, projects, pessoas, comments, attachments,
    hoje, podeEscrever, souAdmin, filtros, setFiltros, abertoMulti, setAbertoMulti,
    filtroProjetos, itensEstado, itensPrioridade, itensPessoa,
    contarComentarios, contarAnexos, ordemEstado, bloqueada,
    onAbrir: setAberta, patchTarefa, guardar, recarregar,
    sessaoUserId: session.user.id
  };

  const nAlertas = contarAlertas(base, statuses, hoje);

  if (!carregado && !erro) return <div className="loading">A carregar o quadro…</div>;

  if (carregado && !acesso) {
    return (
      <div className="auth-wrap">
        <div className="auth-box">
          <h1>Sem acesso aos projetos</h1>
          <p>
            A tua conta entrou, mas não tem a área <b>projetos</b> atribuída. Pede a quem
            administra o ERP para a acrescentar.
          </p>
          <button className="btn" onClick={() => supabase.auth.signOut()}>Sair</button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <button className="menu-btn" aria-label="Projetos e equipa" onClick={() => setMenuLateral(!menuLateral)}>☰</button>
        <div className="brand">
          <h1>Rio Capital</h1>
          <span className="tag">gestão de projetos</span>
        </div>
        <div className="seg" role="group" aria-label="Vista">
          {VISTAS.map(([k, r]) => (
            <button key={k} aria-pressed={vista === k} onClick={() => mudarVista(k)}>
              {r}
              {k === "alertas" && nAlertas > 0 && <span className="tabdot">{nAlertas > 99 ? "99+" : nAlertas}</span>}
            </button>
          ))}
        </div>
        {filtroProjetos && (
          <button className="filterchip" onClick={() => setFiltroProjetos(null)}>
            <b className="t">
              {filtroProjetos.length === 1
                ? projects.find((p) => p.id === filtroProjetos[0])?.nome || "?"
                : `${filtroProjetos.length} projetos`}
            </b>
            <span className="x" aria-hidden="true">✕</span>
          </button>
        )}
        <span className="spacer" />
        <input className="field search" type="search" placeholder="Pesquisar tarefas"
          aria-label="Pesquisar tarefas" value={procura} onChange={(e) => setProcura(e.target.value)} />
        <MultiSelect
          rotuloTudo="Todos os colaboradores" plural="colaboradores" itens={itensPessoa}
          valor={filtros.pessoas} onChange={(v) => setFiltros({ ...filtros, pessoas: v })}
          aberto={abertoMulti === "top-pes"} onAbrir={(a) => setAbertoMulti(a ? "top-pes" : null)}
        />
        {podeEscrever && (
          <button className="btn btn-primary" onClick={() => criarTarefa()}>Nova tarefa</button>
        )}
        <button className="icon-btn" title="Sair" aria-label="Sair"
          onClick={() => supabase.auth.signOut()}>⏻</button>
      </header>

      <Banner tipo="err" onFechar={() => setErro("")}>{erro}</Banner>
      <Banner tipo="info" onFechar={() => setAviso("")}>{aviso}</Banner>

      <div className="main">
        <Sidebar
          projects={projects} tasks={tasks} statuses={statuses} pessoas={pessoas}
          acesso={acesso} filtroProjetos={filtroProjetos} setFiltroProjetos={setFiltroProjetos}
          aberta={menuLateral}
        />
        <div className="content">
          {vista === "quadro" && <Board ctx={ctx} criarTarefa={criarTarefa} />}
          {vista === "projetos" && <ProjectBoard ctx={ctx} criarTarefa={criarTarefa} />}
          {vista === "gantt" && <Gantt ctx={ctx} onAjustar={ajustar} />}
          {vista === "lista" && <TaskList ctx={ctx} />}
          {vista === "alertas" && <Alerts ctx={ctx} />}
        </div>
      </div>

      {aberta && (
        <TaskDrawer ctx={ctx} tarefaId={aberta} onFechar={() => setAberta(null)} onAjustar={ajustar} />
      )}
    </div>
  );
}
