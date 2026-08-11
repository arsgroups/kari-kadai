import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

const CHANNELS = ['Restaurant', 'Home Delivery', 'Counter']

export default function ChannelItemsTab() {
  const [channel, setChannel] = useState('Restaurant')
  const [products, setProducts] = useState([])
  const [configByProduct, setConfigByProduct] = useState({}) // product_id -> { display_name, is_visible }
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    setSuccess('')
    const [{ data: productData }, { data: configData }] = await Promise.all([
      supabase.from('products').select('id, name').eq('is_active', true).order('name'),
      supabase.from('product_channel_config').select('product_id, display_name, is_visible').eq('channel', channel),
    ])
    setProducts(productData ?? [])
    const map = {}
    ;(configData ?? []).forEach((row) => {
      map[row.product_id] = { display_name: row.display_name ?? '', is_visible: row.is_visible }
    })
    setConfigByProduct(map)
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel])

  function updateRow(productId, patch) {
    setConfigByProduct({
      ...configByProduct,
      [productId]: { display_name: '', is_visible: true, ...configByProduct[productId], ...patch },
    })
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    setSuccess('')

    const toUpsert = []
    const toDeleteProductIds = []

    for (const p of products) {
      const cfg = configByProduct[p.id]
      const isDefault = !cfg || (!cfg.display_name && cfg.is_visible !== false)
      if (isDefault) {
        toDeleteProductIds.push(p.id)
      } else {
        toUpsert.push({
          product_id: p.id,
          channel,
          display_name: cfg.display_name || null,
          is_visible: cfg.is_visible !== false,
        })
      }
    }

    if (toDeleteProductIds.length > 0) {
      await supabase
        .from('product_channel_config')
        .delete()
        .eq('channel', channel)
        .in('product_id', toDeleteProductIds)
    }
    if (toUpsert.length > 0) {
      const { error } = await supabase
        .from('product_channel_config')
        .upsert(toUpsert, { onConflict: 'product_id,channel' })
      if (error) {
        setSaving(false)
        setError(error.message)
        return
      }
    }

    setSaving(false)
    setSuccess(`Saved ${channel} channel configuration.`)
    load()
  }

  return (
    <div>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        By default every item shows in every channel under its own name. Use this to rename an item
        for a specific channel (e.g. "Mutton" in Restaurant, "Fresh Goat/Lamb" in Counter and Home
        Delivery) or hide it from a channel entirely — the underlying item and its stock stay the
        same either way.
      </p>

      <div className="toolbar">
        {CHANNELS.map((c) => (
          <button key={c} className={c === channel ? 'btn' : 'btn-secondary'} onClick={() => setChannel(c)}>
            {c}
          </button>
        ))}
      </div>

      <div className="card">
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Display Name in {channel}</th>
                  <th>Visible in {channel}</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const cfg = configByProduct[p.id] ?? { display_name: '', is_visible: true }
                  return (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td>
                        <input
                          value={cfg.display_name}
                          placeholder={p.name}
                          onChange={(e) => updateRow(p.id, { display_name: e.target.value })}
                          style={{ width: 200 }}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={cfg.is_visible !== false}
                          onChange={(e) => updateRow(p.id, { is_visible: e.target.checked })}
                        />
                      </td>
                    </tr>
                  )
                })}
                {products.length === 0 && (
                  <tr>
                    <td colSpan={3} className="muted">
                      No active items yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <button className="btn" style={{ marginTop: '1rem' }} onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : `Save ${channel} Configuration`}
            </button>
            {error && <div className="inline-error">{error}</div>}
            {success && <div style={{ color: 'var(--success)', marginTop: '0.5rem' }}>{success}</div>}
          </>
        )}
      </div>
    </div>
  )
}
