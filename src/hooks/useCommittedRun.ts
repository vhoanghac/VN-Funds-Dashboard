import { useEffect, useMemo, useRef, useState } from 'react'

export interface CommittedRunConfig<P, C extends { params: P }, R> {
  ready: boolean
  valid?: boolean
  liveParams: P
  serialize?: (params: P) => string
  captureSnapshot: () => C
  compute: (snapshot: C) => R | null
}

export interface CommittedRunState<C, R> {
  committed: C | null
  dirty: boolean
  run: () => void
  pendingRun: boolean
  reset: () => void
  result: R | null
}

/**
 * Chốt một bộ thông số và dữ liệu tại lúc người dùng bấm chạy.
 *
 * `compute` cố ý chỉ phụ thuộc vào `committed`. Callback này phải đọc toàn bộ
 * input từ snapshot, không đọc state sống của component gọi hook.
 */
export function useCommittedRun<P, C extends { params: P }, R>(
  config: CommittedRunConfig<P, C, R>,
): CommittedRunState<C, R> {
  const [committed, setCommitted] = useState<C | null>(null)
  const [pendingRun, setPendingRun] = useState(false)
  const generationRef = useRef(0)

  const serialize = config.serialize ?? ((params: P) => JSON.stringify(params) ?? '')

  function run() {
    if (config.valid === false) return
    generationRef.current += 1
    if (!config.ready) {
      setCommitted(null)
      setPendingRun(true)
      return
    }

    setCommitted(config.captureSnapshot())
    setPendingRun(false)
  }

  function reset() {
    generationRef.current += 1
    setCommitted(null)
    setPendingRun(false)
  }

  useEffect(() => {
    if (!pendingRun) return
    if (config.valid === false) {
      setPendingRun(false)
      return
    }
    if (!config.ready) return

    const generation = generationRef.current
    const snapshot = config.captureSnapshot()
    if (generation !== generationRef.current) return

    setCommitted(snapshot)
    setPendingRun(false)
    // `ready` controls when the pending intent may commit. The latest render
    // supplies the current captureSnapshot callback at that point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRun, config.ready, config.valid])

  const result = useMemo(
    () => committed ? config.compute(committed) : null,
    // The compute callback is snapshot-pure by contract. Adding it here would
    // recompute when live panel state changes, which defeats this hook's job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [committed],
  )

  const dirty = committed !== null
    && serialize(config.liveParams) !== serialize(committed.params)

  return { committed, dirty, run, pendingRun, reset, result }
}
