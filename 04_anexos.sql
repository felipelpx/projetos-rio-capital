-- ============================================================================
-- Rio Capital — permissões do armazenamento de ficheiros (anexos das tarefas)
--
-- Correr DEPOIS de criar o bucket `pm-anexos` no painel:
--   Storage → New bucket → nome `pm-anexos` → deixar PRIVADO → Create.
--
-- Sem isto, o bucket existe mas ninguém lhe toca: o Supabase recusa tudo por
-- omissão. Estas três políticas dizem quem pode ler, quem pode carregar e quem
-- pode remover.
--
-- Pode correr as vezes que forem precisas.
-- ============================================================================

-- Quem tem acesso à área de projetos vê os anexos.
-- (É isto que faz o botão de transferir funcionar.)
drop policy if exists anexos_ler on storage.objects;
create policy anexos_ler on storage.objects for select
  using (bucket_id = 'pm-anexos' and public.tem_area('projetos'));

-- Editores e super admins carregam ficheiros. Visualizadores não.
drop policy if exists anexos_carregar on storage.objects;
create policy anexos_carregar on storage.objects for insert
  with check (bucket_id = 'pm-anexos' and public.pode_escrever('projetos'));

-- Quem carrega também pode remover.
drop policy if exists anexos_remover on storage.objects;
create policy anexos_remover on storage.objects for delete
  using (bucket_id = 'pm-anexos' and public.pode_escrever('projetos'));

-- ----------------------------------------------------------------------------
-- Conferir
-- ----------------------------------------------------------------------------
-- 1) O bucket existe e está privado? (public tem de ser false)
--
--    select id, name, public from storage.buckets where id = 'pm-anexos';
--
-- 2) As três políticas ficaram lá?
--
--    select policyname, cmd from pg_policies
--     where schemaname = 'storage' and tablename = 'objects'
--       and policyname like 'anexos_%';
--
-- 3) Na aplicação: abrir uma tarefa, "Carregar ficheiro", escolher um PDF.
--    Deve aparecer na lista de anexos e o botão ↓ deve transferi-lo.
--    Depois, entrar como visualizador: o botão de carregar não aparece.
-- ----------------------------------------------------------------------------
