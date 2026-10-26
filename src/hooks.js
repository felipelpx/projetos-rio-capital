import { useEffect, useState, useCallback } from 'react'
import { supabase } from './supabase'

// ─── HELPER: generic realtime table hook ─────────────────────────────────────
function useRealtimeTable(table, queryFn) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      const { data: result, error: queryError } = await queryFn()
      if (queryError) {
        console.error(`useRealtimeTable[${table}] query error:`, queryError)
        setError(queryError.message || String(queryError))
      } else {
        setError(null)
        if (result) setData(result)
      }
    } catch(e) {
      console.error(`useRealtimeTable[${table}] exception:`, e)
      setError(e?.message || String(e))
    }
    setLoading(false)
  }, [table])

  useEffect(() => {
    const timeout = setTimeout(() => setLoading(false), 6000)
    load().finally(() => clearTimeout(timeout))
    // Channel name único por instância — evita colisão quando o mesmo hook é
    // usado em vários componentes (ex.: useProfiles em App + Utilizadores).
    const ch = supabase.channel(`realtime-${table}-${Math.random().toString(36).slice(2, 10)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, load)
      .subscribe()
    return () => { supabase.removeChannel(ch); clearTimeout(timeout) }
  }, [table, load])

  return { data, loading, error, reload: load }
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
// Data a partir da qual o ERP mostra movimentos. Tudo o que é anterior fica
// guardado na base de dados, mas não aparece em lado nenhum: os extratos, as
// contagens, os saldos e a conferência de saldos só olham para 2026 em diante.
export const DATA_MINIMA = '2026-01-01'

export function useAuth() {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Rede: se getSession() rejeitar, o .then() nunca corre e a aplicação fica
    // presa no ecrã "A carregar...". Daí o catch e o tempo limite abaixo.
    let vivo = true
    const limite = setTimeout(() => { if (vivo) setLoading(false) }, 10000)

    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        if (!vivo) return
        setUser(session?.user ?? null)
        if (session?.user) loadProfile(session.user.id)
        else setLoading(false)
      })
      .catch((e) => {
        console.warn('getSession falhou:', e)
        if (vivo) { setUser(null); setLoading(false) }
      })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null)
      if (session?.user) loadProfile(session.user.id)
      else { setProfile(null); setLoading(false) }
    })
    return () => { vivo = false; clearTimeout(limite); subscription.unsubscribe() }
  }, [])

  const loadProfile = async (id) => {
    // maybeSingle() em vez de single(): sem linha em `profiles` devolvia erro e
    // o utilizador ficava sem perfil, mas com sessão aberta.
    try {
      const { data } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle()
      setProfile(data || null)
    } catch (e) {
      console.warn('loadProfile falhou:', e)
      setProfile(null)
    } finally {
      setLoading(false)
    }
  }

  const signIn = (email, password) => supabase.auth.signInWithPassword({ email, password })
  const signOut = () => supabase.auth.signOut()
  return { user, profile, loading, signIn, signOut }
}

// ─── PROFILES ─────────────────────────────────────────────────────────────────
export function useProfiles() {
  const { data, loading } = useRealtimeTable('profiles',
    () => supabase.from('profiles').select('*').order('nome'))
  const upsertProfile = (p) => supabase.from('profiles').upsert(p)
  return { profiles: data, loading, upsertProfile }
}

// ─── CONTAS (saldos) ──────────────────────────────────────────────────────────
export function useContas() {
  const { data, loading } = useRealtimeTable('contas',
    () => supabase.from('contas').select('*'))
  const updateSaldo = (id, saldo) =>
    supabase.from('contas').update({ saldo, updated_at: new Date().toISOString() }).eq('id', id)
  const upsertConta = (conta) =>
    supabase.from('contas').upsert({ ...conta, updated_at: new Date().toISOString() })
  return { contas: data, loading, updateSaldo, upsertConta }
}

// ─── MOVIMENTOS por conta (com paginação) ────────────────────────────────────
export function useMovimentosByConta(contaId) {
  const [movimentos, setMovimentos] = useState([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!contaId) return
    setLoading(true)
    let all = [], from = 0
    while (true) {
      const { data, error } = await supabase
        .from('movimentos').select('*')
        .gte('data', DATA_MINIMA)
        .eq('conta_id', contaId)
        // SEQ DESC primeiro: o `seq` guarda a ordem exacta da folha importada,
        // por isso o extrato fica a ser o espelho dela (a última linha da folha
        // no topo). A data só desempata linhas antigas que não tenham seq —
        // ordenar por data primeiro reordenava movimentos do mesmo dia e
        // partia a cadeia de saldos.
        .order('seq', { ascending: false, nullsFirst: false })
        .order('data', { ascending: false, nullsFirst: false })
        .order('id', { ascending: true })
        .range(from, from + 999)
      if (error || !data?.length) break
      all = [...all, ...data]
      if (data.length < 1000) break
      from += 1000
    }
    setMovimentos(all)
    setLoading(false)
  }, [contaId])

  useEffect(() => {
    load()
    if (!contaId) return
    const ch = supabase.channel(`realtime-movimentos-${contaId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'movimentos',
        filter: `conta_id=eq.${contaId}`
      }, load)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [contaId, load])

  const saveMovimentos = async (novos, cId) => {
    const id = cId || contaId
    if (!id || !novos?.length) return 0
    const { data: existing } = await supabase.from('movimentos')
      .select('data, movimento, valor, saldo').eq('conta_id', id)
    const keys = new Set((existing || []).map(m => `${m.data}_${m.movimento}_${m.valor}_${m.saldo}`))
    const toInsert = novos
      .filter(m => !keys.has(`${m.data}_${m.movimento}_${m.valor}_${m.saldo}`))
      .map((m, idx) => ({
        conta_id: id,
        empresa_id: m.empresa_id || id.split('_')[0],
        banco: m.banco || '',
        data: m.data, movimento: m.movimento, valor: m.valor,
        saldo: m.saldo || 0,
        categoria: m.catEditada || m.categoria || '',
        detalhes: m.detalhes || '',
        seq: m.seq !== undefined ? m.seq : idx  // preserve Excel order
      }))
    for (let i = 0; i < toInsert.length; i += 200)
      await supabase.from('movimentos').insert(toInsert.slice(i, i + 200))
    return toInsert.length
  }

  const deleteMovimento = (id) => supabase.from('movimentos').delete().eq('id', id)
  const updateMovimento = async (id, updates) => {
    const { data, error } = await supabase.from('movimentos').update(updates).eq('id', id).select()
    if (error) console.error('updateMovimento error:', error)
    return { data, error }
  }

  return { movimentos, loading, saveMovimentos, deleteMovimento, updateMovimento, reload: load }
}

