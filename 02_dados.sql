-- ============================================================================
-- Rio Capital — dados atuais do quadro de projetos
-- Exportado de https://claude.ai/artifact/YVTXxhzViKSciRycTahEhf
-- 7 projetos, 37 tarefas, 14 dependências. Correr DEPOIS de 01_schema.sql.
--
-- Os ids de origem ficam guardados em pm_projects.id_origem / pm_tasks.id_origem,
-- para se poder repetir a importação sem duplicar e para conferir contra o quadro antigo.
--
-- Testado contra PostgreSQL 16 antes de sair daqui. Sem dependências desrespeitadas.
-- ============================================================================

alter table public.pm_projects add column if not exists id_origem text unique;
alter table public.pm_tasks    add column if not exists id_origem text unique;

begin;

-- Colunas do quadro ----------------------------------------------------------
insert into public.pm_statuses (id,label,color,posicao,conta_concluido,conta_por_iniciar) values
  ('todo','Por fazer','#7C8B99',1000,false,true),
  ('doing','Em curso','#2F86C4',2000,false,false),
  ('waiting','À espera de terceiros','#6C5AB5',2500,false,false),
  ('review','Em revisão','#C68A1B',3000,false,false),
  ('done','Concluído','#3D9668',4000,true,false)
on conflict (id) do nothing;

-- Empresas -------------------------------------------------------------------
-- Criadas antes dos projetos, para o projeto entrar já ligado à empresa.
insert into public.pm_empresas (nome)
select v.nome from (values
  ('Ocean Sesimbra'),
  ('Without Delays'),
  ('Alternative Shadow'),
  ('Classic Revelation'),
  ('Crunchy Prophecy'),
  ('Chromatic Parcel'),
  ('Modernity')
) as v(nome)
where not exists (
  select 1 from public.pm_empresas e where lower(e.nome) = lower(v.nome)
);

-- Projetos -------------------------------------------------------------------
insert into public.pm_projects (id_origem,nome,empresa_id,color,arquivado,criado_em) select
  v.id_origem, v.nome, e.id, v.color, v.arquivado, v.criado_em::timestamptz
from (values
  ('pr_fourpoints','Four Points by Sheraton, Sesimbra','Ocean Sesimbra','#3A72B8',false,'2026-09-21T09:00:00.000Z'),
  ('pr_braamcamp','Avenida Braamcamp','Without Delays','#1F8A6B',false,'2026-09-21T09:01:00.000Z'),
  ('pr_arroios','Arroios, Travessa das Amoreiras','Alternative Shadow','#C07A16',false,'2026-09-21T09:02:00.000Z'),
  ('pr_marinha','Marinha','Classic Revelation','#B24A42',false,'2026-09-21T09:03:00.000Z'),
  ('pr_sintra','Galpão Sintra','Crunchy Prophecy','#6C5AB5',false,'2026-09-21T09:04:00.000Z'),
  ('pr_benfica','Benfica, Calçada do Tojal','Chromatic Parcel','#0E8798',false,'2026-09-21T09:05:00.000Z'),
  ('pr_vistasul','Vistas do Sul','Modernity','#A5518E',false,'2026-09-21T09:06:00.000Z')
) as v(id_origem,nome,empresa,color,arquivado,criado_em)
join public.pm_empresas e on lower(e.nome) = lower(v.empresa)
on conflict (id_origem) do nothing;

-- Tarefas --------------------------------------------------------------------
insert into public.pm_tasks
  (id_origem,project_id,titulo,status_id,prioridade,inicio,fim,fim_previsto,progresso,notas,posicao,criado_em)
