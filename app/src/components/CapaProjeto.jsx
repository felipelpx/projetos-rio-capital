import { useRef, useState } from "react";
import { supabase } from "../lib/supabase.js";
import { carregarFotoProjeto, removerFotoProjeto } from "../data/fotoProjeto.js";

/**
 * A faixa com a foto, no topo da coluna do projeto.
 *
 * Também é por aqui que se põe a foto. Estava só dentro do editor do projeto,
 * atrás de um ✎ que nem aparecia sem passar o rato por cima da barra lateral —
 * ninguém a encontrava. O sítio onde a foto se vê é o sítio onde se procura
 * pô-la, por isso é aqui que fica o botão.
 */
export default function CapaProjeto({ projeto, url, guardar, podeEscrever }) {
  const [msg, setMsg] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const ficheiro = useRef(null);

  async function escolher(e) {
    const f = e.target.files?.[0];
    if (ficheiro.current) ficheiro.current.value = "";
    if (!f) return;
    setMsg("A carregar…");
    setOcupado(true);
    const r = await carregarFotoProjeto(projeto.id, f, guardar, projeto.foto);
    setOcupado(false);
    setMsg(r.erro || "");
  }

  async function alternarCorte() {
    setOcupado(true);
    const r = await guardar(() => supabase.from("pm_projects")
      .update({ foto_inteira: !projeto.foto_inteira }).eq("id", projeto.id));
    setOcupado(false);
    if (!r?.ok) setMsg(r?.erro || "Não consegui mudar o enquadramento.");
  }

  async function tirar() {
    setOcupado(true);
    const r = await removerFotoProjeto(projeto.id, projeto.foto, guardar);
    setOcupado(false);
    setMsg(r.erro || "");
  }

  const abrir = () => ficheiro.current?.click();

  /* Sem foto e sem poder pôr nenhuma, não se ocupa espaço com um vazio. */
  if (!projeto.foto && !podeEscrever) return null;

  return (
    <div className={"col-foto" + (projeto.foto_inteira ? " inteira" : "") + (projeto.foto ? "" : " vazia")}>
      {projeto.foto ? (
        url ? (
          <img src={url} alt={"Foto de " + projeto.nome} loading="lazy" />
        ) : (
          <span className="capa-nota">a carregar a foto…</span>
        )
      ) : (
        <button type="button" className="capa-por" onClick={abrir} disabled={ocupado}>
          <span aria-hidden="true">＋</span> Pôr foto
        </button>
      )}

      {podeEscrever && projeto.foto && (
        <span className="capa-acoes">
          <button type="button" onClick={alternarCorte} disabled={ocupado}
            title={projeto.foto_inteira
              ? "Preencher a faixa, cortando as bordas"
              : "Mostrar a imagem inteira, sem cortar"}>
            {projeto.foto_inteira ? "Preencher" : "Inteira"}
          </button>
          <button type="button" onClick={abrir} disabled={ocupado}>Trocar</button>
          <button type="button" onClick={tirar} disabled={ocupado}>Tirar</button>
        </span>
      )}

      {podeEscrever && (
        <input ref={ficheiro} type="file" accept="image/*" hidden
          aria-label={"Foto de " + projeto.nome} onChange={escolher} />
      )}

      {msg && <p className="capa-msg">{msg}</p>}
    </div>
  );
}
