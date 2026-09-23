-- ============================================================================
-- Rio Capital — dar acesso a pessoas
--
-- Trocar os emails pelos verdadeiros e correr no SQL Editor.
--
-- A conta cria-se antes, no painel: Authentication → Users → Add user →
-- Create new user, com uma palavra-passe inicial e o *Auto Confirm User*
-- ligado. Este ficheiro só dá a área de projetos a quem já tem conta.
--
-- Pode correr as vezes que forem precisas: muda o papel de quem já lá está,
-- não duplica ninguém.
-- ============================================================================

-- 1) Perfis em falta -----------------------------------------------------------
-- Quem entrou antes de o 01_schema.sql ser corrido não tem perfil, e sem perfil
-- não se consegue dar acesso. A partir de agora isto cria-se sozinho no primeiro
-- login; esta consulta só apanha os que ficaram para trás.
insert into public.profiles (id, nome, email)
select
  u.id,
  coalesce(
    nullif(trim(u.raw_user_meta_data->>'name'), ''),
    nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
    split_part(u.email, '@', 1)
  ),
  u.email
from auth.users u
on conflict (id) do nothing;


-- 2) Os acessos ---------------------------------------------------------------
-- Papéis:  'admin'    Super admin  — tudo, incluindo repor a data prevista
--                                    e dar acesso a outras pessoas
--          'interact' Editor       — cria e altera tarefas; não repõe a data
--                                    prevista nem gere acessos
--          'view'     Visualizador — vê e não mexe
--
insert into public.app_access (user_id, area, role)
select u.id, 'projetos', v.papel
from auth.users u
join (values
  ('felipe@riocapital.pt',  'admin'),
  ('juliana@riocapital.pt', 'admin')
  -- Acrescentar o resto da equipa aqui, uma linha por pessoa:
  -- ('outra.pessoa@riocapital.pt', 'interact'),
  -- ('mais.alguem@riocapital.pt',  'view')
) as v(email, papel) on lower(u.email) = lower(v.email)
on conflict (user_id, area) do update set role = excluded.role;


-- 3) Conferir ------------------------------------------------------------------
select
  p.email,
  p.nome,
  case a.role
    when 'admin'    then 'Super admin'
    when 'interact' then 'Editor'
    when 'view'     then 'Visualizador'
    else coalesce(a.role, '— sem acesso —')
  end as papel
from public.profiles p
left join public.app_access a on a.user_id = p.id and a.area = 'projetos'
order by a.role nulls last, p.email;

-- Se alguém aparecer com "— sem acesso —", ou o email está escrito de outra
-- forma na lista acima, ou essa pessoa ainda não entrou uma primeira vez.
