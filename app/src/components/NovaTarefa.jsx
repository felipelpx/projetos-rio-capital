import { useState } from "react";
import { supabase } from "../lib/supabase.js";
import { PRIORIDADES, SETORES } from "../lib/format.js";
import { earliestStart } from "../lib/schedule.js";
import { parseD, toISO, addDays, dayDelta, fmtShort } from "../lib/dates.js";

/**
 * Criar uma tarefa de uma vez só.
 *
 * Antes, carregar em "Nova tarefa" criava já a linha vazia na base de dados e
 * abria a ficha para ir preenchendo. Duas coisas corriam mal: ficavam tarefas
 * sem título por todo o lado quando alguém desistia a meio, e as datas, uma vez
 * escritas, passavam a ser alterações — o que fazia a aplicação pedir
 * justificação a quem ainda estava a criar a tarefa.
 *
 * Aqui nada é gravado enquanto não se carregar em Adicionar tarefa, e então
 * tudo entra junto: para a base de dados é um primeiro preenchimento, e não há
 * justificação nenhuma a pedir.
 */
export default function NovaTarefa({ ctx, statusId, projectId, onFechar }) {
  const { statuses, projects, pessoas, tasks, guardar, onAbrir } = ctx;

  const [titulo, setTitulo] = useState("");
  const [projeto, setProjeto] = useState(projectId || "");
  const [estado, setEstado] = useState(statusId || statuses[0]?.id || "");
  const [prioridade, setPrioridade] = useState("media");
  const [setor, setSetor] = useState("");
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [temCusto, setTemCusto] = useState(false);
  const [orcamento, setOrcamento] = useState("");
  const [orcPorque, setOrcPorque] = useState("");
  const [responsaveis, setResponsaveis] = useState([]);
  const [deps, setDeps] = useState([]);        // [{ id, dias_espera }]
  const [depEscolha, setDepEscolha] = useState("");
  const [notas, setNotas] = useState("");
  const [erro, setErro] = useState("");
  const [aGravar, setAGravar] = useState(false);

  function lerValor(txt) {
    const limpo = String(txt).trim().replace(/[\s €]/g, "");
    if (!limpo) return null;
    const n = Number(limpo.replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
  }

  const alternar = (id) =>
    setResponsaveis((r) => r.includes(id) ? r.filter((x) => x !== id) : [...r, id]);

  /* Candidatas a antecessoras: as do projeto escolhido primeiro, que é onde
     estão quase sempre, e as restantes a seguir. Não há ciclos a temer — uma
     tarefa que ainda não existe não pode ter dependentes. */
  const candidatas = [...tasks]
    .filter((x) => !deps.some((d) => d.id === x.id))
    .sort((a, bb) =>
      (a.project_id === projeto ? 0 : 1) - (bb.project_id === projeto ? 0 : 1) ||
      String(a.titulo).localeCompare(String(bb.titulo), "pt", { sensitivity: "base" }));

  /* O arranque mais cedo que as antecessoras escolhidas permitem. */
  const arranqueMinimo = () => {
    if (!deps.length) return null;
    return earliestStart(
      { deps: deps.map((d) => ({ depende_de: d.id, dias_espera: d.dias_espera })) },
      tasks
    );
  };

  /* Se o início escrito for cedo demais, a tarefa é empurrada — e a duração
     mantém-se, por isso o fim anda o mesmo número de dias. */
  const comEmpurrao = (ini, f) => {
    const cedo = arranqueMinimo();
    if (!cedo || !ini || ini >= cedo) return { inicio: ini, fim: f, empurrou: 0 };
    const dias = dayDelta(parseD(ini), parseD(cedo));
    return {
      inicio: cedo,
      fim: f ? toISO(addDays(parseD(f), dias)) : f,
      empurrou: dias
    };
  };

  const juntarDep = () => {
    if (!depEscolha) return;
    setDeps((d) => [...d, { id: depEscolha, dias_espera: 0 }]);
    setDepEscolha("");
  };
  const mudarEspera = (id, v) => {
    const n = Math.max(0, Math.min(365, parseInt(v, 10) || 0));
    setDeps((d) => d.map((x) => x.id === id ? { ...x, dias_espera: n } : x));
  };

  async function submeter(e) {
    e.preventDefault();
    const nome = titulo.trim();
    if (!nome) { setErro("A tarefa precisa de um título."); return; }
    if (inicio && fim && fim < inicio) { setErro("O fim não pode ser antes do início."); return; }

    const ajustado = comEmpurrao(inicio || null, fim || null);
    const valor = temCusto ? lerValor(orcamento) : null;
    if (Number.isNaN(valor)) { setErro("O orçamento não é um número. Escreve, por exemplo, 12 450."); return; }
    if (valor != null && !orcPorque.trim()) {
      setErro("Escreve em que se baseia o orçamento — fica no histórico da tarefa.");
      return;
    }

    setErro("");
    setAGravar(true);
    const maior = Math.max(0, ...tasks.filter((t) => t.status_id === estado).map((t) => t.posicao || 0));

    const r = await guardar(async () => {
      const ins = await supabase.from("pm_tasks").insert({
        titulo: nome,
        project_id: projeto || null,
        status_id: estado,
        prioridade,
        setor: setor || null,
        inicio: ajustado.inicio,
        fim: ajustado.fim,
        tem_custo: temCusto,
        notas: notas.trim(),
        posicao: maior + 1000
      }).select("id").single();
      if (ins.error) return ins;

      const id = ins.data.id;
      if (responsaveis.length) {
        const a = await supabase.from("pm_task_assignees")
          .insert(responsaveis.map((u) => ({ task_id: id, user_id: u })));
        if (a.error) return a;
      }
      if (deps.length) {
        const dd = await supabase.from("pm_task_deps").insert(
          deps.map((d) => ({ task_id: id, depende_de: d.id, dias_espera: d.dias_espera })));
        if (dd.error) return dd;
      }
      /* O orçamento entra pela função, que exige a razão e deixa registo —
         é a mesma porta por onde passa qualquer euro. */
      if (valor != null) {
        const o = await supabase.rpc("pm_definir_orcamento", {
          p_task: id, p_valor: valor, p_justificacao: orcPorque.trim()
        });
        if (o.error) return o;
      }
      return ins;
    });

    setAGravar(false);
    if (r?.ok) {
      onFechar();
      if (r.data?.id) onAbrir(r.data.id);
    } else if (r?.erro) {
      setErro(r.erro);
    }
  }

  return (
    <>
      <div className="scrim" onClick={onFechar} />
      <aside className="drawer" role="dialog" aria-label="Nova tarefa">
        <div className="drawer-head">
          <span className="eyebrow">Nova tarefa</span>
          <span className="spacer" />
          <button className="icon-btn" onClick={onFechar} aria-label="Fechar">✕</button>
        </div>

        <form className="drawer-body" onSubmit={submeter}>
          <div className="fgroup">
            <label htmlFor="n-titulo">Título</label>
            <input className="field" id="n-titulo" value={titulo} autoFocus
              placeholder="O que é preciso fazer?"
              onChange={(e) => { setTitulo(e.target.value); setErro(""); }} />
          </div>

          <div className="frow">
            <div className="fgroup">
              <label htmlFor="n-proj">Projeto</label>
              <select className="field" id="n-proj" value={projeto}
                onChange={(e) => setProjeto(e.target.value)}>
                <option value="">Sem projeto</option>
                {projects.filter((p) => !p.arquivado).map((p) => (
                  <option key={p.id} value={p.id}>{p.nome}</option>
                ))}
              </select>
            </div>
            <div className="fgroup">
              <label htmlFor="n-estado">Estado</label>
              <select className="field" id="n-estado" value={estado}
                onChange={(e) => setEstado(e.target.value)}>
                {statuses.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
          </div>

          <div className="frow">
            <div className="fgroup">
              <label htmlFor="n-prio">Prioridade</label>
              <select className="field" id="n-prio" value={prioridade}
                onChange={(e) => setPrioridade(e.target.value)}>
                {PRIORIDADES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
            </div>
            <div className="fgroup">
              <label htmlFor="n-setor">Setor</label>
              <select className="field" id="n-setor" value={setor}
                onChange={(e) => setSetor(e.target.value)}>
                <option value="">Sem setor</option>
                {SETORES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
            </div>
          </div>

          <div className="frow">
            <div className="fgroup">
              <label htmlFor="n-inicio">Início</label>
              <input className="field" id="n-inicio" type="date" value={inicio}
                onChange={(e) => { setInicio(e.target.value); setErro(""); }} />
            </div>
            <div className="fgroup">
              <label htmlFor="n-fim">Fim</label>
              <input className="field" id="n-fim" type="date" value={fim}
                onChange={(e) => { setFim(e.target.value); setErro(""); }} />
            </div>
          </div>
          <p className="hintline">
            As datas que puseres agora são o plano inicial — entram sem justificação.
            Mudá-las depois já pede a razão.
          </p>

          <div className="fgroup">
            <label>Custo</label>
            <label className="chk">
              <input type="checkbox" checked={temCusto}
                onChange={(e) => { setTemCusto(e.target.checked); setErro(""); }} />
              Esta tarefa tem custo
            </label>
            {temCusto && (
              <>
                <input className="field" value={orcamento} inputMode="decimal"
                  aria-label="Orçamento previsto" placeholder="Orçamento previsto, em euros (opcional)"
                  onChange={(e) => { setOrcamento(e.target.value); setErro(""); }} />
                {orcamento.trim() && (
                  <textarea className="field" rows="2" value={orcPorque}
                    aria-label="Justificação do orçamento"
                    placeholder="Em que se baseia este orçamento? (obrigatório)"
                    onChange={(e) => { setOrcPorque(e.target.value); setErro(""); }} />
                )}
              </>
            )}
          </div>

          <div className="fgroup">
            <label>Depende de</label>
            {deps.length > 0 && (
              <div className="novadeps">
                {deps.map((d) => {
                  const alvo = tasks.find((x) => x.id === d.id);
                  return (
                    <div className="novadep" key={d.id}>
                      <span className="depnome">{alvo?.titulo || "Tarefa"}</span>
                      <label className="depespera">
                        espera
                        <input className="field laginp" type="number" min="0" max="365"
                          value={d.dias_espera} aria-label={"Dias de espera depois de " + (alvo?.titulo || "")}
                          onChange={(e) => mudarEspera(d.id, e.target.value)} />
                        dias
                      </label>
                      <button type="button" className="icon-btn" aria-label="Tirar dependência"
                        onClick={() => setDeps((x) => x.filter((y) => y.id !== d.id))}>✕</button>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="deppick">
              <select className="field" value={depEscolha} aria-label="Escolher antecessora"
                onChange={(e) => setDepEscolha(e.target.value)}>
                <option value="">Escolhe uma tarefa…</option>
                {candidatas.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.titulo || "Sem título"}
                    {x.project_id !== projeto && projects.find((pp) => pp.id === x.project_id)
                      ? " — " + projects.find((pp) => pp.id === x.project_id).nome
                      : ""}
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn-sm" disabled={!depEscolha} onClick={juntarDep}>
                Juntar
              </button>
            </div>
            <p className="hintline">
              Esta tarefa só arranca depois de as escolhidas acabarem. A espera são os dias que
              têm de passar entre o fim de uma e o arranque desta.
            </p>
            {(() => {
              const aj = comEmpurrao(inicio || null, fim || null);
              if (!aj.empurrou) return null;
              return (
                <p className="hintline warnnote">
                  Com estas dependências a tarefa não pode arrancar a {fmtShort(inicio)}:
                  passa para <b>{fmtShort(aj.inicio)}</b>
                  {aj.fim && <> e o fim para <b>{fmtShort(aj.fim)}</b></>}, mantendo a duração.
                </p>
              );
            })()}
          </div>

          <div className="fgroup">
            <label>Responsáveis</label>
            <div className="acclist">
              {pessoas.map((p) => (
                <label className="chk" key={p.id}>
                  <input type="checkbox" checked={responsaveis.includes(p.id)}
                    onChange={() => alternar(p.id)} />
                  {p.nome}
                </label>
              ))}
            </div>
          </div>

          <div className="fgroup">
            <label htmlFor="n-notas">Notas</label>
            <textarea className="field" id="n-notas" rows="3" value={notas}
              placeholder="O que for preciso lembrar…"
              onChange={(e) => setNotas(e.target.value)} />
          </div>

          {erro && <p className="hintline warnnote">{erro}</p>}

          <div className="row-end">
            <button type="button" className="btn btn-sm" onClick={onFechar}>Cancelar</button>
            <button className="btn btn-primary" disabled={aGravar || !titulo.trim()}>
              {aGravar ? "A adicionar…" : "Adicionar tarefa"}
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}
