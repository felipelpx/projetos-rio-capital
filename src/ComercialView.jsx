import { useState, useMemo, useEffect } from "react";
import { useFracoes, useVendas } from "./hooks.js";
import { fmtEuro, fmtPercent } from "./format.js";

const STATUS_OPTIONS = ["Disponível", "Reservada", "CPCV", "Escriturada"];
const STATUS_STYLES = {
  "Disponível":  { bg:"#f8f9fc", text:"#888",    border:"#e0e0e0" },
  "Reservada":   { bg:"#fffbeb", text:"#d97706",  border:"#fde68a" },
  "CPCV":        { bg:"#eff6ff", text:"#2563eb",  border:"#bfdbfe" },
  "Escriturada": { bg:"#f0fdf4", text:"#16a34a",  border:"#bbf7d0" },
};

const fmt = v => fmtEuro(v);
const fmtPct = v => fmtPercent(v);

const inp = {background:"#f8f8f8",border:"1px solid #eee",borderRadius:7,padding:"7px 10px",fontSize:12,outline:"none",width:"100%",boxSizing:"border-box"};
const lbl = {fontSize:9,color:"#aaa",fontFamily:"monospace",textTransform:"uppercase",letterSpacing:"0.07em",display:"block",marginBottom:3};

// ─── COMISSÃO MODAL ────────────────────────────────────────────────────────────
function ComissaoModal({ venda, fracao, onSave, onClose, onGerarFatura }) {
  // Multiple mediadores support
  const [mediadores, setMediadores] = useState(
    venda.mediadores?.length > 0 ? venda.mediadores :
    [{ nome: venda.mediador||"", pct: venda.comissao_pct||0, parcelas: venda.comissao_parcelas?.length > 0 ? venda.comissao_parcelas : [
      ...(venda.comissao_paga_sinal > 0 ? [{ valor: venda.comissao_paga_sinal, data: venda.data_pagamento_sinal||"", pago: true, desc:"Sinal" }] : []),
      ...(venda.comissao_paga_escritura > 0 ? [{ valor: venda.comissao_paga_escritura, data: venda.data_pagamento_escritura||"", pago: true, desc:"Escritura" }] : []),
      ...(venda.comissao_pendente_sinal > 0 ? [{ valor: venda.comissao_pendente_sinal, data: venda.data_pagamento_sinal||"", pago: false, desc:"Sinal pend." }] : []),
      ...(venda.comissao_pendente_escritura > 0 ? [{ valor: venda.comissao_pendente_escritura, data: venda.data_pagamento_escritura||"", pago: false, desc:"Escritura pend." }] : []),
    ]}]
  );

  const totalComissao = mediadores.reduce((s,m) => s + (venda.valor_venda||0) * ((parseFloat(m.pct)||0)/100), 0);
  const totalPago = mediadores.reduce((s,m) => s + m.parcelas.filter(p=>p.pago).reduce((ps,p)=>ps+(parseFloat(p.valor)||0),0), 0);
  const totalPend = mediadores.reduce((s,m) => s + m.parcelas.filter(p=>!p.pago).reduce((ps,p)=>ps+(parseFloat(p.valor)||0),0), 0);
  const faturaJaCriada = venda.fatura_criada;

  const addMediador = () => setMediadores(ms=>[...ms,{nome:"",pct:0,parcelas:[]}]);
  const removeMediador = (i) => setMediadores(ms=>ms.filter((_,idx)=>idx!==i));
  const updMed = (i,f,v) => setMediadores(ms=>ms.map((m,idx)=>idx===i?{...m,[f]:v}:m));
  const addParcela = (mi) => setMediadores(ms=>ms.map((m,idx)=>idx===mi?{...m,parcelas:[...m.parcelas,{valor:"",data:"",pago:false,desc:""}]}:m));
  const updParcela = (mi,pi,f,v) => setMediadores(ms=>ms.map((m,midx)=>midx===mi?{...m,parcelas:m.parcelas.map((p,pidx)=>pidx===pi?{...p,[f]:v}:p)}:m));
  const removeParcela = (mi,pi) => setMediadores(ms=>ms.map((m,midx)=>midx===mi?{...m,parcelas:m.parcelas.filter((_,pidx)=>pidx!==pi)}:m));

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{background:"#fff",borderRadius:16,padding:28,width:620,maxWidth:"95vw",maxHeight:"90vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.25)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <div>
            <div style={{fontSize:16,fontWeight:700,color:"#1a1a2e",fontFamily:"Georgia,serif"}}>🤝 Comissão — {venda.cliente}</div>
            <div style={{fontSize:11,color:"#aaa",marginTop:2}}>{fracao?.projeto} · {fracao?.fracao}</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#aaa"}}>✕</button>
        </div>

        {/* Valores */}
        <div style={{background:"#f8f9fc",borderRadius:10,padding:14,marginBottom:16,display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div><div style={lbl}>Valor de Venda</div><div style={{fontSize:14,fontWeight:700,color:"#1a1a2e",fontFamily:"monospace"}}>{fmt(venda.valor_venda)}</div></div>
          <div>
            <div style={lbl}>Total Comissões ({fmtPct(mediadores.reduce((s,m)=>s+(parseFloat(m.pct)||0),0))})</div>
            <div style={{fontSize:14,fontWeight:700,color:"#dc2626",fontFamily:"monospace"}}>{fmt(totalComissao)}</div>
          </div>
        </div>

        {/* Múltiplos Mediadores */}
        <div style={{marginBottom:16}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div style={{fontSize:12,fontWeight:700,color:"#1a1a2e"}}>🤝 Mediadores</div>
            <button onClick={addMediador}
              style={{background:"#f0f4ff",border:"1px solid #bfdbfe",color:"#2563eb",padding:"4px 12px",borderRadius:6,fontSize:11,cursor:"pointer",fontWeight:600}}>+ Mediador</button>
          </div>
          {mediadores.map((med,mi)=>(
            <div key={mi} style={{background:"#f8f9fc",borderRadius:10,padding:14,marginBottom:10,border:"1px solid #e8e8e8"}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr auto auto",gap:10,marginBottom:10,alignItems:"end"}}>
                <div>
                  <label style={lbl}>Nome do Mediador</label>
                  <input type="text" value={med.nome} onChange={e=>updMed(mi,"nome",e.target.value)} style={inp} placeholder="Nome..."/>
                </div>
                <div>
                  <label style={lbl}>% Comissão</label>
                  <input type="number" value={med.pct} onChange={e=>updMed(mi,"pct",parseFloat(e.target.value)||0)} style={{...inp,width:80,color:"#4a6fa5",fontWeight:700}} step="0.1"/>
                </div>
                <div style={{display:"flex",gap:6,alignItems:"flex-end",paddingBottom:2}}>
                  <span style={{fontSize:12,fontFamily:"monospace",color:"#dc2626",fontWeight:700,whiteSpace:"nowrap"}}>{fmt((venda.valor_venda||0)*(med.pct/100))}</span>
                  {mediadores.length>1&&<button onClick={()=>removeMediador(mi)}
                    style={{background:"#fff0f0",border:"none",color:"#dc2626",padding:"5px 8px",borderRadius:5,cursor:"pointer",fontSize:11}}>✕</button>}
                </div>
              </div>
              {/* Parcelas do mediador */}
              <div style={{paddingLeft:8,borderLeft:"2px solid #e0e0e0"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                  <div style={{fontSize:10,color:"#aaa",fontFamily:"monospace",textTransform:"uppercase"}}>Parcelas</div>
                  <button onClick={()=>addParcela(mi)}
                    style={{background:"#fff",border:"1px solid #ddd",color:"#888",padding:"2px 8px",borderRadius:4,fontSize:10,cursor:"pointer"}}>+ Parcela</button>
                </div>
                {med.parcelas.length===0&&<div style={{color:"#ccc",fontSize:11,padding:"6px 0"}}>Sem parcelas.</div>}
                {med.parcelas.map((p,pi)=>(
                  <div key={pi} style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr auto auto",gap:6,marginBottom:5,alignItems:"end"}}>
                    <input type="text" value={p.desc||""} onChange={e=>updParcela(mi,pi,"desc",e.target.value)} style={{...inp,fontSize:11}} placeholder="Descrição"/>
                    <input type="number" value={p.valor} onChange={e=>updParcela(mi,pi,"valor",e.target.value)} style={{...inp,fontSize:11,color:"#dc2626",fontWeight:600}} placeholder="Valor €"/>
                    <input type="date" value={p.data||""} onChange={e=>updParcela(mi,pi,"data",e.target.value)} style={{...inp,fontSize:11}}/>
                    <label style={{display:"flex",alignItems:"center",gap:3,fontSize:10,color:"#888",cursor:"pointer",whiteSpace:"nowrap"}}>
                      <input type="checkbox" checked={!!p.pago} onChange={e=>updParcela(mi,pi,"pago",e.target.checked)}/>Pago
                    </label>
                    <button onClick={()=>removeParcela(mi,pi)}
                      style={{background:"#fff0f0",border:"none",color:"#dc2626",padding:"4px 6px",borderRadius:4,cursor:"pointer",fontSize:10}}>✕</button>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div style={{display:"flex",justifyContent:"flex-end",gap:16,fontSize:12,fontFamily:"monospace",borderTop:"1px solid #f0f0f0",paddingTop:8}}>
            <span style={{color:"#16a34a"}}>✓ Pago: {fmt(totalPago)}</span>
            <span style={{color:"#dc2626"}}>⏳ Pendente: {fmt(totalPend)}</span>
            <span style={{color:"#1a1a2e",fontWeight:700}}>Total Comissões: {fmt(totalComissao)}</span>
          </div>
        </div>

        {/* Fatura */}
        <div style={{background:faturaJaCriada?"#f0fdf4":"#f8f9fc",border:`1px solid ${faturaJaCriada?"#bbf7d0":"#e0e0e0"}`,borderRadius:10,padding:"12px 16px",marginBottom:20,display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}>
          <div style={{fontSize:12,color:faturaJaCriada?"#16a34a":"#888"}}>
            {faturaJaCriada?"✅ Fatura já criada em Contas a Pagar":"⏳ Fatura ainda não criada em Contas a Pagar"}
          </div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>onGerarFatura({
                ...venda,
                mediadores,
                mediador: mediadores.map(m=>m.nome).filter(Boolean).join(', '),
                comissao_pct: mediadores.reduce((s,m)=>s+(parseFloat(m.pct)||0),0),
                comissao_valor: totalComissao,
                comissao_parcelas: mediadores.flatMap(m=>m.parcelas.map(p=>({...p,mediador:m.nome}))),
              })}
              disabled={faturaJaCriada}
              style={{background:faturaJaCriada?"#e0e0e0":"#1a1a2e",color:"#fff",border:"none",padding:"7px 16px",borderRadius:7,fontSize:11,cursor:faturaJaCriada?"default":"pointer",fontWeight:700,opacity:faturaJaCriada?0.6:1,whiteSpace:"nowrap"}}>
              {faturaJaCriada?"✓ Fatura criada":"📄 Gerar Fatura → Contas a Pagar"}
            </button>
          </div>
        </div>

        <div style={{display:"flex",justifyContent:"space-between"}}>
          <button onClick={onClose} style={{background:"#f0f0f0",color:"#666",border:"none",padding:"10px 20px",borderRadius:8,fontSize:13,cursor:"pointer"}}>Cancelar</button>
          <button onClick={()=>onSave({
              mediadores,
              mediador: mediadores.map(m=>m.nome).filter(Boolean).join(', '),
              comissao_pct: mediadores.reduce((s,m)=>s+(parseFloat(m.pct)||0),0),
              comissao_valor: totalComissao,
              comissao_parcelas: mediadores.flatMap(m=>m.parcelas.map(p=>({...p,mediador:m.nome}))),
              comissao_paga_sinal: totalPago,
              comissao_pendente_sinal: totalPend,
            })}
            style={{background:"#16a34a",color:"#fff",border:"none",padding:"10px 24px",borderRadius:8,fontSize:13,cursor:"pointer",fontWeight:700}}>
            💾 Guardar Comissão
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── EDIT VENDA MODAL ──────────────────────────────────────────────────────────
function EditVendaModal({ venda, fracao, onSave, onClose }) {
  const [f, setF] = useState({...venda});
  const s = (k,v) => setF(prev=>({...prev,[k]:v}));
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{background:"#fff",borderRadius:16,padding:28,width:620,maxWidth:"95vw",maxHeight:"90vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.25)"}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:20}}>
          <div style={{fontSize:16,fontWeight:700,color:"#1a1a2e",fontFamily:"Georgia,serif"}}>✎ Editar — {fracao?.fracao}</div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#aaa"}}>✕</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
          {[["Cliente","cliente","text"],["NIF","nif","text"],["Email","email","email"],["Telefone","telefone","text"],
            ["Valor de Venda (€)","valor_venda","number"],["Preço Tabela (€)","preco_tabela","number"],
            ["Recebido (€)","recebemos","number"],["Prev. Escritura","previsao_escritura","date"],
            ["Mediador","mediador","text"],["Data Venda","data","date"],
          ].map(([label,name,type])=>(
            <div key={name} style={{display:"flex",flexDirection:"column",gap:3}}>
              <label style={lbl}>{label}</label>
              <input type={type} value={f[name]||""} onChange={e=>s(name,type==="number"?parseFloat(e.target.value)||0:e.target.value)} style={inp}/>
            </div>
          ))}
        </div>
        <div style={{display:"flex",justifyContent:"flex-end",gap:10,marginTop:20}}>
          <button onClick={onClose} style={{background:"#f0f0f0",color:"#666",border:"none",padding:"10px 20px",borderRadius:8,fontSize:13,cursor:"pointer"}}>Cancelar</button>
          <button onClick={()=>onSave(f)} style={{background:"#1a1a2e",color:"#fff",border:"none",padding:"10px 24px",borderRadius:8,fontSize:13,cursor:"pointer",fontWeight:700}}>💾 Guardar</button>
        </div>
      </div>
    </div>
  );
}

// ─── TABELA DE VENDAS ──────────────────────────────────────────────────────────
function TabelaVendas({ fracoes, vendas, canEdit, onAddFatura, onUpdateFracao, onUpdateVenda, onUpsertVenda }) {
  const [filterProj, setFilterProj] = useState("Todos");
  const [filterStatus, setFilterStatus] = useState("Todos");
  const [search, setSearch] = useState("");
  const [editVenda, setEditVenda] = useState(null);
  const [editComissao, setEditComissao] = useState(null);

  const projetos = useMemo(()=>["Todos",...new Set(fracoes.map(f=>f.projeto).filter(Boolean))],[fracoes]);

  const rows = useMemo(()=>vendas.map(v=>{
    const frac = fracoes.find(f=>f.id===v.fracao_id);
    return {...v,_frac:frac};
  }).filter(v=>
    (filterProj==="Todos"||v._frac?.projeto===filterProj)&&
    (filterStatus==="Todos"||v._frac?.status===filterStatus)&&
    (!search||(v.cliente||"").toLowerCase().includes(search.toLowerCase())||(v._frac?.fracao||"").toLowerCase().includes(search.toLowerCase()))
  ),[vendas,fracoes,filterProj,filterStatus,search]);

  const totais = useMemo(()=>({
    vgv:rows.reduce((s,v)=>s+(v.valor_venda||0),0),
    recebido:rows.reduce((s,v)=>s+(v.recebemos||0),0),
    aReceber:rows.reduce((s,v)=>s+(v.falta_receber||0),0),
    comPago:rows.reduce((s,v)=>s+(v.comissao_paga_sinal||0)+(v.comissao_paga_escritura||0),0),
    comPend:rows.reduce((s,v)=>s+(v.comissao_pendente_sinal||0)+(v.comissao_pendente_escritura||0),0),
    liquido:rows.reduce((s,v)=>s+(v.liquido_empresa||0),0),
  }),[rows]);

  const handleGerarFatura = (venda) => {
    const frac = fracoes.find(f=>f.id===venda.fracao_id);
    onAddFatura?.({
      id:"fat_com_"+venda.id, empresa:"riocap",
      projeto:frac?.projeto||"",
      fatura:`COM-${venda.id.slice(-6).toUpperCase()}`,
      fornecedor:venda.mediador||"Mediador",
      categoria:"Comissão", tipo_projeto:frac?.projeto||"",
      valor:venda.comissao_valor||0,
      vencimento:(venda.comissao_parcelas||[]).find(p=>!p.pago)?.data||"",
      status:"Pendente",
      obs:`Comissão venda — ${frac?.fracao||""} — ${venda.cliente||""}`,
      anexo_nome:"",anexo_b64:"",
    });
    onUpsertVenda?.({...venda, fatura_criada:true});
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
        {[
          {label:"VGV Total",value:fmt(totais.vgv),color:"#1a1a2e"},
          {label:"Recebido",value:fmt(totais.recebido),color:"#16a34a"},
          {label:"A Receber",value:fmt(totais.aReceber),color:"#d97706"},
          {label:"Comissão Paga",value:fmt(totais.comPago),color:"#888"},
          {label:"Comissão Pendente",value:fmt(totais.comPend),color:"#dc2626"},
          {label:"Líquido Empresa",value:fmt(totais.liquido),color:"#1a1a2e"},
        ].map((k,i)=>(
          <div key={i} style={{background:"#fff",border:"1px solid #f0f0f0",borderRadius:10,padding:"12px 16px",borderTop:`3px solid ${k.color}`}}>
            <div style={{fontSize:9,color:"#aaa",textTransform:"uppercase",fontFamily:"monospace",marginBottom:4}}>{k.label}</div>
            <div style={{fontSize:16,fontWeight:700,color:k.color,fontFamily:"monospace"}}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Pesquisar cliente ou fração..."
          style={{flex:2,minWidth:160,...inp,padding:"8px 14px"}}/>
        <select value={filterProj} onChange={e=>setFilterProj(e.target.value)} style={{...inp,flex:1,minWidth:130}}>
          {projetos.map(p=><option key={p}>{p}</option>)}
        </select>
        <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={{...inp,flex:1,minWidth:120}}>
          {["Todos",...STATUS_OPTIONS].map(s=><option key={s}>{s}</option>)}
        </select>
      </div>

      {/* Table */}
      <div style={{background:"#fff",border:"1px solid #f0f0f0",borderRadius:14,overflow:"hidden"}}>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
            <thead>
              <tr style={{background:"#f8f9fc"}}>
                {["Projeto","Fração","Tipo","Andar","Cliente","Mediador","Preço Tab.","Valor Venda","Recebido","A Receber","Prev. Escritura","Com. %","Com. Paga","Com. Pend.","Líquido","Status","Ações"].map(h=>(
                  <th key={h} style={{padding:"9px 10px",textAlign:"left",color:"#aaa",fontSize:9,letterSpacing:"0.07em",textTransform:"uppercase",fontFamily:"monospace",borderBottom:"1px solid #f0f0f0",whiteSpace:"nowrap"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length===0
                ?<tr><td colSpan={17} style={{padding:"40px",textAlign:"center",color:"#ccc"}}>Nenhuma venda encontrada.</td></tr>
                :rows.map(v=>{
                  const comPago=(v.comissao_paga_sinal||0)+(v.comissao_paga_escritura||0);
                  const comPend=(v.comissao_pendente_sinal||0)+(v.comissao_pendente_escritura||0);
                  const comPct=v.comissao_valor&&v.valor_venda?(v.comissao_valor/v.valor_venda*100):(v.comissao_pct||0);
                  return (
                    <tr key={v.id} style={{borderBottom:"1px solid #fafafa"}}
                      onMouseEnter={e=>e.currentTarget.style.background="#f8f9fc"}
                      onMouseLeave={e=>e.currentTarget.style.background=""}>
                      <td style={{padding:"8px 10px",color:"#888",whiteSpace:"nowrap",fontSize:10}}>{v._frac?.projeto||"—"}</td>
                      <td style={{padding:"8px 10px",fontWeight:700,color:"#1a1a2e",whiteSpace:"nowrap"}}>{v._frac?.fracao||"—"}</td>
                      <td style={{padding:"8px 10px"}}><span style={{background:"#f0f4ff",color:"#4a6fa5",fontSize:9,padding:"1px 6px",borderRadius:4}}>{v._frac?.tipologia||"—"}</span></td>
                      <td style={{padding:"8px 10px",color:"#888",fontSize:10}}>{v._frac?.andar||"—"}</td>
                      <td style={{padding:"8px 10px",color:"#333",maxWidth:130,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{v.cliente||"—"}</td>
                      <td style={{padding:"8px 10px",color:"#888",fontSize:10,whiteSpace:"nowrap"}}>{v.mediador||"—"}</td>
                      <td style={{padding:"8px 10px",color:"#aaa",fontFamily:"monospace",whiteSpace:"nowrap"}}>{fmt(v.preco_tabela)}</td>
                      <td style={{padding:"8px 10px",fontWeight:700,color:"#1a1a2e",fontFamily:"monospace",whiteSpace:"nowrap"}}>{fmt(v.valor_venda)}</td>
                      <td style={{padding:"8px 10px",color:"#16a34a",fontFamily:"monospace",whiteSpace:"nowrap"}}>{fmt(v.recebemos)}</td>
                      <td style={{padding:"8px 10px",color:((v.valor_venda||0)-(v.recebemos||0))>0?"#d97706":"#aaa",fontFamily:"monospace",fontWeight:((v.valor_venda||0)-(v.recebemos||0))>0?700:400,whiteSpace:"nowrap"}}>{((v.valor_venda||0)-(v.recebemos||0))>0?fmt((v.valor_venda||0)-(v.recebemos||0)):"—"}</td>
                      <td style={{padding:"8px 10px",color:"#888",fontFamily:"monospace",fontSize:10,whiteSpace:"nowrap"}}>{v.previsao_escritura||"—"}</td>
                      <td style={{padding:"8px 10px",color:"#4a6fa5",fontFamily:"monospace",whiteSpace:"nowrap"}}>{fmtPct(comPct)}</td>
                      <td style={{padding:"8px 10px",color:"#16a34a",fontFamily:"monospace",whiteSpace:"nowrap"}}>{comPago>0?fmt(comPago):"—"}</td>
                      <td style={{padding:"8px 10px",color:comPend>0?"#dc2626":"#aaa",fontFamily:"monospace",fontWeight:comPend>0?700:400,whiteSpace:"nowrap"}}>{comPend>0?fmt(comPend):"—"}</td>
                      <td style={{padding:"8px 10px",fontFamily:"monospace",fontWeight:700,color:"#1a1a2e",whiteSpace:"nowrap"}}>{fmt((v.valor_venda||0)-(v.comissao_valor||0))}</td>
                      <td style={{padding:"8px 10px"}}>
                        {v._frac&&<select value={v._frac.status} onChange={e=>onUpdateFracao?.(v._frac.id, {status:e.target.value})}
                          style={{background:"none",border:"none",fontSize:10,cursor:canEdit?"pointer":"default",color:STATUS_STYLES[v._frac.status]?.text||"#888",fontWeight:600,outline:"none",pointerEvents:canEdit?"auto":"none"}}>
                          {STATUS_OPTIONS.map(s=><option key={s}>{s}</option>)}
                        </select>}
                      </td>
                      <td style={{padding:"8px 10px"}}>
                        <div style={{display:"flex",gap:4,alignItems:"center",flexWrap:"nowrap"}}>
                          {canEdit&&<>
                            <button onClick={()=>setEditVenda(v)} title="Editar venda"
                              style={{background:"#f0f4ff",border:"none",color:"#4a6fa5",padding:"3px 7px",borderRadius:5,fontSize:10,cursor:"pointer"}}>✎</button>
                            <button onClick={()=>setEditComissao(v)} title="Editar comissão"
                              style={{background:"#fffbeb",border:"1px solid #fde68a",color:"#d97706",padding:"3px 7px",borderRadius:5,fontSize:10,cursor:"pointer",fontWeight:600}}>🤝</button>
                          </>}
                          {v.fatura_criada&&<span style={{fontSize:9,color:"#16a34a",border:"1px solid #bbf7d0",background:"#f0fdf4",padding:"2px 5px",borderRadius:4,fontFamily:"monospace"}}>✓Fat.</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })
              }
            </tbody>
            {rows.length>0&&(
              <tfoot>
                <tr style={{background:"#f0f4ff",borderTop:"2px solid #dde3f0"}}>
                  <td colSpan={6} style={{padding:"9px 10px",fontSize:10,color:"#4a6fa5",fontWeight:700}}>TOTAIS ({rows.length})</td>
                  <td style={{padding:"9px 10px",fontFamily:"monospace",fontWeight:700,color:"#aaa"}}>{fmt(rows.reduce((s,v)=>s+(v.preco_tabela||0),0))}</td>
                  <td style={{padding:"9px 10px",fontFamily:"monospace",fontWeight:700,color:"#1a1a2e"}}>{fmt(totais.vgv)}</td>
                  <td style={{padding:"9px 10px",fontFamily:"monospace",fontWeight:700,color:"#16a34a"}}>{fmt(totais.recebido)}</td>
                  <td style={{padding:"9px 10px",fontFamily:"monospace",fontWeight:700,color:"#d97706"}}>{fmt(totais.aReceber)}</td>
                  <td/><td/>
                  <td style={{padding:"9px 10px",fontFamily:"monospace",fontWeight:700,color:"#16a34a"}}>{fmt(totais.comPago)}</td>
                  <td style={{padding:"9px 10px",fontFamily:"monospace",fontWeight:700,color:"#dc2626"}}>{fmt(totais.comPend)}</td>
                  <td style={{padding:"9px 10px",fontFamily:"monospace",fontWeight:700,color:"#1a1a2e"}}>{fmt(rows.reduce((s,v)=>s+(v.valor_venda||0)-(v.comissao_valor||0),0))}</td>
                  <td colSpan={2}/>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {editVenda&&<EditVendaModal venda={editVenda} fracao={editVenda._frac}
        onSave={u=>{onUpdateVenda?.(editVenda.id,u);setEditVenda(null);}}
        onClose={()=>setEditVenda(null)}/>}
      {editComissao&&<ComissaoModal venda={editComissao} fracao={editComissao._frac}
        onSave={u=>{onUpdateVenda?.(editComissao.id,u);setEditComissao(null);}}
        onClose={()=>setEditComissao(null)}
        onGerarFatura={v=>{handleGerarFatura(v);setEditComissao(null);}}/>}
    </div>
  );
}

// ─── MAIN ──────────────────────────────────────────────────────────────────────
export default function ComercialView({ currentUser, onAddFatura }) {
  const { fracoes, loaded: fracoesLoaded, upsertFracao, deleteFracao } = useFracoes();
  const { vendas, loaded: vendasLoaded, upsertVenda, deleteVenda } = useVendas();

  const canEdit = currentUser?.role === "admin" || currentUser?.role === "gestor";

  // Wrap setters to also persist to Supabase
  const setFracoes = (updater) => {
    // Only used for local status changes — persist each change
  };

  // Avisa quando a gravação não produz efeito, em vez de o ecrã voltar
  // silenciosamente ao valor anterior.
  const reportar = (res, tabela) => {
    if (!res?.error) return true;
    alert(res.semEfeito
      ? `A alteração não foi gravada: a base aceitou o pedido mas não mudou nada.\n\n`
        + `Falta uma política de UPDATE na tabela '${tabela}'. No SQL Editor do Supabase:\n\n`
        + `create policy "update ${tabela}" on ${tabela}\n  for update to authenticated using (true) with check (true);`
      : "Erro ao guardar:\n\n" + (res.error.message || res.error));
    return false;
  };

  const updateFracao = async (id, changes) => {
    const frac = fracoes.find(f => f.id === id);
    if (!frac) return;
    reportar(await upsertFracao({ ...frac, ...changes }), "fracoes");
  };

  const updateVenda = async (id, changes) => {
    const v = vendas.find(v => v.id === id);
    if (!v) return;
    reportar(await upsertVenda({ ...v, ...changes }), "vendas");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, fontFamily: "'DM Sans', sans-serif" }}>
      {/* A Gestão de Comissões foi removida: as comissões passam a ser lançadas
          como previsão no Fluxo Futuro e convertidas em custo real quando
          chegar a fatura do mediador. */}
      <TabelaVendas
        fracoes={fracoes} vendas={vendas} canEdit={canEdit}
        onAddFatura={onAddFatura}
        onUpdateFracao={updateFracao}
        onUpdateVenda={updateVenda}
        onUpsertVenda={upsertVenda}
      />
    </div>
  );
}
