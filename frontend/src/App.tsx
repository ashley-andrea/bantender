import { useEffect, useState } from 'react'
import { Flow } from './components/Flow'
import { LangProvider } from './i18n'
import { STEPS, type Step } from './route'

// Route: #/t/<tender_id>/<step>; anything else is the extraction step before a tender is uploaded.
interface Route {
  id: string | null
  step: Step
}

function fromHash(): Route {
  const m = window.location.hash.match(/^#\/t\/([a-f0-9]+)(?:\/(\w+))?/)
  const step = (STEPS as readonly string[]).includes(m?.[2] ?? '') ? (m![2] as Step) : 'extract'
  return { id: m?.[1] ?? null, step }
}

export default function App() {
  const [route, setRoute] = useState<Route>(fromHash)

  useEffect(() => {
    const onHash = () => setRoute(fromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const go = (id: string | null, step: Step = 'extract') => {
    window.location.hash = id ? `/t/${id}/${step}` : ''
  }

  return (
    <LangProvider>
      <Flow tenderId={route.id} step={route.step} onStep={(s) => go(route.id, s)} onOpen={(id) => go(id)} onHome={() => go(null)} />
    </LangProvider>
  )
}