// ─── FATURAS ──────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// As colunas de 'faturas' MENOS o anexo.
//
// O anexo é o PDF da fatura guardado em base64 dentro da própria linha. Pedir
// 'select(*)' trazia o PDF de TODAS as faturas só para desenhar uma tabela que
// mostra o nome do ficheiro — daí o Contas a Pagar demorar a abrir. O anexo
// passa a ser lido só quando alguém o quer ver.
//
// A lista de colunas não está escrita à mão de propósito: é lida da própria
// tabela. Assim, uma coluna nova aparece na lista sozinha, em vez de
// desaparecer do ecrã sem ninguém dar por isso.
// ─────────────────────────────────────────────────────────────────────────────
let _colunasFaturas = null
async function colunasDeFaturas() {
  if (_colunasFaturas) return _colunasFaturas
  const { data, error } = await supabase.from('faturas').select('*').limit(1)
  if (error) return '*'
  const cols = Object.keys(data?.[0] || {}).filter(c => c !== 'anexo_b64')
  _colunasFaturas = cols.length ? cols.join(',') : '*'
  return _colunasFaturas
}

// Em páginas, com uma ordem total: sem o 'id' a desempatar, o Postgres pode
// repetir ou saltar linhas entre páginas e ficavam faturas de fora.
async function lerFaturasTodas() {
  const cols = await colunasDeFaturas()
  const TAM = 1000
  const todas = []
  for (let p = 0; ; p++) {
    const { data, error } = await supabase.from('faturas').select(cols)
      .order('created_at', { ascending: false }).order('id', { ascending: true })
      .range(p * TAM, p * TAM + TAM - 1)
    if (error) {
      // Lista de colunas recusada (coluna removida entretanto): volta ao
      // comportamento antigo em vez de deixar o ecrã vazio.
      if (cols !== '*') { _colunasFaturas = null; return supabase.from('faturas').select('*').order('created_at', { ascending: false }) }
      return { data: null, error }
    }
    todas.push(...(data || []))
    if (!data || data.length < TAM) break
    if (p > 50) break   // travão: 50.000 faturas é muito para além do real
  }
  return { data: todas, error: null }
}

