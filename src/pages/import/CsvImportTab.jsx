import { useEffect, useState } from 'react'
import Papa from 'papaparse'
import { supabase } from '../../lib/supabaseClient'
import { toISODate } from '../../lib/format'

const OUR_FIELDS = [
  { key: 'date', label: 'Date' },
  { key: 'supplier', label: 'Supplier Name' },
  { key: 'product', label: 'Product Name' },
  { key: 'quantity', label: 'Quantity' },
  { key: 'cost_price', label: 'Cost Price (per unit)' },
  { key: 'payment_type', label: 'Payment Type (Cash/Bank/Credit)' },
]

export default function CsvImportTab() {
  const [mappings, setMappings] = useState([])
  const [selectedMappingId, setSelectedMappingId] = useState('')
  const [csvHeaders, setCsvHeaders] = useState([])
  const [csvRows, setCsvRows] = useState([])
  const [fileName, setFileName] = useState('')
  const [columnMap, setColumnMap] = useState({})
  const [newMappingName, setNewMappingName] = useState('')
  const [saveAsNew, setSaveAsNew] = useState(false)
  const [suppliers, setSuppliers] = useState([])
  const [products, setProducts] = useState([])
  const [error, setError] = useState('')
  const [committing, setCommitting] = useState(false)
  const [result, setResult] = useState(null)

  useEffect(() => {
    loadMappings()
    supabase.from('suppliers').select('id, name').then(({ data }) => setSuppliers(data ?? []))
    supabase.from('products').select('id, name').then(({ data }) => setProducts(data ?? []))
  }, [])

  async function loadMappings() {
    const { data } = await supabase
      .from('csv_import_mappings')
      .select('*')
      .eq('source_type', 'purchases')
      .order('name')
    setMappings(data ?? [])
  }

  function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    setFileName(file.name)
    setResult(null)
    setError('')
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        setCsvHeaders(results.meta.fields ?? [])
        setCsvRows(results.data)
      },
      error: (err) => setError(err.message),
    })
  }

  function applyMapping(mappingId) {
    setSelectedMappingId(mappingId)
    const mapping = mappings.find((m) => m.id === mappingId)
    if (mapping) setColumnMap(mapping.column_mapping)
  }

  const mappingComplete = OUR_FIELDS.every((f) => columnMap[f.key])

  const previewRows = mappingComplete
    ? csvRows.slice(0, 10).map((row) => ({
        date: row[columnMap.date],
        supplier: row[columnMap.supplier],
        product: row[columnMap.product],
        quantity: row[columnMap.quantity],
        cost_price: row[columnMap.cost_price],
        payment_type: row[columnMap.payment_type],
      }))
    : []

  function findMatch(list, name) {
    if (!name) return null
    const target = name.trim().toLowerCase()
    return list.find((x) => x.name.trim().toLowerCase() === target) ?? null
  }

  async function commitImport() {
    setCommitting(true)
    setError('')

    const supplierCache = [...suppliers]
    const productCache = [...products]
    const unmatchedProducts = new Set()
    const rowsToInsert = []

    for (const row of csvRows) {
      const rawDate = row[columnMap.date]
      const supplierName = row[columnMap.supplier]
      const productName = row[columnMap.product]
      const quantity = Number(row[columnMap.quantity])
      const costPrice = Number(row[columnMap.cost_price])
      const paymentTypeRaw = (row[columnMap.payment_type] || 'Cash').trim()
      const paymentType = ['Cash', 'Bank', 'Credit'].includes(paymentTypeRaw) ? paymentTypeRaw : 'Cash'

      if (!rawDate || !supplierName || !productName || !quantity || !costPrice) continue

      let supplier = findMatch(supplierCache, supplierName)
      if (!supplier) {
        const { data: created, error: createErr } = await supabase
          .from('suppliers')
          .insert({ name: supplierName.trim() })
          .select()
          .single()
        if (createErr) {
          setError(createErr.message)
          setCommitting(false)
          return
        }
        supplier = created
        supplierCache.push(created)
      }

      const product = findMatch(productCache, productName)
      if (!product) {
        unmatchedProducts.add(productName)
        continue
      }

      let parsedDate = rawDate
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(rawDate)) {
        const [dd, mm, yyyy] = rawDate.split('/')
        parsedDate = `${yyyy}-${mm}-${dd}`
      }

      rowsToInsert.push({
        date: parsedDate,
        supplier_id: supplier.id,
        product_id: product.id,
        quantity,
        cost_price: costPrice,
        payment_type: paymentType,
        source: 'imported',
      })
    }

    if (rowsToInsert.length === 0) {
      setError('No rows could be matched to existing products. Add the missing products first, then re-import.')
      setCommitting(false)
      return
    }

    let mappingId = selectedMappingId || null
    if (saveAsNew && newMappingName) {
      const { data: newMapping, error: mapErr } = await supabase
        .from('csv_import_mappings')
        .insert({ name: newMappingName, source_type: 'purchases', column_mapping: columnMap })
        .select()
        .single()
      if (mapErr) {
        setError(mapErr.message)
        setCommitting(false)
        return
      }
      mappingId = newMapping.id
    }

    const { data: batch, error: batchErr } = await supabase
      .from('import_batches')
      .insert({
        date: toISODate(),
        source_type: 'purchases',
        file_name: fileName,
        row_count: rowsToInsert.length,
        mapping_id: mappingId,
      })
      .select()
      .single()

    if (batchErr) {
      setError(batchErr.message)
      setCommitting(false)
      return
    }

    const rowsWithBatch = rowsToInsert.map((r) => ({ ...r, import_batch_id: batch.id }))
    const { data: inserted, error: insertErr } = await supabase.from('purchases').insert(rowsWithBatch).select()

    if (insertErr) {
      setError(insertErr.message)
      setCommitting(false)
      return
    }

    // Stock movements are written automatically by a database trigger per row (see supabase/schema.sql).
    setResult({ inserted: inserted.length, unmatchedProducts: [...unmatchedProducts] })
    setCommitting(false)
    loadMappings()
  }

  return (
    <div>
      <div className="card">
        <h3>1. Upload CSV / Excel export</h3>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          Export your Purchases or Payables list from Simple Accounting Bookkeeping as CSV (Excel files
          should be re-saved as CSV first), then upload it here.
        </p>
        <input type="file" accept=".csv" onChange={handleFile} />
        {fileName && <p className="muted">Loaded: {fileName} ({csvRows.length} rows)</p>}
      </div>

      {csvHeaders.length > 0 && (
        <div className="card">
          <h3>2. Map Columns</h3>
          {mappings.length > 0 && (
            <label style={{ display: 'block', marginBottom: '1rem' }}>
              Use a saved mapping
              <select value={selectedMappingId} onChange={(e) => applyMapping(e.target.value)}>
                <option value="">— Define new mapping below —</option>
                {mappings.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="form-grid">
            {OUR_FIELDS.map((f) => (
              <label key={f.key}>
                {f.label}
                <select
                  value={columnMap[f.key] ?? ''}
                  onChange={(e) => setColumnMap({ ...columnMap, [f.key]: e.target.value })}
                >
                  <option value="">Select CSV column…</option>
                  {csvHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <label style={{ display: 'block', marginTop: '1rem' }}>
            <input type="checkbox" checked={saveAsNew} onChange={(e) => setSaveAsNew(e.target.checked)} /> Save this
            mapping for next time
          </label>
          {saveAsNew && (
            <input
              style={{ marginTop: '0.5rem' }}
              placeholder="Mapping name, e.g. Tacktile Purchases Export"
              value={newMappingName}
              onChange={(e) => setNewMappingName(e.target.value)}
            />
          )}
        </div>
      )}

      {mappingComplete && (
        <div className="card">
          <h3>3. Preview (first 10 rows)</h3>
          <table className="data-table">
            <thead>
              <tr>
                {OUR_FIELDS.map((f) => (
                  <th key={f.key}>{f.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((r, i) => (
                <tr key={i}>
                  {OUR_FIELDS.map((f) => (
                    <td key={f.key}>{r[f.key]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            Products must already exist in your Inventory to be matched — unmatched supplier names will be
            created automatically, but unmatched product names will be skipped and listed after import.
          </p>
          <button className="btn" onClick={commitImport} disabled={committing}>
            {committing ? 'Importing…' : `Import ${csvRows.length} rows`}
          </button>
        </div>
      )}

      {error && <div className="inline-error">{error}</div>}

      {result && (
        <div className="card">
          <h3>Import Complete</h3>
          <p>Imported {result.inserted} purchase rows.</p>
          {result.unmatchedProducts.length > 0 && (
            <div>
              <p className="inline-error">
                These product names didn't match anything in Inventory and were skipped — add them as
                products first, then re-import just those rows:
              </p>
              <ul>
                {result.unmatchedProducts.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
