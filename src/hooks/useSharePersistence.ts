import { useCallback, useEffect, useState } from 'react'
import { loadLS } from '../utils/localStorage'
import type { ShareUrlState } from '../utils/shareUrl'

interface Options<T> {
  source: ShareUrlState<T>
}

/** Keeps URL precedence and the first persist gate identical across share panels. */
export function useSharePersistence<T>({ source }: Options<T>) {
  const initialKey = source.hasExplicitPayload ? '' : source.key
  const [hydratedKey, setHydratedKey] = useState(
    initialKey,
  )
  const [settledKey, setSettledKey] = useState(
    initialKey,
  )

  useEffect(() => {
    setHydratedKey(source.key)
  }, [source.key])

  useEffect(() => {
    if (hydratedKey === source.key) setSettledKey(source.key)
  }, [hydratedKey, source.key])

  const readLocal = useCallback(<V,>(key: string, fallback: V): V => (
    source.hasExplicitPayload ? fallback : loadLS(key, fallback)
  ), [source.hasExplicitPayload])

  return {
    hasExplicitPayload: source.hasExplicitPayload,
    parsedPayload: source.parsedPayload,
    skipUrlPersist: settledKey !== source.key,
    readLocal,
  }
}
