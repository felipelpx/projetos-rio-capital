import { useState, useRef, useEffect } from "react";
import { CATEGORIAS, SUBCATEGORIAS } from "./categorias.js";
import { supabase } from "./supabase.js";
import { fmtEuro, fmtNum } from "./format.js";
import { EMPRESAS as EMPRESAS_GRUPO } from "./empresas.js";

// Constrói o conta_id seguindo a mesma convenção do App.jsx
// O id da conta vem da lista oficial (empresas.js). Antes era inventado a
// partir do nome do banco — "Cartão de Crédito" dava "riocap_cartãodecrédito",
// quando a conta real é "riocap_cc". A procura de duplicados olhava para uma
// conta vazia e marcava tudo como novo.
function buildContaId(empresaId, bancoNome) {
  if (!empresaId || !bancoNome) return null;
  const n = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
  const emp = EMPRESAS_GRUPO.find(e => e.id === empresaId);
  const conta = emp?.contas.find(c => n(c.banco) === n(bancoNome));
  if (conta) return conta.id;
  return empresaId + "_" + bancoNome.toLowerCase().replace(/\s/g, "");
}

// Mesma chave de deduplicação usada no App.jsx (tem de ser idêntica dos dois lados)
function impMovKey(m) {
  const data = String(m?.data || "").slice(0, 10);
  const n = (v) => {
    const x = Number(v);
    return Number.isFinite(x) ? x.toFixed(2) : "0.00";
  };
  const desc = String(m?.movimento || "").trim().replace(/\s+/g, " ");
  return `${data}|${desc}|${n(m?.valor)}|${n(m?.saldo)}`;
}

// Empresas + bancos disponíveis para importação (fonte única em empresas.js)
const EMPRESAS = EMPRESAS_GRUPO.map(e => ({
  id: e.id,
  nome: e.projeto ? `${e.nome} (${e.projeto})` : e.nome,
  contas: e.contas.map(c => c.banco),
}));

function toBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

// Parse Excel/CSV using SheetJS via CDN (loaded dynamically)
async function loadXLSX() {
  if (window.XLSX) return;
  await new Promise((res, rej) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    script.onload = res;
    script.onerror = rej;
    document.head.appendChild(script);
  });
}

async function parseExcelFile(file, bufPrevio) {
  // Com o conteúdo já em memória não se volta ao disco — ver handleFile.
  if (bufPrevio) {
    await loadXLSX();
    const workbook = window.XLSX.read(new Uint8Array(bufPrevio), { type: "array", cellDates: true });
    const sheetName = workbook.SheetNames[0];
    return window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: null });
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        // Use simple CSV/text parsing for xlsx
        const data = e.target.result;
        
        // Try to load XLSX library
        if (!window.XLSX) {
          await new Promise((res, rej) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
            script.onload = res;
            script.onerror = rej;
            document.head.appendChild(script);
          });
        }
        
        const workbook = window.XLSX.read(data, { type: 'array', cellDates: true });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        // raw:true preserves numeric values exactly (no string conversion that loses precision)
        const rows = window.XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true, defval: null });
        
        resolve(rows);
      } catch(err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

// ─── Parser unificado para XLSX/XLS/CSV/PDF ──────────────────────────────
// Devolve sempre `rows: any[][]` que depois é entregue a `parseMovimentos`.

function parseCSVText(text) {
  if (!text) return [];
  text = text.replace(/^\uFEFF/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  const counts = {
    ";": (firstLine.match(/;/g) || []).length,
    ",": (firstLine.match(/,/g) || []).length,
    "\t": (firstLine.match(/\t/g) || []).length,
  };
  const sep = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  const lines = text.split(/\r?\n/).filter(l => l.length > 0);
  const rows = [];
  for (const line of lines) {
    const cells = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuote) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQuote = false;
        else cur += ch;
      } else {
        if (ch === '"') inQuote = true;
        else if (ch === sep) { cells.push(cur); cur = ""; }
        else cur += ch;
      }
    }
    cells.push(cur);
    rows.push(cells.map(c => c.trim()));
  }
  return rows;
}

// Mensagem para quando o browser já não consegue ler o ficheiro do disco.
// Acontece quando o ficheiro foi movido/apagado/re-descarregado depois de ser
// escolhido, ou quando está no OneDrive/Drive sem cópia local.
function mensagemFicheiroIlegivel(file, e) {
  const nome = file?.name || "o ficheiro";
  return "Não foi possível ler " + nome + " do disco.\n\n"
    + "Isto acontece quando o ficheiro foi movido, apagado ou descarregado outra vez "
    + "depois de o teres escolhido, ou quando está no OneDrive/Google Drive sem cópia "
    + "no computador.\n\n"
    + "O que fazer: abre a pasta, confirma que o ficheiro está lá (e descarregado, "
    + "não só na nuvem), e volta a escolhê-lo aqui."
    + (e?.message ? "\n\nDetalhe técnico: " + e.message : "");
}

// Conteúdo do ficheiro: usa o que já foi lido para memória; só vai ao disco
// se não houver (ex.: fluxos que chamam estas funções sem buffer).
async function bytesDe(file, buf) {
  if (buf) return buf;
  try {
    return await file.arrayBuffer();
  } catch (e) {
    const err = new Error(mensagemFicheiroIlegivel(file, e));
    err._ficheiroIlegivel = true;
    throw err;
  }
}

async function readTextWithFallback(file, bufPrevio) {
  const buf = await bytesDe(file, bufPrevio);
  for (const enc of ["utf-8", "latin1", "utf-16le"]) {
    try {
      const dec = new TextDecoder(enc, { fatal: true });
      const text = dec.decode(buf);
      if (text.includes("\uFFFD")) continue;
      return text;
    } catch { /* try next */ }
  }
  return new TextDecoder("latin1").decode(buf);
}

async function parsePDFText(file, bufPrevio) {
  if (!window.pdfjsLib) {
    await new Promise((res, rej) => {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      script.onload = res;
      script.onerror = rej;
      document.head.appendChild(script);
    });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }
  const buf = await bytesDe(file, bufPrevio);
  // O pdf.js fica dono do buffer (transfere-o), por isso dá-se-lhe uma cópia —
  // senão uma segunda tentativa de processar o mesmo ficheiro falhava.
  const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
  // Devolve linhas COM posição: { page, y, text, cells:[{x,str}] }.
  // A posição vertical é necessária para reconstruir descrições que o banco
  // parte em várias linhas (BNI), e o x para separar colunas.
  const out = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const buckets = {};
    content.items.forEach(it => {
      if (!it.str || !it.str.trim()) return;
      const y = Math.round(it.transform[5]);
      let key = null;
      for (const k of Object.keys(buckets)) {
        if (Math.abs(parseInt(k) - y) <= 2) { key = k; break; }
      }
      if (!key) key = String(y);
      if (!buckets[key]) buckets[key] = [];
      const x0 = it.transform[4];
      const larg = it.width || it.str.length * 4.5;
      const total = it.str.length || 1;
      let pos = 0;
      it.str.split(/(\s+)/).forEach(tok => {
        if (tok.trim()) {
          buckets[key].push({
            x: x0 + (pos / total) * larg,
            x1: x0 + ((pos + tok.length) / total) * larg,
            str: tok,
          });
        }
        pos += tok.length;
      });
    });
    Object.keys(buckets)
      .sort((a, b) => parseFloat(b) - parseFloat(a))   // topo → fundo
      .forEach(k => {
        const cells = buckets[k].sort((a, b) => a.x - b.x);
        out.push({
          page: p,
          y: -parseFloat(k),                            // cresce para baixo
          text: cells.map(c => c.str).join("  ").replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim(),
          cells,
        });
      });
  }
  return out;
}

