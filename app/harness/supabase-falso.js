/* Supabase de mentira, em memória, só para a pré-visualização.
 *
 * O vite.harness.config.js troca o módulo verdadeiro por este, para os
 * componentes correrem exatamente o mesmo código — incluindo as escritas —
 * sem precisar de base de dados nenhuma. Nada disto vai para produção.
 */
import * as F from "./dados.js";

const estado = {
  pm_projects: F.projects.map((p) => ({ ...p })),
  pm_empresas: F.empresas.map((e) => ({ ...e })),
  pm_tasks: F.tasks.map((t) => ({ ...t })),
  pm_statuses: F.statuses.map((s) => ({ ...s })),
  pm_comments: F.comments.map((c) => ({ ...c })),
  pm_attachments: F.attachments.map((a) => ({ ...a })),
  pm_task_assignees: F.tasks.flatMap((t) => t.assignees.map((u) => ({ task_id: t.id, user_id: u }))),
  pm_task_log: (F.historico || []).map((l) => ({ ...l })),
  pm_task_deps: F.tasks.flatMap((t) =>
    t.deps.map((d) => ({ task_id: t.id, depende_de: d.depende_de, dias_espera: d.dias_espera })))
};

const ouvintes = new Set();
let versao = 0;

/* Os mesmos dois gatilhos que existem no Postgres: o nome da empresa dentro do
   projeto é um espelho, nunca se escreve à mão. Sem isto a pré-visualização
   mentia — renomear uma empresa deixava o nome antigo nos cartões. */
function espelharEmpresas() {
  const nomes = new Map(estado.pm_empresas.map((e) => [e.id, e.nome]));
  estado.pm_projects = estado.pm_projects.map((p) =>
    p.empresa === (nomes.get(p.empresa_id) ?? null)
      ? p
      : { ...p, empresa: nomes.get(p.empresa_id) ?? null }
  );
}

const avisar = () => { espelharEmpresas(); versao++; ouvintes.forEach((f) => f()); };
export function subscrever(f) { ouvintes.add(f); return () => ouvintes.delete(f); }
/* Um contador em vez das próprias linhas: o React compara por identidade, e
   uma tabela que não mudou devolvia a mesma referência e não redesenhava. */
export function versaoAtual() { return versao; }
export function ler(tabela) { return estado[tabela] || []; }

let seq = 100;
const novoId = () => "x" + ++seq;

/* O papel de quem está a "ver como". Serve para a pré-visualização recusar o
   que a base de dados recusaria — senão mostrava permissões que não existem. */
let papel = "admin";
const ficheiros = new Map(Object.entries(F.fotosExemplo || {}));

/* O mesmo que o gatilho pm_registar_tarefa faz no Postgres. Sem isto, a
   pré-visualização mostrava um histórico que só cresce em produção. */
const CAMPOS_LOG = [
  "titulo", "project_id", "status_id", "prioridade", "setor",
  "inicio", "fim", "fim_previsto", "progresso", "notas",
  "tem_custo", "custo_previsto", "owner_id"
];
let justificacao = null;
export function definirJustificacao(j) { justificacao = j || null; }

function registar(linha) {
  estado.pm_task_log = [...estado.pm_task_log, {
    id: novoId(), autor_id: "u1", criado_em: new Date().toISOString(),
    campo: null, de: null, para: null, texto: null, ...linha
  }];
}

function registarCampos(antes, depois) {
  for (const c of CAMPOS_LOG) {
    if (String(antes?.[c] ?? "") === String(depois?.[c] ?? "")) continue;
    registar({
      task_id: depois.id, tipo: "campo", campo: c,
      de: antes?.[c] == null ? null : String(antes[c]),
      para: depois?.[c] == null ? null : String(depois[c]),
      texto: justificacao
    });
  }
}
export function definirPapel(p) { papel = p; }
const podeEscrever = () => papel === "interact" || papel === "admin";
const podeCriar = () => papel === "contrib" || podeEscrever();

function consulta(tabela) {
  let filtros = [];
  const combina = (r) => filtros.every(([c, v]) => r[c] === v);
  const api = {
    eq(coluna, valor) { filtros.push([coluna, valor]); return api; },
    select() { return api; },
    single() { return api; },
    then(resolve) { return Promise.resolve({ data: estado[tabela].filter(combina), error: null }).then(resolve); }
  };
  return { api, filtros, combina };
}

export const configurado = true;

