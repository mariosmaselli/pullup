import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import type { PostStatus } from '@shared/constants.ts'
import type { Asset, Claim, PostDetail } from '@shared/types.ts'
import { Button } from '../../components/Button/Button.tsx'
import { EmptyState } from '../../components/EmptyState/EmptyState.tsx'
import { Segmented } from '../../components/Segmented/Segmented.tsx'
import type { ApiError } from '../../lib/api.ts'
import { assetTitle, relativeTime } from '../../lib/format.ts'
import { ANGLE_LABEL, STATUS_LABEL, xLength } from '../../lib/labels.ts'
import {
  useAssets,
  usePost,
  useRestoreRevision,
  useRevisePost,
  useSavePostRevision,
  useUpdatePost,
} from '../../lib/queries.ts'
import './DraftView.scss'

const X_LIMIT = 280
const QUICK = [
  'Shorter',
  'Less promotional',
  'More technical',
  'More conversational',
  'Make it a thread',
]

const BASIS_LABEL: Record<Claim['basis'], string> = {
  source: 'From your material',
  framing: 'Framing',
  unconfirmed: 'Confirm before posting',
}

export function DraftView() {
  const { id } = useParams({ from: '/drafts/$id' })
  const { data: post, isLoading } = usePost(id)
  const { data: assets } = useAssets('all')

  if (isLoading) return null
  if (!post) {
    return (
      <EmptyState title="Draft not found">
        <Link to="/drafts">Back to drafts</Link>
      </EmptyState>
    )
  }
  // Remount the editor per revision so local edits reset when the draft changes underneath.
  return <DraftEditor key={post.current?.id ?? post.id} post={post} assets={assets ?? []} />
}

