import { useEffect, useMemo, useRef, useState } from "react";
import { supabase, msgErro } from "../lib/supabase.js";
import { Avatar } from "./Bits.jsx";
import { fmtShort, dias } from "../lib/dates.js";
import { fmtSize, fmtWhen, PRIORIDADES, SETORES, eur } from "../lib/format.js";
import { slipDays, earliestStart, depViolated, wouldCycle } from "../lib/schedule.js";
import { descrever } from "../lib/historico.js";

const BUCKET = "pm-anexos";

/** Campo que só avisa o exterior quando a pessoa sai dele — senão cada
    tecla seria uma gravação, e o que vem do servidor apagava o que se escreve. */
function CampoLento({ valor, onGuardar, textarea, ...props }) {
  const [v, setV] = useState(valor ?? "");
  const focado = useRef(false);
  useEffect(() => { if (!focado.current) setV(valor ?? ""); }, [valor]);
  const comuns = {
    value: v,
    onFocus: () => { focado.current = true; },
    onChange: (e) => setV(e.target.value),
    onBlur: () => { focado.current = false; if ((valor ?? "") !== v) onGuardar(v); },
    ...props
  };
  return textarea ? <textarea className="field" {...comuns} /> : <input className="field" {...comuns} />;
}

/**
 * Campo de data que só entrega o valor quando a pessoa o larga.
 *
 * Gravava a cada mexida. Quem escolhia uma data no calendário e logo a seguir a
 * corrigia — que é o normal — via a correção contar como uma alteração à data
 * anterior, e a aplicação pedia justificação para um campo que a pessoa ainda
 * estava a preencher pela primeira vez. Agora escolher e corrigir é uma coisa
 * só. A pausa existe porque o calendário fecha sem tirar o foco do campo: sem
 * ela, uma data escolhida e deixada assim nunca chegava a ser gravada.
 */
function CampoData({ id, valor, disabled, rotulo, onGuardar }) {
  const [v, setV] = useState(valor ?? "");
  const focado = useRef(false);
  const timer = useRef(null);
  const enviado = useRef(valor ?? "");

  useEffect(() => {
    enviado.current = valor ?? "";
    if (!focado.current) setV(valor ?? "");
  }, [valor]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const entregar = (novo) => {
    clearTimeout(timer.current);
    if ((enviado.current ?? "") === (novo ?? "")) return;
    enviado.current = novo ?? "";
    onGuardar(novo);
  };

  return (
    <input
      className="field" id={id} type="date" value={v} disabled={disabled} aria-label={rotulo}
      onFocus={() => { focado.current = true; }}
      onChange={(e) => {
        const novo = e.target.value;
        setV(novo);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => entregar(novo), 1200);
      }}
      onBlur={(e) => { focado.current = false; entregar(e.target.value); }}
    />
  );
}

