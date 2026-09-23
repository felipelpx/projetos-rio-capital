# Gestor de Projetos — Rio Capital

Módulo de gestão de projetos do grupo Rio Capital: quadro Kanban, quadro por projeto,
gráfico de Gantt com linha de base e desvios, lista filtrável, alertas de prazo,
comentários e anexos por tarefa, dependências com espera e reagendamento em cascata.

Destino: site próprio no Netlify, a partilhar o mesmo Supabase e o mesmo login do ERP.

## Ficheiros

| Ficheiro | O que é |
|---|---|
| `PASSO_A_PASSO.md` | **Começa aqui.** Do zip ao site a funcionar, em quatro etapas. |
| `PARA_O_FELIPE.md` | Ponto de partida. O que é preciso do Felipe, o que fazem os dois SQL e o passo crítico de segurança. **Ler primeiro.** |
| `01_schema.sql` | Tabelas do módulo, políticas RLS, trigger da linha de base e a função de replaneamento. |
| `03_testar_acessos.sql` | Confere os três papéis. Correr depois dos outros dois, antes de dar acesso a alguém. |
| `02_dados.sql` | Os 7 projetos, 37 tarefas e 14 dependências que já existem, com as esperas entre tarefas. Pode correr duas vezes sem duplicar. |
| `04_anexos.sql` | Permissões do bucket `pm-anexos`, onde ficam os ficheiros anexados às tarefas. |
| `05_dar_acesso.sql` | Dá acesso às pessoas da equipa e mostra quem tem o quê. |
| `ESPECIFICACAO_MODULO.md` | Especificação funcional das cinco vistas, invariantes dos dados e armadilhas já encontradas. |
| `quadro_atual.html` | O quadro a funcionar hoje, num único ficheiro. Serve de referência visual e de comportamento. |
| `netlify.toml` | Configuração do Netlify. Tem de ficar na raiz — é onde ele a procura. |
| `app/` | **O módulo React**, pronto a publicar no Netlify. Ver `app/README.md`. |

Os dois SQL foram testados contra um PostgreSQL 16 e podem correr duas vezes sem duplicar.

**Ordem de execução dos SQL:** `01_schema.sql` e só depois `02_dados.sql`.

## Estado

O quadro atual continua a funcionar durante toda a migração — a equipa usa-o
normalmente até o módulo novo estar pronto. Os dados em `02_dados.sql` são uma
fotografia de 23/09/2026 às 10h30, já com as dependências acertadas; se houver alterações entretanto, gera-se a exportação outra vez.
