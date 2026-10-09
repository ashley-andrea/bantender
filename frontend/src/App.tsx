import { useEffect, useState } from 'react'
import { Upload } from './components/Upload'
import { Workspace } from './components/Workspace'
import { LangProvider } from './i18n'

// Route: #/t/<tender_id> opens a tender, anything else shows the upload screen.
const fromHash = () => window.location.hash.match(/^#\/t\/([a-f0-9]+)/)?.[1] ?? null

export default function App() {
  const [tenderId, setTenderId] = useState<string | null>(fromHash)

  useEffect(() => {
    const onHash = () => setTenderId(fromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const open = (id: string | null) => {
    window.location.hash = id ? `/t/${id}` : ''
  }

  return (
    <LangProvider>
      {tenderId ? <Workspace tenderId={tenderId} onBack={() => open(null)} /> : <Upload onOpen={(id) => open(id)} />}
    </LangProvider>
  )
}
