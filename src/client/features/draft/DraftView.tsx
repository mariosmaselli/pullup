import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useBlocker, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import type { Platform, PostStatus } from '@shared/constants.ts'
import type { Asset, Claim, PostDetail, Segment } from '@shared/types.ts'
import { frameAssetIds } from '@shared/frames.ts'
import { Button } from '../../components/Button/Button.tsx'
import { EmptyState } from '../../components/EmptyState/EmptyState.tsx'
import { Segmented } from '../../components/Segmented/Segmented.tsx'
import { ProjectPicker } from '../../components/ProjectPicker/ProjectPicker.tsx'
import type { ApiError } from '../../lib/api.ts'
import { assetTitle, relativeTime } from '../../lib/format.ts'
import { ANGLE_LABEL, STATUS_LABEL } from '../../lib/labels.ts'
import { PLATFORMS } from '../../lib/platforms.ts'
import {
  useAssets,
  usePost,
  useProjects,
  useRestoreRevision,
  useRevisePost,
  useSavePostRevision,
  useSystem,
  useUpdatePost,
} from '../../lib/queries.ts'
import { isDue, useNow } from '../../lib/due.ts'
import { TextPostEditor } from './TextPostEditor.tsx'
import { FramesEditor } from './FramesEditor.tsx'
import { PublishPanel } from './PublishPanel.tsx'
import './DraftView.scss'

const BASIS_LABEL: Record<Claim['basis'], string> = {
  source: 'From your material',
  framing: 'Framing',
  unconfirmed: 'Confirm before posting',
}

// Positions of the 'unconfirmed' claims Mario has checked off.
const checkedOff = (claims: Claim[]) =>
  claims.flatMap((c, i) => (c.basis === 'unconfirmed' && c.confirmed ? [i] : []))

const sameContent = (a: Segment[], b: Segment[]) =>
  JSON.stringify(a.map((s) => [s.text, frameAssetIds(s), s.template ?? null])) ===
  JSON.stringify(b.map((s) => [s.text, frameAssetIds(s), s.template ?? null]))

export function DraftView() {
  const { id } = useParams({ from: '/drafts/$id' })
  const { skipped } = useSearch({ from: '/drafts/$id' })
  const { data: post, isLoading } = usePost(id)
  const { data: assets } = useAssets('all')
  // Held here, above the per-revision remount: saving hand edits before a revise remounts the
  // editor, and the revise that follows must keep its pending state and error on screen.
  const save = useSavePostRevision()
  const revise = useRevisePost()
  const [instructions, setInstructions] = useState<Record<string, string>>({})

  if (isLoading) return null
  if (!post) {
    return (
      <EmptyState title="Draft not found">
        <Link to="/drafts">Back to drafts</Link>
      </EmptyState>
    )
  }
  // Remount the editor per revision so local edits reset when the draft changes underneath.
  return (
    <DraftEditor
      key={post.current?.id ?? post.id}
      post={post}
      assets={assets ?? []}
      skipped={(skipped?.split(',') ?? []).filter((p): p is Platform => p in PLATFORMS)}
      save={save}
      revise={revise}
      instruction={instructions[post.id] ?? ''}
      onInstruction={(postId, text) => setInstructions((all) => ({ ...all, [postId]: text }))}
    />
  )
}

