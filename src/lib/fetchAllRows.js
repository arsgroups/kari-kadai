// Supabase/PostgREST caps a plain .select() at 1000 rows by default. Any
// report that needs a full historical table scan (not a single page of it)
// must page through with .range() instead, or it silently drops rows once a
// table passes 1000 -- with no error, just quietly wrong totals.
export async function fetchAllRows(query) {
  const pageSize = 1000
  let from = 0
  let all = []
  for (;;) {
    const { data, error } = await query.range(from, from + pageSize - 1)
    if (error) throw error
    all = all.concat(data ?? [])
    if (!data || data.length < pageSize) break
    from += pageSize
  }
  return all
}
