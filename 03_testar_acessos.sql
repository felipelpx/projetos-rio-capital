-- ============================================================================
-- Rio Capital — conferir os quatro papéis
--
-- Correr no SQL Editor do Supabase DEPOIS do 01 e do 02, e antes de dar acesso
-- a alguém de fora. Cria três utilizadores de teste, experimenta o que cada um
-- consegue fazer, e apaga-se a si próprio no fim.
--
-- Cada bloco imprime "OK" ou "FALHA". Se aparecer uma FALHA, não avançar.
-- São 35 verificações, sobre os quatro papéis.
--
-- Em Supabase corre-se tudo de uma vez (Run). O `set request.jwt.claim.sub`
-- finge que somos cada um dos utilizadores.
-- ============================================================================

begin;

-- Utilizadores de teste ------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-a000-000000000001','teste-super@exemplo.invalid'),
  ('00000000-0000-4000-a000-000000000002','teste-editor@exemplo.invalid'),
  ('00000000-0000-4000-a000-000000000003','teste-visual@exemplo.invalid')
on conflict (id) do nothing;

insert into public.profiles (id, nome, email) values
  ('00000000-0000-4000-a000-000000000001','Teste Super','teste-super@exemplo.invalid'),
  ('00000000-0000-4000-a000-000000000002','Teste Editor','teste-editor@exemplo.invalid'),
  ('00000000-0000-4000-a000-000000000003','Teste Visual','teste-visual@exemplo.invalid')
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('00000000-0000-4000-a000-000000000004','teste-parcial@exemplo.invalid')
on conflict (id) do nothing;
insert into public.profiles (id, nome, email) values
  ('00000000-0000-4000-a000-000000000004','Teste Parcial','teste-parcial@exemplo.invalid')
on conflict (id) do nothing;

insert into public.app_access (user_id, area, role) values
  ('00000000-0000-4000-a000-000000000001','projetos','admin'),
  ('00000000-0000-4000-a000-000000000002','projetos','interact'),
  ('00000000-0000-4000-a000-000000000003','projetos','view'),
  ('00000000-0000-4000-a000-000000000004','projetos','contrib')
on conflict (user_id, area) do update set role = excluded.role;

-- Resultados -----------------------------------------------------------------
create temporary table _res (ordem int, o_que text, resultado text);
grant all on _res to authenticated;
grant usage on schema public to authenticated;

create or replace function public.__criar_alvo() returns uuid
language sql as $f$
  insert into public.pm_tasks (titulo, status_id, inicio, fim)
  values ('__teste_acessos__', (select id from public.pm_statuses order by posicao limit 1),
          current_date, current_date + 10)
  returning id;
$f$;

-- A tarefa de trabalho cria-se como dono das tabelas.
create temporary table _alvo as
select public.__criar_alvo() as id;
grant all on _alvo to authenticated;

-- A PARTIR DAQUI corre-se como 'authenticated'. Sem isto o teste não vale nada:
-- o dono das tabelas passa por cima do RLS e passava tudo.
set local role authenticated;

do $$
declare
  v_super uuid := '00000000-0000-4000-a000-000000000001';
  v_edit  uuid := '00000000-0000-4000-a000-000000000002';
  v_view  uuid := '00000000-0000-4000-a000-000000000003';
  v_parc  uuid := '00000000-0000-4000-a000-000000000004';
  v_task  uuid;
  v_ok    boolean;
  v_erro  text;
  n       int := 0;
