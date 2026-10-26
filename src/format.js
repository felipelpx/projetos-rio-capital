// Formatação numérica única para toda a aplicação.
// Formato pedido: €1.000,00 — ponto no milhar, vírgula no decimal, símbolo à
// frente. O locale "pt-PT" não serve: usa espaço fino como separador de milhar
// ("1 000,00"). O "pt-BR" produz exactamente "1.000,00".
const LOCALE = "pt-BR";

const nfCache = {};
const nf = (dec) => (nfCache[dec] ||= new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: dec,
  maximumFractionDigits: dec,
}));

// Número simples: 1.000,00
export const fmtNum = (v, dec = 2) => nf(dec).format(Number(v) || 0);

// Moeda: €1.000,00 / -€1.000,00 (sinal antes do símbolo)
export const fmtEuro = (v, dec = 2) => {
  const n = Number(v) || 0;
  return (n < 0 ? "-" : "") + "€" + nf(dec).format(Math.abs(n));
};

// Compacto para cartões: €1,25M / €12k / €340
export const fmtEuroK = (v) => {
  const n = Number(v) || 0, a = Math.abs(n), s = n < 0 ? "-" : "";
  if (a >= 1e6) return s + "€" + nf(2).format(a / 1e6) + "M";
  if (a >= 1000) return s + "€" + nf(0).format(a / 1000) + "k";
  return s + "€" + nf(0).format(a);
};

// Percentagem: 12,34%
export const fmtPercent = (v, dec = 2) => nf(dec).format(Number(v) || 0) + "%";

// Inteiros com milhares: 9.259
export const fmtInt = (v) => nf(0).format(Number(v) || 0);
