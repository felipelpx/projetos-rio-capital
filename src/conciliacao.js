// ─────────────────────────────────────────────────────────────────────────────
// CONCILIAÇÃO ENTRE PREVISÕES E FATURAS
//
// O mesmo custo pode entrar no ERP por dois caminhos: como previsão (um
// pagamento manual ou uma regra recorrente) e, mais tarde, como fatura no
// Contas a Pagar. Se os dois ficarem de pé, o mês conta o custo a dobrar.
//
// Aqui está a parte que não depende do ecrã: dada uma fatura, quais as
// ocorrências previstas que provavelmente são o mesmo custo. Quem decide é
// sempre quem está a lançar — isto só ordena os candidatos.
//
// Uma nota sobre o que é "uma ocorrência": não é a previsão inteira. Uma
// previsão de 4 parcelas são quatro ocorrências, e uma avença mensal é uma por
// mês. A fatura liga-se a UMA, e só essa sai do fluxo; as outras continuam de
// pé à espera das suas faturas.
// ─────────────────────────────────────────────────────────────────────────────

const DIA = 86400000;

export const palavrasChave = (t) => new Set(
  String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/).filter(w => w.length > 3)
);

const nDia = (iso) => {
  const s = String(iso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return new Date(s + "T00:00:00").getTime();
};

// A chave de uma ocorrência. É com ela que se sabe que esta parcela de abril já
// tem fatura e a de maio ainda não.
export const chaveOcorrencia = (origem, origemId, data) =>
  `${origem}|${origemId}|${String(data).slice(0, 10)}`;

// ── Ocorrências de uma previsão manual ───────────────────────────────────────
// Repete a expansão de parcelas do Fluxo Futuro, incluindo a forma como as
// datas são calculadas, porque a chave da ocorrência tem de ser exactamente a
// mesma dos dois lados — senão a baixa não apanha a linha certa.
export function ocorrenciasManual(p) {
  if (!p || !p.data_inicio) return [];
  const nParcelas = parseInt(p.parcelas) || 1;
  const inicio = new Date(p.data_inicio);
  if (isNaN(inicio.getTime())) return [];
  const valor = (parseFloat(p.valor) || 0) / nParcelas;
  const out = [];
  for (let i = 0; i < nParcelas; i++) {
    const d = new Date(inicio);
    if (p.periodicidade === "mensal") d.setMonth(d.getMonth() + i);
    else if (p.periodicidade === "trimestral") d.setMonth(d.getMonth() + i * 3);
    else if (p.periodicidade === "anual") d.setFullYear(d.getFullYear() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({
      data: `${key}-${String(d.getDate()).padStart(2, "0")}`,
      valor,
      ordem: i + 1,
      de: nParcelas,
      descricao: p.descricao + (nParcelas > 1 ? ` (${i + 1}/${nParcelas})` : ""),
    });
  }
  return out;
}

const PREVISAO_FECHADA = ["Paga", "Pago", "Convertida"];

/**
 * Pontua o quanto uma ocorrência prevista se parece com a fatura.
 * Pesa o valor (metade), a data e as palavras da descrição.
 * Devolve 0 a 1, e os motivos em texto para o ecrã poder explicar-se.
 */
export function pontuar(oc, fat) {
  const vp = Math.abs(parseFloat(oc.valor) || 0);
  const vf = Math.abs(parseFloat(fat.valor) || 0);
  const maior = Math.max(vp, vf, 1);
  const difRel = Math.abs(vp - vf) / maior;
  const sValor = Math.max(0, 1 - difRel * 4);            // zero se diferir >25%

  const dataFat = fat.previsao_pagamento || fat.vencimento;
  const a = nDia(oc.data), b = nDia(dataFat);
  let dias = null, sData = 0.5;
  if (a != null && b != null) {
    dias = Math.round(Math.abs(a - b) / DIA);
    sData = Math.max(0, 1 - dias / 90);                  // zero a partir de 3 meses
  }

  const pa = palavrasChave(oc.descricao);
  const pb = palavrasChave(`${fat.fornecedor || ""} ${fat.fatura || ""}`);
  let comuns = 0; pa.forEach(w => { if (pb.has(w)) comuns++; });
  const sTexto = pa.size ? Math.min(1, comuns / Math.min(pa.size, 3)) : 0;

  const motivos = [];
  if (difRel < 0.005) motivos.push("valor igual");
  else if (sValor > 0) motivos.push(`valor difere ${(difRel * 100).toFixed(1)}%`);
  if (dias === 0) motivos.push("mesma data");
  else if (dias != null && dias <= 31) motivos.push(`${dias} dia${dias === 1 ? "" : "s"} de diferença`);
  if (comuns > 0) motivos.push(`${comuns} palavra${comuns === 1 ? "" : "s"} em comum`);

  return { score: sValor * 0.5 + sData * 0.25 + sTexto * 0.25, dias, difRel, motivos };
}

/**
 * Previsões que podem ser o mesmo custo desta fatura.
 *
 * @param fat            a fatura a lançar (empresa, fornecedor, fatura, valor, vencimento, previsao_pagamento)
 * @param pagamentosExtras  previsões manuais
 * @param recorrentes    regras de despesa recorrente
 * @param baixas         ocorrências já ligadas a faturas
 * @param ocorrenciasDe  o gerador de ocorrências das regras recorrentes
 * @returns candidatos ordenados, do mais parecido ao menos
 */
export function candidatasParaFatura(fat, {
  pagamentosExtras = [], recorrentes = [], baixas = [], ocorrenciasDe,
  janelaDias = 120, minimo = 0.3, limite = 8,
} = {}) {
  if (!fat) return [];
  const dataFat = nDia(fat.previsao_pagamento || fat.vencimento);
  const jaBaixadas = new Set((baixas || []).map(b => chaveOcorrencia(b.origem, b.origem_id, b.data_ocorrencia)));
  const dentroDaJanela = (iso) => {
    const d = nDia(iso);
    if (d == null || dataFat == null) return true;
    return Math.abs(d - dataFat) <= janelaDias * DIA;
  };

  const cands = [];

  // ── Previsões manuais, parcela a parcela ──
  (pagamentosExtras || []).forEach(p => {
    if (p.tipo === "entrada") return;
    if (PREVISAO_FECHADA.includes(p.status)) return;
    if (fat.empresa && p.empresa && p.empresa !== fat.empresa) return;
    ocorrenciasManual(p).forEach(oc => {
      if (!dentroDaJanela(oc.data)) return;
      if (jaBaixadas.has(chaveOcorrencia("manual", p.id, oc.data))) return;
      const p2 = pontuar(oc, fat);
      if (p2.score < minimo) return;
      cands.push({
        origem: "manual", origemId: p.id, data: oc.data, valor: oc.valor,
        descricao: oc.descricao, categoria: p.categoria, subcategoria: p.subcategoria,
        parcela: oc.de > 1 ? `${oc.ordem}/${oc.de}` : null,
        registo: p, ...p2,
      });
    });
  });

  // ── Regras recorrentes, ocorrência a ocorrência ──
  if (typeof ocorrenciasDe === "function" && dataFat != null) {
    const de = new Date(dataFat - janelaDias * DIA).toISOString().slice(0, 10);
    const ate = new Date(dataFat + janelaDias * DIA).toISOString().slice(0, 10);
    (recorrentes || []).forEach(r => {
      if (r.ativa === false) return;
      if (r.tipo === "entrada") return;
      if (fat.empresa && r.empresa && r.empresa !== fat.empresa) return;
      let ocs = [];
      try { ocs = ocorrenciasDe(r, { de, ate }) || []; } catch { ocs = []; }
      ocs.forEach(oc => {
        if (jaBaixadas.has(chaveOcorrencia("recorrente", r.id, oc.data))) return;
        const p2 = pontuar(oc, fat);
        if (p2.score < minimo) return;
        cands.push({
          origem: "recorrente", origemId: r.id, data: oc.data, valor: oc.valor,
          descricao: oc.descricao, categoria: r.categoria, subcategoria: r.subcategoria,
          parcela: null, taxaIva: oc.taxaIva, registo: r, ...p2,
        });
      });
    });
  }

  // Uma regra recorrente geraria várias ocorrências parecidas (a de março e a
  // de abril custam o mesmo). Fica a melhor de cada previsão, para a lista não
  // encher de linhas iguais.
  const melhorPorOrigem = new Map();
  cands.forEach(c => {
    const k = `${c.origem}|${c.origemId}`;
    const atual = melhorPorOrigem.get(k);
    if (!atual || c.score > atual.score) melhorPorOrigem.set(k, c);
  });

  return [...melhorPorOrigem.values()].sort((a, b) => b.score - a.score).slice(0, limite);
}

/**
 * Ocorrências de despesas recorrentes que podem entrar num mapa de pagamentos.
 *
 * A avença do advogado tem de ser paga no dia 10 quer a fatura já tenha chegado
 * quer não. Antes só entravam no mapa coisas com fatura ou previsões manuais, e
 * as recorrentes ficavam de fora — alguém tinha de se lembrar delas à mão.
 *
 * Ficam de fora as que já têm fatura (essa é que entra, pelo Contas a Pagar).
 */
export function ocorrenciasParaMapa({
  recorrentes = [], baixas = [], ocorrenciasDe, de, ate,
} = {}) {
  if (typeof ocorrenciasDe !== "function") return [];
  const hoje = new Date();
  // Da primeira do mês corrente (uma avença do dia 5 ainda se paga no dia 20)
  // até dois meses à frente, que é o horizonte de um mapa de pagamentos.
  const inicio = de || `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-01`;
  const fim = ate || new Date(hoje.getTime() + 60 * DIA).toISOString().slice(0, 10);
  const jaBaixadas = new Set((baixas || []).map(b => chaveOcorrencia(b.origem, b.origem_id, b.data_ocorrencia)));

  const out = [];
  (recorrentes || []).forEach(r => {
    if (r.ativa === false) return;
    if (r.tipo === "entrada") return;             // mapas de pagamento são saídas
    let ocs = [];
    try { ocs = ocorrenciasDe(r, { de: inicio, ate: fim }) || []; } catch { ocs = []; }
    ocs.forEach(oc => {
      if (jaBaixadas.has(chaveOcorrencia("recorrente", r.id, oc.data))) return;
      out.push({
        regraId: r.id,
        // A chave é a OCORRÊNCIA: assim novembro e dezembro da mesma avença
        // são duas linhas distintas e cada uma segue o seu caminho.
        ocorrenciaId: `${r.id}@${String(oc.data).slice(0, 10)}`,
        data: String(oc.data).slice(0, 10),
        valor: oc.valor,
        descricao: oc.descricao,
        empresa: r.empresa || "",
        categoria: r.categoria || "",
        subcategoria: r.subcategoria || "",
        taxaIva: oc.taxaIva,
      });
    });
  });
  return out.sort((a, b) => a.data.localeCompare(b.data) || a.descricao.localeCompare(b.descricao));
}

// Desfaz a chave da ocorrência guardada no item do mapa.
export const partirOcorrenciaId = (id) => {
  const s = String(id || "");
  const i = s.lastIndexOf("@");
  return i < 0 ? { regraId: s, data: null } : { regraId: s.slice(0, i), data: s.slice(i + 1) };
};

// Acima deste valor vale a pena parar e perguntar; abaixo é ruído.
export const LIMIAR_AVISO = 0.45;

export const nivelDeConfianca = (score) =>
  score >= 0.8 ? "alta" : score >= LIMIAR_AVISO ? "média" : "baixa";

export default { candidatasParaFatura, pontuar, ocorrenciasManual, chaveOcorrencia, LIMIAR_AVISO };
