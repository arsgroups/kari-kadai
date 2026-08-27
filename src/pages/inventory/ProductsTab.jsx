import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { toISODate } from '../../lib/format'
import { round2 } from '../../lib/gst'
import { UNIT_OPTIONS, conversionFactor } from '../../lib/units'
import { useAuth } from '../../contexts/AuthContext'

const CHANNELS = ['Restaurant', 'Home Delivery', 'Counter']

// Fixed category choices, ordered to match how the meat counter is
// organized (mirrors the Mutton/Chicken/Beef section order used on printed
// quotations). "Others" reveals a free-text field for anything outside
// this list.
const CATEGORY_OPTIONS = [
  'Mutton',
  'Mutton Parts',
  'Mutton Boneless',
  'Chicken',
  'Chicken Parts',
  'Chicken Boneless',
  'Beef',
  'Beef Boneless',
  'Beef Parts',
]

function defaultChannels() {
  return Object.fromEntries(CHANNELS.map((ch) => [ch, { is_visible: true, display_name: '' }]))
}

const emptyForm = {
  id: null,
  name: '',
  category: '',
  description: '',
  unit: 'Kg',
  purchase_unit: 'Kg',
  sales_unit: 'Kg',
  default_purchase_price: '',
  default_selling_price: '',
  restaurant_price: '',
  counter_price: '',
  low_stock_threshold: 0,
  opening_stock: 0,
  opening_stock_value: 0,
  opening_stock_date: toISODate(),
  is_active: true,
  supplier_only: false,
  channels: defaultChannels(),
}