export function useFaturas() {
  const { data, loading, error, reload } = useRealtimeTable('faturas', lerFaturasTodas)

  // O anexo de UMA fatura, pedido no momento em que alguém carrega em "ver".
  const carregarAnexo = async (id) => {
    const { data, error } = await supabase.from('faturas')
      .select('id, anexo_nome, anexo_b64').eq('id', id).maybeSingle()
    if (error) { console.error('carregarAnexo:', error); return { data: null, error } }
    return { data, error: null }
  }
  const addFatura = async (f) => {
    const { data, error } = await supabase.from('faturas').insert([f]).select()
    if (error) console.error('addFatura error:', error)
    return { data, error }
  }
  const addFaturas = async (arr) => {
    if (!arr?.length) return { data: [], error: null }
    const { data, error } = await supabase.from('faturas').insert(arr).select()
    if (error) console.error('addFaturas error:', error)
    return { data, error }
  }
  const updateFatura = async (id, u) => {
    // Remover o id do payload (primary key, não atualizável)
    const { id: _ignoreId, ...rest } = u || {};
    const { data, error } = await supabase.from('faturas')
      .update(rest).eq('id', id).select()
    if (error) console.error('updateFatura error:', error)
    return { data, error }
  }
  const deleteFatura = async (id) => {
    const { data, error } = await supabase.from('faturas').delete().eq('id', id).select();
    if (error) console.error('deleteFatura error:', error);
    return { data, error };
  };
  return { faturas: data, loading, error, reload, addFatura, addFaturas, updateFatura, deleteFatura, carregarAnexo }
}

// ─── PAGAMENTOS EXTRAS ────────────────────────────────────────────────────────
export function usePagamentosExtras() {
  const { data, loading } = useRealtimeTable('pagamentos_extras',
    () => supabase.from('pagamentos_extras').select('*').order('data_inicio'))
  const addPagamento = async (p) => {
    const { data, error } = await supabase.from('pagamentos_extras').insert([p]).select()
    if (error) console.error('addPagamento error:', error)
    return { data, error }
  }
  const updatePagamento = async (id, u) => {
    const { data, error } = await supabase.from('pagamentos_extras')
      .update(u).eq('id', id).select()
    if (error) console.error('updatePagamento error:', error)
    return { data, error }
  }
  const deletePagamento = async (id) => {
    const { data, error } = await supabase.from('pagamentos_extras')
      .delete().eq('id', id).select()
    if (error) console.error('deletePagamento error:', error)
    return { data, error }
  }
  return { pagamentos: data, loading, addPagamento, updatePagamento, deletePagamento }
}

// ─── MAPAS DE PAGAMENTO ──────────────────────────────────────────────────────
export function useMapasPagamento() {
  const { data: mapas, loading, reload } = useRealtimeTable('mapas_pagamento',
    () => supabase.from('mapas_pagamento').select('*').order('created_at', { ascending: false }))

  const addMapa = async (mapa, itens) => {
    // 1. Cria o cabeçalho do mapa
    const { data: created, error: e1 } = await supabase.from('mapas_pagamento').insert([mapa]).select()
    if (e1) { console.error('addMapa cabeçalho:', e1); return { data: null, error: e1 } }
    const mapaId = created?.[0]?.id
    if (!mapaId) return { data: null, error: { message: "Cabeçalho criado mas sem id (RLS?)" } }
    // 2. Insere itens com o mapa_id
    const itensComMapaId = (itens || []).map(it => ({ ...it, mapa_id: mapaId }))
    const { data: itensInseridos, error: e2 } = await supabase.from('mapas_pagamento_itens').insert(itensComMapaId).select()
    if (e2) { console.error('addMapa itens:', e2); return { data: created[0], error: e2 } }
    await reload()
    return { data: { mapa: created[0], itens: itensInseridos || [] }, error: null }
  }

  const updateMapa = async (id, u) => {
    const { id: _i, ...rest } = u || {}
    const { data, error } = await supabase.from('mapas_pagamento').update(rest).eq('id', id).select()
    if (error) console.error('updateMapa error:', error)
    if (!error) await reload()
    return { data, error }
  }

  const deleteMapa = async (id) => {
    // ON DELETE CASCADE apaga os itens automaticamente
    const { data, error } = await supabase.from('mapas_pagamento').delete().eq('id', id).select()
    if (error) console.error('deleteMapa error:', error)
    if (!error) await reload()
    return { data, error }
  }

  return { mapas, loading, reload, addMapa, updateMapa, deleteMapa }
}

