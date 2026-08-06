import { exportToPDF, exportToExcel } from '../lib/exporters'

export default function ExportButtons({ title, columns, rows, filename }) {
  if (!rows?.length) return null
  return (
    <div className="no-print" style={{ display: 'flex', gap: '0.5rem' }}>
      <button
        type="button"
        className="btn-secondary"
        onClick={() => exportToPDF({ title: title ?? filename, columns, rows, filename })}
      >
        Export PDF
      </button>
      <button
        type="button"
        className="btn-secondary"
        onClick={() => exportToExcel({ columns, rows, filename })}
      >
        Export Excel
      </button>
      <button type="button" className="btn-secondary" onClick={() => window.print()}>
        Print
      </button>
    </div>
  )
}
