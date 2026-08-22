import { COMPANY } from './companyInfo'
import { formatMoney } from './format'

function cellValue(row, column) {
  const raw = row[column.key]
  if (column.money) return raw === '' || raw == null ? '' : formatMoney(raw)
  return raw ?? ''
}

// columns: [{ key, label, money? }]  rows: [{ ...values }] — mark a column
// `money: true` so its values print/export with the S$ symbol.
// jspdf/jspdf-autotable/xlsx are only fetched when an export is actually
// triggered, instead of bloating every page's initial bundle.
export async function exportToPDF({ title, columns, rows, filename }) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])
  const doc = new jsPDF()
  doc.setFontSize(12)
  doc.text(COMPANY.name, 14, 15)
  doc.setFontSize(14)
  doc.text(title, 14, 23)
  doc.setFontSize(9)
  doc.setTextColor(120)
  doc.text(`Printed on ${new Date().toLocaleString('en-SG')}`, 14, 29)
  doc.setTextColor(0)
  autoTable(doc, {
    startY: 34,
    head: [columns.map((c) => c.label)],
    body: rows.map((r) => columns.map((c) => String(cellValue(r, c)))),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [122, 31, 31] },
  })
  doc.save(`${filename}.pdf`)
}

export async function exportToExcel({ columns, rows, filename }) {
  const XLSX = await import('xlsx')
  const data = rows.map((r) => {
    const obj = {}
    columns.forEach((c) => {
      obj[c.label] = cellValue(r, c)
    })
    return obj
  })
  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  XLSX.writeFile(wb, `${filename}.xlsx`)
}