// ── Números monetários ───────────────────────────────────────────────────────
// Aceita "1.382,12", "202 026,00", "1,234.56", "-0,12", "20 000", com ou sem €
// antes ou depois. Devolve null se o token não for um montante.
function parseNum(tok) {
  if (tok == null) return null;
  let t = String(tok).replace(/^\(|\)$/g, m => (m === "(" ? "-" : ""))
    .replace(/[^0-9.,\-]/g, "");   // tira €, £, $, espaços, letras de moeda
  if (!/\d/.test(t)) return null;
  const neg = /^-/.test(t) || /-$/.test(t);
  t = t.replace(/-/g, "");
  const temPonto = t.includes("."), temVirg = t.includes(",");
  if (temPonto && temVirg) {
    // o separador decimal é o que aparece mais à direita
    t = t.lastIndexOf(",") > t.lastIndexOf(".")
      ? t.replace(/\./g, "").replace(",", ".")
      : t.replace(/,/g, "");
  } else if (temVirg) {
    t = /,\d{1,2}$/.test(t) ? t.replace(",", ".") : t.replace(/,/g, "");
  } else if (temPonto) {
    if (!/\.\d{1,2}$/.test(t)) t = t.replace(/\./g, "");
  }
  const n = parseFloat(t);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

// Extrai todos os montantes de uma linha, pela ordem em que aparecem.
// Exige parte decimal (,dd ou .dd) para não confundir com nºs de operação,
// datas ou referências — salvo quando `soltos` é true.
function montantesDaLinha(texto, soltos = false) {
  const re = soltos
    ? /-?\s?€?\s?\d[\d.,\s\u00A0]*\d|\d/g
    : /-?\s?€?\s?\d[\d.\s\u00A0]*[.,]\d{2}(?!\d)/g;
  const found = [];
  for (const m of String(texto).matchAll(re)) {
    const v = parseNum(m[0]);
    if (v !== null) found.push({ valor: v, raw: m[0], idx: m.index });
  }
  return found;
}

const RE_LIXO_BNI = /(Este documento é processado|carece de assinatura|INTERNET BANKING|Banco de Negócios|Capital Social|NIPC|^Tel:|^Fax:|^E-mail:|www\.|Página \d+ de|Amoreiras|Duarte Pacheco|Lisboa|\(Europa\) S\.A\.|Consulta de Movimento|Número de Conta|Saldo\s+Contabilístico|Data\s+Mov\.|Montante\s+Saldo\s+Moeda)/i;

// ── BNI Europa (PDF "Consulta de Movimento de Contas") ───────────────────────
// Cada movimento ocupa uma linha "âncora" que começa por AAAA-MM-DD e traz
// nº de operação, data-valor, montante e saldo. A descrição é impressa em
// linhas soltas imediatamente acima/abaixo da âncora — juntamo-las por
// proximidade vertical.
function parseBNIPDF(linhas) {
  const rows = [["Data", "Descrição", "Valor", "Saldo"]];
  const RE_ANCORA = /^(\d{4}-\d{2}-\d{2})\s+(-?\d{5,})\s+(\d{4}-\d{2}-\d{2})\s*(.*)$/;

  const uteis = linhas.filter(l => l.text && !RE_LIXO_BNI.test(l.text));
  const ancoras = [];
  const soltas = [];
  uteis.forEach(l => {
    const m = l.text.match(RE_ANCORA);
    if (m) ancoras.push({ ...l, m });
    else soltas.push(l);
  });
  if (!ancoras.length) return rows;

  // Cada linha solta cola-se à âncora mais próxima (mesma página, ≤ 30pt)
  const extras = new Map();
  soltas.forEach(l => {
    let melhor = null, dist = Infinity;
    ancoras.forEach(a => {
      if (a.page !== l.page) return;
      const d = Math.abs(a.y - l.y);
      if (d < dist) { dist = d; melhor = a; }
    });
    if (melhor && dist <= 30) {
      if (!extras.has(melhor)) extras.set(melhor, []);
      extras.get(melhor).push(l);
    }
  });

  // "Financiamento/E" + "mpréstimo" → "Financiamento/Empréstimo";
  // "Selo" + "s/ comissão" → "Selo s/ comissão"
  const juntar = (partes) => partes.reduce((acc, p) => {
    if (!acc) return p;
    const cortouPalavra = /[A-ZÁÂÃÀÉÊÍÓÔÕÚÇ]$/.test(acc) && /^[a-záâãàéêíóôõúç]/.test(p);
    return acc + (cortouPalavra ? "" : " ") + p;
  }, "");

  ancoras.forEach(a => {
    const [, dataMov, , , resto] = a.m;
    const nums = montantesDaLinha(resto);
    if (nums.length < 1) return;
    const saldo = nums[nums.length - 1].valor;
    const valor = nums.length >= 2 ? nums[nums.length - 2].valor : 0;

    // descrição inline = o que sobra da âncora depois de tirar os montantes
    let inline = resto;
    nums.forEach(n => { inline = inline.replace(n.raw, " "); });
    inline = inline.replace(/€/g, " ").replace(/\s+/g, " ").trim();

    const fragmentos = [
      ...(extras.get(a) || []).map(l => ({ y: l.y, t: l.text })),
      ...(inline ? [{ y: a.y, t: inline }] : []),
    ].sort((p, q) => p.y - q.y).map(f => f.t);

    const desc = juntar(fragmentos).replace(/\s+/g, " ").trim().slice(0, 200);
    rows.push([dataMov, desc || "Movimento", valor, saldo]);
  });

  return rows;
}

// ── Revolut Business (PDF) ──────────────────────────────────────────────────
// O Revolut exporta dois modelos diferentes:
//   • "Extrato das transações" — colunas Saídas | Entradas (SEM saldo),
//     com coluna Status ("Concluída").
//   • "Extrato da conta"       — colunas Saídas | Entradas | Saldo, sem
//     Status, e com uma secção por moeda (EUR, GBP, USD).
// Em ambos as colunas são alinhadas à direita e mudam de posição entre
// páginas, e um montante pode vir partido em duas linhas ("€3" + "029.00").
const RE_LIXO_REVOLUT = /^(Extrato d[ao]|Gerado em|Transações de|Relatar perda|Obtenha ajuda|Como ler|©|Revolut Bank UK|A Revolut Ltd|Seus fundos|Data \(UTC\)|\(UTC\)|Descrição|Resumo do saldo|Nome da conta|Moeda|Tipo\b|IBAN|BIC|Número da conta|Número identificador|Código da agência|Saldo inicial|Saldo de fechamento|Não houve transações|Os dados locais|2nd Floor|Berkeley|London|W1J|England|United Kingdom|\d\/\d$)/i;
// Marcadores que fecham a leitura do resto da página
const RE_FIM_PAGINA = /(Relatar perda|Seus fundos|Obtenha ajuda|Como ler|^©|A Revolut Ltd|Revolut Bank UK Ltd|Tipos de transação)/i;
// Estes marcadores só fecham a página DEPOIS de a tabela ter começado. Em
// alguns extratos a frase "Seus fundos são mantidos…" aparece por baixo do
// resumo de saldos, ou seja, antes da primeira transação: tratada como fim de
// página, cortava o extrato inteiro e o ficheiro vinha sem movimentos.
const RE_FIM_SO_DEPOIS = /(Seus fundos)/i;
const RE_STATUS = /^(Concluída|Concluido|Concluído|Pendente|Revertida|Rejeitada|Cancelada|Completed|Pending|Reverted|Declined|Failed)$/i;
const RE_DATA_REVOLUT = /^(\d{1,2})\s+([a-zç]{3})\.?\s*(\d{4})?\b/i;
const MESES_PT = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };

// Aceita "€1 000,00", "-£8.00", "£1 080.00", "$0.00" — o sinal pode vir antes
// ou depois do símbolo (o Revolut usa "-£8.00" na coluna do saldo).
const ehCelulaMontante = (str) => /\d/.test(str) && /^-?\s*[€£$\u20AC\s]*-?\d[\d.,\s]*$/.test(str.trim());

