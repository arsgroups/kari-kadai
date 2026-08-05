import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabaseClient'
import { formatMoney, toISODate } from '../lib/format'

export default function Dashboard() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [todaySales, setTodaySales] = useState(0)
  const [lowStockCount, setLowStockCount] = useState(0)
  const [totalOutstanding, setTotalOutstanding] = useState(0)
  const [totalPayable, setTotalPayable] = useState(0)
  const [pettyBalance, setPettyBalance] = useState(0)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const today = toISODate()
    const [salesRes, stockRes, outstandingRes, payableRes, pettyRes] = await Promise.all([
      supabase.from('sales').select('total').eq('date', today),
      supabase.from('v_current_stock').select('current_stock, low_stock_threshold').eq('is_active', true),
      supabase.from('v_customer_outstanding').select('outstanding'),
      supabase.from('v_supplier_outstanding').select('outstanding'),
      supabase.from('v_petty_cash_balance').select('balance').single(),
    ])
    setTodaySales((salesRes.data ?? []).reduce((sum, s) => sum + s.total, 0))
    setLowStockCount((stockRes.data ?? []).filter((p) => p.current_stock <= p.low_stock_threshold).length)
    setTotalOutstanding((outstandingRes.data ?? []).reduce((sum, r) => sum + r.outstanding, 0))
    setTotalPayable((payableRes.data ?? []).reduce((sum, r) => sum + r.outstanding, 0))
    setPettyBalance(pettyRes.data?.balance ?? 0)
    setLoading(false)
  }

  return (
    <div className="page">
      <h1>Welcome to Kari Kadai</h1>
      <p className="muted">Signed in as {user?.email}</p>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="summary-tiles">
          <div className="tile">
            <div className="tile-label">Today's Sales</div>
            <div className="tile-value">{formatMoney(todaySales)}</div>
          </div>
          <div className="tile">
            <div className="tile-label">Low Stock Items</div>
            <div className="tile-value">{lowStockCount}</div>
          </div>
          <div className="tile">
            <div className="tile-label">Total Outstanding</div>
            <div className="tile-value">{formatMoney(totalOutstanding)}</div>
          </div>
          <div className="tile">
            <div className="tile-label">Total Payable</div>
            <div className="tile-value">{formatMoney(totalPayable)}</div>
          </div>
          <div className="tile">
            <div className="tile-label">Petty Cash Balance</div>
            <div className="tile-value">{formatMoney(pettyBalance)}</div>
          </div>
        </div>
      )}

      <div className="card">
        <h3>Quick links</h3>
        <p>
          <Link to="/sales">Record a sale</Link> · <Link to="/purchases">Record a purchase</Link> ·{' '}
          <Link to="/closing">Do today's closing</Link> · <Link to="/reports">View trends & P&amp;L</Link>
        </p>
      </div>
    </div>
  )
}
