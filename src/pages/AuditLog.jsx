import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

function formatTimestamp(value) {
  return new Date(value).toLocaleString('en-SG')
}

export default function AuditLog() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(300)
    if (error) setError(error.message)
    else setRows(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  return (
    <div className="page">
      <h1>Audit Log</h1>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        Automatic record of who did what — invoices, payments, item/customer/supplier changes, promotions,
        role changes, and daily closings. Most recent 300 entries.
      </p>

      <div className="card">
        {error && <div className="inline-error">{error}</div>}
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Activity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{formatTimestamp(r.created_at)}</td>
                  <td>{r.user_email}</td>
                  <td>{r.action}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    No activity recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
