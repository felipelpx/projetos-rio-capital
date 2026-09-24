export function initials(nome) {
  const p = String(nome || "").trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "?";
  if (p.length === 1) return p[0].slice(0, 2).toUpperCase();
  return (p[0][0] + p[p.length - 1][0]).toUpperCase();
}

export function fmtSize(n) {
  n = +n || 0;
  if (n < 1024) return n + " B";
  if (n < 1048576) return String(Math.round(n / 1024)) + " KB";
  return (Math.round(n / 104857.6) / 10).toFixed(1).replace(".", ",") + " MB";
}

export function fmtWhen(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return "agora";
  if (s < 3600) return "há " + Math.floor(s / 60) + " min";
  if (s < 86400) return "há " + Math.floor(s / 3600) + " h";
  const dias = Math.floor(s / 86400);
  if (dias === 1) return "ontem";
  if (dias < 7) return "há " + dias + " dias";
  return d.toLocaleDateString("pt-PT", { day: "numeric", month: "short" });
}

export const PRIORIDADES = [
  { id: "baixa", label: "Baixa" },
  { id: "media", label: "Média" },
  { id: "alta", label: "Alta" },
  { id: "urgente", label: "Urgente" }
];

export const SETORES = [
  { id: "comercial", label: "Comercial", color: "#A5518E" },
  { id: "operacional", label: "Operacional", color: "#0E8798" }
];
export const rotuloSetor = (id) => SETORES.find((s) => s.id === id)?.label || "";

export const PALETA = ["#3A72B8", "#1F8A6B", "#C07A16", "#B24A42", "#6C5AB5", "#0E8798", "#A5518E", "#5A7A2E"];
export const PALETA_ESTADO = ["#7C8B99", "#2F86C4", "#C68A1B", "#3D9668", "#B24A42", "#6C5AB5", "#0E8798", "#A5518E"];

export const NIVEIS = {
  admin: "Super admin",
  interact: "Editor",
  contrib: "Editor parcial",
  view: "Visualizador"
};

/** O que cada papel pode, em palavras — para a barra lateral. */
export const NIVEIS_EXPLICACAO = {
  admin: "Faz tudo, incluindo repor a data prevista e gerir acessos.",
  interact: "Cria e altera tarefas, mexe em datas e dependências, apaga.",
  contrib: "Cria e altera tarefas e comenta. Não mexe em datas nem apaga.",
  view: "Vê o quadro e comenta."
};

/* Quem pode o quê. A base de dados impõe o mesmo; isto é só para o ecrã não
   mostrar botões que iam dar erro. */
export const podeCriarCom = (r) => r === "contrib" || r === "interact" || r === "admin";
export const podeEscreverCom = (r) => r === "interact" || r === "admin";
export const podeComentarCom = (r) => !!r;

/* Euros à portuguesa: 12 450,00 €. Compacto (sem cêntimos) para os cartões e
   os totais, onde o que interessa é a ordem de grandeza. */
const EUR = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR", useGrouping: true });
const EUR_CURTO = new Intl.NumberFormat("pt-PT", {
  style: "currency", currency: "EUR", maximumFractionDigits: 0, useGrouping: true
});
export function eur(v) {
  if (v == null || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? EUR.format(n) : "";
}
export function eurCurto(v) {
  if (v == null || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? EUR_CURTO.format(n) : "";
}
/* Soma dos orçamentos de um conjunto de tarefas, e quantas ainda não o têm. */
export function somarCusto(tarefas) {
  let total = 0, comValor = 0, porOrcar = 0;
  for (const t of tarefas) {
    if (t.custo_previsto != null) { total += Number(t.custo_previsto); comValor++; }
    else if (t.tem_custo) porOrcar++;
  }
  return { total, comValor, porOrcar };
}