export default function ProductsTab() {
  const { isAdmin } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [showForm, setShowForm] = useState(false)
  const [lowStockOnly, setLowStockOnly] = useState(false)
  const [saving, setSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [channelFilters, setChannelFilters] = useState([])
  const [supplierFilter, setSupplierFilter] = useState(false)
  const [priceEdits, setPriceEdits] = useState({}) // product_id -> new default_selling_price (string)
  const [savingPrices, setSavingPrices] = useState(false)
  const [stockEdits, setStockEdits] = useState({}) // product_id -> new current stock quantity (string)
  const [savingStock, setSavingStock] = useState(false)

  async function load() {
    setLoading(true)
    const [{ data, error }, { data: yieldData }, { data: channelData }, { data: priceData }] = await Promise.all([
      supabase.from('v_current_stock').select('*').order('name'),
      supabase
        .from('yield_configuration_items')
        .select('child_product_id, is_active, yield_configurations!inner(is_active, products(name))')
        .eq('is_active', true)
        .eq('yield_configurations.is_active', true),
      supabase.from('product_channel_config').select('product_id, channel, is_visible'),
      supabase.from('products').select('id, default_selling_price'),
    ])
    if (error) setError(error.message)
    else {
      const parentNameByChild = {}
      ;(yieldData ?? []).forEach((y) => {
        parentNameByChild[y.child_product_id] = y.yield_configurations?.products?.name
      })
      const hiddenChannelsByProduct = {}
      ;(channelData ?? []).forEach((c) => {
        if (c.is_visible === false) {
          hiddenChannelsByProduct[c.product_id] = [...(hiddenChannelsByProduct[c.product_id] ?? []), c.channel]
        }
      })
      const pricesByProduct = {}
      ;(priceData ?? []).forEach((p) => {
        pricesByProduct[p.id] = p
      })
      setRows(
        data.map((r) => ({
          ...r,
          cutFrom: parentNameByChild[r.product_id] ?? null,
          hiddenChannels: hiddenChannelsByProduct[r.product_id] ?? [],
          prices: pricesByProduct[r.product_id] ?? null,
        }))
      )
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function startEdit(row) {
    const [{ data }, { data: channelRows }] = await Promise.all([
      supabase.from('products').select('*').eq('id', row.product_id).single(),
      supabase.from('product_channel_config').select('channel, is_visible, display_name').eq('product_id', row.product_id),
    ])
    if (!data) return
    const channels = defaultChannels()
    ;(channelRows ?? []).forEach((c) => {
      channels[c.channel] = { is_visible: c.is_visible, display_name: c.display_name ?? '' }
    })
    setForm({
      id: data.id,
      name: data.name,
      category: data.category,
      description: data.description ?? '',
      unit: data.unit,
      purchase_unit: data.purchase_unit,
      sales_unit: data.sales_unit,
      default_purchase_price: data.default_purchase_price ?? '',
      default_selling_price: data.default_selling_price ?? '',
      restaurant_price: data.restaurant_price ?? '',
      counter_price: data.counter_price ?? '',
      low_stock_threshold: data.low_stock_threshold,
      opening_stock: data.opening_stock,
      opening_stock_value: data.opening_stock_value,
      opening_stock_date: data.opening_stock_date ?? toISODate(),
      is_active: data.is_active,
      item_code: data.item_code,
      supplier_only: data.supplier_only ?? false,
      channels,
    })
    setShowForm(true)
  }

  function startNew() {
    setForm(emptyForm)
    setShowForm(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const payload = {
      name: form.name,
      category: form.category || 'Others',
      description: form.description || null,
      unit: form.unit || 'Kg',
      purchase_unit: form.purchase_unit || form.unit || 'Kg',
      sales_unit: form.sales_unit || form.unit || 'Kg',
      purchase_to_inventory_factor: conversionFactor(form.purchase_unit, form.unit),
      sales_to_inventory_factor: conversionFactor(form.sales_unit, form.unit),
      default_purchase_price: form.default_purchase_price === '' ? null : Number(form.default_purchase_price),
      default_selling_price: form.default_selling_price === '' ? null : Number(form.default_selling_price),
      restaurant_price: form.restaurant_price === '' ? null : Number(form.restaurant_price),
      counter_price: form.counter_price === '' ? null : Number(form.counter_price),
      low_stock_threshold: Number(form.low_stock_threshold) || 0,
      is_active: form.is_active,
      supplier_only: form.supplier_only,
    }
    if (!form.id) {
      // Opening stock only applies at creation — editing later shouldn't re-log a movement.
      payload.opening_stock = Number(form.opening_stock) || 0
      payload.opening_stock_value = Number(form.opening_stock_value) || 0
      payload.opening_stock_date = form.opening_stock_date || toISODate()
    }
    const { data: savedProduct, error } = form.id
      ? await supabase.from('products').update(payload).eq('id', form.id).select().single()
      : await supabase.from('products').insert(payload).select().single()

    if (error) {
      setSaving(false)
      setError(error.message)
      return
    }

    const channelError = await saveChannelConfig(savedProduct.id, form.channels)
    setSaving(false)
    if (channelError) {
      setError(channelError)
      return
    }
    setShowForm(false)
    setForm(emptyForm)
    load()
  }

  async function saveChannelConfig(productId, channels) {
    const toUpsert = []
    const toDelete = []
    CHANNELS.forEach((ch) => {
      const cfg = channels[ch]
      const isDefault = cfg.is_visible !== false && !cfg.display_name
      if (isDefault) toDelete.push(ch)
      else toUpsert.push({ product_id: productId, channel: ch, is_visible: cfg.is_visible, display_name: cfg.display_name || null })
    })
    if (toUpsert.length) {
      const { error } = await supabase.from('product_channel_config').upsert(toUpsert, { onConflict: 'product_id,channel' })
      if (error) return error.message
    }
    if (toDelete.length) {
      const { error } = await supabase
        .from('product_channel_config')
        .delete()
        .eq('product_id', productId)
        .in('channel', toDelete)
      if (error) return error.message
    }
    return null
  }

  function updatePriceEdit(productId, value) {
    setPriceEdits((prev) => ({ ...prev, [productId]: value }))
  }

  function discardPriceEdits() {
    setPriceEdits({})
  }

  async function savePriceEdits() {
    setSavingPrices(true)
    setError('')
    const results = await Promise.all(
      Object.entries(priceEdits).map(([productId, value]) =>
        supabase
          .from('products')
          .update({ default_selling_price: value === '' ? null : Number(value) })
          .eq('id', productId)
      )
    )
    setSavingPrices(false)
    const failed = results.find((r) => r.error)
    if (failed) {
      setError(failed.error.message)
      return
    }
    setPriceEdits({})
    load()
  }

  function updateStockEdit(productId, value) {
    setStockEdits((prev) => ({ ...prev, [productId]: value }))
  }

  function discardStockEdits() {
    setStockEdits({})
  }

  // Sets current stock to exactly what's typed, via a single 'adjustment'
  // stock movement for the delta -- not a separate "opening stock" field,
  // so purchases/sales continue moving stock from here as normal.
  async function saveStockEdits() {
    setSavingStock(true)
    setError('')
    const today = toISODate()
    const results = await Promise.all(
      Object.entries(stockEdits).map(([productId, value]) => {
        const row = rows.find((r) => r.product_id === productId)
        const target = value === '' ? 0 : Number(value)
        const delta = round2(target - (row?.current_stock ?? 0))
        if (delta === 0) return Promise.resolve({ error: null })
        return supabase.from('stock_movements').insert({
          date: today,
          product_id: productId,
          movement_type: 'adjustment',
          quantity: delta,
          reference_type: 'manual',
          note: 'Bulk stock adjustment (Inventory table)',
        })
      })
    )
    setSavingStock(false)
    const failed = results.find((r) => r.error)
    if (failed) {
      setError(failed.error.message)
      return
    }
    setStockEdits({})
    load()
  }

  async function toggleActive(row) {
    await supabase.from('products').update({ is_active: !row.is_active }).eq('id', row.product_id)
    load()
  }

  async function handleDelete() {
    if (!form.id) return
    if (!window.confirm(`Delete "${form.name}"? This cannot be undone.`)) return
    setSaving(true)
    setError('')
    const { error } = await supabase.from('products').delete().eq('id', form.id)
    setSaving(false)
    if (error) {
      setError(
        error.code === '23503'
          ? 'This item can’t be deleted because it’s linked to existing sales, purchases, or stock records. Use Deactivate instead.'
          : error.message
      )
      return
    }
    setShowForm(false)
    setForm(emptyForm)
    load()
  }

  function toggleChannelFilter(ch) {
    setChannelFilters((prev) => (prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch]))
  }

  function clearAdvancedFilters() {
    setChannelFilters([])
    setSupplierFilter(false)
  }

  // Anything already stored that isn't one of the fixed options (blank, or a
  // legacy free-text category) falls under "Others" so its custom field shows.
  const categorySelectValue =
    form.category === '' ? '' : CATEGORY_OPTIONS.includes(form.category) ? form.category : 'Others'
  const searchTerm = searchQuery.trim().toLowerCase()
  const visibleRows = rows.filter((r) => {
    if (lowStockOnly && (r.cutFrom || r.current_stock > r.low_stock_threshold)) return false
    if (searchTerm) {
      const matches = r.name?.toLowerCase().includes(searchTerm) || r.item_code?.toLowerCase().includes(searchTerm)
      if (!matches) return false
    }
    if (channelFilters.length > 0 && !channelFilters.some((ch) => !r.hiddenChannels.includes(ch))) return false
    if (supplierFilter && !r.supplier_only) return false
    return true
  })

  return (
    <div>
      <div className="toolbar">
        <button className="btn" onClick={startNew}>
          + Add Item
        </button>
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by name or item code…"
          style={{ minWidth: 220 }}
        />
        <button
          className={lowStockOnly ? 'btn' : 'btn-secondary'}
          onClick={() => setLowStockOnly((v) => !v)}
        >
          {lowStockOnly ? 'Showing: Low stock only' : 'Show low stock only'}
        </button>
        <button
          className={showAdvanced ? 'btn' : 'btn-secondary'}
          onClick={() => setShowAdvanced((v) => !v)}
        >
          Advanced Search{channelFilters.length > 0 || supplierFilter ? ' (active)' : ''}
        </button>
        {Object.keys(priceEdits).length > 0 && (
          <>
            <button className="btn" disabled={savingPrices} onClick={savePriceEdits}>
              {savingPrices ? 'Saving…' : `Save Price Changes (${Object.keys(priceEdits).length})`}
            </button>
            <button className="btn-secondary" disabled={savingPrices} onClick={discardPriceEdits}>
              Discard
            </button>
          </>
        )}
        {Object.keys(stockEdits).length > 0 && (
          <>
            <button className="btn" disabled={savingStock} onClick={saveStockEdits}>
              {savingStock ? 'Saving…' : `Save Stock Changes (${Object.keys(stockEdits).length})`}
            </button>
            <button className="btn-secondary" disabled={savingStock} onClick={discardStockEdits}>
              Discard
            </button>
          </>
        )}
      </div>

      {showAdvanced && (
        <div className="card">
          <h3 style={{ marginBottom: '0.5rem' }}>Advanced Search</h3>
          <p className="muted" style={{ fontSize: '0.8rem', marginTop: 0 }}>
            Tick one or more channels to show items visible in any of them; tick Supplier item to also require that
            flag.
          </p>
          <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {CHANNELS.map((ch) => (
              <label key={ch} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <input type="checkbox" checked={channelFilters.includes(ch)} onChange={() => toggleChannelFilter(ch)} />
                {ch}
              </label>
            ))}
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <input type="checkbox" checked={supplierFilter} onChange={(e) => setSupplierFilter(e.target.checked)} />
              Supplier item
            </label>
            {(channelFilters.length > 0 || supplierFilter) && (
              <button className="btn-secondary" onClick={clearAdvancedFilters}>
                Clear Filters
              </button>
            )}
          </div>
        </div>
      )}

      {showForm && (
        <div className="card">
          <h3>{form.id ? `Edit Item ${form.item_code ? `(${form.item_code})` : ''}` : 'New Item'}</h3>
          <form className="form-grid" onSubmit={handleSubmit}>
            <label>
              Name
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </label>
            <label>
              Category
              <select
                value={categorySelectValue}
                onChange={(e) => {
                  const val = e.target.value
                  setForm({ ...form, category: val === 'Others' ? '' : val })
                }}
              >
                <option value="" disabled>
                  Select category…
                </option>
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                <option value="Others">Others</option>
              </select>
            </label>
            {categorySelectValue === 'Others' && (
              <label>
                Custom Category
                <input
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder="Enter category name"
                />
              </label>
            )}
            <label>
              Description
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
            <label>
              Inventory (Stock) Unit
              <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                {UNIT_OPTIONS.map((u) => (
                  <option key={u} value={u}>
                    {u === 'Unit' ? 'Per Unit' : u === 'Kg' ? 'Per Kg' : 'Per Gram (g)'}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Purchase Unit
              <select value={form.purchase_unit} onChange={(e) => setForm({ ...form, purchase_unit: e.target.value })}>
                {UNIT_OPTIONS.map((u) => (
                  <option key={u} value={u}>
                    {u === 'Unit' ? 'Per Unit' : u === 'Kg' ? 'Per Kg' : 'Per Gram (g)'}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Sales Unit
              <select value={form.sales_unit} onChange={(e) => setForm({ ...form, sales_unit: e.target.value })}>
                {UNIT_OPTIONS.map((u) => (
                  <option key={u} value={u}>
                    {u === 'Unit' ? 'Per Unit' : u === 'Kg' ? 'Per Kg' : 'Per Gram (g)'}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Default Purchase Price
              <input
                type="number"
                step="0.01"
                value={form.default_purchase_price}
                onChange={(e) => setForm({ ...form, default_purchase_price: e.target.value })}
              />
            </label>
            <label>
              Default Selling Price
              <input
                type="number"
                step="0.01"
                value={form.default_selling_price}
                onChange={(e) => setForm({ ...form, default_selling_price: e.target.value })}
              />
            </label>
            <label>
              Restaurant Selling Price
              <input
                type="number"
                step="0.01"
                placeholder="Falls back to Default Selling Price"
                value={form.restaurant_price}
                onChange={(e) => setForm({ ...form, restaurant_price: e.target.value })}
              />
            </label>
            <label>
              Counter / Home Delivery Selling Price
              <input
                type="number"
                step="0.01"
                placeholder="Falls back to Default Selling Price"
                value={form.counter_price}
                onChange={(e) => setForm({ ...form, counter_price: e.target.value })}
              />
            </label>
            <label>
              Minimum Stock
              <input
                type="number"
                step="0.01"
                value={form.low_stock_threshold}
                onChange={(e) => setForm({ ...form, low_stock_threshold: e.target.value })}
              />
            </label>
            {!form.id && (
              <>
                <label>
                  Opening Stock
                  <input
                    type="number"
                    step="0.01"
                    value={form.opening_stock}
                    onChange={(e) => setForm({ ...form, opening_stock: e.target.value })}
                  />
                </label>
                <label>
                  Opening Stock Value (SGD)
                  <input
                    type="number"
                    step="0.01"
                    value={form.opening_stock_value}
                    onChange={(e) => setForm({ ...form, opening_stock_value: e.target.value })}
                  />
                </label>
                <label>
                  Opening Stock Date
                  <input
                    type="date"
                    value={form.opening_stock_date}
                    onChange={(e) => setForm({ ...form, opening_stock_date: e.target.value })}
                  />
                </label>
              </>
            )}
            <div className="channel-config" style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.6rem' }}>
                <input
                  type="checkbox"
                  checked={form.supplier_only}
                  onChange={(e) => setForm({ ...form, supplier_only: e.target.checked })}
                />
                <strong>Supplier item</strong>
                <span className="muted" style={{ fontSize: '0.8rem' }}>
                  — tick this to make the item selectable on a Purchase Invoice; use Channel Availability below to
                  control Sales visibility separately
                </span>
              </label>
              <h4 style={{ marginBottom: '0.2rem' }}>Channel Availability</h4>
              <p className="muted" style={{ fontSize: '0.8rem', marginTop: 0 }}>
                By default this item shows in every sales channel under its own name. Uncheck a channel to hide it
                there, or give it a different name for that channel (e.g. "Mutton" in Restaurant, "Fresh Goat/Lamb"
                elsewhere).
              </p>
              {CHANNELS.map((ch) => (
                <div key={ch} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.4rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', minWidth: 150 }}>
                    <input
                      type="checkbox"
                      checked={form.channels[ch].is_visible}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          channels: { ...form.channels, [ch]: { ...form.channels[ch], is_visible: e.target.checked } },
                        })
                      }
                    />
                    {ch}
                  </label>
                  <input
                    placeholder={`Name in ${ch} (optional)`}
                    value={form.channels[ch].display_name}
                    disabled={!form.channels[ch].is_visible}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        channels: { ...form.channels, [ch]: { ...form.channels[ch], display_name: e.target.value } },
                      })
                    }
                  />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn" type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setShowForm(false)
                  setForm(emptyForm)
                }}
              >
                Cancel
              </button>
              {form.id && isAdmin && (
                <button type="button" className="btn-danger" disabled={saving} onClick={handleDelete}>
                  Delete
                </button>
              )}
            </div>
          </form>
          {error && <div className="inline-error">{error}</div>}
        </div>
      )}

      <div className="card">
        <p className="muted" style={{ fontSize: '0.8rem', marginTop: 0 }}>
          Current Stock is editable directly — type the actual quantity on hand and Save Stock Changes;
          it's recorded as a single adjustment entry, so purchases and sales continue to move stock
          normally from whatever you set. (Items cut from another item aren't editable here — their stock
          always derives from the parent item.)
        </p>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Item Code</th>
                <th>Name</th>
                <th>Current Stock</th>
                <th>Price</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r) => {
                const low = !r.cutFrom && r.current_stock <= r.low_stock_threshold
                return (
                  <tr key={r.product_id}>
                    <td>{r.item_code}</td>
                    <td>
                      {r.name}
                      {r.cutFrom && (
                        <div className="muted" style={{ fontSize: '0.75rem' }}>
                          Cut from {r.cutFrom}
                        </div>
                      )}
                      {r.supplier_only && (
                        <div className="muted" style={{ fontSize: '0.75rem' }}>
                          Supplier item
                        </div>
                      )}
                      {r.hiddenChannels.length > 0 && (
                        <div className="muted" style={{ fontSize: '0.75rem' }}>
                          Hidden from: {r.hiddenChannels.join(', ')}
                        </div>
                      )}
                    </td>
                    <td>
                      {r.cutFrom ? (
                        <>
                          {r.current_stock} {r.unit}
                        </>
                      ) : (
                        <>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            style={{ width: 80 }}
                            value={r.product_id in stockEdits ? stockEdits[r.product_id] : r.current_stock}
                            onChange={(e) => updateStockEdit(r.product_id, e.target.value)}
                          />{' '}
                          {r.unit}
                        </>
                      )}{' '}
                      {low && <span className="tag tag-danger">Low</span>}
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        style={{ width: 90 }}
                        value={r.product_id in priceEdits ? priceEdits[r.product_id] : r.prices?.default_selling_price ?? ''}
                        onChange={(e) => updatePriceEdit(r.product_id, e.target.value)}
                      />
                    </td>
                    <td>
                      <span className={r.is_active ? 'tag tag-success' : 'tag tag-muted'}>
                        {r.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <button className="btn-secondary" onClick={() => startEdit(r)}>
                        Edit
                      </button>{' '}
                      <button className="btn-secondary" onClick={() => toggleActive(r)}>
                        {r.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                )
              })}
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    No items found.
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
