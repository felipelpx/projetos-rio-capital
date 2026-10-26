import { useState, useRef } from "react";
import { CATEGORIAS, SUBCATEGORIAS } from "./categorias.js";
import { fmtEuro, fmtNum } from "./format.js";
import { EMPRESAS_OPCOES } from "./empresas.js";
import { STATUS_MANUAIS, FORMAS_PAGAMENTO } from "./status.js";

const EMPRESAS_LIST = EMPRESAS_OPCOES;



const fmt = (v) => fmtEuro(v);

function toBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

function toDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

async function extractFaturaWithAI(fileBase64, fileType) {
  let content;
  if (fileType === "application/pdf") {
    content = [
      { type:"document", source:{ type:"base64", media_type:"application/pdf", data:fileBase64 } },
      { type:"text", text:"Extrai todos os dados desta fatura portuguesa. Responde APENAS com JSON válido — sem markdown, sem explicações, sem texto antes ou depois." }
    ];
  } else {
    content = [
      { type:"image", source:{ type:"base64", media_type:fileType, data:fileBase64 } },
      { type:"text", text:"Extrai todos os dados desta fatura portuguesa. Responde APENAS com JSON válido — sem markdown, sem explicações, sem texto antes ou depois." }
    ];
  }

  const systemPrompt = `És um extractor especializado em faturas, recibos e documentos fiscais portugueses (SAF-T, faturas com IVA, recibos verdes, notas de crédito).

REGRAS DE FORMATAÇÃO OBRIGATÓRIAS:
- Datas: SEMPRE em ISO "YYYY-MM-DD" (converte DD/MM/AAAA → YYYY-MM-DD; ex: "15/07/2026" → "2026-07-15")
- Valores: SEMPRE número JSON (sem string, sem €, sem espaços; converte "1.234,56 €" → 1234.56; "1,234.56" → 1234.56)
- NIF/NIPC: 9 dígitos apenas (remove espaços, pontos, prefixos "PT")
- IBAN: mantém formato "PT50 XXXX XXXX XXXXXXXXXXX X" ou sem espaços
- Se um campo não existir na fatura, devolve string vazia "" para textos ou 0 para números — NUNCA null

MAPEAMENTO DE CAMPOS (reconhece variantes):
- "numero_fatura" → "Fatura Nº", "FT", "FR", "NC/", "Documento", "Nº Documento" (ex: "FT 2026/149", "FR 2026A1/52", "1234")
- "data_fatura" → "Data", "Data de emissão", "Data do documento", "Emitida em"
- "data_vencimento" → "Data de vencimento", "Vencimento", "Pagar até", "Data limite" (se ausente e houver "prazo de pagamento X dias" calcula: data_fatura + X dias; se ausente por completo, usa data_fatura)
- "fornecedor_nome" → nome da empresa emitente (topo da fatura, geralmente com Lda/SA/Unipessoal)
- "fornecedor_nif" → "NIF", "NIPC", "Contribuinte" do EMITENTE (não do cliente)
- "fornecedor_morada" → morada do emitente
- "fornecedor_email" → email do emitente
- "fornecedor_iban" → IBAN indicado para pagamento
- "descricao_servico" → descrição do serviço/produto (concatena linhas se forem várias)
- "valor_base" → subtotal antes de IVA / valor sem IVA / base tributável
- "valor_iva" → montante do IVA
- "valor_total" → total a pagar / total com IVA / total do documento
- "taxa_iva" → 23, 13, 6 ou 0 (só o número, sem %)
- "notas" → observações relevantes (referências de projeto, contratos, retenções na fonte, notas de crédito, etc.)

FORMATO DE RESPOSTA (JSON exato, mesmo se faltar informação):
{
  "numero_fatura": "",
  "data_fatura": "YYYY-MM-DD",
  "data_vencimento": "YYYY-MM-DD",
  "fornecedor_nome": "",
  "fornecedor_nif": "",
  "fornecedor_morada": "",
  "fornecedor_email": "",
  "fornecedor_iban": "",
  "descricao_servico": "",
  "valor_base": 0,
  "valor_iva": 0,
  "valor_total": 0,
  "taxa_iva": 0,
  "notas": ""
}

Responde APENAS o objeto JSON. Sem \`\`\`json, sem prefácio, sem sufixo.`;

  let response;
  try {
    response = await fetch("/.netlify/functions/ai-proxy", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({
        model:"claude-sonnet-5",
        max_tokens:2000,
        system: systemPrompt,
        messages:[{ role:"user", content }]
      })
    });
  } catch (err) {
    throw new Error("Erro de rede: " + err.message);
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Servidor AI retornou ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json();

  // Se veio erro da API
  if (data?.error) {
    throw new Error("API Anthropic: " + (data.error.message || JSON.stringify(data.error)));
  }
  if (data?.type === "error") {
    throw new Error("API Anthropic: " + (data.error?.message || "erro desconhecido"));
  }

  // Extrai texto — pode ter markdown à volta
  const text = data.content?.find(b => b.type === "text")?.text || "";
  if (!text) {
    console.error("[extractFatura] resposta sem texto:", data);
    throw new Error("A IA respondeu vazio. Verifica a qualidade do PDF/imagem.");
  }

  // Tenta parsear — remove markdown fences e ruído antes/depois do JSON
  let cleaned = text.trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  // Se ainda há texto antes/depois, tenta apanhar só o primeiro objeto JSON
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  try {
    const parsed = JSON.parse(cleaned);
    // Normaliza: garante que campos numéricos são numbers
    ["valor_base", "valor_iva", "valor_total", "taxa_iva"].forEach(k => {
      if (typeof parsed[k] === "string") {
        parsed[k] = parseFloat(String(parsed[k]).replace(/[€\s.]/g, "").replace(",", ".")) || 0;
      } else if (parsed[k] == null) {
        parsed[k] = 0;
      }
    });
    // Se data_vencimento vazia, usa data_fatura
    if (!parsed.data_vencimento && parsed.data_fatura) {
      parsed.data_vencimento = parsed.data_fatura;
    }
    return parsed;
  } catch (err) {
    console.error("[extractFatura] JSON inválido. Texto original:", text);
    console.error("[extractFatura] Texto limpo:", cleaned);
    throw new Error("A IA respondeu num formato inválido. Tenta novamente ou preenche manualmente.");
  }
}

