/**
 * Drops a failure on purpose. Every call is listed in test/architecture-exceptions.json with its reason, so
 * adding one needs the owner's yes. A failure turned into a value the caller checks (`.catch(() => null)`)
 * isn't ignored and doesn't need this.
 */
export function ignoreError(promise: Promise<unknown>, reason: string): Promise<void> {
  void reason;
  return promise.then(
    () => undefined,
    () => undefined,
  );
}
