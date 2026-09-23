import { useState } from "react";
import { supabase } from "../lib/supabase.js";

/**
 * Criar ou alterar uma empresa, na própria barra lateral.
 *
 * Não há apagar: uma empresa que fecha arquiva-se. Os projetos que ela teve
 * continuam a existir, com o nome dela, e é isso que se quer daqui a dois anos
 * quando alguém for ver o que se passou. Arquivar só a tira das escolhas.
 */
export default function EmpresaEditor({ empresa, guardar, onFechar, podeEscrever, aoCriar }) {
  const nova = !empresa;
  const [nome, setNome] = useState(empresa?.nome || "");
  const [aGuardar, setAGuardar] = useState(false);

  async function submeter(e) {
    e.preventDefault();
    const n = nome.trim();
    if (!n) return;
    setAGuardar(true);
    if (nova) {
      const r = await guardar(() =>
        supabase.from("pm_empresas").insert({ nome: n }).select().single()
      );
      if (r?.data && aoCriar) aoCriar(r.data);
    } else {
      await guardar(() => supabase.from("pm_empresas").update({ nome: n }).eq("id", empresa.id));
    }
    setAGuardar(false);
    onFechar();
  }

  async function arquivar() {
    await guardar(() =>
      supabase.from("pm_empresas").update({ arquivada: !empresa.arquivada }).eq("id", empresa.id)
    );
    onFechar();
  }

  return (
    <form className="inline-edit" onSubmit={submeter}>
      <input className="field" value={nome} autoFocus placeholder="Nome da empresa"
        aria-label="Nome da empresa" onChange={(e) => setNome(e.target.value)} />

      {!nova && empresa.arquivada && (
        <p className="hintline">
          Arquivada: deixa de aparecer nas escolhas de projeto novo. Os projetos que já tem
          ficam como estão.
        </p>
      )}

      <div className="row-end">
        {!nova && podeEscrever && (
          <button type="button" className="btn btn-sm" onClick={arquivar}>
            {empresa.arquivada ? "Desarquivar" : "Arquivar"}
          </button>
        )}
        <button type="button" className="btn btn-sm" onClick={onFechar}>Cancelar</button>
        <button className="btn btn-sm btn-primary" disabled={aGuardar || !nome.trim()}>
          {nova ? "Criar" : "Guardar"}
        </button>
      </div>
    </form>
  );
}
