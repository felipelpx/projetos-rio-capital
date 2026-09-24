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
export function definirPapel(p) { papel = p; }
const podeEscrever = () => papel === "interact" || papel === "admin";

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
              if (!podeEscrever()) {
                return Promise.resolve({ error: { message: "O teu acesso não permite alterar datas." } }).then(res);
              }
              const marcada = alvos.find((r) =>
                (r.inicio != null && "inicio" in campos && campos.inicio !== r.inicio) ||
                (r.fim != null && "fim" in campos && campos.fim !== r.fim));
              if (marcada) {
                return Promise.resolve({ error: { message: "Alterar uma data já marcada exige uma justificação." } }).then(res);
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
            estado[tabela] = estado[tabela].map((r) =>
              filtros.every(([c, v]) => r[c] === v)
                ? { ...r, ...campos, ...(campos.custo_previsto != null ? { tem_custo: true } : {}) }
                : r
            );
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
            estado[tabela] = estado[tabela].filter(
              (r) => !filtros.every(([c, v]) => r[c] === v)
            );
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
      if (!podeEscrever()) {
        return Promise.resolve({ error: { message: "O teu acesso não permite alterar datas." } });
      }
      const tarefa = estado.pm_tasks.find((t) => t.id === p_task);
      if (!tarefa) return Promise.resolve({ error: { message: "A tarefa não existe." } });
      let justificacao;
      if (p_empurrada_por) {
        const deps = estado.pm_task_deps.filter((d) => d.task_id === p_task);
        if (!deps.some((d) => d.depende_de === p_empurrada_por)) {
          return Promise.resolve({ error: { message: "Essa tarefa não é antecessora desta." } });
        }
        const quem = estado.pm_tasks.find((t) => t.id === p_empurrada_por);
        justificacao = "Empurrada automaticamente por: " + (quem?.titulo || "outra tarefa");
      } else {
        justificacao = String(p_justificacao || "").trim();
        if (!justificacao) return Promise.resolve({ error: { message: "A justificação é obrigatória." } });
      }
      const registos = [];
      if (p_inicio !== tarefa.inicio) registos.push(["inicio", tarefa.inicio, p_inicio]);
      if (p_fim !== tarefa.fim) registos.push(["fim", tarefa.fim, p_fim]);
      const base = tarefa.fim_previsto ?? tarefa.fim ?? p_fim;
      estado.pm_tasks = estado.pm_tasks.map((t) => t.id === p_task
        ? { ...t, inicio: p_inicio, fim: p_fim, fim_previsto: base } : t);
      estado.pm_comments = [...estado.pm_comments, ...registos.map(([campo, de, para]) => ({
        id: novoId(), task_id: p_task, autor_id: "u1", tipo: "datas", campo,
        texto: justificacao, de_data: de, para_data: para, criado_em: new Date().toISOString()
      }))];
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
      const antigo = tarefa.custo_previsto;
      estado.pm_tasks = estado.pm_tasks.map((t) => t.id === p_task
        ? { ...t, custo_previsto: p_valor, tem_custo: p_valor != null }
        : t);
      estado.pm_comments = [...estado.pm_comments, {
        id: novoId(), task_id: p_task, autor_id: "u1", tipo: "orcamento",
        texto: p_justificacao, de_valor: antigo, para_valor: p_valor,
        criado_em: new Date().toISOString()
      }];
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
