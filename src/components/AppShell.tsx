import { useState } from 'preact/hooks'
import { FileBrowser } from './FileBrowser.tsx'
import { ModeRail, type AppMode } from './ModeRail.tsx'
import { TriageScreen } from './TriageScreen.tsx'
import { TagsScreen } from './TagsScreen.tsx'

type AppShellProps = {
  rootHandle: FileSystemDirectoryHandle
}

/**
 * Top-level layout once a folder is connected. Holds the mode rail and swaps
 * between Triage / Library / Tags screens. Triage is the default — Burrow's
 * primary verb is "tag the next thing," not "browse files."
 */
export function AppShell({ rootHandle }: AppShellProps) {
  const [mode, setMode] = useState<AppMode>('triage')

  return (
    <div class="flex h-[100svh] min-h-0 w-full bg-zinc-950">
      <ModeRail
        mode={mode}
        onModeChange={setMode}
        rootFolderName={rootHandle.name}
      />
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
  )
}