// ─── Itens de um mapa de pagamento (paginação simples por mapa_id) ─────────
export function useMapaItens(mapaId) {
  const [itens, setItens] = useState([])
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    if (!mapaId) { setItens([]); setLoading(false); return }
    const { data, error } = await supabase
      .from('mapas_pagamento_itens').select('*').eq('mapa_id', mapaId).order('created_at')
    if (!error && data) setItens(data)
    setLoading(false)
  }, [mapaId])
  useEffect(() => {
    setLoading(true)
    load()
    if (!mapaId) return
    // Nome único por instância: com um nome fixo, duas montagens do mesmo
    // mapa colidiam e a subscrição ficava morta — as decisões gravavam na base
    // mas o ecrã não mexia.
    const ch = supabase.channel(`mp-itens-${mapaId}-${Math.random().toString(36).slice(2, 10)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mapas_pagamento_itens', filter: `mapa_id=eq.${mapaId}` }, load)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [mapaId, load])
  return { itens, loading, reload: load }
}

// ─── Itens que já estão em algum mapa de pagamento ────────────────────────────
// Devolve as chaves "tipo_origem:origem_id" dos itens incluídos em mapas que
// continuam de pé (um mapa recusado liberta os seus itens). Serve para o
// Contas a Pagar mostrar "Adicionado ao mapa" e para o ecrã Novo Mapa não
// voltar a oferecer o que já está noutro mapa — sem gravar nada na fatura ou
// no pagamento: se o item sair do mapa, tudo volta sozinho ao estado anterior.
export function useItensEmMapa() {
  const [chaves, setChaves] = useState(() => new Set())
  const [idsFaturaEmMapa, setIdsFatura] = useState(() => new Set())
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const [mapasRes, itensRes] = await Promise.all([
        supabase.from('mapas_pagamento').select('id,status'),
        supabase.from('mapas_pagamento_itens').select('tipo_origem,origem_id,mapa_id'),
      ])
      if (mapasRes.error) console.error('useItensEmMapa mapas:', mapasRes.error)
      if (itensRes.error) console.error('useItensEmMapa itens:', itensRes.error)
      const recusados = new Set(
        (mapasRes.data || []).filter(m => m.status === 'recusado').map(m => m.id)
      )
      const ks = new Set(), fs = new Set()
      ;(itensRes.data || []).forEach(it => {
        if (it.mapa_id && recusados.has(it.mapa_id)) return
        if (!it.origem_id) return
        ks.add(`${it.tipo_origem}:${it.origem_id}`)
        if (it.tipo_origem === 'fatura') fs.add(it.origem_id)
      })
      setChaves(ks); setIdsFatura(fs)
    } catch (e) { console.warn('useItensEmMapa error:', e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    const timeout = setTimeout(() => setLoading(false), 6000)
    load().finally(() => clearTimeout(timeout))
    const sufixo = Math.random().toString(36).slice(2, 10)
    const ch = supabase.channel(`itens-em-mapa-${sufixo}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mapas_pagamento_itens' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mapas_pagamento' }, load)
      .subscribe()
    return () => { supabase.removeChannel(ch); clearTimeout(timeout) }
  }, [load])

  return { chaves, idsEmMapa: idsFaturaEmMapa, loading, reload: load }
}

// Nome antigo, mantido para quem só precisa das faturas.
export const useFaturasEmMapa = useItensEmMapa

