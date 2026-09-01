import { Fragment, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { formatDate, formatMoney, toISODate } from '../lib/format'
import { round2 } from '../lib/gst'
import { useAuth } from '../contexts/AuthContext'

const emptyForm = {
  date: toISODate(),
  partner_name: '',
  transaction_type: 'contribution',
  reference: '',
}

function emptyLineItem() {
  return { key: crypto.randomUUID(), description: '', amount: '' }
}

// Partner contributions and withdrawals -- kept entirely separate from
// operating income/expense, and from the Month-End Report's P&L (Reports ->
// Month-End Report reads this table for its Capital section, but nothing
// here ever flows into Revenue/COGS/Expenses). Each transaction is "one
// batch of capital along with the detail": its amount is always the sum of
// its own itemized detail lines (description + $), not a separately typed
// figure that could drift out of sync -- same convention as a Sale
// Invoice's total being built from its line items.
export default function Capital() {
  const { isAdmin } = useAuth()
  const [rows, setRows] = useState([])
  const [itemsByTransaction, setItemsByTransaction] = useState({}) // transaction_id -> items[]
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [lineItems, setLineItems] = useState([emptyLineItem()])
  const [editingId, setEditingId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [expandedId, setExpandedId] = useState(null)

  async function load() {
    setLoading(true)
    const [{ data: txRows, error: txError }, { data: itemRows }] = await Promise.all([
      supabase.from('capital_transactions').select('*').order('date', { ascending: false }),
      supabase.from('capital_transaction_items').select('*').order('created_at'),
    ])
    if (txError) setError(txError.message)
    else setRows(txRows ?? [])
    const grouped = {}
    ;(itemRows ?? []).forEach((it) => {
      if (!grouped[it.capital_transaction_id]) grouped[it.capital_transaction_id] = []
      grouped[it.capital_transaction_id].push(it)
    })
    setItemsByTransaction(grouped)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  function updateLineItem(key, patch) {
    setLineItems((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function addLineItem() {
    setLineItems((prev) => [...prev, emptyLineItem()])
  }

  function removeLineItem(key) {
    setLineItems((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev))
  }

  const validLineItems = lineItems.filter((l) => l.description.trim() && Number(l.amount) > 0)
  const lineItemsTotal = round2(validLineItems.reduce((sum, l) => sum + Number(l.amount), 0))

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.partner_name.trim()) {
      setError('Enter the partner / investor name.')
      return
    }
    if (validLineItems.length === 0) {
      setError('Add at least one detail line with a description and amount.')
      return
    }
    setSaving(true)
    setError('')

    const payload = {
      date: form.date,
      partner_name: form.partner_name.trim(),
      transaction_type: form.transaction_type,
      amount: lineItemsTotal,
      reference: form.reference || null,
    }

    let transactionId = editingId
    if (editingId) {
      const { error: updErr } = await supabase.from('capital_transactions').update(payload).eq('id', editingId)
      if (updErr) {
        setSaving(false)
        setError(updErr.message)
        return
      }
      const { error: delErr } = await supabase.from('capital_transaction_items').delete().eq('capital_transaction_id', editingId)
      if (delErr) {
        setSaving(false)
        setError(delErr.message)
        return
      }
    } else {
      const { data: created, error: insErr } = await supabase.from('capital_transactions').insert(payload).select().single()
      if (insErr) {
        setSaving(false)
        setError(insErr.message)
        return
      }
      transactionId = created.id
    }

    const itemRows = validLineItems.map((l) => ({
      capital_transaction_id: transactionId,
      description: l.description.trim(),
      amount: round2(Number(l.amount)),
    }))
    const { error: itemsErr } = await supabase.from('capital_transaction_items').insert(itemRows)
    setSaving(false)
    if (itemsErr) {
      setError(`Saved, but detail lines failed: ${itemsErr.message}`)
      return
    }

    setForm(emptyForm)
    setLineItems([emptyLineItem()])
    setEditingId(null)
    load()
  }

  function startEdit(row) {
    setForm({
      date: row.date,
      partner_name: row.partner_name,
      transaction_type: row.transaction_type,
      reference: row.reference ?? '',
    })
    const existingItems = itemsByTransaction[row.id] ?? []
    setLineItems(
      existingItems.length
        ? existingItems.map((it) => ({ key: it.id, description: it.description, amount: String(it.amount) }))
        : [emptyLineItem()]
    )
    setEditingId(row.id)
    setError('')
  }

  function cancelEdit() {
    setForm(emptyForm)
    setLineItems([emptyLineItem()])
    setEditingId(null)
  }

  async function handleDelete(row) {
    if (!window.confirm('Delete this capital transaction and its detail lines? This cannot be undone.')) return
    setDeletingId(row.id)
    const { error } = await supabase.from('capital_transactions').delete().eq('id', row.id)
    setDeletingId(null)
    if (error) {
      setError(error.message)
      return
    }
    load()
  }

  const totalContributions = round2(rows.filter((r) => r.transaction_type === 'contribution').reduce((s, r) => s + r.amount, 0))
  const totalWithdrawals = round2(rows.filter((r) => r.transaction_type === 'withdrawal').reduce((s, r) => s + r.amount, 0))
  const netCapital = round2(totalContributions - totalWithdrawals)

  return (
    <div className="page">
      <h1>Capital</h1>
      <p className="muted" style={{ marginTop: '-0.5rem' }}>
        Partner contributions and withdrawals only -- kept separate from operating income and expenses. Feeds
        the Capital section of Reports → Month-End Report.
      </p>

      <div className="summary-tiles">
        <div className="tile">
          <div className="tile-label">Total Contributions</div>
          <div className="tile-value">{formatMoney(totalContributions)}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Total Withdrawals</div>
          <div className="tile-value">{formatMoney(totalWithdrawals)}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Net Capital (all-time)</div>
          <div className="tile-value">{formatMoney(netCapital)}</div>
        </div>
      </div>

      <div className="card">
        <h3>{editingId ? 'Edit Capital Transaction' : 'Log Capital Transaction'}</h3>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          One batch of capital, along with the detail behind it — add as many description + amount lines as
          needed below; the transaction's total is always their sum.
        </p>
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <label>
              Date
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
            </label>
            <label>
              Partner / Investor
              <input
                value={form.partner_name}
                onChange={(e) => setForm({ ...form, partner_name: e.target.value })}
                placeholder="e.g. Ali"
                required
              />
            </label>
            <label>
              Transaction Type
              <select value={form.transaction_type} onChange={(e) => setForm({ ...form, transaction_type: e.target.value })}>
                <option value="contribution">Contribution</option>
                <option value="withdrawal">Withdrawal / Drawings</option>
              </select>
            </label>
            <label>
              Reference / Remarks
              <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="e.g. bank ref no." />
            </label>
          </div>

          <h4 style={{ marginTop: '1.25rem', marginBottom: '0.4rem' }}>Detail Lines</h4>
          <table className="data-table" style={{ maxWidth: 640 }}>
            <thead>
              <tr>
                <th>Description</th>
                <th>Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map((l) => (
                <tr key={l.key}>
                  <td>
                    <input
                      style={{ width: 260 }}
                      value={l.description}
                      onChange={(e) => updateLineItem(l.key, { description: e.target.value })}
                      placeholder="e.g. Cash deposited to bank"
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      style={{ width: 120 }}
                      value={l.amount}
                      onChange={(e) => updateLineItem(l.key, { amount: e.target.value })}
                    />
                  </td>
                  <td>
                    <button type="button" className="btn-secondary" onClick={() => removeLineItem(l.key)} disabled={lineItems.length === 1}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 700 }}>
                <td>Total</td>
                <td>{formatMoney(lineItemsTotal)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
          <div className="toolbar" style={{ marginTop: '0.5rem' }}>
            <button type="button" className="btn-secondary" onClick={addLineItem}>
              + Add Detail Line
            </button>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.25rem' }}>
            <button className="btn" type="submit" disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Update' : 'Add Transaction'}
            </button>
            {editingId && (
              <button type="button" className="btn-secondary" onClick={cancelEdit}>
                Cancel
              </button>
            )}
          </div>
        </form>
        {error && <div className="inline-error">{error}</div>}
      </div>

      <div className="card">
        <h3>Capital Transactions</h3>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Partner / Investor</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Reference</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const items = itemsByTransaction[r.id] ?? []
                const isExpanded = expandedId === r.id
                return (
                  <Fragment key={r.id}>
                    <tr>
                      <td>{formatDate(r.date)}</td>
                      <td>{r.partner_name}</td>
                      <td>
                        <span className={r.transaction_type === 'contribution' ? 'tag tag-success' : 'tag tag-warning'}>
                          {r.transaction_type === 'contribution' ? 'Contribution' : 'Withdrawal'}
                        </span>
                      </td>
                      <td>{formatMoney(r.amount)}</td>
                      <td>{r.reference}</td>
                      <td>
                        {items.length > 0 && (
                          <>
                            <button className="btn-secondary" onClick={() => setExpandedId(isExpanded ? null : r.id)}>
                              {isExpanded ? 'Hide' : `Details (${items.length})`}
                            </button>{' '}
                          </>
                        )}
                        <button className="btn-secondary" onClick={() => startEdit(r)}>
                          Edit
                        </button>{' '}
                        {isAdmin && (
                          <button className="btn-danger" disabled={deletingId === r.id} onClick={() => handleDelete(r)}>
                            {deletingId === r.id ? 'Deleting…' : 'Delete'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td></td>
                        <td colSpan={5}>
                          <table className="data-table" style={{ maxWidth: 480 }}>
                            <thead>
                              <tr>
                                <th>Description</th>
                                <th>Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {items.map((it) => (
                                <tr key={it.id}>
                                  <td>{it.description}</td>
                                  <td>{formatMoney(it.amount)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    No capital transactions logged yet.
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
