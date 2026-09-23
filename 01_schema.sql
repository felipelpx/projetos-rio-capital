-- ============================================================================
-- Rio Capital — módulo de Gestão de Projetos
-- Esquema Supabase + políticas RLS
--
-- Preparado para revisão do Felipe antes de aplicar.
-- Não contém dados nem chaves. Correr no SQL Editor do Supabase.
--
-- Pode correr as vezes que forem precisas: tudo aqui apaga-se antes de se
-- criar, por isso repetir não dá erro nem estraga o que já existe.
--
-- NOTA IMPORTANTE (ler a secção 6 antes de aplicar em produção):
-- a separação entre quem vê o ERP e quem vê só os Projetos tem de ser
-- imposta AQUI, nas políticas, e não pelo endereço do site.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Quem pode entrar em quê
-- ----------------------------------------------------------------------------
-- Se o ERP já tiver uma tabela de perfis/utilizadores, saltar a criação de
-- `profiles` e apontar `app_access.user_id` para a que já existe.

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nome        text not null,
  email       text,
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);

-- Quem entra pela primeira vez fica logo com perfil. Sem isto, era preciso
-- criar a linha à mão antes de lhe dar acesso, e a única pista era um erro de
-- chave estrangeira — não vale a pena guardar essa armadilha para o próximo.
create or replace function public.pm_criar_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, nome, email)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'name'), ''),
      nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
      split_part(new.email, '@', 1)
    ),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists pm_auth_novo_utilizador on auth.users;
create trigger pm_auth_novo_utilizador
  after insert on auth.users
  for each row execute function public.pm_criar_perfil();

-- Uma linha por área a que a pessoa tem acesso.
-- area: 'erp' | 'projetos'
--
-- Os três papéis da área 'projetos':
--   view      Visualizador — vê tudo, não mexe em nada.
--   interact  Editor       — cria e altera tarefas, comenta, anexa, mexe nas
--                            datas. NÃO pode repor a data prevista (a que exige
--                            justificação) nem gerir acessos.
--   admin     Super admin  — tudo o que o editor faz, mais repor a data prevista
--                            com justificação e dar/retirar acesso a pessoas.
create table if not exists public.app_access (
  user_id   uuid not null references public.profiles(id) on delete cascade,
  area      text not null check (area in ('erp','projetos')),
  role      text not null check (role in ('view','interact','admin')),
  primary key (user_id, area)
);

-- Funções auxiliares usadas por todas as políticas.
-- SECURITY DEFINER para não entrarem em recursão com o RLS de app_access.
create or replace function public.tem_area(p_area text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.app_access
    where user_id = auth.uid() and area = p_area
  );
$$;

create or replace function public.pode_escrever(p_area text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.app_access
    where user_id = auth.uid() and area = p_area and role in ('interact','admin')
  );
$$;

create or replace function public.e_admin(p_area text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.app_access
    where user_id = auth.uid() and area = p_area and role = 'admin'
  );
$$;


-- ----------------------------------------------------------------------------
-- 2. Colunas do quadro
-- ----------------------------------------------------------------------------
create table if not exists public.pm_statuses (
  id              text primary key,
  label           text not null,
  color           text not null default '#7C8B99',
  posicao         integer not null,
  conta_concluido boolean not null default false,  -- risca o cartão, progresso a 100%
  conta_por_iniciar boolean not null default false -- serve para o "início em atraso"
);


-- ----------------------------------------------------------------------------
-- 3. Projetos
-- ----------------------------------------------------------------------------
-- owner_id preenchido = projeto particular: só o dono o vê.
-- company_id: trocar o tipo/refer~encia pela tabela de sociedades do ERP
-- (ver secção 7). Fica text enquanto isso não estiver decidido.
create table if not exists public.pm_projects (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  empresa     text,                       -- → substituir por company_id uuid references entidades(id)
  color       text not null default '#3A72B8',
  arquivado   boolean not null default false,
  owner_id    uuid references public.profiles(id) on delete cascade,
  criado_em   timestamptz not null default now()
);
create index if not exists pm_projects_owner_idx on public.pm_projects(owner_id);


-- ----------------------------------------------------------------------------
-- 4. Tarefas e o que lhes pertence
-- ----------------------------------------------------------------------------
create table if not exists public.pm_tasks (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid references public.pm_projects(id) on delete set null,
  titulo        text not null default '',
  status_id     text not null references public.pm_statuses(id),
  prioridade    text not null default 'media'
                check (prioridade in ('baixa','media','alta','urgente')),
  inicio        date,
  fim           date,                     -- data real, muda
  fim_previsto  date,                     -- linha de base: grava-se uma vez e não muda
  progresso     smallint not null default 0 check (progresso between 0 and 100),
  notas         text not null default '',
  posicao       numeric not null default 1000,   -- ordem manual dentro da coluna
  owner_id      uuid references public.profiles(id) on delete cascade, -- tarefa particular
  criado_em     timestamptz not null default now()
);
create index if not exists pm_tasks_project_idx on public.pm_tasks(project_id);
create index if not exists pm_tasks_status_idx  on public.pm_tasks(status_id);
create index if not exists pm_tasks_owner_idx   on public.pm_tasks(owner_id);

