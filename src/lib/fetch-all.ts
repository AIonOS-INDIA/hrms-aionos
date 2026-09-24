/** Reads every row past the backend's 1,000-rows-per-request cap by paging. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchAll<T>(make: () => any, page = 1000): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; from < 100000; from += page) {
    const { data, error } = await make().range(from, from + page - 1);
    if (error) throw error;
    all.push(...((data ?? []) as T[]));
    if (!data || data.length < page) break;
  }
  return all;
}
