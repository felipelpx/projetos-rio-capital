import React, { useState, useEffect, useMemo } from "react";
import ImportarExtrato from "./ImportarExtrato.jsx";
import ImportarFatura from "./ImportarFatura.jsx";
import FluxoFuturo from "./FluxoFuturo.jsx";
import ExtratosView from "./ExtratosView.jsx";
import { useAuth, useContas, useFaturas, usePagamentosExtras, useOrcamento, useMovimentosCounts, useProfiles, useEntidades, useItensEmMapa, useDespesasRecorrentes, usePrevisoesBaixas } from "./hooks.js";
import { candidatasParaFatura, chaveOcorrencia, LIMIAR_AVISO, nivelDeConfianca } from "./conciliacao.js";
import { ocorrenciasDe } from "./recorrentes.js";
import { supabase } from "./supabase.js";
import ComercialView from "./ComercialView.jsx";
import EntidadesView from "./EntidadesView.jsx";
import PagamentosView from "./PagamentosView.jsx";
import BIView from "./BIView.jsx";
import CaixaUnicoView from "./CaixaUnicoView.jsx";
import { CATEGORIAS, SUBCATEGORIAS } from "./categorias.js";
import { STATUS_FATURA, STATUS_MANUAIS, STATUS_STYLES, FORMAS_PAGAMENTO, statusFatura, faturaPaga, faturaAtrasada } from "./status.js";
import { EMPRESAS, labelEmpresa } from "./empresas.js";

// Versão publicada — aparece ao lado do título, para se saber logo que
// pacote está no ar. Atualizar a cada entrega.
const VERSAO_ERP = "v136";
import { REAL_ORCADO_PROJECTS } from "./planos.js";
import { fmtEuro, fmtEuroK, fmtNum, fmtInt, fmtPercent } from "./format.js";

const ROLE_LABELS = { admin: "Administrador", gestor: "Gestor", viewer: "Visualizador" };
const ROLE_COLORS = { admin: "#dc2626", gestor: "#2563eb", viewer: "#16a34a" };

// ─── EMPRESAS DATA ────────────────────────────────────────────────────────────

// ─── CONTAS A PAGAR ───────────────────────────────────────────────────────────
const INITIAL_FATURAS = [
  { id:"f001", empresa:"modernity", projeto:"Vistas do Sul", fatura:"INV-2026-089", fornecedor:"A1V2 - Fiscalização", categoria:"Fiscalização", tipo_projeto:"Residencial", valor:6765.00, vencimento:"2026-04-30", status:"Pendente", obs:"Fiscalização Abril Lote 17" },
  { id:"f002", empresa:"classic",   projeto:"Quinta da Marinha", fatura:"FT 2026 149", fornecedor:"Atelier Arq. Lisboa", categoria:"Projetos/Soft Costs", tipo_projeto:"Residencial", valor:10000.00, vencimento:"2026-04-15", status:"Paga", obs:"Projecto de Arquitectura" },
  { id:"f004", empresa:"barramansa",projeto:"BM", fatura:"BM-ADM-04", fornecedor:"Contabilidade Mensal", categoria:"Administrativos", tipo_projeto:"CSC", valor:1200.00, vencimento:"2026-04-20", status:"Vencida", obs:"Contabilidade Abril BM" },
  { id:"f005", empresa:"modernity", projeto:"Vistas do Sul", fatura:"OBR-L17-004", fornecedor:"Classikmarathon Lda", categoria:"Obra", tipo_projeto:"Residencial", valor:23062.35, vencimento:"2026-05-01", status:"Pendente", obs:"4ª medição lote 17" },
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const fmt = (v) => fmtEuro(v);
const fmtK = (v) => fmtEuroK(v);
// Formata "2026-04-30" → "30-04-2026". Se vier inválido, devolve string original.
const fmtDate = (s) => {
  if (!s || typeof s !== "string" || s.length < 10) return s || "";
  const m = s.substring(0,10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
};
const pct = (r,o) => (!o||o===0) ? null : ((r/o)*100);

const BANCO_COLORS = { "Millennium":"#e84393","BNI":"#0057b7","BB Americas":"#c8a500","Eurobic":"#e74c3c","Revolut":"#6772e5","CGD":"#00a859","NovoBanco":"#ff6200","Banco Invest":"#1e3a6e","BAE":"#6c3483","BCP":"#002fa7","Millennium 2":"#c0399d" };
const GRUPO_COLORS = { receita:"#16a34a", capex:"#dc2626", obra:"#b45309", opex:"#7c3aed", resultado:"#0891b2" };

// ─── UI ATOMS ────────────────────────────────────────────────────────────────
const Chip = ({text,color}) => <span style={{background:color+"18",color,border:`1px solid ${color}33`,fontSize:10,padding:"2px 8px",borderRadius:4,fontFamily:"monospace",fontWeight:500,whiteSpace:"nowrap"}}>{text}</span>;
const StatusPill = ({status}) => { const s=STATUS_STYLES[status]||{}; return <span style={{background:s.bg,color:s.text,border:`1px solid ${s.border}`,fontSize:11,padding:"3px 11px",borderRadius:20,fontFamily:"monospace",fontWeight:500}}>{status}</span>; };
const BancoChip = ({banco}) => <Chip text={banco} color={BANCO_COLORS[banco]||"#888"} />;
const Card = ({children,style={}}) => <div style={{background:"#fff",border:"1px solid #f0f0f0",borderRadius:14,padding:20,...style}}>{children}</div>;
const SectionTitle = ({children}) => <div style={{fontSize:15,fontWeight:700,color:"#1a1a2e",fontFamily:"'Georgia',serif",marginBottom:14}}>{children}</div>;

// ─── LOGIN ────────────────────────────────────────────────────────────────────
function Login({onLogin}) {
  const [email,setEmail]=useState("");
  const [senha,setSenha]=useState("");
  const [erro,setErro]=useState("");
  const [loading,setLoading]=useState(false);

  const submit = async () => {
    setLoading(true); setErro("");
    // Antes qualquer falha aparecia como "Email ou senha incorretos", o que
    // escondia limites de tentativas, falhas de rede e email por confirmar.
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: (email || "").trim().toLowerCase(),
        password: senha,
      });
      if (!error) return;
      const m = (error.message || "").toLowerCase();
      if (m.includes("invalid login")) setErro("Email ou senha incorretos");
      else if (m.includes("rate limit") || m.includes("too many"))
        setErro("Demasiadas tentativas seguidas. Espera cerca de 15 minutos e tenta de novo.");
      else if (m.includes("not confirmed")) setErro("Este email ainda não foi confirmado.");
      else if (m.includes("failed to fetch") || m.includes("network"))
        setErro("Sem ligação ao servidor. Verifica a internet e tenta de novo.");
      else setErro(error.message);
      setLoading(false);
    } catch (e) {
      setErro("Erro inesperado: " + (e?.message || e));
      setLoading(false);
    }
  };

  return (
    <div style={{minHeight:"100vh",background:"#0f0f1a",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"Georgia,sans-serif"}}>
      <div style={{background:"#fff",borderRadius:20,padding:48,width:420,boxShadow:"0 24px 80px rgba(0,0,0,0.4)"}}>
        <div style={{textAlign:"center",marginBottom:36}}>
          <img src="/logo-rio.png" alt="Rio Capital" className="logo-rio"
            style={{height:78,width:"auto",display:"block",margin:"0 auto"}} />
          <div style={{fontSize:12,color:"#bbb",marginTop:4,letterSpacing:"0.1em"}}>GESTÃO IMOBILIÁRIA · ERP</div>
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <div>
            <label style={{fontSize:11,color:"#aaa",textTransform:"uppercase",letterSpacing:"0.07em",fontFamily:"monospace"}}>Email</label>
            <input value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} type="email"
              style={{display:"block",width:"100%",marginTop:5,background:"#f8f8f8",border:"1px solid #eee",borderRadius:10,padding:"12px 14px",fontSize:14,color:"#333",outline:"none",boxSizing:"border-box"}}/>
          </div>
          <div>
            <label style={{fontSize:11,color:"#aaa",textTransform:"uppercase",letterSpacing:"0.07em",fontFamily:"monospace"}}>Senha</label>
            <input value={senha} onChange={e=>setSenha(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} type="password"
              style={{display:"block",width:"100%",marginTop:5,background:"#f8f8f8",border:"1px solid #eee",borderRadius:10,padding:"12px 14px",fontSize:14,color:"#333",outline:"none",boxSizing:"border-box"}}/>
          </div>
          {erro&&<div style={{fontSize:12,color:"#dc2626",background:"#fef2f2",padding:"8px 12px",borderRadius:8,textAlign:"center"}}>{erro}</div>}
          <button onClick={submit} disabled={loading}
            style={{background:"#1a1a2e",color:"#fff",border:"none",padding:"14px",borderRadius:10,fontSize:14,fontWeight:700,cursor:"pointer",marginTop:4,opacity:loading?0.7:1}}>
            {loading?"A entrar...":"Entrar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Ecrã de arranque. Ao fim de alguns segundos oferece uma saída: se a sessão
// guardada no browser estiver corrompida (por exemplo depois de usar uma das
// páginas utilitárias), limpar e voltar ao login resolve.
function EcraCarregar() {
  const [demora, setDemora] = React.useState(false);
  React.useEffect(() => {
    const t = setTimeout(() => setDemora(true), 6000);
    return () => clearTimeout(t);
  }, []);
  const limpar = async () => {
    try { await supabase.auth.signOut(); } catch (e) { /* ignorado */ }
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith("sb-") || k.includes("supabase"))
        .forEach(k => localStorage.removeItem(k));
    } catch (e) { /* ignorado */ }
    location.reload();
  };
  return (
    <div style={{ minHeight: "100vh", background: "#0f0f1a", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18 }}>
      <div style={{ color: "#C8A96E", fontSize: 18, fontFamily: "Georgia,serif" }}>A carregar...</div>
      {demora && (
        <>
          <div style={{ color: "#8a8a96", fontSize: 12, textAlign: "center", maxWidth: 380, lineHeight: 1.6 }}>
            Está a demorar mais do que o normal. Pode ser a ligação, ou uma sessão
            antiga guardada neste browser.
          </div>
          <button onClick={limpar}
            style={{ background: "#C8A96E", border: "none", color: "#0f0f1a", padding: "10px 20px", borderRadius: 8, fontSize: 13, cursor: "pointer", fontWeight: 700 }}>
            Limpar sessão e voltar ao login
          </button>
        </>
      )}
    </div>
  );
}

