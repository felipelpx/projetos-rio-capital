import Card from "./Card.jsx";
import FiltroBar from "./FiltroBar.jsx";
import { Vazio } from "./Bits.jsx";
import { eurCurto, somarCusto } from "../lib/format.js";
import CapaProjeto from "./CapaProjeto.jsx";

/** Quadro com uma coluna por projeto. */
export default function ProjectBoard({ ctx, criarTarefa }) {
  const { base, listaFiltrada, statuses, projects, pessoas, hoje, fotos = {},
          contarComentarios, contarAnexos, bloqueada, onAbrir, podeCriar,
          podeEscrever, guardar, filtroProjetos, ordemEstado } = ctx;

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
              <CapaProjeto projeto={p} url={fotos[p.foto]} guardar={guardar}
                podeEscrever={podeEscrever} />
              {(() => {
                /* O que interessa ver no topo da coluna é quanto está orçamentado
                   aqui dentro, e quantas tarefas ainda não têm número. */
                const c = somarCusto(col);
                if (!p.empresa && !c.comValor && !c.porOrcar) return null;
                return (
                  <div className="col-sub">
                    {p.empresa}
                    {(c.comValor > 0 || c.porOrcar > 0) && (
                      <span className="totchip">
                        {p.empresa ? " · " : ""}
                        {c.comValor > 0 && <b>{eurCurto(c.total)}</b>}
                        {c.porOrcar > 0 && (c.comValor > 0 ? ` + ${c.porOrcar} por orçar` : `${c.porOrcar} por orçar`)}
                      </span>
                    )}
                  </div>
                );
              })()}
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
