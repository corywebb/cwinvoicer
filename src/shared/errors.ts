/** The message of a caught value, which may not be an Error. */
export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));
