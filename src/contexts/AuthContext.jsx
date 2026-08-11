import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const AuthContext = createContext(null)

// import.meta.env.DEV is a compile-time constant set by Vite: true only under `vite dev`,
// always false in a `vite build` production bundle (the kind deployed to Vercel) — so this
// auto-login path is physically absent from any production build, regardless of env vars.
const DEV_AUTO_LOGIN = import.meta.env.DEV
const DEV_EMAIL = import.meta.env.VITE_DEV_AUTO_LOGIN_EMAIL
const DEV_PASSWORD = import.meta.env.VITE_DEV_AUTO_LOGIN_PASSWORD

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [devAutoLoginActive, setDevAutoLoginActive] = useState(false)
  // Defaults to 'sales' (least privilege) until we've actually confirmed a role,
  // so nothing admin-only is shown/reachable while this is still resolving.
  const [role, setRole] = useState('sales')
  const [roleLoading, setRoleLoading] = useState(true)
  const [roleDebug, setRoleDebug] = useState('')

  async function loadRole(userId) {
    setRoleLoading(true)
    const { data, error } = await supabase.from('user_roles').select('role').eq('user_id', userId).maybeSingle()
    if (error) {
      // Previously this silently fell back to 'sales' on any failure (RLS issue,
      // schema cache not yet refreshed, network error, ...), which is indistinguishable
      // from "you're genuinely not an admin" — surface it visibly instead.
      setRoleDebug(`query error: ${error.message} (code ${error.code ?? 'n/a'})`)
    } else {
      setRoleDebug(data ? `row found: role="${data.role}"` : 'no row found for this user_id')
    }
    setRole(data?.role ?? 'sales')
    setRoleLoading(false)
  }

  useEffect(() => {
    async function init() {
      const { data } = await supabase.auth.getSession()

      if (!data.session && DEV_AUTO_LOGIN && DEV_EMAIL && DEV_PASSWORD) {
        const { data: signInData, error } = await supabase.auth.signInWithPassword({
          email: DEV_EMAIL,
          password: DEV_PASSWORD,
        })
        if (!error) {
          setSession(signInData.session)
          setDevAutoLoginActive(true)
          setLoading(false)
          await loadRole(signInData.session.user.id)
          return
        }
      }

      setSession(data.session)
      setLoading(false)
      if (data.session) await loadRole(data.session.user.id)
      else setRoleLoading(false)
    }
    init()

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      if (newSession) loadRole(newSession.user.id)
      else {
        setRole('sales')
        setRoleLoading(false)
      }
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  const value = {
    session,
    user: session?.user ?? null,
    loading,
    devAutoLoginActive,
    role,
    roleLoading,
    roleDebug,
    isAdmin: role === 'admin',
    signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
    signOut: () => supabase.auth.signOut(),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
