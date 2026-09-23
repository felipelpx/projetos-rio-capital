import { initials } from "../lib/format.js";

export function Avatar({ pessoa, sm }) {
  if (!pessoa) return null;
  return (
    <span
      className={"avatar" + (sm ? " sm" : "")}
      style={{ background: pessoa.color || "#777" }}
      title={pessoa.nome}
    >
      {initials(pessoa.nome)}
    </span>
  );
}

export function Avatares({ ids, pessoas, sm = true }) {
  const lista = ids.map((id) => pessoas.find((p) => p.id === id)).filter(Boolean);
  if (!lista.length) return null;
  return (
    <span className="avs">
      {lista.map((p) => <Avatar key={p.id} pessoa={p} sm={sm} />)}
    </span>
  );
}

export function Banner({ tipo, children, onFechar }) {
  if (!children) return null;
  return (
    <div className={"banner " + tipo}>
      <span>{children}</span>
      {onFechar && <button onClick={onFechar} aria-label="Fechar aviso">✕</button>}
    </div>
  );
}

export function Vazio({ titulo, children }) {
  return (
    <div className="empty">
      <h3>{titulo}</h3>
      <p style={{ margin: 0, maxWidth: "36ch" }}>{children}</p>
    </div>
  );
}
