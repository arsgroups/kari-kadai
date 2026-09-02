import { useEffect, useState } from 'react'
import { websiteSupabase } from '../lib/websiteSupabaseClient'
import { formatMoney } from '../lib/format'

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Order Placed' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'preparing', label: 'Preparing' },
  { value: 'ready', label: 'Ready for Pickup' },
  { value: 'out_for_delivery', label: 'Out for Delivery' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

function StaffLogin({ onSignedIn }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    const { error } = await websiteSupabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) setError(error.message)
    else onSignedIn()
  }

  return (
    <form className="auth-card" onSubmit={handleSubmit}>
      <h1>Website Orders</h1>
      <p className="auth-subtitle">
        Sign in with the staff login for the website orders project (separate from your main login above).
      </p>
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
      </label>
      <label>
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      {error && <div className="auth-error">{error}</div>}
      <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  )
}

function OrdersTable() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingId, setSavingId] = useState(null)

  async function load() {
    setLoading(true)
    const { data, error } = await websiteSupabase
      .from('website_orders')
      .select('*, website_order_items(*)')
      .order('created_at', { ascending: false })
    if (error) setError(error.message)
    else setRows(data)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function updateStatus(id, status) {
    setSavingId(id)
    const { error } = await websiteSupabase.from('website_orders').update({ status }).eq('id', id)
    setSavingId(null)
    if (error) {
      setError(error.message)
      return
    }
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)))
  }

  if (loading) return <p className="muted">Loading…</p>

  return (
    <div className="card">
      {error && <div className="inline-error">{error}</div>}
      <table className="data-table">
        <thead>
          <tr>
            <th>Order Ref</th>
            <th>Date</th>
            <th>Customer</th>
            <th>Items</th>
            <th>Total</th>
            <th>Payment</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id}>
              <td>{o.order_ref}</td>
              <td>{new Date(o.created_at).toLocaleString('en-SG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
              <td>
                {o.customer_name}
                <br />
                <span className="muted" style={{ fontSize: '0.8rem' }}>{o.customer_phone}</span>
              </td>
              <td>
                {(o.website_order_items || []).map((i) => (
                  <div key={i.id} style={{ fontSize: '0.85rem' }}>
                    {i.product_name}{i.cut_option ? ` (${i.cut_option})` : ''} &times; {i.qty}kg
                  </div>
                ))}
              </td>
              <td>{formatMoney(o.subtotal)}</td>
              <td>{o.payment_method === 'cod' ? 'Cash on Delivery' : 'PayNow'}</td>
              <td>
                <select
                  value={o.status}
                  disabled={savingId === o.id}
                  onChange={(e) => updateStatus(o.id, e.target.value)}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="muted">No website orders yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

export default function WebsiteOrders() {
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    websiteSupabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = websiteSupabase.auth.onAuthStateChange((_event, session) => setSession(session))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (session === undefined) return <p className="muted" style={{ padding: '2rem' }}>Loading…</p>

  if (!session) {
    return (
      <div className="page">
        <h1>Website Orders</h1>
        <StaffLogin onSignedIn={() => {}} />
      </div>
    )
  }

  return (
    <div className="page">
      <div className="toolbar" style={{ justifyContent: 'space-between' }}>
        <h1>Website Orders</h1>
        <button className="btn-secondary" onClick={() => websiteSupabase.auth.signOut()}>
          Sign out (website orders)
        </button>
      </div>
      <OrdersTable />
    </div>
  )
}
