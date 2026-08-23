import { supabase } from './supabaseClient'

export async function fetchRateHistory() {
  const { data } = await supabase
    .from('gst_rate_history')
    .select('id, effective_from, rate_percent, note')
    .order('effective_from', { ascending: false })
  return data ?? []
}

// Builds a lookup so each transaction's date resolves to the rate that was
// in effect on that date, without one DB round-trip per row.
export function buildRateResolver(rateRows) {
  const sorted = [...rateRows].sort((a, b) => a.effective_from.localeCompare(b.effective_from))
  return function getRate(dateStr) {
    let applicable = sorted[0]?.rate_percent ?? 9
    for (const r of sorted) {
      if (r.effective_from <= dateStr) applicable = r.rate_percent
      else break
    }
    return applicable
  }
}

// Prices in this app are entered GST-inclusive. These strip GST back out.
export function netOfGst(inclusiveTotal, ratePercent) {
  return inclusiveTotal / (1 + ratePercent / 100)
}

export function gstPortion(inclusiveTotal, ratePercent) {
  return inclusiveTotal - netOfGst(inclusiveTotal, ratePercent)
}

export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

// Restaurant's 9% surcharge rounds to the nearest 50 cents -- except when
// the raw amount comes to under $1, where it rounds to the nearest 10
// cents instead (50-cent steps would be too coarse on a sub-dollar figure).
export function roundSurcharge(amount) {
  const step = amount < 1 ? 0.1 : 0.5
  return round2(Math.round(amount / step) * step)
}
