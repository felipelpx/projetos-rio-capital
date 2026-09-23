# Passo a passo — do zip ao site a funcionar

Quatro etapas. A 1 é a Juliana; as 2 a 4 são o Felipe (ou alguém com acesso ao
Supabase e ao Netlify).

---

## 1. Pôr os ficheiros no GitHub

No repositório `projetos-rio-capital`: **Add file → Upload files**, arrastar e
**Commit changes**.

São onze ficheiros na raiz mais a pasta `app/`:

| | |
|---|---|
| `README.md` | página de entrada do repositório |
| `PASSO_A_PASSO.md` | este documento |
| `PARA_O_FELIPE.md` | o que é preciso dele e o passo crítico de segurança |
| `01_schema.sql` | tabelas, políticas, triggers |
| `02_dados.sql` | os 7 projetos, 37 tarefas e 14 dependências |
| `03_testar_acessos.sql` | confere os três papéis |
| `04_anexos.sql` | permissões do armazenamento de ficheiros |
| `05_dar_acesso.sql` | dá acesso às pessoas da equipa |
| `netlify.toml` | diz ao Netlify como construir o site — **tem de ficar na raiz** |
| `ESPECIFICACAO_MODULO.md` | como cada vista se comporta |
| `quadro_atual.html` | o quadro antigo, como referência |
| `app/` | o módulo React |

A pasta `app/` arrasta-se inteira para a mesma caixa — o GitHub mantém a
estrutura. Se o navegador não deixar arrastar pastas, descompacta o zip e
arrasta a pasta a partir do Explorador de Ficheiros.

---

## 2. Correr o SQL no Supabase

Painel do Supabase → **SQL Editor** → **New query**.

O `01_schema.sql` **pode correr as vezes que forem precisas** — apaga o que vai
recriar, por isso repetir não dá erro nem estraga nada. Se mudarmos alguma regra,
é só voltar a correr o 01.

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
próprio no fim. Devem aparecer **nove linhas, todas OK**.

Se alguma disser FALHA, quase de certeza o `01_schema.sql` não chegou ao fim
(um erro a meio deixa a base a meio caminho). Corrige-se correndo o 01 outra
vez, do princípio, e repetindo depois o 03.

### 2.2 Dar acesso às pessoas

São dois passos por pessoa: criar a conta, e dar-lhe a área de projetos.

**Criar a conta** (Supabase → **Authentication** → **Users** → **Add user** →
*Create new user*):

- email da pessoa
- uma palavra-passe inicial
- **ligar o *Auto Confirm User*** — senão o Supabase manda um email de
  confirmação, e o email é precisamente o que queremos evitar

A pessoa muda a palavra-passe depois, sozinha, no menu ⚙ dentro da aplicação.

**Dar o acesso**: abrir o **`05_dar_acesso.sql`**, pôr os emails com o papel de
cada um e correr. No fim imprime a lista de quem tem o quê.

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

## 3. Onde ficam os anexos das tarefas

Esta etapa só é precisa se quiserem anexar ficheiros às tarefas (orçamentos,
plantas, licenças). Se deixarem para depois, tudo o resto funciona — só o botão
"Carregar ficheiro" é que dá erro.

**Porque é preciso.** O Supabase tem duas metades: a base de dados, onde ficam
as tabelas, e o armazenamento, onde ficam ficheiros. São separadas. O ERP só usa
a primeira, porque não guarda ficheiros — daí nunca ter sido preciso mexer nisto.
Aqui, quando alguém anexa um PDF a uma tarefa, o ficheiro tem de ir para o
armazenamento; na tabela `pm_attachments` fica só o nome e a indicação de onde
ele está. Um **bucket** é o nome que o Supabase dá a uma pasta do armazenamento.

### 3.1 Criar o bucket

No painel do Supabase:

1. **Storage**, no menu da esquerda.
2. **New bucket**.
3. Nome: **`pm-anexos`** — exatamente assim, minúsculas e com o hífen. É este
   nome que está escrito no código; outro nome e a aplicação não encontra nada.
4. **Public bucket: deixar desligado.** Privado quer dizer que os ficheiros só
   se abrem com uma autorização momentânea que a aplicação pede por cada
   transferência. Ligado, qualquer pessoa com o endereço do ficheiro o abria,
   sem passar pelo login.
5. **Create bucket**.

### 3.2 Dizer quem pode o quê

O bucket acabado de criar está fechado a toda a gente: por omissão o Supabase
recusa tudo, e é assim que deve ser. Falta dizer quem pode ler, carregar e
remover.

No **SQL Editor**, colar o **`04_anexos.sql`** e correr. São três políticas:

| | |
|---|---|
| ler | quem tem acesso à área de projetos — é o que faz o botão ↓ funcionar |
| carregar | editores e super admins |
| remover | editores e super admins |

O visualizador vê e transfere, mas não carrega nem apaga. Quem não tem acesso
nenhum à área não vê sequer que os ficheiros existem.

### 3.3 Confirmar

No fim do `04_anexos.sql` há duas consultas de conferência. E na aplicação:
abrir uma tarefa, **Carregar ficheiro**, escolher um PDF — deve aparecer na
lista e o ↓ deve transferi-lo.

