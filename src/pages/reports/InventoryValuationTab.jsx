import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatMoney } from '../../lib/format'
import ExportButtons from '../../components/ExportButtons'
import ReportPrintHeader from '../../components/ReportPrintHeader'

export default function InventoryValuationTab() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const [{ data: stock }, { data: products }] = await Promise.all([
      supabase
        .from('v_current_stock')
        .select('product_id, name, category, unit, current_stock, is_active')
        .eq('is_active', true)
        .order('name'),
      supabase.from('products').select('id, average_cost, default_purchase_price'),
    ])

    const costByProduct = {}
    ;(products ?? []).forEach((p) => {
      costByProduct[p.id] = p.average_cost || p.default_purchase_price || 0
    })

    const enriched = (stock ?? []).map((p) => {
      const costRate = costByProduct[p.product_id] ?? 0
      return { ...p, costRate, value: (p.current_stock ?? 0) * costRate }
    })

    setRows(enriched)
    setLoading(false)
  }

  const totalValue = rows.reduce((sum, r) => sum + r.value, 0)

  const exportRows = rows.map((r) => ({
    name: r.name,
    category: r.category,
    current_stock: r.current_stock,
    unit: r.unit,
    cost_rate: r.costRate,
    value: r.value,
  }))

  return (
    <div>
      <ReportPrintHeader title="Inventory Valuation" />
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        Valuation uses each item's running weighted-average cost (updated by purchases and, for
        cut/processed items, their allocated processing cost) — falling back to its default purchase
        price if it has no cost history yet.
      </p>
      <div className="toolbar">
        <div className="tile" style={{ margin: 0 }}>
          <div className="tile-label">Total Inventory Value</div>
          <div className="tile-value">{formatMoney(totalValue)}</div>
        </div>
        <ExportButtons
          title="Inventory Valuation"
          filename="inventory_valuation"
          columns={[
            { key: 'name', label: 'Item' },
            { key: 'category', label: 'Category' },
            { key: 'current_stock', label: 'Current Stock' },
            { key: 'unit', label: 'Unit' },
            { key: 'cost_rate', label: 'Cost Rate', money: true },
            { key: 'value', label: 'Value', money: true },
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
                <th>Item</th>
                <th>Category</th>
                <th>Current Stock</th>
                <th>Cost Rate</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.product_id}>
                  <td>{r.name}</td>
                  <td>{r.category}</td>
                  <td>
                    {r.current_stock} {r.unit}
                  </td>
                  <td>{formatMoney(r.costRate)}</td>
                  <td>{formatMoney(r.value)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No active items.
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
