import { ViewHeader } from '../../components/ViewHeader/ViewHeader.tsx'
import { useSystem } from '../../lib/queries.ts'
import { BackupsPanel } from './BackupsPanel.tsx'
import { AiKeyForm } from './AiKeyForm.tsx'
import { VoiceForm } from './VoiceForm.tsx'
import { PlatformStylesForm } from './PlatformStylesForm.tsx'
import { AiSpendPanel } from './AiSpendPanel.tsx'
import { StoragePanel } from './StoragePanel.tsx'
import { FontsPanel } from './FontsPanel.tsx'
import './SettingsView.scss'

export function SettingsView() {
  const { data: system } = useSystem()

  return (
    <>
      <ViewHeader title="Settings" />

      <section className="settings-view__section">
        <h2 className="settings-view__heading -meta">AI</h2>
        {system ? <AiKeyForm system={system} /> : null}
        <dl className="settings-view__list">
          <Row label="Model" value="Claude Opus 5" />
        </dl>
      </section>

      <section className="settings-view__section">
        <h2 className="settings-view__heading -meta">AI spend</h2>
        <AiSpendPanel />
      </section>

      <section className="settings-view__section">
        <h2 className="settings-view__heading -meta">Writing voice</h2>
        <VoiceForm />
      </section>

      <section className="settings-view__section">
        <h2 className="settings-view__heading -meta">Platform styles</h2>
        <PlatformStylesForm />
      </section>

      <section className="settings-view__section">
        <h2 className="settings-view__heading -meta">Backups</h2>
        <BackupsPanel />
      </section>

      <section className="settings-view__section">
        <h2 className="settings-view__heading -meta">Storage</h2>
        <StoragePanel />
      </section>

      <section className="settings-view__section">
        <h2 className="settings-view__heading -meta">Fonts</h2>
        <FontsPanel />
      </section>

      <section className="settings-view__section">
        <h2 className="settings-view__heading -meta">Library</h2>
        <dl className="settings-view__list">
          <Row label="Folder" value={system?.library.root} mono />
          <Row label="Inbox folder" value={system?.library.inbox} mono />
          <Row label="Database" value={system?.library.database} mono />
          <Row
            label="ffmpeg"
            value={system ? (system.ffmpeg ?? 'Not found — install with Homebrew') : undefined}
          />
          <Row label="Version" value={system?.version} mono />
        </dl>
      </section>
    </>
  )
}

function Row({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  return (
    <div className="settings-view__row flex">
      <dt className="settings-view__label -p1 shrink-0">{label}</dt>
      <dd className={mono ? 'settings-view__value -meta' : 'settings-view__value -p1'}>
        {value ?? '—'}
      </dd>
    </div>
  )
}
