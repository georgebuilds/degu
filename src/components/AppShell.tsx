import { useCallback, useEffect, useState } from 'preact/hooks'
import {
  isIntroDismissed,
  loadDefaultStartMode,
  subscribeIntroDismissed,
} from '../lib/settings'
import { FileBrowser } from './FileBrowser.tsx'
import { IntroRibbon } from './IntroRibbon.tsx'
import { ModeRail, type AppMode } from './ModeRail.tsx'
import { SettingsModal } from './SettingsModal.tsx'
import { TagsScreen } from './TagsScreen.tsx'
import { TriageScreen } from './TriageScreen.tsx'

type AppShellProps = {
  rootHandle: FileSystemDirectoryHandle
}

/**
 * Top-level layout once a folder is connected. Holds the mode rail and swaps
 * between Triage / Library / Tags screens. Default mode comes from Settings;
 * Triage is the out-of-the-box default — Burrow's primary verb is "tag the
 * next thing," not "browse files."
 */
export function AppShell({ rootHandle }: AppShellProps) {
  const [mode, setMode] = useState<AppMode>(() => loadDefaultStartMode())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [introVisible, setIntroVisible] = useState(() => !isIntroDismissed())

  useEffect(() => {
    return subscribeIntroDismissed(() => {
      setIntroVisible(!isIntroDismissed())
    })
  }, [])

  const openSettings = useCallback(() => setSettingsOpen(true), [])
  const closeSettings = useCallback(() => setSettingsOpen(false), [])

  return (
    <div class="flex h-[100svh] min-h-0 w-full bg-zinc-950">
      <ModeRail
        mode={mode}
        onModeChange={setMode}
        rootFolderName={rootHandle.name}
        onOpenSettings={openSettings}
      />
      <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        {introVisible ? <IntroRibbon onOpenSettings={openSettings} /> : null}
        <div class="flex min-h-0 min-w-0 flex-1">
          {mode === 'triage' ? (
            <TriageScreen
              rootHandle={rootHandle}
              rootFolderName={rootHandle.name}
            />
          ) : mode === 'library' ? (
            <FileBrowser rootHandle={rootHandle} />
          ) : (
            <TagsScreen
              rootFolderName={rootHandle.name}
              onOpenStale={() => setMode('triage')}
            />
          )}
        </div>
      </div>
      {settingsOpen ? <SettingsModal onClose={closeSettings} /> : null}
    </div>
  )
}
