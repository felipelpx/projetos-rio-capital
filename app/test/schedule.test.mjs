import test from "node:test";
import assert from "node:assert/strict";
import {
  earliestStart, violations, cascade, resolveViolations,
  slipDays, lateDays, lateStartDays, wouldCycle, depViolated
} from "../src/lib/schedule.js";
import { parseD } from "../src/lib/dates.js";

const dep = (id, lag = 0) => ({ depende_de: id, dias_espera: lag });
const T = (id, inicio, fim, deps = [], extra = {}) =>
  ({ id, titulo: id, inicio, fim, fim_previsto: fim, deps, ...extra });

test("início mais cedo: dia seguinte ao fim da antecessora", () => {
  const tasks = [T("a", "2026-10-01", "2026-10-05"), T("b", "2026-10-06", "2026-10-10", [dep("a")])];
  assert.equal(earliestStart(tasks[1], tasks), "2026-10-06");
});

test("início mais cedo: com espera de 3 dias", () => {
  const tasks = [T("a", "2026-10-01", "2026-10-05"), T("b", "2026-10-06", "2026-10-10", [dep("a", 3)])];
  assert.equal(earliestStart(tasks[1], tasks), "2026-10-09");
});

test("início mais cedo: com duas antecessoras vale a mais tardia", () => {
  const tasks = [
    T("a", "2026-10-01", "2026-10-05"),
    T("b", "2026-10-01", "2026-10-20"),
    T("c", "2026-10-06", "2026-10-10", [dep("a"), dep("b")])
  ];
  assert.equal(earliestStart(tasks[2], tasks), "2026-10-21");
});

test("início mais cedo: antecessora sem fim não conta", () => {
  const tasks = [T("a", null, null), T("b", "2026-10-06", "2026-10-10", [dep("a")])];
  assert.equal(earliestStart(tasks[1], tasks), null);
});

test("cascata: empurra a dependente e mantém a duração", () => {
  const tasks = [T("a", "2026-10-01", "2026-10-08"), T("b", "2026-10-06", "2026-10-10", [dep("a")])];
  const out = cascade("a", tasks);
  assert.equal(out.length, 1);
  assert.equal(out[0].inicio, "2026-10-09");
  assert.equal(out[0].fim, "2026-10-13");
  const dur = (x) => (parseD(x.fim) - parseD(x.inicio)) / 86400000;
  assert.equal(dur(out[0]), dur(tasks[1]));
});

test("cascata: atravessa a cadeia inteira", () => {
  const tasks = [
    T("a", "2026-10-01", "2026-10-10"),
    T("b", "2026-10-06", "2026-10-10", [dep("a")]),
    T("c", "2026-10-11", "2026-10-15", [dep("b", 2)])
  ];
  const out = cascade("a", tasks);
  const by = Object.fromEntries(out.map((x) => [x.id, x]));
  assert.equal(by.b.inicio, "2026-10-11");
  assert.equal(by.b.fim, "2026-10-15");
  assert.equal(by.c.inicio, "2026-10-18"); // 15 + 1 + 2
  assert.equal(by.c.fim, "2026-10-22");
});

test("cascata: nunca puxa para trás", () => {
  const tasks = [T("a", "2026-10-01", "2026-10-03"), T("b", "2026-10-20", "2026-10-25", [dep("a")])];
  assert.deepEqual(cascade("a", tasks), []);
});

test("cascata: não mexe na linha de base já gravada", () => {
  const tasks = [
    T("a", "2026-10-01", "2026-10-08"),
    T("b", "2026-10-06", "2026-10-10", [dep("a")], { fim_previsto: "2026-10-10" })
  ];
  const out = cascade("a", tasks);
  assert.equal(out[0].fim_previsto, undefined, "não devia reescrever a linha de base");
});

test("cascata: sem linha de base, grava o fim antigo para a derrapagem ficar à vista", () => {
  const tasks = [
    T("a", "2026-10-01", "2026-10-08"),
    { id: "b", titulo: "b", inicio: "2026-10-06", fim: "2026-10-10", fim_previsto: null, deps: [dep("a")] }
  ];
  const out = cascade("a", tasks);
  assert.equal(out[0].fim_previsto, "2026-10-10");
});

test("cascata: tarefa sem datas é ignorada", () => {
  const tasks = [T("a", "2026-10-01", "2026-10-08"), { id: "b", titulo: "b", inicio: null, fim: null, deps: [dep("a")] }];
  assert.deepEqual(cascade("a", tasks), []);
});

test("cascata: diamante empurra pelo caminho mais longo", () => {
  const tasks = [
    T("a", "2026-10-01", "2026-10-05"),
    T("b", "2026-10-06", "2026-10-07", [dep("a")]),
    T("c", "2026-10-06", "2026-10-20", [dep("a")]),
    T("d", "2026-10-21", "2026-10-22", [dep("b"), dep("c")])
  ];
  const out = cascade("a", tasks);
  assert.deepEqual(out, [], "nada a fazer enquanto a está onde estava");

  const atrasado = tasks.map((t) => (t.id === "a" ? { ...t, fim: "2026-10-09" } : t));
  const by = Object.fromEntries(cascade("a", atrasado).map((x) => [x.id, x]));
  assert.equal(by.b.inicio, "2026-10-10");
  assert.equal(by.c.inicio, "2026-10-10");
  assert.equal(by.c.fim, "2026-10-24");
  assert.equal(by.d.inicio, "2026-10-25", "d segue o caminho mais longo (c), não o mais curto (b)");
});