-- A linha de base fixa-se na primeira vez que se grava um fim e nunca mais muda.
create or replace function public.pm_fixar_fim_previsto()
returns trigger language plpgsql as $$
begin
  if new.fim is not null and old.fim_previsto is null then
    new.fim_previsto := new.fim;
  elsif old.fim_previsto is not null then
    new.fim_previsto := old.fim_previsto;  -- ignora tentativas de alterar
  end if;
  return new;
end;
$$;
drop trigger if exists pm_tasks_fim_previsto on public.pm_tasks;
create trigger pm_tasks_fim_previsto
  before update on public.pm_tasks
  for each row execute function public.pm_fixar_fim_previsto();
-- Repor a linha de base faz-se pela função da secção 5 (deixa registo).

create table if not exists public.pm_task_assignees (
  task_id   uuid not null references public.pm_tasks(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  primary key (task_id, user_id)
);

create table if not exists public.pm_task_deps (
  task_id      uuid not null references public.pm_tasks(id) on delete cascade,
  depende_de   uuid not null references public.pm_tasks(id) on delete cascade,
  -- dias que têm de passar entre o fim da antecessora e o arranque desta tarefa
  -- (fim-início com espera; 0 = arranca logo no dia seguinte)
  dias_espera  integer not null default 0 check (dias_espera >= 0 and dias_espera <= 365),
  primary key (task_id, depende_de),
  check (task_id <> depende_de)
);
-- Quem criou esta tabela com a primeira versão do ficheiro não tem a coluna.
alter table public.pm_task_deps
  add column if not exists dias_espera integer not null default 0;
do $$ begin
  alter table public.pm_task_deps
    add constraint pm_task_deps_espera_ck check (dias_espera >= 0 and dias_espera <= 365);
exception when duplicate_object then null; end $$;

-- A data mais cedo a que uma tarefa pode arrancar, dadas todas as antecessoras.
-- Serve para o reagendamento em cascata e para assinalar dependências desrespeitadas.
create or replace function public.pm_inicio_mais_cedo(p_task uuid)
returns date language sql stable as $$
  select max(t.fim + 1 + d.dias_espera)
  from public.pm_task_deps d
  join public.pm_tasks t on t.id = d.depende_de
  where d.task_id = p_task and t.fim is not null
$$;

create table if not exists public.pm_comments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.pm_tasks(id) on delete cascade,
  autor_id    uuid references public.profiles(id) on delete set null,
  tipo        text not null default 'comentario'
              check (tipo in ('comentario','replaneamento')),
  texto       text not null,
  de_data     date,   -- só em 'replaneamento'
  para_data   date,   -- só em 'replaneamento'
  criado_em   timestamptz not null default now(),
  editado_em  timestamptz
);
create index if not exists pm_comments_task_idx on public.pm_comments(task_id);

create table if not exists public.pm_attachments (
  id            uuid primary key default gen_random_uuid(),
  task_id       uuid not null references public.pm_tasks(id) on delete cascade,
  tipo          text not null check (tipo in ('ficheiro','link')),
  nome          text not null,
  storage_path  text,   -- bucket 'pm-anexos' quando tipo='ficheiro'
  url           text,   -- quando tipo='link'
  bytes         bigint,
  mime          text,
  criado_por    uuid references public.profiles(id) on delete set null,
  criado_em     timestamptz not null default now(),
  check ((tipo='ficheiro' and storage_path is not null)
      or (tipo='link'     and url is not null))
);
create index if not exists pm_attachments_task_idx on public.pm_attachments(task_id);


-- ----------------------------------------------------------------------------
-- 5. Repor a data prevista — deixa sempre registo
-- ----------------------------------------------------------------------------
create or replace function public.pm_repor_fim_previsto(
  p_task uuid, p_justificacao text
) returns void language plpgsql security definer set search_path = public as $$
declare v_antiga date; v_nova date;
begin
  -- A função é SECURITY DEFINER, por isso passa por cima do RLS: a verificação
  -- do papel tem de estar aqui dentro, senão qualquer editor a podia chamar.
  if not public.e_admin('projetos') then
    raise exception 'Só um super admin pode repor a data prevista.';
  end if;
  if coalesce(trim(p_justificacao),'') = '' then
    raise exception 'A justificação é obrigatória.';
  end if;
  select fim_previsto, fim into v_antiga, v_nova from public.pm_tasks where id = p_task;
  if v_nova is null then raise exception 'A tarefa não tem data de fim.'; end if;

  insert into public.pm_comments (task_id, autor_id, tipo, texto, de_data, para_data)
  values (p_task, auth.uid(), 'replaneamento', p_justificacao, v_antiga, v_nova);

  update public.pm_tasks set fim_previsto = null where id = p_task;
  update public.pm_tasks set fim_previsto = v_nova where id = p_task;