export default function TaskDrawer({ ctx, tarefaId, onFechar, onAjustar }) {
  const {
    tasks, statuses, projects, pessoas, comments, historico = [], attachments,
    podeEscrever,   // datas, dependências, apagar — editor e super admin
    podeCriar,      // criar e alterar tarefas — editor parcial para cima
    podeComentar,   // toda a gente com acesso, incluindo o visualizador
    souAdmin, patchTarefa, alterarDatas, apagarTarefa, reporTarefa,
    apagadas = [], guardar, recarregar, sessaoUserId, hoje
  } = ctx;

  /* Também se abre uma tarefa apagada, para ver o histórico dela. */
  const t = tasks.find((x) => x.id === tarefaId) || apagadas.find((x) => x.id === tarefaId);
  const [picker, setPicker] = useState(false);
  const [depPicker, setDepPicker] = useState(false);
  const [procura, setProcura] = useState("");
  const [rebase, setRebase] = useState(false);
  const [porque, setPorque] = useState("");
  const [erroRebase, setErroRebase] = useState(false);
  const [msgAnexo, setMsgAnexo] = useState("");
  const [mudarData, setMudarData] = useState(null);   // { campo, valor }
  const [dataPorque, setDataPorque] = useState("");
  const [erroData, setErroData] = useState("");
  const [mudarOrc, setMudarOrc] = useState(false);
  const [orcNovo, setOrcNovo] = useState("");
  const [orcPorque, setOrcPorque] = useState("");
  const [erroOrc, setErroOrc] = useState("");
  const [comentario, setComentario] = useState("");
  const [aEditar, setAEditar] = useState(null);      // id do comentário a editar
  const [textoEdit, setTextoEdit] = useState("");
  const [histAberto, setHistAberto] = useState(false);
  const [aApagar, setAApagar] = useState(false);
  const [porqueApagar, setPorqueApagar] = useState("");
  const [erroApagar, setErroApagar] = useState("");
  const ficheiro = useRef(null);

  useEffect(() => {
    setPicker(false); setDepPicker(false); setRebase(false);
    setPorque(""); setErroRebase(false); setMsgAnexo(""); setComentario("");
    setMudarOrc(false); setOrcNovo(""); setOrcPorque(""); setErroOrc("");
    setMudarData(null); setDataPorque(""); setErroData("");
    setAEditar(null); setTextoEdit(""); setHistAberto(false);
    setAApagar(false); setPorqueApagar(""); setErroApagar("");
  }, [tarefaId]);

  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") onFechar(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onFechar]);

  const meusComentarios = useMemo(
    () => comments.filter((c) => c.task_id === tarefaId),
    [comments, tarefaId]
  );
  /* Do mais recente para o mais antigo: quem abre o histórico quer saber o que
     aconteceu agora, não o que aconteceu no primeiro dia. */
  const meuHistorico = useMemo(
    () => historico
      .filter((l) => l.task_id === tarefaId)
      .slice()
      .sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em))),
    [historico, tarefaId]
  );

  const meusAnexos = useMemo(
    () => attachments.filter((a) => a.task_id === tarefaId),
    [attachments, tarefaId]
  );

  if (!t) return null;

  const estado = statuses.find((s) => s.id === t.status_id);
  const projeto = projects.find((p) => p.id === t.project_id);
  const sd = slipDays(t);
  const cedo = earliestStart(t, tasks);
  const arrancaCedoDemais = t.deps.some((d) => depViolated(t, d, tasks));
  const reposicoes = meuHistorico.filter((l) => l.campo === "fim_previsto").length;
  const mexidasOrc = meuHistorico.filter((l) => l.campo === "custo_previsto").length;
  const temOrcamento = t.custo_previsto != null;

  const patch = (campos) => patchTarefa(t.id, campos);

  /* Marcar uma data vazia é planear: vai direto. Mexer numa que já lá estava
     muda o plano de toda a gente, e aí pergunta-se porquê antes de gravar — é
     o que fica no histórico quando alguém quiser perceber a derrapagem daqui a
     seis meses. Quem edita são os dois editores. */
  const podeMexerNaData = () => podeCriar;

  /* Parte do que já estiver por confirmar, não do que está gravado: mexer numa
     data não pode deitar fora a mudança que a pessoa já fez na outra. */
  function novasDatas(campo, valor) {
    const base = mudarData || { inicio: t.inicio, fim: t.fim };
    const d = { inicio: base.inicio, fim: base.fim, [campo]: valor || null };
    if (campo === "inicio" && valor && d.fim && d.fim < valor) d.fim = valor;
    if (campo === "fim" && valor && d.inicio && d.inicio > valor) d.inicio = valor;
    return d;
  }

  /* Preencher é escrever onde não havia nada. Se o que se está a escrever
     arrasta a outra data, que já estava marcada, isso é alterar — mesmo que o
     campo mexido estivesse vazio. */
  const soPreenche = (d) =>
    (d.inicio === t.inicio || t.inicio == null) &&
    (d.fim === t.fim || t.fim == null);

  async function pedirData(campo, valor) {
    const d = novasDatas(campo, valor);
    setErroData("");
    /* Voltou ao que estava: já não há nada a justificar. */
    if (d.inicio === t.inicio && d.fim === t.fim) { setMudarData(null); return; }
    if (soPreenche(d)) {
      setMudarData(null);
      await alterarDatas(t.id, d, null);
      return;
    }
    setMudarData(d);
    setDataPorque("");
  }

  /* As duas datas vão juntas, com uma justificação só: mudar o fim de uma obra
     costuma mudar-lhe o início, e pedir a razão duas vezes para a mesma
     decisão é ruído. O histórico fica com uma linha por data. */
  const mudancasPendentes = () => {
    if (!mudarData) return [];
    const l = [];
    if (mudarData.inicio !== t.inicio) l.push(["Início", t.inicio, mudarData.inicio]);
    if (mudarData.fim !== t.fim) l.push(["Fim", t.fim, mudarData.fim]);
    return l;
  };

  async function confirmarData() {
    const j = dataPorque.trim();
    if (!j) { setErroData("Escreve a justificação — fica registada no histórico."); return; }
    const r = await alterarDatas(t.id, mudarData, j);
    if (r?.ok) { setMudarData(null); setDataPorque(""); setErroData(""); }
  }

  async function reporPrevisto() {
    const j = porque.trim();
    if (!j) { setErroRebase(true); return; }
    await guardar(() => supabase.rpc("pm_repor_fim_previsto", { p_task: t.id, p_justificacao: j }));
    setRebase(false); setPorque(""); setErroRebase(false);
  }

  /* Número escrito à portuguesa ou à inglesa: 1.250,50 e 1250.50 dão o mesmo. */
  function lerValor(txt) {
    const limpo = String(txt).trim().replace(/[\s\u00A0€]/g, "");
    if (!limpo) return null;
    const n = Number(limpo.replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
  }

  /* Todo o euro que se escreve passa pela mesma função, e leva justificação —
     tanto o primeiro orçamento como as alterações. A base de dados recusa
     qualquer escrita directa, por isso não há caminho que a salte. */
  async function gravarOrcamento() {
    const j = orcPorque.trim();
    const v = lerValor(orcNovo);
    if (Number.isNaN(v)) { setErroOrc("Escreve um número, por exemplo 12 450."); return; }
    if (v == null && !temOrcamento) { setErroOrc("Escreve o valor."); return; }
    if (!j) { setErroOrc("Escreve a justificação — fica registada nos comentários."); return; }
    const r = await guardar(() => supabase.rpc("pm_definir_orcamento", {
      p_task: t.id, p_valor: v, p_justificacao: j
    }));
    if (r?.ok) { setMudarOrc(false); setOrcNovo(""); setOrcPorque(""); setErroOrc(""); }
  }

  async function confirmarApagar() {
    const j = porqueApagar.trim();
    if (!j) { setErroApagar("Escreve porque é que a tarefa deixou de fazer sentido."); return; }
    const r = await apagarTarefa(t.id, j);
    if (r?.ok) onFechar();
    else setErroApagar(r?.erro || "Não consegui apagar a tarefa.");
  }

  async function guardarComentario(id) {
    const txt = textoEdit.trim();
    if (!txt) return;
    const r = await guardar(() =>
      supabase.from("pm_comments")
        .update({ texto: txt, editado_em: new Date().toISOString() }).eq("id", id));
    if (r?.ok) { setAEditar(null); setTextoEdit(""); }
  }

  async function apagarComentario(id) {
    await guardar(() => supabase.from("pm_comments").delete().eq("id", id));
  }

  async function juntarDependencia(id) {
    setDepPicker(false); setProcura("");
    await guardar(() => supabase.from("pm_task_deps").insert({ task_id: t.id, depende_de: id, dias_espera: 0 }));
    onAjustar(t.id, true);
  }

  async function mudarEspera(depId, valor) {
    let n = parseInt(valor, 10);
    if (isNaN(n) || n < 0) n = 0;
    if (n > 365) n = 365;
    await guardar(() =>
      supabase.from("pm_task_deps").update({ dias_espera: n }).eq("task_id", t.id).eq("depende_de", depId)
    );
    onAjustar(t.id, true);
  }

  async function enviarFicheiro(files) {
    if (!files?.length) return;
    for (const f of files) {
      setMsgAnexo(`A carregar “${f.name}”…`);
      const caminho = `${t.id}/${Date.now()}-${f.name.replace(/[^\w.\-]/g, "_")}`;
      const up = await supabase.storage.from(BUCKET).upload(caminho, f);
      if (up.error) { setMsgAnexo(msgErro(up.error)); return; }
      const ins = await supabase.from("pm_attachments").insert({
        task_id: t.id, tipo: "ficheiro", nome: f.name,
        caminho, tamanho: f.size, mime: f.type, autor_id: sessaoUserId
      });
      if (ins.error) { setMsgAnexo(msgErro(ins.error)); return; }
    }
    setMsgAnexo("");
    recarregar();
  }

  async function descarregar(a) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(a.caminho, 60);
    if (error) { setMsgAnexo(msgErro(error)); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  async function removerAnexo(a) {
    await guardar(() => supabase.from("pm_attachments").delete().eq("id", a.id));
    if (a.tipo === "ficheiro") await supabase.storage.from(BUCKET).remove([a.caminho]);
  }

  async function comentar() {
    const texto = comentario.trim();
    if (!texto) return;
    setComentario("");
    await guardar(() =>
      supabase.from("pm_comments").insert({ task_id: t.id, autor_id: sessaoUserId, texto })
    );
  }

  const candidatas = tasks
    .filter((x) =>
      x.id !== t.id &&
      !t.deps.some((d) => d.depende_de === x.id) &&
      !wouldCycle(t.id, x.id, tasks) &&
      (!procura || (x.titulo || "").toLowerCase().includes(procura.toLowerCase()))
    )
    .sort((a, b) =>
      (a.project_id === t.project_id ? 0 : 1) - (b.project_id === t.project_id ? 0 : 1) ||
      String(a.titulo || "").localeCompare(String(b.titulo || ""), "pt")
    )
    .slice(0, 40);

  const livres = pessoas.filter((p) => !t.assignees.includes(p.id));

  return (
    <>
      <div className="scrim" onClick={onFechar} />
      <aside className="drawer" aria-label="Detalhe da tarefa">
        <div className="drawer-head">
          <span className="eyebrow">Tarefa</span>
          <span className="spacer" />
          <button className="icon-btn" onClick={onFechar} aria-label="Fechar">✕</button>
        </div>

        <div className="drawer-body">
          {t.apagada_em && (
            <p className="apagadanota">
              <b>Tarefa apagada.</b> Fica fora do quadro, mas nada se perdeu — o histórico está
              aqui em baixo.
              {t.apagada_porque && <> Razão dada: “{t.apagada_porque}”.</>}
            </p>
          )}

          {aApagar && (
            <div className="rebaseform">
              <p className="hintline">
                A tarefa sai do quadro mas não é destruída: fica em <b>Tarefas apagadas</b>, na
                barra lateral, com o histórico inteiro, e pode ser reposta.
              </p>
              <textarea className="field" rows="2" value={porqueApagar}
                aria-label="Justificação para apagar"
                placeholder="Porque é que esta tarefa deixou de fazer sentido? (obrigatório)"
                onChange={(e) => { setPorqueApagar(e.target.value); setErroApagar(""); }} />
              {erroApagar && <p className="hintline warnnote">{erroApagar}</p>}
              <div className="row-end">
                <button className="btn btn-sm" onClick={() => setAApagar(false)}>Cancelar</button>
                <button className="btn btn-sm btn-danger" onClick={confirmarApagar}>
                  Apagar e registar
                </button>
              </div>
            </div>
          )}

          <div className="fgroup">
            <label htmlFor="d-titulo">Título</label>
            <CampoLento id="d-titulo" valor={t.titulo} disabled={!podeCriar}
              onGuardar={(v) => patch({ titulo: v })} />
          </div>

          <div className="frow">
            <div className="fgroup">
              <label htmlFor="d-proj">Projeto</label>
              <select className="field" id="d-proj" value={t.project_id || ""} disabled={!podeCriar}
                onChange={(e) => patch({ project_id: e.target.value || null })}>
                <option value="">— sem projeto —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.nome}{p.arquivado ? " (arquivado)" : ""}</option>
                ))}
              </select>
              {projeto?.empresa && <span className="co-note">Empresa: {projeto.empresa}</span>}
            </div>
            <div className="fgroup">
              <label htmlFor="d-estado">Estado</label>
              <select className="field" id="d-estado" value={t.status_id || ""} disabled={!podeCriar}
                onChange={(e) => {
                  const s = statuses.find((x) => x.id === e.target.value);
                  patch({ status_id: e.target.value, ...(s?.conta_concluido ? { progresso: 100 } : {}) });
                }}>
                {statuses.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
          </div>

          <div className="frow tres">
            <div className="fgroup">
              <label htmlFor="d-prio">Prioridade</label>
              <select className="field" id="d-prio" value={t.prioridade || "media"} disabled={!podeCriar}
                onChange={(e) => patch({ prioridade: e.target.value })}>
                {PRIORIDADES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <div className="fgroup">
              <label htmlFor="d-setor">Setor</label>
              <select className="field" id="d-setor" value={t.setor || ""} disabled={!podeCriar}
                onChange={(e) => patch({ setor: e.target.value || null })}>
                <option value="">Sem setor</option>
                {SETORES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
            </div>
            <div className="fgroup">
              <label htmlFor="d-prog">Progresso</label>
              <div className="rangewrap">
                <input id="d-prog" type="range" min="0" max="100" step="5" value={t.progresso || 0}
                  disabled={!podeCriar}
                  onChange={(e) => patch({ progresso: Number(e.target.value) })} />
                <span className="val mono">{t.progresso || 0}%</span>
              </div>
            </div>
          </div>

          <div className="frow">
            <div className="fgroup">
              <label htmlFor="d-inicio">Início</label>
              <CampoData id="d-inicio" rotulo="Início" disabled={!podeMexerNaData()}
                valor={(mudarData ? mudarData.inicio : t.inicio) || ""}
                onGuardar={(v) => pedirData("inicio", v)} />
              {!podeCriar && (
                <span className="co-note">O teu acesso não permite definir datas.</span>
              )}
            </div>
            <div className="fgroup">
              <label htmlFor="d-fim">Fim (real)</label>
              <CampoData id="d-fim" rotulo="Fim (real)" disabled={!podeMexerNaData()}
                valor={(mudarData ? mudarData.fim : t.fim) || ""}
                onGuardar={(v) => pedirData("fim", v)} />

              {t.concluida_em && (
                <span className="co-note oknote">
                  Concluída a {fmtShort(t.concluida_em)}. É esta a data que conta para o desvio
                  e para onde a barra acaba no Gantt.
                </span>
              )}
              <span className={"co-note" + (sd > 0 ? " warnnote" : sd < 0 ? " oknote" : "")}>
                {!t.fim_previsto
                  ? "A data prevista fixa-se na primeira vez que guardares um fim."
                  : sd === 0
                    ? `Previsto: ${fmtShort(t.fim_previsto)} — a cumprir.`
                    : `Previsto: ${fmtShort(t.fim_previsto)} · ${sd > 0 ? "+" + dias(sd) + " de desvio" : dias(-sd) + " adiantado"}`}
                {reposicoes > 0 && <span className="rebadge"> reposta {reposicoes}×</span>}
              </span>

              {/* Repor a linha de base é só de super admin — é a única data que
                  exige justificação e deixa registo permanente. A base de dados
                  recusa na mesma se alguém contornar o botão. */}
              {t.fim_previsto && t.fim && sd !== 0 && !rebase && (
                souAdmin ? (
                  <button className="linkbtn" onClick={() => setRebase(true)}>Repor data prevista</button>
                ) : podeCriar ? (
                  <span className="co-note">
                    Repor a data prevista — apagar a referência do plano — é só de super admin.
                  </span>
                ) : null
              )}
              {rebase && (
                <div className="rebaseform">
                  <p className="hintline">
                    Fim previsto: {fmtShort(t.fim_previsto)} → {fmtShort(t.fim)}. A data antiga deixa de
                    servir de referência e o desvio passa a zero.
                  </p>
                  <textarea className="field" rows="2" value={porque} aria-label="Justificação"
                    placeholder="Porque é que o plano mudou? (obrigatório)"
                    onChange={(e) => { setPorque(e.target.value); setErroRebase(false); }} />
                  {erroRebase && (
                    <p className="hintline warnnote">Escreve a justificação — fica registada nos comentários.</p>
                  )}
                  <div className="row-end">
                    <button className="btn btn-sm" onClick={() => { setRebase(false); setErroRebase(false); }}>Cancelar</button>
                    <button className="btn btn-sm btn-primary" onClick={reporPrevisto}>Repor e registar</button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Recusa antes de chegar ao servidor: preencher uma data vazia não
              pode arrastar a outra, que já estava marcada. */}
          {!mudarData && erroData && (
            <p className="hintline warnnote" style={{ marginTop: -6 }}>{erroData}</p>
          )}

          {mudarData && (
            <div className="rebaseform">
              <ul className="mudancas">
                {mudancasPendentes().map(([rotulo, de, para]) => (
                  <li key={rotulo}>
                    <b>{rotulo}:</b> {fmtShort(de) || "sem data"} → {fmtShort(para) || "sem data"}
                  </li>
                ))}
              </ul>
              <p className="hintline">
                Fica registado no histórico da tarefa, com o teu nome. As tarefas que dependem
                desta são empurradas, se for preciso.
              </p>
              <textarea className="field" rows="2" value={dataPorque} aria-label="Justificação da data"
                placeholder="Porque é que a data mudou? (obrigatório)"
                onChange={(e) => { setDataPorque(e.target.value); setErroData(""); }} />
              {erroData && <p className="hintline warnnote">{erroData}</p>}
              <div className="row-end">
                <button className="btn btn-sm" onClick={() => { setMudarData(null); setErroData(""); }}>
                  Cancelar
                </button>
                <button className="btn btn-sm btn-primary" onClick={confirmarData}>
                  Gravar e registar
                </button>
              </div>
            </div>
          )}

          {/* Custo. Todo o valor em euros é gravado pela função do servidor, que
              obriga a justificar — o primeiro orçamento e cada alteração — e
              deixa registo no histórico. A base de dados recusa na mesma se
              alguém contornar o ecrã. */}
          <div className="fgroup">
            <label>Custo</label>
            <label className="chk">
              <input type="checkbox" checked={!!t.tem_custo}
                disabled={!podeCriar || temOrcamento}
                onChange={(e) => patch({ tem_custo: e.target.checked })} />
              Esta tarefa tem custo
            </label>

            {t.tem_custo && (
              mudarOrc ? (
                <div className="rebaseform">
                  <p className="hintline">
                    {temOrcamento
                      ? <>Orçamento atual: {eur(t.custo_previsto)}. O valor antigo fica no histórico
                          da tarefa, com quem o mudou e porquê. Deixa em branco para o retirar.</>
                      : <>O valor e a razão ficam no histórico da tarefa, com o teu nome.</>}
                  </p>
                  <input className="field" value={orcNovo} inputMode="decimal"
                    aria-label={temOrcamento ? "Novo orçamento" : "Orçamento previsto"}
                    placeholder={temOrcamento ? "Novo valor, em euros" : "Orçamento previsto, em euros"}
                    onChange={(e) => { setOrcNovo(e.target.value); setErroOrc(""); }} />
                  <textarea className="field" rows="2" value={orcPorque} aria-label="Justificação do orçamento"
                    placeholder={temOrcamento
                      ? "Porque é que o orçamento mudou? (obrigatório)"
                      : "Em que se baseia este orçamento? (obrigatório)"}
                    onChange={(e) => { setOrcPorque(e.target.value); setErroOrc(""); }} />
                  {erroOrc && <p className="hintline warnnote">{erroOrc}</p>}
                  <div className="row-end">
                    <button className="btn btn-sm" onClick={() => {
                      setMudarOrc(false); setOrcPorque(""); setErroOrc("");
                    }}>Cancelar</button>
                    <button className="btn btn-sm btn-primary" onClick={gravarOrcamento}>
                      Gravar e registar
                    </button>
                  </div>
                </div>
              ) : temOrcamento ? (
                <>
                  <p className="orcval">{eur(t.custo_previsto)}</p>
                  <span className="co-note">
                    Orçamento previsto.
                    {mexidasOrc > 0 && <span className="rebadge"> alterado {mexidasOrc}×</span>}
                  </span>
                  {podeCriar && (
                    <button className="linkbtn" onClick={() => {
                      setMudarOrc(true); setOrcNovo(String(t.custo_previsto)); setErroOrc("");
                    }}>Alterar orçamento</button>
                  )}
                </>
              ) : podeCriar ? (
                <button className="linkbtn" onClick={() => {
                  setMudarOrc(true); setOrcNovo(""); setOrcPorque(""); setErroOrc("");
                }}>Gravar orçamento</button>
              ) : (
                <span className="co-note">Tem custo, ainda por orçamentar.</span>
              )
            )}

            {!t.tem_custo && podeCriar && !podeEscrever && (
              <span className="co-note">O teu acesso não permite definir custos.</span>
            )}
          </div>

          <div className="fgroup">
            <label>Responsáveis</label>
            <div className="chips">
              {t.assignees.map((id) => {
                const p = pessoas.find((x) => x.id === id);
                if (!p) return null;
                return (
                  <span className="chip" key={id}>
                    <Avatar pessoa={p} sm />{p.nome}
                    {podeCriar && (
                      <button aria-label={"Remover " + p.nome} onClick={() =>
                        guardar(() => supabase.from("pm_task_assignees").delete()
                          .eq("task_id", t.id).eq("user_id", id))}>✕</button>
                    )}
                  </span>
                );
              })}
              {podeCriar && (
                <button className="chip-add" onClick={() => setPicker(!picker)}>+ Atribuir</button>
              )}
            </div>
            {picker && (
              <div className="picker">
                {livres.length ? livres.map((p) => (
                  <button key={p.id} onClick={() => {
                    setPicker(false);
                    guardar(() => supabase.from("pm_task_assignees").insert({ task_id: t.id, user_id: p.id }));
                  }}>
                    <Avatar pessoa={p} sm />{p.nome}
                  </button>
                )) : (
                  <p style={{ margin: "4px 7px", color: "var(--ink-3)", fontSize: 12.5 }}>
                    Toda a equipa já está atribuída.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="fgroup">
            <label>Depende de</label>
            <div className="chips">
              {t.deps.map((d) => {
                const p = tasks.find((x) => x.id === d.depende_de);
                const s = p && statuses.find((x) => x.id === p.status_id);
                const aberta = p && !s?.conta_concluido;
                return (
                  <span className="chip" key={d.depende_de}
                    style={aberta ? { borderColor: "var(--crit)" } : undefined}>
                    <span className="dot" style={{ width: 7, height: 7, borderRadius: "50%", flex: "none", background: s?.color || "#999" }} />
                    {p ? (p.titulo || "Sem título") : "tarefa removida"}
                    {podeEscrever ? (
                      <span className="lagw" title="Dias de espera entre o fim desta antecessora e o arranque da tarefa">
                        +<input className="laginp" type="number" min="0" max="365" step="1"
                          defaultValue={d.dias_espera || 0}
                          aria-label={"Dias de espera depois de " + (p?.titulo || "")}
                          onBlur={(e) => mudarEspera(d.depende_de, e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} /> d
                      </span>
                    ) : d.dias_espera > 0 ? (
                      <span className="lagw">+{d.dias_espera} d</span>
                    ) : null}
                    {podeEscrever && (
                      <button aria-label="Remover dependência" onClick={() =>
                        guardar(() => supabase.from("pm_task_deps").delete()
                          .eq("task_id", t.id).eq("depende_de", d.depende_de))}>✕</button>
                    )}
                  </span>
                );
              })}
              {podeEscrever && (
                <button className="chip-add" onClick={() => setDepPicker(!depPicker)}>+ Depende de</button>
              )}
              {!t.deps.length && !podeEscrever && <span className="dep-sub">Sem dependências.</span>}
            </div>

            {t.deps.length > 0 && (
              <p className="dep-sub" style={{ width: "100%", margin: "4px 0 0" }}>
                {podeEscrever && 'O "+ n d" é a espera entre o fim da antecessora e o arranque desta. '}
                {cedo && (arrancaCedoDemais ? (
                  <>
                    <span style={{ color: "var(--crit)" }}>
                      Pelas dependências, só devia arrancar a {fmtShort(cedo)}.
                    </span>
                    {podeEscrever && t.inicio && t.fim && (
                      <button className="linkbtn" style={{ display: "inline", margin: 0 }}
                        onClick={() => onAjustar(t.id)}> Empurrar para essa data</button>
                    )}
                  </>
                ) : `Pode arrancar a partir de ${fmtShort(cedo)}.`)}
              </p>
            )}

            {depPicker && (
              <div className="deprow">
                <input className="field dep-q" type="search" placeholder="Procurar tarefa…"
                  aria-label="Procurar tarefa" value={procura} autoFocus
                  onChange={(e) => setProcura(e.target.value)} />
                <div>
                  {candidatas.length ? (
                    <div className="picker">
                      {candidatas.map((x) => {
                        const s = statuses.find((y) => y.id === x.status_id);
                        const p = projects.find((y) => y.id === x.project_id);
                        return (
                          <button key={x.id} onClick={() => juntarDependencia(x.id)}>
                            <span className="dot" style={{ width: 7, height: 7, borderRadius: "50%", flex: "none", background: s?.color }} />
                            <span style={{ flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {x.titulo || "Sem título"}
                            </span>
                            {p && <span className="dep-sub">{p.nome}</span>}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="dep-sub" style={{ margin: "4px 2px" }}>
                      Nenhuma tarefa disponível. Uma tarefa não pode depender de si própria nem criar um ciclo.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="fgroup">
            <label>Anexos</label>
            {meusAnexos.length ? (
              <div className="att-list">
                {meusAnexos.map((a) => (
                  <div className="att" key={a.id}>
                    <span className="att-ico">{a.tipo === "link" ? "LINK" : (a.mime || "").split("/")[1]?.slice(0, 4).toUpperCase() || "FICH"}</span>
                    <span className="att-meta">
                      <span className="att-name">{a.nome}</span>
                      <span className="att-sub">
                        {a.tipo === "link" ? (a.url || "").replace(/^https?:\/\//, "").slice(0, 42) : fmtSize(a.tamanho)}
                      </span>
                    </span>
                    {a.tipo === "link" ? (
                      <a className="att-act" href={a.url} target="_blank" rel="noopener noreferrer" title="Abrir link">↗</a>
                    ) : (
                      <button className="att-act" title="Transferir" onClick={() => descarregar(a)}>↓</button>
                    )}
                    {podeEscrever && (
                      <button className="att-act rm" title="Remover" onClick={() => removerAnexo(a)}>✕</button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="att-empty">Sem anexos. Aqui o Excel e o Word funcionam.</p>
            )}
            {podeCriar && (
              <div className="att-actions">
                <button className="chip-add" onClick={() => ficheiro.current?.click()}>+ Carregar ficheiro</button>
                <input ref={ficheiro} type="file" multiple hidden
                  onChange={(e) => { enviarFicheiro([...e.target.files]); e.target.value = ""; }} />
              </div>
            )}
            {msgAnexo && <p className="att-msg busy">{msgAnexo}</p>}
          </div>

          <div className="fgroup">
            <label htmlFor="d-notas">Notas</label>
            <CampoLento id="d-notas" textarea rows="3" valor={t.notas} disabled={!podeCriar}
              placeholder="Contexto, links, próximos passos…" onGuardar={(v) => patch({ notas: v })} />
          </div>

          <div className="fgroup">
            <label>Comentários</label>
            {meusComentarios.length ? (
              <div className="cm-list">
                {meusComentarios.map((c) => {
                  const autor = pessoas.find((p) => p.id === c.autor_id);
                  const nome = autor?.nome || "Alguém";
                  const meu = c.autor_id === sessaoUserId;
                  return (
                    <div className="cm" key={c.id}>
                      <span className="cm-av" style={{ background: autor?.color || "#7C8B99" }}>
                        {nome.slice(0, 1).toUpperCase()}
                      </span>
                      <div className="cm-main">
                        <div className="cm-head">
                          <span className="cm-who">{nome}</span>
                          <span className="cm-when">
                            {fmtWhen(c.criado_em)}
                            {c.editado_em && <span className="cm-edit"> · editado</span>}
                          </span>
                          {/* Cada um mexe no que escreveu. O que lá estava antes
                              não se perde: fica no histórico, em baixo. */}
                          {meu && aEditar !== c.id && (
                            <span className="cm-acoes">
                              <button className="linkbtn" onClick={() => {
                                setAEditar(c.id); setTextoEdit(c.texto);
                              }}>Editar</button>
                              <button className="linkbtn" onClick={() => apagarComentario(c.id)}>
                                Apagar
                              </button>
                            </span>
                          )}
                        </div>
                        {aEditar === c.id ? (
                          <div className="composer">
                            <textarea className="field" rows="2" value={textoEdit}
                              aria-label="Editar comentário"
                              onChange={(e) => setTextoEdit(e.target.value)} />
                            <div className="row-end">
                              <button className="btn btn-sm" onClick={() => setAEditar(null)}>Cancelar</button>
                              <button className="btn btn-sm btn-primary"
                                onClick={() => guardarComentario(c.id)}>Guardar</button>
                            </div>
                          </div>
                        ) : (
                          <p className="cm-text">{c.texto}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="cm-empty">Ainda sem comentários.</p>
            )}
            {podeComentar && (
              <div className="composer">
                <textarea className="field" rows="2" placeholder="Escreve um comentário…"
                  value={comentario} onChange={(e) => setComentario(e.target.value)}
                  onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") comentar(); }} />
                <div className="row-end">
                  <span className="hintline">⌘/Ctrl + Enter para enviar</span>
                  <button className="btn btn-sm btn-primary" onClick={comentar}>Comentar</button>
                </div>
              </div>
            )}
          </div>

          {/* Histórico. Escrito pela base de dados, não por aqui: apanha
              qualquer alteração, venha do ecrã ou de outro lado. */}
          <div className="fgroup">
            <label>Histórico de alterações</label>
            {meuHistorico.length ? (
              <>
                <div className="hist">
                  {(histAberto ? meuHistorico : meuHistorico.slice(0, 8)).map((l) => {
                    const autor = pessoas.find((p) => p.id === l.autor_id);
                    const d = descrever(l, { statuses, projects, pessoas, tasks });
                    return (
                      <div className="histrow" key={l.id}>
                        <span className="hist-av" style={{ background: autor?.color || "#7C8B99" }}>
                          {(autor?.nome || "?").slice(0, 1).toUpperCase()}
                        </span>
                        <div className="hist-main">
                          <p className="hist-tit">
                            {d.titulo}
                            {d.detalhe && <span className="hist-val"> {d.detalhe}</span>}
                          </p>
                          <p className="hist-pe">
                            {autor?.nome || "Alguém"} · {fmtWhen(l.criado_em)}
                          </p>
                          {l.texto && l.tipo === "campo" && <p className="hist-just">{l.texto}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {meuHistorico.length > 8 && (
                  <button className="linkbtn" onClick={() => setHistAberto(!histAberto)}>
                    {histAberto
                      ? "Mostrar só as últimas 8"
                      : `Ver as ${meuHistorico.length} alterações`}
                  </button>
                )}
              </>
            ) : (
              <p className="cm-empty">Ainda sem alterações registadas.</p>
            )}
          </div>
        </div>

        <div className="drawer-foot">
          {t.apagada_em ? (
            podeEscrever ? (
              <button className="btn btn-sm" onClick={async () => {
                const r = await reporTarefa(t.id);
                if (r?.ok) onFechar();
              }}>Repor tarefa</button>
            ) : (
              <span className="hintline">Tarefa apagada.</span>
            )
          ) : podeEscrever ? (
            <button className="btn btn-danger btn-sm" onClick={() => {
              setAApagar(true); setPorqueApagar(""); setErroApagar("");
            }}>Apagar tarefa</button>
          ) : (
            <span className="hintline">
              {podeCriar ? "O teu acesso não permite apagar." : "Podes ver e comentar."}
            </span>
          )}
          <button className="btn btn-sm" onClick={onFechar}>Fechar</button>
        </div>
      </aside>
    </>
  );
}