function parseRevolutPDF(linhas) {
  const rows = [["Data", "Descrição", "Valor", "Saldo"]];

  // Linhas úteis, página a página, cortando no rodapé / "Tipos de transação"
  const paginas = new Map();
  linhas.forEach(l => {
    if (!paginas.has(l.page)) paginas.set(l.page, []);
    paginas.get(l.page).push(l);
  });
  const uteis = [];
  const cabecalhos = new Map();
  for (const [pg, doPage] of paginas) {
    // A tabela "começou" nesta página quando já se viu o cabeçalho ou a
    // primeira linha com data. Antes disso, os marcadores condicionais não
    // fecham a página.
    let comecou = false;
    for (const l of doPage) {
      if (!l.text) continue;
      if (RE_FIM_PAGINA.test(l.text) && (comecou || !RE_FIM_SO_DEPOIS.test(l.text))) break;
      // cabeçalho da tabela (guarda-se antes de o filtrar como lixo)
      const acha = (re) => l.cells.find(c => re.test(c.str.trim()));
      const cSai = acha(/^Sa[íi]das?$/i), cEnt = acha(/^Entradas?$/i);
      if (cSai && cEnt) comecou = true;
      if (RE_DATA_REVOLUT.test(l.text)) comecou = true;
      if (cSai && cEnt && !cabecalhos.has(pg)) {
        const cSaldo = l.cells.find(c => /^Saldo$/i.test(c.str.trim()) && c.x > cEnt.x);
        const cStatus = acha(/^(Status|Estado)$/i);
        cabecalhos.set(pg, {
          xMoeda: cSai.x - 25,
          xStatus: cStatus ? cStatus.x : cSai.x - 25,
          cols: [
            { x1: cSai.x1, tipo: "sai" },
            { x1: cEnt.x1, tipo: "ent" },
            ...(cSaldo ? [{ x1: cSaldo.x1, tipo: "saldo" }] : []),
          ],
        });
      }
      if (RE_LIXO_REVOLUT.test(l.text)) continue;
      uteis.push(l);
    }
  }
  if (!uteis.length) return { rows, semSaldo: true };

  // Sem cabeçalho legível: modelo "transações", em que a coluna Status marca
  // o fim da descrição e os montantes formam dois grupos alinhados à direita.
  let geoFallback = null;
  if (!cabecalhos.size) {
    let xStatus = Infinity, xMoeda = Infinity;
    uteis.forEach(l => {
      const st = l.cells.find(c => RE_STATUS.test(c.str.trim()));
      if (!st) return;
      xStatus = Math.min(xStatus, st.x);
      l.cells.forEach(c => { if (c.x > st.x && ehCelulaMontante(c.str)) xMoeda = Math.min(xMoeda, c.x); });
    });
    if (!isFinite(xStatus) || !isFinite(xMoeda)) return { rows, semSaldo: true };
    const bordas = [];
    uteis.forEach(l => l.cells.forEach(c => { if (c.x >= xMoeda - 4 && ehCelulaMontante(c.str)) bordas.push(Math.round(c.x1)); }));
    const ord = [...new Set(bordas)].sort((a, b) => a - b);
    let corte = null, maior = 0;
    for (let i = 1; i < ord.length; i++) {
      if (ord[i] - ord[i - 1] > maior) { maior = ord[i] - ord[i - 1]; corte = (ord[i] + ord[i - 1]) / 2; }
    }
    geoFallback = {
      xMoeda: xMoeda - 4, xStatus,
      cols: maior >= 12
        ? [{ x1: ord[0], tipo: "sai" }, { x1: ord[ord.length - 1], tipo: "ent" }, { corte, tipo: "_corte" }]
        : [{ x1: ord[ord.length - 1], tipo: "sai" }],
    };
  }

  const geoDe = (() => {
    let ultima = geoFallback;
    const cache = new Map();
    return (pg) => {
      if (cache.has(pg)) return cache.get(pg);
      const g = cabecalhos.get(pg) || ultima;
      if (cabecalhos.get(pg)) ultima = cabecalhos.get(pg);
      cache.set(pg, g);
      return g;
    };
  })();

  // Agrupa os tokens monetários de uma linha e atribui-lhes a coluna
  const montantes = (cells, geo) => {
    const mon = cells.filter(c => c.x >= geo.xMoeda && ehCelulaMontante(c.str)).sort((a, b) => a.x - b.x);
    const gs = [];
    mon.forEach(c => {
      const u = gs[gs.length - 1];
      if (u && c.x - u.x1 <= 8) { u.txt += c.str; u.x1 = c.x1; }
      else gs.push({ txt: c.str, x1: c.x1 });
    });
    const corte = geo.cols.find(c => c.tipo === "_corte");
    return gs.map(g => {
      if (corte) return { txt: g.txt, tipo: g.x1 > corte.corte ? "ent" : "sai" };
      let melhor = geo.cols[0];
      geo.cols.forEach(c => { if (c.tipo !== "_corte" && Math.abs(g.x1 - c.x1) < Math.abs(g.x1 - melhor.x1)) melhor = c; });
      return { txt: g.txt, tipo: melhor.tipo };
    });
  };

  // Agrupa linhas em movimentos (âncora = linha que começa por "28 ago.")
  const grupos = [];
  let pgAtual = null, atual = null;
  uteis.forEach(l => {
    if (l.page !== pgAtual) { pgAtual = l.page; atual = null; }
    if (RE_DATA_REVOLUT.test(l.text)) { atual = { geo: geoDe(l.page), linhas: [l] }; grupos.push(atual); }
    else if (atual) atual.linhas.push(l);
  });

  let temColunaSaldo = false;
  const movs = [];
  grupos.forEach(({ geo, linhas: gl }) => {
    if (!geo) return;
    const ancora = gl[0];
    const m = ancora.text.match(RE_DATA_REVOLUT);
    const mes = MESES_PT[m[2].toLowerCase()];
    if (!mes) return;

    let ano = m[3] ? parseInt(m[3]) : null;
    if (!ano) {
      for (const l of gl.slice(1)) {
        const y = l.cells.find(c => /^\d{4}$/.test(c.str.trim()) && c.x < geo.xStatus / 2);
        if (y) { ano = parseInt(y.str.trim()); break; }
      }
    }
    if (!ano) ano = new Date().getFullYear();
    const dataISO = `${ano}-${String(mes).padStart(2, "0")}-${String(parseInt(m[1])).padStart(2, "0")}`;

    const descToks = [], contaToks = [];
    const buf = { sai: "", ent: "", saldo: "" };
    const completo = (t) => /[.,]\d{2}\s*$/.test(t);

    const alvoData = m[0].replace(/\s+/g, "");
    const xData = ancora.cells.length ? ancora.cells[0].x : 0;
    let acc = "";

    gl.forEach((l, i) => {
      l.cells.forEach(c => {
        const t = c.str.trim();
        if (!t) return;
        if (c.x >= geo.xMoeda) return;
        if (c.x >= geo.xStatus) { contaToks.push(t); return; }
        if (i === 0 && acc.length < alvoData.length && alvoData.startsWith(acc + t.replace(/\s/g, ""))) {
          acc += t.replace(/\s/g, "");
          return;
        }
        if (i > 0 && /^\d{4}$/.test(t) && c.x <= xData + 10) return;
        descToks.push(t);
      });
      // Só se continua a somar enquanto o número estiver incompleto: as linhas
      // de câmbio trazem o contravalor na mesma coluna e esse não conta.
      montantes(l.cells, geo).forEach(g => {
        if (!buf[g.tipo]) buf[g.tipo] = g.txt;
        else if (!completo(buf[g.tipo])) buf[g.tipo] += " " + g.txt;
      });
    });

    const vEnt = parseNum(buf.ent), vSai = parseNum(buf.sai), vSaldo = parseNum(buf.saldo);
    if ((vEnt === null || vEnt === 0) && (vSai === null || vSai === 0)) return;
    if (vSaldo !== null) temColunaSaldo = true;
    const valor = vEnt !== null && vEnt !== 0 ? Math.abs(vEnt) : -Math.abs(vSai || 0);

    const simbolos = buf.sai + buf.ent + buf.saldo;
    const moeda = /£/.test(simbolos) ? "GBP"
      : /\$/.test(simbolos) ? "USD"
      : /€/.test(simbolos) ? "EUR"
      : (/\b(GBP|USD|EUR|CHF|PLN)\b/.exec(contaToks.join(" "))?.[1] || "EUR");

    movs.push({
      dataISO,
      desc: descToks.join(" ").replace(/\s+/g, " ").trim().slice(0, 200),
      valor,
      saldo: vSaldo === null ? 0 : vSaldo,
      moeda,
    });
  });

  const cont = {};
  movs.forEach(x => { cont[x.moeda] = (cont[x.moeda] || 0) + 1; });
  const dominante = Object.keys(cont).sort((a, b) => cont[b] - cont[a])[0] || "EUR";

  // O PDF não vem por ordem cronológica (as primeiras páginas são o período
  // mais antigo), por isso ordena-se do mais recente para o mais antigo.
  movs.sort((a, b) => (a.dataISO < b.dataISO ? 1 : a.dataISO > b.dataISO ? -1 : 0));
  movs.forEach(x => {
    rows.push([x.dataISO, (x.moeda === dominante ? x.desc : `[${x.moeda}] ${x.desc}`) || "Movimento", x.valor, x.saldo]);
  });
  return { rows, semSaldo: !temColunaSaldo };
}

// ── Correspondência com o que já está no ERP ────────────────────────────────
// Comparar por data+descrição+valor+saldo falhava em quase todos os bancos:
//  · a folha do Caixa Único usa por vezes a data valor, o banco a de movimento
//    (Juros de 19-08 no ERP, 27-08 no ficheiro do BNI);
//  · os saldos da folha podem estar desviados por um resíduo antigo;
//  · movimentos do mesmo dia vêm por ordem diferente, o que troca os saldos;
//  · a descrição do extrato mensal difere da do ficheiro diário.
// Por isso o saldo deixa de contar, e compara-se o valor, a data (com uma
// pequena tolerância, e contra as duas datas) e, para desempatar, a descrição.
const PALAVRAS_VAZIAS = new Set(["compra", "pag", "trf", "transf", "para", "imediata", "7449", "conta", "lisboa", "cont", "de", "do", "da", "sobre"]);
const tokens = (t) => new Set(
  String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !PALAVRAS_VAZIAS.has(w))
);
const diasEntre = (a, b) => Math.abs(
  new Date(String(a).slice(0, 10) + "T00:00:00") - new Date(String(b).slice(0, 10) + "T00:00:00")
) / 86400000;

// ── Memória de classificação ─────────────────────────────────────────────────
// Custos recorrentes (débitos diretos, assinaturas, honorários mensais) trazem
// sempre a mesma descrição com um número de referência diferente. A assinatura
// deita fora tudo o que varia — números, referências, datas — e fica com as
// palavras que identificam o fornecedor. Serve para reconhecer que o movimento
// de hoje é o mesmo custo do mês passado e repetir a classificação dada então.
const assinaturaDesc = (t) => {
  const palavras = String(t || "")
    .toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(w =>
      w.length >= 2 &&            // fora letras soltas ("p", "o" de "p/o")
      !/\d/.test(w) &&            // fora referências e NIFs
      !PALAVRAS_VAZIAS.has(w)
    );
  // Duas palavras no mínimo: só "trf" ou "dd" casaria com meio extrato.
  return palavras.length >= 2 ? palavras.slice(0, 5).join(" ") : null;
};

// Índice { assinatura: {categoria, subcategoria, detalhes} } a partir dos
// movimentos já classificados da conta. Em caso de repetição, vence o mais
// recente — a classificação mais actual é a que interessa repetir.
function memoriaDeClassificacao(existentes) {
  const porAssinatura = new Map();
  (existentes || []).forEach(m => {
    if (!m.categoria) return;                   // sem classificação não ensina nada
    const sig = assinaturaDesc(m.movimento);
    if (!sig) return;
    const data = String(m.data || "").slice(0, 10);
    const anterior = porAssinatura.get(sig);
    if (!anterior || data > anterior.data) {
      porAssinatura.set(sig, {
        data,
        categoria: m.categoria || "",
        subcategoria: m.subcategoria || "",
        detalhes: m.detalhes || "",
      });
    }
  });
  return porAssinatura;
}

