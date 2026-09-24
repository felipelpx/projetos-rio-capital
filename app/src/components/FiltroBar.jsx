import MultiSelect from "./MultiSelect.jsx";
import { eurCurto, somarCusto } from "../lib/format.js";

/** A mesma barra de filtros na Lista e no quadro por projeto. */
export default function FiltroBar({ ctx, prefixo }) {
  const { base, listaFiltrada, filtros, setFiltros, abertoMulti, setAbertoMulti,
          itensEstado, itensPrioridade, itensSetor, itensPessoa } = ctx;

  const ativo = filtros.estados != null || filtros.prioridades != null || filtros.setores != null;
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
        rotuloTudo="Todos os setores" plural="setores" itens={itensSetor}
        valor={filtros.setores} onChange={(v) => setFiltros({ ...filtros, setores: v })}
        aberto={abertoMulti === prefixo + "-set"} onAbrir={(a) => setAbertoMulti(a ? prefixo + "-set" : null)}
      />
      <MultiSelect
        rotuloTudo="Todos os colaboradores" plural="colaboradores" itens={itensPessoa}
        valor={filtros.pessoas} onChange={(v) => setFiltros({ ...filtros, pessoas: v })}
        aberto={abertoMulti === prefixo + "-pes"} onAbrir={(a) => setAbertoMulti(a ? prefixo + "-pes" : null)}
      />
      {algum && (
        <button className="btn btn-sm"
          onClick={() => setFiltros({ estados: null, prioridades: null, setores: null, pessoas: null })}>
          Limpar
        </button>
      )}
      <span className="spacer" />
      {(() => {
        /* Soma o que está à frente dos olhos: muda com os filtros, de propósito. */
        const c = somarCusto(listaFiltrada);
        if (!c.comValor && !c.porOrcar) return null;
        return (
          <span className="totchip" title="Soma dos orçamentos das tarefas visíveis">
            {c.comValor > 0 && <b>{eurCurto(c.total)}</b>}
            {c.porOrcar > 0 && (c.comValor > 0 ? ` + ${c.porOrcar} por orçar` : `${c.porOrcar} por orçar`)}
          </span>
        );
      })()}
      <span className="eyebrow">
        {ativo
          ? `${listaFiltrada.length} de ${base.length} ${base.length === 1 ? "tarefa" : "tarefas"}`
          : `${base.length} ${base.length === 1 ? "tarefa" : "tarefas"}`}
      </span>
    </div>
  );
}
