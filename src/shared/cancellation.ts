export function abortError(): Error {
  const error = new Error('The query was cancelled.')
  error.name = 'AbortError'
  return error
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}
