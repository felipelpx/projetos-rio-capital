import { useEffect, useMemo, useState } from "react";
import { today, todayISO } from "./dates.js";

/**
 * "Hoje", que se mantém hoje.
 *
 * Isto estava a ser calculado uma vez, quando a aplicação abria. Quem deixa o
 * separador aberto de um dia para o outro — que é o normal — ficava com a
 * aplicação convencida de que ainda era ontem: a linha do Gantt no dia errado,
 * e todos os atrasos contados a menos um dia.
 *
 * Por isso acerta-se em três momentos: à meia-noite, quando a pessoa volta ao
 * separador, e quando a janela reganha o foco. O relógio do computador também
 * pode saltar (suspender o portátil, acertar a hora), e a volta ao separador
 * apanha esses casos.
 */
export function useHoje() {
  const [iso, setIso] = useState(() => todayISO());

  useEffect(() => {
    let temporizador;

    const acertar = () => {
      setIso((antigo) => {
        const agora = todayISO();
        return agora === antigo ? antigo : agora;   // mesma string, mesmo estado
      });
      agendarMeiaNoite();
    };

    const agendarMeiaNoite = () => {
      clearTimeout(temporizador);
      const agora = new Date();
      const meiaNoite = new Date(
        agora.getFullYear(), agora.getMonth(), agora.getDate() + 1, 0, 0, 30
      );
      /* setTimeout tem um limite de ~24,8 dias e não é de fiar com a máquina
         suspensa; daí os outros dois gatilhos. */
      temporizador = setTimeout(acertar, Math.max(1000, meiaNoite - agora));
    };

    const aoVoltar = () => { if (!document.hidden) acertar(); };

    agendarMeiaNoite();
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", acertar);
    return () => {
      clearTimeout(temporizador);
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("focus", acertar);
    };
  }, []);

  /* Um Date novo só quando a data muda, para não invalidar memos à toa.
     Meio-dia local e não meia-noite: assim nenhum acerto de fuso o passa
     para o dia anterior. */
  return useMemo(() => today(new Date(iso + "T12:00:00")), [iso]);
}
