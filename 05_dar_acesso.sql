-- ============================================================================
-- Rio Capital — pessoas e acessos
--
-- A conta cria-se antes, no painel: Authentication → Users → Add user →
-- Create new user, com uma palavra-passe inicial e o *Auto Confirm User*
-- ligado. Este ficheiro dá-lhe o nome e o papel.
--
-- Pode correr as vezes que forem precisas: atualiza quem já lá está e não
-- duplica ninguém. Para mudar o papel de alguém, muda aqui e corre outra vez.
-- ============================================================================

-- Os quatro papéis:
--
--   'admin'     Super admin     tudo, incluindo repor a data prevista com
--                               justificação e dar acesso a pessoas
--   'interact'  Editor          cria e altera tarefas, mexe em datas e
--                               dependências, apaga
--   'contrib'   Editor parcial  cria e altera tarefas e comenta;
--                               NÃO mexe em datas nem apaga nada
--   'view'      Visualizador    vê o quadro e comenta

begin;

create temporary table _equipa (email text, nome text, papel text) on commit drop;

-- >>> A LISTA. Uma linha por pessoa. <<<
insert into _equipa (email, nome, papel) values
  ('juliana@riocapital.pt',       'Juliana Dornelles', 'admin'),
  ('felipe@riocapital.pt',        'Felipe',            'admin'),
  ('info@cmsi.pt',                'Julia',             'interact'),
  ('davyd.ventura@riocapital.pt', 'Davyd Ventura',     'contrib'),
  ('henrique@riocapital.pt',      'Henrique',          'view'),
  ('marcelo@riocapital.pt',       'Marcelo',           'view');


-- 1) Perfis --------------------------------------------------------------------
-- Cria o que falta e acerta o nome de quem já lá está. (A partir do
-- 01_schema.sql o perfil passa a criar-se sozinho no primeiro login, mas com o
-- nome tirado do email; é aqui que fica o nome a sério.)
insert into public.profiles (id, nome, email)
select u.id, e.nome, u.email
from auth.users u
join _equipa e on lower(u.email) = lower(e.email)
on conflict (id) do update set nome = excluded.nome;


-- 2) Acessos -------------------------------------------------------------------
insert into public.app_access (user_id, area, role)
select u.id, 'projetos', e.papel
from auth.users u
join _equipa e on lower(u.email) = lower(e.email)
on conflict (user_id, area) do update set role = excluded.role;


-- 3) Quem ficou de fora ---------------------------------------------------------
-- Estes emails estão na lista mas não têm conta no Supabase. Criar a conta
-- primeiro (Authentication → Users → Add user) e correr isto outra vez.
select e.email as "sem conta — criar no painel"
from _equipa e
where not exists (select 1 from auth.users u where lower(u.email) = lower(e.email));


-- 4) Conferir -------------------------------------------------------------------
select
  p.email,
  p.nome,
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

commit;
