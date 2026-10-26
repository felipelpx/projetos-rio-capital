// Planos de negócio (estudo de viabilidade) e acompanhamento real × orçado.
// Ficam num módulo próprio para que o Real × Orçado e o BI leiam os mesmos
// números — se divergirem, o BI deixa de ser fiável.
// ─── REAL x ORCADO DATA (Vistas do Sul) ───────────────────────────────────────
export const REAL_ORCADO_VISTAS = [
  { categoria:"VENDAS LÍQUIDAS",         grupo:"receita",   orcado:13353916.5,    realizado:10109277.03, a_realizar:-162196.17 },
  { categoria:"Vendas",                  grupo:"receita",   orcado:14229000,      realizado:10420750,    a_realizar:0 },
  { categoria:"Comissão",                grupo:"receita",   orcado:-875083.5,     realizado:-311472.97,  a_realizar:0 },
  { categoria:"Terreno",                 grupo:"capex",     orcado:-2265000,      realizado:-2260455,    a_realizar:0 },
  { categoria:"Impostos e taxas",        grupo:"capex",     orcado:-19125,        realizado:-186609.92,  a_realizar:0 },
  { categoria:"Encargos financeiros",    grupo:"capex",     orcado:-268393.34,    realizado:-17604.28,   a_realizar:0 },
  { categoria:"Juros",                   grupo:"capex",     orcado:-421616.72,    realizado:-179076.42,  a_realizar:0 },
  { categoria:"Fiscalização",            grupo:"capex",     orcado:-61500,        realizado:-81051.67,   a_realizar:-2500 },
  { categoria:"Projetos/Soft Costs",     grupo:"capex",     orcado:-145645,       realizado:-286324.99,  a_realizar:0 },
  { categoria:"Obra (total)",            grupo:"capex",     orcado:-6150000,      realizado:-4891739.25, a_realizar:-157851.17 },
  { categoria:"Obra @ Lote 16",          grupo:"obra",      orcado:0,             realizado:-1722494.38, a_realizar:-9430 },
  { categoria:"Obra @ Lote 17",          grupo:"obra",      orcado:0,             realizado:-2165662.49, a_realizar:-90041.63 },
  { categoria:"Obra @ Lote 22",          grupo:"obra",      orcado:0,             realizado:0,           a_realizar:-51200 },
  { categoria:"Legais",                  grupo:"opex",      orcado:-63960,        realizado:-50366.54,   a_realizar:0 },
  { categoria:"Administrativos",         grupo:"opex",      orcado:-162975,       realizado:-87177.99,   a_realizar:-1845 },
  { categoria:"Fee Gestão",              grupo:"opex",      orcado:-350033,       realizado:-222630,     a_realizar:0 },
  { categoria:"Marketing",               grupo:"opex",      orcado:-75030,        realizado:-96011.80,   a_realizar:0 },
  { categoria:"Lucro Tributável",        grupo:"resultado", orcado:3370638.44,    realizado:0,           a_realizar:0 },
  { categoria:"IRC (est.)",              grupo:"resultado", orcado:-758393.65,    realizado:0,           a_realizar:-351467.95 },
  { categoria:"Lucro Líquido",           grupo:"resultado", orcado:2612244.79,    realizado:0,           a_realizar:0 },
];

export const REAL_ORCADO_PROJECTS = [
  { id:"vistas",    nome:"Vistas do Sul",          dados: REAL_ORCADO_VISTAS },
];