begin
  select id into v_task from _alvo;

  ---------------------------------------------------------------- visualizador
  perform set_config('request.jwt.claim.sub', v_view::text, true);

  begin
    insert into public.pm_tasks (titulo, status_id)
    values ('__nao_devia__', (select id from public.pm_statuses order by posicao limit 1));
    n := n + 1; insert into _res (ordem, o_que, resultado) values (n, 'Visualizador NÃO cria tarefas', 'FALHA — criou');
  exception when insufficient_privilege or others then
    n := n + 1; insert into _res (ordem, o_que, resultado) values (n, 'Visualizador NÃO cria tarefas', 'OK');
  end;

  begin
    update public.pm_tasks set titulo = '__mexido__' where id = v_task;
    if found then
      n := n + 1; insert into _res (ordem, o_que, resultado) values (n, 'Visualizador NÃO altera tarefas', 'FALHA — alterou');
    else
      n := n + 1; insert into _res (ordem, o_que, resultado) values (n, 'Visualizador NÃO altera tarefas', 'OK');
    end if;
  exception when others then
    n := n + 1; insert into _res (ordem, o_que, resultado) values (n, 'Visualizador NÃO altera tarefas', 'OK');
  end;

  begin
    insert into public.pm_comments (task_id, autor_id, texto)
    values (v_task, v_view, 'o visualizador comenta');
    n := n + 1; insert into _res (ordem, o_que, resultado) values (n, 'Visualizador comenta', 'OK');
  exception when others then
    n := n + 1; insert into _res (ordem, o_que, resultado) values (n, 'Visualizador comenta', 'FALHA — recusado');
  end;

  ------------------------------------------------------------- editor parcial
  perform set_config('request.jwt.claim.sub', v_parc::text, true);

  begin
    update public.pm_tasks set tem_custo = true where id = v_task;
    n := n + 1; insert into _res (ordem, o_que, resultado)
    values (n, 'Editor parcial NÃO mexe em custos', 'FALHA — mexeu');
  exception when others then
    n := n + 1; insert into _res (ordem, o_que, resultado)
    values (n, 'Editor parcial NÃO mexe em custos', 'OK');
  end;

  begin
    insert into public.pm_tasks (titulo, status_id)
    values ('__parcial__', (select id from public.pm_statuses order by posicao limit 1));
    n := n + 1; insert into _res (ordem, o_que, resultado) values (n, 'Editor parcial cria tarefas', 'OK');
  exception when others then
    n := n + 1; insert into _res (ordem, o_que, resultado) values (n, 'Editor parcial cria tarefas', 'FALHA — recusado');
  end;

  begin
    update public.pm_tasks set fim = current_date + 99 where id = v_task;
    n := n + 1; insert into _res (ordem, o_que, resultado)
    values (n, 'Editor parcial NÃO altera datas já marcadas', 'FALHA — mexeu');
  exception when others then
    n := n + 1; insert into _res (ordem, o_que, resultado)
    values (n, 'Editor parcial NÃO altera datas já marcadas', 'OK');
  end;

  begin
    insert into public.pm_tasks (titulo, status_id, inicio, fim)
    values ('__datas_parcial__', (select id from public.pm_statuses order by posicao limit 1),
            current_date, current_date + 5);
    n := n + 1; insert into _res (ordem, o_que, resultado)
    values (n, 'Editor parcial marca datas ao criar a tarefa',
            case when exists (select 1 from public.pm_tasks
                               where titulo = '__datas_parcial__' and fim = current_date + 5)
                 then 'OK' else 'FALHA — não gravou' end);
  exception when others then
    get stacked diagnostics v_erro = message_text;
    n := n + 1; insert into _res (ordem, o_que, resultado)
    values (n, 'Editor parcial marca datas ao criar a tarefa', 'FALHA — ' || left(v_erro, 40));
  end;

  begin
    update public.pm_tasks set fim = current_date + 9 where titulo = '__datas_parcial__';
    n := n + 1; insert into _res (ordem, o_que, resultado)
    values (n, 'Editor parcial NÃO volta atrás na data que pôs', 'FALHA — mexeu');
  exception when others then
    n := n + 1; insert into _res (ordem, o_que, resultado)
    values (n, 'Editor parcial NÃO volta atrás na data que pôs', 'OK');
  end;

  begin
    delete from public.pm_tasks where titulo = '__parcial__';
    if found then
      n := n + 1; insert into _res (ordem, o_que, resultado)
      values (n, 'Editor parcial NÃO apaga', 'FALHA — apagou');
    else
      n := n + 1; insert into _res (ordem, o_que, resultado)
      values (n, 'Editor parcial NÃO apaga', 'OK');
    end if;
  exception when others then
    n := n + 1; insert into _res (ordem, o_que, resultado) values (n, 'Editor parcial NÃO apaga', 'OK');
  end;

  begin
    insert into public.pm_empresas (nome) values ('__emp_parcial__');
    n := n + 1; insert into _res (ordem, o_que, resultado)
    values (n, 'Editor parcial cria empresas', 'OK');
  exception when others then
    n := n + 1; insert into _res (ordem, o_que, resultado)
    values (n, 'Editor parcial cria empresas', 'FALHA — recusado');
  end;

  begin
    update public.pm_empresas set nome = '__mexida__' where nome = '__emp_parcial__';
    if found then
      n := n + 1; insert into _res (ordem, o_que, resultado)
      values (n, 'Editor parcial NÃO renomeia empresas', 'FALHA — renomeou');
    else
      n := n + 1; insert into _res (ordem, o_que, resultado)
      values (n, 'Editor parcial NÃO renomeia empresas', 'OK');
    end if;
  exception when others then
    n := n + 1; insert into _res (ordem, o_que, resultado)
    values (n, 'Editor parcial NÃO renomeia empresas', 'OK');
  end;

  --------------------------------------------------------------------- editor
  perform set_config('request.jwt.claim.sub', v_edit::text, true);

  begin
    update public.pm_empresas set arquivada = true where nome = '__emp_parcial__';
    n := n + 1; insert into _res (ordem, o_que, resultado)
    values (n, 'Editor arquiva empresas', case when found then 'OK' else 'FALHA — não conseguiu' end);
  exception when others then
    n := n + 1; insert into _res (ordem, o_que, resultado)
    values (n, 'Editor arquiva empresas', 'FALHA — recusado');
  end;

  begin
    delete from public.pm_empresas where nome = '__emp_parcial__';
    if found then
      n := n + 1; insert into _res (ordem, o_que, resultado)
      values (n, 'Ninguém apaga empresas', 'FALHA — apagou');
    else
      n := n + 1; insert into _res (ordem, o_que, resultado)
      values (n, 'Ninguém apaga empresas', 'OK');
    end if;
  exception when others then
    n := n + 1; insert into _res (ordem, o_que, resultado) values (n, 'Ninguém apaga empresas', 'OK');
  end;

  begin
    update public.pm_tasks set fim = current_date + 20 where id = v_task;
    n := n + 1; insert into _res (ordem, o_que, resultado)
    values (n, 'Editor NÃO muda datas sem justificação', 'FALHA — mudou');
  exception when others then
    n := n + 1; insert into _res (ordem, o_que, resultado)
    values (n, 'Editor NÃO muda datas sem justificação', 'OK');
  end;

  begin
    perform public.pm_alterar_datas(v_task, current_date, current_date + 20, 'obra atrasou-se');
    n := n + 1; insert into _res (ordem, o_que, resultado)
    values (n, 'Editor NÃO altera datas, nem com justificação', 'FALHA — alterou');
  exception when others then
    n := n + 1; insert into _res (ordem, o_que, resultado)
    values (n, 'Editor NÃO altera datas, nem com justificação', 'OK');
  end;

  begin
    perform public.pm_alterar_datas(v_task, current_date, current_date + 30, null,
                                    '00000000-0000-4000-a000-0000000000ff');
    n := n + 1; insert into _res (ordem, o_que, resultado)
    values (n, 'Cascata falsa é recusada', 'FALHA — passou');
  exception when others then
    n := n + 1; insert into _res (ordem, o_que, resultado)
    values (n, 'Cascata falsa é recusada', 'OK');
  end;

  begin
    perform public.pm_repor_fim_previsto(v_task, 'tentativa do editor');
    n := n + 1; insert into _res (ordem, o_que, resultado) values (n, 'Editor NÃO repõe a data prevista', 'FALHA — conseguiu repor');
  exception when others then
    get stacked diagnostics v_erro = message_text;
    n := n + 1; insert into _res (ordem, o_que, resultado) values (n, 'Editor NÃO repõe a data prevista', 'OK (' || left(v_erro, 40) || ')');
  end;

  begin
    insert into public.app_access (user_id, area, role)
    values (v_view, 'projetos', 'admin')
    on conflict (user_id, area) do update set role = 'admin';
    n := n + 1; insert into _res (ordem, o_que, resultado) values (n, 'Editor NÃO dá acessos', 'FALHA — deu');
  exception when others then
    n := n + 1; insert into _res (ordem, o_que, resultado) values (n, 'Editor NÃO dá acessos', 'OK');
  end;

  begin
    update public.pm_tasks set custo_previsto = 1000, tem_custo = true where id = v_task;
    n := n + 1; insert into _res (ordem, o_que, resultado)
    values (n, 'Orçamento SEM justificação é recusado (directo)', 'FALHA — gravou');
  exception when others then
    n := n + 1; insert into _res (ordem, o_que, resultado)
    values (n, 'Orçamento SEM justificação é recusado (directo)', 'OK');
  end;

  begin
    perform public.pm_definir_orcamento(v_task, 1000, 'orçamento inicial do empreiteiro');
    n := n + 1; insert into _res (ordem, o_que, resultado)
    values (n, 'Editor grava o primeiro orçamento, com justificação',
            case when (select custo_previsto from public.pm_tasks where id = v_task) = 1000
                 then 'OK' else 'FALHA — não gravou' end);
  exception when others then
    get stacked diagnostics v_erro = message_text;
    n := n + 1; insert into _res (ordem, o_que, resultado)
    values (n, 'Editor grava o primeiro orçamento, com justificação', 'FALHA — ' || left(v_erro, 40));
  end;

  begin
    update public.pm_tasks set custo_previsto = 9999 where id = v_task;
    n := n + 1; insert into _res (ordem, o_que, resultado)
    values (n, 'Editor NÃO altera um orçamento já posto', 'FALHA — alterou');
  exception when others then
    n := n + 1; insert into _res (ordem, o_que, resultado)
    values (n, 'Editor NÃO altera um orçamento já posto', 'OK');
  end;

  begin
    perform public.pm_definir_orcamento(v_task, 9999, 'tentativa de editor');
    n := n + 1; insert into _res (ordem, o_que, resultado)
    values (n, 'Editor NÃO altera pela função o que já está gravado', 'FALHA — usou');
  exception when others then
    n := n + 1; insert into _res (ordem, o_que, resultado)
    values (n, 'Editor NÃO altera pela função o que já está gravado', 'OK');
  end;

  ---------------------------------------------------------------- super admin
  perform set_config('request.jwt.claim.sub', v_super::text, true);

  begin
    perform public.pm_alterar_datas(v_task, current_date, current_date + 20, 'obra atrasou-se');
    n := n + 1; insert into _res (ordem, o_que, resultado)
    values (n, 'Super admin altera o fim real, com justificação',
            case when (select fim from public.pm_tasks where id = v_task) = current_date + 20
                 then 'OK' else 'FALHA — a data não mudou' end);
  exception when others then
    get stacked diagnostics v_erro = message_text;
    n := n + 1; insert into _res (ordem, o_que, resultado)
    values (n, 'Super admin altera o fim real, com justificação', 'FALHA — ' || left(v_erro, 40));
  end;

  begin
    perform public.pm_alterar_datas(v_task, current_date, current_date + 25, '   ');
    n := n + 1; insert into _res (ordem, o_que, resultado)
    values (n, 'Data SEM justificação é recusada', 'FALHA — passou');
  exception when others then
    n := n + 1; insert into _res (ordem, o_que, resultado)
    values (n, 'Data SEM justificação é recusada', 'OK');
  end;

  begin
    n := n + 1; insert into _res (ordem, o_que, resultado)
    values (n, 'A mudança de data deixou registo',
            case when exists (select 1 from public.pm_task_log
                               where task_id = v_task and tipo = 'campo' and campo = 'fim'
                                 and para = (current_date + 20)::text
                                 and texto = 'obra atrasou-se')
                 then 'OK' else 'FALHA — sem registo' end);
  end;

  begin
    perform public.pm_definir_orcamento(v_task, 2500, 'empreiteiro reviu o preço');
    n := n + 1; insert into _res (ordem, o_que, resultado)
    values (n, 'Super admin altera o orçamento',
            case when (select custo_previsto from public.pm_tasks where id = v_task) = 2500
                 then 'OK' else 'FALHA — o valor não mudou' end);
  exception when others then
    get stacked diagnostics v_erro = message_text;
    n := n + 1; insert into _res (ordem, o_que, resultado)
    values (n, 'Super admin altera o orçamento', 'FALHA — ' || left(v_erro, 40));
  end;

  begin
    perform public.pm_definir_orcamento(v_task, 10, '  ');
    n := n + 1; insert into _res (ordem, o_que, resultado)
    values (n, 'Orçamento SEM justificação é recusado', 'FALHA — passou');
  exception when others then
    n := n + 1; insert into _res (ordem, o_que, resultado)
    values (n, 'Orçamento SEM justificação é recusado', 'OK');
  end;

  begin
    n := n + 1; insert into _res (ordem, o_que, resultado)
    values (n, 'A alteração do orçamento deixou registo',
            case when exists (select 1 from public.pm_task_log
                               where task_id = v_task and tipo = 'campo' and campo = 'custo_previsto'
                                 and de like '1000%' and para like '2500%')
                 then 'OK' else 'FALHA — sem registo' end);
  end;

  begin
    perform public.pm_repor_fim_previsto(v_task, 'replaneamento de teste');
    -- Não basta não dar erro: a data tem mesmo de ficar igual ao fim real.
    if (select fim_previsto = fim from public.pm_tasks where id = v_task) then
      n := n + 1; insert into _res (ordem, o_que, resultado) values (n, 'Super admin repõe a data prevista', 'OK');
    else
      n := n + 1; insert into _res (ordem, o_que, resultado)
      values (n, 'Super admin repõe a data prevista', 'FALHA — a data não mudou');
    end if;
  exception when others then
    get stacked diagnostics v_erro = message_text;
    n := n + 1; insert into _res (ordem, o_que, resultado) values (n, 'Super admin repõe a data prevista', 'FALHA — ' || left(v_erro, 40));
  end;

  begin
    perform public.pm_repor_fim_previsto(v_task, '   ');
    n := n + 1; insert into _res (ordem, o_que, resultado) values (n, 'Reposição SEM justificação é recusada', 'FALHA — passou');
  exception when others then
    n := n + 1; insert into _res (ordem, o_que, resultado) values (n, 'Reposição SEM justificação é recusada', 'OK');
  end;

  begin
    insert into public.app_access (user_id, area, role)
    values (v_view, 'erp', 'admin');
    n := n + 1; insert into _res (ordem, o_que, resultado) values (n, 'Super admin dos projetos NÃO toca no ERP', 'FALHA — deu acesso ao ERP');
  exception when others then
    n := n + 1; insert into _res (ordem, o_que, resultado) values (n, 'Super admin dos projetos NÃO toca no ERP', 'OK');
  end;

  -- o registo do replaneamento ficou?
  select exists (
    select 1 from public.pm_task_log
    where task_id = v_task and tipo = 'campo' and campo = 'fim_previsto'
      and texto = 'replaneamento de teste'
  ) into v_ok;
  n := n + 1; insert into _res (ordem, o_que, resultado) values (n, 'A reposição deixou registo no histórico', case when v_ok then 'OK' else 'FALHA' end);

  -- e o histórico apanha o que ninguém mandou apanhar: um título mudado à mão
  begin
    update public.pm_tasks set titulo = '__renomeada__' where id = v_task;
    select exists (
      select 1 from public.pm_task_log
      where task_id = v_task and tipo = 'campo' and campo = 'titulo' and para = '__renomeada__'
    ) into v_ok;
    n := n + 1; insert into _res (ordem, o_que, resultado)
    values (n, 'O histórico apanha alterações comuns', case when v_ok then 'OK' else 'FALHA — sem registo' end);
  end;

  -- ninguém escreve no histórico à mão, nem o super admin
  begin
    insert into public.pm_task_log (task_id, autor_id, tipo, texto)
    values (v_task, v_super, 'campo', 'inventado');
    n := n + 1; insert into _res (ordem, o_que, resultado)
    values (n, 'Ninguém escreve no histórico à mão', 'FALHA — escreveu');
  exception when others then
    n := n + 1; insert into _res (ordem, o_que, resultado)
    values (n, 'Ninguém escreve no histórico à mão', 'OK');
  end;

  begin
    delete from public.pm_task_log where task_id = v_task;
    if found then
      n := n + 1; insert into _res (ordem, o_que, resultado)
      values (n, 'Ninguém apaga o histórico', 'FALHA — apagou');
    else
      n := n + 1; insert into _res (ordem, o_que, resultado)
      values (n, 'Ninguém apaga o histórico', 'OK');
    end if;
  exception when others then
    n := n + 1; insert into _res (ordem, o_que, resultado) values (n, 'Ninguém apaga o histórico', 'OK');
  end;

  perform set_config('request.jwt.claim.sub', '', true);
