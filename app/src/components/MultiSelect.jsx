import { useEffect, useRef } from "react";

/**
 * Filtro de seleção múltipla. `valor` a null significa "tudo" — é diferente
 * de ter tudo marcado à mão, porque acompanha itens novos.
 */
export default function MultiSelect({ rotuloTudo, plural, itens, valor, onChange, aberto, onAbrir }) {
  const caixa = useRef(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e) => { if (caixa.current && !caixa.current.contains(e.target)) onAbrir(null); };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto, onAbrir]);

  const marcado = (id) => (valor == null ? true : valor.includes(id));
  const alternar = (id) => {
    const todos = itens.map((i) => i.id);
    const atual = valor == null ? todos.slice() : valor.slice();
    const i = atual.indexOf(id);
    if (i >= 0) atual.splice(i, 1);
    else atual.push(id);
    onChange(atual.length === todos.length ? null : atual);
  };

  let rotulo;
  if (valor == null) rotulo = rotuloTudo;
  else if (valor.length === 0) rotulo = "Nenhum selecionado";
  else if (valor.length === 1) rotulo = itens.find((i) => i.id === valor[0])?.nome || `1 ${plural}`;
  else rotulo = `${valor.length} ${plural}`;

  return (
    <div className="multi" ref={caixa}>
      <button
        className={"field multi-btn" + (valor != null ? " on" : "")}
        aria-expanded={aberto}
        onClick={() => onAbrir(aberto ? null : true)}
      >
        <span className="lbl">{rotulo}</span>
        <span className="caret" aria-hidden="true">▾</span>
      </button>
      {aberto && (
        <div className="multi-pop">
          <button className="multi-all" onClick={() => onChange(valor == null ? [] : null)}>
            {valor == null ? "Desmarcar tudo" : "Selecionar tudo"}
          </button>
          {itens.map((i) => (
            <label className="multi-row" key={i.id}>
              <input type="checkbox" checked={marcado(i.id)} onChange={() => alternar(i.id)} />
              {i.color ? <i style={{ background: i.color }} /> : <i className="ghosti" />}
              <span className="nm">{i.nome}</span>
              <span className="ct">{i.n}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
