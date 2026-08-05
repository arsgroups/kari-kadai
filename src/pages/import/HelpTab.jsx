export default function HelpTab() {
  return (
    <div className="card" style={{ maxWidth: 720 }}>
      <h3>How the accounting app import works — plain English</h3>
      <p>
        Simple Accounting Bookkeeping (Tacktile Systems) doesn't offer a way for other apps to connect to
        it directly, so there's no automatic sync between it and Kari Kadai. Instead, here's the day-to-day
        workflow:
      </p>
      <ol style={{ lineHeight: 1.8 }}>
        <li>
          Keep using Simple Accounting Bookkeeping as normal for invoicing/billing — nothing changes there.
        </li>
        <li>
          Whenever you enter purchases in Simple Accounting Bookkeeping, also record them in Kari Kadai's{' '}
          <strong>Purchases</strong> module directly, OR periodically export them and use the{' '}
          <strong>CSV Import</strong> tab here instead — whichever is less work for you. Don't do both for
          the same purchase, or it'll be counted twice.
        </li>
        <li>
          If Simple Accounting Bookkeeping can export a CSV of purchases/payables (check its Export or
          Backup menu), upload that file under <strong>CSV Import</strong>. The first time, you'll map
          their column names to ours (Date, Supplier, Product, Quantity, Cost Price, Payment Type) — save
          that mapping with a name, and next time you just pick it from the dropdown and upload, no
          remapping needed.
        </li>
        <li>
          Products in the CSV must already exist in Kari Kadai's <strong>Inventory → Products</strong>{' '}
          tab to be matched — if a product name doesn't match, that row is skipped and listed after
          import so you can add the product and re-import just those rows. Suppliers are created
          automatically if they don't already exist.
        </li>
        <li>
          If there's no export available for a period (or the format doesn't fit a spreadsheet cleanly),
          use the <strong>Manual Total Entry</strong> tab instead — just type in the total purchases
          figure for that day or week from the accounting app. It won't have per-item detail, but it keeps
          your purchase totals reconciled.
        </li>
        <li>
          Every purchase in Kari Kadai is tagged <strong>Imported</strong> or <strong>Manual</strong> (see
          the Purchases list) so you can always tell which records came from where.
        </li>
      </ol>
    </div>
  )
}
