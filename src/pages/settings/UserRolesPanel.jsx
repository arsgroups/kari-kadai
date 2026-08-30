import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../contexts/AuthContext'

export default function UserRolesPanel() {
  const { user: currentUser } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingId, setSavingId] = useState(null)

  async function load() {
    setLoading(true)
    setError('')
    const [{ data: users, error: userErr }, { data: roles }] = await Promise.all([
      supabase.rpc('admin_user_directory'),
      supabase.from('user_roles').select('user_id, role'),
    ])
    if (userErr) {
      setError(userErr.message)
      setLoading(false)
      return
    }
    const roleByUser = {}
    ;(roles ?? []).forEach((r) => {
      roleByUser[r.user_id] = r.role
    })
    setRows(
      (users ?? [])
        .map((u) => ({ ...u, role: roleByUser[u.user_id] ?? 'sales' }))
        .sort((a, b) => (a.email || '').localeCompare(b.email || ''))
    )
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function handleRoleChange(userId, role) {
    setSavingId(userId)
    setError('')
    const { error } = await supabase.from('user_roles').upsert({ user_id: userId, role }, { onConflict: 'user_id' })
    setSavingId(null)
    if (error) {
      setError(error.message)
      return
    }
    load()
  }

  return (
    <div className="card">
      <h3>User Roles</h3>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        <strong>Admin</strong> sees everything. <strong>Sales</strong> has Monthly Expenses, GST, Reports,
        and Settings hidden and blocked. Any login not listed here (or shown as "sales" below) defaults
        to Sales automatically.
      </p>
      {error && <div className="inline-error">{error}</div>}
      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.user_id}>
                <td>
                  {r.email}
                  {r.user_id === currentUser?.id && <span className="tag tag-muted" style={{ marginLeft: '0.4rem' }}>You</span>}
                </td>
                <td>
                  <select
                    value={r.role}
                    disabled={savingId === r.user_id}
                    onChange={(e) => handleRoleChange(r.user_id, e.target.value)}
                  >
                    <option value="sales">Sales</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={2} className="muted">
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  )
}