test("cascata: um ciclo nos dados antigos não pendura a aplicação", () => {
  const tasks = [
    { id: "a", titulo: "a", inicio: "2026-10-01", fim: "2026-10-05", deps: [dep("b")] },
    { id: "b", titulo: "b", inicio: "2026-10-01", fim: "2026-10-05", deps: [dep("a")] }
  ];
  const out = cascade("a", tasks); // tem de terminar
  assert.ok(Array.isArray(out));
});

test("desrespeitadas: encontra e corrige o que já estava torto", () => {
  const tasks = [
    T("orclimp", "2026-09-14", "2026-09-30", [], { fim_previsto: "2026-09-22" }),
    T("obras", "2026-09-18", "2026-09-23"),
    T("limpeza", "2026-09-24", "2026-09-25", [dep("obras"), dep("orclimp")])
  ];
  assert.equal(violations(tasks).length, 1);
  assert.equal(violations(tasks)[0].id, "limpeza");

  const out = resolveViolations(tasks);
  assert.equal(out.length, 1);
  assert.equal(out[0].inicio, "2026-10-01");
  assert.equal(out[0].fim, "2026-10-02");

  const depois = tasks.map((t) => ({ ...t, ...(out.find((o) => o.id === t.id) || {}) }));
  assert.deepEqual(violations(depois), []);
});

test("desrespeitadas: corrigir uma arrasta a cadeia a jusante", () => {
  const tasks = [
    T("a", "2026-09-01", "2026-09-30"),
    T("b", "2026-09-05", "2026-09-10", [dep("a")]),
    T("c", "2026-09-11", "2026-09-15", [dep("b")])
  ];
  const out = resolveViolations(tasks);
  const by = Object.fromEntries(out.map((x) => [x.id, x]));
  assert.equal(by.b.inicio, "2026-10-01");
  assert.equal(by.c.inicio, "2026-10-07");
});

test("desrespeitadas: limitar a uma tarefa não mexe nas outras", () => {
  const tasks = [
    T("a", "2026-09-01", "2026-09-30"),
    T("b", "2026-09-05", "2026-09-10", [dep("a")]),
    T("x", "2026-09-05", "2026-09-10", [dep("a")])
  ];
  const out = resolveViolations(tasks, "b");
  assert.deepEqual(out.map((o) => o.id), ["b"]);
});

test("dependência desrespeitada tem em conta a espera", () => {
  const tasks = [T("a", "2026-10-01", "2026-10-05"), T("b", "2026-10-06", "2026-10-10", [dep("a", 3)])];
  assert.equal(depViolated(tasks[1], tasks[1].deps[0], tasks), true);
  const ok = [tasks[0], { ...tasks[1], inicio: "2026-10-09" }];
  assert.equal(depViolated(ok[1], ok[1].deps[0], ok), false);
});

test("desvio face ao previsto", () => {
  assert.equal(slipDays({ fim: "2026-10-10", fim_previsto: "2026-10-05" }), 5);
  assert.equal(slipDays({ fim: "2026-10-01", fim_previsto: "2026-10-05" }), -4);
  assert.equal(slipDays({ fim: "2026-10-05", fim_previsto: "2026-10-05" }), 0);
  assert.equal(slipDays({ fim: "2026-10-05", fim_previsto: null }), 0);
});

test("atrasos contam a partir de hoje e param quando a tarefa fecha", () => {
  const hoje = parseD("2026-10-10");
  assert.equal(lateDays({ fim: "2026-10-05" }, false, hoje), 5);
  assert.equal(lateDays({ fim: "2026-10-05" }, true, hoje), 0);
  assert.equal(lateStartDays({ inicio: "2026-10-07" }, true, hoje), 3);
  assert.equal(lateStartDays({ inicio: "2026-10-07" }, false, hoje), 0);
});

test("ciclos são travados na criação da dependência", () => {
  const tasks = [T("a", null, null), T("b", null, null, [dep("a")]), T("c", null, null, [dep("b")])];
  assert.equal(wouldCycle("a", "c", tasks), true, "a→c fecharia o ciclo a→c→b→a");
  assert.equal(wouldCycle("a", "a", tasks), true);
  assert.equal(wouldCycle("c", "a", tasks), false);
});

test("a cascata diz quem empurrou cada tarefa", () => {
  const tasks = [
    { id: "a", titulo: "Fundações", inicio: "2026-01-01", fim: "2026-01-10", deps: [] },
    { id: "b", titulo: "Estrutura", inicio: "2026-01-11", fim: "2026-01-20",
      deps: [{ depende_de: "a", dias_espera: 0 }] },
    { id: "c", titulo: "Cobertura", inicio: "2026-01-21", fim: "2026-01-25",
      deps: [{ depende_de: "b", dias_espera: 0 }] }
  ];
  tasks[0].fim = "2026-01-15";
  const mexidas = cascade("a", tasks);
  const porId = Object.fromEntries(mexidas.map((m) => [m.id, m]));
  assert.equal(porId.b.empurradaPor, "a");
  assert.equal(porId.c.empurradaPor, "b", "o empurrão de c vem de b, não de a");
});

test("ao acertar violações antigas, a antecessora apontada é a que manda", () => {
  const tasks = [
    { id: "a", titulo: "Licença", inicio: "2026-03-01", fim: "2026-03-05", deps: [] },
    { id: "b", titulo: "Betão", inicio: "2026-03-01", fim: "2026-03-20", deps: [] },
    { id: "c", titulo: "Acabamentos", inicio: "2026-03-02", fim: "2026-03-10",
      deps: [{ depende_de: "a", dias_espera: 0 }, { depende_de: "b", dias_espera: 0 }] }
  ];
  const mexidas = resolveViolations(tasks);
  const c = mexidas.find((m) => m.id === "c");
  assert.equal(c.empurradaPor, "b", "b acaba mais tarde, é b quem obriga c a andar");
  assert.equal(c.inicio, "2026-03-21");
});
