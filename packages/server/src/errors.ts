export function httpError(status: number, code: string, message: string): Error {
  return Object.assign(new Error(message), { status, code });
}
