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
--   view      Visualizador    — vê tudo e comenta. Não cria, não altera,
--                                não apaga.
--   contrib   Editor parcial  — o do visualizador, mais criar tarefas e
--                                alterá-las. NÃO mexe em datas nem apaga nada.
--   interact  Editor          — tudo o que o editor parcial faz, mais datas,
--                                dependências e apagar. NÃO repõe a data
--                                prevista nem gere acessos.
--   admin     Super admin     — tudo, incluindo repor a data prevista com
--                                justificação e dar/retirar acesso a pessoas.
create table if not exists public.app_access (
  user_id   uuid not null references public.profiles(id) on delete cascade,
  area      text not null check (area in ('erp','projetos')),
  role      text not null check (role in ('view','contrib','interact','admin')),
  primary key (user_id, area)
);
-- `create table if not exists` não mexe numa tabela que já existe, e a lista de
-- papéis cresceu. Sem isto, uma base montada com a versão anterior recusava
-- 'contrib' com um erro de restrição.
do $$
declare c text;
begin
  for c in
    select con.conname from pg_constraint con
    join pg_class t on t.oid = con.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'app_access'
      and con.contype = 'c' and pg_get_constraintdef(con.oid) ilike '%role%'
  loop
    execute format('alter table public.app_access drop constraint %I', c);
  end loop;
end $$;
alter table public.app_access
  add constraint app_access_role_check check (role in ('view','contrib','interact','admin'));

-- Funções auxiliares usadas por todas as políticas.
-- SECURITY DEFINER para não entrarem em recursão com o RLS de app_access.
create or replace function public.tem_area(p_area text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.app_access
    where user_id = auth.uid() and area = p_area
  );
$$;

-- Escrita completa: datas, dependências e apagar. Editor e super admin.
create or replace function public.pode_escrever(p_area text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.app_access
    where user_id = auth.uid() and area = p_area and role in ('interact','admin')
  );
$$;

-- Criar e alterar tarefas: editor parcial para cima.
create or replace function public.pode_criar(p_area text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.app_access
    where user_id = auth.uid() and area = p_area
      and role in ('contrib','interact','admin')
  );
$$;

