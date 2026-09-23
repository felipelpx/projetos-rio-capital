/* Supabase de mentira, em memória, só para a pré-visualização.
 *
 * O vite.harness.config.js troca o módulo verdadeiro por este, para os
 * componentes correrem exatamente o mesmo código — incluindo as escritas —
 * sem precisar de base de dados nenhuma. Nada disto vai para produção.
 */
import * as F from "./dados.js";

const estado = {
  pm_projects: F.projects.map((p) => ({ ...p })),
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
const avisar = () => { versao++; ouvintes.forEach((f) => f()); };
export function subscrever(f) { ouvintes.add(f); return () => ouvintes.delete(f); }
/* Um contador em vez das próprias linhas: o React compara por identidade, e
   uma tabela que não mudou devolvia a mesma referência e não redesenhava. */
export function versaoAtual() { return versao; }
export function ler(tabela) { return estado[tabela] || []; }

let seq = 100;
const novoId = () => "x" + ++seq;

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
            estado[tabela] = estado[tabela].map((r) =>
              filtros.every(([c, v]) => r[c] === v) ? { ...r, ...campos } : r
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
  rpc() { return Promise.resolve({ error: null }); },
  storage: { from: () => ({
    upload: () => Promise.resolve({ error: { message: "Sem armazenamento na pré-visualização." } }),
    createSignedUrl: () => Promise.resolve({ error: { message: "Sem armazenamento na pré-visualização." } }),
    remove: () => Promise.resolve({ error: null })
  }) },
  auth: {
    updateUser: () => Promise.resolve({ error: { message: "Sem conta na pré-visualização." } }),
    signOut: () => Promise.resolve({ error: null })
  }
};

export function msgErro(e) { return e?.message || "Erro."; }
