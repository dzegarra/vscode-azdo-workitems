/**
 * Runs `task` over the items with at most `limit` in flight, keeping the order of the results (Azure DevOps
 * throttles bursts: a fan-out of one request per PR must not start them all at once). Failures do not stop the others
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = { status: 'fulfilled', value: await task(items[index]) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

/** Most requests of one fan-out in flight at once */
export const MAX_IN_FLIGHT = 6;
