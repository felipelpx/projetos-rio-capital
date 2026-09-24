import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase, msgErro } from "../lib/supabase.js";
import { cascade, resolveViolations } from "../lib/schedule.js";
import { podeCriarCom, podeEscreverCom, podeComentarCom } from "../lib/format.js";

/* Uma tarefa chega em várias linhas (tarefa + responsáveis + dependências).
   Junta-se tudo numa só forma, que é a que o resto da aplicação conhece. */
function montarTarefas(tasks, assignees, deps) {
  const porTarefa = new Map(tasks.map((t) => [t.id, { ...t, assignees: [], deps: [] }]));
  for (const a of assignees) porTarefa.get(a.task_id)?.assignees.push(a.user_id);
  for (const d of deps)
    porTarefa.get(d.task_id)?.deps.push({ depende_de: d.depende_de, dias_espera: d.dias_espera ?? 0 });
  return [...porTarefa.values()];
}

const TABELAS = [
  "pm_projects", "pm_empresas", "pm_statuses", "pm_tasks", "pm_task_assignees",
  "pm_task_deps", "pm_comments", "pm_task_log", "pm_attachments", "pm_subscriptions"
];

export function useBoard(session) {
  const [estado, setEstado] = useState({
    carregado: false,
    projects: [], empresas: [], statuses: [], tasks: [], comments: [], historico: [],
    attachments: [], subscriptions: [], pessoas: [], acesso: null
  });
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const porCarregar = useRef(false);

  const carregar = useCallback(async () => {
    if (!supabase || !session) return;
    if (porCarregar.current) return;
    porCarregar.current = true;
    try {
      const [proj, emp, st, tk, asg, dps, cm, hist, at, sub, acc, prof] = await Promise.all([
        supabase.from("pm_projects").select("*").order("criado_em"),
        supabase.from("pm_empresas").select("*").order("nome"),
        supabase.from("pm_statuses").select("*").order("posicao"),
        supabase.from("pm_tasks").select("*"),
        supabase.from("pm_task_assignees").select("*"),
        supabase.from("pm_task_deps").select("*"),
        supabase.from("pm_comments").select("*").order("criado_em"),
        supabase.from("pm_task_log").select("*").order("criado_em"),
        supabase.from("pm_attachments").select("*"),
        supabase.from("pm_subscriptions").select("*"),
        supabase.from("app_access").select("*").eq("area", "projetos"),
        supabase.from("profiles").select("*")
      ]);
      const falhou = [proj, emp, st, tk, asg, dps, cm, hist, at, sub, acc, prof].find((r) => r.error);
      if (falhou) throw falhou.error;

      /* A equipa é quem tem acesso à área — não há lista à parte. */
      const perfis = new Map((prof.data || []).map((p) => [p.id, p]));
      const pessoas = (acc.data || [])
        .map((a) => ({
          id: a.user_id,
          papel: a.role,
          nome: perfis.get(a.user_id)?.nome || perfis.get(a.user_id)?.email || "Alguém",
          color: perfis.get(a.user_id)?.color || "#7C8B99"
        }))
        .sort((a, b) => {
          const r = (x) => (x.papel === "admin" ? 0 : 1);
          return r(a) - r(b) || a.nome.localeCompare(b.nome, "pt");
        });

      setEstado({
        carregado: true,
        projects: proj.data || [],
        empresas: emp.data || [],
        statuses: st.data || [],
        tasks: montarTarefas(tk.data || [], asg.data || [], dps.data || []),
        comments: cm.data || [],
        historico: hist.data || [],
        attachments: at.data || [],
        subscriptions: sub.data || [],
        pessoas,
        acesso: (acc.data || []).find((a) => a.user_id === session.user.id) || null
      });
      setErro("");
    } catch (e) {
      setErro(msgErro(e));
    } finally {
      porCarregar.current = false;
    }
  }, [session]);

  useEffect(() => { carregar(); }, [carregar]);

  /* Tempo real: qualquer alteração vinda de outra pessoa recarrega o quadro.
     Recarregar tudo é mais lento do que aplicar o delta, mas com este
     volume (dezenas de tarefas) é instantâneo e não há estados impossíveis. */
  useEffect(() => {
    if (!supabase || !session) return;
    const canal = supabase.channel("pm-todos");
    for (const t of TABELAS)
      canal.on("postgres_changes", { event: "*", schema: "public", table: t }, () => carregar());
    canal.subscribe();
    return () => { supabase.removeChannel(canal); };
  }, [session, carregar]);

  const papel = estado.acesso?.role || null;
  const podeEscrever = podeEscreverCom(papel);   // datas, dependências, apagar
  const podeCriar    = podeCriarCom(papel);      // criar e alterar tarefas
  const podeComentar = podeComentarCom(papel);
  const souAdmin     = papel === "admin";

  /* ---- escritas ---- */

  const guardar = useCallback(async (fn) => {
    try {
      const r = await fn();
      if (r?.error) throw r.error;
      await carregar();
      return { ok: true, data: r?.data };
    } catch (e) {
      const m = msgErro(e);
      setErro(m);
      await carregar();
      return { ok: false, erro: m };
    }
  }, [carregar]);

  const tarefasRef = useRef(estado.tasks);
  tarefasRef.current = estado.tasks;

  /** Altera uma tarefa e, se o fim foi adiado, empurra o que depende dela. */
  /* Empurrar quem depende desta tarefa. Cada empurrão passa pela mesma função
     de servidor que uma mudança à mão, com a justificação escrita por ela:
     assim o histórico de uma tarefa arrastada diz de onde veio o arrasto. */
  const empurrar = useCallback(async (mexidas) => {
    for (const m of mexidas) {
      const r = await supabase.rpc("pm_alterar_datas", {
        p_task: m.id, p_inicio: m.inicio, p_fim: m.fim,
        p_justificacao: null, p_empurrada_por: m.empurradaPor || null
      });
      if (r.error) return r;
    }
    if (mexidas.length) {
      setAviso(
        mexidas.length === 1
          ? `"${mexidas[0].titulo}" foi empurrada para a frente.`
          : `${mexidas.length} tarefas dependentes foram empurradas para a frente.`
      );
    }
    return { error: null };
  }, []);

  /** Tudo o que não sejam datas nem euros: título, estado, notas, setor… */
  const patchTarefa = useCallback(async (id, patch) => {
    const antes = tarefasRef.current.find((t) => t.id === id);
    if (!antes) return { ok: false };
    return guardar(() => supabase.from("pm_tasks").update(patch).eq("id", id));
  }, [guardar]);

  /* Marcar uma data que estava vazia é planear, e faz-se sem cerimónia: qualquer
     editor a põe. Mexer numa que já lá estava muda o plano de toda a gente, é de
     super admin e leva justificação — a base de dados recusa sem ela. */
  const alterarDatas = useCallback(async (id, novas, justificacao) => {
    const antes = tarefasRef.current.find((t) => t.id === id);
    if (!antes) return { ok: false };
    const inicio = novas.inicio !== undefined ? novas.inicio : antes.inicio;
    const fim = novas.fim !== undefined ? novas.fim : antes.fim;
    /* Só preencheu se tudo o que mexeu estava vazio antes. */
    const soPreencheu =
      (inicio === antes.inicio || antes.inicio == null) &&
      (fim === antes.fim || antes.fim == null);
    const adiou = fim && (!antes.fim || fim > antes.fim);

    return guardar(async () => {
      const r = soPreencheu
        ? await supabase.from("pm_tasks").update({ inicio, fim }).eq("id", id)
        : await supabase.rpc("pm_alterar_datas", {
            p_task: id, p_inicio: inicio, p_fim: fim,
            p_justificacao: justificacao, p_empurrada_por: null
          });
      if (r.error) return r;
      if (!adiou) return r;

      const depois = tarefasRef.current.map((t) => (t.id === id ? { ...t, inicio, fim } : t));
      const err = await empurrar(cascade(id, depois));
      return err.error ? err : r;
    });
  }, [guardar, empurrar]);

  /** Acerta as dependências que já estavam fora de ordem. Nunca corre sozinho. */
  const ajustarDependencias = useCallback(async (apenasId = null) => {
    const mexidas = resolveViolations(tarefasRef.current, apenasId);
    if (!mexidas.length) { setAviso("Não havia nada para ajustar."); return { ok: true }; }
    const r = await guardar(() => empurrar(mexidas));
    if (r.ok) {
      setAviso(
        mexidas.length === 1
          ? `"${mexidas[0].titulo}" foi empurrada para a frente.`
          : `${mexidas.length} tarefas foram empurradas para respeitar as dependências.`
      );
    }
    return r;
  }, [guardar, empurrar]);

  return {
    ...estado, erro, aviso, setAviso, setErro,
    papel, podeEscrever, podeCriar, podeComentar, souAdmin, recarregar: carregar,
    guardar, patchTarefa, alterarDatas, ajustarDependencias
  };
}

/** Índice por id, para as vistas não andarem a percorrer listas. */
export function useIndex(lista) {
  return useMemo(() => new Map(lista.map((x) => [x.id, x])), [lista]);
}