end;
$$;


-- ----------------------------------------------------------------------------
-- 6. Subscrições do resumo diário
-- ----------------------------------------------------------------------------
create table if not exists public.pm_subscriptions (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  ativo       boolean not null default false,
  email       text,
  ambito      text not null default 'tudo' check (ambito in ('tudo','minhas')),
  atualizado  timestamptz not null default now()
);


-- ============================================================================
-- 7. RLS — a parte que importa rever com atenção
-- ============================================================================
alter table public.profiles          enable row level security;
alter table public.app_access        enable row level security;
alter table public.pm_statuses       enable row level security;
alter table public.pm_projects       enable row level security;
alter table public.pm_tasks          enable row level security;
alter table public.pm_task_assignees enable row level security;
alter table public.pm_task_deps      enable row level security;
alter table public.pm_comments       enable row level security;
alter table public.pm_attachments    enable row level security;
alter table public.pm_subscriptions  enable row level security;

-- Políticas de versões anteriores deste ficheiro que entretanto mudaram de nome.
-- Sem isto ficavam penduradas, a conceder acessos que já não se controlam aqui.
drop policy if exists acessos_gerir on public.app_access;

-- Perfis: cada um vê-se a si; quem gere os projetos vê a equipa (para atribuir).
drop policy if exists profiles_ler on public.profiles;
create policy profiles_ler on public.profiles for select
  using (id = auth.uid() or tem_area('projetos') or tem_area('erp'));
drop policy if exists profiles_editar_se on public.profiles;
create policy profiles_editar_se on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- Acessos: só quem administra os mexe.
drop policy if exists acessos_ler on public.app_access;
create policy acessos_ler on public.app_access for select
  using (user_id = auth.uid() or e_admin('erp') or tem_area('projetos'));

-- Quem administra o ERP mexe em tudo.
drop policy if exists acessos_gerir_erp on public.app_access;
create policy acessos_gerir_erp on public.app_access for all
  using (e_admin('erp')) with check (e_admin('erp'));

-- O super admin dos projetos dá e retira acesso à área dos projetos, e só a
-- essa: o with check impede-o de se promover a si próprio no ERP.
drop policy if exists acessos_gerir_projetos on public.app_access;
create policy acessos_gerir_projetos on public.app_access for all
  using (e_admin('projetos') and area = 'projetos')
  with check (e_admin('projetos') and area = 'projetos');

-- Colunas do quadro.
drop policy if exists st_ler on public.pm_statuses;
create policy st_ler on public.pm_statuses for select using (tem_area('projetos'));
drop policy if exists st_gerir on public.pm_statuses;
create policy st_gerir on public.pm_statuses for all
  using (pode_escrever('projetos')) with check (pode_escrever('projetos'));

-- Projetos: os partilhados para quem tem a área; os particulares só para o dono.
drop policy if exists proj_ler on public.pm_projects;
create policy proj_ler on public.pm_projects for select
  using (tem_area('projetos') and (owner_id is null or owner_id = auth.uid()));
drop policy if exists proj_criar on public.pm_projects;
create policy proj_criar on public.pm_projects for insert
  with check (pode_escrever('projetos') and (owner_id is null or owner_id = auth.uid()));
drop policy if exists proj_alterar on public.pm_projects;
create policy proj_alterar on public.pm_projects for update
  using (pode_escrever('projetos') and (owner_id is null or owner_id = auth.uid()))
  with check (pode_escrever('projetos') and (owner_id is null or owner_id = auth.uid()));
drop policy if exists proj_apagar on public.pm_projects;
create policy proj_apagar on public.pm_projects for delete
  using (pode_escrever('projetos') and (owner_id is null or owner_id = auth.uid()));

-- Tarefas: a tarefa é visível se o projeto dela for visível.
create or replace function public.pm_projeto_visivel(p_project uuid, p_owner uuid)
returns boolean language sql stable as $$
  select tem_area('projetos')
     and (p_owner is null or p_owner = auth.uid())
     and (p_project is null or exists (
           select 1 from public.pm_projects p
           where p.id = p_project and (p.owner_id is null or p.owner_id = auth.uid())));
