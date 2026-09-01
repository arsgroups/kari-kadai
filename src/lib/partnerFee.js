import { supabase } from './supabaseClient'
import { buildRateResolver } from './gst'

export async function fetchPartnerFeeRateHistory() {
  const { data } = await supabase
    .from('partner_fee_rate_history')
    .select('id, effective_from, rate_percent, note')
    .order('effective_from', { ascending: false })
  return data ?? []
}

// Same date-effective lookup as GST's buildRateResolver, just against a
// different rate history and a 10% (not 9%) fallback if the table is ever
// empty (it's always seeded with one row, so this is a last-resort only).
export function buildPartnerFeeRateResolver(rateRows) {
  const resolve = buildRateResolver(rateRows)
  return (dateStr) => (rateRows.length ? resolve(dateStr) : 10)
}
