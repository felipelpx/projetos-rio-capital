import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://esymjdrvcpwsoevnqljq.supabase.co'
const SUPABASE_KEY = 'sb_publishable_wwQ5479wErQBOzCY-LIcZQ_ORo6VhUW'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
