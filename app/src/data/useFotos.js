import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase.js";

const BUCKET = "pm-anexos";
const VALIDADE = 60 * 60 * 4;          // 4 horas
const REASSINAR = 1000 * 60 * 60 * 3;  // renova-se antes de expirar

/**
 * Endereços temporários para as fotos dos projetos.
 *
 * O balde é privado — o mesmo dos anexos —, por isso não há endereço fixo:
 * pede-se um assinado, que caduca. Como as fotos ficam à vista enquanto o
 * separador estiver aberto, renovam-se sozinhas antes de caducarem, senão
 * quem deixa a aplicação aberta a tarde toda via os quadrados vazios.
 */
export function useFotos(projects) {
  const [urls, setUrls] = useState({});
  /* Só os caminhos interessam: uma mudança de nome do projeto não obriga a
     voltar a assinar nada. */
  const caminhos = projects.map((p) => p.foto).filter(Boolean).sort().join("|");

  useEffect(() => {
    if (!supabase || !caminhos) { setUrls({}); return; }
    let vivo = true;

    const assinar = async () => {
      const lista = caminhos.split("|");
      const { data, error } = await supabase.storage
        .from(BUCKET).createSignedUrls(lista, VALIDADE);
      if (!vivo || error || !data) return;
      const novo = {};
      for (const r of data) if (r.signedUrl && r.path) novo[r.path] = r.signedUrl;
      setUrls(novo);
    };

    assinar();
    const t = setInterval(assinar, REASSINAR);
    return () => { vivo = false; clearInterval(t); };
  }, [caminhos]);

  return urls;
}
