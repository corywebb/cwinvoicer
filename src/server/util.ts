/** An error with the HTTP status to answer with. */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const now = () => new Date().toISOString();
/** YYYY-MM-DD in local time. */
export const today = () => new Date().toLocaleDateString('en-CA');
export const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
