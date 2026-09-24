import { useState } from "react";
import { Avatar } from "./Bits.jsx";
import ProjetoEditor from "./ProjetoEditor.jsx";
import EmpresaEditor from "./EmpresaEditor.jsx";
import { NIVEIS, NIVEIS_EXPLICACAO } from "../lib/format.js";

/** Projetos agrupados por empresa, por ordem alfabética; particulares no fim.
    Agrupa-se pelo empresa_id e não pelo nome: duas empresas podem chamar-se
    parecido, e o nome pode mudar debaixo dos pés. */
function agrupar(projects, empresas) {
  const vivos = projects.filter((p) => !p.arquivado);
  const partilhados = vivos.filter((p) => !p.owner_id);
  const meus = vivos.filter((p) => p.owner_id);
  const porNome = (a, b) => String(a.nome).localeCompare(String(b.nome), "pt", { sensitivity: "base" });

  const usadas = empresas
    .filter((e) => partilhados.some((p) => p.empresa_id === e.id))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt", { sensitivity: "base" }));
  const grupos = usadas.map((e) => ({
    chave: e.id,
    titulo: e.nome,
    empresa: e,
    itens: partilhados.filter((p) => p.empresa_id === e.id).sort(porNome)
  }));
  const soltos = partilhados.filter((p) => !p.empresa_id).sort(porNome);
  if (soltos.length) grupos.push({ chave: "", titulo: "Sem empresa", itens: soltos });
  if (meus.length) grupos.push({ chave: "__priv__", titulo: "Projetos particulares", itens: meus.sort(porNome) });
  return grupos;
}