export const supabase = {
  from(tabela) {
    return {
      select() {
        const { api } = consulta(tabela);
        return api;
      },
      insert(linhas) {
        const arr = Array.isArray(linhas) ? linhas : [linhas];
        const criadas = arr.map((l) => ({ id: novoId(), ...l }));
        estado[tabela] = [...estado[tabela], ...criadas];
        for (const c of criadas) {
          if (tabela === "pm_tasks") registar({ task_id: c.id, tipo: "tarefa", texto: "Tarefa criada" });
          if (tabela === "pm_task_assignees") registar({ task_id: c.task_id, tipo: "responsavel", para: c.user_id });
          if (tabela === "pm_task_deps") registar({ task_id: c.task_id, tipo: "dependencia", para: c.depende_de });
          if (tabela === "pm_attachments") registar({ task_id: c.task_id, tipo: "anexo", para: c.nome });
        }
        avisar();
        const r = { data: criadas, error: null };
        return {
          select: () => ({ single: () => Promise.resolve({ data: criadas[0], error: null }) }),
          then: (res) => Promise.resolve(r).then(res)
        };
      },
      update(campos) {
        const filtros = [];
        const api = {
          eq(coluna, valor) {
            filtros.push([coluna, valor]);
            return api;
          },
          then(res) {
            /* Os mesmos guardas que existem no Postgres, para a pré-visualização
               não prometer o que a base de dados recusa. */
            const alvos = estado[tabela].filter((r) => filtros.every(([c, v]) => r[c] === v));
            if (tabela === "pm_tasks" && ("inicio" in campos || "fim" in campos)) {
              if (!podeCriar()) {
                return Promise.resolve({ error: { message: "O teu acesso não permite definir datas." } }).then(res);
              }
              const marcada = alvos.find((r) =>
                (r.inicio != null && "inicio" in campos && campos.inicio !== r.inicio) ||
                (r.fim != null && "fim" in campos && campos.fim !== r.fim));
              if (marcada) {
                return Promise.resolve({ error: { message: "Alterar uma data já marcada é de super admin, e exige justificação." } }).then(res);
              }
            }
            if (tabela === "pm_tasks" && "custo_previsto" in campos) {
              return Promise.resolve({ error: { message: "Gravar um orçamento exige uma justificação." } }).then(res);
            }
            if (tabela === "pm_tasks" && "tem_custo" in campos) {
              if (!podeEscrever()) {
                return Promise.resolve({ error: { message: "O teu acesso não permite alterar custos." } }).then(res);
              }
              const preso = alvos.find((r) => r.custo_previsto != null && campos.tem_custo === false);
              if (preso) {
                return Promise.resolve({ error: { message: "A tarefa tem orçamento. Para o retirar é preciso um super admin." } }).then(res);
              }
            }
            const antes = tabela === "pm_tasks" ? alvos.map((r) => ({ ...r })) : [];
            estado[tabela] = estado[tabela].map((r) =>
              filtros.every(([c, v]) => r[c] === v)
                ? { ...r, ...campos, ...(campos.custo_previsto != null ? { tem_custo: true } : {}) }
                : r
            );
            if (tabela === "pm_tasks") {
              for (const a of antes) {
                registarCampos(a, estado.pm_tasks.find((t) => t.id === a.id));
              }
            }
            if (tabela === "pm_comments" && "texto" in campos) {
              for (const a of alvos) {
                registar({ task_id: a.task_id, tipo: "comentario", de: a.texto, para: campos.texto });
              }
            }
            avisar();
            return Promise.resolve({ error: null }).then(res);
          }
        };
        return api;
      },
      delete() {
        const filtros = [];
        const api = {
          eq(coluna, valor) { filtros.push([coluna, valor]); return api; },
          then(res) {
            const idos = estado[tabela].filter((r) => filtros.every(([c, v]) => r[c] === v));
            estado[tabela] = estado[tabela].filter(
              (r) => !filtros.every(([c, v]) => r[c] === v)
            );
            /* Apagar a tarefa arrasta os filhos: aí não há histórico a escrever. */
            const tarefaViva = (id) => estado.pm_tasks.some((t) => t.id === id);
            for (const o of idos) {
              if (tabela === "pm_task_assignees" && tarefaViva(o.task_id)) registar({ task_id: o.task_id, tipo: "responsavel", de: o.user_id });
              if (tabela === "pm_task_deps" && tarefaViva(o.task_id)) registar({ task_id: o.task_id, tipo: "dependencia", de: o.depende_de });
              if (tabela === "pm_attachments" && tarefaViva(o.task_id)) registar({ task_id: o.task_id, tipo: "anexo", de: o.nome });
              if (tabela === "pm_comments" && tarefaViva(o.task_id)) registar({ task_id: o.task_id, tipo: "comentario", de: o.texto });
            }
            avisar();
            return Promise.resolve({ error: null }).then(res);
          }
        };
        return api;
      }
    };
  },
  rpc(nome, args) {
    if (nome === "pm_alterar_datas") {
      const { p_task, p_inicio, p_fim, p_justificacao, p_empurrada_por } = args || {};
      if (!p_empurrada_por && papel !== "admin") {
        return Promise.resolve({ error: { message: "Só um super admin pode alterar uma data já marcada." } });
      }
      if (p_empurrada_por && !podeCriar()) {
        return Promise.resolve({ error: { message: "O teu acesso não permite alterar datas." } });
      }
      const tarefa = estado.pm_tasks.find((t) => t.id === p_task);
      if (!tarefa) return Promise.resolve({ error: { message: "A tarefa não existe." } });
      let razao;
      if (p_empurrada_por) {
        const deps = estado.pm_task_deps.filter((d) => d.task_id === p_task);
        if (!deps.some((d) => d.depende_de === p_empurrada_por)) {
          return Promise.resolve({ error: { message: "Essa tarefa não é antecessora desta." } });
        }
        const quem = estado.pm_tasks.find((t) => t.id === p_empurrada_por);
        razao = "Empurrada automaticamente por: " + (quem?.titulo || "outra tarefa");
      } else {
        razao = String(p_justificacao || "").trim();
        if (!razao) return Promise.resolve({ error: { message: "A justificação é obrigatória." } });
      }
      const base = tarefa.fim_previsto ?? tarefa.fim ?? p_fim;
      const depois = { ...tarefa, inicio: p_inicio, fim: p_fim, fim_previsto: base };
      estado.pm_tasks = estado.pm_tasks.map((t) => t.id === p_task ? depois : t);
      definirJustificacao(razao);
      registarCampos(tarefa, depois);
      definirJustificacao(null);
      avisar();
      return Promise.resolve({ error: null });
    }
    if (nome === "pm_definir_orcamento") {
      if (args && args.p_valor != null) {
        const t0 = estado.pm_tasks.find((t) => t.id === args.p_task);
        if (t0 && t0.custo_previsto == null && !podeEscrever()) {
          return Promise.resolve({ error: { message: "O teu acesso não permite definir custos." } });
        }
      }
      const { p_task, p_valor, p_justificacao } = args || {};
      const jaTinha = estado.pm_tasks.find((t) => t.id === p_task)?.custo_previsto != null;
      if (jaTinha && papel !== "admin") {
        return Promise.resolve({ error: { message: "Só um super admin pode alterar um orçamento já definido." } });
      }
      if (!jaTinha && !podeEscrever()) {
        return Promise.resolve({ error: { message: "O teu acesso não permite definir custos." } });
      }
      if (!String(p_justificacao || "").trim()) {
        return Promise.resolve({ error: { message: "A justificação é obrigatória." } });
      }
      const tarefa = estado.pm_tasks.find((t) => t.id === p_task);
      if (!tarefa) return Promise.resolve({ error: { message: "Tarefa não encontrada." } });
      const depois2 = { ...tarefa, custo_previsto: p_valor, tem_custo: p_valor != null };
      estado.pm_tasks = estado.pm_tasks.map((t) => t.id === p_task ? depois2 : t);
      definirJustificacao(p_justificacao);
      registarCampos(tarefa, depois2);
      definirJustificacao(null);
      avisar();
      return Promise.resolve({ error: null });
    }
    return Promise.resolve({ error: null });
  },
  /* Armazenamento de mentira: guarda o ficheiro em memória e devolve um
     endereço de blob, que chega para as fotos aparecerem na pré-visualização. */
  storage: { from: () => ({
    upload: (caminho, f) => {
      if (!podeEscrever()) {
        return Promise.resolve({ error: { message: "new row violates row-level security policy" } });
      }
      ficheiros.set(caminho, URL.createObjectURL(f));
      return Promise.resolve({ data: { path: caminho }, error: null });
    },
    createSignedUrl: () => Promise.resolve({ error: { message: "Sem anexos na pré-visualização." } }),
    createSignedUrls: (lista) => Promise.resolve({
      data: lista.map((path) => ({ path, signedUrl: ficheiros.get(path) || path })),
      error: null
    }),
    remove: (lista) => { for (const c of lista) ficheiros.delete(c); return Promise.resolve({ error: null }); }
  }) },
  auth: {
    updateUser: () => Promise.resolve({ error: { message: "Sem conta na pré-visualização." } }),
    signOut: () => Promise.resolve({ error: null })
  }
};

export function msgErro(e) { return e?.message || "Erro."; }
