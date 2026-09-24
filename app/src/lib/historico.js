import { fmtShort } from "./dates.js";
import { eur, rotuloSetor, PRIORIDADES } from "./format.js";

/**
 * Uma linha do histórico em português corrente.
 *
 * A base de dados guarda nomes de colunas e valores em texto — é o formato
 * certo para gravar, e o errado para ler. A tradução vive aqui, num sítio só,
 * e recebe as listas de estados, projetos e pessoas para resolver os ids.
 */
const NOMES = {
  titulo: "o título",
  project_id: "o projeto",
  status_id: "o estado",
  prioridade: "a prioridade",
  setor: "o setor",
  inicio: "o início",
  fim: "o fim",
  fim_previsto: "a data prevista",
  progresso: "o progresso",
  notas: "as notas",
  tem_custo: "a marca de custo",
  custo_previsto: "o orçamento",
  owner_id: "quem vê a tarefa"
};

const vazio = "—";

function valor(campo, v, ctx) {
  if (v == null || v === "") return vazio;
  switch (campo) {
    case "inicio": case "fim": case "fim_previsto":
      return fmtShort(v) || v;
    case "custo_previsto":
      return eur(v) || v;
    case "status_id":
      return ctx.statuses.find((s) => s.id === v)?.label || v;
    case "project_id":
      return ctx.projects.find((p) => p.id === v)?.nome || "outro projeto";
    case "prioridade":
      return PRIORIDADES.find((p) => p.id === v)?.label || v;
    case "setor":
      return rotuloSetor(v) || v;
    case "progresso":
      return v + "%";
    case "tem_custo":
      return v === "true" ? "com custo" : "sem custo";
    case "owner_id":
      return v ? "só o dono" : "toda a equipa";
    default:
      return v;
  }
}

const quem = (id, ctx) => ctx.pessoas.find((p) => p.id === id)?.nome || "alguém";
const qualTarefa = (id, ctx) => ctx.tasks.find((t) => t.id === id)?.titulo || "outra tarefa";

/** { titulo, detalhe } — o detalhe é o "de → para", quando faz sentido mostrá-lo. */
export function descrever(l, ctx) {
  switch (l.tipo) {
    case "tarefa":
      return { titulo: "Tarefa criada" };

    case "campo": {
      const nome = NOMES[l.campo] || l.campo;
      /* As notas são texto corrido: dizer "de … para …" enchia o histórico.
         Mostra-se que mudaram, e o que lá está agora vê-se no campo. */
      if (l.campo === "notas") return { titulo: "Alterou as notas" };
      return {
        titulo: "Alterou " + nome,
        detalhe: valor(l.campo, l.de, ctx) + " → " + valor(l.campo, l.para, ctx)
      };
    }

    case "responsavel":
      return l.para
        ? { titulo: "Juntou " + quem(l.para, ctx) + " aos responsáveis" }
        : { titulo: "Tirou " + quem(l.de, ctx) + " dos responsáveis" };

    case "dependencia":
      if (l.campo === "dias_espera") {
        return {
          titulo: "Mudou a espera depois de “" + qualTarefa(l.texto, ctx) + "”",
          detalhe: (l.de || "0") + " → " + (l.para || "0") + " dias"
        };
      }
      return l.para
        ? { titulo: "Passou a depender de “" + qualTarefa(l.para, ctx) + "”" }
        : { titulo: "Deixou de depender de “" + qualTarefa(l.de, ctx) + "”" };

    case "anexo":
      return l.para
        ? { titulo: "Juntou o anexo " + l.para }
        : { titulo: "Tirou o anexo " + l.de };

    case "comentario":
      return l.para
        ? { titulo: "Editou um comentário", detalhe: "Antes: " + l.de }
        : { titulo: "Apagou um comentário", detalhe: l.de };

    default:
      return { titulo: l.tipo };
  }
}
