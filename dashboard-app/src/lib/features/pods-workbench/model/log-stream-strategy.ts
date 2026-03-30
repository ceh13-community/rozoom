export async function openStreamWithOptionalFallback<T>(
  openPrimary: () => Promise<T>,
  openFallback?: () => Promise<T>,
): Promise<T> {
  try {
    return await openPrimary();
  } catch (primaryError) {
    if (!openFallback) {
      throw primaryError;
    }
    return await openFallback();
  }
}
