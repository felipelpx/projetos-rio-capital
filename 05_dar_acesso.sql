-- ============================================================================
-- Rio Capital — pessoas e acessos
--
-- A conta cria-se antes, no painel: Authentication → Users → Add user →
-- Create new user, com uma palavra-passe inicial e o *Auto Confirm User*
-- ligado. Este ficheiro dá-lhe o nome e o papel.
--
-- Pode correr as vezes que forem precisas: atualiza quem já lá está e não
-- duplica ninguém. Para mudar o papel de alguém, muda na lista e corre outra vez.
--
-- É tudo uma instrução só, de propósito: o editor SQL do Supabase não guarda
-- tabelas temporárias entre instruções.
-- ============================================================================
--
-- Os quatro papéis:
--
--   'admin'     Super admin     tudo, incluindo repor a data prevista com
--                               justificação e dar acesso a pessoas
--   'interact'  Editor          cria e altera tarefas, mexe em datas e
--                               dependências, apaga
--   'contrib'   Editor parcial  cria e altera tarefas e comenta;
--                               NÃO mexe em datas nem apaga nada
--   'view'      Visualizador    vê o quadro e comenta
--
-- ============================================================================

with equipa (email, nome, papel) as (

  -- >>> A LISTA. Uma linha por pessoa. É só aqui que se mexe. <<<
  values
    ('juliana@riocapital.pt',       'Juliana Dornelles', 'admin'),
    ('felipe@riocapital.pt',        'Felipe',            'admin'),
    ('info@cmsi.pt',                'Julia',             'interact'),
    ('davyd.ventura@riocapital.pt', 'Davyd Ventura',     'contrib'),
    ('henrique@riocapital.pt',      'Henrique',          'view'),
    ('marcelo@riocapital.pt',       'Marcelo',           'view')

),

-- Quem da lista já tem conta no Supabase.
alvo as (
  select u.id, u.email, e.nome, e.papel
  from auth.users u
  join equipa e on lower(u.email) = lower(e.email)
),

-- Cria o perfil que falte e acerta o nome de quem já lá está. (O perfil
-- passa a criar-se sozinho no primeiro login, mas com o nome tirado do
-- email; é aqui que fica o nome a sério.)
perfis as (
  insert into public.profiles (id, nome, email)
  select id, nome, email from alvo
  on conflict (id) do update set nome = excluded.nome
  returning id
),

-- E o acesso à área de projetos, com o papel de cada um.
acessos as (
  insert into public.app_access (user_id, area, role)
  select id, 'projetos', papel from alvo
  on conflict (user_id, area) do update set role = excluded.role
  returning user_id
)

-- Quem está na lista mas ainda não tem conta: criar no painel e correr outra vez.
select e.email as "SEM CONTA — criar no painel primeiro"
from equipa e
where not exists (select 1 from auth.users u where lower(u.email) = lower(e.email));


-- ----------------------------------------------------------------------------
-- Conferir: quem tem o quê.
-- ----------------------------------------------------------------------------
select
  p.nome,
  p.email,
  case a.role
    when 'admin'    then 'Super admin'
    when 'interact' then 'Editor'
    when 'contrib'  then 'Editor parcial'
    when 'view'     then 'Visualizador'
    else coalesce(a.role, '— sem acesso —')
  end as papel
from public.profiles p
left join public.app_access a on a.user_id = p.id and a.area = 'projetos'
order by
  case a.role when 'admin' then 1 when 'interact' then 2
              when 'contrib' then 3 when 'view' then 4 else 5 end,
  p.nome;
