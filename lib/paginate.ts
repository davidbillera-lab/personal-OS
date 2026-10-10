// PostgREST caps a select at 1000 rows. Page through with .range() until a short page.
// `build` must apply a stable, unique .order() so pages never overlap or skip.
export const PAGE_SIZE = 1000

export async function fetchAllRows<T>(
  label: string,
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = PAGE_SIZE
): Promise<T[]> {
  const all: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1)
    if (error) throw new Error(`read failed (${label}): ${error.message}`)
    const page = data ?? []
    all.push(...page)
    if (page.length < pageSize) return all
  }
}
