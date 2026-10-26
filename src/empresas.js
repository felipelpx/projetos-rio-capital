// Fonte única das empresas do grupo: nome, NIPC, projeto e contas bancárias.
// Fica fora do App.jsx para que qualquer ecrã (Pagamentos, Importar, …) possa
// traduzir um id interno ("barramansa") no rótulo que o utilizador conhece
// ("BM Global Capital (Holding UK)") sem duplicar listas que depois divergem.
export const EMPRESAS = [
  { id:"riocap",     nome:"Rio Capital",           nipc:"514978880",       projeto:"CSC",
    contas:[
      { id:"riocap_cc",           banco:"Cartão de Crédito", iban:"", saldo:0,          sheet:"Rio Capital CC Millennium" },
      { id:"riocap_bcp",          banco:"BCP",           iban:"", saldo:5640.37,     sheet:"Rio Capital BCP"            },
    ]},
  { id:"decadex",    nome:"Decadexperience",       nipc:"514994274",       projeto:"Av. Living",
    contas:[
      { id:"decadex_bcp",         banco:"BCP",           iban:"", saldo:5457.22,     sheet:"Decadexperience - BCP"      },
    ]},
  { id:"barramansa", nome:"BM Global Capital",     nipc:"BM-01",           projeto:"Holding UK",
    contas:[
      { id:"barramansa_banco_invest", banco:"Banco Invest", iban:"", saldo:2867.30,  sheet:"BM HOLDING Banco Invest"    },
      { id:"barramansa_miami_eua",    banco:"Miami/EUA",    iban:"", saldo:400766.73,sheet:"BM HOLDING Miami"           },
      { id:"barramansa_revolut",      banco:"Revolut",      iban:"", saldo:32330.71, sheet:"BM Revolut"                 },
      { id:"barramansa_bni",          banco:"BNI",          iban:"", saldo:0,        sheet:"BM HOLDING BNI"            },
      { id:"barramansa_bb_americas",  banco:"BB Americas",  iban:"", saldo:10642.88, sheet:"BM HOLDING BBAmericas"      },
    ]},
  { id:"curious",    nome:"Curious",               nipc:"517700212",       projeto:"Alqueva",
    contas:[
      { id:"curious_bcp",         banco:"BCP",           iban:"", saldo:1016.16,     sheet:"Curious Euphory BCP"        },
    ]},
  { id:"modernity",  nome:"Modernity",             nipc:"516668218",       projeto:"Vistas do Sul",
    contas:[
      { id:"modernity_bcp",       banco:"BCP",           iban:"", saldo:377383.94,   sheet:"Modernity BCP"              },
    ]},
  { id:"wodelay",    nome:"Without Delays",        nipc:"518282694",       projeto:"Braamcamp",
    contas:[
      { id:"wodelay_bcp",         banco:"BCP",           iban:"", saldo:1811.02,     sheet:"Without Delays BCP"         },
    ]},
  { id:"nimitz",     nome:"Nimitz Holdco",         nipc:"980617880",       projeto:"Holding Malta",
    contas:[
      { id:"nimitz_banco_atlântico", banco:"Banco Atlântico", iban:"", saldo:304.16, sheet:"Nimitz BAE"                 },
      { id:"nimitz_revolut",         banco:"Revolut",         iban:"", saldo:1232.08,sheet:"Nimitz Revolut"             },
      { id:"nimitz_miami_eua",       banco:"Miami/EUA",       iban:"", saldo:47446.63,sheet:"Nimitz Miami"              },
    ]},
  { id:"shadow",     nome:"Alternative Shadow",    nipc:"516554050",       projeto:"Arroios",
    contas:[
      { id:"shadow_bcp",          banco:"BCP",           iban:"", saldo:5945.53,     sheet:"Alternative Shadow BCP"     },
    ]},
  { id:"classic",    nome:"Classic Revelation",    nipc:"517197294",       projeto:"Casa Quinta da Marinha",
    contas:[
      { id:"classic_bni",         banco:"BNI",           iban:"PT50 0191 0000 0366 1654 1011 3", saldo:346298.24, sheet:"CLASSIC REVELATION BNI"},
    ]},
  { id:"chromatic",  nome:"Chromatic Parcel",      nipc:"517196115",       projeto:"Benfica",
    contas:[
      { id:"chromatic_bni",       banco:"BNI",           iban:"", saldo:0,           sheet:"Chromatic Parcel BNI"      },
    ]},
  { id:"crunchy",    nome:"Crunchy Prophecy",      nipc:"517200805",       projeto:"Armazéns Sintra",
    contas:[
      { id:"crunchy_bni",         banco:"BNI",           iban:"", saldo:0,           sheet:"Crunchy Prophecy BNI"      },
    ]},
  { id:"enigma",     nome:"Enigmimperdível",       nipc:"",                projeto:"Machadinho 28",
    contas:[
      { id:"enigma_mbcp",         banco:"MBCP",          iban:"", saldo:0,           sheet:"Enigmimperdivel MBCP"      },
    ]},
];

export const EMPRESAS_POR_ID = Object.fromEntries(EMPRESAS.map(e => [e.id, e]));

// Rótulo "Nome (Projeto)". Aceita o id, o nome ou o nome do projeto — as
// comissões de venda guardam o projeto onde as faturas guardam o id.
export function labelEmpresa(v) {
  if (!v) return "(sem empresa)";
  const e = EMPRESAS_POR_ID[v] || EMPRESAS.find(x => x.nome === v || x.projeto === v);
  if (!e) return v;
  return e.projeto ? `${e.nome} (${e.projeto})` : e.nome;
}

// Lista simplificada para os ecrãs que só precisam de id + rótulo
export const EMPRESAS_OPCOES = EMPRESAS.map(e => ({ id: e.id, nome: labelEmpresa(e.id) }));
