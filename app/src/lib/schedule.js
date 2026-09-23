/* Agendamento: dependências fim-a-início com espera.
 *
 * Isolado de propósito — sem React, sem Supabase, sem DOM. É a parte em que
 * um erro estraga o plano de toda a gente, por isso tem de poder ser testada
 * sozinha (ver test/schedule.test.mjs).
 *
 * Forma das tarefas: { id, titulo, inicio, fim, fim_previsto, deps: [{ depende_de, dias_espera }] }
 * As datas são texto ISO ou null.
 */

import { parseD, toISO, addDays, dayDelta } from "./dates.js";

export function depsOf(t) {
  return Array.isArray(t?.deps) ? t.deps : [];
}

function indexById(tasks) {
  const m = new Map();
  for (const t of tasks) m.set(t.id, t);
  return m;
}

/**
 * A data mais cedo a que uma tarefa pode arrancar: para cada antecessora,
 * o dia a seguir ao fim dela mais os dias de espera; vale a mais tardia.
 * Devolve ISO, ou null se nenhuma antecessora tiver fim marcado.
 */
export function earliestStart(task, tasks) {
  const byId = tasks instanceof Map ? tasks : indexById(tasks);
  let best = null;
  for (const d of depsOf(task)) {
    const p = byId.get(d.depende_de);
    if (!p || !p.fim) continue;
    const pe = parseD(p.fim);
    if (!pe) continue;
    const lag = Math.max(0, Number(d.dias_espera) || 0);
    const cand = addDays(pe, 1 + lag);
    if (!best || cand > best) best = cand;
  }
  return best ? toISO(best) : null;
}

/** A tarefa arranca antes do que esta antecessora permite? */
export function depViolated(task, dep, tasks) {
  const byId = tasks instanceof Map ? tasks : indexById(tasks);
  const p = byId.get(dep.depende_de);
  if (!p || !p.fim || !task?.inicio) return false;
  const pe = parseD(p.fim);
  const st = parseD(task.inicio);
  if (!pe || !st) return false;
  const lag = Math.max(0, Number(dep.dias_espera) || 0);
  return st < addDays(pe, 1 + lag);
}

/** Tarefas que hoje arrancam cedo demais face às suas antecessoras. */
export function violations(tasks) {
  const byId = indexById(tasks);
  return tasks.filter(
    (t) => t.inicio && t.fim && depsOf(t).some((d) => depViolated(t, d, byId))
  );
}

/** Quem depende diretamente desta tarefa. */
function dependentsOf(id, tasks) {
  return tasks.filter((t) => depsOf(t).some((d) => d.depende_de === id));
}

/**
 * Empurra para a frente tudo o que depende de `rootId`, e daí em diante a
 * cadeia inteira. Mantém a duração de cada tarefa.
 *
 * Nunca puxa para trás: antecipar uma data é decisão de quem gere o plano,
 * não um automatismo. Uma tarefa que já arranca depois do necessário fica
 * onde está.
 *
 * Não escreve nada — devolve as alterações, para quem chama decidir o que
 * fazer com elas. `tasks` é lido e não é modificado.
 *
 * @returns {Array<{id, titulo, inicio, fim, fim_previsto?}>} só as que mexem
 */
export function cascade(rootId, tasks) {
  const work = tasks.map((t) => ({ ...t }));
  const byId = indexById(work);
  const changed = new Map();
  const queue = [rootId];
  let guard = 0;

  while (queue.length && guard++ < 5000) {
    const cur = queue.shift();
    for (const x of dependentsOf(cur, work)) {
      if (!x.inicio || !x.fim) continue;
      const need = earliestStart(x, byId);
      if (!need) continue;
      const st = parseD(x.inicio);
      const en = parseD(x.fim);
      const needD = parseD(need);
      if (!st || !en || !needD) continue;
      const shift = dayDelta(st, needD);
      if (shift <= 0) continue;

      const patch = {
        id: x.id,
        titulo: x.titulo,
        inicio: toISO(addDays(st, shift)),
        fim: toISO(addDays(en, shift))
      };
      /* Sem linha de base gravada, o fim de agora era o plano: guarda-se,
         senão a derrapagem que acabámos de provocar desaparecia. */
      if (!x.fim_previsto) patch.fim_previsto = x.fim;

      x.inicio = patch.inicio;
      x.fim = patch.fim;
      if (patch.fim_previsto) x.fim_previsto = patch.fim_previsto;

      const prev = changed.get(x.id);
      changed.set(x.id, prev ? { ...prev, ...patch } : patch);
      queue.push(x.id);
    }
  }
  return [...changed.values()];
}

