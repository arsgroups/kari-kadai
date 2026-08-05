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
          return
        }
      }

      setSession(data.session)
      setLoading(false)
    }
    init()

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  const value = {
    session,
    user: session?.user ?? null,
    loading,
    devAutoLoginActive,
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
