import { COMPANY } from '../lib/companyInfo'

// Only rendered when printing (see .print-only in index.css) — keeps report
// screens uncluttered on-screen while every printout still identifies the
// company and when it was printed.
export default function ReportPrintHeader({ title }) {
  return (
    <div className="print-only report-print-header">
      <h2 style={{ margin: 0 }}>{COMPANY.name}</h2>
      <p className="muted" style={{ margin: '0.1rem 0', fontSize: '0.8rem' }}>
        UEN: {COMPANY.uen}
      </p>
      {title && <h3 style={{ margin: '0.2rem 0' }}>{title}</h3>}
      <p className="muted" style={{ margin: '0.2rem 0' }}>
        Printed on {new Date().toLocaleString('en-SG')}
      </p>
    </div>
  )
}
