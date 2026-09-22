# Gestor de Projetos Rio Capital — passagem para o Felipe

**Contexto em três linhas.** A Juliana tem um quadro de gestão de projetos a funcionar
(7 projetos, 36 tarefas, com Gantt, dependências e alertas), montado fora do ERP. A ideia
é passá-lo para o vosso ambiente: **site separado no Netlify, a partilhar o mesmo Supabase
e o mesmo login do ERP**. Assim há uma só lista de utilizadores, e o campo "empresa" dos
projetos pode passar a apontar para as sociedades que o ERP já tem.

Vão com este documento dois ficheiros: `01_schema.sql` e `02_dados.sql`.

---

## 1. O que precisamos de ti (é o que desbloqueia tudo)

### 1.1 Acesso ao repositório do ERP

Adiciona a Juliana como colaboradora no GitHub. Depois disso ela consegue trabalhar no
repositório com o Claude, num ramo à parte — tu recebes um pull request e revês antes de
juntar. Nada vai para `main` sem passar por ti.

Se preferires não dar acesso ao repositório do ERP, a alternativa é criares um repositório
novo e vazio para o gestor de projetos e dares acesso só a esse. Perde-se a partilha de
componentes, mas funciona.

### 1.2 O esquema atual do Supabase

Precisamos de ver os nomes reais das tabelas — sobretudo as financeiras — e como estão
modeladas as sociedades. **Só a estrutura, sem dados e sem chaves:**

```bash
supabase db dump --schema-only -f esquema_erp.sql
```

Se não tiveres o CLI à mão, serve também: no painel do Supabase → SQL Editor → correr

```sql
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;
```

e exportar o resultado em CSV.

### 1.3 Confirmar duas coisas

- Como é que o ERP identifica hoje o utilizador e o papel dele (há tabela `profiles`?
  `users`? o papel está nos metadados do `auth.users`?). Isto decide se reaproveitamos
  a tua tabela ou criamos a `app_access` que vai no esquema.
- Qual é a tabela das sociedades (a que dá "Alternative Shadow", "Classic Revelation",
  "Crunchy Prophecy"...), para o campo `empresa` deixar de ser texto.

### 1.4 O que NÃO deves enviar

Nem para a Juliana nem para dentro do Claude: a **`service_role key`**, a **senha da base
de dados**, tokens ou credenciais de qualquer tipo. Nada do que está acima precisa delas —
o dump de esquema não as inclui.

---

## 2. Os dois ficheiros

### `01_schema.sql` — estrutura e permissões

Cria as tabelas do módulo (`pm_projects`, `pm_tasks`, `pm_comments`, `pm_attachments`,
`pm_statuses`, `pm_task_deps`, `pm_task_assignees`, `pm_subscriptions`) e as políticas RLS.

Coisas que vale a pena olhares com atenção:

- **`app_access`** — uma linha por área a que a pessoa tem acesso (`erp` / `projetos`),
  com o papel (`view` / `interact` / `admin`). É isto que permite ter gente que só vê os
  projetos e nunca o financeiro.
- **Projetos particulares** — `pm_projects.owner_id` preenchido significa que só o dono o
  vê. É usado para cada pessoa ter as suas próprias tarefas de acompanhamento.
- **Linha de base** — `pm_tasks.fim_previsto` grava-se na primeira vez que se define um
  fim e um trigger impede que seja alterada. Para a repor há a função
  `pm_repor_fim_previsto(task, justificacao)`, que exige justificação e deixa registo em
  `pm_comments` com `tipo='replaneamento'`. Esses registos não podem ser editados nem
  apagados, de propósito.

### `02_dados.sql` — os dados que já existem

Os 7 projetos, 36 tarefas (com datas, prioridades, notas, progresso e linhas de base) e
14 dependências. Guarda o id de origem em `id_origem`, por isso **pode correr duas vezes
sem duplicar**. No fim tem os `select count(*)` de conferência.

**Ordem:** primeiro `01_schema.sql`, depois `02_dados.sql`.

---

## 3. >>> O passo crítico — secção 8 do esquema <<<

As tabelas financeiras do ERP (extratos, contas a pagar, pagamentos, entidades, vendas,
orçamento) **precisam de uma política que exija explicitamente a área `erp`**.

Sem isso, um utilizador criado só para os projetos tem um token válido contra a **mesma
API** do Supabase e consegue ler o financeiro — por muito que o site dele seja outro
endereço. O domínio separado é arrumação, não é proteção.

Para cada tabela financeira:

```sql
alter table public.<tabela> enable row level security;

create policy <tabela>_erp_ler on public.<tabela> for select
  using (tem_area('erp'));

create policy <tabela>_erp_escrever on public.<tabela> for all
  using (pode_escrever('erp')) with check (pode_escrever('erp'));
```

Não deixei isto escrito porque não conheço os nomes reais das tabelas.

**Teste antes de dar acesso a alguém de fora:** cria um utilizador de teste com apenas
`app_access('projetos')` e confirma que um `select` a cada tabela financeira devolve
**zero linhas**. Se devolver alguma, falta política nessa tabela.

---

## 4. Depois disso

1. Bucket privado `pm-anexos` no Storage, com leitura para `tem_area('projetos')` e
   escrita para `pode_escrever('projetos')`. (Ao contrário do quadro atual, aqui o Excel
   e o Word funcionam.)
2. Site novo no Netlify + subdomínio (por exemplo `projetos.riocapital.pt`), a apontar
   para o mesmo projeto Supabase.
3. O módulo em si — React, no vosso padrão. Está tudo desenhado e testado: quadro Kanban
   com colunas configuráveis, quadro por projeto, Gantt com linha de base e desvios,
   lista filtrável, página de alertas de prazo, comentários e anexos por tarefa.
4. O resumo diário por email passa a ser uma Edge Function agendada + um serviço de envio
   (Resend ou equivalente), a ler `pm_subscriptions`. Cada pessoa liga e desliga o seu.

---

## 5. Onde está o quadro atual

https://claude.ai/artifact/YVTXxhzViKSciRycTahEhf

Continua a funcionar durante toda a migração — a equipa pode usá-lo normalmente até o
módulo novo estar pronto. Os dados no `02_dados.sql` são uma fotografia de hoje; se
entretanto houver alterações, gera-se a exportação outra vez antes de importar.
