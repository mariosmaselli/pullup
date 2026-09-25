import { ViewHeader } from '../../components/ViewHeader/ViewHeader.tsx'
import { useProfiles, useSystem } from '../../lib/queries.ts'
import './SettingsView.scss'

export function SettingsView() {
  const { data: system } = useSystem()
  const { data: profiles = [] } = useProfiles()

  return (
    <>
      <ViewHeader title="Settings" />

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

      <section className="settings-view__section">
        <h2 className="settings-view__heading -meta">Profiles</h2>
        <div className="settings-view__profiles flex flex-col">
          {profiles.map((profile) => (
            <article key={profile.id} className="settings-view__profile">
              <h3 className="-t2">{profile.name}</h3>
              <p className="settings-view__voice -p">{profile.voiceGuide}</p>
            </article>
          ))}
        </div>
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
