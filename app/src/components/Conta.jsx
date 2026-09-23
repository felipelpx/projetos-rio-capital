import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase.js";
import { NIVEIS } from "../lib/format.js";

/** Menu da conta: quem sou, mudar a palavra-passe, sair. */
export default function Conta({ email, papel }) {
  const [aberto, setAberto] = useState(false);
  const [nova, setNova] = useState("");
  const [repetir, setRepetir] = useState(false);
  const [msg, setMsg] = useState({ tipo: "", texto: "" });
  const [aGuardar, setAGuardar] = useState(false);
  const caixa = useRef(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e) => { if (caixa.current && !caixa.current.contains(e.target)) fechar(); };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);

  function fechar() {
    setAberto(false); setRepetir(false); setNova(""); setMsg({ tipo: "", texto: "" });
  }

  async function guardar(e) {
    e.preventDefault();
    if (nova.length < 8) {
      setMsg({ tipo: "err", texto: "Usa pelo menos 8 caracteres." });
      return;
    }
    setAGuardar(true);
    let error = null;
    try {
      ({ error } = await supabase.auth.updateUser({ password: nova }));
    } catch (e) {
      error = e;
    } finally {
      setAGuardar(false);   // senão o botão ficava preso em "A guardar…"
    }
    if (error) {
      setMsg({ tipo: "err", texto: /should be at least/i.test(error.message)
        ? "A palavra-passe é curta demais."
        : (error.message || "Não foi possível alterar.") });
      return;
    }
    setNova("");
    setRepetir(false);
    setMsg({ tipo: "ok", texto: "Palavra-passe alterada." });
  }

  return (
    <div className="multi" ref={caixa}>
      <button className="icon-btn" aria-label="A minha conta" title={email}
        aria-expanded={aberto} onClick={() => (aberto ? fechar() : setAberto(true))}>
        ⚙
      </button>
      {aberto && (
        <div className="multi-pop conta-pop">
          <p className="hintline"><b>{email}</b></p>
          <p className="hintline">{NIVEIS[papel] || "—"}</p>

          {repetir ? (
            <form className="subbox" onSubmit={guardar}>
              <label className="sublab" htmlFor="pw-nova">Palavra-passe nova</label>
              {/* sem minLength: a validação do navegador avisaria em inglês */}
              <input className="field" id="pw-nova" type="password" value={nova}
                autoComplete="new-password"
                onChange={(e) => { setNova(e.target.value); setMsg({ tipo: "", texto: "" }); }} />
              <p className="hintline">Pelo menos 8 caracteres.</p>
              <div className="row-end">
                <button type="button" className="btn btn-sm" onClick={() => { setRepetir(false); setNova(""); }}>
                  Cancelar
                </button>
                <button className="btn btn-sm btn-primary" disabled={aGuardar}>
                  {aGuardar ? "A guardar…" : "Guardar"}
                </button>
              </div>
            </form>
          ) : (
            <button className="btn btn-sm" style={{ width: "100%", marginTop: 4 }}
              onClick={() => setRepetir(true)}>
              Mudar palavra-passe
            </button>
          )}

          {msg.texto && (
            <p className={msg.tipo === "ok" ? "auth-ok" : "auth-err"} style={{ marginTop: 6 }}>
              {msg.texto}
            </p>
          )}

          <button className="btn btn-sm btn-danger" style={{ width: "100%", marginTop: 8 }}
            onClick={() => supabase.auth.signOut()}>
            Sair
          </button>
        </div>
      )}
    </div>
  );
}
