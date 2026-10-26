// ─────────────────────────────────────────────────────────────────────────────
// DESPESAS RECORRENTES
//
// A contabilidade, a avença do advogado, o seguro: despesas que se repetem até
// alguém as parar. Antes criavam-se à mão no Fluxo Futuro, uma previsão por
// mês — e parar uma obrigava a apagar dezenas de linhas.
//
// Aqui guarda-se a REGRA, não as linhas: empresa, valor, IVA, com que
// frequência, desde quando e até quando. O Fluxo Futuro expande-a ao desenhar.
// Mudar a data limite pára a despesa num sítio só.
//
// Consequência deliberada: uma ocorrência não se edita à parte. Quem precisar
// de mexer num mês em concreto lança uma previsão normal no Fluxo Futuro, que
// é o sítio das exceções.
// ─────────────────────────────────────────────────────────────────────────────

export const PERIODICIDADES = [
  { v: "mensal",     r: "Mensal",      meses: 1 },
  { v: "bimestral",  r: "Bimestral",   meses: 2 },
  { v: "trimestral", r: "Trimestral",  meses: 3 },
  { v: "semestral",  r: "Semestral",   meses: 6 },
  { v: "anual",      r: "Anual",       meses: 12 },
];

// As taxas em vigor em Portugal continental. "Isento" é 0 — continua a ser uma
// despesa, só não tem imposto.
export const TAXAS_IVA = [
  { taxa: 23, rotulo: "23% — normal" },
  { taxa: 13, rotulo: "13% — intermédia" },
  { taxa: 6,  rotulo: "6% — reduzida" },
  { taxa: 0,  rotulo: "0% — isento" },
];

export const MESES_DE = (p) =>
  PERIODICIDADES.find(x => x.v === String(p || "").toLowerCase())?.meses || 1;

export const rotuloPeriodicidade = (p) =>
  PERIODICIDADES.find(x => x.v === String(p || "").toLowerCase())?.r || "Mensal";

const arred2 = (v) => Math.round(((Number(v) || 0) + Number.EPSILON) * 100) / 100;
const ehISO = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || "").slice(0, 10));

export function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Do banco sai o valor COM IVA — é esse que conta no fluxo de caixa. O valor
// base fica guardado à parte, porque é o que interessa ao custo do projeto.
export const valorComIva = (base, taxa) =>
  arred2((Number(base) || 0) * (1 + (Number(taxa) || 0) / 100));

export const ivaDe = (base, taxa) =>
  arred2((Number(base) || 0) * ((Number(taxa) || 0) / 100));