/**
 * Põe cada tarefa desrespeitada na data mais cedo possível e deixa a cascata
 * seguir. Usa-se para acertar dados que ficaram tortos antes de a regra
 * existir — nunca corre sozinho.
 *
 * @param {string|null} onlyId limita a uma tarefa (e à cadeia a jusante)
 */
export function resolveViolations(tasks, onlyId = null) {
  const work = tasks.map((t) => ({ ...t }));
  const byId = indexById(work);
  const changed = new Map();
  const note = (p) => {
    const prev = changed.get(p.id);
    changed.set(p.id, prev ? { ...prev, ...p } : p);
  };

  let guard = 0;
  let list = onlyId ? [byId.get(onlyId)].filter(Boolean) : violations(work);

  while (list.length && guard++ < 200) {
    for (const x of list) {
      if (!x.inicio || !x.fim) continue;
      const need = earliestStart(x, byId);
      if (!need) continue;
      const st = parseD(x.inicio);
      const en = parseD(x.fim);
      const needD = parseD(need);
      if (!st || !en || !needD) continue;
      const shift = dayDelta(st, needD);
      if (shift <= 0) continue;

      const patch = {
        id: x.id,
        titulo: x.titulo,
        inicio: toISO(addDays(st, shift)),
        fim: toISO(addDays(en, shift))
      };
      if (!x.fim_previsto) patch.fim_previsto = x.fim;
      x.inicio = patch.inicio;
      x.fim = patch.fim;
      if (patch.fim_previsto) x.fim_previsto = patch.fim_previsto;
      note(patch);

      for (const c of cascade(x.id, work)) {
        const t = byId.get(c.id);
        if (t) {
          t.inicio = c.inicio;
          t.fim = c.fim;
          if (c.fim_previsto) t.fim_previsto = c.fim_previsto;
        }
        note(c);
      }
    }
    /* Limitado a uma tarefa: a cascata já tratou do que vinha a seguir,
       e as outras desrespeitadas não são deste pedido. */
    if (onlyId) break;
    list = violations(work);
  }
  return [...changed.values()];
}

/* ---- estado das tarefas face ao calendário ---- */

/** Dias entre a linha de base e o fim real. >0 derrapou, <0 adiantou. */
export function slipDays(t) {
  if (!t?.fim || !t?.fim_previsto || t.fim === t.fim_previsto) return 0;
  const be = parseD(t.fim_previsto);
  const e = parseD(t.fim);
  return be && e ? dayDelta(be, e) : 0;
}

/** Dias para lá do fim, numa tarefa por concluir. */
export function lateDays(t, concluida, hoje) {
  if (!t?.fim || concluida) return 0;
  const e = parseD(t.fim);
  if (!e) return 0;
  const d = dayDelta(e, hoje);
  return d > 0 ? d : 0;
}

/** Dias desde o início, numa tarefa que ainda não arrancou. */
export function lateStartDays(t, porIniciar, hoje) {
  if (!t?.inicio || !porIniciar) return 0;
  const st = parseD(t.inicio);
  if (!st) return 0;
  const d = dayDelta(st, hoje);
  return d > 0 ? d : 0;
}

/** Impede A→B→A ao criar uma dependência. */
export function wouldCycle(taskId, newDepId, tasks) {
  if (taskId === newDepId) return true;
  const byId = indexById(tasks);
  const seen = new Set();
  const stack = [newDepId];
  while (stack.length) {
    const cur = stack.pop();
    if (cur === taskId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const d of depsOf(byId.get(cur))) stack.push(d.depende_de);
  }
  return false;
}
