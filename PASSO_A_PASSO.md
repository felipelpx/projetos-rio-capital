# Passo a passo — do zip ao site a funcionar

Quatro etapas. A 1 é a Juliana; as 2 a 4 são o Felipe (ou alguém com acesso ao
Supabase e ao Netlify).

---

## 1. Pôr os ficheiros no GitHub

No repositório `projetos-rio-capital`: **Add file → Upload files**, arrastar e
**Commit changes**.

São oito ficheiros na raiz mais a pasta `app/`:

| | |
|---|---|
| `README.md` | página de entrada do repositório |
| `PASSO_A_PASSO.md` | este documento |
| `PARA_O_FELIPE.md` | o que é preciso dele e o passo crítico de segurança |
| `01_schema.sql` | tabelas, políticas, triggers |
| `02_dados.sql` | os 7 projetos, 37 tarefas e 14 dependências |
| `03_testar_acessos.sql` | confere os três papéis |
| `ESPECIFICACAO_MODULO.md` | como cada vista se comporta |
| `quadro_atual.html` | o quadro antigo, como referência |
| `app/` | o módulo React |

A pasta `app/` arrasta-se inteira para a mesma caixa — o GitHub mantém a
estrutura. Se o navegador não deixar arrastar pastas, descompacta o zip e
arrasta a pasta a partir do Explorador de Ficheiros.

---

## 2. Correr o SQL no Supabase

Painel do Supabase → **SQL Editor** → **New query**.

1. Colar o conteúdo do **`01_schema.sql`** e correr (**Run**).
   Cria as tabelas `pm_*`, as políticas RLS, o trigger da linha de base e as
   funções auxiliares. Não deve dar erro nenhum.
2. Nova query, colar o **`02_dados.sql`** e correr.
   Traz os dados do quadro atual.

**Pela ordem indicada** — o segundo precisa das tabelas do primeiro.

Ambos podem correr duas vezes sem duplicar nada, por isso se houver dúvida
volta-se a correr sem medo.

Para conferir, no fim:

```sql
select count(*) from public.pm_projects;   -- 7
select count(*) from public.pm_tasks;      -- 37
select count(*) from public.pm_task_deps;  -- 14

-- dependências desrespeitadas: deve devolver zero linhas
select t.titulo, t.inicio, public.pm_inicio_mais_cedo(t.id) as podia_arrancar
  from public.pm_tasks t
 where t.inicio is not null and t.inicio < public.pm_inicio_mais_cedo(t.id);
```

### 2.1 Conferir os papéis

Terceira query: colar o **`03_testar_acessos.sql`** e correr. Cria três
utilizadores de teste, experimenta o que cada um consegue fazer e apaga-se a si
próprio no fim. Devem aparecer **nove linhas, todas OK**. Se alguma disser
FALHA, não avançar.

### 2.2 Dar acesso às pessoas

A equipa é quem tem uma linha em `app_access`:

```sql
insert into public.app_access (user_id, area, role)
values ('<id do utilizador>', 'projetos', 'interact');
```

| `role` | na aplicação | o que pode |
|---|---|---|
| `admin` | **Super admin** | tudo: cria e altera tarefas, **repõe a data prevista com justificação**, e dá ou retira acesso às pessoas |
| `interact` | **Editor** | cria e altera tarefas, mexe nas datas de início e de fim real, comenta, anexa. **Não** repõe a data prevista nem gere acessos |
| `view` | **Visualizador** | vê tudo, não mexe em nada |

A diferença entre editor e super admin é uma só, e é de propósito: a **data
prevista** (a linha de base) é a referência contra a qual se mede o desvio de
todo o projeto. Alterá-la apaga a memória de qual era o plano. Por isso exige
justificação, deixa registo permanente nos comentários, e só um super admin a
pode mexer. O editor mexe à vontade na data de fim real — é isso que faz
aparecer o desvio e empurra as tarefas dependentes.

Isto está imposto na base de dados, não só no ecrã: um editor que chame a função
diretamente leva com *"Só um super admin pode repor a data prevista."*

Os ids das pessoas estão em **Authentication → Users**. Quem não tiver linha
nenhuma entra e vê um aviso a dizer que não tem acesso.

### 2.3 >>> O passo crítico de segurança <<<

As tabelas financeiras do ERP **precisam de uma política que exija a área `erp`**.
Sem isso, um utilizador criado só para os projetos tem um token válido contra a
mesma API e consegue ler o financeiro — por muito que o site dele seja outro
endereço. O domínio separado é arrumação, não é proteção.

Está explicado com o SQL na secção 3 do `PARA_O_FELIPE.md`. **Fazer isto antes
de dar acesso a alguém de fora.**

Teste: criar um utilizador só com `app_access('projetos')` e confirmar que um
`select` a cada tabela financeira devolve **zero linhas**.

---

## 3. Bucket dos anexos

Supabase → **Storage** → **New bucket**, com o nome `pm-anexos`, **privado**.

Depois, em SQL:

```sql
create policy anexos_ler on storage.objects for select
  using (bucket_id = 'pm-anexos' and public.tem_area('projetos'));

create policy anexos_escrever on storage.objects for insert
  with check (bucket_id = 'pm-anexos' and public.pode_escrever('projetos'));

create policy anexos_apagar on storage.objects for delete
  using (bucket_id = 'pm-anexos' and public.pode_escrever('projetos'));
```

Ao contrário do quadro atual, aqui o Excel e o Word funcionam.

---

## 4. Publicar no Netlify

1. Netlify → **Add new site → Import an existing project** → GitHub →
   `projetos-rio-capital`.
2. **Base directory:** `app`
   **Build command:** `npm run build`
   **Publish directory:** `app/dist`
   (o `app/netlify.toml` já traz isto; só é preciso apontar a base directory)
3. **Site settings → Environment variables**, duas variáveis:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

   Estão em Supabase → **Settings → API**. A chave **anon** é pública por
   desenho — quem protege os dados é o RLS. A **`service_role key` nunca entra
   aqui**, nem no repositório, nem em nenhum chat.
4. **Deploy.** Sai um endereço tipo `nome-qualquer.netlify.app`.
5. Para o endereço definitivo (por exemplo `projetos.riocapital.pt`):
   **Domain settings → Add custom domain**, e no vosso DNS um CNAME a apontar
   para o site do Netlify.
6. Em Supabase → **Authentication → URL Configuration**, acrescentar esse
   endereço aos **Redirect URLs**, senão o link de entrada por email devolve as
   pessoas ao sítio errado.

---

## Depois disto

A entrada é por link de email: a pessoa escreve o email, recebe um link, clica e
está dentro. É o mesmo login do ERP, por ser o mesmo Supabase.

O quadro antigo continua a funcionar enquanto for preciso. Quando o site novo
estiver a ser usado, vale a pena gerar a exportação outra vez, para não se
perder o que a equipa mexeu no meio.

Falta ainda, e está listado no `app/README.md`: arrastar cartões e barras, e o
resumo diário por email.