// ─── REAL x ORCADO ────────────────────────────────────────────────────────────
function RealOrcado() {
  const [projetoId,setProjetoId] = useState("vistas");
  const projeto = REAL_ORCADO_PROJECTS.find(p=>p.id===projetoId);

  const receitas = projeto.dados.filter(d=>d.grupo==="receita"&&d.categoria!=="VENDAS LÍQUIDAS");
  const totalRec = receitas.reduce((s,d)=>s+d.realizado,0);
  const totalOrcRec = receitas.reduce((s,d)=>s+d.orcado,0);

  const despesas = projeto.dados.filter(d=>["capex","obra","opex"].includes(d.grupo));
  const totalDesp = despesas.reduce((s,d)=>s+d.realizado,0);
  const totalOrcDesp = despesas.reduce((s,d)=>s+d.orcado,0);

  const resultado = projeto.dados.find(d=>d.categoria==="Lucro Líquido");

  const GrupoTag = ({grupo}) => {
    const labels = {receita:"Receita",capex:"CapEx",obra:"Obra",opex:"OpEx",resultado:"Resultado"};
    return <Chip text={labels[grupo]||grupo} color={GRUPO_COLORS[grupo]||"#888"} />;
  };

  const ProgressBar = ({realizado,orcado,color}) => {
    const p = orcado!==0 ? Math.min(Math.abs(realizado/orcado)*100,120) : 0;
    const over = p>100;
    return (
      <div style={{width:"100%",height:6,background:"#f0f0f0",borderRadius:3,overflow:"hidden",marginTop:4}}>
        <div style={{width:`${Math.min(p,100)}%`,height:"100%",background:over?"#dc2626":color||"#3b82f6",borderRadius:3,transition:"width 0.5s ease"}}/>
      </div>
    );
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      {/* Project selector */}
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {REAL_ORCADO_PROJECTS.map(p=>(
          <button key={p.id} onClick={()=>setProjetoId(p.id)}
            style={{background:projetoId===p.id?"#1a1a2e":"#fff",color:projetoId===p.id?"#fff":"#666",border:`1px solid ${projetoId===p.id?"#1a1a2e":"#e0e0e0"}`,padding:"8px 20px",borderRadius:8,fontSize:13,cursor:"pointer",fontWeight:projetoId===p.id?700:400}}>
            {p.nome}
          </button>
        ))}
      </div>

      {/* KPI row */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14}}>
        {[
          {label:"Vendas Realizadas",     value:totalRec,       color:"#16a34a"},
          {label:"Vendas Orçadas",        value:totalOrcRec,    color:"#888"},
          {label:"Custos Realizados",     value:totalDesp,      color:"#dc2626"},
          {label:"Lucro Líquido (Orç.)",  value:resultado?.orcado||0, color:"#0891b2"},
        ].map((k,i)=>(
          <div key={i} style={{background:"#fff",border:"1px solid #f0f0f0",borderRadius:12,padding:"16px 18px",borderTop:`3px solid ${k.color}`}}>
            <div style={{fontSize:10,color:"#aaa",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6,fontFamily:"monospace"}}>{k.label}</div>
            <div style={{fontSize:18,fontWeight:700,color:k.color,fontFamily:"monospace"}}>{fmtK(k.value)}</div>
          </div>
        ))}
      </div>

      {/* Main table */}
      <Card>
        <SectionTitle>Real × Orçado — {projeto.nome}</SectionTitle>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead>
              <tr style={{background:"#f8f9fc"}}>
                {["Categoria","Grupo","Orçado","Realizado","A Realizar","Forecast","% Real.","Desvio"].map(h=>(
                  <th key={h} style={{padding:"10px 14px",textAlign:"left",color:"#aaa",fontSize:10,letterSpacing:"0.08em",textTransform:"uppercase",fontFamily:"monospace",borderBottom:"1px solid #f0f0f0",whiteSpace:"nowrap"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {projeto.dados.map((row,i)=>{
                const forecast = row.realizado + (row.a_realizar||0);
                const p = pct(row.realizado, row.orcado);
                const desvio = row.realizado - row.orcado;
                const isTotal = ["VENDAS LÍQUIDAS","DESPESAS TOTAIS","Lucro Tributável","Lucro Líquido"].includes(row.categoria);
                return (
                  <tr key={i} style={{borderBottom:"1px solid #fafafa",background:isTotal?"#f8f9fc":""}}
                    onMouseEnter={e=>e.currentTarget.style.background=isTotal?"#f0f4ff":"#fafafa"}
                    onMouseLeave={e=>e.currentTarget.style.background=isTotal?"#f8f9fc":""}>
                    <td style={{padding:"11px 14px",fontWeight:isTotal?700:400,color:isTotal?"#1a1a2e":"#444",paddingLeft:["obra"].includes(row.grupo)?28:14}}>{row.categoria}</td>
                    <td style={{padding:"11px 14px"}}><GrupoTag grupo={row.grupo}/></td>
                    <td style={{padding:"11px 14px",fontFamily:"monospace",color:"#888"}}>{row.orcado?fmtK(row.orcado):"—"}</td>
                    <td style={{padding:"11px 14px"}}>
                      <div style={{fontFamily:"monospace",fontWeight:600,color:row.grupo==="receita"?"#16a34a":row.grupo==="resultado"?"#0891b2":"#dc2626"}}>{row.realizado?fmtK(row.realizado):"—"}</div>
                      {row.orcado && row.realizado && <ProgressBar realizado={row.realizado} orcado={row.orcado} color={GRUPO_COLORS[row.grupo]} />}
                    </td>
                    <td style={{padding:"11px 14px",fontFamily:"monospace",color:row.a_realizar<0?"#d97706":"#aaa"}}>{row.a_realizar?fmtK(row.a_realizar):"—"}</td>
                    <td style={{padding:"11px 14px",fontFamily:"monospace",fontWeight:600,color:row.grupo==="receita"?"#16a34a":row.grupo==="resultado"?"#0891b2":"#555"}}>{forecast?fmtK(forecast):"—"}</td>
                    <td style={{padding:"11px 14px",fontFamily:"monospace",fontSize:11}}>
                      {p!==null ? (
                        <span style={{color:p>110?"#dc2626":p>80?"#16a34a":"#d97706",fontWeight:600}}>{fmtPercent(p,1)}</span>
                      ):"—"}
                    </td>
                    <td style={{padding:"11px 14px",fontFamily:"monospace",fontSize:11,color:desvio>0?"#16a34a":desvio<0?"#dc2626":"#aaa"}}>
                      {row.orcado&&row.realizado?(desvio>0?"+":"")+fmtK(desvio):"—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ─── EXTRATO TABLE ────────────────────────────────────────────────────────────
function ExtratoTable({movimentos}) {
  const [desc,setDesc]=useState("");
  const [cat,setCat]=useState("");
  const [ano,setAno]=useState("Todos");
  const [perPage,setPerPage]=useState(10);
  const [page,setPage]=useState(1);

  const anos = useMemo(()=>["Todos",...[...new Set(movimentos.map(m=>m.data_str?.substring(0,4)).filter(Boolean))].sort().reverse()],[movimentos]);
  const cats = useMemo(()=>["Todos",...[...new Set(movimentos.map(m=>m.categoria).filter(Boolean))].sort()],[movimentos]);

  const filtered = useMemo(()=>movimentos.filter(m=>
    (!desc||m.movimento?.toLowerCase().includes(desc.toLowerCase()))&&
    (cat==="Todos"||m.categoria===cat)&&
    (ano==="Todos"||m.data_str?.startsWith(ano))
  ),[movimentos,desc,cat,ano]);

  const totalPages = Math.max(1,Math.ceil(filtered.length/perPage));
  const slice = filtered.slice((page-1)*perPage,page*perPage);
  const totalPeriodo = filtered.reduce((s,m)=>s+(m.valor||0),0);

  if(movimentos.length===0) return (
    <div style={{textAlign:"center",padding:"36px 0",color:"#ccc"}}>
      <div style={{fontSize:28,marginBottom:8}}>📄</div>
      <div>Nenhum movimento disponível</div>
    </div>
  );

  return (
    <div>
      {/* Summary */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:14}}>
        {[
          {label:"Entradas",value:filtered.filter(m=>m.valor>0).reduce((s,m)=>s+m.valor,0),color:"#16a34a"},
          {label:"Saídas",  value:filtered.filter(m=>m.valor<0).reduce((s,m)=>s+m.valor,0),color:"#dc2626"},
          {label:"Saldo período",value:totalPeriodo,color:totalPeriodo>=0?"#16a34a":"#dc2626"},
        ].map((k,i)=>(
          <div key={i} style={{background:"#f8f9fc",borderRadius:8,padding:"10px 14px"}}>
            <div style={{fontSize:10,color:"#aaa",fontFamily:"monospace",textTransform:"uppercase"}}>{k.label}</div>
            <div style={{fontSize:15,fontWeight:700,color:k.color,fontFamily:"monospace"}}>{fmt(k.value)}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
        <input value={desc} onChange={e=>{setDesc(e.target.value);setPage(1);}} placeholder="Filtrar descrição..."
          style={{flex:2,minWidth:140,background:"#f8f8f8",border:"1px solid #eee",borderRadius:8,padding:"7px 12px",fontSize:12,outline:"none"}}/>
        <select value={cat} onChange={e=>{setCat(e.target.value);setPage(1);}}
          style={{flex:1,minWidth:120,background:"#f8f8f8",border:"1px solid #eee",borderRadius:8,padding:"7px 12px",fontSize:12,outline:"none"}}>
          {cats.map(c=><option key={c}>{c}</option>)}
        </select>
        <select value={ano} onChange={e=>{setAno(e.target.value);setPage(1);}}
          style={{background:"#f8f8f8",border:"1px solid #eee",borderRadius:8,padding:"7px 12px",fontSize:12,outline:"none"}}>
          {anos.map(a=><option key={a}>{a}</option>)}
        </select>
      </div>

      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead>
            <tr>
              {["Data","Descrição","Valor","Saldo","Categoria","Detalhes"].map(h=>(
                <th key={h} style={{padding:"8px 12px",textAlign:"left",color:"#aaa",fontSize:10,letterSpacing:"0.08em",textTransform:"uppercase",fontFamily:"monospace",borderBottom:"2px solid #f0f0f0",whiteSpace:"nowrap"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.map((m,i)=>(
              <tr key={i} style={{borderBottom:"1px solid #f8f8f8"}}
                onMouseEnter={e=>e.currentTarget.style.background="#fafafa"}
                onMouseLeave={e=>e.currentTarget.style.background=""}>
                <td style={{padding:"9px 12px",color:"#888",fontFamily:"monospace",whiteSpace:"nowrap"}}>{m.data_str}</td>
                <td style={{padding:"9px 12px",color:"#333",maxWidth:220,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.movimento}</td>
                <td style={{padding:"9px 12px",fontFamily:"monospace",fontWeight:600,color:m.valor>=0?"#16a34a":"#dc2626",whiteSpace:"nowrap"}}>
                  {m.valor>=0?"+":""}{fmt(m.valor)}
                </td>
                <td style={{padding:"9px 12px",color:"#555",fontFamily:"monospace",whiteSpace:"nowrap"}}>{fmt(m.saldo)}</td>
                <td style={{padding:"9px 12px"}}>
                  <span style={{background:"#f0f4ff",color:"#4a6fa5",fontSize:10,padding:"2px 8px",borderRadius:4,fontFamily:"monospace"}}>{m.categoria}</span>
                </td>
                <td style={{padding:"9px 12px",color:"#aaa",fontSize:11,maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.detalhes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0 0",borderTop:"1px solid #f0f0f0",marginTop:6}}>
        <span style={{fontSize:11,color:"#aaa",fontFamily:"monospace"}}>{filtered.length} registos</span>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <select value={perPage} onChange={e=>{setPerPage(+e.target.value);setPage(1);}} style={{background:"#f8f8f8",border:"1px solid #eee",borderRadius:6,padding:"3px 8px",fontSize:11}}>
            {[10,20,50,100].map(n=><option key={n}>{n}</option>)}
          </select>
          <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1} style={{background:"none",border:"1px solid #eee",borderRadius:6,padding:"3px 8px",fontSize:12,cursor:page===1?"default":"pointer",color:page===1?"#ddd":"#666"}}>‹</button>
          <span style={{fontSize:11,color:"#aaa",fontFamily:"monospace"}}>Pág. {page}/{totalPages}</span>
          <button onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages} style={{background:"none",border:"1px solid #eee",borderRadius:6,padding:"3px 8px",fontSize:12,cursor:page===totalPages?"default":"pointer",color:page===totalPages?"#ddd":"#666"}}>›</button>
        </div>
      </div>
    </div>
  );
}

// ─── SALDOS VIEW ─────────────────────────────────────────────────────────────
function SaldosView({extrato, caixaUnico}) {
  const [checked,setChecked]=useState([]);
  const [activeEmp,setActiveEmp]=useState(null);
  const [activeConta,setActiveConta]=useState(null);

  const toggle=(id)=>setChecked(c=>c.includes(id)?c.filter(x=>x!==id):[...c,id]);
  const openEmp=(emp)=>{ if(activeEmp?.id===emp.id){setActiveEmp(null);setActiveConta(null);}else{setActiveEmp(emp);setActiveConta(null);} };

  // Get live saldo from caixaUnico (updated by imports) or fallback to EMPRESAS static
  const getEmpSaldo = (emp) => {
    const cuContas = caixaUnico[emp.id] || [];
    if (cuContas.length > 0) return cuContas.reduce((s,c)=>s+(c.saldo||0),0);
    return emp.contas.reduce((s,c)=>s+(c.saldo||0),0);
  };
  const getContaSaldo = (emp, conta) => {
    const cuContas = caixaUnico[emp.id] || [];
    const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g,"");
    const cu = cuContas.find(c => norm(c.banco) === norm(conta.banco));
    return cu ? cu.saldo : conta.saldo;
  };
  const soma = checked.length>0 ? EMPRESAS.filter(e=>checked.includes(e.id)).reduce((s,e)=>s+getEmpSaldo(e),0) : null;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      {soma!==null&&(
        <div style={{background:"#1a1a2e",borderRadius:10,padding:"12px 20px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{color:"#aaa",fontSize:13}}><strong style={{color:"#fff"}}>{checked.length}</strong> empresa(s) selecionada(s)</span>
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            <span style={{color:"#C8A96E",fontSize:20,fontFamily:"monospace",fontWeight:700}}>Σ {fmt(soma)}</span>
            <button onClick={()=>setChecked([])} style={{background:"#ffffff22",color:"#fff",border:"none",padding:"5px 12px",borderRadius:6,fontSize:11,cursor:"pointer"}}>Limpar</button>
          </div>
        </div>
      )}

      <Card>
        <SectionTitle>Demonstrativo de Saldos Bancários</SectionTitle>
        <div style={{fontSize:12,color:"#aaa",marginBottom:14,marginTop:-8}}>Clique para abrir detalhes · Marque para somar saldos</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(210px,1fr))",gap:12}}>
          {EMPRESAS.map(emp=>{
            const total=getEmpSaldo(emp);
            const active=activeEmp?.id===emp.id;
            return (
              <div key={emp.id} onClick={()=>openEmp(emp)}
                style={{background:"#fff",border:active?"2px solid #1a1a2e":"1px solid #e8e8e8",borderRadius:12,padding:"14px 16px",cursor:"pointer",boxShadow:active?"0 4px 20px rgba(0,0,0,0.1)":"0 1px 4px rgba(0,0,0,0.04)",transition:"all 0.15s",position:"relative"}}
                onMouseEnter={e=>{if(!active)e.currentTarget.style.boxShadow="0 4px 16px rgba(0,0,0,0.09)";}}
                onMouseLeave={e=>{if(!active)e.currentTarget.style.boxShadow="0 1px 4px rgba(0,0,0,0.04)";}}>
                <div onClick={e=>{e.stopPropagation();toggle(emp.id);}} style={{position:"absolute",top:10,right:10,width:16,height:16,border:`2px solid ${checked.includes(emp.id)?"#1a1a2e":"#d0d0d0"}`,borderRadius:4,background:checked.includes(emp.id)?"#1a1a2e":"#fff",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>
                  {checked.includes(emp.id)&&<span style={{color:"#fff",fontSize:10}}>✓</span>}
                </div>
                <div style={{fontSize:13,fontWeight:600,color:"#1a1a2e",paddingRight:22,marginBottom:2}}>
                  {emp.nome}{emp.projeto && <span style={{fontWeight:400,color:"#999"}}> ({emp.projeto})</span>}
                </div>
                <div style={{fontSize:10,color:"#aaa",fontFamily:"monospace",marginBottom:10}}>NIPC: {emp.nipc || "—"}</div>
                <div style={{fontSize:17,fontWeight:700,fontFamily:"monospace",color:total<0?"#dc2626":"#16a34a",marginBottom:8}}>{fmt(total)}</div>
                <div style={{fontSize:10,color:"#bbb",fontFamily:"monospace"}}>🏛 {emp.contas.length} conta(s)</div>
              </div>
            );
          })}
        </div>
      </Card>

      {activeEmp&&(
        <Card style={{border:"2px solid #1a1a2e"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <SectionTitle>Contas Bancárias — {activeEmp.nome}</SectionTitle>
            <button onClick={()=>{setActiveEmp(null);setActiveConta(null);}} style={{background:"none",border:"none",color:"#bbb",cursor:"pointer",fontSize:18}}>✕</button>
          </div>
          {activeEmp.contas.map(conta=>(
            <div key={conta.id} onClick={()=>setActiveConta(activeConta?.id===conta.id?null:conta)}
              style={{background:activeConta?.id===conta.id?"#f0f4ff":"#fafafa",border:activeConta?.id===conta.id?"2px solid #3b82f6":"1px solid #f0f0f0",borderRadius:10,padding:"12px 16px",cursor:"pointer",marginBottom:8,transition:"all 0.15s"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{marginBottom:4}}><BancoChip banco={conta.banco}/></div>
                  <div style={{fontSize:11,color:"#bbb",fontFamily:"monospace"}}>{conta.iban}</div>
                  <div style={{fontSize:12,color:"#555",marginTop:3}}>Saldo: <strong style={{color:getContaSaldo(activeEmp,conta)<0?"#dc2626":"#1a1a2e"}}>{fmt(getContaSaldo(activeEmp,conta))}</strong></div>
                </div>
                <span style={{color:activeConta?.id===conta.id?"#3b82f6":"#ccc",fontSize:20,transition:"transform 0.2s",transform:activeConta?.id===conta.id?"rotate(90deg)":""}}>›</span>
              </div>
            </div>
          ))}

          {activeConta&&(
            <div style={{background:"#f8f9fc",borderRadius:12,padding:20,marginTop:10}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:"#1a1a2e"}}>Movimentos — {activeConta.banco}</div>
                  <div style={{fontSize:11,color:"#aaa",fontFamily:"monospace",marginTop:2}}>{activeConta.iban}</div>
                </div>
                <button onClick={()=>setActiveConta(null)} style={{background:"none",border:"none",color:"#bbb",cursor:"pointer",fontSize:16}}>✕</button>
              </div>
              {/* Use full extrato for Modernity/Vistas */}
              <ExtratoTable movimentos={activeConta.projeto==="vistas" ? extrato : []} />
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ─── CONTAS A PAGAR ────────────────────────────────────────────────────────────
function ContasPagar({canEdit, carregarAnexo, faturas, setFaturas, addFatura, updateFatura, deleteFatura, faturasErro, reloadFaturas,
                      pagamentosExtras, recorrentes, baixas, baixarPrevisao, anularBaixaPorFatura}) {
  // Faturas já incluídas num mapa de pagamento — o estado "Adicionado ao mapa"
  // sai daqui e não de um campo gravado na fatura.
  const {idsEmMapa}=useItensEmMapa();
  const estadoDe=(f)=>statusFatura(f,idsEmMapa);
  // Fornecedores da base de Entidades: o campo passa a sugerir os registados,
  // para as faturas do mesmo fornecedor ficarem com o nome escrito igual.
  const { entidades } = useEntidades();
  const entidadesFornec = useMemo(
    () => (entidades||[]).filter(e=>e.tipo==="Fornecedor"||e.tipo==="Empresa")
      .sort((a,b)=>(a.nome||"").localeCompare(b.nome||"")),
    [entidades]
  );
  const [showForm,setShowForm]=useState(false);
  const [editId,setEditId]=useState(null);
  // Vários status ao mesmo tempo (ex.: ver "Lançado no banco" e "Pendente em
  // dia" juntos). Conjunto vazio = todos.
  const [fStatus,setFStatus]=useState(()=>new Set());
  const toggleStatus=(s)=>setFStatus(prev=>{const n=new Set(prev); n.has(s)?n.delete(s):n.add(s); return n;});
  const [fEmp,setFEmp]=useState("Todas");
  const [fFornec,setFFornec]=useState("");
  const [mapaSelected,setMapaSelected]=useState([]);
  const [viewAnexo,setViewAnexo]=useState(null);
  const [showMapa,setShowMapa]=useState(false);

  const toggleMapa=(id)=>setMapaSelected(ms=>ms.includes(id)?ms.filter(x=>x!==id):[...ms,id]);
  const exportMapaPDF=()=>{
    const sel=faturas.filter(f=>mapaSelected.includes(f.id));
    const byEmp={};
    sel.forEach(f=>{const emp=EMPRESAS.find(e=>e.id===f.empresa);const n=emp?.nome||f.empresa;if(!byEmp[n])byEmp[n]=[];byEmp[n].push(f);});
    let html=`<html><head><title>Mapa de Pagamentos</title><style>body{font-family:Arial,sans-serif;font-size:12px;padding:20px}h1{color:#1a1a2e;font-size:18px}h2{color:#555;font-size:14px;margin-top:20px}table{width:100%;border-collapse:collapse;margin-bottom:10px}th{background:#1a1a2e;color:#fff;padding:6px 10px;text-align:left;font-size:11px}td{padding:6px 10px;border-bottom:1px solid #eee}tfoot td{font-weight:bold;background:#f8f8f8}.total{color:#1a1a2e;font-weight:bold}</style></head><body>`;
    html+=`<h1>Mapa de Pagamentos — Rio Capital</h1><p>Data: ${new Date().toLocaleDateString("pt-PT")}</p>`;
    let grand=0;
    Object.entries(byEmp).forEach(([nome,fs])=>{
      const tot=fs.reduce((s,f)=>s+f.valor,0);grand+=tot;
      html+=`<h2>${nome}</h2><table><thead><tr><th>Fatura</th><th>Fornecedor</th><th>Categoria</th><th>Vencimento</th><th>Valor</th></tr></thead><tbody>`;
      fs.forEach(f=>{html+=`<tr><td>${f.fatura||""}</td><td>${f.fornecedor||""}</td><td>${f.categoria||""}</td><td>${f.vencimento||""}</td><td style="text-align:right">${fmtEuro(f.valor)}</td></tr>`;});
      html+=`</tbody><tfoot><tr><td colspan="4">Total ${nome}</td><td style="text-align:right">${fmtEuro(tot)}</td></tr></tfoot></table>`;
    });
    html+=`<h2 style="color:#1a1a2e">TOTAL GERAL: ${fmtEuro(grand)}</h2></body></html>`;
    const w=window.open("","_blank");w.document.write(html);w.document.close();w.print();
  };
  const exportMapaExcel=()=>{
    const sel=faturas.filter(f=>mapaSelected.includes(f.id));
    let csv="Empresa;Fatura;Fornecedor;Categoria;Vencimento;Valor\n";
    sel.forEach(f=>{const emp=EMPRESAS.find(e=>e.id===f.empresa);csv+=`${emp?.nome||f.empresa};${f.fatura||""};${f.fornecedor||""};${f.categoria||""};${f.vencimento||""};${f.valor}\n`;});
    const blob=new Blob(["﻿"+csv],{type:"text/csv;charset=utf-8"});
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="mapa_pagamentos.csv";a.click();
  };
  const [form,setForm]=useState({empresa:"",fatura:"",fornecedor:"",categoria:"",subcategoria:"",valor:"",vencimento:"",previsao_pagamento:"",forma_pagamento:"",status:"Pendente em dia",obs:"",anexo_nome:"",anexo_b64:""});

  const hoje=new Date().toISOString().split("T")[0];
  const filtered=faturas.filter(f=>
    (fStatus.size===0||fStatus.has(estadoDe(f))) &&
    (fEmp==="Todas"||f.empresa===fEmp) &&
    (fFornec===""||(f.fornecedor||"").toLowerCase().includes(fFornec.toLowerCase()))
  ).sort((a,b)=>{
    // Ordem de trabalho: o que se paga primeiro aparece primeiro. Usa-se a
    // previsão de pagamento e, sem ela, o vencimento. Sem qualquer data, vai
    // para o fim em vez de se misturar no meio.
    const da=a.previsao_pagamento||a.vencimento||"", db=b.previsao_pagamento||b.vencimento||"";
    if(!da&&!db) return 0;
    if(!da) return 1;
    if(!db) return -1;
    return da.localeCompare(db);
  });
  // Sugestões únicas de fornecedores para o datalist
  const fornecedoresUnicos=[...new Set(faturas.map(f=>f.fornecedor).filter(Boolean))].sort();
  const kpis={
    pendente:faturas.filter(f=>!faturaPaga(f)).reduce((s,f)=>s+f.valor,0),
    vencida:faturas.filter(f=>faturaAtrasada(f)).reduce((s,f)=>s+f.valor,0),
    paga:faturas.filter(f=>faturaPaga(f)).reduce((s,f)=>s+f.valor,0),
  };

  // Valor e contagem de cada status, para aparecerem no próprio botão. Usa as
  // mesmas faturas que a tabela, já com empresa e fornecedor filtrados — o
  // número no botão corresponde ao que se vê ao clicar nele.
  const baseStatus=faturas.filter(f=>
    (fEmp==="Todas"||f.empresa===fEmp) &&
    (fFornec===""||(f.fornecedor||"").toLowerCase().includes(fFornec.toLowerCase()))
  );
  const totaisPorStatus={};
  STATUS_FATURA.forEach(st=>{ totaisPorStatus[st]={n:0,valor:0}; });
  baseStatus.forEach(f=>{
    const st=estadoDe(f);
    if(!totaisPorStatus[st]) totaisPorStatus[st]={n:0,valor:0};
    totaisPorStatus[st].n++;
    totaisPorStatus[st].valor+=(parseFloat(f.valor)||0);
  });

  // Soma do que está efetivamente na tabela — é isto que responde a "quero ver
  // a soma dos status que selecionei".
  const totalFiltrado=filtered.reduce((s,f)=>s+(parseFloat(f.valor)||0),0);
  const temFiltro=fStatus.size>0||fEmp!=="Todas"||fFornec!=="";

  const confirmarPago=async(f)=>{
    if(!window.confirm(`Confirmar que o pagamento a ${f.fornecedor||f.fatura} (${fmt(f.valor)}) já saiu do banco?`))return;
    const res=await updateFatura?.(f.id,{status:"Pago"});
    if(res?.error){alert("Erro ao confirmar:\n\n"+(res.error.message||res.error));return;}
    if(!res?.data||res.data.length===0)alert("Nada foi alterado — provavelmente falta política UPDATE no RLS para 'faturas'.");
  };
  const reset=()=>{setForm({empresa:"",fatura:"",fornecedor:"",categoria:"",subcategoria:"",valor:"",vencimento:"",previsao_pagamento:"",forma_pagamento:"",status:"Pendente em dia",obs:"",anexo_nome:"",anexo_b64:""});setAnexoNovo(false);setEditId(null);};

  // ── O anexo ───────────────────────────────────────────────────────────────
  // O PDF da fatura já não vem na lista (é o que a fazia demorar a abrir).
  // Vem quando alguém o quer ver, e no formulário só se envia de volta se a
  // pessoa tiver mesmo trocado o ficheiro — senão editar a data apagava o PDF.
  const [anexoNovo,setAnexoNovo]=useState(false);
  const abrirAnexo=async(f)=>{
    setViewAnexo({...f,anexo_b64:null});
    const res=await carregarAnexo?.(f.id);
    if(res?.error||!res?.data?.anexo_b64){
      setViewAnexo(v=>v&&v.id===f.id?{...v,_erro:res?.error?.message||"O anexo não foi encontrado."}:v);
      return;
    }
    setViewAnexo(v=>v&&v.id===f.id?{...v,anexo_b64:res.data.anexo_b64}:v);
  };

  // ── Conciliação com o que já estava previsto ──────────────────────────────
  // Antes de gravar uma fatura nova, pergunta-se se este custo já está no
  // fluxo como previsão (manual ou avença recorrente). Se estiver e for o
  // mesmo, liga-se: a ocorrência prevista sai do fluxo e fica o custo real.
  const [conciliar,setConciliar]=useState(null);   // {fat, candidatas, escolhida}
  const [aGravar,setAGravar]=useState(false);

  const baixasPorFatura=useMemo(()=>{
    const m={};
    (baixas||[]).forEach(b=>{ if(b.fatura_id) m[b.fatura_id]=b; });
    return m;
  },[baixas]);

  const procurarPrevisoes=(fat)=>candidatasParaFatura(fat,{
    pagamentosExtras, recorrentes, baixas, ocorrenciasDe,
  });

  const gravarFatura=async(fat,escolhida)=>{
    const comLigacao=escolhida?{
      ...fat,
      previsao_origem:escolhida.origem,
      previsao_id:String(escolhida.origemId),
      previsao_data:String(escolhida.data).slice(0,10),
    }:fat;
    const res=await addFatura?.(comLigacao);
    if(res?.error){
      const msg=res.error.message||String(res.error);
      // Sem as colunas novas, grava-se a fatura à mesma: a ligação fica só na
      // baixa. Mais vale a fatura entrar do que falhar o lançamento todo.
      if(/previsao_origem|previsao_id|previsao_data/.test(msg)&&escolhida){
        const r2=await addFatura?.(fat);
        if(r2?.error){alert("Erro ao criar fatura:\n\n"+(r2.error.message||r2.error));return false;}
      }else{
        alert(/subcategoria|previsao_pagamento|forma_pagamento/.test(msg)
          ? "Faltam colunas novas na tabela 'faturas'. No SQL Editor do Supabase:\n\n"
            + "alter table faturas add column if not exists subcategoria text;\n"
            + "alter table faturas add column if not exists previsao_pagamento date;\n"
            + "alter table faturas add column if not exists forma_pagamento text;"
          : "Erro ao criar fatura:\n\n"+msg);
        return false;
      }
    }
    if(escolhida){
      const rb=await baixarPrevisao?.({
        origem:escolhida.origem, origem_id:String(escolhida.origemId),
        data_ocorrencia:escolhida.data, fatura_id:fat.id, empresa:fat.empresa,
        valor_previsto:escolhida.valor, valor_fatura:fat.valor,
      });
      if(rb?.error||rb?.semEfeito){
        alert("A fatura foi criada, mas a previsão NÃO saiu do fluxo — o custo vai aparecer duas vezes.\n\n"
          +"Falta a tabela 'previsoes_baixas'. Abre /setup-conciliacao.html e corre o SQL.\n\n"
          +(rb?.error?.message||""));
      }
    }
    return true;
  };

  const save = async () => {
    const fat = { ...form, id: editId || "f" + Date.now(), valor: parseFloat(form.valor) || 0 };
    // Sem ficheiro novo, o anexo nem sequer é mencionado no update: fica como
    // está na base. Enviar "" apagava o PDF a quem só queria mudar a data.
    if (editId && !anexoNovo) { delete fat.anexo_b64; delete fat.anexo_nome; }
    // Só vale a pena perguntar quando a fatura é nova: editar uma fatura já
    // lançada não acrescenta custo nenhum ao fluxo.
    if(!editId){
      const cands=procurarPrevisoes(fat);
      if(cands.length){
        setConciliar({fat,candidatas:cands,escolhida:cands[0].score>=LIMIAR_AVISO?cands[0]:null});
        return;
      }
    }
    if (editId) {
      const res = await updateFatura?.(editId, fat);
      if (res?.error) {
        const msg = res.error.message || String(res.error);
        alert(/subcategoria|previsao_pagamento|forma_pagamento/.test(msg)
          ? "Faltam colunas novas na tabela 'faturas'. No SQL Editor do Supabase:\n\n"
            + "alter table faturas add column if not exists subcategoria text;\n"
            + "alter table faturas add column if not exists previsao_pagamento date;\n"
            + "alter table faturas add column if not exists forma_pagamento text;"
          : "Erro ao guardar:\n\n" + msg);
        return;
      }
      if (!res?.data || res.data.length === 0) {
        alert("Nada foi alterado (provavelmente falta política UPDATE no RLS para 'faturas').");
        return;
      }
    } else {
      const ok = await gravarFatura(fat, null);
      if (!ok) return;
    }
    setShowForm(false); reset();
  };

  // Decisão tomada no painel: ligar à previsão escolhida, ou gravar à parte.
  const concluirConciliacao = async (escolhida) => {
    if (!conciliar || aGravar) return;
    setAGravar(true);
    const ok = await gravarFatura(conciliar.fat, escolhida);
    setAGravar(false);
    if (!ok) return;
    setConciliar(null); setShowForm(false); reset();
  };

  // F is rendered inline below, not as sub-component to avoid remount on state change

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <div style={{display:"grid",gridTemplateColumns:`repeat(${temFiltro?4:3},1fr)`,gap:14}}>
        {[["A Pagar",kpis.pendente,"#d97706",null],["Vencido",kpis.vencida,"#dc2626",null],["Pago",kpis.paga,"#16a34a",null],
          ...(temFiltro?[["Selecionado",totalFiltrado,"#4338ca",`${filtered.length} fatura${filtered.length===1?"":"s"}`]]:[])
         ].map(([l,v,c,sub],i)=>(
          <div key={i} style={{background:"#fff",border:"1px solid #f0f0f0",borderRadius:12,padding:"16px 18px",borderTop:`3px solid ${c}`}}>
            <div style={{fontSize:10,color:"#aaa",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6,fontFamily:"monospace"}}>{l}</div>
            <div style={{fontSize:20,fontWeight:700,color:c,fontFamily:"monospace"}}>{fmt(v)}</div>
            {sub&&<div style={{fontSize:10,color:"#bbb",fontFamily:"monospace",marginTop:4}}>{sub}</div>}
          </div>
        ))}
      </div>
      {temFiltro&&(
        <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",fontSize:11,color:"#888",fontFamily:"monospace",marginTop:-10}}>
          <span>A mostrar:</span>
          {fStatus.size>0
            ? [...fStatus].map(st=>(
                <span key={st} style={{background:"#eef2ff",color:"#4338ca",padding:"2px 9px",borderRadius:10}}>{st}</span>
              ))
            : <span style={{background:"#f0f0f0",padding:"2px 9px",borderRadius:10}}>todos os status</span>}
          {fEmp!=="Todas"&&<span style={{background:"#eef2ff",color:"#4338ca",padding:"2px 9px",borderRadius:10}}>{labelEmpresa(fEmp)}</span>}
          {fFornec&&<span style={{background:"#eef2ff",color:"#4338ca",padding:"2px 9px",borderRadius:10}}>“{fFornec}”</span>}
          <button onClick={()=>{setFStatus(new Set());setFEmp("Todas");setFFornec("");}}
            style={{background:"none",border:"none",color:"#aaa",cursor:"pointer",fontSize:11,textDecoration:"underline",fontFamily:"monospace"}}>
            limpar
          </button>
        </div>
      )}

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
          <button onClick={()=>setFStatus(new Set())}
            title="Mostrar todas as faturas"
            style={{background:fStatus.size===0?"#1a1a2e":"#f0f0f0",color:fStatus.size===0?"#fff":"#666",border:"none",padding:"6px 14px",borderRadius:20,fontSize:12,cursor:"pointer"}}>
            Todos
          </button>
          {STATUS_FATURA.map(s=>{
            const on=fStatus.has(s);
            const t=totaisPorStatus[s]||{n:0,valor:0};
            return (
              <button key={s} onClick={()=>toggleStatus(s)}
                title={`${t.n} fatura(s) · ${fmt(t.valor)} — clica para juntar ou tirar do filtro`}
                style={{background:on?"#1a1a2e":"#f0f0f0",color:on?"#fff":"#666",border:"none",padding:"6px 14px",borderRadius:20,fontSize:12,cursor:"pointer",display:"flex",alignItems:"center",gap:7}}>
                <span>{on?"✓ ":""}{s}</span>
                <span style={{fontFamily:"monospace",fontSize:10,opacity:on?0.85:0.55,whiteSpace:"nowrap"}}>{fmt(t.valor)}</span>
              </button>
            );
          })}
          <select value={fEmp} onChange={e=>setFEmp(e.target.value)} style={{background:"#f8f8f8",border:"1px solid #eee",borderRadius:20,padding:"6px 14px",fontSize:12,outline:"none"}}>
            <option value="Todas">Todas</option>
            {EMPRESAS.map(e=><option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
          <div style={{position:"relative",display:"flex",alignItems:"center"}}>
            <span style={{position:"absolute",left:12,fontSize:12,color:"#aaa",pointerEvents:"none"}}>🔎</span>
            <input type="text" list="fornecedores-datalist" placeholder="Pesquisar fornecedor..." value={fFornec} onChange={e=>setFFornec(e.target.value)}
              style={{background:"#f8f8f8",border:"1px solid #eee",borderRadius:20,padding:"6px 14px 6px 32px",fontSize:12,outline:"none",width:220,fontFamily:"inherit"}} />
            {fFornec && (
              <button onClick={()=>setFFornec("")} title="Limpar" style={{position:"absolute",right:6,background:"#eee",border:"none",borderRadius:"50%",width:20,height:20,fontSize:10,color:"#666",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
            )}
            <datalist id="fornecedores-datalist">
              {fornecedoresUnicos.map(f=><option key={f} value={f} />)}
            </datalist>
          </div>
        </div>
        <div style={{display:"flex",gap:8}}>
          {mapaSelected.length>0&&(
            <div style={{display:"flex",gap:6,alignItems:"center",background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:"4px 10px"}}>
              <span style={{fontSize:12,color:"#16a34a"}}>{mapaSelected.length} selecionadas</span>
              <button onClick={exportMapaPDF} style={{background:"#dc2626",color:"#fff",border:"none",padding:"5px 12px",borderRadius:6,fontSize:11,cursor:"pointer",fontWeight:600}}>PDF</button>
              <button onClick={exportMapaExcel} style={{background:"#16a34a",color:"#fff",border:"none",padding:"5px 12px",borderRadius:6,fontSize:11,cursor:"pointer",fontWeight:600}}>Excel</button>
              <button onClick={()=>setMapaSelected([])} style={{background:"none",border:"none",color:"#aaa",cursor:"pointer",fontSize:14}}>✕</button>
            </div>
          )}
          {canEdit&&<button onClick={()=>{reset();setShowForm(true);}} style={{background:"#1a1a2e",color:"#fff",border:"none",padding:"9px 20px",borderRadius:8,fontSize:13,cursor:"pointer",fontWeight:600}}>+ Nova Fatura</button>}
        </div>
      </div>

      {showForm&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"#fff",borderRadius:16,padding:32,width:620,maxWidth:"95vw",maxHeight:"90vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.25)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
              <h2 style={{margin:0,fontSize:18,fontFamily:"Georgia,serif",color:"#1a1a2e"}}>{editId?"Editar Fatura":"Nova Fatura"}</h2>
              <button onClick={()=>{setShowForm(false);reset();}} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#aaa"}}>✕</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
              <div style={{display:"flex",flexDirection:"column",gap:4}}><label style={{fontSize:10,color:"#aaa",fontFamily:"monospace",textTransform:"uppercase"}}>Empresa</label><select value={form.empresa||""} onChange={e=>setForm(f=>({...f,empresa:e.target.value}))} style={{background:"#f8f8f8",border:"1px solid #e8e8e8",borderRadius:8,padding:"9px 12px",fontSize:13,outline:"none"}}><option value="">Selecionar...</option>{EMPRESAS.map(o=><option key={o.id} value={o.id}>{o.nome}</option>)}</select></div>
              <div style={{display:"flex",flexDirection:"column",gap:4}}><label style={{fontSize:10,color:"#aaa",fontFamily:"monospace",textTransform:"uppercase"}}>Nº Fatura</label><input type="text" value={form.fatura||""} onChange={e=>setForm(f=>({...f,fatura:e.target.value}))} style={{background:"#f8f8f8",border:"1px solid #e8e8e8",borderRadius:8,padding:"9px 12px",fontSize:13,outline:"none"}}/></div>
              <div style={{display:"flex",flexDirection:"column",gap:4}}><label style={{fontSize:10,color:"#aaa",fontFamily:"monospace",textTransform:"uppercase"}}>Fornecedor</label><input type="text" list="entidades-fornecedores" value={form.fornecedor||""} onChange={e=>setForm(f=>({...f,fornecedor:e.target.value}))} placeholder="Escolhe da base de Entidades ou escreve" style={{background:"#f8f8f8",border:"1px solid #e8e8e8",borderRadius:8,padding:"9px 12px",fontSize:13,outline:"none"}}/><datalist id="entidades-fornecedores">{entidadesFornec.map(e=><option key={e.id} value={e.nome}>{e.nome_fantasia||""}</option>)}</datalist></div>
              <div style={{display:"flex",flexDirection:"column",gap:4}}><label style={{fontSize:10,color:"#aaa",fontFamily:"monospace",textTransform:"uppercase"}}>Categoria</label><select value={form.categoria||""} onChange={e=>setForm(f=>({...f,categoria:e.target.value,subcategoria:""}))} style={{background:"#f8f8f8",border:"1px solid #e8e8e8",borderRadius:8,padding:"9px 12px",fontSize:13,outline:"none"}}><option value="">Selecionar...</option>{CATEGORIAS.map(o=><option key={o}>{o}</option>)}</select></div>
              <div style={{display:"flex",flexDirection:"column",gap:4}}><label style={{fontSize:10,color:"#aaa",fontFamily:"monospace",textTransform:"uppercase"}}>Subcategoria</label><select value={form.subcategoria||""} disabled={!form.categoria} onChange={e=>setForm(f=>({...f,subcategoria:e.target.value}))} style={{background:"#f8f8f8",border:"1px solid #e8e8e8",borderRadius:8,padding:"9px 12px",fontSize:13,outline:"none"}}><option value="">{form.categoria?"Selecionar...":"escolhe a categoria"}</option>{(SUBCATEGORIAS[form.categoria]||[]).map(o=><option key={o}>{o}</option>)}</select></div>
              <div style={{display:"flex",flexDirection:"column",gap:4}}><label style={{fontSize:10,color:"#aaa",fontFamily:"monospace",textTransform:"uppercase"}}>Valor (€)</label><input type="number" value={form.valor||""} onChange={e=>setForm(f=>({...f,valor:e.target.value}))} style={{background:"#f8f8f8",border:"1px solid #e8e8e8",borderRadius:8,padding:"9px 12px",fontSize:13,outline:"none"}}/></div>
              <div style={{display:"flex",flexDirection:"column",gap:4}}><label style={{fontSize:10,color:"#aaa",fontFamily:"monospace",textTransform:"uppercase"}}>Vencimento</label><input type="date" value={form.vencimento||""} onChange={e=>setForm(f=>({...f,vencimento:e.target.value}))} style={{background:"#f8f8f8",border:"1px solid #e8e8e8",borderRadius:8,padding:"9px 12px",fontSize:13,outline:"none"}}/></div>
              <div style={{display:"flex",flexDirection:"column",gap:4}}><label style={{fontSize:10,color:"#aaa",fontFamily:"monospace",textTransform:"uppercase"}}>Previsão de pagamento</label><input type="date" value={form.previsao_pagamento||""} onChange={e=>setForm(f=>({...f,previsao_pagamento:e.target.value}))} title="Quando tencionamos pagar — alimenta o Fluxo Futuro" style={{background:"#f8f8f8",border:"1px solid #e8e8e8",borderRadius:8,padding:"9px 12px",fontSize:13,outline:"none"}}/></div>
              <div style={{display:"flex",flexDirection:"column",gap:4}}><label style={{fontSize:10,color:"#aaa",fontFamily:"monospace",textTransform:"uppercase"}}>Forma de pagamento</label><select value={form.forma_pagamento||""} onChange={e=>setForm(f=>({...f,forma_pagamento:e.target.value}))} title="Débito direto sai sozinho na data; pagamento bancário é ordenado por nós" style={{background:"#f8f8f8",border:"1px solid #e8e8e8",borderRadius:8,padding:"9px 12px",fontSize:13,outline:"none"}}><option value="">Selecionar...</option>{FORMAS_PAGAMENTO.map(o=><option key={o}>{o}</option>)}</select></div>
              <div style={{display:"flex",flexDirection:"column",gap:4}}><label style={{fontSize:10,color:"#aaa",fontFamily:"monospace",textTransform:"uppercase"}}>Status</label><select value={form.status||"Pendente em dia"} onChange={e=>setForm(f=>({...f,status:e.target.value}))} style={{background:"#f8f8f8",border:"1px solid #e8e8e8",borderRadius:8,padding:"9px 12px",fontSize:13,outline:"none"}}><option value="">Selecionar...</option>{STATUS_MANUAIS.map(o=><option key={o}>{o}</option>)}</select></div>
              <div style={{gridColumn:"1/-1",display:"flex",flexDirection:"column",gap:4}}>
                <label style={{fontSize:10,color:"#aaa",fontFamily:"monospace",textTransform:"uppercase"}}>Observações</label>
                <textarea value={form.obs} onChange={e=>setForm(f=>({...f,obs:e.target.value}))} rows={3} style={{background:"#f8f8f8",border:"1px solid #e8e8e8",borderRadius:8,padding:"9px 12px",fontSize:13,outline:"none",resize:"vertical",fontFamily:"inherit",width:"100%",boxSizing:"border-box"}}/>
              </div>
              <div style={{gridColumn:"1/-1",display:"flex",flexDirection:"column",gap:4}}>
                <label style={{fontSize:10,color:"#aaa",fontFamily:"monospace",textTransform:"uppercase"}}>Anexar Fatura (PDF/Imagem)</label>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <label style={{background:"#f8f8f8",border:"1px solid #e8e8e8",borderRadius:8,padding:"9px 16px",fontSize:12,cursor:"pointer",color:"#555",display:"inline-flex",alignItems:"center",gap:6}}>
                    📎 {form.anexo_nome || "Selecionar ficheiro"}
                    <input type="file" accept=".pdf,.png,.jpg,.jpeg" style={{display:"none"}} onChange={e=>{
                      const f2=e.target.files[0];
                      if(!f2) return;
                      const reader=new FileReader();
                      reader.onload=()=>{setAnexoNovo(true);setForm(f=>({...f,anexo_nome:f2.name,anexo_b64:reader.result}));};
                      reader.readAsDataURL(f2);
                    }}/>
                  </label>
                  {form.anexo_nome&&<span style={{fontSize:11,color:"#16a34a"}}>✓ {form.anexo_nome}</span>}
                  {form.anexo_nome&&<button onClick={()=>{setAnexoNovo(true);setForm(f=>({...f,anexo_nome:"",anexo_b64:""}));}} style={{background:"none",border:"none",color:"#dc2626",cursor:"pointer",fontSize:13}}>✕</button>}
                </div>
              </div>
            </div>
            <div style={{display:"flex",justifyContent:"flex-end",gap:10,marginTop:24}}>
              <button onClick={()=>{setShowForm(false);reset();}} style={{background:"#f0f0f0",color:"#666",border:"none",padding:"10px 20px",borderRadius:8,fontSize:13,cursor:"pointer"}}>Cancelar</button>
              <button onClick={save} style={{background:"#1a1a2e",color:"#fff",border:"none",padding:"10px 24px",borderRadius:8,fontSize:13,cursor:"pointer",fontWeight:600}}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Este custo já estava previsto? ──────────────────────────────────
          Não bloqueia o lançamento: mostra o que encontrou e deixa decidir.
          Ligar faz a ocorrência prevista sair do fluxo; lançar à parte mantém
          as duas, que é o certo quando são mesmo custos diferentes. */}
      {conciliar&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:320,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
          <div style={{background:"#fff",borderRadius:16,width:720,maxWidth:"95vw",maxHeight:"88vh",display:"flex",flexDirection:"column",boxShadow:"0 24px 70px rgba(0,0,0,0.3)"}}>

            <div style={{padding:"18px 22px 14px",borderBottom:"1px solid #f0f0f0"}}>
              <div style={{fontSize:15,fontWeight:700,color:"#1a1a2e"}}>Este custo já estava previsto</div>
              <div style={{fontSize:12,color:"#888",marginTop:5,lineHeight:1.5}}>
                A fatura <strong style={{color:"#444"}}>{conciliar.fat.fornecedor||conciliar.fat.fatura||"(sem nome)"}</strong> de{" "}
                <strong style={{color:"#444"}}>{fmt(conciliar.fat.valor)}</strong>
                {conciliar.fat.previsao_pagamento||conciliar.fat.vencimento
                  ? <> para <strong style={{color:"#444"}}>{fmtDate(conciliar.fat.previsao_pagamento||conciliar.fat.vencimento)}</strong></> : null}
                {" "}parece-se com {conciliar.candidatas.length===1?"uma previsão que já está":"previsões que já estão"} no Fluxo Futuro.
                Se for o mesmo custo, liga — a previsão sai do fluxo e fica só a fatura.
              </div>
            </div>

            <div style={{flex:1,overflowY:"auto",padding:"14px 22px",display:"flex",flexDirection:"column",gap:8}}>
              {conciliar.candidatas.map((c,i)=>{
                const sel=conciliar.escolhida&&conciliar.escolhida.origem===c.origem
                  &&String(conciliar.escolhida.origemId)===String(c.origemId)&&conciliar.escolhida.data===c.data;
                const conf=nivelDeConfianca(c.score);
                const dif=(parseFloat(conciliar.fat.valor)||0)-(parseFloat(c.valor)||0);
                return (
                  <div key={i} onClick={()=>setConciliar(x=>({...x,escolhida:sel?null:c}))}
                    style={{border:`1px solid ${sel?"#1a1a2e":"#eef0f4"}`,background:sel?"#fafbff":"#fff",
                            borderRadius:10,padding:"12px 14px",cursor:"pointer"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
                      <div style={{minWidth:0}}>
                        <div style={{fontSize:12.5,color:"#1a1a2e",fontWeight:sel?700:400}}>{c.descricao}</div>
                        <div style={{fontSize:10.5,color:"#aaa",fontFamily:"monospace",marginTop:3}}>
                          {fmtDate(c.data)}
                          {c.parcela?` · parcela ${c.parcela}`:""}
                          {c.categoria?` · ${c.categoria}`:""}
                          {c.subcategoria?` › ${c.subcategoria}`:""}
                        </div>
                      </div>
                      <div style={{textAlign:"right",whiteSpace:"nowrap"}}>
                        <div style={{fontFamily:"monospace",fontWeight:700,color:"#1a1a2e"}}>{fmt(c.valor)}</div>
                        {Math.abs(dif)>0.005&&(
                          <div style={{fontSize:10,fontFamily:"monospace",color:dif>0?"#dc2626":"#16a34a",marginTop:2}}>
                            fatura {dif>0?"+":""}{fmt(dif)}
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:6,marginTop:9,flexWrap:"wrap"}}>
                      <span style={{fontSize:9,padding:"2px 7px",borderRadius:4,fontFamily:"monospace",
                                    background:c.origem==="recorrente"?"#eef2ff":"#fff7ed",
                                    color:c.origem==="recorrente"?"#4338ca":"#b45309"}}>
                        {c.origem==="recorrente"?"despesa recorrente":"previsão manual"}
                      </span>
                      <span style={{fontSize:9,padding:"2px 7px",borderRadius:4,fontFamily:"monospace",
                                    background:conf==="alta"?"#ecfdf5":conf==="média"?"#fffbeb":"#f4f4f6",
                                    color:conf==="alta"?"#047857":conf==="média"?"#92400e":"#888"}}>
                        semelhança {conf}
                      </span>
                      {c.motivos.map((m,k)=>(
                        <span key={k} style={{fontSize:9.5,color:"#999",fontFamily:"monospace"}}>· {m}</span>
                      ))}
                    </div>
                  </div>
                );
              })}
              {conciliar.escolhida?.origem==="recorrente"&&(
                <div style={{background:"#f8f9fc",border:"1px solid #eef0f4",borderRadius:8,padding:"10px 12px",fontSize:11,color:"#666",lineHeight:1.5}}>
                  Sai do fluxo <strong>só o mês de {fmtDate(conciliar.escolhida.data)}</strong>. A avença continua
                  nos meses seguintes — para a parar de vez usa o botão “Despesas recorrentes”.
                </div>
              )}
            </div>

            <div style={{padding:"14px 22px",borderTop:"1px solid #f0f0f0",display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}>
              <button onClick={()=>setConciliar(null)} disabled={aGravar}
                style={{background:"none",border:"none",color:"#999",fontSize:12,cursor:aGravar?"default":"pointer"}}>Cancelar</button>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <button onClick={()=>concluirConciliacao(null)} disabled={aGravar}
                  title="São custos diferentes: a fatura entra e a previsão fica de pé"
                  style={{background:"#f4f4f6",border:"1px solid #e8e8e8",color:"#555",padding:"10px 16px",borderRadius:8,fontSize:12.5,cursor:aGravar?"default":"pointer"}}>
                  Não é o mesmo — lançar à parte
                </button>
                <button onClick={()=>concluirConciliacao(conciliar.escolhida)} disabled={aGravar||!conciliar.escolhida}
                  title={conciliar.escolhida?"A previsão escolhida sai do fluxo e fica só esta fatura":"Escolhe primeiro a previsão correspondente"}
                  style={{background:conciliar.escolhida?"#1a1a2e":"#e8e8e8",color:conciliar.escolhida?"#fff":"#aaa",border:"none",
                          padding:"10px 20px",borderRadius:8,fontSize:12.5,fontWeight:600,cursor:(aGravar||!conciliar.escolhida)?"default":"pointer"}}>
                  {aGravar?"A gravar…":"Ligar e lançar fatura"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Anexo viewer */}
      {viewAnexo&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center"}}
          onMouseDown={e=>{e.currentTarget.dataset.fundo=e.target===e.currentTarget?"1":"";}} onClick={e=>{if(e.target===e.currentTarget&&e.currentTarget.dataset.fundo==="1")setViewAnexo(null);}}>
          <div style={{background:"#fff",borderRadius:16,padding:20,width:"90vw",maxWidth:900,maxHeight:"90vh",display:"flex",flexDirection:"column",gap:12}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:14,fontWeight:700,color:"#1a1a2e"}}>📎 {viewAnexo.anexo_nome}</div>
              <div style={{display:"flex",gap:8}}>
                {viewAnexo.anexo_b64&&<a href={viewAnexo.anexo_b64} download={viewAnexo.anexo_nome} style={{background:"#1a1a2e",color:"#fff",padding:"6px 14px",borderRadius:7,fontSize:12,textDecoration:"none",fontWeight:600}}>⬇ Download</a>}
                <button onClick={()=>setViewAnexo(null)} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#aaa"}}>✕</button>
              </div>
            </div>
            {viewAnexo._erro?
              <div style={{padding:"50px 20px",textAlign:"center",color:"#dc2626",fontSize:13}}>{viewAnexo._erro}</div>:
             !viewAnexo.anexo_b64?
              <div style={{padding:"60px 20px",textAlign:"center",color:"#aaa",fontSize:13,fontFamily:"monospace"}}>a abrir o anexo…</div>:
             viewAnexo.anexo_b64.startsWith("data:application/pdf")?
              <iframe src={viewAnexo.anexo_b64} title={viewAnexo.anexo_nome} style={{flex:1,minHeight:"70vh",border:"none",borderRadius:8}}/>:
              <img src={viewAnexo.anexo_b64} alt="Fatura" style={{maxHeight:"75vh",objectFit:"contain",borderRadius:8}}/>
            }
          </div>
        </div>
      )}
      <Card style={{padding:0,overflow:"hidden"}}>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead>
              <tr style={{background:"#f8f9fc"}}>
                {["","Empresa","Fatura","Fornecedor","Categoria","Valor","Vencimento","Prev. pagamento","Status","Obs.",""].map(h=>(
                  <th key={h} style={{padding:"10px 14px",textAlign:"left",color:"#aaa",fontSize:10,letterSpacing:"0.08em",textTransform:"uppercase",fontFamily:"monospace",borderBottom:"1px solid #f0f0f0",whiteSpace:"nowrap"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Uma falha a carregar é diferente de não haver faturas. Antes as
                  duas situações mostravam a mesma frase, e uma lista vazia por
                  erro de rede ou de permissões passava por "não há nada". */}
              {filtered.length===0&&(faturasErro
                ? <tr><td colSpan={10} style={{textAlign:"center",padding:28}}>
                    <div style={{color:"#dc2626",fontWeight:700,fontSize:13,marginBottom:6}}>Não foi possível carregar as faturas</div>
                    <div style={{color:"#b91c1c",fontSize:11,marginBottom:12,fontFamily:"monospace"}}>{faturasErro}</div>
                    <button onClick={()=>reloadFaturas?.()} style={{background:"#1a1a2e",border:"none",color:"#fff",padding:"8px 18px",borderRadius:8,fontSize:12,cursor:"pointer",fontWeight:600}}>Tentar de novo</button>
                  </td></tr>
                : <tr><td colSpan={10} style={{textAlign:"center",padding:32,color:"#ccc"}}>Nenhuma fatura encontrada</td></tr>)}
              {filtered.map(f=>{
                const emp=EMPRESAS.find(e=>e.id===f.empresa);
                const vencida=faturaAtrasada(f);
                const rejeitada=estadoDe(f)==="Pagamento bloqueado";
                const inMapa=mapaSelected.includes(f.id);
                return (
                  <tr key={f.id} style={{borderBottom:"1px solid #fafafa",background:rejeitada?"#f9f9f9":vencida?"#fff8f8":inMapa?"#f0f9ff":"",opacity:rejeitada?0.6:1}}
                    onMouseEnter={e=>e.currentTarget.style.background=rejeitada?"#f5f5f5":vencida?"#fff0f0":inMapa?"#e8f4ff":"#fafafa"}
                    onMouseLeave={e=>e.currentTarget.style.background=rejeitada?"#f9f9f9":vencida?"#fff8f8":inMapa?"#f0f9ff":""}>
                    <td style={{padding:"11px 14px"}}>
                      {!rejeitada&&!faturaPaga(f)&&<input type="checkbox" checked={inMapa} onChange={()=>toggleMapa(f.id)} style={{cursor:"pointer",width:15,height:15}}/>}
                    </td>
                    <td style={{padding:"11px 14px"}}><div style={{fontWeight:600,color:"#1a1a2e",fontSize:12}}>{emp?.nome||f.empresa}</div><div style={{fontSize:10,color:"#bbb",fontFamily:"monospace"}}>NIPC:{emp?.nipc}</div></td>
                    <td style={{padding:"11px 14px",fontFamily:"monospace",fontSize:11,color:"#888"}}>
                      {f.fatura}
                      {f.forma_pagamento&&(()=>{
                        // Etiqueta curta: a tabela não tem espaço para o nome todo
                        const dd=/d[ée]bito|^DD/i.test(f.forma_pagamento);
                        const banco=/banc/i.test(f.forma_pagamento);
                        return <div title={"Forma de pagamento: "+f.forma_pagamento}
                          style={{display:"inline-block",marginTop:3,fontSize:9,padding:"1px 6px",borderRadius:4,
                            background:dd?"#fef3c7":banco?"#eff6ff":"#f4f4f6",
                            color:dd?"#92400e":banco?"#2563eb":"#777"}}>
                          {dd?"DD":banco?"banco":"outro"}
                        </div>;
                      })()}
                      {/* Esta fatura substituiu uma previsão: o custo conta uma vez só */}
                      {(()=>{
                        const b=baixasPorFatura[f.id];
                        if(!b) return null;
                        return <div title={`Ligada a uma previsão ${b.origem==="recorrente"?"recorrente":"manual"} de ${fmtDate(b.data_ocorrencia)} — essa ocorrência saiu do Fluxo Futuro para o custo não contar duas vezes`}
                          style={{display:"inline-block",marginTop:3,marginLeft:4,fontSize:9,padding:"1px 6px",borderRadius:4,background:"#ecfdf5",color:"#047857"}}>
                          ↔ previsão
                        </div>;
                      })()}
                    </td>
                    <td style={{padding:"11px 14px",color:"#444",maxWidth:140,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.fornecedor}</td>
                    <td style={{padding:"11px 14px"}}><span style={{background:"#f0f4ff",color:"#4a6fa5",fontSize:10,padding:"2px 8px",borderRadius:4,fontFamily:"monospace"}}>{f.categoria}</span></td>
                    <td style={{padding:"11px 14px",fontFamily:"monospace",fontWeight:700,whiteSpace:"nowrap",textDecoration:rejeitada?"line-through":"none"}}>{fmt(f.valor)}</td>
                    <td style={{padding:"11px 14px",fontFamily:"monospace",fontSize:11,color:vencida?"#dc2626":"#888",fontWeight:vencida?700:400}}>{fmtDate(f.vencimento)}{vencida?" ⚠":""}</td>
                    <td style={{padding:"11px 14px",fontFamily:"monospace",fontSize:11,color:f.previsao_pagamento?"#4a6fa5":"#ddd"}}
                      title={f.previsao_pagamento?"Data em que tencionamos pagar — é esta que conta no Fluxo Futuro":"Sem previsão: o fluxo usa o vencimento"}>
                      {f.previsao_pagamento?fmtDate(f.previsao_pagamento):"—"}
                    </td>
                    <td style={{padding:"11px 14px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <StatusPill status={estadoDe(f)}/>
                        {/* Ordem já dada ao banco: um clique confirma que saiu e passa a Pago */}
                        {canEdit&&estadoDe(f)==="Lançado no banco"&&(
                          <button onClick={()=>confirmarPago(f)}
                            title="Confirmar que o pagamento saiu da conta — passa a Pago"
                            style={{background:"#f0fdf4",border:"1px solid #bbf7d0",color:"#16a34a",width:24,height:24,borderRadius:"50%",fontSize:12,cursor:"pointer",fontWeight:700,padding:0,flexShrink:0}}>✓</button>
                        )}
                      </div>
                    </td>
                    <td style={{padding:"11px 14px",color:"#bbb",fontSize:11,maxWidth:100,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.obs}</td>
                    <td style={{padding:"11px 14px"}}>
                      <div style={{display:"flex",gap:4}}>
                        {f.anexo_nome&&<button onClick={()=>abrirAnexo(f)} title="Ver fatura" style={{background:"#f0f4ff",border:"none",color:"#4a6fa5",padding:"4px 9px",borderRadius:6,fontSize:11,cursor:"pointer"}}>📎</button>}
                        {canEdit&&<button onClick={()=>{setForm({...f,valor:String(f.valor),anexo_nome:f.anexo_nome||"",anexo_b64:""});setAnexoNovo(false);setEditId(f.id);setShowForm(true);}} style={{background:"#f0f4ff",border:"none",color:"#4a6fa5",padding:"4px 9px",borderRadius:6,fontSize:11,cursor:"pointer"}}>✎</button>}
                        {canEdit&&<button onClick={async ()=>{
                          const ligada=baixasPorFatura[f.id];
                          if (!window.confirm(`Eliminar fatura "${f.fatura || f.id}" (${f.fornecedor || ''})?\nEsta acção não pode ser desfeita.`
                            + (ligada ? "\n\nEsta fatura estava ligada a uma previsão — ao eliminá-la a previsão volta ao Fluxo Futuro." : ""))) return;
                          const res = await deleteFatura?.(f.id);
                          // A previsão volta ao fluxo: o custo continua a existir, só não tem fatura.
                          if (!res?.error && ligada) await anularBaixaPorFatura?.(f.id);
                          if (res?.error) {
                            const msg = `${res.error.message || 'delete falhou'}${res.error.details ? ' · ' + res.error.details : ''}${res.error.hint ? ' · ' + res.error.hint : ''}${res.error.code ? ' ['+res.error.code+']' : ''}`;
                            alert("Erro a eliminar fatura:\n\n" + msg);
                            console.error("delete err:", res.error);
                          } else if (!res?.data || res.data.length === 0) {
                            alert("Nenhuma fatura foi eliminada.\n\nIsto costuma significar que falta uma política DELETE no Supabase para a tabela 'faturas' (RLS).\n\nVerifica em Supabase → Authentication → Policies → faturas.");
                            console.warn("delete returned no rows. Likely RLS policy missing.", res);
                          }
                        }} style={{background:"#fff0f0",border:"none",color:"#dc2626",padding:"4px 9px",borderRadius:6,fontSize:11,cursor:"pointer"}}>✕</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ─── UTILIZADORES ─────────────────────────────────────────────────────────────
function Utilizadores({ currentUser }) {
  // Wrap defensivo: qualquer erro aqui devia ser apanhado para não cair a app inteira.
  try {
    return <UtilizadoresInner currentUser={currentUser} />;
  } catch (err) {
    console.error("Erro no componente Utilizadores:", err);
    return (
      <Card style={{ textAlign: "center", padding: 40 }}>
        <div style={{ fontSize: 28, marginBottom: 12 }}>⚠️</div>
        <div style={{ fontSize: 16, fontWeight: 600, color: "#1a1a2e" }}>Erro ao carregar a lista de utilizadores</div>
        <div style={{ color: "#888", fontSize: 12, marginTop: 8, fontFamily: "monospace" }}>{String(err?.message || err)}</div>
      </Card>
    );
  }
}

function UtilizadoresInner({ currentUser }) {
  const { profiles, loading } = useProfiles();
  const [savingId, setSavingId] = useState(null);
  const [feedback, setFeedback] = useState({});

  // Bloqueio para não-admins
  if (!currentUser || currentUser.role !== "admin") {
    return (
      <Card style={{ textAlign: "center", padding: 48 }}>
        <div style={{ fontSize: 28, marginBottom: 12 }}>🔒</div>
        <div style={{ fontSize: 16, fontWeight: 600, color: "#1a1a2e" }}>Acesso Restrito</div>
        <div style={{ color: "#aaa", fontSize: 13, marginTop: 8 }}>Apenas administradores podem gerir utilizadores.</div>
      </Card>
    );
  }

  const updateField = async (id, field, value) => {
    setSavingId(id + ":" + field);
    try {
      const { data, error } = await supabase.from("profiles").update({ [field]: value }).eq("id", id).select();
      setSavingId(null);
      if (error) {
        setFeedback(f => ({ ...f, [id]: "error" }));
        alert("Erro a guardar: " + error.message);
        return;
      }
      if (!data || data.length === 0) {
        setFeedback(f => ({ ...f, [id]: "error" }));
        alert("Não foi guardado — provavelmente RLS está a bloquear UPDATE em profiles.");
        return;
      }
      setFeedback(f => ({ ...f, [id]: "saved" }));
      setTimeout(() => setFeedback(f => { const c = { ...f }; delete c[id]; return c; }), 1500);
    } catch (err) {
      setSavingId(null);
      alert("Erro inesperado: " + (err?.message || err));
    }
  };

  const safeProfiles = Array.isArray(profiles) ? profiles : [];

  // Descrição da função de cada utilizador conforme role + approval_level
  const funcaoDescricao = (u) => {
    if (!u) return "—";
    const r = u.role || "viewer";
    const lvl = u.approval_level ?? 0;
    const cria = u.can_create_mapas;
    const parts = [];
    if (r === "admin") parts.push("Gere o ERP e os utilizadores");
    else if (r === "gestor") parts.push("Edita faturas, movimentos e fluxo");
    else parts.push("Apenas consulta dados");
    if (lvl === 1) parts.push("Aprova mapas em 1.º nível");
    else if (lvl === 2) parts.push("Aprova mapas em 2.º nível (final)");
    if (cria) parts.push("Pode criar mapas de pagamento");
    return parts.join(" · ");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <SectionTitle>Gestão de Utilizadores</SectionTitle>
        <a href="https://supabase.com/dashboard/project/esymjdrvcpwsoevnqljq/auth/users" target="_blank" rel="noopener noreferrer"
          style={{ background: "#1a1a2e", color: "#fff", textDecoration: "none", padding: "9px 20px", borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
          + Novo Utilizador (no Supabase) ↗
        </a>
      </div>

      {/* Cards dos utilizadores reais */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 14 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "#888", gridColumn: "1 / -1" }}>A carregar utilizadores…</div>
        ) : safeProfiles.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "#888", gridColumn: "1 / -1" }}>Nenhum utilizador encontrado em <code>profiles</code>.</div>
        ) : safeProfiles.map(u => {
          if (!u || !u.id) return null;
          const nome = (u.nome && String(u.nome).trim()) || "(sem nome)";
          const isCurrent = u.id === currentUser.id;
          // Só quem tem approval_level >= 1 (Felipe, Henrique, Marcelo, Marcia) pode editar acessos de outros
          const podeEditarOutros = (currentUser?.approval_level ?? 0) >= 1;
          const editavel = podeEditarOutros && !isCurrent;
          const fb = feedback[u.id];
          const roleColor = u.role === "admin" ? "#dc2626" : u.role === "gestor" ? "#2563eb" : "#16a34a";
          const lvlColor = u.approval_level === 1 ? "#f59e0b" : u.approval_level === 2 ? "#3b82f6" : "#bbb";

          return (
            <div key={u.id} style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 12, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Header do card */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flex: 1, minWidth: 0 }}>
                  <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#1a1a2e", color: "#C8A96E", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, flexShrink: 0 }}>
                    {nome.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 700, color: "#1a1a2e", fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {nome}{isCurrent && <span style={{ marginLeft: 6, fontSize: 9, color: "#16a34a", textTransform: "uppercase", fontFamily: "monospace" }}>(tu)</span>}
                    </div>
                    <div style={{ fontSize: 10, color: "#bbb", fontFamily: "monospace", marginTop: 2 }} title={u.id}>
                      ID {String(u.id).slice(0, 8)}…
                    </div>
                  </div>
                </div>
                {fb === "saved" && <span style={{ fontSize: 9, color: "#16a34a", fontFamily: "monospace", whiteSpace: "nowrap" }}>✓ guardado</span>}
                {fb === "error" && <span style={{ fontSize: 9, color: "#dc2626", fontFamily: "monospace", whiteSpace: "nowrap" }}>✗ erro</span>}
              </div>

              {/* Função (descrição amigável) */}
              <div style={{ background: "#f8f9fc", borderRadius: 8, padding: "10px 12px", borderLeft: `3px solid ${roleColor}` }}>
                <div style={{ fontSize: 9, color: "#aaa", textTransform: "uppercase", fontFamily: "monospace", letterSpacing: "0.07em", marginBottom: 4 }}>Função</div>
                <div style={{ fontSize: 12, color: "#1a1a2e", lineHeight: 1.5 }}>{funcaoDescricao(u)}</div>
              </div>

              {/* Controlos */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 9, color: "#aaa", textTransform: "uppercase", fontFamily: "monospace", letterSpacing: "0.07em", marginBottom: 4 }}>Perfil</div>
                  <select value={u.role || "viewer"} disabled={!editavel}
                    onChange={e => updateField(u.id, "role", e.target.value)}
                    style={{ width: "100%", background: "#f8f8f8", border: `1px solid ${roleColor}40`, borderRadius: 6, padding: "6px 8px", fontSize: 11, outline: "none", cursor: editavel ? "pointer" : "not-allowed", color: roleColor, fontWeight: 600 }}>
                    <option value="viewer">Visualizador</option>
                    <option value="gestor">Gestor</option>
                    <option value="admin">Administrador</option>
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 9, color: "#aaa", textTransform: "uppercase", fontFamily: "monospace", letterSpacing: "0.07em", marginBottom: 4 }}>Aprovação</div>
                  <select value={u.approval_level ?? 0} disabled={!editavel}
                    onChange={e => updateField(u.id, "approval_level", parseInt(e.target.value))}
                    style={{ width: "100%", background: "#f8f8f8", border: `1px solid ${lvlColor}40`, borderRadius: 6, padding: "6px 8px", fontSize: 11, outline: "none", cursor: editavel ? "pointer" : "not-allowed", color: lvlColor, fontWeight: 600 }}>
                    <option value={0}>Sem aprovação</option>
                    <option value={1}>Nível 1</option>
                    <option value={2}>Nível 2 (final)</option>
                  </select>
                </div>
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: editavel ? "pointer" : "not-allowed", paddingTop: 4, borderTop: "1px solid #f5f5f5", opacity: editavel ? 1 : 0.6 }}>
                <input type="checkbox" checked={!!u.can_create_mapas} disabled={!editavel}
                  onChange={e => updateField(u.id, "can_create_mapas", e.target.checked)}
                  style={{ cursor: editavel ? "pointer" : "not-allowed", width: 16, height: 16 }} />
                <span style={{ fontSize: 11, color: "#666" }}>Pode criar mapas de pagamento</span>
              </label>
              {!podeEditarOutros && !isCurrent && (
                <div style={{ fontSize: 9, color: "#aaa", fontStyle: "italic", textAlign: "center", padding: "6px 0 0" }}>
                  🔒 Só aprovadores N1/N2 podem alterar acessos
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Legenda */}
      <Card>
        <SectionTitle>O que cada perfil pode fazer</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginBottom: 22 }}>
          {[
            { label: "Administrador", color: "#dc2626", perms: ["Ver tudo no ERP", "Editar tudo", "Gerir utilizadores", "Aceder a dados sensíveis"] },
            { label: "Gestor", color: "#2563eb", perms: ["Ver tudo", "Editar faturas", "Adicionar movimentos", "Exportar dados"] },
            { label: "Visualizador", color: "#16a34a", perms: ["Ver saldos", "Ver extratos", "Ver Real×Orçado", "Sem edição"] },
          ].map((p, i) => (
            <div key={i} style={{ background: "#fafafa", borderRadius: 10, padding: 16, borderLeft: `4px solid ${p.color}` }}>
              <div style={{ fontWeight: 700, color: "#1a1a2e", marginBottom: 10, fontSize: 14 }}>{p.label}</div>
              {p.perms.map(perm => (
                <div key={perm} style={{ fontSize: 12, color: "#555", marginBottom: 5, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: p.color }}>✓</span>{perm}
                </div>
              ))}
            </div>
          ))}
        </div>

        <SectionTitle>Níveis de aprovação para Mapas de Pagamento</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
          {[
            { label: "Sem aprovação (0)", color: "#888", desc: "Pode criar mapas mas não aprova. Útil para quem prepara o trabalho operacional." },
            { label: "Nível 1", color: "#f59e0b", desc: "Primeira aprovação do mapa. Verifica os itens e encaminha para o nível 2." },
            { label: "Nível 2", color: "#3b82f6", desc: "Aprovação final. Após este nível o mapa fica pronto para pagamento." },
          ].map((p, i) => (
            <div key={i} style={{ background: "#fafafa", borderRadius: 10, padding: 16, borderLeft: `4px solid ${p.color}` }}>
              <div style={{ fontWeight: 700, color: "#1a1a2e", marginBottom: 6, fontSize: 14 }}>{p.label}</div>
              <div style={{ fontSize: 12, color: "#666", lineHeight: 1.5 }}>{p.desc}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ─── IMPORTAR VIEW ────────────────────────────────────────────────────────────

// Chave de deduplicação de movimentos.
// Normaliza a data (o Supabase pode devolver "2026-07-16T00:00:00+00:00") e os
// números (numeric vem como "3936.00" ou 3936 conforme o driver). Sem isto, as
// chaves dos dois lados nunca batem e a deduplicação decide mal.
function movKey(m) {
  const data = String(m?.data || "").slice(0, 10);
  const n = (v) => {
    const x = Number(v);
    return Number.isFinite(x) ? x.toFixed(2) : "0.00";
  };
  const desc = String(m?.movimento || "").trim().replace(/\s+/g, " ");
  return `${data}|${desc}|${n(m?.valor)}|${n(m?.saldo)}`;
}

function ImportarView({faturas, setFaturas, caixaUnico, setCaixaUnico, setTab, addFatura, addFaturas, setLastImportedConta}) {
  const [subTab, setSubTab] = useState("fatura");

  const handleSaveMovimentos = async ({ empresa, banco, movimentos }) => {
    const lastSaldo = movimentos.find(m => m.saldo && m.saldo !== 0)?.saldo || 0;
    let insertedCount = 0;
    let skippedCount = 0;
    let errorMsg = "";
    // Não mudamos de tab aqui — o ImportarExtrato precisa de continuar montado
    // para receber o resultado e mostrar o ecrã verde/vermelho.

    // ⚠️ O conta_id TEM de ser resolvido aqui, de forma síncrona.
    // Antes era atribuído dentro do updater do setCaixaUnico; o React só corre
    // esse updater na render seguinte (excepto na optimização "eager state"),
    // por isso a variável chegava a null de forma intermitente e a importação
    // abortava com "conta_id não resolvido" sem nada ser gravado.
    const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    // A conta vem da lista oficial de sociedades; o snapshot estático já não
    // tem as contas novas (o cartão de crédito, por exemplo) e o id inventado
    // gravava os movimentos numa conta fantasma.
    const normC = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
    const oficial = EMPRESAS.find(e => e.id === empresa)?.contas.find(c => normC(c.banco) === normC(banco));
    const contasEmpresa = caixaUnico?.[empresa] || [];
    const contaExistente = contasEmpresa.find(c => norm(c.banco) === norm(banco));
    const contaIdToUpdate = oficial?.id
      || contaExistente?.conta_id || (empresa + "_" + banco.toLowerCase().replace(/\s/g, ""));

    if (!contaIdToUpdate) {
      return { ok: false, inserted: 0, skipped: 0, error: "conta_id não resolvido" };
    }

    setCaixaUnico(prev => {
      const updated = JSON.parse(JSON.stringify(prev));
      if (!updated[empresa]) updated[empresa] = [];
      const contaIdx = updated[empresa].findIndex(c => norm(c.banco) === norm(banco));
      const newMovs = movimentos.map(m => ({
        data: m.data, movimento: m.movimento, valor: m.valor,
        saldo: m.saldo, categoria: m.catEditada || m.categoria || "",
        subcategoria: m.subcategoria || "",
        detalhes: m.detalhes || "",
      }));
      if (contaIdx >= 0) {
        const existing = updated[empresa][contaIdx].movimentos || [];
        const existingKeys = new Set(existing.map(m => movKey(m)));
        const toAdd = newMovs.filter(m => !existingKeys.has(movKey(m)));
        updated[empresa][contaIdx] = {
          ...updated[empresa][contaIdx],
          saldo: lastSaldo,
          movimentos: [...existing, ...toAdd],
        };
      } else {
        updated[empresa] = [...updated[empresa], {
          conta_id: contaIdToUpdate, banco, sheet: empresa + "-" + banco,
          saldo: lastSaldo, movimentos: newMovs,
        }];
      }
      return updated;
    });

    try {
      // Garantir que a conta existe na tabela 'contas' (caso seja uma conta nova)
      await supabase.from('contas').upsert({
        id: contaIdToUpdate,
        empresa_id: empresa,
        banco,
        saldo: lastSaldo,
        updated_at: new Date().toISOString(),
      });

      // Get current existing movimentos for this conta (fresh from Supabase)
      const { data: existing, error: selErr } = await supabase
        .from('movimentos')
        .select('data, movimento, valor, saldo')
        .eq('conta_id', contaIdToUpdate);
      if (selErr) throw selErr;

      const existingKeys = new Set((existing || []).map(movKey));

      // Get current max seq — ignora NULL (NULLS LAST), senão pode vir null e ficar maxSeq baixo
      const { data: seqData } = await supabase
        .from('movimentos')
        .select('seq')
        .eq('conta_id', contaIdToUpdate)
        .not('seq', 'is', null)
        .order('seq', { ascending: false })
        .limit(1);
      const maxSeq = (seqData?.[0]?.seq ?? 0) + 10000;

      const filtered = movimentos
        .map((m, idx) => ({ m, idx }))
        .filter(({ m }) => !existingKeys.has(movKey(m)));
      skippedCount = movimentos.length - filtered.length;

      // seq: usa a posição DENTRO de `filtered` (antes usava o índice do array
      // original, o que gerava seq abaixo do maxSeq — e ordem trocada no extrato)
      const toInsert = filtered.map(({ m }, i) => ({
          conta_id: contaIdToUpdate,
          empresa_id: empresa,
          banco,
          data: m.data,
          movimento: m.movimento,
          valor: m.valor,
          saldo: m.saldo || 0,
          categoria: m.catEditada || m.categoria || '',
          subcategoria: m.subcategoria || '',
          detalhes: m.detalhes || '',
          seq: maxSeq + (filtered.length - i),
        }));

      if (toInsert.length > 0) {
        for (let i = 0; i < toInsert.length; i += 200) {
          const chunk = toInsert.slice(i, i + 200);
          const { data: insData, error: insErr } = await supabase.from('movimentos').insert(chunk).select();
          if (insErr) {
            console.error('❌ Insert movimentos error:', insErr);
            console.error('   message:', insErr.message);
            console.error('   details:', insErr.details);
            console.error('   hint:', insErr.hint);
            console.error('   code:', insErr.code);
            console.error('   payload (1ª linha):', chunk[0]);
            throw new Error(
              `${insErr.message || 'insert falhou'}${insErr.details ? ' · ' + insErr.details : ''}${insErr.hint ? ' · ' + insErr.hint : ''}${insErr.code ? ' [' + insErr.code + ']' : ''}`
            );
          }
          insertedCount += (insData?.length ?? chunk.length);
        }
        console.log(`✅ ${insertedCount} novos movimentos → Supabase (saldo=${lastSaldo})`);
      } else {
        console.log(`ℹ️ Nenhum movimento novo. ${skippedCount} já existiam.`);
      }

      // Update saldo da conta (após inserts ok)
      await supabase.from('contas')
        .update({ saldo: lastSaldo, updated_at: new Date().toISOString() })
        .eq('id', contaIdToUpdate);

      // Auto-open this conta in ExtratosView after data is in Supabase
      setLastImportedConta({ empresa, banco, contaId: contaIdToUpdate });
      return { ok: true, inserted: insertedCount, skipped: skippedCount, error: "" };
    } catch(e) {
      console.error('Supabase sync error:', e);
      errorMsg = e?.message || String(e);
      setLastImportedConta({ empresa, banco, contaId: contaIdToUpdate });
      return { ok: false, inserted: insertedCount, skipped: skippedCount, error: errorMsg };
    }
  }

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <div style={{display:"flex",gap:4,background:"#fff",border:"1px solid #f0f0f0",borderRadius:12,padding:6,width:"fit-content"}}>
        {[["fatura","🧾 Importar Fatura"],["extrato","📄 Importar Extrato"]].map(([id,label])=>(
          <button key={id} onClick={()=>setSubTab(id)}
            style={{background:subTab===id?"#1a1a2e":"none",color:subTab===id?"#fff":"#888",border:"none",padding:"8px 20px",borderRadius:8,fontSize:13,cursor:"pointer",fontWeight:subTab===id?700:400,transition:"all 0.15s"}}>
            {label}
          </button>
        ))}
      </div>
      <div style={{background:"#fff",border:"1px solid #f0f0f0",borderRadius:14,padding:28}}>
        {subTab==="fatura" && (
          <ImportarFatura onSave={async (arr) => {
            // arr é um array de objectos (1 fatura, ou N parcelas).
            // Mapeamos o schema do form para o schema da tabela `faturas`.
            const rows = arr.map(fat => ({
              id: fat.id,
              empresa: fat.empresa,
              projeto: fat.projeto || "",
              fatura: fat.numero_fatura || fat.id,
              fornecedor: fat.fornecedor_nome,
              categoria: fat.categoria,
              subcategoria: fat.subcategoria || "",
              valor: parseFloat(fat.valor_total) || 0,
              vencimento: fat.data_vencimento || fat.data_fatura || null,
              previsao_pagamento: fat.previsao_pagamento || null,
              status: fat.status || "Pendente",
              obs: fat.descricao_servico || fat.notas || "",
              anexo_nome: fat.anexo_nome || "",
              anexo_b64: fat.anexo_b64 || "",
            }));
            const { data, error } = await (addFaturas
              ? addFaturas(rows)
              : Promise.resolve({ data: null, error: new Error("addFaturas não disponível") })
            );
            if (error) {
              const msg = `${error.message || 'insert falhou'}${error.details ? ' · ' + error.details : ''}${error.hint ? ' · ' + error.hint : ''}${error.code ? ' ['+error.code+']' : ''}`;
              return { ok: false, inserted: 0, error: msg };
            }
            // Vai para Contas a Pagar após sucesso
            setTimeout(()=>setTab("pagar"), 1500);
            return { ok: true, inserted: (data?.length ?? rows.length), error: "" };
          }}/>
        )}
        {subTab==="extrato" && <ImportarExtrato onSaveMovimentos={handleSaveMovimentos} onGoToExtrato={()=>setTab("extrato")}/>}
      </div>
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
const TABS_CONFIG = [
  {id:"bi",        label:"BI",                roles:["admin","gestor","viewer"]},
  {id:"extrato",   label:"Extratos",          roles:["admin","gestor","viewer"]},
  {id:"caixaunico",label:"Caixa Único",        roles:["admin","gestor","viewer"]},
  {id:"comercial", label:"Comercial",          roles:["admin","gestor","viewer"]},
  {id:"orcado",    label:"Real × Orçado",      roles:["admin","gestor","viewer"]},
  {id:"fluxo",     label:"Fluxo Futuro",       roles:["admin","gestor","viewer"]},
  {id:"pagar",     label:"Contas a Pagar",     roles:["admin","gestor","viewer"]},
  {id:"pagamentos",label:"Pagamentos",         roles:["admin","gestor","viewer"]},
  {id:"entidades", label:"Entidades",          roles:["admin","gestor","viewer"]},
  {id:"importar",  label:"Importar",           roles:["admin","gestor"]},
  {id:"users",     label:"Utilizadores",       roles:["admin"]},
];

// ─── Error Boundary global ──────────────────────────────────────────────────
// Captura erros em runtime em qualquer subárvore para evitar a tela branca.
// Mostra mensagem útil e permite recarregar.
class TabErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error("Tab error:", err, info); }
  render() {
    if (this.state.err) {
      return (
        <div style={{ background: "#fff", border: "1px solid #fecaca", borderRadius: 12, padding: 40, textAlign: "center" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#1a1a2e" }}>Algo correu mal nesta aba</div>
          <div style={{ color: "#888", fontSize: 12, marginTop: 8, fontFamily: "monospace", maxWidth: 600, marginLeft: "auto", marginRight: "auto" }}>
            {String(this.state.err?.message || this.state.err)}
          </div>
          <button onClick={() => this.setState({ err: null })}
            style={{ marginTop: 18, background: "#1a1a2e", color: "#fff", border: "none", padding: "9px 22px", borderRadius: 8, fontSize: 13, cursor: "pointer", fontWeight: 600 }}>
            Tentar novamente
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const { user, profile, loading: authLoading, signIn, signOut } = useAuth();
  const { faturas, loading: faturasLoading, error: faturasErro, reload: reloadFaturas, addFatura, addFaturas, updateFatura, deleteFatura, carregarAnexo } = useFaturas();
  const { pagamentos: pagamentosExtras, loading: pagamentosLoading, addPagamento, updatePagamento, deletePagamento } = usePagamentosExtras();
  // Previsões e baixas são precisas no Contas a Pagar (para avisar que o custo
  // já está previsto) e no Fluxo Futuro (para não o contar duas vezes).
  const { recorrentes: recorrentesGlobais } = useDespesasRecorrentes();
  const { baixas: baixasPrevisoes, baixar: baixarPrevisao, anularPorFatura: anularBaixaPorFatura } = usePrevisoesBaixas();
  const { contas: supaContas, updateSaldo, upsertConta } = useContas();
  const { counts: movCounts, reload: reloadMovCounts } = useMovimentosCounts();
  const { entidades: entidadesGlobais } = useEntidades();
  const { profiles } = useProfiles();

  const [tab, setTab] = useState("bi");
  const [extratoRefreshKey, setExtratoRefreshKey] = useState(0);
  const [lastImportedConta, setLastImportedConta] = useState(null);

  // Tema (light/dark) — persistido em localStorage e aplicado a <html data-theme="...">
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem("rio_theme") || "light"; } catch { return "light"; }
  });
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("rio_theme", theme); } catch {}
  }, [theme]);
  const toggleTheme = () => setTheme(t => t === "dark" ? "light" : "dark");

  // caixaUnico is built from Supabase contas + local JSON for movimentos structure
  const [caixaUnico, setCaixaUnico] = useState({});

  // Load caixaUnico from JSON for movimentos structure (saldos come from Supabase)
  useEffect(() => {
    fetch("/caixa_unico_v2.json").then(r=>r.json()).then(d=>setCaixaUnico(d)).catch(()=>{});
  }, []);

  // Merge live Supabase saldos into caixaUnico — real-time
  useEffect(() => {
    if (!supaContas.length) return;
    setCaixaUnico(prev => {
      const updated = JSON.parse(JSON.stringify(prev));
      supaContas.forEach(sc => {
        if (updated[sc.empresa_id]) {
          const idx = updated[sc.empresa_id].findIndex(c => c.conta_id === sc.id || c.banco === sc.banco);
          if (idx >= 0) updated[sc.empresa_id][idx].saldo = sc.saldo;
        }
      });
      return updated;
    });
  }, [supaContas]);

  const handleSetCaixaUnico = (updater) => {
    setCaixaUnico(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      return next;
    });
  };

  const handleAddFatura = async (fat) => {
    await addFatura(fat);
    setTimeout(() => setTab("pagar"), 1500);
  };

  const handleSetFaturas = (_updater) => {
    // no-op: faturas come from Supabase realtime
  };

  if (authLoading) return <EcraCarregar />;

  if (!user) return <Login />;

  // Build user object from Supabase profile
  const currentUser = {
    id: user.id,
    nome: profile?.nome || user.email?.split('@')[0] || 'Utilizador',
    email: user.email,
    role: profile?.role || 'viewer',
    approval_level: profile?.approval_level || 0,
    can_create_mapas: profile?.can_create_mapas || false,
  };

  const canEdit = currentUser.role === "admin" || currentUser.role === "gestor";
  const availTabs = TABS_CONFIG.filter(t => t.roles.includes(currentUser.role));

  return (
    <div style={{minHeight:"100vh",background:"#f4f5f7",fontFamily:"Georgia,sans-serif"}}>
      {/* Topbar */}
      <div style={{background:"#fff",borderBottom:"1px solid #eee",padding:"0 28px",position:"sticky",top:0,zIndex:50,boxShadow:"0 1px 8px rgba(0,0,0,0.04)"}}>
        <div style={{display:"flex",alignItems:"center",gap:16,height:56}}>
          <img src="/logo-rio-horizontal.png" alt="Rio Capital" className="logo-rio"
            style={{height:26,width:"auto",marginRight:8,display:"block",flexShrink:0}} />
          <div style={{fontSize:17,fontWeight:700,color:"#1a1a2e",fontFamily:"Georgia,serif",flex:1,display:"flex",alignItems:"baseline",gap:8}}>
            Dashboard Financeiro
            <span title="Versão publicada do ERP" style={{fontSize:10,fontWeight:400,color:"#bbb",fontFamily:"monospace"}}>{VERSAO_ERP}</span>
          </div>
          <div style={{display:"flex",gap:2,flexWrap:"wrap"}}>
            {availTabs.map(t=>(
              <button key={t.id} onClick={()=>{
                setTab(t.id);
                // Refresh automático ao entrar no tab Extratos
                if (t.id === "extrato") reloadMovCounts?.();
              }}
                style={{background:tab===t.id?"#1a1a2e":"none",color:tab===t.id?"#fff":"#888",border:"none",padding:"7px 15px",borderRadius:7,fontSize:12,cursor:"pointer",fontWeight:tab===t.id?600:400,whiteSpace:"nowrap"}}>
                {t.label}
              </button>
            ))}
          </div>
          {/* User badge */}
          <div style={{display:"flex",alignItems:"center",gap:8,borderLeft:"1px solid #f0f0f0",paddingLeft:16,marginLeft:8}}>
            <div style={{width:30,height:30,borderRadius:"50%",background:"#1a1a2e",color:"#C8A96E",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700}}>
              {currentUser.nome.charAt(0).toUpperCase()}
            </div>
            <div>
              <div style={{fontSize:12,fontWeight:600,color:"#1a1a2e",lineHeight:1.2}}>{currentUser.nome}</div>
              <div style={{display:"flex",gap:4,alignItems:"center"}}>
                <Chip text={ROLE_LABELS[currentUser.role]} color={ROLE_COLORS[currentUser.role]}/>
                {currentUser.approval_level === 1 && <Chip text="Aprovador N1" color="#f59e0b"/>}
                {currentUser.approval_level === 2 && <Chip text="Aprovador N2" color="#3b82f6"/>}
              </div>
            </div>
            <button onClick={toggleTheme} title={theme==="dark"?"Mudar para tema claro":"Mudar para tema escuro"}
              style={{background:"none",border:"1px solid #eee",borderRadius:6,padding:"4px 10px",fontSize:13,color:"#666",cursor:"pointer",marginLeft:4}}>
              {theme==="dark" ? "☀️" : "🌙"}
            </button>
            <button onClick={signOut} style={{background:"none",border:"1px solid #eee",borderRadius:6,padding:"4px 10px",fontSize:11,color:"#aaa",cursor:"pointer",marginLeft:4}}>Sair</button>
          </div>
        </div>
      </div>

      <div style={{padding:"28px",maxWidth:1500,margin:"0 auto"}}>
        <TabErrorBoundary key={tab}>
          {tab==="bi"        && <BIView EMPRESAS={EMPRESAS} caixaUnico={caixaUnico} faturas={faturas} pagamentosExtras={pagamentosExtras}/>}
          {tab==="extrato"   && <ExtratosView EMPRESAS={EMPRESAS} extrato={[]} caixaUnico={caixaUnico} setCaixaUnico={handleSetCaixaUnico} currentUser={currentUser} autoOpenConta={lastImportedConta} movCounts={movCounts} reloadMovCounts={reloadMovCounts} entidades={entidadesGlobais} faturas={faturas} pagamentosExtras={pagamentosExtras} onUpdateFatura={updateFatura} onUpdatePagamento={updatePagamento}/>}
          {tab==="caixaunico"&& <CaixaUnicoView/>}
          {tab==="comercial" && <ComercialView currentUser={currentUser} onAddFatura={addFatura}/>}
          {tab==="orcado"    && <RealOrcado/>}
          {tab==="fluxo"     && <FluxoFuturo faturas={faturas} faturasLoading={faturasLoading} pagamentosExtras={pagamentosExtras} pagamentosLoading={pagamentosLoading} onAddPagamento={addPagamento} onUpdatePagamento={updatePagamento} onDeletePagamento={deletePagamento} onUpdateFatura={updateFatura} onDeleteFatura={deleteFatura} currentUser={currentUser} EMPRESAS={EMPRESAS} caixaUnico={caixaUnico}/>}
          {tab==="pagar"     && <ContasPagar canEdit={canEdit} carregarAnexo={carregarAnexo} faturasErro={faturasErro} reloadFaturas={reloadFaturas} faturas={faturas} setFaturas={handleSetFaturas} addFatura={addFatura} updateFatura={updateFatura} deleteFatura={deleteFatura}
                                             pagamentosExtras={pagamentosExtras} recorrentes={recorrentesGlobais} baixas={baixasPrevisoes} baixarPrevisao={baixarPrevisao} anularBaixaPorFatura={anularBaixaPorFatura}/>}
          {tab==="pagamentos"&& <PagamentosView faturas={faturas} carregarAnexo={carregarAnexo} pagamentosExtras={pagamentosExtras} currentUser={currentUser} profiles={profiles} />}
          {tab==="users"     && <Utilizadores currentUser={currentUser}/>}
          {tab==="entidades" && <EntidadesView currentUser={currentUser}/>}
          {tab==="importar"  && <ImportarView
            faturas={faturas} setFaturas={handleSetFaturas}
            caixaUnico={caixaUnico} setCaixaUnico={handleSetCaixaUnico}
            setTab={setTab} addFatura={addFatura} addFaturas={addFaturas}
            setLastImportedConta={setLastImportedConta}
          />}
        </TabErrorBoundary>
      </div>
    </div>
  );
}
