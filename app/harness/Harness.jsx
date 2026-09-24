import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { subscrever, versaoAtual, ler, supabase, definirPapel } from "./supabase-falso.js";
import { today } from "../src/lib/dates.js";
import { PRIORIDADES, SETORES } from "../src/lib/format.js";
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
  /* As fotos vivem no armazenamento de mentira; pedem-se os endereços da mesma
     maneira que em produção, para o caminho do código ser o mesmo. */
  const [fotos, setFotos] = useState({});
  const caminhosFoto = projects.map((p) => p.foto).filter(Boolean).sort().join("|");
  useEffect(() => {
    if (!caminhosFoto) { setFotos({}); return; }
    supabase.storage.from("pm-anexos").createSignedUrls(caminhosFoto.split("|"), 3600)
      .then(({ data }) => {
        const m = {};
        for (const r of data || []) m[r.path] = r.signedUrl;
        setFotos(m);
      });
  }, [caminhosFoto]);
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
  const [filtros, setFiltros] = useState({ estados: null, prioridades: null, setores: null, pessoas: null });
  const [abertoMulti, setAbertoMulti] = useState(null);
  const [aberta, setAberta] = useState(null);
  const [papel, setPapel] = useState("admin");
  /* O cliente falso precisa de saber o papel para recusar o que a base de dados
     recusaria — o ecrã esconde botões, mas as regras estão por baixo. */
  definirPapel(papel);
  const hoje = useMemo(() => today(new Date("2026-09-22T12:00:00")), []);

  const base = useMemo(() => tasks.filter((t) => {
    const p = projects.find((x) => x.id === t.project_id);
    if (filtroProjetos) return filtroProjetos.includes(t.project_id);
    return !p?.arquivado;
  }), [tasks, filtroProjetos]);

  const listaFiltrada = useMemo(() => base.filter((t) =>
    (!filtros.estados || filtros.estados.includes(t.status_id)) &&
    (!filtros.prioridades || filtros.prioridades.includes(t.prioridade || "media")) &&
    (!filtros.setores || filtros.setores.includes(t.setor || "__sem__"))
  ), [base, filtros]);

  const comentarios = useMemo(() => ler("pm_comments"), [versao]);
  const anexos = useMemo(() => ler("pm_attachments"), [versao]);

  const [erro, setErro] = useState("");
  /* Os erros aparecem tal como apareceriam em produção: o cliente falso recusa
     o mesmo que a base de dados recusa. */
  const guardar = useCallback(async (fn) => {
    const r = await fn();
    if (r?.error) { setErro(r.error.message); return { ok: false, erro: r.error.message }; }
    setErro("");
    return { ok: true, data: r?.data };
  }, []);

  const patchTarefa = useCallback(async (id, campos) => {
    const r = await supabase.from("pm_tasks").update(campos).eq("id", id);
    if (r?.error) { setErro(r.error.message); return { ok: false, erro: r.error.message }; }
    setErro("");
    return { ok: true };
  }, []);

  const empurrar = useCallback(async (mexidas) => {
    for (const m of mexidas) {
      const r = await supabase.rpc("pm_alterar_datas", {
        p_task: m.id, p_inicio: m.inicio, p_fim: m.fim,
        p_justificacao: null, p_empurrada_por: m.empurradaPor || null
      });
      if (r?.error) { setErro(r.error.message); return false; }
    }
    return true;
  }, []);

  const alterarDatas = useCallback(async (id, novas, justificacao) => {
    const antes = ler("pm_tasks").find((t) => t.id === id);
    if (!antes) return { ok: false };
    const inicio = novas.inicio !== undefined ? novas.inicio : antes.inicio;
    const fim = novas.fim !== undefined ? novas.fim : antes.fim;
    const primeira = antes.inicio == null && antes.fim == null;
    const adiou = fim && (!antes.fim || fim > antes.fim);

    const r = primeira
      ? await supabase.from("pm_tasks").update({ inicio, fim }).eq("id", id)
      : await supabase.rpc("pm_alterar_datas", {
          p_task: id, p_inicio: inicio, p_fim: fim,
          p_justificacao: justificacao, p_empurrada_por: null
        });
    if (r?.error) { setErro(r.error.message); return { ok: false, erro: r.error.message }; }
    setErro("");
    if (adiou) {
      const depois = ler("pm_tasks").map((t) => ({
        ...t, deps: ler("pm_task_deps").filter((d) => d.task_id === t.id)
      }));
      if (!(await empurrar(cascade(id, depois)))) return { ok: false };
    }
    return { ok: true };
  }, [empurrar]);

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
  const itensSetor = [...SETORES.map((x) => ({ id: x.id, nome: x.label, color: x.color, n: base.filter((t) => t.setor === x.id).length })),
    { id: "__sem__", nome: "Sem setor", n: base.filter((t) => !t.setor).length }];
  const itensPessoa = [...F.pessoas.map((p) => ({ id: p.id, nome: p.nome, color: p.color, n: base.filter((t) => t.assignees.includes(p.id)).length })),
    { id: "__sem__", nome: "Sem responsável", n: base.filter((t) => !t.assignees.length).length }];

  const ctx = {
    base, listaFiltrada, tasks, statuses: F.statuses, projects, pessoas: F.pessoas,
    comments: comentarios, attachments: anexos, hoje, podeEscrever: podeEscreverCom(papel), podeCriar: podeCriarCom(papel),
    podeComentar: podeComentarCom(papel), souAdmin: papel === "admin",
    filtros, setFiltros, abertoMulti, setAbertoMulti, filtroProjetos,
    itensEstado, itensPrioridade, itensSetor, itensPessoa, fotos,
    contarComentarios: (id) => comentarios.filter((c) => c.task_id === id).length,
    contarAnexos: (id) => anexos.filter((a) => a.task_id === id).length,
    ordemEstado: (id) => F.statuses.findIndex((s) => s.id === id),
    bloqueada: (t) => t.deps.some((d) => {
      const p = tasks.find((x) => x.id === d.depende_de);
      return p && !F.statuses.find((s) => s.id === p.status_id)?.conta_concluido;
    }),
    onAbrir: setAberta, patchTarefa, alterarDatas,
    guardar, recarregar: () => {}, sessaoUserId: "u1"
  };

  const nAlertas = contarAlertas(base, F.statuses, hoje);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1 className="brandmark">
            {/* O logótipo faz de título: o nome está lá dentro. A versão clara
                entra sozinha em modo escuro, senão o azul-escuro desaparecia. */}
            <picture>
              <source srcSet="/logo-claro.png" media="(prefers-color-scheme: dark)" />
              <img src="/logo.png" alt="Rio Capital" width="391" height="174" />
            </picture>
          </h1>
          <span className="tag">gestão de projetos</span>
        </div>
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
      {erro && (
        <div className="banner err">
          <span>{erro}</span>
          <button onClick={() => setErro("")}>Fechar</button>
        </div>
      )}
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
