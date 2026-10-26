// Categorias e subcategorias do ERP.
// Fonte: Categorias.xlsx (definida pela equipa financeira).
// Só estas aparecem nas listas de escolha. Valores antigos já gravados
// continuam visíveis nos registos, marcados como "(antiga)".

export const CATEGORIAS = [
  "Aporte",
  "Cartão Crédito",
  "CSC (Lisbon)",
  "CSC (London)",
  "CSC (Madrid)",
  "Despesas Extras",
  "Devolução de Capital",
  "Internal Transfer",
  "Marketing",
  "Novos Negócios",
  "Project - Alenquer",
  "Project - Armazéns Sintra",
  "Project - Arroios",
  "Project - Avenida Living",
  "Project - Braamcamp",
  "Project - Casa da Marinha",
  "Project - Cruz da Pedra",
  "Project - Hotel Alqueva",
  "Project - Hotel Sesimbra",
  "Project - Machadinho",
  "Project - Others",
  "Project - Prédio Benfica",
  "Project - Vistas do Sul",
  "Resgate",
  "Saldo Final",
  "Receita",
];

// As subcategorias são uma lista única, independente da categoria: qualquer
// subcategoria pode ser usada com qualquer categoria.
export const SUBCATEGORIAS_LISTA = [
  "Accounting",
  "Acordo",
  "Aporte",
  "Aquisição",
  "Aquisição Carro",
  "Aquisição empresa",
  "Architect",
  "Bank Taxes",
  "Bônus",
  "Cartão Crédito",
  "CMVM",
  "Comissão",
  "Comissão Avaliação",
  "Comissão de Organização",
  "Comissões",
  "Condomínio",
  "Construction",
  "Consulting",
  "Consulting (IT)",
  "CPCV",
  "CTT",
  "Despesas Holding",
  "Devolução",
  "Devolução de Aporte",
  "Distribuição Lucro",
  "Empréstimo Interno",
  "Escritura",
  "Escritura (Legal Block)",
  "Estacionamento",
  "Fee Gestão",
  "Ferinha",
  "Financiamento",
  "Fiscalização Obra",
  "Fundo Investimento",
  "Gabriel Pereira",
  "GRI",
  "Henrique",
  "IMI",
  "IMPIC",
  "Imposto s/ folha",
  "Imposto selo (aquisição)",
  "Imposto selo (financiamento)",
  "IMT",
  "Internal Transfer",
  "IRC",
  "IRS",
  "IS",
  "IUC",
  "IVA",
  "Juros Financiamento",
  "Legal",
  "Levantamento",
  "Marcelo",
  "Marcia",
  "Marketing",
  "Mútuo",
  "Notário / Registros",
  "Novos Negócios",
  "Office (Lisbon)",
  "Office (London)",
  "Office (Madrid)",
  "Office Expenses",
  "Others",
  "Pagamento dívida interna",
  "Performance Marketing",
  "Rendimentos",
  "Revenue",
  "Salary",
  "Saldo Final",
  "Seguro",
  "Seguro Financiamento",
  "Sinal Entrada",
  "Softwares & Tools",
  "Storage",
  "Taxes",
  "Taxes - Cam Municipal",
  "Transporte mensal Ferinha",
  "Travel & Meals - Combustivel",
  "Travel & Meals - Hotel",
  "Travel & Meals - Others",
  "Travel & Meals - Passagens",
  "Travel & Meals - Portagens",
  "Travel & Meals - Restaurantes",
  "Travel & Meals - Transporte",
  "Utilities",
];

// Mantém a forma { categoria: [subcategorias] } que os ecrãs já usam — cada
// categoria aponta para a lista completa.
// "Receita" é a exceção: mostra só as subcategorias de receita, para não se
// escolher por engano uma subcategoria de custo numa entrada.
export const SUBCATEGORIAS_RECEITA = ["Comissão", "Fee Gestão", "CPCV", "Escritura", "Rendimentos"];

export const SUBCATEGORIAS = Object.fromEntries(CATEGORIAS.map(c =>
  [c, c === "Receita" ? SUBCATEGORIAS_RECEITA : SUBCATEGORIAS_LISTA]
));

// Categorias usadas antes de 2026. Continuam a aparecer nos movimentos
// históricos (para não os alterar), mas NÃO entram nas listas de escolha.
export const CATEGORIAS_LEGADO = [
  // ─── Operacional / despesas correntes ───
  "Administrativos",
  "Contabilidade",
  "ERP",
  "Sistema",
  "Marketing",
  "Despesa com Marketing Institucional",
  "Salários",
  "Ticket Refeição",
  "Imposto sobre folha",
  "Cartão de Crédito",
  "Carregamento de saldo",
  "Transporte",
  "Viagens",
  "Estornos e Reembolsos",

  // ─── Obra e projetos ───
  "Obra",
  "Projetos",
  "Projetos/Soft Costs",
  "Fiscalização",
  "Legais",
  "Aquisição",
  "Terreno",
  "IVA construção",
  "Novos Negócios",

  // ─── CSC (Centros de Serviços Compartilhados) ───
  "CSC",
  "CSC Madrid",
  "CSC Londres",
  "Novos Negócios Madrid",
  "Novos Negócios UK",
  "Transporte Madrid",
  "Transporte UK",

  // ─── Comissões e gestão ───
  "Comissão",
  "Despesa com Comissão",
  "Fee Gestão",

  // ─── Encargos financeiros ───
  "Encargos financeiros",
  "Impostos e taxas",
  "Juros",
  "Amortização",
  "Funding",
  "Mútuo",

  // ─── Aportes / Resgates / Capital ───
  "Aporte RC",
  "Aporte Investidores",
  "Aporte SPV",
  "Aporte de Capital HSP",
  "Resgate RC",
  "Resgate Investidores",
  "Resgate SPV",
  "Dividendos",

  // ─── Sócios (movimentos pessoais identificados) ───
  "Henrique",
  "Marcelo",
  "Márcia Coelho",

  // ─── Receitas ───
  "Receita Cambial",
  "Receita de Comissões",
  "Receita de Rendas",
  "Receita de Rendimentos Financeiros",
  "Receita de Venda de Projeto",
  "Receita de Venda de Unidades",
  "Receita de Operações",
  "Vendas",
  "Recebimento",

  // ─── Outros ───
  "Ajuste",
  "Ajuste Contábil",
  "Outro",
];

// Junta as duas listas: usa-se apenas para mostrar um valor já gravado que
// não conste das categorias atuais.
export const CATEGORIAS_TODAS = [...CATEGORIAS, ...CATEGORIAS_LEGADO];

export const CATEGORIAS_FATURA = CATEGORIAS.filter(c =>
  !["Aporte RC", "Aporte Investidores", "Aporte SPV", "Aporte de Capital HSP",
    "Resgate RC", "Resgate Investidores", "Resgate SPV", "Dividendos",
    "Henrique", "Marcelo", "Márcia Coelho",
    "Receita Cambial", "Receita de Comissões", "Receita de Rendas",
    "Receita de Rendimentos Financeiros", "Receita de Venda de Projeto",
    "Receita de Venda de Unidades", "Receita de Operações",
    "Vendas", "Recebimento"].includes(c)
);
