import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabaseClient'
import { formatMoney, toISODate } from '../lib/format'
import { COMPANY } from '../lib/companyInfo'

export default function Dashboard() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)

  const [todaySales, setTodaySales] = useState(0)
  const [todayPurchases, setTodayPurchases] = useState(0)
  const [todayExpenses, setTodayExpenses] = useState(0)

  const [totalCreditSales, setTotalCreditSales] = useState(0)
  const [creditCollectedToday, setCreditCollectedToday] = useState(0)
  const [totalOutstanding, setTotalOutstanding] = useState(0)

  const [lowStockCount, setLowStockCount] = useState(0)
  const [totalPayable, setTotalPayable] = useState(0)
  const [pettyBalance, setPettyBalance] = useState(0)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const today = toISODate()
    const [
      salesRes,
      purchasesRes,
      pettyExpenseRes,
      stockRes,
      outstandingRes,
      payableRes,
      pettyBalanceRes,
      creditSalesRes,
      creditPaymentsRes,
    ] = await Promise.all([
      supabase.from('sale_invoices').select('total, subtotal').eq('date', today),
      supabase.from('purchase_invoices').select('total, subtotal').eq('date', today),
      supabase.from('expenses').select('amount').eq('date', today).eq('entry_type', 'expense').eq('scope', 'daily'),
      supabase.from('v_current_stock').select('current_stock, low_stock_threshold').eq('is_active', true),
      supabase.from('v_customer_outstanding').select('outstanding'),
      supabase.from('v_supplier_outstanding').select('outstanding'),
      supabase.from('v_petty_cash_balance').select('balance').single(),
      supabase.from('sale_invoices').select('total').eq('payment_type', 'Credit'),
      supabase.from('customer_payments').select('amount').eq('date', today),
    ])

    const salesToday = (salesRes.data ?? []).reduce((sum, s) => sum + s.total, 0)
    const purchasesToday = (purchasesRes.data ?? []).reduce((sum, p) => sum + p.total, 0)
    const expensesToday = (pettyExpenseRes.data ?? []).reduce((sum, e) => sum + e.amount, 0)

    setTodaySales(salesToday)
    setTodayPurchases(purchasesToday)
    setTodayExpenses(expensesToday)

    setTotalCreditSales((creditSalesRes.data ?? []).reduce((sum, s) => sum + s.total, 0))
    setCreditCollectedToday((creditPaymentsRes.data ?? []).reduce((sum, p) => sum + p.amount, 0))
    setTotalOutstanding((outstandingRes.data ?? []).reduce((sum, r) => sum + r.outstanding, 0))

    setLowStockCount((stockRes.data ?? []).filter((p) => p.current_stock <= p.low_stock_threshold).length)
    setTotalPayable((payableRes.data ?? []).reduce((sum, r) => sum + r.outstanding, 0))
    setPettyBalance(pettyBalanceRes.data?.balance ?? 0)

    setLoading(false)
  }

  return (
    <div className="page">
      <h1>Welcome to {COMPANY.name}</h1>
      <p className="muted">Signed in as {user?.email}</p>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <h3>Today's Summary</h3>
          <div className="summary-tiles">
            <div className="tile">
              <div className="tile-label">Today's Sales</div>
              <div className="tile-value">{formatMoney(todaySales)}</div>
            </div>
            <div className="tile">
              <div className="tile-label">Today's Purchases</div>
              <div className="tile-value">{formatMoney(todayPurchases)}</div>
            </div>
            <div className="tile">
              <div className="tile-label">Today's Expenses</div>
              <div className="tile-value">{formatMoney(todayExpenses)}</div>
            </div>
          </div>

          <h3>Outstanding Credit</h3>
          <div className="summary-tiles">
            <div className="tile" style={{ borderColor: 'var(--warning)' }}>
              <div className="tile-label">Total Credit Sales</div>
              <div className="tile-value">{formatMoney(totalCreditSales)}</div>
            </div>
            <div className="tile" style={{ borderColor: 'var(--success)' }}>
              <div className="tile-label">Credit Collected Today</div>
              <div className="tile-value">{formatMoney(creditCollectedToday)}</div>
            </div>
            <div className="tile" style={{ borderColor: 'var(--danger)' }}>
              <div className="tile-label">Outstanding Credit Remaining</div>
              <div className="tile-value">{formatMoney(totalOutstanding)}</div>
            </div>
          </div>

          <h3>At a Glance</h3>
          <div className="summary-tiles">
            <div className="tile">
              <div className="tile-label">Low Stock Items</div>
              <div className="tile-value">{lowStockCount}</div>
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
        </>
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
