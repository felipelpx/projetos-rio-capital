// Estados de uma fatura no Contas a Pagar.
// Fonte única: o formulário, os filtros, o Fluxo Futuro e o BI leem daqui.
export const STATUS_FATURA = [
  "Pagamento bloqueado",
  "Pendente atrasado",
  "Pendente em dia",
  "Adicionado ao mapa",
  "Lançado no banco",
  "Pago",
];

// "Adicionado ao mapa" é automático: vem de a fatura estar num mapa de
// pagamento, não de alguém a escolher. Por isso não aparece nos formulários.
export const STATUS_MANUAIS = STATUS_FATURA.filter(s => s !== "Adicionado ao mapa");

// Estados usados antes desta lista. Continuam a aparecer nas faturas antigas —
// traduzem-se para o equivalente novo em vez de se perderem.
const LEGADO = {
  "Pendente": "Pendente em dia",
  "Aprovada": "Pendente em dia",
  "Vencida": "Pendente atrasado",
  "Paga": "Pago",
  "Em disputa": "Pagamento bloqueado",
  "Rejeitada": "Pagamento bloqueado",
};

// Como o dinheiro sai: um débito direto é cobrado pelo fornecedor na data e
// não precisa de entrar num mapa de pagamento; um pagamento bancário é
// ordenado por nós. Saber a diferença evita pôr num mapa algo que já vai sair
// sozinho.
export const FORMAS_PAGAMENTO = [
  "Débito Direto (DD)",
  "Pagamento Bancário",
  "Outro",
];

export const STATUS_STYLES = {
  "Pagamento bloqueado": { bg: "#fdf4ff", text: "#9333ea", border: "#e9d5ff" },
  "Pendente atrasado":   { bg: "#fef2f2", text: "#dc2626", border: "#fecaca" },
  "Pendente em dia":     { bg: "#fffbeb", text: "#d97706", border: "#fde68a" },
  "Adicionado ao mapa":  { bg: "#f0fdfa", text: "#0d9488", border: "#99f6e4" },
  "Lançado no banco":    { bg: "#eff6ff", text: "#2563eb", border: "#bfdbfe" },
  "Pago":                { bg: "#f0fdf4", text: "#16a34a", border: "#bbf7d0" },
};

const hojeISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Estado a mostrar: traduz o legado, marca como atrasado o que passou da data e
// marca como "Adicionado ao mapa" o que já foi incluído num mapa de pagamento.
// A fatura guardada não é alterada — só a leitura.
//
// idsEmMapa (opcional) é o Set com os ids das faturas que estão em mapas. Quem
// não o passar continua a ver o estado como antes — é o caso dos ecrãs onde a
// distinção não interessa (Fluxo Futuro, BI).
export function statusFatura(f, idsEmMapa) {
  if (!f) return "Pendente em dia";
  const bruto = f.status || "";
  const s = STATUS_FATURA.includes(bruto) ? bruto : (LEGADO[bruto] || "Pendente em dia");
  // O mapa só sobrepõe os estados pendentes: quem já está "Lançado no banco",
  // "Pago" ou bloqueado está à frente na cadeia e mantém o seu estado.
  if (s === "Pendente em dia" || s === "Pendente atrasado") {
    if (idsEmMapa && f.id != null && idsEmMapa.has(f.id)) return "Adicionado ao mapa";
  }
  if (s === "Pendente em dia") {
    const venc = f.previsao_pagamento || f.vencimento;
    if (venc && String(venc).slice(0, 10) < hojeISO()) return "Pendente atrasado";
  }
  return s;
}

export const faturaPaga = (f) => statusFatura(f) === "Pago";

// Em aberto = ainda sai dinheiro por ela (inclui bloqueadas e já lançadas no banco)
export const faturaEmAberto = (f) => !faturaPaga(f);

export const faturaAtrasada = (f) => statusFatura(f) === "Pendente atrasado";

export const faturaBloqueada = (f) => statusFatura(f) === "Pagamento bloqueado";
