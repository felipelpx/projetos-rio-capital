import { useState } from "react";
import { supabase } from "../lib/supabase.js";
import { PALETA } from "../lib/format.js";

/**
 * Criar ou alterar um projeto, na própria barra lateral.
 *
 * O "só eu vejo" só aparece na criação: mudar um projeto de partilhado para
 * particular (ou o contrário) depois de ter tarefas lá dentro muda quem as vê,
 * e isso não deve acontecer por engano num menu.
 */
export default function ProjetoEditor({
  projeto, empresas = [], guardar, onFechar, sessaoUserId, podeEscrever, podeCriar, recarregar
}) {
  const novo = !projeto;
  const [nome, setNome] = useState(projeto?.nome || "");
  const [empresaId, setEmpresaId] = useState(projeto?.empresa_id || "");
  const [empresaNova, setEmpresaNova] = useState("");
  const [cor, setCor] = useState(projeto?.color || PALETA[0]);
  const [particular, setParticular] = useState(false);
  const [aConfirmar, setAConfirmar] = useState(false);
  const [aGuardar, setAGuardar] = useState(false);

  async function submeter(e) {
    e.preventDefault();
    const n = nome.trim();
    if (!n) return;
    setAGuardar(true);
    /* A empresa pode estar a ser criada aqui mesmo: cria-se primeiro, para o
       projeto já entrar ligado a ela. */
    let eid = empresaId || null;
    if (empresaId === "__nova__") {
      const n2 = empresaNova.trim();
      if (!n2) { setAGuardar(false); return; }
      const r = await guardar(() =>
        supabase.from("pm_empresas").insert({ nome: n2 }).select().single()
      );
      if (!r?.ok || !r.data) { setAGuardar(false); return; }
      eid = r.data.id;
    }
    const campos = { nome: n, empresa_id: eid, color: cor };
    if (novo) {
      await guardar(() =>
        supabase.from("pm_projects").insert({
          ...campos,
          owner_id: particular ? sessaoUserId : null
        })
      );
    } else {
      await guardar(() => supabase.from("pm_projects").update(campos).eq("id", projeto.id));
    }
    setAGuardar(false);
    onFechar();
  }

  async function arquivar() {
    await guardar(() =>
      supabase.from("pm_projects").update({ arquivado: !projeto.arquivado }).eq("id", projeto.id)
    );
    onFechar();
  }

  async function apagar() {
    await guardar(() => supabase.from("pm_projects").delete().eq("id", projeto.id));
    onFechar();
  }

  return (
    <form className="inline-edit" onSubmit={submeter}>
      <input className="field" value={nome} autoFocus placeholder="Nome do projeto"
        aria-label="Nome do projeto" onChange={(e) => setNome(e.target.value)} />

      {/* Só as empresas em atividade, mais a do próprio projeto se entretanto
          tiver sido arquivada — senão o campo esvaziava-se sozinho ao guardar. */}
      <select className="field" value={empresaId} aria-label="Empresa"
        onChange={(e) => setEmpresaId(e.target.value)}>
        <option value="">Sem empresa</option>
        {empresas
          .filter((c) => !c.arquivada || c.id === projeto?.empresa_id)
          .map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}{c.arquivada ? " (arquivada)" : ""}
            </option>
          ))}
        {podeCriar && <option value="__nova__">+ Empresa nova…</option>}
      </select>
      {empresaId === "__nova__" && (
        <input className="field" value={empresaNova} autoFocus placeholder="Nome da empresa nova"
          aria-label="Nome da empresa nova" onChange={(e) => setEmpresaNova(e.target.value)} />
      )}

      <div className="swatches">
        {PALETA.map((c) => (
          <button type="button" key={c} className="swatch" style={{ background: c }}
            aria-label={"Cor " + c} aria-pressed={cor === c} onClick={() => setCor(c)} />
        ))}
      </div>

      {novo ? (
        <>
          <label className="chk">
            <input type="checkbox" checked={particular}
              onChange={(e) => setParticular(e.target.checked)} />
            só eu vejo este projeto
          </label>
          <p className="hintline">
            Um projeto particular, e as tarefas dentro dele, ficam invisíveis para
            toda a gente menos para ti. Não é possível trocar depois de criado.
          </p>
        </>
      ) : (
        <>
          {projeto.owner_id && <p className="hintline">Projeto particular: só tu o vês.</p>}
          {projeto.arquivado && (
            <p className="hintline">
              Arquivado: fica fora das vistas e dos alertas, a não ser que o escolhas na lista.
            </p>
          )}
        </>
      )}

      {aConfirmar ? (
        <>
          <p className="hintline warnnote">
            Apagar o projeto? As tarefas dentro dele ficam sem projeto, não se perdem.
          </p>
          <div className="row-end">
            <button type="button" className="btn btn-sm" onClick={() => setAConfirmar(false)}>Não</button>
            <button type="button" className="btn btn-sm btn-danger" onClick={apagar}>Apagar</button>
          </div>
        </>
      ) : (
        <div className="row-end">
          {!novo && podeEscrever && (
            <button type="button" className="btn btn-sm btn-danger" onClick={() => setAConfirmar(true)}>
              Apagar
            </button>
          )}
          {!novo && (
            <button type="button" className="btn btn-sm" onClick={arquivar}>
              {projeto.arquivado ? "Desarquivar" : "Arquivar"}
            </button>
          )}
          <button type="button" className="btn btn-sm" onClick={onFechar}>Cancelar</button>
          <button className="btn btn-sm btn-primary"
            disabled={aGuardar || !nome.trim() || (empresaId === "__nova__" && !empresaNova.trim())}>
            {novo ? "Criar" : "Guardar"}
          </button>
        </div>
      )}
    </form>
  );
}