-- Comentar: qualquer pessoa com acesso à área, incluindo o visualizador.
create or replace function public.pode_comentar(p_area text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.tem_area(p_area);
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
-- A empresa está em pm_empresas (secção 3b); aqui fica o empresa_id e uma
-- cópia do nome. Por decidir: ligar pm_empresas à tabela de sociedades do ERP.
create table if not exists public.pm_projects (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  empresa     text,                       -- espelho de pm_empresas.nome (ver 3b); não escrever à mão
  color       text not null default '#3A72B8',
  arquivado   boolean not null default false,
  owner_id    uuid references public.profiles(id) on delete cascade,
  -- caminho da foto dentro do balde pm-anexos (ex.: projetos/<id>/capa.jpg);
  -- o endereço para a mostrar é assinado na altura, como nos anexos
  foto        text,
  -- true = mostrar a imagem inteira, sem cortar. Serve para plantas, ortofotos
  -- e logótipos, que perdem o sentido se lhes cortarem as bordas.
  foto_inteira boolean not null default false,
  criado_em   timestamptz not null default now()
);
alter table public.pm_projects add column if not exists foto text;
alter table public.pm_projects add column if not exists foto_inteira boolean not null default false;
create index if not exists pm_projects_owner_idx on public.pm_projects(owner_id);


-- ----------------------------------------------------------------------------
-- 3b. Empresas
-- ----------------------------------------------------------------------------
-- A empresa era texto solto dentro do projeto. Passa a ser uma linha própria,
-- para poder ser criada, renomeada e arquivada (empresa que fecha não deve
-- sumir: os projetos antigos dela continuam a existir e a fazer sentido).
--
-- A coluna pm_projects.empresa continua lá, e continua a ser o nome, mas
-- deixa de ser escrita à mão: é um espelho, mantido pelos dois gatilhos
-- abaixo. Assim renomear uma empresa acerta todos os projetos dela de uma vez,
-- e tudo o que já lia .empresa continua a ler.
create table if not exists public.pm_empresas (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  arquivada  boolean not null default false,
  criado_em  timestamptz not null default now()
);
-- Dois nomes iguais com maiúsculas diferentes são a mesma empresa.
create unique index if not exists pm_empresas_nome_idx
  on public.pm_empresas (lower(nome));

alter table public.pm_projects
  add column if not exists empresa_id uuid references public.pm_empresas(id) on delete set null;
create index if not exists pm_projects_empresa_idx on public.pm_projects(empresa_id);

-- Passa o texto que já lá está para a tabela nova, uma vez só.
insert into public.pm_empresas (nome)
select distinct trim(p.empresa)
from public.pm_projects p
where nullif(trim(p.empresa), '') is not null
  and not exists (
    select 1 from public.pm_empresas e where lower(e.nome) = lower(trim(p.empresa))
  );

update public.pm_projects p
   set empresa_id = e.id
  from public.pm_empresas e
 where p.empresa_id is null
   and lower(e.nome) = lower(trim(p.empresa));

-- O espelho: quem manda é o empresa_id, o texto vem atrás e nunca se escreve
-- à mão. Se ainda assim chegar texto solto sem empresa_id (a importação do
-- quadro antigo, ou um cliente desatualizado), a empresa é procurada pelo nome
-- e criada se não existir — em vez de se perder.
create or replace function public.pm_espelhar_empresa()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.empresa_id is null
     and nullif(btrim(coalesce(new.empresa, '')), '') is not null
     and (tg_op = 'INSERT' or new.empresa is distinct from old.empresa)
  then
    select id into new.empresa_id
      from public.pm_empresas where lower(nome) = lower(btrim(new.empresa));
    if new.empresa_id is null then
      insert into public.pm_empresas (nome) values (btrim(new.empresa))
        returning id into new.empresa_id;
    end if;
  end if;
  new.empresa := (select nome from public.pm_empresas where id = new.empresa_id);
  return new;
end $$;
drop trigger if exists pm_projects_empresa on public.pm_projects;
create trigger pm_projects_empresa
  before insert or update on public.pm_projects
  for each row execute function public.pm_espelhar_empresa();

-- Renomear a empresa acerta os projetos dela.
create or replace function public.pm_renomear_empresa()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.nome is distinct from old.nome then
    update public.pm_projects set empresa = new.nome where empresa_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists pm_empresas_renomear on public.pm_empresas;
create trigger pm_empresas_renomear
  after update on public.pm_empresas
  for each row execute function public.pm_renomear_empresa();

-- A empresa do próprio grupo, para já sem projetos associados.
insert into public.pm_empresas (nome)
select 'Rio Capital'
where not exists (select 1 from public.pm_empresas where lower(nome) = 'rio capital');


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
  setor         text check (setor in ('comercial','operacional')),
  tem_custo     boolean not null default false,   -- "esta tarefa vai custar dinheiro"
  custo_previsto numeric(12,2),                   -- orçamento, em euros; ver secção 5b
  criado_em     timestamptz not null default now()
);
-- Quem criou a tabela antes destas colunas existirem.
-- O setor fica por preencher nas tarefas antigas, de propósito: pô-las todas
-- num setor à força era inventar informação que ninguém deu.
alter table public.pm_tasks add column if not exists setor text;
do $$ begin
  alter table public.pm_tasks add constraint pm_tasks_setor_check
    check (setor is null or setor in ('comercial','operacional'));
exception when duplicate_object then null; end $$;
alter table public.pm_tasks add column if not exists tem_custo boolean not null default false;
alter table public.pm_tasks add column if not exists custo_previsto numeric(12,2);
do $$ begin
  alter table public.pm_tasks add constraint pm_tasks_custo_check
    check (custo_previsto is null or custo_previsto >= 0);
exception when duplicate_object then null; end $$;
create index if not exists pm_tasks_project_idx on public.pm_tasks(project_id);
create index if not exists pm_tasks_status_idx  on public.pm_tasks(status_id);
create index if not exists pm_tasks_owner_idx   on public.pm_tasks(owner_id);

-- A linha de base fixa-se na primeira vez que se grava um fim e nunca mais muda.
create or replace function public.pm_fixar_fim_previsto()
returns trigger language plpgsql as $$
begin
  -- A reposição da secção 5 levanta esta bandeira antes de escrever. Sem ela,
  -- o gatilho repunha o valor antigo e a reposição não fazia nada — só ficava
  -- o comentário a dizer que tinha feito.
  if coalesce(current_setting('pm.replanear', true), '') = '1' then
    return new;
  end if;
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

