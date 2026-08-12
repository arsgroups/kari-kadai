import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import { COMPANY } from './companyInfo'

// columns: [{ key, label }]  rows: [{ ...values }]
export function exportToPDF({ title, columns, rows, filename }) {
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
    body: rows.map((r) => columns.map((c) => String(r[c.key] ?? ''))),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [122, 31, 31] },
  })
  doc.save(`${filename}.pdf`)
}

export function exportToExcel({ columns, rows, filename }) {
  const data = rows.map((r) => {
    const obj = {}
    columns.forEach((c) => {
      obj[c.label] = r[c.key] ?? ''
    })
    return obj
  })
  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  XLSX.writeFile(wb, `${filename}.xlsx`)
}
