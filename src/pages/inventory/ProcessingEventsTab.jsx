import { Fragment, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatDate, formatMoney, toISODate } from '../../lib/format'
import { round2 } from '../../lib/gst'

export default function ProcessingEventsTab() {
  const [configs, setConfigs] = useState([]) // active yield configs, with parent info + current stock/cost
  const [parentId, setParentId] = useState('')
  const [date, setDate] = useState(toISODate())
  const [quantityProcessed, setQuantityProcessed] = useState('')
  const [note, setNote] = useState('')
  const [childRows, setChildRows] = useState([]) // [{ child_product_id, name, quantity_yielded }]
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [expandedId, setExpandedId] = useState(null)
  const [itemsByEvent, setItemsByEvent] = useState({})

  async function loadConfigs() {
    const { data: configData } = await supabase
      .from('yield_configurations')
      .select('id, parent_product_id, products(name, unit, average_cost)')
      .eq('is_active', true)

    const [{ data: stockData }] = await Promise.all([supabase.from('v_current_stock').select('product_id, current_stock')])
    const stockByProduct = {}
    ;(stockData ?? []).forEach((s) => {
      stockByProduct[s.product_id] = s.current_stock
    })

    const withChildrenAndStock = await Promise.all(
      (configData ?? []).map(async (c) => {
        const { data: items } = await supabase
          .from('yield_configuration_items')
          .select('child_product_id, products(name, unit)')
          .eq('yield_configuration_id', c.id)
          .eq('is_active', true)
        return {
          ...c,
          currentStock: stockByProduct[c.parent_product_id] ?? 0,
          items: items ?? [],
        }
      })
    )
    setConfigs(withChildrenAndStock)
  }

  async function loadHistory() {
    setHistoryLoading(true)
    const { data } = await supabase
      .from('processing_events')
      .select('id, date, quantity_processed, unit_cost, note, products(name, unit)')
      .order('date', { ascending: false })
      .limit(100)
    setHistory(data ?? [])
    setHistoryLoading(false)
  }

  useEffect(() => {
    loadConfigs()
    loadHistory()
  }, [])

  function selectParent(id) {
    setParentId(id)
    const config = configs.find((c) => c.parent_product_id === id)
    setChildRows(
      (config?.items ?? []).map((i) => ({
        child_product_id: i.child_product_id,
        name: i.products?.name,
        unit: i.products?.unit,
        quantity_yielded: '',
      }))
    )
  }

  const selectedConfig = configs.find((c) => c.parent_product_id === parentId)
  const parentAvgCost = selectedConfig?.products?.average_cost ?? 0
  const totalYielded = round2(childRows.reduce((sum, r) => sum + (Number(r.quantity_yielded) || 0), 0))
  const waste = round2((Number(quantityProcessed) || 0) - totalYielded)
  const wasteValue = round2(waste * parentAvgCost)

  async function toggleExpand(eventId) {
    if (expandedId === eventId) {
      setExpandedId(null)
      return
    }
    setExpandedId(eventId)
    if (!itemsByEvent[eventId]) {
      const { data } = await supabase
        .from('processing_event_items')
        .select('id, quantity_yielded, unit_cost, allocated_cost, products(name, unit)')
        .eq('processing_event_id', eventId)
      setItemsByEvent({ ...itemsByEvent, [eventId]: data ?? [] })
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSuccess('')

    const validChildren = childRows.filter((r) => Number(r.quantity_yielded) > 0)
    if (!parentId || !quantityProcessed || validChildren.length === 0) {
      setError('Select a parent item, a quantity processed, and at least one yielded amount.')
      return
    }
    if (Number(quantityProcessed) > selectedConfig.currentStock) {
      setError(`Only ${selectedConfig.currentStock} ${selectedConfig.products?.unit} of this item is in stock.`)
      return
    }
    if (waste < 0) {
      setError('Yielded quantities add up to more than the quantity processed — check your entries.')
      return
    }

    setSaving(true)

    const { data: event, error: eventError } = await supabase
      .from('processing_events')
      .insert({
        date,
        parent_product_id: parentId,
        quantity_processed: Number(quantityProcessed),
        unit_cost: parentAvgCost,
        note: note || null,
      })
      .select()
      .single()

    if (eventError) {
      setSaving(false)
      setError(eventError.message)
      return
    }

    const { error: itemsError } = await supabase.from('processing_event_items').insert(
      validChildren.map((r) => ({
        processing_event_id: event.id,
        child_product_id: r.child_product_id,
        quantity_yielded: Number(r.quantity_yielded),
        unit_cost: parentAvgCost,
      }))
    )

    setSaving(false)
    if (itemsError) {
      setError(`Event saved, but yield items failed: ${itemsError.message}`)
      return
    }

    setSuccess(
      `Processed ${quantityProcessed} ${selectedConfig.products?.unit} — yielded ${totalYielded}, waste ${waste} (${formatMoney(wasteValue)}).`
    )
    setQuantityProcessed('')
    setNote('')
    selectParent(parentId) // reset child quantity inputs, keep same parent selected
    loadConfigs()
    loadHistory()
  }

  return (
    <div>
      <div className="card">
        <h3>New Processing Event</h3>
        {configs.length === 0 && !historyLoading && (
          <p className="muted">
            No yield configurations set up yet — go to the Yield Configuration tab first to define
            which sale items a purchased item can be cut into.
          </p>
        )}
        <div className="form-grid">
          <label>
            Parent (Purchased) Item
            <select value={parentId} onChange={(e) => selectParent(e.target.value)}>
              <option value="">Select…</option>
              {configs.map((c) => (
                <option key={c.parent_product_id} value={c.parent_product_id}>
                  {c.products?.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          {selectedConfig && (
            <>
              <label>
                Current Stock
                <input value={`${selectedConfig.currentStock} ${selectedConfig.products?.unit}`} disabled />
              </label>
              <label>
                Average Cost
                <input value={`${formatMoney(parentAvgCost)} / ${selectedConfig.products?.unit}`} disabled />
              </label>
              <label>
                Quantity Processed
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={quantityProcessed}
                  onChange={(e) => setQuantityProcessed(e.target.value)}
                  required
                />
              </label>
            </>
          )}
        </div>

        {selectedConfig && childRows.length > 0 && (
          <>
            <table className="data-table" style={{ marginTop: '1.25rem' }}>
              <thead>
                <tr>
                  <th>Sale Item</th>
                  <th>Quantity Yielded</th>
                  <th>Allocated Cost</th>
                </tr>
              </thead>
              <tbody>
                {childRows.map((row, i) => (
                  <tr key={row.child_product_id}>
                    <td>{row.name}</td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        style={{ width: 100 }}
                        value={row.quantity_yielded}
                        onChange={(e) =>
                          setChildRows(
                            childRows.map((r, j) => (j === i ? { ...r, quantity_yielded: e.target.value } : r))
                          )
                        }
                      />{' '}
                      {row.unit}
                    </td>
                    <td>{formatMoney((Number(row.quantity_yielded) || 0) * parentAvgCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="card" style={{ marginTop: '1rem', maxWidth: 360 }}>
              <table className="data-table">
                <tbody>
                  <tr>
                    <td>Quantity Processed</td>
                    <td>
                      {quantityProcessed || 0} {selectedConfig.products?.unit}
                    </td>
                  </tr>
                  <tr>
                    <td>Total Yielded</td>
                    <td>
                      {totalYielded} {selectedConfig.products?.unit}
                    </td>
                  </tr>
                  <tr style={{ fontWeight: 700 }}>
                    <td>Waste / Loss</td>
                    <td>
                      <span className={waste > 0 ? 'tag tag-warning' : waste < 0 ? 'tag tag-danger' : 'tag tag-success'}>
                        {waste} {selectedConfig.products?.unit} ({formatMoney(wasteValue)})
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <label style={{ display: 'block', marginTop: '1rem', maxWidth: 400 }}>
              Note
              <input value={note} onChange={(e) => setNote(e.target.value)} />
            </label>

            <button className="btn" style={{ marginTop: '1rem' }} onClick={handleSubmit} disabled={saving}>
              {saving ? 'Saving…' : 'Save Processing Event'}
            </button>
          </>
        )}
        {error && <div className="inline-error">{error}</div>}
        {success && <div style={{ color: 'var(--success)', marginTop: '0.5rem' }}>{success}</div>}
      </div>

      <div className="card">
        <h3>Processing History</h3>
        {historyLoading ? (
          <p className="muted">Loading…</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th></th>
                <th>Date</th>
                <th>Parent Item</th>
                <th>Processed</th>
                <th>Unit Cost</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <Fragment key={h.id}>
                  <tr>
                    <td>
                      <button className="btn-secondary" onClick={() => toggleExpand(h.id)}>
                        {expandedId === h.id ? '−' : '+'}
                      </button>
                    </td>
                    <td>{formatDate(h.date)}</td>
                    <td>{h.products?.name}</td>
                    <td>
                      {h.quantity_processed} {h.products?.unit}
                    </td>
                    <td>{formatMoney(h.unit_cost)}</td>
                    <td>{h.note}</td>
                  </tr>
                  {expandedId === h.id && (
                    <tr>
                      <td></td>
                      <td colSpan={5}>
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>Sale Item</th>
                              <th>Quantity Yielded</th>
                              <th>Allocated Cost</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(itemsByEvent[h.id] ?? []).map((it) => (
                              <tr key={it.id}>
                                <td>{it.products?.name}</td>
                                <td>
                                  {it.quantity_yielded} {it.products?.unit}
                                </td>
                                <td>{formatMoney(it.allocated_cost)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {history.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    No processing events yet.
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