-- O editor parcial não mexe em datas. Isto não se consegue fazer só com RLS,
-- que decide por linha e não por coluna, por isso vai num gatilho.
create or replace function public.pm_guardar_datas()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Operações do servidor (sem sessão) e as que vêm das funções com
  -- justificação (secção 5) passam.
  if auth.uid() is null
     or coalesce(current_setting('pm.replanear', true), '') = '1' then
    return new;
  end if;

  if not public.pode_escrever('projetos') then
    if tg_op = 'INSERT' then
      if new.inicio is not null or new.fim is not null or new.fim_previsto is not null then
        raise exception 'O teu acesso não permite definir datas.';
      end if;
    elsif new.inicio       is distinct from old.inicio
       or new.fim          is distinct from old.fim
       or new.fim_previsto is distinct from old.fim_previsto then
      raise exception 'O teu acesso não permite alterar datas.';
    end if;
    return new;
  end if;

  -- Escrever a primeira data é preencher, não alterar: passa. Mexer numa data
  -- que já lá estava muda o plano de toda a gente, e passa pela função
  -- pm_alterar_datas, que obriga a dizer porquê.
  if tg_op = 'UPDATE' then
    if (old.inicio is not null and new.inicio is distinct from old.inicio)
    or (old.fim    is not null and new.fim    is distinct from old.fim) then
      raise exception 'Alterar uma data já marcada exige uma justificação.';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists pm_tasks_datas on public.pm_tasks;
create trigger pm_tasks_datas
  before insert or update on public.pm_tasks
  for each row execute function public.pm_guardar_datas();

-- O orçamento segue a mesma regra da linha de base: escreve-se uma vez, e
-- mudá-lo depois é um ato deliberado de quem manda. Quem tem escrita completa
-- põe o valor numa tarefa que ainda não o tinha; alterar um valor já lá posto
-- passa pela função da secção 5b, que exige super admin e justificação.
create or replace function public.pm_guardar_custo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null
     or coalesce(current_setting('pm.replanear', true), '') = '1' then
    return new;
  end if;

  if not public.pode_escrever('projetos') then
    if tg_op = 'INSERT' then
      if new.tem_custo or new.custo_previsto is not null then
        raise exception 'O teu acesso não permite definir custos.';
      end if;
    elsif new.tem_custo is distinct from old.tem_custo
       or new.custo_previsto is distinct from old.custo_previsto then
      raise exception 'O teu acesso não permite alterar custos.';
    end if;
    return new;
  end if;

  -- Qualquer euro escrito passa pela função da secção 5b, que exige
  -- justificação. Marcar só "tem custo", sem valor, é livre: não é dinheiro,
  -- é um aviso de que ainda falta orçamentar.
  if tg_op = 'UPDATE' and new.custo_previsto is distinct from old.custo_previsto then
    if old.custo_previsto is null then
      raise exception 'Gravar um orçamento exige uma justificação.';
    else
      raise exception 'Alterar um orçamento já gravado exige um super admin e uma justificação.';
    end if;
  end if;
  if tg_op = 'INSERT' and new.custo_previsto is not null then
    raise exception 'Gravar um orçamento exige uma justificação.';
  end if;
  -- Desmarcar "tem custo" com orçamento posto equivalia a apagá-lo pela porta das traseiras.
  if tg_op = 'UPDATE' and old.custo_previsto is not null and not new.tem_custo then
    raise exception 'A tarefa tem orçamento. Para o retirar é preciso um super admin.';
  end if;
  -- Um valor implica sempre a marca, para os dois não se contradizerem.
  if new.custo_previsto is not null then new.tem_custo := true; end if;
  return new;
end;
$$;
drop trigger if exists pm_tasks_custo on public.pm_tasks;
create trigger pm_tasks_custo
  before insert or update on public.pm_tasks
  for each row execute function public.pm_guardar_custo();

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
              check (tipo in ('comentario','replaneamento','orcamento','datas')),
  texto       text not null,
  de_data     date,   -- só em 'replaneamento'
  para_data   date,   -- só em 'replaneamento'
  criado_em   timestamptz not null default now(),
  editado_em  timestamptz
);
alter table public.pm_comments add column if not exists campo      text;  -- 'inicio' | 'fim', nos registos de datas
alter table public.pm_comments add column if not exists de_valor   numeric(12,2);
alter table public.pm_comments add column if not exists para_valor numeric(12,2);
-- O tipo 'orcamento' não existia na primeira versão; `create table if not
-- exists` não mexe numa tabela que já lá está, por isso a restrição troca-se aqui.
do $$
declare v_nome text;
begin
  select conname into v_nome from pg_constraint
   where conrelid = 'public.pm_comments'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%tipo%replaneamento%';
  if v_nome is not null then
    execute format('alter table public.pm_comments drop constraint %I', v_nome);
  end if;
  alter table public.pm_comments add constraint pm_comments_tipo_check
    check (tipo in ('comentario','replaneamento','orcamento','datas'));