function emparelhar(novos, existentes, toleranciaDias = 3) {
  // índice por valor absoluto: é o único campo em que as duas fontes coincidem sempre
  const porValor = new Map();
  existentes.forEach(e => {
    const k = Math.abs(Number(e.valor) || 0).toFixed(2);
    if (!porValor.has(k)) porValor.set(k, []);
    porValor.get(k).push({ ...e, _usado: false, _tok: tokens(e.movimento) });
  });
  return novos.map(m => {
    const lista = porValor.get(Math.abs(Number(m.valor) || 0).toFixed(2)) || [];
    const datas = [m.data, m._dataValor].filter(Boolean);
    const tm = tokens(m.movimento);
    let melhor = null, melhorPontos = -1;
    for (const e of lista) {
      if (e._usado) continue;
      const dias = Math.min(...datas.map(d => diasEntre(d, e.data)));
      if (dias > toleranciaDias) continue;
      let comuns = 0; tm.forEach(w => { if (e._tok.has(w)) comuns++; });
      // Mesma data basta. Com datas diferentes exige-se pelo menos uma palavra
      // em comum, para não casar duas comissões de -3,00 de dias vizinhos.
      if (dias > 0 && comuns === 0) continue;
      const pontos = comuns * 10 - dias;
      if (pontos > melhorPontos) { melhorPontos = pontos; melhor = e; }
    }
    if (!melhor) {
      // Não há igual — mas há um movimento do mesmo dia, com a mesma descrição
      // e valor diferente? Então não é novo: é o mesmo movimento com o valor
      // errado no ERP. Importá-lo criaria um duplicado.
      let parecido = null;
      for (const lst of porValor.values()) {
        for (const e of lst) {
          if (e._usado) continue;
          const dias = Math.min(...datas.map(d => diasEntre(d, e.data)));
          if (dias > toleranciaDias) continue;
          let comuns = 0; tm.forEach(w => { if (e._tok.has(w)) comuns++; });
          if (comuns >= 2 && comuns >= Math.min(tm.size, e._tok.size) - 1) { parecido = e; break; }
        }
        if (parecido) break;
      }
      return parecido
        ? { jaExiste: false, divergente: { id: parecido.id, valorErp: Number(parecido.valor), data: parecido.data } }
        : { jaExiste: false };
    }
    melhor._usado = true;
    return {
      jaExiste: true,
      // O movimento que já está no ERP — para a revisão mostrar o que foi
      // classificado da última vez em vez de campos vazios.
      existente: melhor,
      sinalTrocado: Math.sign(Number(melhor.valor)) !== Math.sign(Number(m.valor))
        ? { id: melhor.id, valorCorreto: Number(m.valor) } : null,
    };
  });
}

// ── Cartão de crédito Millennium BCP ────────────────────────────────────────
// Apesar da extensão .xls, o ficheiro é texto separado por tabulações, em
// Latin-1, com decimais à vírgula ("19,81"). Lido como Excel, o "19,81" era
// interpretado como 1981. As compras vêm positivas: são saídas.
function ehCartaoBCP(texto) {
  const topo = String(texto || "").slice(0, 600);
  return /^Conta:/m.test(topo) && /Data\s+Mov\./i.test(topo) && /Montante/i.test(topo);
}

function parseCartaoBCP(texto) {
  const rows = [["Data", "Descrição", "Valor", "Saldo"]];
  const linhas = String(texto).split(/\r?\n/);
  const hi = linhas.findIndex(l => /Data\s+Trans\./i.test(l) && /Montante/i.test(l));
  if (hi < 0) return rows;
  const hdr = linhas[hi].split("\t").map(h => h.trim());
  const iMov = hdr.findIndex(h => /^Data\s+Mov/i.test(h));
  const iTrans = hdr.findIndex(h => /^Data\s+Trans/i.test(h));
  const iDesc = hdr.findIndex(h => /Descri/i.test(h));
  const iMont = hdr.findIndex(h => /Montante/i.test(h));
  for (const l of linhas.slice(hi + 1)) {
    if (!l.trim() || /^Nota:/i.test(l)) break;               // rodapé
    const c = l.split("\t");
    const data = (c[iMov >= 0 ? iMov : iTrans] || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) continue;
    const bruto = String(c[iMont] || "").trim().replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
    const montante = parseFloat(bruto);
    if (!Number.isFinite(montante)) continue;
    // Positivo no ficheiro = despesa no cartão. Um valor negativo seria um
    // estorno, e entra como entrada.
    rows.push([data, (c[iDesc] || "").trim().replace(/\s+/g, " "), -montante, 0]);
  }
  return rows;
}

async function parseAnyFile(file, bufPrevio) {
  const name = (file.name || "").toLowerCase();
  if (name.endsWith(".pdf")) {
    const linhas = await parsePDFText(file, bufPrevio);
    const amostra = linhas.slice(0, 60).map(l => l.text).join(" ");
    const ehBNI = /BNI\s*Europa|Consulta de Movimento de Contas|Saldo Contabilístico|bnieuropa/i.test(amostra)
      || linhas.some(l => /^\d{4}-\d{2}-\d{2}\s+-?\d{5,}\s+\d{4}-\d{2}-\d{2}/.test(l.text));
    if (ehBNI) return { rows: parseBNIPDF(linhas), preParsedRevolut: true, semSaldo: false };
    // O "Extrato das transações" do Revolut não traz saldo (é pedido ao
    // utilizador); o "Extrato da conta" traz e é lido directamente.
    const { rows, semSaldo } = parseRevolutPDF(linhas);
    return { rows, preParsedRevolut: true, semSaldo };
  }
  // Ficheiros de texto disfarçados de .xls (cartão BCP): detecta-se pelo conteúdo
  if (!name.endsWith(".xlsx")) {
    const texto = await readTextWithFallback(file, bufPrevio);
    if (ehCartaoBCP(texto)) {
      return { rows: parseCartaoBCP(texto), preParsedRevolut: true, semSaldo: false, cartao: true };
    }
    if (name.endsWith(".csv") || name.endsWith(".txt")) return { rows: parseCSVText(texto) };
  }
  return { rows: await parseExcelFile(file, bufPrevio) };
}

function parseMovimentos(rows) {
  if (!rows || rows.length < 2) return [];

  // Find header row — BNI has "Nº conta" in row 1, header in row 2
  let headerRow = 0;
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const cells = (rows[i] || []).map(c => (c||'').toString().toLowerCase().trim());
    const hasData  = cells.some(c => c.includes('data') || c === 'date');
    const hasDesc  = cells.some(c => c.includes('descri') || c.includes('histor'));
    const hasVal   = cells.some(c => c === 'valor' || c === 'montante' || c.includes('débit') || c.includes('crédit'));
    if (hasData && (hasDesc || hasVal)) { headerRow = i; break; }
  }

  const headers = (rows[headerRow] || []).map(h => (h||'').toString().toLowerCase().trim());
  console.log('Header row:', headerRow, '| Headers:', headers);

  // Column detection
  // Aceita "Data Operação" (Banco Invest), "Data Lançamento" (BCP), "Data Mov." (BNI), "Data Valor", "Data"
  const dataCol  = headers.findIndex(h =>
    h === 'data lançamento' || h === 'data lancamento' || h === 'data movimento' ||
    h === 'data operação' || h === 'data operacao' ||
    h === 'data mov.' || h === 'data' ||
    h.startsWith('data l') || h.startsWith('data m') || h.startsWith('data o') || h.startsWith('data v'));
  const descCol  = headers.findIndex(h => h.includes('descri') || h.includes('histor'));
  const valCol   = headers.findIndex(h => h === 'valor' || h === 'montante' || h === 'débito/crédito' || h === 'debito/credito');
  const saldoCol = headers.findIndex(h => h.includes('saldo'));
  // A folha do Caixa Único usa por vezes a data valor e o banco a data de
  // movimento; guarda-se a segunda data para a deduplicação poder usar as duas.
  const dataValorCol = headers.findIndex((h, i) => i !== dataCol && (h === 'data valor' || h.startsWith('data v')));
  const debCol   = headers.findIndex(h => (h.includes('débit') || h.includes('debit')) && !h.includes('crédit') && !h.includes('credit'));
  const credCol  = headers.findIndex(h => (h.includes('crédit') || h.includes('credit')) && !h.includes('débit') && !h.includes('debit'));
  const obsCol   = headers.findIndex(h => h === 'notas' || h.includes('observ') || h.includes('detalhe'));

  // Parse PT number format: "346.267,06" → 346267.06, "-1,19" → -1.19
  const safeFloat = (v) => {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v;
    let s = v.toString().trim().replace(/[€$£\s]/g, '');
    // PT: dot=thousands, comma=decimal: "346.267,06"
    if (s.includes('.') && s.includes(',')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (s.includes(',') && !s.includes('.')) {
      s = s.replace(',', '.');
    }
    const f = parseFloat(s);
    return isNaN(f) ? null : f;
  };

  const normalizeDate = (v) => {
    if (v == null || v === '') return '';
    if (v instanceof Date) {
      return `${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')}`;
    }
    if (typeof v === 'number' && v > 40000) {
      const d = new Date(Math.round((v - 25569) * 86400 * 1000));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
    }
    const s = v.toString().trim();
    // YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
    // YYYYMMDD (CGD)
    if (/^\d{8}$/.test(s)) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
    // DD/MM/YYYY or DD-MM-YYYY
    if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(s)) {
      const sep = s.includes('/') ? '/' : '-';
      const [d, m, y] = s.split(sep);
      return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
    }
    return s.substring(0, 10);
  };

  const movimentos = [];

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (row.every(c => c == null || c === '')) continue;

    const data = normalizeDate(dataCol >= 0 ? row[dataCol] : null);
    if (!data || data < '2015-01-01' || data > '2035-12-31') continue;

    const desc = descCol >= 0 ? (row[descCol]||'').toString().trim() : '';
    if (!desc || ['descrição','descrição','historial','nan','null','undefined'].includes(desc.toLowerCase())) continue;

    let valor = null;
    if (valCol >= 0) {
      valor = safeFloat(row[valCol]);
    } else if (debCol >= 0 || credCol >= 0) {
      const debRaw  = debCol  >= 0 ? safeFloat(row[debCol])  : null;
      const credRaw = credCol >= 0 ? safeFloat(row[credCol]) : null;
      // Banco Invest preenche a coluna que não se aplica com 0 (não com vazio) — tratamos 0 como ausente.
      const deb  = (debRaw  == null || debRaw  === 0) ? null : debRaw;
      const cred = (credRaw == null || credRaw === 0) ? null : credRaw;
      if (cred != null && deb == null) {
        valor = Math.abs(cred);                  // entrada → positivo
      } else if (deb != null && cred == null) {
        valor = -Math.abs(deb);                  // débito = saída → negativo
      } else if (cred != null && deb != null) {
        // Caso raro com ambos preenchidos — saldo líquido
        valor = Math.abs(cred) - Math.abs(deb);
      }
    }
    if (valor == null) continue;

    const saldo = saldoCol >= 0 ? (safeFloat(row[saldoCol]) ?? 0) : 0;
    const obs   = obsCol   >= 0 && row[obsCol] ? row[obsCol].toString().trim() : '';

    const dataValor = dataValorCol >= 0 ? normalizeDate(row[dataValorCol]) : null;
    movimentos.push({
      data,
      _dataValor: dataValor && dataValor !== data ? dataValor : null,
      movimento: desc,
      valor:  Math.round(valor * 100) / 100,
      saldo:  Math.round(saldo * 100) / 100,
      categoria: '',
      detalhes: ['nan','none','não','nao'].includes((obs||'').toLowerCase()) ? '' : obs,
    });
  }

  // BCP & BNI export newest-first → first item is most recent → correct order for display
  console.log(`Parsed ${movimentos.length} movements`);
  return movimentos;
}


