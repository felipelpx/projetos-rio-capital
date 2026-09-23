import { useState } from "react";
import { supabase, msgErro } from "../lib/supabase.js";

/**
 * Entrada por email e palavra-passe. Sem envio de emails no dia a dia — as
 * contas são criadas por quem administra, no painel do Supabase.
 *
 * (A versão anterior usava link por email. O serviço de email que o Supabase
 * traz de origem envia duas mensagens por hora e não serve para uma equipa.)
 */
export default function Auth() {
  const [email, setEmail] = useState("");
  const [palavra, setPalavra] = useState("");
  const [estado, setEstado] = useState({ a: false, erro: "" });
  const [recuperar, setRecuperar] = useState(false);
  const [enviado, setEnviado] = useState(false);

  async function entrar(e) {
    e.preventDefault();
    const m = email.trim();
    if (!m || !palavra) return;
    setEstado({ a: true, erro: "" });
    const { error } = await supabase.auth.signInWithPassword({ email: m, password: palavra });
    setEstado({ a: false, erro: error ? traduzir(error) : "" });
  }

  async function pedirNova(e) {
    e.preventDefault();
    const m = email.trim();
    if (!m) return;
    setEstado({ a: true, erro: "" });
    const { error } = await supabase.auth.resetPasswordForEmail(m, {
      redirectTo: window.location.origin
    });
    setEstado({ a: false, erro: error ? traduzir(error) : "" });
    setEnviado(!error);
  }

  return (
    <div className="auth-wrap">
      <form className="auth-box" onSubmit={recuperar ? pedirNova : entrar}>
        <h1>Rio Capital — Projetos</h1>

        {recuperar ? (
          <p>Escreve o teu email. Recebes uma mensagem para definir uma palavra-passe nova.</p>
        ) : (
          <p>Entra com o teu email de trabalho e a tua palavra-passe.</p>
        )}

        <input
          className="field" type="email" value={email} autoComplete="username"
          onChange={(e) => setEmail(e.target.value)}
          placeholder="nome@riocapital.pt" aria-label="Email"
        />

        {!recuperar && (
          <input
            className="field" type="password" value={palavra} autoComplete="current-password"
            onChange={(e) => setPalavra(e.target.value)}
            placeholder="palavra-passe" aria-label="Palavra-passe"
          />
        )}

        <button className="btn btn-primary" disabled={estado.a}>
          {estado.a ? "Um momento…" : recuperar ? "Receber link" : "Entrar"}
        </button>

        {estado.erro && <p className="auth-err">{estado.erro}</p>}
        {enviado && !estado.erro && (
          <p className="auth-ok">Enviado. Abre o email e segue o link para definir a palavra-passe.</p>
        )}

        <button type="button" className="linkbtn" style={{ alignSelf: "center" }}
          onClick={() => { setRecuperar(!recuperar); setEstado({ a: false, erro: "" }); setEnviado(false); }}>
          {recuperar ? "Voltar" : "Esqueci-me da palavra-passe"}
        </button>

        <p className="hintline">
          As contas são criadas por quem administra o quadro. Se ainda não tens
          palavra-passe, pede-a antes de tentares entrar.
        </p>
      </form>
    </div>
  );
}

function traduzir(e) {
  const m = String(e?.message || "");
  if (/Invalid login credentials/i.test(m)) return "Email ou palavra-passe errados.";
  if (/Email not confirmed/i.test(m)) return "A conta ainda não foi confirmada. Pede a quem administra para a confirmar.";
  if (/rate limit/i.test(m)) return "Demasiadas tentativas seguidas. Espera um pouco e tenta outra vez.";
  if (/Password should be/i.test(m)) return "A palavra-passe é curta demais (mínimo 6 caracteres).";
  return msgErro(e);
}
