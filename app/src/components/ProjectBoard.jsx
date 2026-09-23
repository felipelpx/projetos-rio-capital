import Card from "./Card.jsx";
import FiltroBar from "./FiltroBar.jsx";
import { Vazio } from "./Bits.jsx";

/** Quadro com uma coluna por projeto. */
export default function ProjectBoard({ ctx, criarTarefa }) {
  const { base, listaFiltrada, statuses, projects, pessoas, hoje,
          contarComentarios, contarAnexos, bloqueada, onAbrir, podeCriar,
          filtroProjetos, ordemEstado } = ctx;

  const colunas = (filtroProjetos
    ? projects.filter((p) => filtroProjetos.includes(p.id))
    : projects.filter((p) => !p.arquivado)
  ).sort((a, b) =>
    String(a.empresa || "zz").localeCompare(String(b.empresa || "zz"), "pt") ||
    String(a.nome).localeCompare(String(b.nome), "pt")
  );

  return (
    <div className="view">
      <FiltroBar ctx={ctx} prefixo="p" />
      <div className="board">
        {colunas.map((p) => {
          const col = listaFiltrada
            .filter((t) => t.project_id === p.id)
            .sort((a, b) =>
              ordemEstado(a.status_id) - ordemEstado(b.status_id) ||
              String(a.fim || "9999").localeCompare(String(b.fim || "9999"))
            );
          return (
            <div className="col" key={p.id}>
              <div className="col-head">
                <span className="sq" style={{ background: p.color }} />
                <h3>{p.nome}{p.owner_id && <span className="lock"> ●</span>}</h3>
                <span className="ct">{col.length}</span>
              </div>
              {p.empresa && <div className="col-sub">{p.empresa}</div>}
              <div className="col-list">
                {col.map((t) => (
                  <Card
                    key={t.id} t={t} porProjeto
                    estado={statuses.find((s) => s.id === t.status_id)} projeto={p}
                    pessoas={pessoas} hoje={hoje} nComentarios={contarComentarios(t.id)}
                    nAnexos={contarAnexos(t.id)} bloqueada={bloqueada(t)} onAbrir={onAbrir}
                  />
                ))}
              </div>
              <div className="col-foot">
                {podeCriar && (
                  <button className="add-link" onClick={() => criarTarefa(null, p.id)}>+ Adicionar tarefa</button>
                )}
              </div>
            </div>
          );
        })}
        {!colunas.length && (
          <Vazio titulo="Nenhum projeto para mostrar">
            Limpa o filtro de projetos na barra lateral.
          </Vazio>
        )}
      </div>
    </div>
  );
}
