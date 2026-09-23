import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

/* Sem configuração a aplicação não arranca às cegas: é preferível dizer o
   que falta do que falhar a cada pedido. */
export const configurado = Boolean(url && key);

export const supabase = configurado
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;

/** Erros do PostgREST em português, sem expor o interior da base. */
export function msgErro(e) {
  if (!e) return "";
  const c = e.code || "";
  if (c === "42501" || c === "PGRST301") return "Não tens permissão para esta alteração.";
  if (c === "23505") return "Já existe um registo igual.";
  if (c === "23503") return "Está ligado a outro registo e não pode ficar assim.";
  if (c === "P0001") return e.message || "A base de dados recusou a alteração.";
  if (e.message && /Failed to fetch|NetworkError/i.test(e.message))
    return "Sem ligação ao servidor. Verifica a internet e tenta outra vez.";
  return e.message || "Não foi possível guardar a alteração.";
}