values
  ('fp_levant',(select id from public.pm_projects where id_origem='pr_fourpoints'),'Levantamento in loco + MQT','doing','alta','2026-08-03','2026-10-05','2026-10-05',40,'',1000,'2026-09-21T10:00:00.000Z'),
  ('fp_orcam',(select id from public.pm_projects where id_origem='pr_fourpoints'),'Orçamentos das construtoras','todo','media','2026-10-06','2026-11-07','2026-11-06',0,'',1000,'2026-09-21T10:01:00.000Z'),
  ('fp_analise',(select id from public.pm_projects where id_origem='pr_fourpoints'),'Análise/aprovação de orçamentos e adjudicação','todo','media','2026-11-08','2026-12-02','2026-11-30',0,'',2000,'2026-09-21T10:02:00.000Z'),
  ('fp_licenca',(select id from public.pm_projects where id_origem='pr_fourpoints'),'Licença de obra','todo','media',null,null,null,0,'Datas por definir. Verificar se é precisa licença de obra para estas obras internas.',3000,'2026-09-21T10:03:00.000Z'),
  ('fp_obra',(select id from public.pm_projects where id_origem='pr_fourpoints'),'Obra','todo','media',null,null,null,0,'Datas por definir. Não seguimos com o salão maior na primeira fase, por não ter projeto definido.',4000,'2026-09-21T10:04:00.000Z'),
  ('fp_otis',(select id from public.pm_projects where id_origem='pr_fourpoints'),'Orçamento da OTIS para pôr os 2 elevadores a funcionar','waiting','alta',null,null,null,0,'Vem das notas do relatório de setembro, não do cronograma.',1000,'2026-09-21T10:05:00.000Z'),
  ('br_cml',(select id from public.pm_projects where id_origem='pr_braamcamp'),'Aprovação CML e CCDR','waiting','alta','2026-09-07','2026-10-30','2026-10-30',30,'Reunião na CCDR agendada para 07/10. O Nuno conseguiu uma pessoa entre a CML e a CCDR que irá interferir a favor.',2000,'2026-09-21T10:06:00.000Z'),
  ('br_estim',(select id from public.pm_projects where id_origem='pr_braamcamp'),'Estimativa orçamental (Proj. Nuno)','doing','media','2026-09-15','2026-10-15','2026-10-15',30,'',2000,'2026-09-21T10:07:00.000Z'),
  ('br_caiado',(select id from public.pm_projects where id_origem='pr_braamcamp'),'Orçamento André Caiado (modificativo)','waiting','alta','2026-09-07','2026-09-21','2026-09-21',70,'Faltam receber os orçamentos de obra do projeto do Nuno, já pedidos.',3000,'2026-09-21T10:08:00.000Z'),
  ('br_exec',(select id from public.pm_projects where id_origem='pr_braamcamp'),'Projeto de execução e MQT','todo','media','2026-10-31','2026-12-01','2026-11-30',0,'',5000,'2026-09-21T10:09:00.000Z'),
  ('ar_hsp',(select id from public.pm_projects where id_origem='pr_arroios'),'Documentação HSP','done','media','2026-08-03','2026-08-28','2026-08-28',100,'',1000,'2026-09-21T10:10:00.000Z'),
  ('ar_licobra',(select id from public.pm_projects where id_origem='pr_arroios'),'Licença de obra','done','alta','2026-08-03','2026-10-05','2026-10-05',100,'Deferida. A aguardar o alvará IMPIC para juntar ao processo.',2000,'2026-09-21T10:11:00.000Z'),
  ('ar_impic',(select id from public.pm_projects where id_origem='pr_arroios'),'Alvará IMPIC','waiting','alta','2026-08-28','2026-09-28','2026-09-28',50,'Solicitado pelo Josué.',4000,'2026-09-21T10:12:00.000Z'),
  ('ar_orcloja',(select id from public.pm_projects where id_origem='pr_arroios'),'Orçamento, ajuste de lojas (Edson)','done','media','2026-09-14','2026-09-17','2026-09-17',100,'',3000,'2026-09-21T10:13:00.000Z'),
  ('ar_orclimp',(select id from public.pm_projects where id_origem='pr_arroios'),'Orçamento, limpeza','review','alta','2026-09-14','2026-10-08','2026-09-22',80,'Já foram apresentados 2 orçamentos: 250 € + IVA e 650 € + IVA.',1000,'2026-09-21T10:14:00.000Z'),
  ('ar_obras',(select id from public.pm_projects where id_origem='pr_arroios'),'Obras de ajuste da loja','doing','alta','2026-09-18','2026-09-23','2026-09-23',60,'',3000,'2026-09-21T10:15:00.000Z'),
  ('ar_limpeza',(select id from public.pm_projects where id_origem='pr_arroios'),'Limpeza pós-obra','todo','alta','2026-10-09','2026-10-10','2026-09-25',0,'Previsão de custo em setembro: 300 € (aprox.).',6000,'2026-09-21T10:16:00.000Z'),
  ('ar_licutil',(select id from public.pm_projects where id_origem='pr_arroios'),'Licença de utilização','todo','media','2026-10-05','2026-11-05','2026-11-05',0,'Previsão de custo em setembro — finalização da loja (vistoria cliente): 350 €.',7000,'2026-09-21T10:17:00.000Z'),
  ('ar_bernardo',(select id from public.pm_projects where id_origem='pr_arroios'),'Serviço de urgência no apartamento do Bernardo','doing','alta',null,null,null,0,'Orçamento feito entre o Edson e o Junior; o Junior apresentou 2.100 €. Previsão de custo em setembro: 1.000 €. Vem das notas do relatório, não do cronograma.',4000,'2026-09-21T10:18:00.000Z'),
  ('s6q2yyd7dtepktnhhn4i',(select id from public.pm_projects where id_origem='pr_arroios'),'A','todo','media',null,null,null,0,'',15000,'2026-09-22T16:07:11.115Z'),
  ('ma_lic',(select id from public.pm_projects where id_origem='pr_marinha'),'Aprovação de licença de obra','waiting','alta','2026-07-13','2026-09-30','2026-09-30',70,'Solicitámos à CMC o deferimento tácito do processo, visto que o prazo de resposta deles expirou.',5000,'2026-09-21T10:19:00.000Z'),
  ('ma_docs',(select id from public.pm_projects where id_origem='pr_marinha'),'Receber docs/projetos (Victor Vitorino)','waiting','alta','2026-07-13','2026-09-30','2026-09-30',60,'',6000,'2026-09-21T10:20:00.000Z'),
  ('ma_constr',(select id from public.pm_projects where id_origem='pr_marinha'),'Contacto com construtoras','doing','alta','2026-09-15','2026-09-30','2026-09-30',50,'A apresentar o projeto a construtoras interessadas.',5000,'2026-09-21T10:21:00.000Z'),
  ('ma_orc',(select id from public.pm_projects where id_origem='pr_marinha'),'Orçamento de obra','todo','media','2026-10-01','2026-10-30','2026-10-30',0,'',8000,'2026-09-21T10:22:00.000Z'),
  ('ma_adjud',(select id from public.pm_projects where id_origem='pr_marinha'),'Análise/aprovação e adjudicação','todo','media','2026-11-01','2026-11-30','2026-11-30',0,'',9000,'2026-09-21T10:23:00.000Z'),
  ('ma_demo',(select id from public.pm_projects where id_origem='pr_marinha'),'Demolição','todo','media','2026-12-05','2026-12-22','2026-12-22',0,'',10000,'2026-09-21T10:24:00.000Z'),
  ('ma_obra',(select id from public.pm_projects where id_origem='pr_marinha'),'Obra (18 meses)','todo','media','2027-01-05','2028-07-05','2028-07-05',0,'',11000,'2026-09-21T10:25:00.000Z'),
  ('ma_arqcontr',(select id from public.pm_projects where id_origem='pr_marinha'),'Contrato do arquiteto','waiting','media',null,null,null,0,'A aguardar o contrato do arquiteto. Vem das notas do relatório, não do cronograma.',7000,'2026-09-21T10:26:00.000Z'),
  ('gs_topo',(select id from public.pm_projects where id_origem='pr_sintra'),'Topografia','done','media','2026-09-10','2026-09-18','2026-09-18',100,'',4000,'2026-09-21T10:27:00.000Z'),
  ('gs_arq',(select id from public.pm_projects where id_origem='pr_sintra'),'Projeto arquitetónico (Arq. Carla)','doing','alta','2026-09-19','2026-10-01','2026-09-30',40,'Validar datas com a Arq. Carla.',6000,'2026-09-21T10:28:00.000Z'),
  ('gs_lic',(select id from public.pm_projects where id_origem='pr_sintra'),'Licença de obra','todo','media','2026-10-02','2026-11-02','2026-11-01',0,'Contacto do Henrique na CMS, caso seja necessário.',12000,'2026-09-21T10:29:00.000Z'),
  ('gs_amianto',(select id from public.pm_projects where id_origem='pr_sintra'),'Orçamento da troca do telhado de amianto (galpão IV)','doing','alta','2026-09-15','2026-10-15','2026-10-15',30,'A solicitar orçamentos para a troca da cobertura de amianto do galpão IV.',7000,'2026-09-21T10:30:00.000Z'),
  ('bf_eng',(select id from public.pm_projects where id_origem='pr_benfica'),'Solicitar orçamento de engenheiro para plantas atualizadas e memorial descritivo','todo','alta',null,null,null,0,'Cronograma por definir para este projeto.',13000,'2026-09-21T10:31:00.000Z'),
  ('bf_legal',(select id from public.pm_projects where id_origem='pr_benfica'),'Verificar a possibilidade de legalização','doing','alta',null,null,null,0,'O Davyd está em contacto com a advogada.',8000,'2026-09-21T10:32:00.000Z'),
  ('bf_vender6',(select id from public.pm_projects where id_origem='pr_benfica'),'Vender os 6 apartamentos que já estão legais','doing','media',null,null,null,0,'',9000,'2026-09-21T10:33:00.000Z'),
  ('bf_vender5',(select id from public.pm_projects where id_origem='pr_benfica'),'Vender as outras 5 frações por 650 mil euros','todo','media',null,null,null,0,'',14000,'2026-09-21T10:34:00.000Z'),
  ('vs_bandeja',(select id from public.pm_projects where id_origem='pr_vistasul'),'Bandeja de captação do vazamento na garagem','waiting','alta',null,null,null,0,'Problema recorrente de vazamento na garagem. Depois de várias tentativas de identificar o ponto inicial, foi sugerido fazer uma bandeja de captação e direcionar para o esgoto. O condomínio acatou a solução e apresentou um orçamento de 250 €. Previsão de custo em outubro: 250 €.',8000,'2026-09-21T10:35:00.000Z')