// ─── Fieldset styles ──────────────────────────────────────────────────────────
const inputStyle = {
  background:"#f8f8f8", border:"1px solid #eee", borderRadius:8,
  padding:"9px 12px", fontSize:13, outline:"none", color:"#333",
  width:"100%", boxSizing:"border-box"
};
const selectStyle = { ...inputStyle, cursor:"pointer" };
const labelStyle = {
  fontSize:10, color:"#aaa", fontFamily:"monospace",
  textTransform:"uppercase", letterSpacing:"0.07em", display:"block", marginBottom:4
};
const reqLabelStyle = { ...labelStyle, color:"#d97706" };
const fieldWrap = { display:"flex", flexDirection:"column", gap:4 };

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────
export default function ImportarFatura({ onSave }) {
  const [step, setStep] = useState(0);
  const [file, setFile] = useState(null);
  const [fileDataURL, setFileDataURL] = useState("");
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [erro, setErro] = useState("");

  // Form state — flat, stable, never recreated
  const [empresa, setEmpresa] = useState("");
  const [categoria, setCategoria] = useState("");
  const [subcategoria, setSubcategoria] = useState("");
  const [previsaoPagamento, setPrevisaoPagamento] = useState("");
  const [formaPagamento, setFormaPagamento] = useState("");
  const [status, setStatus] = useState("Pendente");
  const [nFatura, setNFatura] = useState("");
  const [dataFatura, setDataFatura] = useState("");
  const [dataVenc, setDataVenc] = useState("");
  const [taxaIva, setTaxaIva] = useState("");
  const [fornNome, setFornNome] = useState("");
  const [fornNif, setFornNif] = useState("");
  const [fornEmail, setFornEmail] = useState("");
  const [fornIban, setFornIban] = useState("");
  const [fornMorada, setFornMorada] = useState("");
  const [valorBase, setValorBase] = useState("");
  const [valorIva, setValorIva] = useState("");
  const [valorTotal, setValorTotal] = useState("");
  const [descServico, setDescServico] = useState("");
  const [notas, setNotas] = useState("");

  // Pagamento parcelado — array editável { data, valor, obs }
  const [parcelado, setParcelado] = useState(false);
  const [parcelasArr, setParcelasArr] = useState([]); // [{data, valor, obs}]
  // controlos do gerador (apenas para pré-popular o array)
  const [genN, setGenN] = useState(2);
  const [genIntervalo, setGenIntervalo] = useState("mensal");
  const [genDias, setGenDias] = useState(30);
  const [saveResult, setSaveResult] = useState(null);
  const [saving, setSaving] = useState(false);

  // Helpers parcelas
  const fmtDate = (d) => d.toISOString().slice(0,10);
  const addStep = (d, intervalo, dias) => {
    if (intervalo === "mensal") return new Date(d.getFullYear(), d.getMonth()+1, d.getDate());
    const days = intervalo === "semanal" ? 7
              : intervalo === "quinzenal" ? 15
              : (parseInt(dias) || 30);
    return new Date(d.getTime() + days * 86400000);
  };
  const gerarParcelas = () => {
    const n = Math.max(2, Math.min(60, parseInt(genN) || 2));
    const total = parseFloat(valorTotal) || 0;
    const cents = Math.round(total * 100);
    const baseCents = Math.floor(cents / n);
    const remainder = cents - baseCents * n;
    const venc0 = dataVenc || dataFatura || new Date().toISOString().slice(0,10);
    let d = new Date(venc0 + "T00:00:00");
    const novo = [];
    for (let i = 0; i < n; i++) {
      const v = i === 0 ? (baseCents + remainder) / 100 : baseCents / 100;
      novo.push({ data: fmtDate(d), valor: v, obs: "" });
      d = addStep(d, genIntervalo, genDias);
    }
    setParcelasArr(novo);
  };
  const addParcela = () => {
    const last = parcelasArr[parcelasArr.length - 1];
    const baseDate = last?.data ? new Date(last.data + "T00:00:00") : new Date();
    const next = addStep(baseDate, genIntervalo, genDias);
    setParcelasArr([...parcelasArr, { data: fmtDate(next), valor: 0, obs: "" }]);
  };
  const removeParcela = (i) => setParcelasArr(parcelasArr.filter((_, idx) => idx !== i));
  const updateParcela = (i, patch) =>
    setParcelasArr(parcelasArr.map((p, idx) => idx === i ? { ...p, ...patch } : p));
  const totalParcelas = parcelasArr.reduce((s, p) => s + (parseFloat(p.valor) || 0), 0);

  const fileRef = useRef();

  const handleFile = async (f) => {
    if (!f) return;
    setFile(f);
    setErro("");
    const dataUrl = await toDataURL(f);
    setFileDataURL(dataUrl);
  };

  const handleAnalyse = async () => {
    if (!file) return;
    setLoading(true); setErro("");
    try {
      setLoadingMsg("A ler o ficheiro...");
      const base64 = await toBase64(file);
      setLoadingMsg("A extrair dados com IA...");
      const data = await extractFaturaWithAI(base64, file.type);
      // Populate fields
      if (data.numero_fatura)    setNFatura(data.numero_fatura);
      if (data.data_fatura)      setDataFatura(data.data_fatura);
      if (data.data_vencimento)  setDataVenc(data.data_vencimento);
      if (data.taxa_iva!=null)   setTaxaIva(String(data.taxa_iva));
      if (data.fornecedor_nome)  setFornNome(data.fornecedor_nome);
      if (data.fornecedor_nif)   setFornNif(data.fornecedor_nif);
      if (data.fornecedor_email) setFornEmail(data.fornecedor_email);
      if (data.fornecedor_iban)  setFornIban(data.fornecedor_iban);
      if (data.fornecedor_morada)setFornMorada(data.fornecedor_morada);
      if (data.valor_base!=null) setValorBase(String(data.valor_base));
      if (data.valor_iva!=null)  setValorIva(String(data.valor_iva));
      if (data.valor_total!=null)setValorTotal(String(data.valor_total));
      if (data.descricao_servico)setDescServico(data.descricao_servico);
      if (data.notas)            setNotas(data.notas);
      setStep(1);
    } catch(e) {
      setErro(e.message || "Erro ao analisar.");
    } finally {
      setLoading(false); setLoadingMsg("");
    }
  };

  // Calcula a lista de parcelas a inserir, dado o estado actual.
  // Retorna array de objectos prontos para inserir.
  const buildFaturas = () => {
    const baseId = "fat_" + Date.now();
    const venc0 = dataVenc || dataFatura || new Date().toISOString().slice(0,10);

    if (!parcelado || parcelasArr.length < 2) {
      return [{
        id: baseId,
        empresa, categoria, subcategoria, previsao_pagamento: previsaoPagamento || null, forma_pagamento: formaPagamento || null, status,
        numero_fatura: nFatura, data_fatura: dataFatura,
        data_vencimento: venc0, taxa_iva: taxaIva,
        fornecedor_nome: fornNome, fornecedor_nif: fornNif,
        fornecedor_email: fornEmail, fornecedor_iban: fornIban,
        fornecedor_morada: fornMorada,
        valor_base: parseFloat(valorBase) || 0,
        valor_iva: parseFloat(valorIva) || 0,
        valor_total: parseFloat(valorTotal) || 0,
        descricao_servico: descServico, notas,
        anexo_nome: file?.name || "",
        anexo_b64: fileDataURL || "",
      }];
    }

    // Parcelado: usa o array editável tal como está
    const n = parcelasArr.length;
    return parcelasArr.map((p, i) => ({
      id: `${baseId}_p${i+1}`,
      empresa, categoria, subcategoria, previsao_pagamento: previsaoPagamento || null, forma_pagamento: formaPagamento || null, status,
      numero_fatura: nFatura ? `${nFatura} (${i+1}/${n})` : "",
      data_fatura: dataFatura,
      data_vencimento: p.data,
      taxa_iva: taxaIva,
      fornecedor_nome: fornNome, fornecedor_nif: fornNif,
      fornecedor_email: fornEmail, fornecedor_iban: fornIban,
      fornecedor_morada: fornMorada,
      valor_base: 0, valor_iva: 0,
      valor_total: Math.round((parseFloat(p.valor) || 0) * 100) / 100,
      descricao_servico: descServico
        ? `${descServico} — Parcela ${i+1}/${n}${p.obs ? ` · ${p.obs}` : ""}`
        : `Parcela ${i+1}/${n}${p.obs ? ` · ${p.obs}` : ""}`,
      notas: p.obs || notas,
      anexo_nome: i === 0 ? (file?.name || "") : "",
      anexo_b64:  i === 0 ? (fileDataURL || "") : "",
    }));
  };

  const handleSave = async () => {
    if (!categoria) { setErro("A classificação é obrigatória."); return; }
    if (!empresa)   { setErro("Seleciona a empresa."); return; }
    if (parcelado) {
      if (parcelasArr.length < 2) { setErro("Para parcelado, indica pelo menos 2 parcelas."); return; }
      if (parcelasArr.some(p => !p.data)) { setErro("Todas as parcelas precisam de data."); return; }
      if (parcelasArr.some(p => !(parseFloat(p.valor) > 0))) { setErro("Todas as parcelas precisam de valor > 0."); return; }
    }

    setErro("");
    setSaving(true);
    try {
      const arr = buildFaturas();
      const result = await onSave?.(arr);
      setSaveResult(result || { ok: true, inserted: arr.length, error: "" });
      setStep(2);
    } catch (e) {
      setSaveResult({ ok: false, inserted: 0, error: e?.message || String(e) });
      setStep(2);
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setStep(0); setFile(null); setFileDataURL(""); setErro("");
    setEmpresa(""); setCategoria(""); setSubcategoria(""); setPrevisaoPagamento(""); setStatus("Pendente em dia");
    setNFatura(""); setDataFatura(""); setDataVenc(""); setTaxaIva("");
    setFornNome(""); setFornNif(""); setFornEmail(""); setFornIban(""); setFornMorada("");
    setValorBase(""); setValorIva(""); setValorTotal("");
    setDescServico(""); setNotas("");
    setParcelado(false); setParcelasArr([]); setGenN(2); setGenIntervalo("mensal"); setGenDias(30);
    setSaveResult(null);
  };

  // ── Step 0: Upload ────────────────────────────────────────────────────────
  if (step === 0) return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <div>
        <div style={{fontSize:20,fontWeight:700,color:"#1a1a2e",fontFamily:"Georgia,serif",marginBottom:4}}>🧾 Importar Fatura</div>
        <div style={{fontSize:13,color:"#888"}}>Faz upload da fatura — a IA extrai os dados automaticamente. Só precisas classificar.</div>
      </div>

      <div
        onDragOver={e=>{e.preventDefault();setDragging(true);}}
        onDragLeave={()=>setDragging(false)}
        onDrop={e=>{e.preventDefault();setDragging(false);handleFile(e.dataTransfer.files[0]);}}
        onClick={()=>fileRef.current?.click()}
        style={{border:`2px dashed ${dragging?"#1a1a2e":file?"#16a34a":"#ddd"}`,borderRadius:16,padding:"52px 24px",textAlign:"center",cursor:"pointer",background:file?"#f0fdf4":"#fafafa",transition:"all 0.2s"}}>
        <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg" style={{display:"none"}} onChange={e=>handleFile(e.target.files[0])}/>
        {file ? (
          <>
            <div style={{fontSize:40,marginBottom:10}}>✅</div>
            <div style={{fontSize:15,fontWeight:700,color:"#16a34a"}}>{file.name}</div>
            <div style={{fontSize:12,color:"#aaa",marginTop:4}}>{fmtNum(file.size/1024, 1)} KB · Clica para trocar</div>
          </>
        ) : (
          <>
            <div style={{fontSize:48,marginBottom:14}}>🧾</div>
            <div style={{fontSize:16,fontWeight:700,color:"#1a1a2e",marginBottom:8}}>Arrasta a fatura aqui</div>
            <div style={{fontSize:13,color:"#aaa",marginBottom:14}}>ou clica para selecionar</div>
            <div style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>
              {["PDF","PNG","JPG"].map(f=><span key={f} style={{background:"#fff",border:"1px solid #e0e0e0",color:"#888",fontSize:11,padding:"4px 12px",borderRadius:20,fontFamily:"monospace"}}>{f}</span>)}
            </div>
          </>
        )}
      </div>

      <div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:10,padding:"12px 16px"}}>
        <div style={{fontSize:12,color:"#92400e",fontWeight:600,marginBottom:4}}>💡 Dica</div>
        <div style={{fontSize:11,color:"#a16207",lineHeight:1.7}}>
          A IA lê PDF e imagens de faturas. Apenas <strong>Empresa</strong> e <strong>Classificação</strong> são obrigatórios — o resto é preenchido automaticamente.
        </div>
      </div>

      {erro&&<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:10,padding:"12px 16px",color:"#dc2626",fontSize:13}}>⚠️ {erro}</div>}

      <div style={{display:"flex",justifyContent:"flex-end"}}>
        <button onClick={handleAnalyse} disabled={!file||loading}
          style={{background:file&&!loading?"#1a1a2e":"#e0e0e0",color:file&&!loading?"#fff":"#aaa",border:"none",padding:"13px 32px",borderRadius:10,fontSize:14,fontWeight:700,cursor:file&&!loading?"pointer":"default",display:"flex",alignItems:"center",gap:10}}>
          {loading?<><span style={{display:"inline-block",width:16,height:16,border:"2px solid #ffffff44",borderTopColor:"#fff",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>{loadingMsg}</>:"🤖 Extrair dados com IA →"}
        </button>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  // ── Step 1: Review ────────────────────────────────────────────────────────
  if (step === 1) return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{fontSize:20,fontWeight:700,color:"#1a1a2e",fontFamily:"Georgia,serif",marginBottom:4}}>🧾 Rever & Classificar</div>
          <div style={{fontSize:13,color:"#888"}}>Verifica os dados extraídos e preenche a classificação.</div>
        </div>
        <button onClick={reset} style={{background:"none",border:"1px solid #eee",padding:"7px 16px",borderRadius:8,fontSize:12,color:"#888",cursor:"pointer"}}>← Novo upload</button>
      </div>

      <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:10,padding:"12px 16px",display:"flex",alignItems:"center",gap:10}}>
        <span style={{fontSize:20}}>✅</span>
        <div style={{fontSize:13,color:"#15803d"}}><strong>Dados extraídos!</strong> Verifica e corrige se necessário. Campos a <span style={{color:"#d97706"}}>laranja</span> são obrigatórios.</div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>

        {/* Classificação — OBRIGATÓRIO */}
        <div style={{background:"#fff",border:"2px solid #1a1a2e",borderRadius:14,padding:20,display:"flex",flexDirection:"column",gap:14}}>
          <div style={{fontSize:13,fontWeight:700,color:"#1a1a2e",display:"flex",alignItems:"center",gap:8}}>
            <span style={{background:"#1a1a2e",color:"#C8A96E",fontSize:10,padding:"2px 8px",borderRadius:4,fontFamily:"monospace"}}>OBRIGATÓRIO</span>
            Classificação
          </div>

          <div style={fieldWrap}>
            <label style={reqLabelStyle}>Empresa *</label>
            <select value={empresa} onChange={e=>setEmpresa(e.target.value)} style={{...selectStyle,borderColor:!empresa?"#f59e0b":"#eee"}}>
              <option value="">Selecionar...</option>
              {EMPRESAS_LIST.map(e=><option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
          </div>

          <div style={fieldWrap}>
            <label style={reqLabelStyle}>Classificação / Categoria *</label>
            <select value={categoria} onChange={e=>{setCategoria(e.target.value); setSubcategoria("");}} style={{...selectStyle,borderColor:!categoria?"#f59e0b":"#eee"}}>
              <option value="">Selecionar...</option>
              {CATEGORIAS.map(c=><option key={c}>{c}</option>)}
            </select>
          </div>

          <div style={fieldWrap}>
            <label style={labelStyle}>Subcategoria</label>
            <select value={subcategoria} disabled={!categoria}
              onChange={e=>setSubcategoria(e.target.value)}
              style={{...selectStyle, background: categoria ? "#fff" : "#f4f4f6"}}>
              <option value="">{categoria ? "Selecionar..." : "escolhe a categoria"}</option>
              {(SUBCATEGORIAS[categoria]||[]).map(sc=><option key={sc}>{sc}</option>)}
            </select>
          </div>

          <div style={fieldWrap}>
            <label style={labelStyle}>Previsão de pagamento</label>
            <input type="date" value={previsaoPagamento}
              onChange={e=>setPrevisaoPagamento(e.target.value)}
              title="Quando tencionamos pagar — é esta data que conta no Fluxo Futuro"
              style={inputStyle} />
          </div>

          <div style={fieldWrap}>
            <label style={labelStyle}>Forma de pagamento</label>
            <select value={formaPagamento} onChange={e=>setFormaPagamento(e.target.value)}
              title="Débito direto sai sozinho na data; pagamento bancário é ordenado por nós"
              style={selectStyle}>
              <option value="">Selecionar...</option>
              {FORMAS_PAGAMENTO.map(f=><option key={f}>{f}</option>)}
            </select>
          </div>

          <div style={fieldWrap}>
            <label style={labelStyle}>Status</label>
            <select value={status} onChange={e=>setStatus(e.target.value)} style={selectStyle}>
              {STATUS_MANUAIS.map(s=><option key={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {/* Dados da Fatura — IA extraiu */}
        <div style={{background:"#fff",border:"1px solid #f0f0f0",borderRadius:14,padding:20,display:"flex",flexDirection:"column",gap:14}}>
          <div style={{fontSize:13,fontWeight:700,color:"#1a1a2e",display:"flex",alignItems:"center",gap:8}}>
            <span style={{background:"#f0fdf4",color:"#16a34a",fontSize:10,padding:"2px 8px",borderRadius:4,fontFamily:"monospace",border:"1px solid #bbf7d0"}}>IA EXTRAIU</span>
            Dados da Fatura
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div style={fieldWrap}>
              <label style={labelStyle}>Nº Fatura</label>
              <input type="text" value={nFatura} onChange={e=>setNFatura(e.target.value)} style={inputStyle}/>
            </div>
            <div style={fieldWrap}>
              <label style={labelStyle}>Data da Fatura</label>
              <input type="date" value={dataFatura} onChange={e=>setDataFatura(e.target.value)} style={inputStyle}/>
            </div>
            <div style={fieldWrap}>
              <label style={labelStyle}>Data de Vencimento</label>
              <input type="date" value={dataVenc} onChange={e=>setDataVenc(e.target.value)} style={inputStyle}/>
            </div>
            <div style={fieldWrap}>
              <label style={labelStyle}>Taxa IVA (%)</label>
              <input type="number" value={taxaIva} onChange={e=>setTaxaIva(e.target.value)} style={inputStyle}/>
            </div>
          </div>
        </div>

        {/* Fornecedor */}
        <div style={{background:"#fff",border:"1px solid #f0f0f0",borderRadius:14,padding:20}}>
          <div style={{fontSize:13,fontWeight:700,color:"#1a1a2e",marginBottom:14}}>🏢 Fornecedor</div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <div style={fieldWrap}>
              <label style={labelStyle}>Nome</label>
              <input type="text" value={fornNome} onChange={e=>setFornNome(e.target.value)} style={inputStyle}/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div style={fieldWrap}>
                <label style={labelStyle}>NIF</label>
                <input type="text" value={fornNif} onChange={e=>setFornNif(e.target.value)} style={inputStyle}/>
              </div>
              <div style={fieldWrap}>
                <label style={labelStyle}>Email</label>
                <input type="email" value={fornEmail} onChange={e=>setFornEmail(e.target.value)} style={inputStyle}/>
              </div>
            </div>
            <div style={fieldWrap}>
              <label style={labelStyle}>IBAN</label>
              <input type="text" value={fornIban} onChange={e=>setFornIban(e.target.value)} style={inputStyle}/>
            </div>
            <div style={fieldWrap}>
              <label style={labelStyle}>Morada</label>
              <input type="text" value={fornMorada} onChange={e=>setFornMorada(e.target.value)} style={inputStyle}/>
            </div>
          </div>
        </div>

        {/* Valores */}
        <div style={{background:"#fff",border:"1px solid #f0f0f0",borderRadius:14,padding:20}}>
          <div style={{fontSize:13,fontWeight:700,color:"#1a1a2e",marginBottom:14}}>💰 Valores</div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <div style={fieldWrap}>
              <label style={labelStyle}>Valor Base (sem IVA)</label>
              <input type="number" value={valorBase} onChange={e=>setValorBase(e.target.value)} style={inputStyle}/>
            </div>
            <div style={fieldWrap}>
              <label style={labelStyle}>IVA</label>
              <input type="number" value={valorIva} onChange={e=>setValorIva(e.target.value)} style={inputStyle}/>
            </div>
            <div style={{height:1,background:"#f0f0f0",margin:"4px 0"}}/>
            <div style={fieldWrap}>
              <label style={{...labelStyle,color:"#1a1a2e",fontWeight:700}}>Total a Pagar *</label>
              <input type="number" value={valorTotal} onChange={e=>setValorTotal(e.target.value)} style={{...inputStyle,fontWeight:700,fontSize:15}}/>
            </div>
            {valorTotal&&(
              <div style={{background:"#f8f9fc",borderRadius:10,padding:"10px 14px",textAlign:"center"}}>
                <div style={{fontSize:10,color:"#aaa",fontFamily:"monospace",marginBottom:3}}>TOTAL</div>
                <div style={{fontSize:22,fontWeight:800,color:"#1a1a2e",fontFamily:"monospace"}}>{fmt(parseFloat(valorTotal))}</div>
              </div>
            )}
          </div>
        </div>

        {/* Pagamento Parcelado */}
        <div style={{background:"#fff",border:`2px solid ${parcelado?"#1a1a2e":"#f0f0f0"}`,borderRadius:14,padding:20,gridColumn:"1/-1",transition:"border-color 0.15s"}}>
          <label style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",userSelect:"none"}}>
            <input type="checkbox" checked={parcelado} onChange={e=>{
              setParcelado(e.target.checked);
              if (e.target.checked && parcelasArr.length === 0) {
                // gera 2 parcelas iguais como ponto de partida
                setTimeout(gerarParcelas, 0);
              }
            }}
              style={{width:18,height:18,accentColor:"#1a1a2e",cursor:"pointer"}}/>
            <span style={{fontSize:13,fontWeight:700,color:"#1a1a2e"}}>💳 Pagamento parcelado</span>
            <span style={{fontSize:11,color:"#888"}}>Cada parcela é uma linha independente em Contas a Pagar e Fluxo Futuro.</span>
          </label>

          {parcelado && (
            <div style={{marginTop:16,display:"flex",flexDirection:"column",gap:14}}>
              {/* Gerador automático */}
              <div style={{background:"#f8f9fc",borderRadius:10,padding:12,display:"flex",flexWrap:"wrap",alignItems:"flex-end",gap:10}}>
                <div style={{fontSize:11,color:"#666",fontFamily:"monospace",flexBasis:"100%",marginBottom:4}}>
                  🪄 GERAR AUTOMATICAMENTE (depois podes editar tudo abaixo)
                </div>
                <div style={fieldWrap}>
                  <label style={labelStyle}>Nº parcelas</label>
                  <input type="number" min={2} max={60} value={genN}
                    onChange={e=>setGenN(parseInt(e.target.value)||2)} style={{...inputStyle,width:80}}/>
                </div>
                <div style={fieldWrap}>
                  <label style={labelStyle}>Intervalo</label>
                  <select value={genIntervalo} onChange={e=>setGenIntervalo(e.target.value)} style={{...selectStyle,width:160}}>
                    <option value="mensal">Mensal</option>
                    <option value="quinzenal">Quinzenal (15d)</option>
                    <option value="semanal">Semanal (7d)</option>
                    <option value="personalizado">Personalizado…</option>
                  </select>
                </div>
                {genIntervalo === "personalizado" && (
                  <div style={fieldWrap}>
                    <label style={labelStyle}>Dias</label>
                    <input type="number" min={1} value={genDias}
                      onChange={e=>setGenDias(parseInt(e.target.value)||30)} style={{...inputStyle,width:80}}/>
                  </div>
                )}
                <button onClick={gerarParcelas} type="button"
                  style={{background:"#1a1a2e",color:"#fff",border:"none",padding:"9px 16px",borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer"}}>
                  ⚡ Gerar / Refazer
                </button>
              </div>

              {/* Tabela editável */}
              {parcelasArr.length > 0 && (
                <div style={{border:"1px solid #e8e8e8",borderRadius:10,overflow:"hidden"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                    <thead>
                      <tr style={{background:"#f8f9fc"}}>
                        <th style={{padding:"10px 8px",textAlign:"left",color:"#888",fontWeight:600,fontFamily:"monospace",fontSize:10,letterSpacing:0.5,width:50}}>#</th>
                        <th style={{padding:"10px 8px",textAlign:"left",color:"#888",fontWeight:600,fontFamily:"monospace",fontSize:10,letterSpacing:0.5}}>Data vencimento</th>
                        <th style={{padding:"10px 8px",textAlign:"right",color:"#888",fontWeight:600,fontFamily:"monospace",fontSize:10,letterSpacing:0.5}}>Valor</th>
                        <th style={{padding:"10px 8px",textAlign:"left",color:"#888",fontWeight:600,fontFamily:"monospace",fontSize:10,letterSpacing:0.5}}>Observação</th>
                        <th style={{width:40}}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {parcelasArr.map((p, i) => (
                        <tr key={i} style={{borderTop:i>0?"1px solid #f0f0f0":"none"}}>
                          <td style={{padding:"6px 8px",color:"#888",fontFamily:"monospace"}}>{i+1}/{parcelasArr.length}</td>
                          <td style={{padding:"6px 8px"}}>
                            <input type="date" value={p.data}
                              onChange={e=>updateParcela(i, {data: e.target.value})}
                              style={{...inputStyle,padding:"6px 8px",fontSize:12}}/>
                          </td>
                          <td style={{padding:"6px 8px"}}>
                            <input type="number" step="0.01" value={p.valor}
                              onChange={e=>updateParcela(i, {valor: e.target.value})}
                              style={{...inputStyle,padding:"6px 8px",fontSize:12,textAlign:"right",fontWeight:700,fontFamily:"monospace"}}/>
                          </td>
                          <td style={{padding:"6px 8px"}}>
                            <input type="text" value={p.obs} placeholder="ex: 30% adiantado, 40% à entrega…"
                              onChange={e=>updateParcela(i, {obs: e.target.value})}
                              style={{...inputStyle,padding:"6px 8px",fontSize:12}}/>
                          </td>
                          <td style={{padding:"6px 8px",textAlign:"center"}}>
                            <button onClick={()=>removeParcela(i)} type="button"
                              style={{background:"#fef2f2",border:"1px solid #fecaca",color:"#dc2626",padding:"4px 8px",borderRadius:6,fontSize:11,cursor:"pointer"}}>✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{background:"#fafafa",borderTop:"2px solid #e8e8e8"}}>
                        <td colSpan={2} style={{padding:"10px 8px",fontSize:11,color:"#888",fontFamily:"monospace"}}>
                          Σ {parcelasArr.length} parcela(s)
                          {parseFloat(valorTotal) > 0 && Math.abs(totalParcelas - parseFloat(valorTotal)) > 0.01 && (
                            <span style={{color:"#dc2626",marginLeft:8}}>
                              · diferença vs total fatura: {fmt(totalParcelas - parseFloat(valorTotal))}
                            </span>
                          )}
                        </td>
                        <td style={{padding:"10px 8px",textAlign:"right",fontWeight:800,fontFamily:"monospace",color:"#1a1a2e"}}>{fmt(totalParcelas)}</td>
                        <td colSpan={2}></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              <button onClick={addParcela} type="button"
                style={{alignSelf:"flex-start",background:"none",border:"1px dashed #C8A96E",color:"#C8A96E",padding:"8px 16px",borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer"}}>
                + Adicionar parcela
              </button>
            </div>
          )}
        </div>

        {/* Descrição & Notas */}
        <div style={{background:"#fff",border:"1px solid #f0f0f0",borderRadius:14,padding:20,gridColumn:"1/-1"}}>
          <div style={{fontSize:13,fontWeight:700,color:"#1a1a2e",marginBottom:14}}>📝 Descrição & Notas</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <div style={fieldWrap}>
              <label style={labelStyle}>Descrição do Serviço</label>
              <textarea value={descServico} onChange={e=>setDescServico(e.target.value)} rows={3}
                style={{...inputStyle,resize:"vertical",fontFamily:"inherit"}}/>
            </div>
            <div style={fieldWrap}>
              <label style={labelStyle}>Notas Internas</label>
              <textarea value={notas} onChange={e=>setNotas(e.target.value)} rows={3}
                style={{...inputStyle,resize:"vertical",fontFamily:"inherit"}}/>
            </div>
          </div>
        </div>

        {/* Preview do ficheiro */}
        {fileDataURL && (
          <div style={{background:"#fff",border:"1px solid #f0f0f0",borderRadius:14,padding:20,gridColumn:"1/-1"}}>
            <div style={{fontSize:13,fontWeight:700,color:"#1a1a2e",marginBottom:12}}>📎 Documento Anexado — {file?.name}</div>
            {fileDataURL.startsWith("data:application/pdf")
              ? <iframe src={fileDataURL} style={{width:"100%",height:400,border:"none",borderRadius:8}}/>
              : <img src={fileDataURL} alt="Fatura" style={{maxWidth:"100%",maxHeight:400,objectFit:"contain",borderRadius:8}}/>
            }
          </div>
        )}
      </div>

      {erro&&<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:10,padding:"12px 16px",color:"#dc2626",fontSize:13}}>⚠️ {erro}</div>}

      <div style={{display:"flex",justifyContent:"space-between"}}>
        <button onClick={reset} disabled={saving} style={{background:"none",border:"1px solid #eee",padding:"12px 24px",borderRadius:10,fontSize:14,color:"#888",cursor:saving?"default":"pointer"}}>← Voltar</button>
        <button onClick={handleSave} disabled={saving} style={{background:saving?"#9ca3af":"#16a34a",color:"#fff",border:"none",padding:"12px 36px",borderRadius:10,fontSize:14,fontWeight:700,cursor:saving?"default":"pointer"}}>
          {saving ? "⏳ A guardar..." : (parcelado ? `💾 Guardar ${parcelasArr.length} parcelas em Contas a Pagar` : "💾 Guardar & Adicionar a Contas a Pagar")}
        </button>
      </div>
    </div>
  );

  // ── Step 2: Done ────────────────────────────────────────────────────────────
  const r = saveResult || { ok: true, inserted: 1, error: "" };
  return (
    <div style={{textAlign:"center",padding:"60px 0"}}>
      <div style={{fontSize:64,marginBottom:20}}>{r.ok ? "✅" : "⚠️"}</div>
      <div style={{fontSize:22,fontWeight:700,color:r.ok?"#1a1a2e":"#b91c1c",fontFamily:"Georgia,serif",marginBottom:8}}>
        {r.ok ? (r.inserted > 1 ? `${r.inserted} parcelas guardadas!` : "Fatura guardada!") : "Erro a guardar"}
      </div>
      <div style={{fontSize:14,color:"#888",marginBottom:12}}>
        <strong>{fornNome||"Fornecedor"}</strong> · {fmt(parcelado ? totalParcelas : (parseFloat(valorTotal)||0))}
      </div>
      <div style={{display:"inline-block",background:"#f0f4ff",color:"#4a6fa5",fontSize:13,padding:"4px 16px",borderRadius:20,fontFamily:"monospace",marginBottom:r.error?16:32}}>
        {categoria} · {EMPRESAS_LIST.find(e=>e.id===empresa)?.nome||empresa}
      </div>
      {r.error ? (
        <div style={{background:"#fef2f2",border:"1px solid #fecaca",color:"#991b1b",padding:"12px 16px",borderRadius:10,fontSize:12,fontFamily:"monospace",marginBottom:24,maxWidth:700,marginLeft:"auto",marginRight:"auto",textAlign:"left"}}>
          {r.error}
        </div>
      ) : (
        <div style={{fontSize:13,color:"#16a34a",marginBottom:24}}>✓ {r.inserted > 1 ? `${r.inserted} parcelas adicionadas` : "Adicionada"} às Contas a Pagar</div>
      )}
      <button onClick={reset} style={{background:"#1a1a2e",color:"#fff",border:"none",padding:"12px 28px",borderRadius:10,fontSize:14,fontWeight:700,cursor:"pointer"}}>
        + Importar outra fatura
      </button>
    </div>
  );
}
