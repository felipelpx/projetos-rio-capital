import { supabase } from "../lib/supabase.js";

export const BUCKET_FOTOS = "pm-anexos";
export const MAX_FOTO = 5 * 1024 * 1024;

/** Diz porque é que o ficheiro não serve, ou null se servir. */
export function porqueNaoServe(f) {
  if (!f) return "Não escolheste nenhum ficheiro.";
  if (!f.type.startsWith("image/")) return "Escolhe uma imagem (JPG ou PNG).";
  if (f.size > MAX_FOTO) {
    return `A imagem tem ${(f.size / 1024 / 1024).toFixed(1)} MB e o limite é 5 MB. Reduz o tamanho e tenta outra vez.`;
  }
  return null;
}

/**
 * Carrega a foto de capa de um projeto.
 *
 * Vive aqui e não dentro de um componente porque se põe a foto em dois sítios:
 * no editor do projeto, na barra lateral, e diretamente na coluna da vista por
 * projetos — que é onde as pessoas a procuram.
 *
 * Devolve { erro } quando corre mal, com uma frase em português para mostrar.
 */
export async function carregarFotoProjeto(id, f, guardar, fotoAntiga) {
  const mau = porqueNaoServe(f);
  if (mau) return { erro: mau };

  const ext = (f.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const caminho = `projetos/${id}/capa-${Date.now()}.${ext}`;

  const up = await supabase.storage.from(BUCKET_FOTOS).upload(caminho, f, { upsert: false });
  if (up.error) return { erro: explicar(up.error.message) };

  /* Só depois de a nova estar lá em cima é que se apaga a antiga: se algo
     correr mal a meio, fica-se com a foto velha e não sem nenhuma. */
  const r = await guardar(() =>
    supabase.from("pm_projects").update({ foto: caminho }).eq("id", id)
  );
  if (!r?.ok) {
    await supabase.storage.from(BUCKET_FOTOS).remove([caminho]);
    return { erro: explicar(r?.erro || "Não consegui guardar a foto no projeto.") };
  }
  if (fotoAntiga && fotoAntiga !== caminho) {
    await supabase.storage.from(BUCKET_FOTOS).remove([fotoAntiga]);
  }
  return { caminho };
}

export async function removerFotoProjeto(id, fotoAntiga, guardar) {
  const r = await guardar(() =>
    supabase.from("pm_projects").update({ foto: null }).eq("id", id)
  );
  if (!r?.ok) return { erro: r?.erro || "Não consegui retirar a foto." };
  if (fotoAntiga) await supabase.storage.from(BUCKET_FOTOS).remove([fotoAntiga]);
  return {};
}

/* As mensagens do Supabase vêm em inglês e não dizem o que fazer a seguir. */
function explicar(msg) {
  const m = String(msg || "");
  if (/bucket not found/i.test(m)) {
    return "Falta criar o armazenamento: no Supabase, Storage → New bucket → nome pm-anexos, privado. Depois corre o 04_anexos.sql.";
  }
  if (/row-level security|violates|not authorized|permission/i.test(m)) {
    return "O armazenamento existe mas falta dar-lhe permissões: corre o 04_anexos.sql no SQL Editor do Supabase.";
  }
  /* O PostgREST diz "Could not find the 'foto' column … in the schema cache";
     o Postgres diz "column \"foto\" does not exist". Apanham-se os dois. */
  if (/foto/i.test(m) && /(does not exist|could not find|schema cache|unknown column)/i.test(m)) {
    return "Falta a coluna da foto na base de dados: corre outra vez o 01_schema.sql no SQL Editor do Supabase.";
  }
  if (/exceeded the maximum allowed size|payload too large/i.test(m)) {
    return "A imagem é grande demais para o armazenamento. Reduz o tamanho e tenta outra vez.";
  }
  return m;
}