on conflict (id_origem) do nothing;

-- Dependências ---------------------------------------------------------------
-- dias_espera = dias entre o fim da antecessora e o arranque desta tarefa.
insert into public.pm_task_deps (task_id,depende_de,dias_espera) values
  ((select id from public.pm_tasks where id_origem='fp_orcam'),(select id from public.pm_tasks where id_origem='fp_levant'),0),
  ((select id from public.pm_tasks where id_origem='fp_analise'),(select id from public.pm_tasks where id_origem='fp_orcam'),0),
  ((select id from public.pm_tasks where id_origem='fp_obra'),(select id from public.pm_tasks where id_origem='fp_analise'),0),
  ((select id from public.pm_tasks where id_origem='br_exec'),(select id from public.pm_tasks where id_origem='br_cml'),0),
  ((select id from public.pm_tasks where id_origem='ar_obras'),(select id from public.pm_tasks where id_origem='ar_orcloja'),0),
  ((select id from public.pm_tasks where id_origem='ar_limpeza'),(select id from public.pm_tasks where id_origem='ar_obras'),0),
  ((select id from public.pm_tasks where id_origem='ar_limpeza'),(select id from public.pm_tasks where id_origem='ar_orclimp'),0),
  ((select id from public.pm_tasks where id_origem='ma_orc'),(select id from public.pm_tasks where id_origem='ma_constr'),0),
  ((select id from public.pm_tasks where id_origem='ma_adjud'),(select id from public.pm_tasks where id_origem='ma_orc'),0),
  ((select id from public.pm_tasks where id_origem='ma_demo'),(select id from public.pm_tasks where id_origem='ma_adjud'),0),
  ((select id from public.pm_tasks where id_origem='ma_obra'),(select id from public.pm_tasks where id_origem='ma_demo'),0),
  ((select id from public.pm_tasks where id_origem='gs_arq'),(select id from public.pm_tasks where id_origem='gs_topo'),0),
  ((select id from public.pm_tasks where id_origem='gs_lic'),(select id from public.pm_tasks where id_origem='gs_arq'),0),
  ((select id from public.pm_tasks where id_origem='bf_vender5'),(select id from public.pm_tasks where id_origem='bf_legal'),0)
on conflict (task_id,depende_de) do update set dias_espera = excluded.dias_espera;

-- A fixação automática da linha de base não deve correr na importação,
-- porque as datas previstas já vêm certas do quadro antigo.
commit;

-- Conferência ----------------------------------------------------------------
-- select count(*) from public.pm_projects;  -- esperado: 7
-- select count(*) from public.pm_tasks;     -- esperado: 37
-- select count(*) from public.pm_task_deps; -- esperado: 14

-- Dependências desrespeitadas (deve devolver zero linhas):
-- select t.titulo, t.inicio, public.pm_inicio_mais_cedo(t.id) as podia_arrancar
--   from public.pm_tasks t
--  where t.inicio is not null and t.inicio < public.pm_inicio_mais_cedo(t.id);
