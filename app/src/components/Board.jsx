import Card from "./Card.jsx";
import MultiSelect from "./MultiSelect.jsx";
import { Vazio } from "./Bits.jsx";

/** Quadro Kanban por estado. Aqui o estado é a coluna, por isso só se filtra prioridade. */
export default function Board({ ctx, criarTarefa }) {
  const { base, statuses, projects, pessoas, hoje, contarComentarios, contarAnexos, bloqueada,
          filtros, setFiltros, abertoMulti, setAbertoMulti, onAbrir, podeCriar, itensPrioridade } = ctx;

  const lista = base.filter((t) => !filtros.prioridades || filtros.prioridades.includes(t.prioridade || "media"));

  return (
    <div className="view">
      <div className="gbar-top">
        <span className="eyebrow">Filtrar</span>
        <MultiSelect
          rotuloTudo="Todas as prioridades" plural="prioridades" itens={itensPrioridade}
          valor={filtros.prioridades} onChange={(v) => setFiltros({ ...filtros, prioridades: v })}
          aberto={abertoMulti === "b-prio"} onAbrir={(a) => setAbertoMulti(a ? "b-prio" : null)}
        />
        {filtros.prioridades != null && (
          <button className="btn btn-sm" onClick={() => setFiltros({ ...filtros, prioridades: null })}>Limpar</button>
        )}
        <span className="spacer" />
        <span className="eyebrow">
          {filtros.prioridades != null
            ? `${lista.length} de ${base.length} ${base.length === 1 ? "tarefa" : "tarefas"}`
            : `${base.length} ${base.length === 1 ? "tarefa" : "tarefas"}`}
        </span>
      </div>

      <div className="board">
        {statuses.map((s) => {
          const col = lista
            .filter((t) => t.status_id === s.id)
            .sort((a, b) => (a.posicao || 0) - (b.posicao || 0));
          return (
            <div className="col" key={s.id}>
              <div className="col-head">
                <span className="sq" style={{ background: s.color }} />
                <h3>{s.label}</h3>
                <span className="ct">{col.length}</span>
              </div>
              <div className="col-list">
                {col.map((t) => (
                  <Card
                    key={t.id} t={t} estado={s} projeto={projects.find((p) => p.id === t.project_id)}
                    pessoas={pessoas} hoje={hoje} nComentarios={contarComentarios(t.id)}
                    nAnexos={contarAnexos(t.id)} bloqueada={bloqueada(t)} onAbrir={onAbrir}
                  />
                ))}
              </div>
              <div className="col-foot">
                {podeCriar && (
                  <button className="add-link" onClick={() => criarTarefa(s.id)}>+ Adicionar tarefa</button>
                )}
              </div>
            </div>
          );
        })}
        {!statuses.length && <Vazio titulo="Sem colunas">Corre o 01_schema.sql e o 02_dados.sql no Supabase.</Vazio>}
      </div>
    </div>
  );
}