function DraftEditor({ post, assets }: { post: PostDetail; assets: Asset[] }) {
  const navigate = useNavigate()
  const save = useSavePostRevision()
  const revise = useRevisePost()
  const restore = useRestoreRevision()
  const update = useUpdatePost()

  const initial = post.current?.segments ?? [{ text: '' }]
  const [segments, setSegments] = useState(initial.map((s) => s.text))
  const [instruction, setInstruction] = useState('')
  const [copied, setCopied] = useState<number | 'all' | null>(null)

  const byId = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets])
  const sources = post.sourceAssetIds.map((id) => byId.get(id)).filter((a): a is Asset => !!a)
  const media = post.mediaAssetIds.map((id) => byId.get(id)).filter((a): a is Asset => !!a)
  const privateMedia = media.filter((a) => a.visibility === 'private')

  const dirty = segments.join('\u0000') !== initial.map((s) => s.text).join('\u0000')
  const overLimit = segments.some((s) => xLength(s) > X_LIMIT)
  const busy = revise.isPending || save.isPending
  const error = (revise.error ?? save.error ?? update.error) as ApiError | null
  const claims = post.current?.claims ?? []
  const unconfirmed = claims.filter((c) => c.basis === 'unconfirmed')

  useEffect(() => {
    if (copied === null) return
    const t = setTimeout(() => setCopied(null), 1500)
    return () => clearTimeout(t)
  }, [copied])

  const copy = async (text: string, which: number | 'all') => {
    await navigator.clipboard.writeText(text)
    setCopied(which)
  }

  const runRevision = (text: string) => {
    if (!text.trim()) return
    const doRevise = () =>
      revise.mutate(
        { id: post.id, instruction: text.trim() },
        { onSuccess: () => setInstruction('') }
      )
    // Save unsaved hand edits first so the AI revises what's on screen.
    if (dirty)
      save.mutate(
        { id: post.id, segments: segments.map((t) => ({ text: t })) },
        { onSuccess: doRevise }
      )
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
                  {s.angle ? ANGLE_LABEL[s.angle] : 'Draft'}
                </Link>
              ))}
            </div>
          ) : null}

          <header className="draft-view__header flex items-center justify-between">
            <h1 className="-t2">X {post.format === 'thread' ? 'thread' : 'post'}</h1>
            <Segmented<PostStatus>
              label="Status"
              value={['draft', 'review', 'approved'].includes(post.status) ? post.status : 'draft'}
              onChange={(status) => update.mutate({ id: post.id, status })}
              options={[
                { value: 'draft', label: STATUS_LABEL.draft },
                { value: 'review', label: 'Review' },
                { value: 'approved', label: STATUS_LABEL.approved },
              ]}
            />
          </header>

          <div className="draft-view__segments flex flex-col">
            {segments.map((text, i) => {
              const length = xLength(text)
              return (
                <div key={i} className="draft-view__segment flex flex-col">
                  <textarea
                    className="draft-view__textarea -p"
                    value={text}
                    rows={Math.max(3, Math.ceil(text.length / 60))}
                    onChange={(e) =>
                      setSegments(segments.map((s, j) => (j === i ? e.target.value : s)))
                    }
                  />
                  {i === 0 && media.length ? (
                    <div className="draft-view__media flex">
                      {media.map((a) => (
                        <img key={a.id} src={a.thumbUrl ?? ''} alt="" title={assetTitle(a)} />
                      ))}
                    </div>
                  ) : null}
                  <div className="draft-view__segment-footer flex items-center justify-between">
                    <span className="-meta" data-over={length > X_LIMIT}>
                      {segments.length > 1 ? `${i + 1}/${segments.length} · ` : ''}
                      {length}/{X_LIMIT}
                    </span>
                    <div className="flex items-center">
                      {segments.length > 1 ? (
                        <Button
                          variant="ghost"
                          size="s"
                          onClick={() => setSegments(segments.filter((_, j) => j !== i))}
                        >
                          Remove
                        </Button>
                      ) : null}
                      <Button variant="ghost" size="s" onClick={() => copy(text, i)}>
                        {copied === i ? 'Copied' : 'Copy'}
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="draft-view__edit-actions flex items-center justify-between">
            <Button variant="ghost" size="s" onClick={() => setSegments([...segments, ''])}>
              + Add post to thread
            </Button>
            <div className="flex items-center">
              {dirty ? (
                <Button
                  variant="ghost"
                  size="s"
                  onClick={() => setSegments(initial.map((s) => s.text))}
                >
                  Discard edits
                </Button>
              ) : null}
              <Button
                size="s"
                disabled={!dirty || busy}
                onClick={() =>
                  save.mutate({ id: post.id, segments: segments.map((t) => ({ text: t })) })
                }
              >
                Save edits
              </Button>
              <Button variant="primary" size="s" onClick={() => copy(segments.join('\n\n'), 'all')}>
                {copied === 'all' ? 'Copied' : segments.length > 1 ? 'Copy all' : 'Copy text'}
              </Button>
            </div>
          </div>

          {overLimit ? (
            <p className="draft-view__warning -p1">
              A post is over 280 characters — X will reject it.
            </p>
          ) : null}
          {privateMedia.length ? (
            <p className="draft-view__warning -p1">
              Attached media is still marked private. Approve it for public use before posting.
            </p>
          ) : null}
          {error ? <p className="draft-view__warning -p1">{error.message}</p> : null}

          {/* Revise with AI */}
          <div className="draft-view__revise flex flex-col">
            <span className="draft-view__label -meta">Revise with AI</span>
            <div className="draft-view__quick flex">
              {QUICK.map((q) => (
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
                onChange={(e) => setInstruction(e.target.value)}
                disabled={busy}
              />
              <Button
                variant="primary"
                size="s"
                type="submit"
                disabled={busy || !instruction.trim()}
              >
                {revise.isPending ? 'Revising…' : 'Revise'}
              </Button>
            </form>
          </div>
        </section>

        {/* Facts, questions, history */}
        <aside className="draft-view__side flex flex-col shrink-0">
          {unconfirmed.length ? (
            <p className="draft-view__warning -p1">
              {unconfirmed.length} detail{unconfirmed.length === 1 ? '' : 's'} to confirm before
              posting.
            </p>
          ) : null}

          {claims.length ? (
            <div className="flex flex-col">
              <span className="draft-view__label -meta">What this draft claims</span>
              <ul className="draft-view__claims flex flex-col">
                {claims.map((claim, i) => (
                  <li key={i} className="flex flex-col" data-basis={claim.basis}>
                    <span className="-p1">{claim.text}</span>
                    <span className="-meta">
                      {BASIS_LABEL[claim.basis]}
                      {claim.assetId && byId.get(claim.assetId)
                        ? ` · ${assetTitle(byId.get(claim.assetId)!)}`
                        : ''}
                    </span>
                  </li>
                ))}
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

          <Button
            variant="danger"
            size="s"
            onClick={() =>
              update.mutate(
                { id: post.id, status: 'discarded' },
                { onSuccess: () => navigate({ to: '/drafts' }) }
              )
            }
          >
            Discard this draft
          </Button>
        </aside>
      </div>
    </div>
  )
}
