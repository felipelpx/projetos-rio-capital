import { useState } from "react";
import { supabase, msgErro } from "../lib/supabase.js";

/**
 * Entrada por link de email (magic link) — é o mesmo login do ERP, por ser
 * o mesmo projeto Supabase. Não há senhas a passar por aqui.
 */
export default function Auth() {
  const [email, setEmail] = useState("");
  const [estado, setEstado] = useState({ a: false, erro: "", enviado: false });

  async function entrar(e) {
    e.preventDefault();
    const m = email.trim();
    if (!m) return;
    setEstado({ a: true, erro: "", enviado: false });
    const { error } = await supabase.auth.signInWithOtp({
      email: m,
      options: { emailRedirectTo: window.location.origin }
    });
    setEstado({ a: false, erro: error ? msgErro(error) : "", enviado: !error });
  }

  return (
    <div className="auth-wrap">
      <form className="auth-box" onSubmit={entrar}>
        <h1>Rio Capital — Projetos</h1>
        <p>Escreve o teu email de trabalho. Recebes um link para entrar; é o mesmo acesso do ERP.</p>
        <input
          className="field"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="nome@riocapital.pt"
          aria-label="Email"
          autoComplete="email"
          required
        />
        <button className="btn btn-primary" disabled={estado.a}>
          {estado.a ? "A enviar…" : "Receber link de entrada"}
        </button>
        {estado.erro && <p className="auth-err">{estado.erro}</p>}
        {estado.enviado && (
          <p className="auth-ok">Enviado. Abre o email e clica no link — podes fechar esta página.</p>
        )}
      </form>
    </div>
  );
}