$$;

drop policy if exists tar_ler on public.pm_tasks;
create policy tar_ler on public.pm_tasks for select
  using (pm_projeto_visivel(project_id, owner_id));
drop policy if exists tar_escrever on public.pm_tasks;
create policy tar_escrever on public.pm_tasks for all
  using (pode_escrever('projetos') and pm_projeto_visivel(project_id, owner_id))
  with check (pode_escrever('projetos') and pm_projeto_visivel(project_id, owner_id));

-- Tabelas dependentes: seguem a visibilidade da tarefa.
drop policy if exists atr_ler on public.pm_task_assignees;
create policy atr_ler on public.pm_task_assignees for select
  using (exists (select 1 from public.pm_tasks t where t.id = task_id));
drop policy if exists atr_escrever on public.pm_task_assignees;
create policy atr_escrever on public.pm_task_assignees for all
  using (pode_escrever('projetos') and exists (select 1 from public.pm_tasks t where t.id = task_id))
  with check (pode_escrever('projetos') and exists (select 1 from public.pm_tasks t where t.id = task_id));

drop policy if exists dep_ler on public.pm_task_deps;
create policy dep_ler on public.pm_task_deps for select
  using (exists (select 1 from public.pm_tasks t where t.id = task_id));
drop policy if exists dep_escrever on public.pm_task_deps;
create policy dep_escrever on public.pm_task_deps for all
  using (pode_escrever('projetos') and exists (select 1 from public.pm_tasks t where t.id = task_id))
  with check (pode_escrever('projetos') and exists (select 1 from public.pm_tasks t where t.id = task_id));

drop policy if exists com_ler on public.pm_comments;
create policy com_ler on public.pm_comments for select
  using (exists (select 1 from public.pm_tasks t where t.id = task_id));
drop policy if exists com_criar on public.pm_comments;
create policy com_criar on public.pm_comments for insert
  with check (pode_escrever('projetos') and autor_id = auth.uid()
              and exists (select 1 from public.pm_tasks t where t.id = task_id));
-- Só o autor edita, e nunca um registo de replaneamento.
drop policy if exists com_editar on public.pm_comments;
create policy com_editar on public.pm_comments for update
  using (autor_id = auth.uid() and tipo = 'comentario')
  with check (autor_id = auth.uid() and tipo = 'comentario');
drop policy if exists com_apagar on public.pm_comments;
create policy com_apagar on public.pm_comments for delete
  using (autor_id = auth.uid() and tipo = 'comentario');

drop policy if exists anx_ler on public.pm_attachments;
create policy anx_ler on public.pm_attachments for select
  using (exists (select 1 from public.pm_tasks t where t.id = task_id));
drop policy if exists anx_escrever on public.pm_attachments;
create policy anx_escrever on public.pm_attachments for all
  using (pode_escrever('projetos')) with check (pode_escrever('projetos'));

-- Subscrições: cada pessoa só mexe na sua; todas se leem (para o envio).
drop policy if exists sub_ler on public.pm_subscriptions;
create policy sub_ler on public.pm_subscriptions for select using (tem_area('projetos'));
drop policy if exists sub_minha on public.pm_subscriptions;
create policy sub_minha on public.pm_subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());


-- ============================================================================
-- 8. >>> FELIPE: ISTO FALTA, E É O PASSO CRÍTICO <<<
-- ============================================================================
-- As tabelas financeiras do ERP (extratos, contas a pagar, pagamentos,
-- entidades, vendas, orçamento...) precisam de uma política que exija
-- explicitamente a área 'erp'. Sem isto, um utilizador criado só para os
-- Projetos tem um token válido contra a MESMA API e consegue ler o
-- financeiro, por muito que o site dele seja outro.
--
-- Para CADA tabela financeira existente, o padrão é:
--
--   alter table public.<tabela> enable row level security;
--   create policy <tabela>_erp on public.<tabela> for select
--     using (tem_area('erp'));
--   create policy <tabela>_erp_escrever on public.<tabela> for all
--     using (pode_escrever('erp')) with check (pode_escrever('erp'));
--
-- Não escrevi isto já feito porque não conheço os nomes reais das tabelas.
-- Depois de aplicar, vale a pena testar com um utilizador de teste que só
-- tenha app_access('projetos') e confirmar que um select às tabelas
-- financeiras devolve zero linhas.


-- ============================================================================
-- 9. Armazenamento dos anexos
-- ============================================================================
-- No painel: Storage → New bucket → 'pm-anexos', privado.
-- Políticas do bucket: leitura para tem_area('projetos'),
-- escrita para pode_escrever('projetos').
-- Ao contrário do quadro atual, aqui não há limite de formato:
-- Excel e Word passam a funcionar.