Ao contrário do quadro atual, aqui o **Excel e o Word funcionam**.

---

## 4. Publicar no Netlify

É aqui que nasce o link.

**Antes de começar:** a pasta `app/` e o `netlify.toml` têm de estar no GitHub.
O Netlify vai buscar o código ao repositório; se lá não estiverem, não há nada
para publicar.

### 4.1 Ligar o repositório

1. netlify.com → entrar (dá para entrar com a conta do GitHub).
2. **Add new site → Import an existing project**.
3. **Deploy with GitHub**. Na primeira vez o GitHub pede autorização; pode-se
   dar acesso só a este repositório, não é preciso dar a todos.
4. Escolher **`projetos-rio-capital`**.
5. O Netlify mostra os campos de build já preenchidos — **não mexer**. Ele lê o
   `netlify.toml` da raiz, que já diz que o projeto está em `app/`, como se
   constrói e o que publicar.
6. **Deploy site**.

O primeiro build demora um ou dois minutos: instala as dependências e gera os
ficheiros. No fim sai um endereço tipo `flamboyant-tesla-a1b2c3.netlify.app`.

### 4.2 As duas variáveis

Se abrires o site agora, aparece **"Falta a configuração"**. É de propósito: o
site ainda não sabe onde está o Supabase.

1. No Netlify: **Site configuration → Environment variables → Add a variable**.
2. Duas variáveis, com estes nomes exatos:

   | nome | onde encontrar |
   |---|---|
   | `VITE_SUPABASE_URL` | Supabase → Settings → API → *Project URL* |
   | `VITE_SUPABASE_ANON_KEY` | Supabase → Settings → API → *Project API keys* → **anon / public** |

   A chave **anon** é pública por desenho — vai dentro do site e qualquer pessoa
   a consegue ver. Quem protege os dados é o RLS que já puseste, não ela. A
   **`service_role key` nunca entra aqui**: essa passa por cima de todas as
   políticas.

3. **Voltar a publicar.** Isto é o passo que toda a gente esquece: estas
   variáveis entram no site quando ele é construído, não quando é visitado.
   Acrescentá-las não muda o site que já está no ar. Em **Deploys →
   Trigger deploy → Deploy site**.

### 4.3 Dizer ao Supabase que este endereço é de confiança

Supabase → **Authentication → URL Configuration**:

- **Site URL**: o endereço do Netlify.
- **Redirect URLs**: acrescentar o mesmo endereço.

Com entrada por palavra-passe isto só é usado na recuperação de palavra-passe,
mas custa dez segundos e evita uma surpresa no dia em que for preciso.

### 4.4 Experimentar

Abrir o endereço e entrar com o email e a palavra-passe. Deves ver os
7 projetos e as 37 tarefas.

Se disser **"Sem acesso aos projetos"**, é porque falta a tua linha em
`app_access` (ponto 2.2) — a conta entrou, mas não tem a área atribuída.

### 4.5 O endereço definitivo (opcional)

Para `projetos.riocapital.pt` em vez do endereço do Netlify:

1. Netlify → **Domain management → Add a domain** → escrever o domínio.
2. No vosso DNS, um registo **CNAME** com nome `projetos` a apontar para o
   endereço `.netlify.app` do site.
3. O certificado de segurança o Netlify trata sozinho, em alguns minutos.
4. **Repetir o 4.3 com o endereço novo**, senão o login volta a falhar.

### Se correr mal

| O que se vê | O que é |
|---|---|
| Build falha com `vite: not found` | o Netlify não está a ver o `netlify.toml` da raiz — confirmar que está no repositório, ao lado dos SQL |
| "Falta a configuração" | faltam as variáveis, ou faltou voltar a publicar depois de as pôr (4.2, ponto 3) |
| "Page not found" ao recarregar uma vista | falta o bloco `[[redirects]]` do `netlify.toml` |
| O link do email leva ao sítio errado | falta o 4.3 |
| "Sem acesso aos projetos" | falta a linha em `app_access` — correr o `05_dar_acesso.sql` |
| Entra mas não aparece nada | o `02_dados.sql` não chegou a correr, ou o RLS não deixa ver — correr as consultas de conferência do ponto 2 |

---

## Depois disto

A entrada é por email e palavra-passe. As contas criam-se no painel do Supabase,
com uma palavra-passe inicial; cada pessoa muda-a depois no menu ⚙ dentro da
aplicação.

**Porque não é por link de email:** o serviço de email que o Supabase traz de
origem envia duas mensagens por hora e serve só para testes. Com uma equipa,
a terceira pessoa a entrar ficava à porta. Se um dia quiserem o link por email,
dá para voltar atrás — é preciso configurar um SMTP vosso em
Authentication → SMTP Settings.

O quadro antigo continua a funcionar enquanto for preciso. Quando o site novo
estiver a ser usado, vale a pena gerar a exportação outra vez, para não se
perder o que a equipa mexeu no meio.

Falta ainda, e está listado no `app/README.md`: arrastar cartões e barras, e o
resumo diário por email.