end $$;

reset role;
-- Limpar tudo o que o teste criou, para poder correr as vezes que forem
-- precisas. O '__renomeada__' é a tarefa alvo, que um dos testes renomeia.
delete from public.pm_tasks where titulo in
  ('__teste_acessos__','__nao_devia__','__mexido__','__parcial__',
   '__renomeada__','__datas_parcial__');
delete from public.pm_empresas where nome in ('__emp_parcial__','__mexida__');

select o_que as "o que se testou", resultado from _res order by ordem;

-- ----------------------------------------------------------------------------
-- O teste do financeiro tem de ser feito à mão, porque só tu sabes os nomes
-- das tabelas do ERP. Com a sessão do utilizador de teste:
--
--   set request.jwt.claim.sub = '00000000-0000-4000-a000-000000000003';
--   select count(*) from public.<tabela financeira>;   -- tem de dar 0
--
-- Se der mais do que zero, falta a política dessa tabela (ver PARA_O_FELIPE.md).
-- ----------------------------------------------------------------------------

drop function if exists public.__criar_alvo();

-- Limpar os utilizadores de teste.
delete from public.app_access where user_id::text like '00000000-0000-4000-a000-00000000000%';
delete from public.profiles   where id::text      like '00000000-0000-4000-a000-00000000000%';
delete from auth.users        where id::text      like '00000000-0000-4000-a000-00000000000%';

commit;
