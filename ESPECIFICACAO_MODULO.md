# Gestor de Projetos Rio Capital — especificação do módulo

Documento de passagem para quem vai construir. Descreve um módulo que já existe a
funcionar e foi usado — não é um desenho no papel. Tudo o que está aqui foi decidido,
construído e testado; onde houve uma escolha entre alternativas, fica dito qual e porquê,
para não se refazer a discussão.

**Como usar este documento com o Claude:** abre uma conversa com o repositório ligado e
junta os três ficheiros — este, o `01_schema.sql` e o `02_dados.sql`. Isso chega para
começar a construir sem mais contexto.

**Onde está a versão a funcionar:** https://claude.ai/artifact/YVTXxhzViKSciRycTahEhf
(pede o acesso à Juliana; vale a pena mexer nela antes de escrever código — muitos dos
detalhes abaixo percebem-se melhor a usar do que a ler).

---

## 1. O que é e onde vive

Gestão de projetos de obra para o grupo Rio Capital: 7 projetos ativos, ~36 tarefas,
cada projeto pertence a uma sociedade do grupo.

- **Site separado no Netlify** (por exemplo `projetos.riocapital.pt`), React + Vite, o
  mesmo padrão do ERP.
- **Mesmo projeto Supabase** do ERP: uma só lista de utilizadores, um só login.
- Endereço e chave pública do Supabase nas variáveis de ambiente do Netlify
  (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`). Nunca no código.

**Porquê site separado e não um separador dentro do ERP:** para haver pessoas com acesso
aos projetos e não ao financeiro. Ver a secção 9 — a separação a sério faz-se no RLS, não
no endereço.

---

## 2. Modelo de dados

Está todo em `01_schema.sql`, com as políticas. Em resumo:

| Tabela | Para quê |
|---|---|
| `app_access` | que áreas (`erp` / `projetos`) e que papel (`view`/`interact`/`admin`) cada pessoa tem |
| `pm_projects` | projeto; `empresa` (→ passar a apontar para as sociedades do ERP), `arquivado`, `owner_id` |
| `pm_statuses` | as colunas do quadro, configuráveis pelo utilizador |
| `pm_tasks` | tarefa; `fim` (real) e `fim_previsto` (linha de base imutável) |
| `pm_task_assignees` | responsáveis → utilizadores |
| `pm_task_deps` | dependências fim-a-início, com `dias_espera` (espera entre o fim da antecessora e o arranque) |
| `pm_comments` | comentários e registos de replaneamento |
| `pm_attachments` | ficheiros (Storage) e links |
| `pm_subscriptions` | quem quer o resumo diário e com que âmbito |

Três invariantes que não se devem perder:

1. **`fim_previsto` grava-se uma vez e nunca mais muda.** Há um trigger a garantir.
   Só a função `pm_repor_fim_previsto(task, justificacao)` a altera, e essa exige
   justificação e escreve um registo em `pm_comments`.
2. **`owner_id` preenchido = projeto/tarefa particular.** Invisível para todos os
   outros, incluindo quem criou o quadro.
3. **Não existe lista de "membros" à parte.** A equipa é quem tem
   `app_access('projetos')`. Só essas pessoas podem ser responsáveis por tarefas.
4. **Adiar o fim de uma tarefa empurra as dependentes.** Ver a secção 3.6.

---

## 3. Vistas

Cinco separadores no topo: **Quadro · Projetos · Gantt · Lista · Alertas**.

### 3.1 Quadro (Kanban por estado)

Uma coluna por `pm_statuses`, ordenadas por `posicao`. Cartão com: projeto · empresa,
título, prioridade (só quando não é Média), data de fim, contadores de anexos e
comentários, avatares dos responsáveis e barra de progresso.

- **Arrastar** entre colunas muda o estado. A pega é um punho à esquerda do cartão
  (`touch-action:none` só nela), para o cartão continuar a poder ser tocado e a coluna a
  poder ser deslocada no telemóvel.
- A ordem dentro da coluna é manual (`posicao`, ponto médio entre vizinhos no largar).
- Largar numa coluna com `conta_concluido` põe o progresso a 100%.
- Botão **+ Coluna** no fim, e um **✎** no cabeçalho de cada coluna.

### 3.2 Projetos (Kanban por projeto)

As mesmas cartas, uma coluna por projeto, com a empresa no subtítulo. No cartão aparece o
**estado** onde no Quadro aparece o projeto. Ordenadas por estado e depois por data de fim.

- **Arrastar muda a tarefa de projeto.**
- **Não se arrasta entre um projeto partilhado e um particular** — vivem em sítios
  diferentes e mudar só a etiqueta deixaria a tarefa visível onde não devia. A coluna
  incompatível apaga-se ao passar por cima.
- Não há reordenação manual aqui; a ordem manual é a do Quadro.

### 3.3 Gantt

Barras agrupadas por projeto, com barra-resumo por projeto, linha do dia de hoje, fins de
semana sombreados, escala em **dias / semanas / meses**, e o mês visível fixo no cabeçalho
(atualiza ao deslocar).

Três marcas visuais distintas, todas na legenda:

| Marca | O que é |
|---|---|
| Tracejado vermelho cheio **a seguir** à barra | fim em atraso: da data de fim até hoje |
| Contorno tracejado vermelho **sobre** o início da barra | início em atraso: devia ter arrancado e não arrancou |
| Segmento **escurecido com riscas verticais** dentro da barra | desvio face ao `fim_previsto`, com uma marca vertical na data prevista |

**Sobre a cor do desvio:** não uses uma cor semântica. As cores dos projetos cobrem quase
todo o leque de tons — num projeto âmbar, um âmbar de aviso é invisível. Escurecer a barra
funciona seja qual for a cor. Isto foi mudado depois de se ver o resultado.

- As barras arrastam-se (move) e as pontas esticam (resize).
- Tarefas sem datas mostram um traço a tracejado; clicar define início hoje e fim +4 dias.
- Setas de dependência entre barras; **vermelhas e tracejadas** quando a dependente
  arranca antes do que as antecessoras permitem (ver 3.6). Quando a dependência tem
  espera, a seta leva a etiqueta `+n d` por cima do troço horizontal.
- Quando há dependências desrespeitadas, aparece na barra de cima um botão vermelho
  **"Ajustar N dependências"**, que põe cada uma na data mais cedo possível e deixa a
  cascata seguir. Nunca corre sozinho: mexer nas datas do plano sem pedir seria pior do
  que mostrá-las tortas.
- **Painel de Notas por baixo**, encostado à última atividade (não colado ao fundo).
  Mostra só as tarefas **por concluir e já começadas** que tenham notas, agrupadas por
  projeto. Fecha-se e o estado fica guardado. É a réplica do bloco NOTAS do relatório
  mensal que a CMSI produz.

### 3.4 Lista

Tabela ordenável por qualquer coluna: Tarefa · Projeto · Estado · Prioridade ·
Responsáveis · Início · **Fim previsto** · **Fim real** · Progresso. Datas passadas a
vermelho com `+Nd`; desvio face à linha de base em número ao lado (âmbar se derrapou,
verde se adiantou).

### 3.5 Alertas

Três blocos, cada tarefa aparece **numa só**, a mais grave:

1. **Em atraso** — fim ultrapassado, ou início ultrapassado numa coluna `conta_por_iniciar`.
2. **A começar** — início dentro do horizonte.
3. **A terminar** — fim dentro do horizonte.

Horizonte de 3/7/14/30 dias ou um número à escolha, guardado. Cada linha tem um número
grande à direita e uma barra de cor por urgência. O separador mostra um contador vermelho
com o número de tarefas em atraso.

---

### 3.6 Dependências, esperas e reagendamento em cascata

Uma dependência é **fim-a-início com espera**: a dependente só pode arrancar em
`fim da antecessora + 1 dia + dias_espera`. Com várias antecessoras vale a mais tardia —
é a `pm_inicio_mais_cedo(task)` do esquema. A espera edita-se na própria ficha da
dependência, no painel da tarefa (campo `+ n d`), e serve para casos como "a obra só
arranca 10 dias depois de sair a licença".

**Cascata.** Quando o fim de uma tarefa passa para mais tarde, cada dependente que fique
a arrancar cedo demais é empurrada para a frente, mantendo a duração; e a partir daí a
cadeia inteira, recursivamente. Regras que importam:

- **Só empurra para a frente.** Antecipar uma data não puxa as seguintes para trás —
  pode haver outras razões para começarem mais tarde, e desfazer trabalho de planeamento
  sozinho é pior do que não fazer nada.
- **A linha de base não é tocada.** Uma tarefa empurrada passa a ter desvio face ao
  `fim_previsto`, e é exatamente isso que se quer ver no Gantt. (Se a tarefa ainda não
  tinha linha de base gravada, grava-se o fim *antigo*, para a derrapagem não desaparecer.)
- **A cascata só reage a alterações.** Dados que já estavam fora de ordem antes de a
  regra existir ficam como estão, assinalados a vermelho, até alguém carregar no botão
  de ajustar. Isto apanhou-nos na primeira versão: a regra funcionava e parecia não
  funcionar, porque o que estava torto era anterior a ela.
- Ciclos são impedidos na criação da dependência, mas o reagendamento traz na mesma um
  limite de iterações — dados antigos podem ter ciclos que a validação nova não viu.

## 4. Filtros

- **Projetos**: caixas na barra lateral, agrupados por empresa (alfabética). Clicar no
  nome isola um; clicar no nome da empresa seleciona os dela. Pastilha no topo com o
  filtro ativo.
- **Colaborador**: seleção múltipla, **global** — vale em todas as vistas.
- **Estado e prioridade**: seleção múltipla, valem na **Lista** e em **Projetos**;
  só a prioridade aparece também no **Quadro** (o estado ali é a própria coluna).

Todos os filtros de seleção múltipla começam com tudo marcado, mostram a contagem por
opção, e fecham ao clicar fora ou com Esc. Os de estado/prioridade **não são guardados**
entre sessões — de propósito, para ninguém voltar no dia seguinte e encontrar metade das
tarefas escondidas sem perceber porquê.

---

## 5. Painel da tarefa

Título, projeto, estado, prioridade, progresso, início, **fim real** (com a linha de base
por baixo e o desvio em dias), **depende de**, anexos, notas e comentários.

- **Depende de**: seletor com pesquisa, projetos do mesmo projeto no topo, **guarda contra
  ciclos** (se A depende de B, B deixa de aparecer nas opções de A) e não cruza a fronteira
  do particular. Mostra "Bloqueada: N dependências ainda abertas" enquanto as anteriores
  não fecharem.
- **Repor data prevista**: só aparece quando há desvio. Abre uma caixa que diz o que vai
  acontecer e **exige justificação**. Ao confirmar, grava a nova linha de base e escreve
  um comentário de tipo `replaneamento` — **que ninguém pode editar nem apagar, nem o
  autor**. A tarefa passa a mostrar "reposta N×".
- **Comentários**: cada um só edita e apaga os seus; apagar pede confirmação; editado fica
  marcado. ⌘/Ctrl+Enter envia.
- **Anexos**: ficheiro (Storage) ou link. No Supabase deixa de haver limite de formato —
  Excel e Word passam a funcionar, ao contrário da versão atual.

---

## 6. Barra lateral

Quatro secções, as três últimas dobráveis com a contagem no cabeçalho:

- **Projetos** — agrupados por empresa (alfabética), depois **Projetos particulares**,
  depois **Arquivados** (fechado por omissão).
- **Equipa** — quem tem acesso, com o nível e o número de tarefas a seu cargo. Não há como
  adicionar pessoas aqui: convidam-se pela gestão de utilizadores.
- **Relatório diário** — cada pessoa liga/desliga o seu, com o email e o âmbito.
- **Colunas do quadro** — nome, cor, ordem, e duas marcas: **conta como concluído** e
  **conta como por iniciar**. São essas marcas, e não os nomes, que fazem funcionar os
  riscados, os progressos a 100% e a deteção de início em atraso.

**Arquivar** um projeto tira-o de todas as vistas e dos alertas, mas continua acessível
escolhendo-o na secção Arquivados. Não apaga nada.

---

## 7. Resumo diário por email

Function agendada (2ª a 6ª de manhã, Europe/Lisbon) + serviço de envio (Resend ou
equivalente).

- Lê `pm_subscriptions`: só quem tem `ativo` e email.
- Âmbito `tudo` ou `minhas` (tarefas onde a pessoa é responsável).
- **Um email por pessoa**, nunca vários destinatários no mesmo — para ninguém ver a lista
  dos outros.
- Assunto começa por `[N em atraso]` quando há atrasos.
- Corpo em texto simples, agrupado por empresa, com o prazo em palavras
  ("terminou há 9 dias", "começa amanhã").
- Ignora projetos arquivados e todos os projetos particulares.

---

## 8. Armadilhas já encontradas (vale a pena não repetir)

1. **Escrita perdida em edição concorrente.** Com vários a mexer, uma gravação de outra
   pessoa a chegar enquanto se escreve revertia o texto em curso. Resolveu-se com um
   registo de alterações por gravar, reaplicado por cima do que chega do servidor. Com
   Supabase Realtime o risco é o mesmo — tratar na camada de estado.
2. **Gravar a cada tecla.** O campo de email gravava em cada carácter. Passou a gravar ao
   sair do campo.
3. **Redesenho a apagar o que se escreve.** Redesenhar um painel enquanto um campo tem o
   foco perde o que lá está. Ou não se redesenha essa parte, ou se restaura foco e cursor.
4. **Cor semântica sobre cor de projeto** — ver 3.3.
5. **Perder a posição do scroll** ao reconstruir o Gantt a cada alteração.

---

## 9. >>> O passo crítico <<<

As tabelas financeiras do ERP precisam de uma política RLS que exija explicitamente
`tem_area('erp')`. Sem isso, um utilizador criado só para os projetos tem um token válido
contra a **mesma API** e lê o financeiro — o domínio separado não protege nada.

O padrão está na secção 8 do `01_schema.sql`.

**Teste antes de dar acesso a alguém de fora:** utilizador com apenas
`app_access('projetos')`, `select` a cada tabela financeira, tem de devolver **zero
linhas**.

---

## 10. Migração

1. `01_schema.sql`
2. Rever e aplicar as políticas às tabelas financeiras (secção 9)
3. `02_dados.sql` — 7 projetos, 36 tarefas, 14 dependências. Guarda `id_origem`, por isso
   pode correr duas vezes sem duplicar.
4. Confirmar as contagens no fim do ficheiro.

Os dados são uma fotografia do dia em que foram exportados. Se o quadro continuar a ser
usado entretanto, gerar a exportação outra vez antes de importar — pedir à Juliana.
