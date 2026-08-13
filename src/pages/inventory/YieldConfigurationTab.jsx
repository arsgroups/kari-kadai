import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

export default function YieldConfigurationTab() {
  const [products, setProducts] = useState([])
  const [configs, setConfigs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const [editingId, setEditingId] = useState(null) // null = not editing, 'new' = creating
  const [parentId, setParentId] = useState('')
  const [childRows, setChildRows] = useState([]) // [{ child_product_id, is_active }]

  async function load() {
    setLoading(true)
    const [{ data: productData }, { data: configData }] = await Promise.all([
      supabase.from('products').select('id, name').eq('is_active', true).order('name'),
      supabase
        .from('yield_configurations')
        .select('id, parent_product_id, is_active, products(name)')
        .order('created_at', { ascending: false }),
    ])
    setProducts(productData ?? [])

    const withChildren = await Promise.all(
      (configData ?? []).map(async (c) => {
        const { data: items } = await supabase
          .from('yield_configuration_items')
          .select('id, child_product_id, is_active, products(name)')
          .eq('yield_configuration_id', c.id)
        return { ...c, items: items ?? [] }
      })
    )
    setConfigs(withChildren)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  function startNew() {
    setEditingId('new')
    setParentId('')
    setChildRows([{ child_product_id: '', is_active: true }])
  }

  function startEdit(config) {
    setEditingId(config.id)
    setParentId(config.parent_product_id)
    setChildRows(
      config.items.length > 0
        ? config.items.map((i) => ({ child_product_id: i.child_product_id, is_active: i.is_active }))
        : [{ child_product_id: '', is_active: true }]
    )
  }

  function addChildRow() {
    setChildRows([...childRows, { child_product_id: '', is_active: true }])
  }

  function updateChildRow(index, patch) {
    setChildRows(childRows.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  function removeChildRow(index) {
    setChildRows(childRows.filter((_, i) => i !== index))
  }

  async function handleSave() {
    setError('')
    const validChildren = childRows.filter((r) => r.child_product_id)
    if (!parentId || validChildren.length === 0) {
      setError('Select a parent item and at least one child sale item.')
      return
    }
    if (validChildren.some((r) => r.child_product_id === parentId)) {
      setError('A child item cannot be the same as the parent item.')
      return
    }
    const seen = new Set()
    const duplicate = validChildren.find((r) => {
      if (seen.has(r.child_product_id)) return true
      seen.add(r.child_product_id)
      return false
    })
    if (duplicate) {
      const name = products.find((p) => p.id === duplicate.child_product_id)?.name ?? 'that item'
      setError(`${name} is selected more than once — each sale item can only be added once per configuration.`)
      return
    }
    setSaving(true)

    let configId = editingId !== 'new' ? editingId : null
    if (!configId) {
      const { data, error: cfgErr } = await supabase
        .from('yield_configurations')
        .insert({ parent_product_id: parentId })
        .select()
        .single()
      if (cfgErr) {
        setSaving(false)
        setError(cfgErr.message)
        return
      }
      configId = data.id
    } else {
      // Remove existing child rows, then re-insert current set (simplest way to sync add/remove/edits).
      await supabase.from('yield_configuration_items').delete().eq('yield_configuration_id', configId)
    }

    const { error: itemsErr } = await supabase.from('yield_configuration_items').insert(
      validChildren.map((r) => ({
        yield_configuration_id: configId,
        child_product_id: r.child_product_id,
        is_active: r.is_active,
      }))
    )

    setSaving(false)
    if (itemsErr) {
      setError(
        itemsErr.code === '23505'
          ? 'One of these sale items is already configured under a different parent — each sale item can only belong to one parent.'
          : itemsErr.message
      )
      return
    }
    setEditingId(null)
    load()
  }

  const configuredParentIds = new Set(configs.map((c) => c.parent_product_id))
  const availableParents = products.filter(
    (p) => !configuredParentIds.has(p.id) || p.id === parentId
  )

  return (
    <div>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        Define which sale items a purchased item can be cut into (e.g. Mutton → Bone Mutton,
        Boneless Mutton, ...). No separate cutting step to record — selling a configured item
        automatically deducts that weight straight from the parent's stock, and uses the parent's
        average cost for that item's margin reporting. Each sale item can only belong to one parent.
      </p>

      <div className="toolbar">
        <button className="btn" onClick={startNew}>
          + New Yield Configuration
        </button>
      </div>

      {editingId && (
        <div className="card">
          <h3>{editingId === 'new' ? 'New Yield Configuration' : 'Edit Yield Configuration'}</h3>
          <label style={{ display: 'block', maxWidth: 320, marginBottom: '1rem' }}>
            Parent (Purchased) Item
            <select value={parentId} onChange={(e) => setParentId(e.target.value)} disabled={editingId !== 'new'}>
              <option value="">Select…</option>
              {availableParents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <table className="data-table">
            <thead>
              <tr>
                <th>Child (Sale) Item</th>
                <th>Active</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {childRows.map((row, i) => (
                <tr key={i}>
                  <td>
                    <select
                      value={row.child_product_id}
                      onChange={(e) => updateChildRow(i, { child_product_id: e.target.value })}
                    >
                      <option value="">Select item…</option>
                      {products
                        .filter(
                          (p) =>
                            p.id !== parentId &&
                            (p.id === row.child_product_id ||
                              !childRows.some((r) => r.child_product_id === p.id))
                        )
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={row.is_active}
                      onChange={(e) => updateChildRow(i, { is_active: e.target.checked })}
                    />
                  </td>
                  <td>
                    <button type="button" className="btn-secondary" onClick={() => removeChildRow(i)}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="btn-secondary" style={{ marginTop: '0.75rem' }} onClick={addChildRow}>
            + Add Sale Item
          </button>

          <div className="toolbar" style={{ marginTop: '1rem' }}>
            <button className="btn" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save Configuration'}
            </button>
            <button className="btn-secondary" onClick={() => setEditingId(null)}>
              Cancel
            </button>
          </div>
          {error && <div className="inline-error">{error}</div>}
        </div>
      )}

      <div className="card">
        <h3>Configured Items</h3>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Parent Item</th>
                <th>Sale Items</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {configs.map((c) => (
                <tr key={c.id}>
                  <td>{c.products?.name}</td>
                  <td>
                    {c.items
                      .filter((i) => i.is_active)
                      .map((i) => i.products?.name)
                      .join(', ') || '—'}
                  </td>
                  <td>
                    <button className="btn-secondary" onClick={() => startEdit(c)}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
              {configs.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    No yield configurations yet.
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
