# Gestor de Projetos Rio Capital — módulo

React + Vite, sobre o Supabase do ERP. Site próprio no Netlify, mesma base de
dados e mesmo login.

## Pôr a andar

```bash
npm install
cp .env.example .env.local     # preencher com os valores do Supabase
npm run dev
```

Os dois valores estão no painel do Supabase, em **Settings → API**:
`VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. A chave anon é pública por
desenho — quem protege os dados é o RLS. A **`service_role key` não entra aqui**,
nem no `.env`, nem no Netlify, nem no repositório.

Antes de arrancar, a base tem de ter o `01_schema.sql` e o `02_dados.sql`
corridos (estão na raiz do repositório).

## Comandos

| | |
|---|---|
| `npm run dev` | servidor de desenvolvimento |
| `npm run build` | build de produção para `dist/` |
| `npm test` | testes da lógica de agendamento (19 casos) |

## Netlify

O `netlify.toml` está **na raiz do repositório**, não aqui — é onde o Netlify o
procura. Já traz tudo: `base = "app"`, o comando de build, a pasta a publicar e o
redirecionamento que faz uma aplicação de página única aguentar um F5 em
qualquer vista. No painel não é preciso configurar nada além das duas variáveis
em **Site settings → Environment variables**.

Para o subdomínio (por exemplo `projetos.riocapital.pt`), é um CNAME a apontar
para o site do Netlify.

## Como está organizado

```
src/
  lib/
    dates.js      datas de calendário em texto ISO, sem fusos
    schedule.js   dependências, esperas, cascata — sem React, testável sozinho
    supabase.js   cliente + erros em português
    format.js     iniciais, tamanhos, "há 2 dias", prioridades, paleta
  data/
    useBoard.js   leitura das tabelas pm_*, tempo real, e as escritas
  components/
    Auth.jsx        entrada por link de email
    Sidebar.jsx     projetos por empresa, equipa, colunas
    Board.jsx       quadro por estado
    ProjectBoard.jsx quadro por projeto
    Gantt.jsx       barras, linha de base, desvios, setas com espera
    TaskList.jsx    lista ordenável
    Alerts.jsx      alertas de prazo
    TaskDrawer.jsx  painel da tarefa
    MultiSelect.jsx, FiltroBar.jsx, Card.jsx, Bits.jsx
  App.jsx         estado geral, filtros, vistas
harness/          pré-visualização com dados de exemplo (não vai para produção)
```

**`src/lib/schedule.js` é o sítio a ler primeiro.** É onde vivem as regras que
não se podem perder: a cascata, as esperas e a linha de base. Está isolado de
React e de Supabase de propósito, e tem testes em `test/schedule.test.mjs`.

## Regras que não se devem partir

1. **`fim_previsto` grava-se uma vez e não muda.** Há um trigger na base a
   garantir; só a função `pm_repor_fim_previsto(task, justificacao)` a altera,
   e essa exige justificação e deixa registo em `pm_comments`.
2. **Adiar o fim empurra as dependentes**, pela cadeia toda, mantendo durações.
   Nunca puxa para trás, e nunca toca na linha de base — é isso que faz o desvio
   aparecer no Gantt.
3. **A cascata só reage a alterações.** O que já estava fora de ordem fica
   assinalado a vermelho até alguém carregar em "Ajustar N dependências".
   Não se corrige sozinho: mexer nas datas do plano sem pedir é pior.
4. **A equipa é quem tem `app_access('projetos')`.** Não há lista de membros à
   parte, e só essas pessoas podem ser responsáveis por tarefas. Quatro papéis:
   `admin` (Super admin), `interact` (Editor), `contrib` (Editor parcial) e
   `view` (Visualizador).
5. **As permissões vivem na base de dados.** `pode_criar`, `pode_escrever`,
   `pode_comentar` e `e_admin` decidem nas políticas RLS; o gatilho
   `pm_guardar_datas` trava alterações de datas a quem não tem escrita completa.
   Os `podeCriar` / `podeEscrever` / `podeComentar` do contexto React só
   escondem botões — nunca são a única defesa.

## O que falta

- **Anexos**: precisa do bucket privado `pm-anexos` no Storage, com leitura para
  `tem_area('projetos')` e escrita para `pode_escrever('projetos')`.
- **Resumo diário por email**: Edge Function agendada + serviço de envio (Resend
  ou equivalente), a ler `pm_subscriptions`. Ainda não está escrito.
- **Empresa dos projetos**: hoje é texto em `pm_projects.empresa`. Passa a apontar
  para a tabela das sociedades do ERP assim que soubermos qual é.
- **Arrastar** cartões entre colunas e barras no Gantt: o quadro antigo faz,
  este ainda não.
