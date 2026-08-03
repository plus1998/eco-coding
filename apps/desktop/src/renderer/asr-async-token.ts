export function nextAsrAsyncToken(currentToken: number): number {
  return currentToken >= Number.MAX_SAFE_INTEGER ? 1 : currentToken + 1;
}

export function isAsrAsyncTokenCurrent(requestToken: number, currentToken: number, mounted = true): boolean {
  return mounted && requestToken === currentToken;
}
