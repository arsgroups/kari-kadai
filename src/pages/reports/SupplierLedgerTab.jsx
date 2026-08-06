import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatDate, formatMoney, toISODate } from '../../lib/format'
import ExportButtons from '../../components/ExportButtons'

function firstOfMonth() {
  const d = new Date()
  return toISODate(new Date(d.getFullYear(), d.getMonth(), 1))
}

export default function SupplierLedgerTab() {
  const [suppliers, setSuppliers] = useState([])
  const [supplierId, setSupplierId] = useState('')
  const [from, setFrom] = useState(firstOfMonth())
  const [to, setTo] = useState(toISODate())
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    supabase.from('suppliers').select('id, name').order('name').then(({ data }) => setSuppliers(data ?? []))
  }, [])

  useEffect(() => {
    if (supplierId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId, from, to])

  async function load() {
    setLoading(true)
    const [{ data: invoices }, { data: payments }] = await Promise.all([
      supabase
        .from('purchase_invoices')
        .select('date, invoice_number, total, payment_type')
        .eq('supplier_id', supplierId)
        .gte('date', from)
        .lte('date', to),
      supabase
        .from('supplier_payments')
        .select('date, amount, payment_type, note')
        .eq('supplier_id', supplierId)
        .gte('date', from)
        .lte('date', to),
    ])

    const entries = [
      ...(invoices ?? []).map((i) => ({
        date: i.date,
        type: 'Invoice',
        reference: i.invoice_number,
        credit: i.total,
        debit: 0,
        note: i.payment_type,
      })),
      ...(payments ?? []).map((p) => ({
        date: p.date,
        type: 'Payment',
        reference: p.payment_type,
        credit: 0,
        debit: p.amount,
        note: p.note,
      })),
    ].sort((a, b) => a.date.localeCompare(b.date))

    let running = 0
    const withBalance = entries.map((e) => {
      running += e.credit - e.debit
      return { ...e, balance: running }
    })

    setRows(withBalance)
    setLoading(false)
  }

  const exportRows = rows.map((r) => ({
    date: formatDate(r.date),
    type: r.type,
    reference: r.reference,
    credit: r.credit,
    debit: r.debit,
    balance: r.balance,
  }))

  return (
    <div>
      <div className="card">
        <div className="form-grid">
          <label>
            Supplier
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Select a supplier…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
      </div>

      {supplierId && (
        <>
          <div className="toolbar">
            <ExportButtons
              title="Supplier Ledger"
              filename="supplier_ledger"
              columns={[
                { key: 'date', label: 'Date' },
                { key: 'type', label: 'Type' },
                { key: 'reference', label: 'Reference' },
                { key: 'credit', label: 'Credit (Billed)' },
                { key: 'debit', label: 'Debit (Paid)' },
                { key: 'balance', label: 'Running Balance (We Owe)' },
              ]}
              rows={exportRows}
            />
          </div>
          <div className="card">
            {loading ? (
              <p className="muted">Loading…</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Reference</th>
                    <th>Billed</th>
                    <th>Paid</th>
                    <th>Running Balance (We Owe)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td>{formatDate(r.date)}</td>
                      <td>
                        <span className={r.type === 'Invoice' ? 'tag tag-warning' : 'tag tag-success'}>{r.type}</span>
                      </td>
                      <td>{r.reference}</td>
                      <td>{r.credit ? formatMoney(r.credit) : '—'}</td>
                      <td>{r.debit ? formatMoney(r.debit) : '—'}</td>
                      <td>{formatMoney(r.balance)}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="muted">
                        No activity in this range.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}