function DraftEditor({
  post,
  assets,
  skipped,
  save,
  revise,
  instruction,
  onInstruction,
}: {
  post: PostDetail
  assets: Asset[]
  skipped: Platform[]
  save: ReturnType<typeof useSavePostRevision>
  revise: ReturnType<typeof useRevisePost>
  instruction: string
  onInstruction: (postId: string, text: string) => void
}) {
  const navigate = useNavigate()
  const restore = useRestoreRevision()
  const due = isDue(post, useNow())
  const update = useUpdatePost()
  const config = PLATFORMS[post.platform]

  const initial = post.current?.segments ?? [{ text: '' }]
  const initialCaption = post.current?.caption ?? ''
  const [segments, setSegments] = useState<Segment[]>(initial)
  const [caption, setCaption] = useState(initialCaption)
  const [copied, setCopied] = useState<number | 'all' | null>(null)
  const claims = post.current?.claims ?? []
  const initialConfirmed = checkedOff(claims)
  const [confirmed, setConfirmed] = useState<number[]>(initialConfirmed)
  const { data: system } = useSystem()
  const { data: projects } = useProjects()

  const byId = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets])
  const sources = post.sourceAssetIds.map((id) => byId.get(id)).filter((a): a is Asset => !!a)
  const media = post.mediaAssetIds.map((id) => byId.get(id)).filter((a): a is Asset => !!a)
  const library = useMemo(
    () => assets.filter((a) => a.kind === 'image' || a.kind === 'video'),
    [assets]
  )
  const shownMedia = config.frames
    ? [...new Set(segments.flatMap(frameAssetIds))]
        .map((id) => byId.get(id))
        .filter((a): a is Asset => !!a)
    : media
  const privateMedia = shownMedia.filter((a) => a.visibility === 'private')

  const claimsChanged =
    confirmed.length !== initialConfirmed.length ||
    confirmed.some((i) => !initialConfirmed.includes(i))
  const dirty = !sameContent(segments, initial) || caption !== initialCaption || claimsChanged

  // Unsaved edits live only in this editor: leaving the draft (another platform tab, the sidebar,
  // a reload) would drop them silently. Discarding the draft is a deliberate exit, so it skips this.
  const leaving = useRef(false)
  useBlocker({
    shouldBlockFn: () =>
      !leaving.current &&
      !window.confirm('You have unsaved edits in this draft. Leave without saving?'),
    enableBeforeUnload: dirty,
    disabled: !dirty,
  })
  const overLimit = config.hardLimit && segments.some((s) => config.length(s.text) > config.limit)
  // save/revise outlive this editor and its siblings' editors: only this post's calls count.
  const revising = revise.isPending && revise.variables?.id === post.id
  const busy = revising || (save.isPending && save.variables?.id === post.id)
  const error = ((revise.variables?.id === post.id ? revise.error : null) ??
    (save.variables?.id === post.id ? save.error : null) ??
    update.error ??
    restore.error) as ApiError | null
  const unconfirmed = claims.filter((c, i) => c.basis === 'unconfirmed' && !confirmed.includes(i))
  // Why "Revise with AI" can't run for this post, if it can't.
  const project = projects?.find((p) => p.id === post.projectId)
  const aiOff =
    project && !project.aiAllowed
      ? `AI is off for “${project.name}”. Allow it on the project page to revise with AI — or edit by hand.`
      : system && !system.ai.enabled
        ? 'AI is off: add an API key in Settings to revise with AI. You can still edit by hand.'
        : null
  const shelved = post.status === 'archived' || post.status === 'discarded'
  // Restoring: an archived post that went out goes back to published, anything else to draft.
  const restoreTo: PostStatus =
    post.status === 'archived' && post.publishedAt ? 'published' : 'draft'
  const leave = (status: PostStatus) =>
    update.mutate(
      { id: post.id, status },
      {
        onSuccess: () => {
          leaving.current = true
          navigate({ to: '/drafts' })
        },
      }
    )
  // Platforms with more than one draft get their angle in the tab label.
  const repeated = new Set(
    post.siblings.map((s) => s.platform).filter((p, i, all) => all.indexOf(p) !== i)
  )

  useEffect(() => {
    if (copied === null) return
    const t = setTimeout(() => setCopied(null), 1500)
    return () => clearTimeout(t)
  }, [copied])

  const copy = async (text: string, which: number | 'all') => {
    await navigator.clipboard.writeText(text)
    setCopied(which)
  }

  const saveEdits = (then?: () => void) => {
    revise.reset()
    save.mutate(
      {
        id: post.id,
        segments,
        caption: config.caption ? caption : null,
        confirmedClaims: claims.length ? confirmed : undefined,
      },
      { onSuccess: then }
    )
  }

  const runRevision = (text: string) => {
    if (!text.trim()) return
    const postId = post.id
    save.reset()
    const doRevise = () =>
      revise.mutate(
        { id: postId, instruction: text.trim() },
        { onSuccess: () => onInstruction(postId, '') }
      )
    // Save unsaved hand edits first so the AI revises what's on screen.
    if (dirty) saveEdits(doRevise)
    else doRevise()
  }

  return (
    <div className="draft-view">
      <Link to="/drafts" className="draft-view__back -meta">
        ← Drafts
      </Link>

      <div className="draft-view__layout flex">
        {/* Sources */}
        <aside className="draft-view__sources flex flex-col shrink-0">
          <span className="draft-view__label -meta">Sources</span>
          {sources.map((asset) => (
            <div key={asset.id} className="draft-view__source flex flex-col">
              {asset.thumbUrl ? <img src={asset.thumbUrl} alt="" loading="lazy" /> : null}
              <span className="-p1">{assetTitle(asset)}</span>
              {asset.notes ? <p className="draft-view__muted -p1">{asset.notes}</p> : null}
              {asset.kind === 'note' && asset.body ? (
                <p className="draft-view__muted -p1">{asset.body}</p>
              ) : null}
            </div>
          ))}
        </aside>

        {/* Editor */}
        <section className="draft-view__main flex flex-col flex-1">
          {post.siblings.length > 1 ? (
            <div className="draft-view__siblings flex">
              {post.siblings.map((s) => (
                <Link
                  key={s.id}
                  to="/drafts/$id"
                  params={{ id: s.id }}
                  className="draft-view__sibling -p1"
                  data-active={s.id === post.id}
                >
                  {PLATFORMS[s.platform].label}
                  {repeated.has(s.platform) && s.angle ? ` · ${ANGLE_LABEL[s.angle]}` : ''}
                  {s.status === 'approved' ? ' ✓' : ''}
                </Link>
              ))}
            </div>
          ) : null}

          {skipped.length ? (
            <p className="draft-view__warning -p1">
              The AI didn’t write a draft for {skipped.map((p) => PLATFORMS[p].label).join(', ')}.
              Try again from the idea with just{' '}
              {skipped.length === 1 ? 'that platform' : 'those platforms'}.
            </p>
          ) : null}

          <header className="draft-view__header flex items-center justify-between">
            <h1 className="-t2">{config.title(segments)}</h1>
            {post.status === 'scheduled' || post.status === 'published' ? (
              <span className="draft-view__status -meta" data-status={due ? 'due' : post.status}>
                {due ? 'Due' : STATUS_LABEL[post.status]}
              </span>
            ) : shelved ? (
              <div className="draft-view__restore flex items-center">
                <span className="draft-view__status -meta" data-status={post.status}>
                  {STATUS_LABEL[post.status]}
                </span>
                <Button
                  size="s"
                  disabled={update.isPending}
                  onClick={() => update.mutate({ id: post.id, status: restoreTo })}
                >
                  {restoreTo === 'published' ? 'Unarchive' : 'Restore to draft'}
                </Button>
              </div>
            ) : (
              <Segmented<PostStatus>
                label="Status"
                value={
                  ['draft', 'review', 'approved'].includes(post.status) ? post.status : 'draft'
                }
                onChange={(status) => update.mutate({ id: post.id, status })}
                options={[
                  { value: 'draft', label: STATUS_LABEL.draft },
                  { value: 'review', label: 'Review' },
                  { value: 'approved', label: STATUS_LABEL.approved },
                ]}
              />
            )}
          </header>

          {/* Locked while the AI rewrites it: anything typed meanwhile would be replaced. */}
          <fieldset className="draft-view__editor" disabled={busy}>
            {config.frames ? (
              <FramesEditor
                postId={post.id}
                platform={post.platform}
                segments={segments}
                caption={caption}
                sources={sources}
                postMedia={media}
                byId={byId}
                copied={copied}
                dirty={dirty}
                onChange={setSegments}
                onCaption={setCaption}
                onCopy={copy}
              />
            ) : (
              <TextPostEditor
                postId={post.id}
                platform={post.platform}
                segments={segments}
                media={media}
                library={library}
                copied={copied}
                onChange={setSegments}
                onCopy={copy}
              />
            )}
          </fieldset>

          <div className="draft-view__edit-actions flex items-center justify-end">
            {dirty ? (
              <Button
                variant="ghost"
                size="s"
                onClick={() => {
                  setSegments(initial)
                  setCaption(initialCaption)
                  setConfirmed(initialConfirmed)
                }}
              >
                Discard edits
              </Button>
            ) : null}
            <Button size="s" disabled={!dirty || busy} onClick={() => saveEdits()}>
              Save edits
            </Button>
            {config.caption ? null : (
              <Button
                variant="primary"
                size="s"
                onClick={() => copy(config.copyText(segments, caption), 'all')}
              >
                {copied === 'all' ? 'Copied' : config.frames ? 'Copy frame texts' : 'Copy text'}
              </Button>
            )}
          </div>

          {overLimit ? (
            <p className="draft-view__warning -p1">
              A post is over {config.limit} characters — {config.label} will reject it.
            </p>
          ) : null}

          {error ? <p className="draft-view__warning -p1">{error.message}</p> : null}

          {/* Revise with AI */}
          <div className="draft-view__revise flex flex-col">
            <span className="draft-view__label -meta">Revise with AI</span>
            {aiOff ? (
              <p className="draft-view__muted -p1">{aiOff}</p>
            ) : (
              <>
                <div className="draft-view__quick flex">
                  {config.quick.map((q) => (
                    <button
                      key={q}
                      type="button"
                      className="draft-view__chip -p1"
                      disabled={busy}
                      onClick={() => runRevision(q)}
                    >
                      {q}
                    </button>
                  ))}
                </div>
                <form
                  className="draft-view__instruction flex items-center"
                  onSubmit={(e) => {
                    e.preventDefault()
                    runRevision(instruction)
                  }}
                >
                  <input
                    className="flex-1 -p"
                    value={instruction}
                    placeholder="Or say what to change — e.g. focus on the animation, not the design"
                    onChange={(e) => onInstruction(post.id, e.target.value)}
                    disabled={busy}
                  />
                  <Button
                    variant="primary"
                    size="s"
                    type="submit"
                    disabled={busy || !instruction.trim()}
                  >
                    {revising ? 'Revising…' : 'Revise'}
                  </Button>
                </form>
              </>
            )}
          </div>
        </section>

        {/* Facts, questions, history */}
        <aside className="draft-view__side flex flex-col shrink-0">
          <div className="flex flex-col">
            <span className="draft-view__label -meta">Project</span>
            <ProjectPicker
              value={post.projectId}
              onChange={(projectId) => update.mutate({ id: post.id, projectId })}
            />
          </div>

          <PublishPanel post={post} media={media} privateMedia={privateMedia} />

          {unconfirmed.length ? (
            <p className="draft-view__warning -p1">
              {unconfirmed.length} detail{unconfirmed.length === 1 ? '' : 's'} to confirm before
              posting. Tick each one off below once it’s right.
            </p>
          ) : null}

          {claims.length ? (
            <div className="flex flex-col">
              <span className="draft-view__label -meta">What this draft claims</span>
              <ul className="draft-view__claims flex flex-col">
                {claims.map((claim, i) => {
                  const source =
                    claim.assetId && byId.get(claim.assetId)
                      ? ` · ${assetTitle(byId.get(claim.assetId)!)}`
                      : ''
                  const checked = confirmed.includes(i)
                  return (
                    <li
                      key={i}
                      className="flex flex-col"
                      data-basis={claim.basis}
                      data-confirmed={checked}
                    >
                      <span className="-p1">{claim.text}</span>
                      {claim.basis === 'unconfirmed' ? (
                        <label className="draft-view__confirm flex items-center -meta">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={busy}
                            onChange={(e) =>
                              setConfirmed((all) =>
                                e.target.checked
                                  ? [...all, i].sort((a, b) => a - b)
                                  : all.filter((n) => n !== i)
                              )
                            }
                          />
                          {checked ? 'Confirmed by you' : BASIS_LABEL.unconfirmed}
                          {source}
                        </label>
                      ) : (
                        <span className="-meta">
                          {BASIS_LABEL[claim.basis]}
                          {source}
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : null}

          {post.current?.questions.length ? (
            <div className="flex flex-col">
              <span className="draft-view__label -meta">Questions for you</span>
              <ul className="draft-view__questions -p1">
                {post.current.questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
              <p className="draft-view__muted -meta">
                Answer by editing the draft, or tell the AI in “Revise”.
              </p>
            </div>
          ) : null}

          <div className="flex flex-col">
            <span className="draft-view__label -meta">History</span>
            <ol className="draft-view__history flex flex-col">
              {post.revisions.map((rev) => (
                <li
                  key={rev.id}
                  className="flex items-center justify-between"
                  data-current={rev.id === post.current?.id}
                >
                  <span className="-p1">
                    {rev.author === 'me'
                      ? 'Your edit'
                      : rev.instruction
                        ? `AI: ${rev.instruction}`
                        : 'AI draft'}
                    <span className="draft-view__muted -meta">
                      {' '}
                      · {relativeTime(rev.createdAt)}
                    </span>
                  </span>
                  {rev.id === post.current?.id ? (
                    <span className="-meta draft-view__muted">Current</span>
                  ) : (
                    <Button
                      variant="ghost"
                      size="s"
                      disabled={restore.isPending}
                      onClick={() => restore.mutate({ id: post.id, revisionId: rev.id })}
                    >
                      Restore
                    </Button>
                  )}
                </li>
              ))}
            </ol>
          </div>

          {shelved ? null : (
            <div className="draft-view__shelve flex items-center">
              <Button variant="ghost" size="s" onClick={() => leave('archived')}>
                Archive
              </Button>
              <Button variant="danger" size="s" onClick={() => leave('discarded')}>
                Discard this draft
              </Button>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