// Somar meses a uma data SEM a armadilha clássica do Date: 31 de janeiro mais
// um mês dava 3 de março, porque fevereiro não tem 31. Uma avença lançada a 31
// tem de cair no último dia do mês curto, não saltar para o mês seguinte.
export function somarMesesData(iso, n) {
  const [a, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  const alvoMes = m - 1 + n;
  const ano = a + Math.floor(alvoMes / 12);
  const mes = ((alvoMes % 12) + 12) % 12;
  const ultimoDia = new Date(ano, mes + 1, 0).getDate();
  const dia = Math.min(d, ultimoDia);
  return `${ano}-${String(mes + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

// Teto de segurança: uma regra sem data limite não pode gerar para sempre.
const LIMITE_OCORRENCIAS = 600;

/**
 * As datas em que uma regra acontece dentro de uma janela.
 *
 * @param regra   a linha de despesas_recorrentes
 * @param janela  { de, ate } em ISO — normalmente o horizonte do fluxo
 * @returns [{ data, valor, valorBase, iva, descricao, ordem }] por ordem cronológica
 */
export function ocorrenciasDe(regra, { de, ate } = {}) {
  if (!regra || regra.ativa === false) return [];
  if (!ehISO(regra.data_inicio)) return [];

  const passo = MESES_DE(regra.periodicidade);
  const base = arred2(regra.valor);
  if (!(Math.abs(base) > 0.005)) return [];

  const taxa = Number(regra.taxa_iva) || 0;
  const total = valorComIva(base, taxa);
  const iva = ivaDe(base, taxa);

  // A regra pára no mais cedo de: a sua data limite, ou o fim da janela.
  const fimRegra = ehISO(regra.data_fim) ? String(regra.data_fim).slice(0, 10) : null;
  const fimJanela = ehISO(ate) ? String(ate).slice(0, 10) : null;
  const limite = fimRegra && fimJanela ? (fimRegra < fimJanela ? fimRegra : fimJanela)
                                       : (fimRegra || fimJanela);
  const inicioJanela = ehISO(de) ? String(de).slice(0, 10) : null;

  const out = [];
  for (let i = 0; i < LIMITE_OCORRENCIAS; i++) {
    const data = somarMesesData(regra.data_inicio, i * passo);
    if (limite && data > limite) break;
    // Sem data limite E sem janela não há onde parar — gera-se uma só, para
    // não produzir linhas até ao infinito. Com janela (é o caso do fluxo), a
    // regra continua até ao fim do horizonte desenhado.
    if (!limite && i > 0) break;
    if (inicioJanela && data < inicioJanela) continue;
    out.push({
      data,
      valor: total,            // o que sai do banco
      valorBase: base,         // sem IVA
      iva,
      taxaIva: taxa,
      descricao: regra.descricao || "Despesa recorrente",
      ordem: i + 1,
    });
  }
  return out;
}

// Quantas vezes a regra ainda acontece a partir de hoje e quanto custa até ao
// fim. Serve para o ecrã dizer "faltam 14 × 150 € = 2.100 €" em vez de obrigar
// quem está a lançar a fazer a conta de cabeça.
// Horizonte usado para resumir uma regra sem data limite: o mesmo que o Fluxo
// Futuro desenha, para o número no ecrã bater com o que se vê lá.
const MESES_HORIZONTE = 36;

export function resumoDaRegra(regra, hoje) {
  const ref = ehISO(hoje) ? String(hoje).slice(0, 10) : hojeISO();
  const semFim = !ehISO(regra?.data_fim);
  const ate = semFim ? somarMesesData(ref, MESES_HORIZONTE) : String(regra.data_fim).slice(0, 10);
  const oc = ocorrenciasDe(regra, { de: ref, ate });
  return {
    porVir: oc.length,
    total: arred2(oc.reduce((s, o) => s + o.valor, 0)),
    totalBase: arred2(oc.reduce((s, o) => s + o.valorBase, 0)),
    totalIva: arred2(oc.reduce((s, o) => s + o.iva, 0)),
    semFim,
    proxima: oc[0]?.data || null,
    ultima: oc.length ? oc[oc.length - 1].data : null,
  };
}

// Validação antes de gravar. Devolve a lista de problemas, vazia quando está
// tudo bem — o ecrã mostra-os em vez de gravar uma regra que não faz nada.
export function validarRegra(r) {
  const erros = [];
  if (!r?.empresa) erros.push("Falta a empresa.");
  if (!String(r?.descricao || "").trim()) erros.push("Falta a descrição.");
  if (!(Math.abs(Number(r?.valor) || 0) > 0.005)) erros.push("O valor tem de ser diferente de zero.");
  if (!ehISO(r?.data_inicio)) erros.push("Falta a data de início.");
  if (r?.data_fim && !ehISO(r.data_fim)) erros.push("A data limite não é uma data válida.");
  if (ehISO(r?.data_inicio) && ehISO(r?.data_fim) &&
      String(r.data_fim).slice(0, 10) < String(r.data_inicio).slice(0, 10))
    erros.push("A data limite é anterior à de início.");
  const taxa = Number(r?.taxa_iva);
  if (r?.taxa_iva !== "" && r?.taxa_iva != null && (!Number.isFinite(taxa) || taxa < 0 || taxa > 100))
    erros.push("A taxa de IVA tem de estar entre 0 e 100.");
  return erros;
}

export default { ocorrenciasDe, resumoDaRegra, validarRegra, PERIODICIDADES, TAXAS_IVA };
