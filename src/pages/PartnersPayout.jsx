import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { formatDate, formatMoney, toISODate } from '../lib/format'
import { round2 } from '../lib/gst'
import { fetchMonthEndRawData } from '../lib/monthEndReportData'
import { computeMonthEndReport } from '../lib/monthEndReport'
import ExportButtons from '../components/ExportButtons'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function monthLabel(year, month) {
  return `${MONTH_NAMES[month - 1]} ${year}`
}

// Same convention as Reports -> Profit Report: a month-end figure is
// normally reviewed once that month has actually closed.
function defaultReportMonth() {
  const now = new Date()
  const currentMonth = now.getMonth() + 1
  return currentMonth === 1 ? { year: now.getFullYear() - 1, month: 12 } : { year: now.getFullYear(), month: currentMonth - 1 }
}

const emptyPartnerForm = { name: '', share_percent: '' }
const emptyPayoutForm = { partner_id: '', date: toISODate(), amount: '', payment_type: 'Bank', note: '' }

// Admin-only module (see AdminRoute on /partners-payout in App.jsx). Two
// things live here: (1) the partner list + profit-share % -- the same
// source Reports -> Profit Report reads its "Partner Share" table from --
// and (2) a log of actual payouts made against each partner's computed
// share of a given month's Final Net Profit, so there's a record of who
// was paid, how much, by what method, and when.
export default function PartnersPayout() {
  const [partners, setPartners] = useState([])
  const [loadingPartners, setLoadingPartners] = useState(true)
  const [partnerForm, setPartnerForm] = useState(emptyPartnerForm)
  const [editingPartnerId, setEditingPartnerId] = useState(null)
  const [partnerSaving, setPartnerSaving] = useState(false)
  const [partnerError, setPartnerError] = useState('')

  const [year, setYear] = useState(defaultReportMonth().year)
  const [month, setMonth] = useState(defaultReportMonth().month)
  const [netProfit, setNetProfit] = useState(null)
  const [loadingProfit, setLoadingProfit] = useState(true)
  const [profitError, setProfitError] = useState('')

  const [payouts, setPayouts] = useState([])
  const [loadingPayouts, setLoadingPayouts] = useState(true)
  const [payoutForm, setPayoutForm] = useState(emptyPayoutForm)
  const [payoutSaving, setPayoutSaving] = useState(false)
  const [payoutError, setPayoutError] = useState('')
  const [deletingPayoutId, setDeletingPayoutId] = useState(null)

  const period = `${year}-${String(month).padStart(2, '0')}`

  async function loadPartners() {
    setLoadingPartners(true)
    const { data, error } = await supabase.from('partners').select('*').order('share_percent', { ascending: false })
    if (error) setPartnerError(error.message)
    else setPartners(data ?? [])
    setLoadingPartners(false)
  }

  async function loadProfit() {
    setLoadingProfit(true)
    setProfitError('')
    try {
      const raw = await fetchMonthEndRawData({ year, month })
      const report = computeMonthEndReport(raw)
      setNetProfit(report.current.finalNetProfit)
    } catch (e) {
      setProfitError(e.message)
      setNetProfit(null)
    }
    setLoadingProfit(false)
  }

  async function loadPayouts() {
    setLoadingPayouts(true)
    const { data, error } = await supabase
      .from('partner_payouts')
      .select('*, partners(name)')
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
    if (error) setPayoutError(error.message)
    else setPayouts(data ?? [])
    setLoadingPayouts(false)
  }

  useEffect(() => {
    loadPartners()
    loadPayouts()
  }, [])

  useEffect(() => {
    loadProfit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month])

  const activePartners = partners.filter((p) => p.is_active)
  const totalSharePercent = round2(activePartners.reduce((s, p) => s + Number(p.share_percent), 0))

  function paidForPartnerThisPeriod(partnerId) {
    return round2(
      payouts.filter((p) => p.partner_id === partnerId && p.period === period).reduce((s, p) => s + Number(p.amount), 0)
    )
  }

  // ---- Partner CRUD ----
  function startEditPartner(p) {
    setPartnerForm({ name: p.name, share_percent: String(p.share_percent) })
    setEditingPartnerId(p.id)
    setPartnerError('')
  }

  function cancelEditPartner() {
    setPartnerForm(emptyPartnerForm)
    setEditingPartnerId(null)
  }

  async function handlePartnerSubmit(e) {
    e.preventDefault()
    if (!partnerForm.name.trim() || partnerForm.share_percent === '') {
      setPartnerError('Enter a partner name and share percentage.')
      return
    }
    setPartnerSaving(true)
    setPartnerError('')
    const payload = { name: partnerForm.name.trim(), share_percent: Number(partnerForm.share_percent) }
    const { error } = editingPartnerId
      ? await supabase.from('partners').update(payload).eq('id', editingPartnerId)
      : await supabase.from('partners').insert(payload)
    setPartnerSaving(false)
    if (error) {
      setPartnerError(error.message)
      return
    }
    setPartnerForm(emptyPartnerForm)
    setEditingPartnerId(null)
    loadPartners()
  }

  async function handleToggleActive(p) {
    const { error } = await supabase.from('partners').update({ is_active: !p.is_active }).eq('id', p.id)
    if (error) {
      setPartnerError(error.message)
      return
    }
    loadPartners()
  }

  async function handleDeletePartner(p) {
    if (!window.confirm(`Delete partner "${p.name}"? Any logged payouts for them will be deleted too.`)) return
    const { error } = await supabase.from('partners').delete().eq('id', p.id)
    if (error) {
      setPartnerError(error.message)
      return
    }
    loadPartners()
    loadPayouts()
  }

  // ---- Payout logging ----
  async function handlePayoutSubmit(e) {
    e.preventDefault()
    if (!payoutForm.partner_id || !payoutForm.date || Number(payoutForm.amount) <= 0) {
      setPayoutError('Select a partner, date, and an amount greater than 0.')
      return
    }
    setPayoutSaving(true)
    setPayoutError('')
    const { error } = await supabase.from('partner_payouts').insert({
      partner_id: payoutForm.partner_id,
      date: payoutForm.date,
      amount: round2(Number(payoutForm.amount)),
      payment_type: payoutForm.payment_type,
      period,
      note: payoutForm.note || null,
    })
    setPayoutSaving(false)
    if (error) {
      setPayoutError(error.message)
      return
    }
    setPayoutForm({ ...emptyPayoutForm, date: toISODate() })
    loadPayouts()
  }

  async function handleDeletePayout(p) {
    if (!window.confirm('Delete this payout record? This cannot be undone.')) return
    setDeletingPayoutId(p.id)
    const { error } = await supabase.from('partner_payouts').delete().eq('id', p.id)
    setDeletingPayoutId(null)
    if (error) {
      setPayoutError(error.message)
      return
    }
    loadPayouts()
  }

  const exportRows = payouts.map((p) => ({
    date: formatDate(p.date),
    partner: p.partners?.name ?? '—',
    period: p.period ?? '—',
    amount: p.amount,
    payment_type: p.payment_type,
    note: p.note ?? '',
  }))

  return (
    <div className="page">
      <h1>Partners Payout</h1>
      <p className="muted" style={{ marginTop: '-0.5rem' }}>
        Manage each partner's profit-share percentage (feeds Reports → Profit Report), see their computed share
        of a month's Final Net Profit, and log actual payouts made to them.
      </p>

      <div className="card">
        <h3>Partners &amp; Share %</h3>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          Active shares should add up to 100% — currently{' '}
          <strong style={totalSharePercent === 100 ? undefined : { color: 'var(--danger)' }}>{totalSharePercent}%</strong>.
        </p>
        <form className="form-grid" onSubmit={handlePartnerSubmit}>
          <label>
            Partner Name
            <input
              value={partnerForm.name}
              onChange={(e) => setPartnerForm({ ...partnerForm, name: e.target.value })}
              placeholder="e.g. Ali"
              required
            />
          </label>
          <label>
            Share %
            <input
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={partnerForm.share_percent}
              onChange={(e) => setPartnerForm({ ...partnerForm, share_percent: e.target.value })}
              required
            />
          </label>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.5rem' }}>
            <button className="btn" type="submit" disabled={partnerSaving}>
              {partnerSaving ? 'Saving…' : editingPartnerId ? 'Update' : 'Add Partner'}
            </button>
            {editingPartnerId && (
              <button type="button" className="btn-secondary" onClick={cancelEditPartner}>
                Cancel
              </button>
            )}
          </div>
        </form>
        {partnerError && <div className="inline-error">{partnerError}</div>}

        {loadingPartners ? (
          <p className="muted">Loading…</p>
        ) : (
          <table className="data-table" style={{ marginTop: '1rem' }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Share %</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {partners.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.share_percent}%</td>
                  <td>
                    <span className={p.is_active ? 'tag tag-success' : 'tag tag-warning'}>
                      {p.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <button className="btn-secondary" onClick={() => startEditPartner(p)}>
                      Edit
                    </button>{' '}
                    <button className="btn-secondary" onClick={() => handleToggleActive(p)}>
                      {p.is_active ? 'Deactivate' : 'Activate'}
                    </button>{' '}
                    <button className="btn-danger" onClick={() => handleDeletePartner(p)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {partners.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No partners added yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>Net Margin by Partner</h3>
        <div className="form-grid">
          <label>
            Month / Year
            <input
              type="month"
              value={period}
              onChange={(e) => {
                const [y, m] = e.target.value.split('-').map(Number)
                setYear(y)
                setMonth(m)
              }}
            />
          </label>
        </div>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          Final Net Profit for {monthLabel(year, month)}:{' '}
          <strong>{loadingProfit ? 'Calculating…' : netProfit != null ? formatMoney(netProfit) : '—'}</strong>{' '}
          (same figure as Reports → Profit Report / Month End Report (GP) for this month).
        </p>
        {profitError && <div className="inline-error">{profitError}</div>}

        {!loadingProfit && !loadingPayouts && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Partner</th>
                <th>Share %</th>
                <th>Computed Share</th>
                <th>Paid This Month</th>
                <th>Balance</th>
              </tr>
            </thead>
            <tbody>
              {activePartners.map((p) => {
                const share = netProfit != null ? round2(netProfit * (p.share_percent / 100)) : null
                const paid = paidForPartnerThisPeriod(p.id)
                const balance = share != null ? round2(share - paid) : null
                return (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{p.share_percent}%</td>
                    <td>{share != null ? formatMoney(share) : '—'}</td>
                    <td>{formatMoney(paid)}</td>
                    <td>
                      {balance != null ? (
                        <span className={balance === 0 ? 'tag tag-success' : 'tag tag-warning'}>{formatMoney(balance)}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                )
              })}
              {activePartners.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No active partners — add one above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>Log a Payout</h3>
        <form className="form-grid" onSubmit={handlePayoutSubmit}>
          <label>
            Partner (Party)
            <select
              value={payoutForm.partner_id}
              onChange={(e) => setPayoutForm({ ...payoutForm, partner_id: e.target.value })}
              required
            >
              <option value="">Select a partner…</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date
            <input type="date" value={payoutForm.date} onChange={(e) => setPayoutForm({ ...payoutForm, date: e.target.value })} required />
          </label>
          <label>
            Amount
            <input
              type="number"
              step="0.01"
              min="0"
              value={payoutForm.amount}
              onChange={(e) => setPayoutForm({ ...payoutForm, amount: e.target.value })}
              required
            />
          </label>
          <label>
            Mode of Payment
            <select value={payoutForm.payment_type} onChange={(e) => setPayoutForm({ ...payoutForm, payment_type: e.target.value })}>
              <option>Cash</option>
              <option>Bank</option>
            </select>
          </label>
          <label>
            Note
            <input value={payoutForm.note} onChange={(e) => setPayoutForm({ ...payoutForm, note: e.target.value })} placeholder="Optional" />
          </label>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button className="btn" type="submit" disabled={payoutSaving}>
              {payoutSaving ? 'Saving…' : `Log Payout for ${monthLabel(year, month)}`}
            </button>
          </div>
        </form>
        {payoutError && <div className="inline-error">{payoutError}</div>}
      </div>

      <div className="card">
        <div className="toolbar" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>Payout History</h3>
          <ExportButtons
            title="Partner Payouts"
            filename="partner_payouts"
            columns={[
              { key: 'date', label: 'Date' },
              { key: 'partner', label: 'Partner' },
              { key: 'period', label: 'Period' },
              { key: 'amount', label: 'Amount', money: true },
              { key: 'payment_type', label: 'Mode of Payment' },
              { key: 'note', label: 'Note' },
            ]}
            rows={exportRows}
          />
        </div>
        {loadingPayouts ? (
          <p className="muted">Loading…</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Partner</th>
                <th>Period</th>
                <th>Amount</th>
                <th>Mode of Payment</th>
                <th>Note</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((p) => (
                <tr key={p.id}>
                  <td>{formatDate(p.date)}</td>
                  <td>{p.partners?.name ?? '—'}</td>
                  <td>{p.period ?? '—'}</td>
                  <td>{formatMoney(p.amount)}</td>
                  <td>{p.payment_type}</td>
                  <td>{p.note}</td>
                  <td>
                    <button className="btn-danger" disabled={deletingPayoutId === p.id} onClick={() => handleDeletePayout(p)}>
                      {deletingPayoutId === p.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
              {payouts.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    No payouts logged yet.
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
