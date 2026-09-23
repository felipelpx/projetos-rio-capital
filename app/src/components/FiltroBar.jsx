import MultiSelect from "./MultiSelect.jsx";

/** A mesma barra de filtros na Lista e no quadro por projeto. */
export default function FiltroBar({ ctx, prefixo }) {
  const { base, listaFiltrada, filtros, setFiltros, abertoMulti, setAbertoMulti,
          itensEstado, itensPrioridade, itensPessoa } = ctx;

  const ativo = filtros.estados != null || filtros.prioridades != null;
  const algum = ativo || filtros.pessoas != null;

  return (
    <div className="gbar-top">
      <span className="eyebrow">Filtrar</span>
      <MultiSelect
        rotuloTudo="Todos os estados" plural="estados" itens={itensEstado}
        valor={filtros.estados} onChange={(v) => setFiltros({ ...filtros, estados: v })}
        aberto={abertoMulti === prefixo + "-est"} onAbrir={(a) => setAbertoMulti(a ? prefixo + "-est" : null)}
      />
      <MultiSelect
        rotuloTudo="Todas as prioridades" plural="prioridades" itens={itensPrioridade}
        valor={filtros.prioridades} onChange={(v) => setFiltros({ ...filtros, prioridades: v })}
        aberto={abertoMulti === prefixo + "-prio"} onAbrir={(a) => setAbertoMulti(a ? prefixo + "-prio" : null)}
      />
      <MultiSelect
        rotuloTudo="Todos os colaboradores" plural="colaboradores" itens={itensPessoa}
        valor={filtros.pessoas} onChange={(v) => setFiltros({ ...filtros, pessoas: v })}
        aberto={abertoMulti === prefixo + "-pes"} onAbrir={(a) => setAbertoMulti(a ? prefixo + "-pes" : null)}
      />
      {algum && (
        <button className="btn btn-sm"
          onClick={() => setFiltros({ estados: null, prioridades: null, pessoas: null })}>
          Limpar
        </button>
      )}
      <span className="spacer" />
      <span className="eyebrow">
        {ativo
          ? `${listaFiltrada.length} de ${base.length} ${base.length === 1 ? "tarefa" : "tarefas"}`
          : `${base.length} ${base.length === 1 ? "tarefa" : "tarefas"}`}
      </span>
    </div>
  );
}
