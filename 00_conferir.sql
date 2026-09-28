-- Conferir o que já está aplicado. Cola no SQL Editor do Supabase e corre.
select
  to_regclass('public.pm_task_log')  is not null as "histórico",
  to_regprocedure('public.pm_apagar_tarefa(uuid,text)') is not null as "reciclagem",
  to_regprocedure('public.pm_marcar_conclusao()')       is not null as "data de conclusão",
  (select count(*) = 0 from pg_policies
    where schemaname='public' and tablename='pm_tasks' and cmd='DELETE')   as "tarefas protegidas",
  (select pg_get_functiondef(p.oid) ilike '%pode_criar%'
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='pm_alterar_datas')             as "editores editam datas",
  (select role from public.app_access a join public.profiles pr on pr.id=a.user_id
    where pr.email='davyd.ventura@riocapital.pt' and a.area='projetos')    as "papel do Davyd";