export default function Sidebar({
  projects, empresas = [], fotos = {}, tasks, statuses, pessoas, acesso, filtroProjetos, setFiltroProjetos, aberta,
  podeCriar, podeEscrever, guardar, sessaoUserId, recarregar
}) {
  const [equipaAberta, setEquipaAberta] = useState(false);
  const [colunasAbertas, setColunasAbertas] = useState(false);
  const [arquivoAberto, setArquivoAberto] = useState(false);
  const [aEditar, setAEditar] = useState(null);   // id do projeto, ou "__novo__"
  const [empresasAbertas, setEmpresasAbertas] = useState(false);
  const [empEditar, setEmpEditar] = useState(null); // id da empresa, ou "__nova__"

  /* Criar um projeto ou uma empresa: editor parcial para cima. Alterar o que já
     existe: só escrita completa — renomear muda-o para toda a gente. */
  const posso = () => podeEscrever;

  const contagem = {};
  for (const t of tasks) contagem[t.project_id] = (contagem[t.project_id] || 0) + 1;

  const arquivados = projects.filter((p) => p.arquivado);
  const vivos = projects.filter((p) => !p.arquivado);
  const todos = filtroProjetos == null;
  const selecionado = (id) => todos || filtroProjetos.includes(id);

  function alternar(id) {
    const base = vivos.map((p) => p.id);
    const atual = filtroProjetos ? filtroProjetos.slice() : base.slice();
    const i = atual.indexOf(id);
    if (i >= 0) atual.splice(i, 1);
    else atual.push(id);
    setFiltroProjetos(atual.length === base.length ? null : atual);
  }

  const linha = (p) => aEditar === p.id ? (
    <ProjetoEditor
      key={p.id} projeto={p} empresas={empresas} guardar={guardar} fotoUrl={fotos[p.foto]}
      podeEscrever={podeEscrever} podeCriar={podeCriar}
      sessaoUserId={sessaoUserId} recarregar={recarregar}
      onFechar={() => setAEditar(null)}
    />
  ) : (
    <div className={"prow" + (p.arquivado ? " archived" : "")} key={p.id}>
      {p.arquivado ? (
        <span className="pcheck-gap" />
      ) : (
        <input
          type="checkbox"
          className="pcheck"
          checked={selecionado(p.id)}
          onChange={() => alternar(p.id)}
          aria-label={"Mostrar " + p.nome}
        />
      )}
      <button
        className="navrow"
        aria-current={!todos && filtroProjetos.length === 1 && filtroProjetos[0] === p.id}
        onClick={() => setFiltroProjetos([p.id])}
      >
        <span className="dot" style={{ background: p.color }} />
        <span className="nm">
          {p.nome}
          {p.owner_id && <span className="lock" title="Só tu vês este projeto"> ●</span>}
        </span>
        <span className="ct">{contagem[p.id] || 0}</span>
        {posso() && (
          <span className="ed" role="button" title="Editar projeto" aria-label={"Editar " + p.nome}
            onClick={(e) => { e.stopPropagation(); setAEditar(p.id); }}>✎</span>
        )}
      </button>
    </div>
  );

  const grupos = agrupar(projects, empresas);
  const mostrarTitulos = grupos.length > 1 || grupos.some((g) => g.chave);

  return (
    <aside className={"side" + (aberta ? " open" : "")} id="side">
      <section>
        <div className="side-head">
          <span className="eyebrow">Projetos</span>
          {podeCriar && (
            <button className="icon-btn" title="Novo projeto" aria-label="Novo projeto"
              onClick={() => setAEditar(aEditar === "__novo__" ? null : "__novo__")}>+</button>
          )}
        </div>
        <div>
          <div className="prow">
            <input
              type="checkbox"
              className="pcheck"
              checked={todos}
              onChange={() => setFiltroProjetos(todos ? [] : null)}
              aria-label="Todos os projetos"
            />
            <button className="navrow" aria-current={todos} onClick={() => setFiltroProjetos(null)}>
              <span className="dot" style={{ background: "var(--ink-3)" }} />
              <span className="nm">Todos os projetos</span>
              <span className="ct">{tasks.filter((t) => !projects.find((p) => p.id === t.project_id)?.arquivado).length}</span>
            </button>
          </div>

          {aEditar === "__novo__" && (
            <ProjetoEditor
              empresas={empresas} guardar={guardar} podeEscrever={podeEscrever}
              podeCriar={podeCriar} sessaoUserId={sessaoUserId} recarregar={recarregar}
              onFechar={() => setAEditar(null)}
            />
          )}

          {grupos.map((g) => (
            <div key={g.chave || "__sem__"}>
              {mostrarTitulos && (
                <button
                  className={"pgrouphead" + (g.chave === "__priv__" ? " mine" : "")}
                  onClick={() => setFiltroProjetos(g.itens.map((p) => p.id))}
                >
                  {g.titulo}{g.empresa?.arquivada ? " · arquivada" : ""}
                  <span>{g.itens.length}</span>
                </button>
              )}
              {g.itens.map(linha)}
            </div>
          ))}

          {vivos.length > 1 && (
            <p className="hintline" style={{ padding: "4px 8px" }}>
              Clica no nome para ver só esse projeto; usa as caixas para juntar vários.
            </p>
          )}

          {arquivados.length > 0 && (
            <>
              <button
                className={"pgrouphead arch" + (arquivoAberto ? "" : " shut")}
                aria-expanded={arquivoAberto}
                onClick={() => setArquivoAberto(!arquivoAberto)}
              >
                <span className="chev" aria-hidden="true">▾</span>
                Arquivados
                <span className="n">{arquivados.length}</span>
              </button>
              {arquivoAberto && arquivados.map(linha)}
            </>
          )}
        </div>
      </section>

      <section>
        <div className="side-head">
          <button className="sectoggle" aria-expanded={empresasAbertas}
            onClick={() => setEmpresasAbertas(!empresasAbertas)}>
            <span className="chev" aria-hidden="true">▾</span>
            <span className="eyebrow">Empresas</span>
            <span className="n">{empresas.filter((e) => !e.arquivada).length || ""}</span>
          </button>
          {podeCriar && empresasAbertas && (
            <button className="icon-btn" title="Nova empresa" aria-label="Nova empresa"
              onClick={() => setEmpEditar(empEditar === "__nova__" ? null : "__nova__")}>+</button>
          )}
        </div>
        {empresasAbertas && (
          <div className="subbox">
            {empEditar === "__nova__" && (
              <EmpresaEditor guardar={guardar} podeEscrever={podeEscrever}
                onFechar={() => setEmpEditar(null)} />
            )}
            {empresas.length === 0 && <p className="hintline">Ainda não há empresas.</p>}
            {empresas.map((e) => empEditar === e.id ? (
              <EmpresaEditor key={e.id} empresa={e} guardar={guardar} podeEscrever={podeEscrever}
                onFechar={() => setEmpEditar(null)} />
            ) : (
              <div className={"member" + (e.arquivada ? " archived" : "")} key={e.id}>
                <span className="nm">
                  {e.nome}
                  {e.arquivada && <span className="co"> · arquivada</span>}
                </span>
                <span className="ct">{projects.filter((p) => p.empresa_id === e.id).length}</span>
                {posso() && (
                  <span className="ed" role="button" title="Editar empresa"
                    aria-label={"Editar empresa " + e.nome}
                    onClick={() => setEmpEditar(e.id)}>✎</span>
                )}
              </div>
            ))}
            <p className="hintline">
              As empresas não se apagam. Uma que feche arquiva-se: sai das escolhas de projeto
              novo, e os projetos que teve ficam como estão.
            </p>
          </div>
        )}
      </section>

      <section>
        <div className="side-head">
          <button className="sectoggle" aria-expanded={equipaAberta} onClick={() => setEquipaAberta(!equipaAberta)}>
            <span className="chev" aria-hidden="true">▾</span>
            <span className="eyebrow">Equipa</span>
            <span className="n">{pessoas.length || ""}</span>
          </button>
        </div>
        {equipaAberta && (
          <div className="subbox">
            <p className="hintline"><b>O teu acesso:</b> {NIVEIS[acesso?.role] || "—"}.</p>
            <div className="acclist">
              {pessoas.map((p) => {
                const n = tasks.filter((t) => t.assignees.includes(p.id)).length;
                return (
                  <div className="accrow" key={p.id}>
                    <Avatar pessoa={p} sm />
                    <span className="accmain">
                      <span className="accnm">{p.nome}</span>
                      <span className="acclvl">
                        {NIVEIS[p.papel] || p.papel} · {n} {n === 1 ? "tarefa" : "tarefas"}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="hintline">
              <b>Super admin</b>: {NIVEIS_EXPLICACAO.admin}{" "}
              <b>Editor</b>: {NIVEIS_EXPLICACAO.interact}{" "}
              <b>Editor parcial</b>: {NIVEIS_EXPLICACAO.contrib}{" "}
              <b>Visualizador</b>: {NIVEIS_EXPLICACAO.view}
            </p>
            <p className="hintline">
              Uma data ou um orçamento por marcar preenche-se sem cerimónia. Alterar o que já lá
              está é de super admin, e leva justificação, que fica nos comentários da tarefa.
            </p>
            <p className="hintline">
              {acesso?.role === "admin"
                ? "Como super admin, dás e retiras acesso na tabela app_access do Supabase."
                : "Os acessos são dados por um super admin."}
            </p>
          </div>
        )}
      </section>

      <section>
        <div className="side-head">
          <button className="sectoggle" aria-expanded={colunasAbertas} onClick={() => setColunasAbertas(!colunasAbertas)}>
            <span className="chev" aria-hidden="true">▾</span>
            <span className="eyebrow">Colunas do quadro</span>
            <span className="n">{statuses.length}</span>
          </button>
        </div>
        {colunasAbertas && (
          <div className="legend">
            {statuses.map((s) => (
              <div className="member" key={s.id}>
                <span className="dot" style={{ width: 9, height: 9, borderRadius: 3, background: s.color, flex: "none" }} />
                <span className="nm">
                  {s.label}
                  {s.conta_concluido && <span className="donemark" title="Conta como concluído"> ✓</span>}
                </span>
                <span className="ct">{tasks.filter((t) => t.status_id === s.id).length}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </aside>
  );
}
