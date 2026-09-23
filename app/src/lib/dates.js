/* Datas em texto ISO (AAAA-MM-DD). Nunca se usa o fuso: uma data de
   calendário não tem hora, e converter para Date com fuso já custou bugs
   de um dia a toda a gente. */

export function parseD(s) {
  if (!s || typeof s !== "string") return null;
  const p = s.split("-");
  if (p.length !== 3) return null;
  const d = new Date(+p[0], +p[1] - 1, +p[2]);
  return isNaN(d.getTime()) ? null : d;
}

export function toISO(d) {
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

export function addDays(d, n) {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + n);
  return x;
}

/** Dias inteiros de a para b (positivo se b for depois). */
export function dayDelta(a, b) {
  const A = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const B = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((B - A) / 86400000);
}

/** Hoje, à meia-noite. Injetável para os testes não dependerem do relógio. */
export function today(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function todayISO(now = new Date()) {
  return toISO(today(now));
}

export function shiftISO(iso, days) {
  const d = parseD(iso);
  return d ? toISO(addDays(d, days)) : iso;
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const MESES_LONG = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

export function fmtShort(iso) {
  const d = parseD(iso);
  return d ? d.getDate() + " " + MESES[d.getMonth()] : "";
}

export function plural(n, um, muitos) {
  return n === 1 ? um : muitos;
}

export function dias(n) {
  return n + " " + plural(Math.abs(n), "dia", "dias");
}
