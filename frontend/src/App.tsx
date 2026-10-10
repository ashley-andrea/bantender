import { useEffect, useState } from 'react'
import { Flow } from './components/Flow'
import { Upload } from './components/Upload'
import { LangProvider } from './i18n'
import { STEPS, type Step } from './route'

// Route: #/t/<tender_id>/<step>[/live]; anything else shows the upload screen.
interface Route {
  id: string | null
  step: Step
  live: boolean
}

function fromHash(): Route {
  const m = window.location.hash.match(/^#\/t\/([a-f0-9]+)(?:\/(\w+))?(\/live)?/)
  const step = (STEPS as readonly string[]).includes(m?.[2] ?? '') ? (m![2] as Step) : 'extract'
  return { id: m?.[1] ?? null, step, live: Boolean(m?.[3]) }
}

export default function App() {
  const [route, setRoute] = useState<Route>(fromHash)

  useEffect(() => {
    const onHash = () => setRoute(fromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const go = (id: string | null, step: Step = 'extract', live = false) => {
    window.location.hash = id ? `/t/${id}/${step}${live ? '/live' : ''}` : ''
  }

  return (
    <LangProvider>
      {route.id ? (
        <Flow key={route.id} tenderId={route.id} step={route.step} live={route.live} onStep={(s) => go(route.id, s)} onHome={() => go(null)} />
      ) : (
        <Upload onOpen={(id, live) => go(id, 'extract', live)} />
      )}
    </LangProvider>
  )
}