// ─── COMENTÁRIOS EM MOVIMENTOS ───────────────────────────────────────────────
// Perguntas e notas que a equipa deixa numa linha do extrato. Ficam ligadas ao
// id do movimento, ficam visíveis a todos e não alteram o movimento em si.
export function useComentariosMovimentos(contaId) {
  const [comentarios, setComentarios] = useState([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState(null)

  const load = useCallback(async () => {
    if (!contaId) { setComentarios([]); setLoading(false); return }
    const { data, error } = await supabase
      .from('movimento_comentarios').select('*')
      .eq('conta_id', contaId)
      .order('created_at', { ascending: true })
    if (error) {
      console.error('useComentariosMovimentos:', error)
      // Tabela ainda não criada — o ecrã continua a funcionar sem comentários.
      setErro(error.message || String(error))
      setComentarios([])
    } else {
      setErro(null)
      setComentarios(data || [])
    }
    setLoading(false)
  }, [contaId])

  useEffect(() => {
    setLoading(true)
    const timeout = setTimeout(() => setLoading(false), 6000)
    load().finally(() => clearTimeout(timeout))
    if (!contaId) return () => clearTimeout(timeout)
    const ch = supabase.channel(`mov-coment-${Math.random().toString(36).slice(2, 10)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'movimento_comentarios' }, load)
      .subscribe()
    return () => { supabase.removeChannel(ch); clearTimeout(timeout) }
  }, [contaId, load])

  const addComentario = async (c) => {
    const { data, error } = await supabase.from('movimento_comentarios').insert([c]).select()
    if (error) return { data: null, error }
    if (!data?.length) return { data: null, error: { message: 'RLS' }, semEfeito: true }
    await load()
    return { data, error: null }
  }

  const updateComentario = async (id, u) => {
    const { data, error } = await supabase.from('movimento_comentarios').update(u).eq('id', id).select()
    if (error) return { data: null, error }
    if (!data?.length) return { data: null, error: { message: 'RLS' }, semEfeito: true }
    await load()
    return { data, error: null }
  }

  const deleteComentario = async (id) => {
    const { data, error } = await supabase.from('movimento_comentarios').delete().eq('id', id).select()
    if (error) return { data: null, error }
    if (!data?.length) return { data: null, error: { message: 'RLS' }, semEfeito: true }
    await load()
    return { data, error: null }
  }

  // { movimento_id: [comentarios] } — o ecrã só precisa disto
  const porMovimento = {}
  comentarios.forEach(c => {
    const k = String(c.movimento_id)
    if (!porMovimento[k]) porMovimento[k] = []
    porMovimento[k].push(c)
  })

  return { comentarios, porMovimento, loading, erro, addComentario, updateComentario, deleteComentario, reload: load }
}

// ─── RATEIOS (divisão de um movimento por várias categorias) ─────────────────
// Um movimento bancário pode corresponder a vários custos: a transferência
// única dos salários, o pagamento de impostos da folha. O rateio reparte o
// valor em linhas com categoria própria SEM tocar no movimento — o extrato e
// os saldos continuam a bater com o banco.
export function useRateios(contaId) {
  const [rateios, setRateios] = useState([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState(null)

  const load = useCallback(async () => {
    if (!contaId) { setRateios([]); setLoading(false); return }
    const { data, error } = await supabase
      .from('movimento_rateios').select('*')
      .eq('conta_id', contaId)
      .order('created_at', { ascending: true })
    if (error) {
      console.error('useRateios:', error)
      setErro(error.message || String(error))
      setRateios([])
    } else {
      setErro(null)
      setRateios(data || [])
    }
    setLoading(false)
  }, [contaId])

  useEffect(() => {
    setLoading(true)
    const timeout = setTimeout(() => setLoading(false), 6000)
    load().finally(() => clearTimeout(timeout))
    if (!contaId) return () => clearTimeout(timeout)
    const ch = supabase.channel(`mov-rateios-${Math.random().toString(36).slice(2, 10)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'movimento_rateios' }, load)
      .subscribe()
    return () => { supabase.removeChannel(ch); clearTimeout(timeout) }
  }, [contaId, load])

  // Substitui de uma vez todas as linhas de um movimento: é como o utilizador
  // pensa no rateio (a repartição inteira, não linha a linha) e evita ficar a
  // meio caminho se algo falhar no meio.
  const guardarRateio = async (movimentoId, linhas) => {
    const mid = String(movimentoId)
    const { error: eDel } = await supabase
      .from('movimento_rateios').delete().eq('movimento_id', mid)
    if (eDel) return { data: null, error: eDel }
    if (!linhas.length) { await load(); return { data: [], error: null } }
    const { data, error } = await supabase
      .from('movimento_rateios').insert(linhas.map(l => ({ ...l, movimento_id: mid, conta_id: contaId }))).select()
    if (error) return { data: null, error }
    if (!data?.length) return { data: null, error: { message: 'RLS' }, semEfeito: true }
    await load()
    return { data, error: null }
  }

  // { movimento_id: [linhas] }
  const porMovimento = {}
  rateios.forEach(r => {
    const k = String(r.movimento_id)
    if (!porMovimento[k]) porMovimento[k] = []
    porMovimento[k].push(r)
  })

  return { rateios, porMovimento, loading, erro, guardarRateio, reload: load }
}

// ─── TODOS OS MOVIMENTOS (Caixa Único) ───────────────────────────────────────
// Lê os movimentos de TODAS as contas, paginando. É a mesma tabela que o
// Extratos usa, por isso qualquer alteração feita aqui aparece lá — e ao
// contrário — sem haver duas cópias dos dados.
export function useTodosMovimentos() {
  const [movimentos, setMovimentos] = useState([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState(null)
  // Alguém mexeu nos movimentos noutro ecrã. Não se recarrega sozinho (são
  // milhares de linhas e apagaria a página onde a pessoa está) — avisa-se.
  const [desatualizado, setDesatualizado] = useState(false)

  const load = useCallback(async () => {
    try {
      let all = [], from = 0
      while (true) {
        const { data, error } = await supabase
          .from('movimentos').select('*')
          .gte('data', DATA_MINIMA)
          .order('data', { ascending: false, nullsFirst: false })
          .order('seq', { ascending: false, nullsFirst: false })
          .order('id', { ascending: true })
          .range(from, from + 999)
        if (error) {
          console.error('useTodosMovimentos:', error)
          setErro(error.message || String(error))
          break
        }
        if (!data?.length) break
        all = all.concat(data)
        if (data.length < 1000) break
        from += 1000
        if (from > 100000) break        // travão de segurança
      }
      setErro(null); setMovimentos(all); setDesatualizado(false)
    } catch (e) {
      console.warn('useTodosMovimentos erro:', e)
      setErro(e?.message || String(e))
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    setLoading(true)
    const timeout = setTimeout(() => setLoading(false), 20000)
    load().finally(() => clearTimeout(timeout))
    const ch = supabase.channel(`caixa-unico-${Math.random().toString(36).slice(2, 10)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'movimentos' }, () => setDesatualizado(true))
      .subscribe()
    return () => { supabase.removeChannel(ch); clearTimeout(timeout) }
  }, [load])

  // Alterar aqui é alterar a linha original do extrato — é a mesma tabela.
  const updateMovimento = async (id, updates) => {
    const { data, error } = await supabase.from('movimentos').update(updates).eq('id', id).select()
    if (error) return { data: null, error }
    if (!data?.length) return { data: null, error: { message: 'RLS' }, semEfeito: true }
    setMovimentos(ms => ms.map(m => m.id === id ? { ...m, ...updates } : m))
    // A própria alteração dispara o realtime; não é novidade para este ecrã.
    setDesatualizado(false)
    return { data, error: null }
  }

  return { movimentos, loading, erro, desatualizado, reload: load, updateMovimento }
}

// ─── DESPESAS RECORRENTES ────────────────────────────────────────────────────
// Guarda-se a REGRA, não as linhas (ver src/recorrentes.js). O Fluxo Futuro
// expande-a ao desenhar, por isso parar uma despesa é mudar uma data num sítio
// só, em vez de apagar dezenas de previsões.
export function useDespesasRecorrentes() {
  const { data, loading, error, reload } = useRealtimeTable('despesas_recorrentes',
    () => supabase.from('despesas_recorrentes').select('*').order('descricao'))

  const guardarRecorrente = async (r) => {
    const linha = {
      ...r,
      id: r.id || `rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      updated_at: new Date().toISOString(),
    }
    const { data, error } = await supabase.from('despesas_recorrentes')
      .upsert([linha], { onConflict: 'id' }).select()
    if (error) { console.error('guardarRecorrente:', error); return { data: null, error } }
    if (!data?.length) return { data: null, error: { message: 'RLS' }, semEfeito: true }
    await reload()
    return { data, error: null }
  }

  const apagarRecorrente = async (id) => {
    const { data, error } = await supabase.from('despesas_recorrentes')
      .delete().eq('id', id).select('id')
    if (error) { console.error('apagarRecorrente:', error); return { data: null, error } }
    if (!data?.length) return { data: null, error: { message: 'RLS' }, semEfeito: true }
    await reload()
    return { data, error: null }
  }

  // Parar é pôr uma data limite, não apagar: o que já passou continua a fazer
  // parte da história do projeto.
  const pararRecorrente = async (id, dataFim) => {
    const { data, error } = await supabase.from('despesas_recorrentes')
      .update({ data_fim: dataFim, updated_at: new Date().toISOString() })
      .eq('id', id).select('id')
    if (error) { console.error('pararRecorrente:', error); return { data: null, error } }
    if (!data?.length) return { data: null, error: { message: 'RLS' }, semEfeito: true }
    await reload()
    return { data, error: null }
  }

  return { recorrentes: data, loading, error, reload,
           guardarRecorrente, apagarRecorrente, pararRecorrente }
}

// ─── FRACOES ──────────────────────────────────────────────────────────────────
export function useFracoes() {
  const [fracoes, setFracoes] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const timeout = setTimeout(() => setLoading(false), 5000)
    supabase.from('fracoes').select('*').order('projeto').order('fracao')
      .then(({ data }) => {
        if (data) setFracoes(data)
        setLoading(false)
        clearTimeout(timeout)
      })
      .catch(() => { setLoading(false); clearTimeout(timeout) })
    const ch = supabase.channel('realtime-fracoes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fracoes' }, () => {
        supabase.from('fracoes').select('*').order('projeto').order('fracao')
          .then(({ data }) => { if (data) setFracoes(data) })
      }).subscribe()
    return () => { supabase.removeChannel(ch); clearTimeout(timeout) }
  }, [])

  // .select() devolve as linhas afectadas: sem ele, uma política RLS que
  // bloqueie o UPDATE faz a gravação "correr bem" sem alterar nada, e o ecrã
  // volta ao valor anterior sem explicação.
  const upsertFracao = async (f) => {
    const { data, error } = await supabase.from('fracoes')
      .upsert({ ...f, updated_at: new Date().toISOString() }).select()
    if (error) return { error }
    if (!data || !data.length) return { error: { message: 'RLS' }, semEfeito: true }
    setFracoes(prev => {
      const i = prev.findIndex(x => x.id === data[0].id)
      if (i < 0) return [...prev, data[0]]
      const copia = [...prev]; copia[i] = data[0]; return copia
    })
    return { data }
  }
  const deleteFracao = (id) => supabase.from('fracoes').delete().eq('id', id)
  return { fracoes, loading, upsertFracao, deleteFracao }
}

// ─── VENDAS ───────────────────────────────────────────────────────────────────
export function useVendas() {
  const [vendas, setVendas] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const timeout = setTimeout(() => setLoading(false), 5000)
    supabase.from('vendas').select('*').order('data', { ascending: false })
      .then(({ data }) => {
        if (data) setVendas(data)
        setLoading(false)
        clearTimeout(timeout)
      })
      .catch(() => { setLoading(false); clearTimeout(timeout) })
    const ch = supabase.channel('realtime-vendas')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vendas' }, () => {
        supabase.from('vendas').select('*').order('data', { ascending: false })
          .then(({ data }) => { if (data) setVendas(data) })
      }).subscribe()
    return () => { supabase.removeChannel(ch); clearTimeout(timeout) }
  }, [])

  const upsertVenda = async (v) => {
    const { _frac, ...rest } = v
    const { data, error } = await supabase.from('vendas')
      .upsert({ ...rest, updated_at: new Date().toISOString() }).select()
    if (error) return { error }
    if (!data || !data.length) return { error: { message: 'RLS' }, semEfeito: true }
    setVendas(prev => {
      const i = prev.findIndex(x => x.id === data[0].id)
      if (i < 0) return [...prev, data[0]]
      const copia = [...prev]; copia[i] = data[0]; return copia
    })
    return { data }
  }
  const updateVenda = async (id, u) => {
    const { id: _i, ...rest } = u || {}
    const { data, error } = await supabase.from('vendas').update(rest).eq('id', id).select()
    if (error) console.error('updateVenda error:', error)
    return { data, error }
  }
  const deleteVenda = (id) => supabase.from('vendas').delete().eq('id', id)
  return { vendas, loading, upsertVenda, updateVenda, deleteVenda }
}

