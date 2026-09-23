/* Dados de mentira com a forma exata do que vem do Supabase, para conseguir
   desenhar as vistas sem base de dados. Inclui de propósito os casos difíceis:
   tarefa sem datas, derrapagem, início em atraso, espera entre tarefas e uma
   dependência desrespeitada. */
export const statuses = [
  { id: "todo", label: "Por fazer", color: "#7C8B99", posicao: 1000, conta_por_iniciar: true, conta_concluido: false },
  { id: "doing", label: "Em curso", color: "#2F86C4", posicao: 2000 },
  { id: "waiting", label: "À espera de terceiros", color: "#6C5AB5", posicao: 2500 },
  { id: "review", label: "Em revisão", color: "#C68A1B", posicao: 3000 },
  { id: "done", label: "Concluído", color: "#3D9668", posicao: 4000, conta_concluido: true }
];
export const projects = [
  { id: "p1", nome: "Arroios, Travessa das Amoreiras", empresa: "Alternative Shadow", color: "#C07A16", criado_em: "2026-09-21" },
  { id: "p2", nome: "Avenida Braamcamp", empresa: "Without Delays", color: "#1F8A6B", criado_em: "2026-09-21" },
  { id: "p3", nome: "Galpão antigo", empresa: "Crunchy Prophecy", color: "#6C5AB5", arquivado: true, criado_em: "2026-09-20" }
];
export const pessoas = [
  { id: "u1", nome: "Juliana Dornelles", color: "#3A72B8", papel: "admin" },
  { id: "u2", nome: "Felipe Peixoto", color: "#1F8A6B", papel: "interact" }
];
const t = (o) => ({ progresso: 0, notas: "", assignees: [], deps: [], prioridade: "media", posicao: 1000, ...o });
export const tasks = [
  t({ id: "t1", project_id: "p1", titulo: "Orçamento, ajuste de lojas", status_id: "done",
      inicio: "2026-09-14", fim: "2026-09-17", fim_previsto: "2026-09-17", progresso: 100, assignees: ["u1"] }),
  t({ id: "t2", project_id: "p1", titulo: "Obras de ajuste da loja", status_id: "doing", prioridade: "alta",
      inicio: "2026-09-18", fim: "2026-09-23", fim_previsto: "2026-09-23", progresso: 40,
      deps: [{ depende_de: "t1", dias_espera: 0 }], assignees: ["u1", "u2"],
      notas: "A obra arranca assim que o orçamento fechar." }),
  t({ id: "t3", project_id: "p1", titulo: "Orçamento, limpeza", status_id: "waiting",
      inicio: "2026-09-14", fim: "2026-09-30", fim_previsto: "2026-09-22",
      notas: "Derrapou oito dias face ao previsto." }),
  t({ id: "t4", project_id: "p1", titulo: "Limpeza pós-obra", status_id: "todo",
      inicio: "2026-09-24", fim: "2026-09-25", fim_previsto: "2026-09-25",
      deps: [{ depende_de: "t2", dias_espera: 0 }, { depende_de: "t3", dias_espera: 0 }] }),
  t({ id: "t5", project_id: "p2", titulo: "Licença de obra", status_id: "waiting", prioridade: "urgente",
      inicio: "2026-09-01", fim: "2026-09-20", fim_previsto: "2026-09-20", assignees: ["u2"] }),
  t({ id: "t6", project_id: "p2", titulo: "Construção", status_id: "todo",
      inicio: "2026-10-01", fim: "2026-11-30", fim_previsto: "2026-11-30",
      deps: [{ depende_de: "t5", dias_espera: 10 }] }),
  t({ id: "t7", project_id: "p2", titulo: "Sem datas ainda", status_id: "todo" }),
  t({ id: "t8", project_id: "p1", titulo: "Devia ter arrancado", status_id: "todo", prioridade: "alta",
      inicio: "2026-09-10", fim: "2026-09-28", fim_previsto: "2026-09-28" })
];
export const comments = [
  { id: "c1", task_id: "t3", autor_id: "u1", tipo: "comentario", texto: "O fornecedor pediu mais uma semana.", criado_em: "2026-09-20T10:00:00Z" },
  { id: "c2", task_id: "t3", autor_id: "u1", tipo: "replaneamento", texto: "Atraso do fornecedor de limpeza.",
    de_data: "2026-09-22", para_data: "2026-09-30", criado_em: "2026-09-21T09:00:00Z" }
];
export const attachments = [
  { id: "a1", task_id: "t2", tipo: "ficheiro", nome: "orcamento.pdf", caminho: "t2/orcamento.pdf", tamanho: 284512, mime: "application/pdf" }
];