const fmt = (v) => fmtEuro(v);

export default function ImportarExtrato({ onSaveMovimentos, onGoToExtrato }) {
  const [step, setStep] = useState(0);
  const [empresa, setEmpresa] = useState(null);
  const [banco, setBanco] = useState("");
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [movimentos, setMovimentos] = useState([]);
  const [erro, setErro] = useState("");
  const [saveResult, setSaveResult] = useState(null);
  const [semSaldo, setSemSaldo] = useState(false);   // extrato sem coluna de saldo (Revolut)
  const [saldoFinal, setSaldoFinal] = useState("");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef();
  // Conteúdo do ficheiro já lido para memória (ver handleFile)
  const [fileBuf, setFileBuf] = useState(null);
  // Diagnóstico da deteção de duplicados
  const [avisoDedupe, setAvisoDedupe] = useState("");
  const [nComparados, setNComparados] = useState(0);

  const empObj = EMPRESAS.find(e => e.id === empresa?.id);

  // Lê-se o conteúdo LOGO ao escolher o ficheiro, e não ao carregar em
  // "Processar". Entre as duas coisas o ficheiro pode deixar de estar onde
  // estava — foi movido, apagado, re-descarregado, ou é um ficheiro do
  // OneDrive/Drive que ainda não está no disco — e o browser devolvia
  // "A requested file or directory could not be found". Guardado em memória,
  // o processamento deixa de depender do disco.
  const handleFile = async (f) => {
    setFile(f); setErro(""); setFileBuf(null);
    if (!f) return;
    try {
      const buf = await f.arrayBuffer();
      setFileBuf(buf);
    } catch (e) {
      setFileBuf(null);
      setErro(mensagemFicheiroIlegivel(f, e));
    }
  };

  const handleParse = async () => {
    if (!file) return;
    setLoading(true);
    setErro("");
    try {
      let movs = [];
      let ehCartao = false;
      const name = file.name.toLowerCase();
      if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv') || name.endsWith('.txt') || name.endsWith('.pdf')) {
        const { rows, preParsedRevolut, semSaldo: sSaldo, cartao } = await parseAnyFile(file, fileBuf);
        ehCartao = !!cartao;
        setSemSaldo(!!sSaldo);
        if (sSaldo) setSaldoFinal("");
        if (preParsedRevolut) {
          // PDF Revolut já vem com cabeçalho ["Data","Descrição","Valor","Saldo"]
          movs = parseMovimentos(rows);
        } else {
          movs = parseMovimentos(rows);
        }
      } else {
        throw new Error("Formato não suportado. Usa Excel (.xlsx), CSV ou PDF (Revolut ou BNI).");
      }
      
      if (movs.length === 0) {
        throw new Error("Não foi possível ler movimentos. Verifica o formato do ficheiro ou se a aba/cabeçalho são reconhecíveis.");
      }

      // ─── Detetar duplicados em relação ao que já está no Supabase para esta conta
      // Chave usada na deduplicação: data + movimento + valor + saldo (mesma que o saveMovimentos)
      let existingKeys = new Set();
      let existentesCartao = new Map();    // "data|valor absoluto" → linhas já existentes
      let existentesTodos = [];
      let existentesPorChave = new Map();   // chave do movimento → linha já gravada
      const contaId = buildContaId(empresa?.id, banco);
      if (contaId) {
        try {
          // Quantos movimentos tem mesmo esta conta. Serve para confirmar, no
          // fim, que a lista de comparação ficou completa.
          const { count: totalNaBase } = await supabase
            .from('movimentos').select('id', { count: 'exact', head: true })
            .eq('conta_id', contaId);

          // Para contas com muitos movimentos paginamos. A ORDEM é obrigatória:
          // sem ORDER BY o Postgres não garante a mesma sequência entre pedidos,
          // e numa conta com mais de 1000 linhas a segunda página podia repetir
          // umas e saltar outras. As que escapavam não eram comparadas e o
          // extrato seguinte voltava a importá-las como novas.
          // Colunas: as primeiras cinco são as que identificam o movimento e
          // chegam para detetar duplicados. As restantes só servem para mostrar
          // a classificação já gravada. Se alguma não existir nesta base, a
          // consulta inteira falha — por isso há uma segunda tentativa só com o
          // essencial. Foi exactamente isto que aconteceu: pedia-se uma coluna
          // "fornecedor" que a tabela não tem (o campo chama-se entidade_id), a
          // consulta dava erro e a deteção de duplicados ficava sem nada para
          // comparar, deixando passar tudo como novo.
          const COLS_COMPLETO = 'id, data, movimento, valor, saldo, categoria, subcategoria, detalhes';
          const COLS_MINIMO   = 'id, data, movimento, valor, saldo';

          const buscarTudo = async (cols) => {
            let acc = [], from = 0;
            while (true) {
              const { data, error } = await supabase
                .from('movimentos')
                .select(cols)
                .eq('conta_id', contaId)
                .order('id', { ascending: true })
                .range(from, from + 999);
              if (error) return { linhas: null, error };
              if (!data?.length) break;
              acc = acc.concat(data);
              if (data.length < 1000) break;
              from += 1000;
              if (from > 60000) return { linhas: acc, error: { message: "demasiados movimentos" } };
            }
            return { linhas: acc, error: null };
          };

          let { linhas: all, error: erroBusca } = await buscarTudo(COLS_COMPLETO);
          if (erroBusca) {
            console.warn("Dedupe: consulta completa falhou, a tentar só o essencial —", erroBusca.message);
            ({ linhas: all, error: erroBusca } = await buscarTudo(COLS_MINIMO));
          }
          const falhou = !!erroBusca;
          all = all || [];

          // Se não vieram todos, dizê-lo: importar assim criaria duplicados sem
          // ninguém dar por isso.
          if (falhou || (Number.isFinite(totalNaBase) && all.length < totalNaBase)) {
            setAvisoDedupe(
              `Só foi possível comparar ${all.length} dos ${totalNaBase ?? "?"} movimentos já existentes nesta conta. `
              + `Os duplicados podem não ser todos detetados — confere a lista antes de guardar.`
            );
          } else {
            setAvisoDedupe("");
          }
          setNComparados(all.length);
          existingKeys = new Set(all.map(m => impMovKey(m)));
          existentesPorChave = new Map(all.map(m => [impMovKey(m), m]));
          existentesTodos = all;
          // Cartão: a descrição do extrato mensal ("COMPRA ADOBE 044-207-3650")
          // difere da do ficheiro diário ("COMPRA 7449 ADOBE ADOBE 0442073650").
          // Compara-se por data + valor, contando repetições — duas compras
          // iguais no mesmo dia continuam a ser duas.
          // Compara-se o valor ABSOLUTO: parte dos movimentos do cartão entrou
          // no ERP com o sinal trocado (vieram positivos da folha), e têm de
          // ser reconhecidos como o mesmo movimento — e corrigidos.
          all.forEach(m => {
            const k = `${String(m.data || "").slice(0, 10)}|${Math.abs(Number(m.valor) || 0).toFixed(2)}`;
            if (!existentesCartao.has(k)) existentesCartao.set(k, []);
            existentesCartao.get(k).push(m);
          });
        } catch (e) {
          console.warn("Erro a verificar duplicados:", e);
        }
      }

      // Aprovar apenas os NOVOS por defeito. Duplicados ficam visíveis mas desmarcados.
      const pares = emparelhar(movs, existentesTodos);
      const memoria = memoriaDeClassificacao(existentesTodos);
      const tagged = movs.map((m, i) => {
        const jaExiste = pares[i].jaExiste || existingKeys.has(impMovKey(m));
        const sinalTrocado = pares[i].sinalTrocado || null;
        const divergente = pares[i].divergente || null;
        const outraMoeda = /^\[[A-Z]{3}\]/.test(m.movimento || "");

        // Já existe: mostra o que está gravado, para a revisão ter o histórico
        // à vista em vez de campos vazios.
        const existente = pares[i].existente || existentesPorChave.get(impMovKey(m)) || null;

        // Novo: se o ficheiro não trouxer categoria, procura-se na memória da
        // conta um custo com a mesma assinatura e repete-se a classificação.
        const sig = assinaturaDesc(m.movimento);
        const sugerido = (!jaExiste && !m.categoria && sig) ? memoria.get(sig) : null;

        const base = existente || sugerido || null;
        return {
          ...m,
          id: `imp_${i}`,
          aprovado: !jaExiste && !outraMoeda && !divergente,
          catEditada: m.categoria || base?.categoria || "",
          subcategoria: m.subcategoria || base?.subcategoria || "",
          detalhes: m.detalhes || base?.detalhes || "",
          _jaExiste: jaExiste,
          _existente: existente,
          // Marca para o ecrã poder dizer que o valor foi sugerido e não lido
          // do ficheiro — quem revê tem de saber a diferença.
          _sugerido: sugerido ? true : false,
          _outraMoeda: outraMoeda,
          _sinalTrocado: sinalTrocado,
          _divergente: divergente,
        };
      });
      setMovimentos(tagged);
      setStep(2);
    } catch(e) {
      setErro(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Mudar a categoria invalida a subcategoria anterior
  const updateCat = (id, cat) => setMovimentos(ms => ms.map(m => m.id === id ? { ...m, catEditada: cat, subcategoria: "", _sugerido: false } : m));
  const toggleAprov = (id) => setMovimentos(ms => ms.map(m => m.id === id ? { ...m, aprovado: !m.aprovado } : m));
  // "Aprovar todos os novos" — não toca nos duplicados (que ficam desmarcados)
  const aprovarTodos = () => setMovimentos(ms => ms.map(m => (m._jaExiste || m._outraMoeda) ? m : { ...m, aprovado: true }));

  // O extrato Revolut não traz saldo. Com o saldo final da conta, reconstrói-se
  // o saldo de cada movimento para trás (os movimentos vêm do mais recente para
  // o mais antigo). Linhas noutra moeda ficam de fora da cadeia.
  useEffect(() => {
    if (!semSaldo) return;
    const base = parseNum(saldoFinal);
    setMovimentos(ms => {
      if (!ms.length) return ms;
      if (base === null) return ms.some(m => m.saldo) ? ms.map(m => ({ ...m, saldo: 0 })) : ms;
      let s = base;
      return ms.map(m => {
        if (m._outraMoeda) return { ...m, saldo: 0 };
        const linha = { ...m, saldo: Math.round(s * 100) / 100 };
        s = Math.round((s - (Number(m.valor) || 0)) * 100) / 100;
        return linha;
      });
    });
  }, [saldoFinal, semSaldo]);

  const [aCorrigir, setACorrigir] = useState(false);
  const corrigirSinais = async () => {
    const alvo = movimentos.filter(m => m._sinalTrocado);
    if (!alvo.length) return;
    if (!confirm(`Corrigir o sinal de ${alvo.length} movimentos já gravados no ERP?`)) return;
    setACorrigir(true);
    let ok = 0, falhas = 0;
    for (const m of alvo) {
      const { data, error } = await supabase.from("movimentos")
        .update({ valor: m._sinalTrocado.valorCorreto }).eq("id", m._sinalTrocado.id).select("id");
      if (error || !data?.length) falhas++; else ok++;
    }
    setACorrigir(false);
    setMovimentos(ms => ms.map(x => x._sinalTrocado ? { ...x, _sinalTrocado: null } : x));
    alert(falhas
      ? `${ok} corrigidos, ${falhas} falharam — provavelmente falta política de UPDATE na tabela movimentos.`
      : `${ok} movimentos corrigidos.`);
  };

  const aprovados = movimentos.filter(m => m.aprovado);
  const duplicados = movimentos.filter(m => m._jaExiste);
  const sugeridos = movimentos.filter(m => m._sugerido);
  const novos = movimentos.filter(m => !m._jaExiste);
  const [esconderDuplicados, setEsconderDuplicados] = useState(false);
  const movimentosVisiveis = esconderDuplicados ? movimentos.filter(m => !m._jaExiste) : movimentos;

  const handleSave = async () => {
    const toSave = aprovados.map(m => ({ ...m, categoria: m.catEditada || m.categoria }));
    setSaving(true);
    try {
      const result = await onSaveMovimentos?.({ empresa: empresa.id, banco, movimentos: toSave });
      setSaveResult(result || { ok: true, inserted: toSave.length, skipped: 0, error: "" });
    } catch (e) {
      setSaveResult({ ok: false, inserted: 0, skipped: 0, error: e?.message || String(e) });
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setStep(0); setFile(null); setMovimentos([]); setErro(""); setSaveResult(null);
    setEmpresa(null); setBanco("");
  };

  // ── Step 0: Empresa & Banco ────────────────────────────────────────────────
  if (step === 0) return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#1a1a2e", fontFamily: "Georgia,serif", marginBottom: 4 }}>📄 Importar Extrato Bancário</div>
        <div style={{ fontSize: 13, color: "#888" }}>Seleciona a empresa e o banco, faz upload do extrato (Excel, CSV ou PDF Revolut/BNI) e os movimentos são adicionados ao Caixa Único.</div>
      </div>

      <div>
        <label style={{ fontSize: 11, color: "#888", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 10 }}>Empresa (SPV)</label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
          {EMPRESAS.map(e => (
            <div key={e.id} onClick={() => { setEmpresa(e); setBanco(""); }}
              style={{ background: empresa?.id === e.id ? "#1a1a2e" : "#fff", border: `2px solid ${empresa?.id === e.id ? "#1a1a2e" : "#eee"}`, borderRadius: 10, padding: "12px 14px", cursor: "pointer", transition: "all 0.15s" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: empresa?.id === e.id ? "#C8A96E" : "#1a1a2e" }}>{e.nome}</div>
              <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
                {e.contas.map(b => <span key={b} style={{ fontSize: 9, padding: "1px 6px", borderRadius: 3, background: empresa?.id === e.id ? "#ffffff22" : "#f0f0f0", color: empresa?.id === e.id ? "#ddd" : "#888", fontFamily: "monospace" }}>{b}</span>)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {empresa && (
        <div>
          <label style={{ fontSize: 11, color: "#888", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 10 }}>Conta Bancária</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {empObj?.contas.map(b => (
              <button key={b} onClick={() => setBanco(b)}
                style={{ background: banco === b ? "#1a1a2e" : "#fff", color: banco === b ? "#C8A96E" : "#666", border: `2px solid ${banco === b ? "#1a1a2e" : "#eee"}`, padding: "8px 20px", borderRadius: 8, fontSize: 13, cursor: "pointer", fontWeight: banco === b ? 700 : 400 }}>
                {b}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button onClick={() => setStep(1)} disabled={!empresa || !banco}
          style={{ background: empresa && banco ? "#1a1a2e" : "#e0e0e0", color: empresa && banco ? "#fff" : "#aaa", border: "none", padding: "12px 32px", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: empresa && banco ? "pointer" : "default" }}>
          Continuar →
        </button>
      </div>
    </div>
  );

  // ── Step 1: Upload ─────────────────────────────────────────────────────────
  if (step === 1) return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ background: "#f8f9fc", borderRadius: 10, padding: "12px 16px", display: "flex", gap: 16, alignItems: "center" }}>
        <div><span style={{ fontSize: 10, color: "#aaa", fontFamily: "monospace" }}>EMPRESA</span><div style={{ fontSize: 13, fontWeight: 700, color: "#1a1a2e" }}>{empresa?.nome}</div></div>
        <div style={{ width: 1, height: 32, background: "#e0e0e0" }} />
        <div><span style={{ fontSize: 10, color: "#aaa", fontFamily: "monospace" }}>BANCO</span><div style={{ fontSize: 13, fontWeight: 700, color: "#1a1a2e" }}>{banco}</div></div>
        <button onClick={() => setStep(0)} style={{ marginLeft: "auto", background: "none", border: "1px solid #eee", borderRadius: 6, padding: "4px 12px", fontSize: 11, color: "#aaa", cursor: "pointer" }}>Alterar</button>
      </div>

      <div onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
        onClick={() => fileRef.current?.click()}
        style={{ border: `2px dashed ${dragging ? "#1a1a2e" : file ? "#16a34a" : "#ddd"}`, borderRadius: 16, padding: "52px 24px", textAlign: "center", cursor: "pointer", background: file ? "#f0fdf4" : "#fafafa", transition: "all 0.2s" }}>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.txt,.pdf" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />
        {file ? (
          <>
            <div style={{ fontSize: 40, marginBottom: 10 }}>✅</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#16a34a" }}>{file.name}</div>
            <div style={{ fontSize: 12, color: "#aaa", marginTop: 4 }}>{fmtNum(file.size / 1024, 1)} KB · Clica para trocar</div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 48, marginBottom: 14 }}>📊</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#1a1a2e", marginBottom: 8 }}>Arrasta o extrato aqui</div>
            <div style={{ fontSize: 13, color: "#aaa", marginBottom: 14 }}>ou clica para selecionar</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              {["Excel (.xlsx)", "CSV", "PDF (Revolut / BNI)"].map(f => <span key={f} style={{ background: "#fff", border: "1px solid #e0e0e0", color: "#888", fontSize: 11, padding: "4px 12px", borderRadius: 20, fontFamily: "monospace" }}>{f}</span>)}
            </div>
          </>
        )}
      </div>

      <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "12px 16px" }}>
        <div style={{ fontSize: 12, color: "#92400e", fontWeight: 600, marginBottom: 4 }}>💡 Formatos reconhecidos automaticamente</div>
        <div style={{ fontSize: 11, color: "#a16207", lineHeight: 1.7 }}>
          • <strong>BCP Millennium</strong> (.xlsx) — Data Lançamento, Descrição, Montante, Saldo<br/>
          • <strong>BNI</strong> (.xlsx) — Data movimento, Descrição, Valor, Saldo<br/>
          • <strong>Banco Invest</strong> (.xlsx) — Data Operação, Descrição, Débito, Crédito, Saldo<br/>
          • <strong>CGD</strong> (.csv) — Data (YYYYMMDD), Descrição, Montante, Saldo<br/>
          • <strong>Revolut Business</strong> (.pdf) — "Extrato da conta" (com saldo) e "Extrato das transações"<br/>
          • <strong>BNI Europa</strong> (.pdf) — Consulta de Movimento de Contas
        </div>
      </div>

      {erro && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "12px 16px", color: "#dc2626", fontSize: 13 }}>⚠️ {erro}</div>}

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <button onClick={() => setStep(0)} style={{ background: "none", border: "1px solid #eee", padding: "12px 24px", borderRadius: 10, fontSize: 14, color: "#888", cursor: "pointer" }}>← Voltar</button>
        <button onClick={handleParse} disabled={!file || loading}
          style={{ background: file && !loading ? "#1a1a2e" : "#e0e0e0", color: file && !loading ? "#fff" : "#aaa", border: "none", padding: "12px 32px", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: file && !loading ? "pointer" : "default", display: "flex", alignItems: "center", gap: 10 }}>
          {loading ? "A processar..." : "📊 Processar Extrato →"}
        </button>
      </div>
    </div>
  );

  // ── Step 2: Revisão ────────────────────────────────────────────────────────
  if (step === 2 && !saveResult) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {avisoDedupe && (
          <div style={{
            background: nComparados === 0 ? "#fef2f2" : "#fffbeb",
            border: "1px solid " + (nComparados === 0 ? "#fecaca" : "#fde68a"),
            color: nComparados === 0 ? "#991b1b" : "#92400e",
            borderRadius: 10, padding: "12px 16px", fontSize: 12, lineHeight: 1.6,
          }}>
            {nComparados === 0 ? "⛔" : "⚠️"} {avisoDedupe}
            {nComparados === 0 && <div style={{ marginTop: 6, fontWeight: 700 }}>
              Não guardes esta importação — nenhum duplicado foi detetado e todos os movimentos vão entrar como novos.
            </div>}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#1a1a2e", fontFamily: "Georgia,serif" }}>Rever Movimentos</div>
            <div style={{ fontSize: 13, color: "#888", marginTop: 2 }}>
              {empresa?.nome} · {banco} · {movimentos.length} movimentos lidos
              {duplicados.length > 0 && (
                <span style={{ color: "#92400e", fontWeight: 600, marginLeft: 6 }}>
                  · {duplicados.length} já existem no extrato (desmarcados)
                </span>
              )}
              {sugeridos.length > 0 && (
                <span style={{ color: "#2563eb", fontWeight: 600, marginLeft: 6 }}>
                  · {sugeridos.length} classificados automaticamente a partir do histórico
                </span>
              )}
              {nComparados > 0 && (
                <span style={{ color: "#aaa", marginLeft: 6 }}>
                  · comparado com {nComparados} movimentos já no extrato
                </span>
              )}
            </div>
          </div>
          <button onClick={reset} style={{ background: "none", border: "1px solid #eee", padding: "7px 16px", borderRadius: 8, fontSize: 12, color: "#888", cursor: "pointer" }}>← Novo upload</button>
        </div>

        {/* KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12 }}>
          {[
            { label: "Total lidos", value: movimentos.length, color: "#1a1a2e", fmt: v => v },
            { label: "Novos", value: novos.length, color: "#16a34a", fmt: v => v },
            { label: "Já existentes", value: duplicados.length, color: "#92400e", fmt: v => v },
            { label: "Entradas (novos)", value: aprovados.filter(m => m.valor > 0).reduce((s, m) => s + m.valor, 0), color: "#16a34a", fmt: fmt },
            { label: "Saídas (novos)", value: Math.abs(aprovados.filter(m => m.valor < 0).reduce((s, m) => s + m.valor, 0)), color: "#dc2626", fmt: fmt },
          ].map((k, i) => (
            <div key={i} style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 10, padding: "12px 16px", borderTop: `3px solid ${k.color}` }}>
              <div style={{ fontSize: 10, color: "#aaa", textTransform: "uppercase", fontFamily: "monospace", marginBottom: 4 }}>{k.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: k.color, fontFamily: "monospace" }}>{k.fmt(k.value)}</div>
            </div>
          ))}
        </div>

        {semSaldo && (
          <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 12, padding: "14px 18px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#92400e", marginBottom: 3 }}>Este extrato não tem coluna de saldo</div>
              <div style={{ fontSize: 12, color: "#a16207", lineHeight: 1.5 }}>
                O Revolut lista Saídas e Entradas, sem saldo acumulado. Indica o saldo da conta
                <strong> depois do movimento mais recente</strong> e o saldo de cada linha é calculado para trás.
                Podes guardar sem preencher — os saldos ficam a zero.
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input value={saldoFinal} onChange={e => setSaldoFinal(e.target.value)}
                placeholder="ex.: 12 345,67"
                style={{ width: 150, background: "#fff", border: "1px solid #fcd34d", borderRadius: 8, padding: "9px 12px", fontSize: 14, fontFamily: "monospace", outline: "none", textAlign: "right" }} />
              <span style={{ fontSize: 15, color: "#a16207", fontWeight: 700 }}>€</span>
            </div>
          </div>
        )}

        {/* Movimentos já no ERP mas com o sinal trocado */}
        {movimentos.some(m => m._sinalTrocado) && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: "14px 18px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#b91c1c", marginBottom: 3 }}>
                {movimentos.filter(m => m._sinalTrocado).length} movimentos já estão no ERP com o sinal trocado
              </div>
              <div style={{ fontSize: 12, color: "#b91c1c", lineHeight: 1.5, opacity: 0.85 }}>
                Entraram como entradas quando são compras no cartão. Não são duplicados — são os mesmos
                movimentos, gravados com o sinal errado. A correção só muda o sinal; categoria e notas ficam.
              </div>
            </div>
            <button onClick={corrigirSinais} disabled={aCorrigir}
              style={{ background: "#dc2626", border: "none", color: "#fff", padding: "9px 16px", borderRadius: 8, fontSize: 12, cursor: "pointer", fontWeight: 700 }}>
              {aCorrigir ? "A corrigir…" : "Corrigir sinais"}
            </button>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div style={{ fontSize: 13, color: "#888" }}>
            Verifica e ajusta as categorias antes de guardar
            {movimentos.some(m => m._outraMoeda) && (
              <> · <span style={{ color: "#b45309" }}>
                {movimentos.filter(m => m._outraMoeda).length} linha(s) noutra moeda ficaram por aprovar
              </span></>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {duplicados.length > 0 && (
              <button onClick={() => setEsconderDuplicados(v => !v)}
                title={esconderDuplicados ? "Mostrar movimentos já existentes (cinzentos)" : "Esconder movimentos já existentes"}
                style={{ background: esconderDuplicados ? "#1a1a2e" : "#fff", border: "1px solid #e5e5e5", color: esconderDuplicados ? "#fff" : "#666", padding: "7px 14px", borderRadius: 8, fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
                {esconderDuplicados ? "👁️ Mostrar todos" : "🙈 Esconder duplicados"}
              </button>
            )}
            <button onClick={aprovarTodos} style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#16a34a", padding: "7px 16px", borderRadius: 8, fontSize: 12, cursor: "pointer", fontWeight: 600 }}>✓ Aprovar todos os novos</button>
          </div>
        </div>

        <div style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f8f9fc" }}>
                  {["✓", "Data", "Descrição", "Valor", "Saldo", "Categoria", "Subcategoria", "Observação", "Estado"].map(h => (
                    <th key={h} style={{ padding: "10px 12px", textAlign: "left", color: "#aaa", fontSize: 10, letterSpacing: "0.07em", textTransform: "uppercase", fontFamily: "monospace", borderBottom: "1px solid #f0f0f0", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {movimentosVisiveis.map((m, i) => {
                  const dup = m._jaExiste;
                  const rowBg = dup ? "#f3f4f6" : (m.aprovado ? "" : "#fff8f8");
                  const rowOpacity = dup ? 0.65 : 1;
                  return (
                  <tr key={m.id} style={{ borderBottom: "1px solid #fafafa", background: rowBg, opacity: rowOpacity }}>
                    <td style={{ padding: "9px 12px" }}>
                      <input type="checkbox" checked={m.aprovado} onChange={() => toggleAprov(m.id)} style={{ cursor: "pointer", width: 16, height: 16 }} />
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      <input type="date" value={m.data||""} onChange={e=>setMovimentos(ms=>ms.map(mv=>mv.id===m.id?{...mv,data:e.target.value}:mv))}
                        style={{background:"#f8f8f8",border:"1px solid #eee",borderRadius:6,padding:"4px 7px",fontSize:11,outline:"none",fontFamily:"monospace",width:"115px"}}/>
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      <input type="text" value={m.movimento||""} onChange={e=>setMovimentos(ms=>ms.map(mv=>mv.id===m.id?{...mv,movimento:e.target.value}:mv))}
                        style={{background:"#f8f8f8",border:"1px solid #eee",borderRadius:6,padding:"4px 7px",fontSize:11,outline:"none",width:"200px"}}/>
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      <input type="number" value={m.valor||0} onChange={e=>setMovimentos(ms=>ms.map(mv=>mv.id===m.id?{...mv,valor:parseFloat(e.target.value)||0}:mv))}
                        style={{background:"#f8f8f8",border:"1px solid #eee",borderRadius:6,padding:"4px 7px",fontSize:11,outline:"none",fontFamily:"monospace",width:"90px",color:m.valor>=0?"#16a34a":"#dc2626",fontWeight:700}} step="0.01"/>
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      <input type="number" value={m.saldo||0} onChange={e=>setMovimentos(ms=>ms.map(mv=>mv.id===m.id?{...mv,saldo:parseFloat(e.target.value)||0}:mv))}
                        style={{background:"#f8f8f8",border:"1px solid #eee",borderRadius:6,padding:"4px 7px",fontSize:11,outline:"none",fontFamily:"monospace",width:"90px"}} step="0.01"/>
                    </td>
                    <td style={{ padding: "9px 12px", minWidth: 160 }}>
                      <select value={m.catEditada} onChange={e => updateCat(m.id, e.target.value)}
                        disabled={dup}
                        title={dup ? "Classificação já gravada no ERP. Para a alterar, usa o ecrã Extratos." : undefined}
                        style={{ width: "100%", background: dup ? "#eceef2" : "#f8f8f8", border: "1px solid " + (m._sugerido ? "#bfdbfe" : "#eee"), borderRadius: 6, padding: "4px 8px", fontSize: 11, outline: "none" }}>
                        <option value="">-- sem categoria --</option>
                        {CATEGORIAS.map(c => <option key={c}>{c}</option>)}
                      </select>
                      {m._sugerido && (
                        <div title="Preenchido a partir de um movimento igual já classificado nesta conta. Confirma antes de guardar."
                          style={{ fontSize: 9, color: "#2563eb", fontFamily: "monospace", marginTop: 3 }}>✨ sugerido do histórico</div>
                      )}
                    </td>
                    <td style={{ padding: "9px 12px", minWidth: 150 }}>
                      {/* A subcategoria depende da categoria escolhida */}
                      <select value={m.subcategoria || ""} disabled={dup || !m.catEditada}
                        onChange={e => setMovimentos(ms => ms.map(mv => mv.id === m.id ? { ...mv, subcategoria: e.target.value } : mv))}
                        style={{ width: "100%", background: dup ? "#eceef2" : (m.catEditada ? "#f8f8f8" : "#f2f2f2"), border: "1px solid #eee", borderRadius: 6, padding: "4px 8px", fontSize: 11, outline: "none" }}>
                        <option value="">{m.catEditada ? "-- subcategoria --" : "escolhe a categoria"}</option>
                        {(SUBCATEGORIAS[m.catEditada] || []).map(sc => <option key={sc}>{sc}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: "9px 12px", minWidth: 140 }}>
                      <input
                        type="text"
                        value={m.detalhes || ""}
                        disabled={dup}
                        title={dup ? "Observação já gravada no ERP. Para a alterar, usa o ecrã Extratos." : undefined}
                        onChange={e => setMovimentos(ms => ms.map(mv => mv.id === m.id ? { ...mv, detalhes: e.target.value } : mv))}
                        style={{ width: "100%", background: dup ? "#eceef2" : "#f8f8f8", border: "1px solid #eee", borderRadius: 6, padding: "4px 8px", fontSize: 11, outline: "none", fontFamily: "inherit" }}
                        placeholder={dup ? "—" : "Observação..."}
                      />
                    </td>
                    <td style={{ padding: "9px 12px" }}>
                      {m._divergente ? (
                        <span title={`No ERP este movimento está com ${m._divergente.valorErp.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} € (${m._divergente.data}). O banco diz ${Number(m.valor).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} €. Corrige o valor no Extrato em vez de importar — importar criaria um duplicado.`}
                          style={{ background: "#fff7ed", color: "#c2410c", fontSize: 10, padding: "2px 8px", borderRadius: 12, fontFamily: "monospace", fontWeight: 700, whiteSpace: "nowrap" }}>
                          ≠ valor no ERP: {m._divergente.valorErp.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                        </span>
                      ) : dup ? (
                        <span title="Este movimento já existe no ERP (mesmo valor, data próxima e descrição parecida). Marca a caixa se mesmo assim quiseres reinserir."
                          style={{ background: "#e0e7ff", color: "#3730a3", fontSize: 10, padding: "2px 8px", borderRadius: 12, fontFamily: "monospace", fontWeight: 700 }}>
                          🔁 Já existe
                        </span>
                      ) : (
                        <span style={{ background: m.aprovado ? "#f0fdf4" : "#fff8f8", color: m.aprovado ? "#16a34a" : "#dc2626", fontSize: 10, padding: "2px 8px", borderRadius: 12, fontFamily: "monospace" }}>
                          {m.aprovado ? "Aprovado" : "Ignorado"}
                        </span>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <button onClick={() => setStep(1)} disabled={saving} style={{ background: "none", border: "1px solid #eee", padding: "12px 24px", borderRadius: 10, fontSize: 14, color: "#888", cursor: saving ? "default" : "pointer" }}>← Voltar</button>
          <button onClick={handleSave} disabled={aprovados.length === 0 || saving}
            style={{ background: aprovados.length > 0 && !saving ? "#16a34a" : "#e0e0e0", color: "#fff", border: "none", padding: "12px 32px", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: aprovados.length > 0 && !saving ? "pointer" : "default" }}>
            {saving ? "⏳ A guardar..." : `💾 Guardar ${aprovados.length} movimentos no Caixa Único`}
          </button>
        </div>
      </div>
    );
  }

  // ── Done ────────────────────────────────────────────────────────────────────
  const r = saveResult || { ok: true, inserted: aprovados.length, skipped: 0, error: "" };
  return (
    <div style={{ textAlign: "center", padding: "60px 0" }}>
      <div style={{ fontSize: 64, marginBottom: 20 }}>{!r.ok ? "⚠️" : r.inserted === 0 ? "🟡" : "✅"}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: !r.ok ? "#b91c1c" : r.inserted === 0 ? "#b45309" : "#1a1a2e", fontFamily: "Georgia,serif", marginBottom: 8 }}>
        {!r.ok ? "Erro a guardar" : r.inserted === 0 ? "Nada foi gravado" : "Extrato importado!"}
      </div>
      <div style={{ fontSize: 14, color: "#444", marginBottom: 8 }}>
        <strong style={{ color: r.inserted > 0 ? "#16a34a" : "#b45309" }}>{r.inserted}</strong> movimentos inseridos
        {r.skipped > 0 && <> · <strong style={{ color: "#888" }}>{r.skipped}</strong> ignorados (duplicados)</>}
      </div>
      {r.ok && r.inserted === 0 && (
        <div style={{ fontSize: 12, color: "#b45309", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "10px 14px", maxWidth: 560, margin: "0 auto 14px", textAlign: "left" }}>
          Todos os {r.skipped} movimentos do ficheiro já existiam nesta conta, por isso nada foi inserido.
          Se esperava movimentos novos, confirme a empresa e o banco seleccionados no passo 1 — um extrato
          enviado para a conta errada aparece aqui como duplicado.
        </div>
      )}
      <div style={{ fontSize: 13, color: "#888", marginBottom: r.error ? 16 : 32 }}>
        <strong>{empresa?.nome}</strong> · {banco}
      </div>
      {r.error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", padding: "12px 16px", borderRadius: 10, fontSize: 12, fontFamily: "monospace", marginBottom: 24, maxWidth: 600, marginLeft: "auto", marginRight: "auto", textAlign: "left" }}>
          {r.error}
        </div>
      )}
      <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
        <button onClick={reset} style={{ background: "#fff", color: "#1a1a2e", border: "1px solid #e0e0e0", padding: "12px 24px", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
          + Importar outro extrato
        </button>
        {r.ok && onGoToExtrato && (
          <button onClick={onGoToExtrato} style={{ background: "#1a1a2e", color: "#fff", border: "none", padding: "12px 28px", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            Ver no Extrato →
          </button>
        )}
      </div>
    </div>
  );
}