// ─── ORCAMENTO ────────────────────────────────────────────────────────────────
export function useOrcamento() {
  const { data, loading } = useRealtimeTable('orcamento',
    () => supabase.from('orcamento').select('*').order('empresa_id').order('categoria'))
  const upsertOrcamento = (row) =>
    supabase.from('orcamento').upsert({ ...row, updated_at: new Date().toISOString() })
  const deleteOrcamento = (id) => supabase.from('orcamento').delete().eq('id', id)
  return { orcamento: data, loading, upsertOrcamento, deleteOrcamento }
}

// ─── MOVIMENTOS COUNTS por conta — fonte de verdade pós-import ───────────────
// Retorna { [conta_id]: count } com reatividade em tempo real.
// Usado pelo ExtratosView para mostrar o nº REAL de movimentos por conta,
// independentemente do snapshot estático em caixa_unico_v2.json.
export function useMovimentosCounts() {
  const [counts, setCounts] = useState({})

  const load = useCallback(async () => {
    try {
      // Trazer apenas conta_id (paginado) e agregar no cliente
      let all = [], from = 0
      while (true) {
        const { data, error } = await supabase
          .from('movimentos').select('conta_id')
          .gte('data', DATA_MINIMA)
          .order('id', { ascending: true })
          .range(from, from + 999)
        if (error || !data?.length) break
        all = all.concat(data)
        if (data.length < 1000) break
        from += 1000
      }
      const agg = {}
      for (const r of all) agg[r.conta_id] = (agg[r.conta_id] || 0) + 1
      setCounts(agg)
    } catch (e) { console.warn('useMovimentosCounts error:', e) }
  }, [])

  useEffect(() => {
    load()
    const ch = supabase.channel('realtime-movimentos-counts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'movimentos' }, load)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [load])

  return { counts, reload: load }
}

// ─── SALDOS ATUAIS por conta — saldo do movimento MAIS RECENTE ───────────────
// Retorna { [conta_id]: saldo } usando o saldo do último movimento (seq mais alto
// e/ou data mais recente) de cada conta. Reativo a alterações na tabela.
export function useSaldosAtuais(contaIds = []) {
  const [saldos, setSaldos] = useState({})
  // loading serve para os ecrãs distinguirem "ainda não sei o saldo" de
  // "o saldo é zero" — sem isto mostrava-se um número errado no intervalo.
  const [loading, setLoading] = useState(true)
  // estabilizar a lista de ids como string para evitar re-runs infinitos
  const idsKey = JSON.stringify((contaIds || []).slice().sort())

  const load = useCallback(async () => {
    try {
      const ids = JSON.parse(idsKey)
      if (!ids.length) { setSaldos({}); return }
      const out = {}
      // Faz queries em paralelo, uma por conta — cada uma pede o último mov
      await Promise.all(ids.map(async (cid) => {
        const { data, error } = await supabase
          .from('movimentos').select('saldo')
          .gte('data', DATA_MINIMA)
          .eq('conta_id', cid)
          // Saldo = o da última linha da folha (maior seq), que é o último
          // movimento realizado. nullsFirst:false é essencial — em DESC o
          // Postgres põe NULL primeiro, e uma linha sem seq/data passava a
          // ditar o saldo da conta.
          .order('seq', { ascending: false, nullsFirst: false })
          .order('data', { ascending: false, nullsFirst: false })
          .limit(1)
        if (!error && data?.[0]) out[cid] = parseFloat(data[0].saldo) || 0
      }))
      setSaldos(out)
    } catch (e) { console.warn('useSaldosAtuais error:', e) }
    finally { setLoading(false) }
  }, [idsKey])

  useEffect(() => {
    load()
    const ch = supabase.channel(`realtime-saldos-atuais-${Math.random().toString(36).slice(2, 10)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'movimentos' }, load)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [load])

  return { saldos, loading, reload: load }
}

// ─── SALDOS NUMA DATA específica ─────────────────────────────────────────────
// Para cada conta_id, busca o saldo do ÚLTIMO movimento até à data dada (inclusive).
// Útil para comparações Data Anterior vs Data Atual.
export function useSaldosNaData(contaIds = [], dataISO) {
  const [saldos, setSaldos] = useState({})
  const [loading, setLoading] = useState(false)
  const idsKey = JSON.stringify((contaIds || []).slice().sort())

  const load = useCallback(async () => {
    try {
      const ids = JSON.parse(idsKey)
      if (!ids.length || !dataISO) { setSaldos({}); return }
      setLoading(true)
      const out = {}
      await Promise.all(ids.map(async (cid) => {
        const { data, error } = await supabase
          .from('movimentos').select('saldo, data, seq')
          .eq('conta_id', cid)
          .lte('data', dataISO)
          .order('data', { ascending: false })
          .order('seq', { ascending: false, nullsFirst: false })
          .limit(1)
        if (!error && data?.[0]) out[cid] = parseFloat(data[0].saldo) || 0
        else out[cid] = 0
      }))
      setSaldos(out)
      setLoading(false)
    } catch (e) {
      console.warn('useSaldosNaData error:', e)
      setLoading(false)
    }
  }, [idsKey, dataISO])

  useEffect(() => { load() }, [load])

  return { saldos, loading, reload: load }
}

// ─── ENTIDADES ────────────────────────────────────────────────────────────────
export function useEntidades() {
  const { data, loading } = useRealtimeTable('entidades',
    () => supabase.from('entidades').select('*').order('tipo').order('nome'))

  const addEntidade = async (e) => {
    const { error } = await supabase.from('entidades').insert([{ ...e, id: 'ent_' + Date.now() }])
    if (error) console.warn('addEntidade error:', error)
  }
  const updateEntidade = async (id, u) => {
    await supabase.from('entidades').update({ ...u, updated_at: new Date().toISOString() }).eq('id', id)
  }
  const deleteEntidade = async (id) => {
    await supabase.from('entidades').delete().eq('id', id)
  }
  return { entidades: data, loading, addEntidade, updateEntidade, deleteEntidade }
}

// ─────────────────────────────────────────────────────────────────────────────
// BAIXAS DE PREVISÕES
//
// Quando a fatura de um custo previsto entra no Contas a Pagar, a ocorrência
// prevista tem de sair do fluxo — senão o mês conta o custo duas vezes. Guarda-
// se aqui qual a ocorrência consumida e por que fatura.
//
// Guarda-se a ocorrência, não a previsão: a parcela 2/4 sai, as outras três
// ficam. Com uma regra recorrente é o mesmo — baixa-se o mês que já tem
// fatura e a avença continua nos meses seguintes.
// ─────────────────────────────────────────────────────────────────────────────
export function usePrevisoesBaixas() {
  const { data, loading, error, reload } = useRealtimeTable('previsoes_baixas',
    () => supabase.from('previsoes_baixas').select('*'))

  const baixar = async (b) => {
    const linha = {
      ...b,
      id: b.id || `bx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      data_ocorrencia: String(b.data_ocorrencia).slice(0, 10),
    }
    const { data, error } = await supabase.from('previsoes_baixas')
      .upsert([linha], { onConflict: 'origem,origem_id,data_ocorrencia' }).select()
    if (error) { console.error('baixarPrevisao:', error); return { data: null, error } }
    if (!data?.length) return { data: null, error: { message: 'RLS' }, semEfeito: true }
    await reload()
    return { data, error: null }
  }

  // Apagar a fatura devolve a previsão ao fluxo. Sem isto, apagar uma fatura
  // lançada por engano deixava o custo invisível nos dois sítios.
  const anularPorFatura = async (faturaId) => {
    if (!faturaId) return { data: null, error: null }
    const { data, error } = await supabase.from('previsoes_baixas')
      .delete().eq('fatura_id', faturaId).select('id')
    if (error) { console.error('anularBaixa:', error); return { data: null, error } }
    await reload()
    return { data, error: null }
  }

  return { baixas: data, loading, error, reload, baixar, anularPorFatura }
}