exception when duplicate_object then null;
end $$;
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

  perform set_config('pm.replanear', '1', true);
  update public.pm_tasks set fim_previsto = v_nova where id = p_task;
  perform set_config('pm.replanear', '0', true);
end;
$$;


-- ----------------------------------------------------------------------------
-- 5a. Alterar datas já marcadas — deixa sempre registo
-- ----------------------------------------------------------------------------
-- Marcar a primeira data faz-se na tarefa, sem cerimónia. Mexer numa data que
-- já lá estava mexe no plano de toda a gente, e só por aqui: uma linha nos
-- comentários por cada data que muda, com quem mudou e porquê.
--
-- p_empurrada_por serve a cascata: quando uma tarefa é arrastada por outra de
-- que depende, a justificação escreve-se sozinha em vez de perguntar. Só é
-- aceite se a tarefa indicada for mesmo uma antecessora desta.
create or replace function public.pm_alterar_datas(
  p_task uuid, p_inicio date, p_fim date, p_justificacao text,
  p_empurrada_por uuid default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_ini date; v_fim date; v_prev date; v_just text; v_nova_base date;
begin
  if not public.pode_escrever('projetos') then
    raise exception 'O teu acesso não permite alterar datas.';
  end if;
  select inicio, fim, fim_previsto into v_ini, v_fim, v_prev
    from public.pm_tasks where id = p_task;
  if not found then raise exception 'A tarefa não existe.'; end if;

  if p_empurrada_por is not null then
    if not exists (select 1 from public.pm_task_deps
                    where task_id = p_task and depende_de = p_empurrada_por) then
      raise exception 'Essa tarefa não é antecessora desta.';
    end if;
    v_just := 'Empurrada automaticamente por: '
              || coalesce(nullif((select titulo from public.pm_tasks where id = p_empurrada_por), ''),
                          'outra tarefa');
  else
    v_just := trim(coalesce(p_justificacao, ''));
    if v_just = '' then raise exception 'A justificação é obrigatória.'; end if;
  end if;

  if p_inicio is not null and p_fim is not null and p_fim < p_inicio then
    raise exception 'O fim não pode ser antes do início.';
  end if;

  if p_inicio is distinct from v_ini then
    insert into public.pm_comments (task_id, autor_id, tipo, campo, texto, de_data, para_data)
    values (p_task, auth.uid(), 'datas', 'inicio', v_just, v_ini, p_inicio);
  end if;
  if p_fim is distinct from v_fim then
    insert into public.pm_comments (task_id, autor_id, tipo, campo, texto, de_data, para_data)
    values (p_task, auth.uid(), 'datas', 'fim', v_just, v_fim, p_fim);
  end if;

  /* A bandeira que deixa passar os gatilhos também trava o que fixa a linha de
     base, por isso trata-se dela aqui. Numa tarefa que ainda não tinha linha de
     base, o plano era o fim que lá estava: é esse que se guarda, senão a
     derrapagem que estamos a criar desaparecia. */
  v_nova_base := coalesce(v_prev, v_fim, p_fim);

  perform set_config('pm.replanear', '1', true);
  update public.pm_tasks
     set inicio = p_inicio, fim = p_fim, fim_previsto = v_nova_base
   where id = p_task;
  perform set_config('pm.replanear', '0', true);
end;
$$;


-- ----------------------------------------------------------------------------
-- 5b. Gravar e alterar orçamentos — deixa sempre registo
-- ----------------------------------------------------------------------------
-- Passar p_valor a null retira o orçamento e a marca de custo.
create or replace function public.pm_definir_orcamento(
  p_task uuid, p_valor numeric, p_justificacao text
) returns void language plpgsql security definer set search_path = public as $$
declare v_antigo numeric(12,2);
begin
  -- SECURITY DEFINER passa por cima do RLS: o papel confere-se aqui dentro.
  select custo_previsto into v_antigo from public.pm_tasks where id = p_task;
  if not found then raise exception 'A tarefa não existe.'; end if;
  -- Gravar o primeiro orçamento é de quem tem escrita completa; mexer num que
  -- já lá está é só do super admin. Justificação, em qualquer dos casos.
  if v_antigo is null then
    if not public.pode_escrever('projetos') then
      raise exception 'O teu acesso não permite definir custos.';
    end if;
  elsif not public.e_admin('projetos') then
    raise exception 'Só um super admin pode alterar um orçamento já definido.';
  end if;
  if coalesce(trim(p_justificacao),'') = '' then
    raise exception 'A justificação é obrigatória.';
  end if;
  if p_valor is not null and p_valor < 0 then
    raise exception 'O orçamento não pode ser negativo.';
  end if;
  if p_valor is not distinct from v_antigo then
    raise exception 'O valor é o mesmo que já lá estava.';
  end if;

  insert into public.pm_comments (task_id, autor_id, tipo, texto, de_valor, para_valor)
  values (p_task, auth.uid(), 'orcamento', p_justificacao, v_antigo, p_valor);

  perform set_config('pm.replanear', '1', true);
  update public.pm_tasks
     set custo_previsto = p_valor,
         tem_custo = case when p_valor is null then false else true end
   where id = p_task;
  perform set_config('pm.replanear', '0', true);
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
alter table public.pm_empresas       enable row level security;
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
-- Criar: editor parcial para cima. Criar um projeto não desfaz nada.
drop policy if exists proj_criar on public.pm_projects;
create policy proj_criar on public.pm_projects for insert
  with check (pode_criar('projetos') and (owner_id is null or owner_id = auth.uid()));
-- Alterar (nome, empresa, cor, arquivar): só escrita completa. Renomear um
-- projeto muda-o para toda a gente, e é aí que se traça a linha.
drop policy if exists proj_alterar on public.pm_projects;
create policy proj_alterar on public.pm_projects for update
  using (pode_escrever('projetos') and (owner_id is null or owner_id = auth.uid()))
  with check (pode_escrever('projetos') and (owner_id is null or owner_id = auth.uid()));
drop policy if exists proj_apagar on public.pm_projects;
create policy proj_apagar on public.pm_projects for delete
  using (pode_escrever('projetos') and (owner_id is null or owner_id = auth.uid()));

-- Empresas: mesma linha que os projetos. Criar uma empresa não desfaz nada,
-- por isso o editor parcial cria. Renomear ou arquivar muda o que toda a
-- gente vê, por isso é só escrita completa. Não se apagam: uma empresa que
-- fechou arquiva-se, para os projetos antigos dela continuarem a fazer sentido.
drop policy if exists emp_ler on public.pm_empresas;
create policy emp_ler on public.pm_empresas for select using (tem_area('projetos'));
drop policy if exists emp_criar on public.pm_empresas;
create policy emp_criar on public.pm_empresas for insert with check (pode_criar('projetos'));
drop policy if exists emp_alterar on public.pm_empresas;
create policy emp_alterar on public.pm_empresas for update
  using (pode_escrever('projetos')) with check (pode_escrever('projetos'));

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
-- Criar e alterar: editor parcial para cima (as datas ficam travadas no gatilho).
drop policy if exists tar_escrever on public.pm_tasks;
drop policy if exists tar_criar on public.pm_tasks;
create policy tar_criar on public.pm_tasks for insert
  with check (pode_criar('projetos') and pm_projeto_visivel(project_id, owner_id));
drop policy if exists tar_alterar on public.pm_tasks;
create policy tar_alterar on public.pm_tasks for update
  using (pode_criar('projetos') and pm_projeto_visivel(project_id, owner_id))
  with check (pode_criar('projetos') and pm_projeto_visivel(project_id, owner_id));
-- Apagar: só escrita completa.
drop policy if exists tar_apagar on public.pm_tasks;
create policy tar_apagar on public.pm_tasks for delete
  using (pode_escrever('projetos') and pm_projeto_visivel(project_id, owner_id));

-- Tabelas dependentes: seguem a visibilidade da tarefa.
drop policy if exists atr_ler on public.pm_task_assignees;
create policy atr_ler on public.pm_task_assignees for select
  using (exists (select 1 from public.pm_tasks t where t.id = task_id));
drop policy if exists atr_escrever on public.pm_task_assignees;
create policy atr_escrever on public.pm_task_assignees for all
  using (pode_criar('projetos') and exists (select 1 from public.pm_tasks t where t.id = task_id))
  with check (pode_criar('projetos') and exists (select 1 from public.pm_tasks t where t.id = task_id));

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
  with check (pode_comentar('projetos') and autor_id = auth.uid()
              and tipo = 'comentario'
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
drop policy if exists anx_criar on public.pm_attachments;
create policy anx_criar on public.pm_attachments for insert
  with check (pode_criar('projetos'));
drop policy if exists anx_apagar on public.pm_attachments;
create policy anx_apagar on public.pm_attachments for delete
  using (pode_escrever('projetos'));

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
