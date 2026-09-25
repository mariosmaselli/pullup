# Publishing APIs — research (2026-09-25)

Researched by agents against official docs, then independently fact-checked. APIs change often: re-verify before building a connector. Decision: direct posting is **later**; Pullup exports files and copy-ready text now, to these specs.

## X (Twitter)

### Verdict (after fact-check)

The researcher's headline holds. Pullup can post straight to Mario's own X account from a localhost-only app, with no public server and no formal review. It needs prepaid Pay-Per-Use credits: no free tier, no minimum spend.

Three things change the design and budget:

1. **Media uploads are billed.** Each uploaded image or video records a PostCreate event of about $0.015 (staff, 2026-08-31). Failed and retried calls can also be billed.
   - A 1-media post costs about $0.03.
   - A 4-image post costs about $0.075.
   - A post with a URL and one media item costs about $0.215.
   - 30 media posts a month come to roughly $1–2.25, or up to about $6.50 if every post also has a link.
   - GET /2/users/me is free.

   A $10 pack with a hard spending limit is still fine. Pullup's cost preview and log should count media uploads as well as posts, and it should never auto-retry a 403.

2. **Plan for provisioning friction.** Several funded Pay-Per-Use apps in Aug–Sep 2026 get unexplained 403s on POST /2/tweets, OAuth 1.0a code-32 errors, or 'client-not-enrolled' from stale legacy apps. Build the connector with explicit error mapping (401 auth, 402 billing, 403 not permitted) and record the x-transaction-id. Do a real test post before building the UI.

3. **Auth.** Starting with the console's owner OAuth 1.0a token remains the fastest path. OAuth 2.0 PKCE with a 127.0.0.1 loopback redirect is the durable path. The 2026-09-21 token exchange makes migrating between them painless, and it always includes offline.access and media.write. Refresh-token rotation must be persisted atomically, with retries only on 5xx and a reconnect prompt on invalid_grant.

The product rules are confirmed: self-threads only, no quote-posts, one cashtag at most, and a $0.20 surcharge for any URL. The @mention status is still uncertain: the restriction was 'temporarily relaxed' in March and has had no final ruling. The video rule should read 'test 1080x1920 first'. The docs contradict themselves (they recommend 720x1280 but cap at 1280x1024), and they require a 5,000 kbps minimum bitrate, so a 720x1280 fallback should keep at least 5 Mbps.

Overall: build it. It's moderate effort at about $1–3 a month, with a test post on day 1 for account entitlement, 1080x1920 video, and @mentions.

### Blockers

- Nothing technical blocks a localhost-only app. Local signing with OAuth 1.0a needs no callback at all, and OAuth 2.0 PKCE accepts a loopback http://127.0.0.1 redirect.
- Mario has to buy credits with a card in console.x.com. There is no free tier, and API calls fail once the balance reaches $0 or goes negative.
- Any post with a URL in its text costs $0.20 instead of $0.015. Pullup should warn about this in the composer or strip links on X. X suggests quote_tweet_id instead of quote links, but that isn't available on pay-per-use.
- Pullup can't reply to other people's posts. It can only reply to Mario's own posts (threads) or where Mario was @mentioned. Quote-posts need an Enterprise plan.
- @mentions in normal posts were briefly blocked in Feb/Mar 2026 and have only been 'temporarily relaxed'. Pullup should handle the 'Creating posts with @mentions is not allowed for your access package' error.
- OAuth 2.0 refresh tokens can be used once and last about 6 months. Pullup must save each new refresh token to SQLite atomically and never refresh two at once. If the Mac is off for more than 6 months, Mario has to reconnect.
- OAuth 1.0a is announced as being retired, with no date given. Owner-token-only auth needs a way to switch to OAuth 2.0; X's token exchange (added 2026-09-21) makes that switch painless.
- A media_id expires after 24 hours. Scheduled posts need the Mac awake with the server running at publish time, and must upload media at that moment.
- Portrait 1080x1920 video conflicts with the documented limits (at most 1280x1024 in 'Advanced'; 1080p only for Premium). Without Premium, Pullup should transcode to 720x1280 H.264 High, AAC-LC, yuv420p or test the 1080x1920 files first. Non-Premium video can be up to 20 minutes and 8 GB.

### Recommended approach

Build the X connector on the X API v2 with pay-per-use credits. The official TypeScript SDK (@xdevplatform/xdk) runs in the Hono server; plain fetch works too.

What Mario must set up himself:
1. Sign in at console.x.com with his X account, accept the Developer Agreement, and create a Project and an App named "Pullup" (the name shows as the post's source label).
2. Add a payment card and buy a small credit pack, for example $10. Set a monthly spending limit of about $10 and leave auto-recharge off or low.
3. In the app's user authentication settings, set permissions to Read and write. Enable OAuth 2.0 as a Web App (confidential client) and register http://127.0.0.1:4500/api/x/callback. Also register the localhost version, because X's docs disagree on which one works.
4. Copy the Client ID and Secret, plus the API Key and Secret, into Pullup's local .env or keychain. Never put them in the frontend.

Auth design:
- Primary: OAuth 2.0 PKCE with scopes tweet.read, tweet.write, users.read, media.write, offline.access.
  - The Hono server starts the flow, opens https://x.com/i/oauth2/authorize, and swaps the code for tokens within 30 seconds on the callback.
  - Store the access token, refresh token and expiry in SQLite. Refresh when the access token has less than 5 minutes left, behind a mutex.
  - Save the new refresh token after every refresh, and show "Reconnect X" if you get invalid_grant.
- Quick start or fallback: the owner's OAuth 1.0a access token and secret from the console. This needs no redirect at all. If Pullup starts this way, move to OAuth 2.0 later with the /2/oauth2/token token-exchange grant before OAuth 1.0a is retired.

Publishing pipeline:
- Images: up to 4 per post, 5 MB each. Use the one-step POST /2/media/upload or the chunked flow.
- Video: chunked upload (initialize, append 4–5 MB chunks, finalize), then poll STATUS until 'succeeded'.
  - Transcode to 720x1280 H.264 High, AAC-LC, yuv420p, 30 fps before uploading, unless Mario has Premium or has confirmed 1080x1920 is accepted.
  - Alt text through POST /2/media/metadata costs $0.005 per request.
- Post: POST /2/tweets with media.media_ids. For threads, chain reply.in_reply_to_tweet_id to Mario's previous post.
- Composer rules for the X target:
  - Warn when the text contains a URL ($0.20 instead of $0.015).
  - Allow no more than one cashtag.
  - No quote-posts, and no replies to other people's posts.
  - Handle 403 errors for video duration and @mentions.
- Upload media at publish time, because a media_id expires after 24 hours.
- Log the cost of each post locally. Optionally check spend with GET /2/usage/tweets.

Expected cost at 5–30 posts a month: under $0.50 without links, and at most about $6 if every post has a link. Uncertain points to verify during the first test post:
- whether 1080x1920 video is accepted
- whether @mentions in top-level posts still work
- that media uploads don't consume credits (the rate card lists none)

### Fact-check corrections

- **corrected:** 2. Rate card: Post Create $0.015, Post Create with URL $0.200, summoned reply $0.010, Media Metadata $0.005, user read $0.010, owned reads $0.001. Deduplication within a UTC day. Spending limit and auto-recharge available. No line item for media upload.
  → Every listed price is correct, and so are the dedup rule ('24-hour UTC day window'), spending limits and auto-recharge. The implied conclusion that media uploads are free is wrong. On 2026-08-31 X staff confirmed that the console records one PostCreate event per uploaded media object, plus one for the final POST /2/tweets: 'the original Pay Per Use announcement billed Content (Create) for creating posts or media.' Chunked APPEND calls and STATUS polls are not billed. Staff also said 'Failed retries can still record usage.' So a post with 1 image or 1 video costs about $0.03, and a post with 4 images about $0.075. The rate card also has 'Interaction: Delete' ($0.010) and 'Content: Manage' ($0.005), and nothing maps these to endpoints, so the cost of deleting a post is undocumented.
- **corrected:** 5. Cost estimate: 5–30 text posts cost $0.075–$0.45 a month; 30 URL posts cost $6. GET /2/users/me adds about $0.01 per call.
  → Each media upload is also billed at about $0.015, and GET /2/users/me is free. Mario's posts will mostly carry media, so realistic costs are:
- 30 posts with 1 image or video each: about $0.90 a month.
- 30 posts with 4 images each: about $2.25.
- 30 posts that each have a URL plus 1 media item: about $6.45.

Failed or retried calls (including refused 403 posts) can still be billed. A $10 credit pack is still plenty.
- **corrected:** 9. A media_id has expires_after_secs = 86400, so upload at publish time. X staff confirmed that expired media_ids can't be reused.
  → The 24-hour expiry is confirmed. The statement about reuse after expiry came from a forum user (PootDibou, 2026-05-16), not X staff. Designing for upload at publish time is still correct, and uploads are billed, so avoid unnecessary re-uploads and retries.
- **corrected:** Blocker: portrait 1080x1920 conflicts with the 1280x1024 'Advanced' limit, and 1080p is Premium only, so transcode to 720x1280 H.264 High, AAC-LC, yuv420p.
  → The best-practices page contradicts itself. It recommends 720x1280 portrait, yet a literal reading of '32x32 to 1280x1024' rules 720x1280 out too, so the limit is plainly stale or orientation-agnostic. It says 'Subscribed users can upload a 1080p video and get 1080p playback'; unsubscribed accounts get 720p playback, which suggests downscaling on playback rather than rejection. The same page also lists frame rate ≤60 fps, aspect ratio between 1:3 and 3:1, and a 'Minimum Video Bitrate: 5,000 kbps' (plus 128 kbps audio). A Pullup transcode to 720x1280 should respect that bitrate. Whether 1080x1920 is accepted for a non-Premium account is still unverified; test it.

### Missed by first pass

- Media uploads are billed. Staff (2026-08-31) confirmed that each uploaded media object records a PostCreate event (about $0.015), on top of the final POST /2/tweets. APPEND calls and STATUS polls are free. Failed retries 'can still record usage'. So Pullup's per-post cost estimate and retry logic must count media, and it should not re-upload blindly on failure. https://devcommunity.x.com/t/undocumented-postcreate-usage-for-media-uploads-please-clarify-pay-per-use-billing/274646
- GET /2/users/me is free on Pay Per Use (staff, 2026-09-25), so the connection check costs nothing. https://devcommunity.x.com/t/oauth-2-0-user-context-get-2-users-me-returns-http-403/276661
- Aug–Sep 2026 has a cluster of funded, Read+Write Pay-Per-Use apps getting a bare 403 on every POST /2/tweets while media upload succeeds. Refused attempts reportedly still show as PostCreate usage, and staff are investigating app by app. Pullup should make a real test post on day 1, record the x-transaction-id on failures, and stop after the first 403 instead of retrying (retries cost money). https://devcommunity.x.com/t/post-2-tweets-returns-403-not-permitted-on-a-read-write-funded-pay-per-use-app/274069 ; https://devcommunity.x.com/t/post-2-tweets-returns-403-forbidden-on-pay-per-use-app-app-id-33356113-per-taycaldwells-request-in-another-thread/275910
- Error mapping for the connector per staff: 401 = auth, 402 = billing, 403 = the account isn't permitted to create that post (posting limits, integrity blocks, forbidden reply or mention). Also 'client-not-enrolled' when an old app is stuck on the deprecated Free project. If Mario has an old developer account or app, it must sit in the Pay Per Use project. https://devcommunity.x.com/t/post-2-tweets-returns-403-not-permitted-on-a-read-write-funded-pay-per-use-app/274069 ; https://devcommunity.x.com/t/client-not-enrolled-app-stuck-on-free-deprecated-25-ppu-credits-loaded/272570
- Refresh-token handling per staff (2026-07-27): the server rotates the refresh token as soon as it processes a refresh, even if the client never gets the response. Recommended handling:
- Retry only on 5xx.
- On a 400/401 invalid_grant, treat the token as dead and ask to reconnect.
- Briefly keep the previous refresh token as a fallback.
https://devcommunity.x.com/t/refresh-token-invalidated-after-a-503-outage-was-it-rotated-server-side/271768
- The OAuth 2.0 consent screen now shows a mandatory 'Sensitive permissions requested / I trust this app' checkbox for tweet.write and media.write scopes, and it can't be removed. That's a UX note for the Connect X flow. https://devcommunity.x.com/t/review-request-sensitive-permissions-requested-warning-on-oauth-2-0-screen-rawwij-app-id-32447959/275832
- Video spec internals: the best-practices page lists a minimum video bitrate of 5,000 kbps and audio of 128 kbps, ≤60 fps and an aspect ratio between 1:3 and 3:1. Its '1280x1024' maximum conflicts with its own recommended 720x1280 portrait. Pullup's transcode preset should target at least 5 Mbps, and 1080x1920 acceptance for non-Premium accounts needs testing. https://docs.x.com/x-api/media/quickstart/best-practices
- Posting rate limits disagree. The docs say 200 POST per 15 min per user, 50 DELETE per 15 min, and 300 posts plus reposts per 3 h. Pay-Per-Use users report the console showing 100 per 15 min per user and 10K per 24 h per app. Irrelevant at Mario's volume. https://docs.x.com/x-api/posts/manage-tweets/integrate
- Staff (2026-06-15): an account labelled 'Automated' that posts API replies can be visibility-filtered. Mario's personal account should not be set as an automated or bot account for Pullup's self-scheduling. https://devcommunity.x.com/t/restricting-programmatic-replies-does-this-affect-replying-to-itself/257955
- The cost of deleting a post is undocumented. The rate card has 'Interaction: Delete' at $0.010 and 'Content: Manage' at $0.005 with no endpoint mapping, so a Pullup 'delete from X' action has an unknown small cost. https://docs.x.com/x-api/getting-started/pricing
- POST /2/tweets supports edit_options (previous_post_id) for editing posts and reply_settings. These could back an 'edit after publish' feature, though editing eligibility normally depends on Premium. https://docs.x.com/x-api/posts/create-post
- The official TypeScript XDK exists on npm as @xdevplatform/xdk: version 0.6.6, last modified 2026-07-25, so still pre-1.0. Plain fetch plus a small OAuth helper may be more stable. Checked via `npm view @xdevplatform/xdk`.

### Sources

- https://devcommunity.x.com/t/no-free-plan/257026
- https://docs.x.com/x-api/getting-started/pricing
- https://devcommunity.x.com/t/x-api-pricing-update-owned-reads-now-0-001-other-changes-effective-april-20-2026/263025
- https://devcommunity.x.com/t/concern-about-url-posting-cost/264451
- https://devcommunity.x.com/t/important-update-legacy-x-api-basic-plans-are-moving-to-pay-per-use-ppu/266305
- https://docs.x.com/x-api/posts/create-post
- https://devcommunity.x.com/t/restricting-programmatic-replies-does-this-affect-replying-to-itself/257955
- https://devcommunity.x.com/t/unable-to-post-tweet-with-mention/258356
- https://docs.x.com/x-api/media/quickstart/media-upload-chunked
- https://docs.x.com/x-api/media/introduction
- https://docs.x.com/x-api/media/quickstart/best-practices
- https://docs.x.com/x-api/getting-started/getting-access
- https://docs.x.com/fundamentals/authentication/oauth-2-0/oauth-1-0a-token-exchange
- https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/authorization-code
- https://docs.x.com/resources/fundamentals/authentication/faq
- https://docs.x.com/fundamentals/developer-apps
- https://docs.x.com/x-api/fundamentals/rate-limits
- https://docs.x.com/developer-guidelines
- https://docs.x.com/changelog

## Instagram

### Verdict (after fact-check)

Mostly confirmed, with a few corrections. Pullup can publish image and video Stories, JPEG feed posts, carousels and Reels to Mario's own account through the Instagram API with Instagram Login (graph.instagram.com), for free, without a Facebook Page and without App Review (Standard Access, own account). The hard constraint is real and officially documented: Meta downloads every image and video from a public HTTPS URL, and the only local-upload path (rupload) is for Facebook Login apps and video only. So a local-only Pullup needs a public media host. Cloudflare R2 with pre-signed GET links is a good fit (links can last up to 7 days, only on the S3 domain; free tier; a card is needed to enable it). Test once that Meta's fetcher accepts the signed query-string URLs. Changes to the researcher's plan: (1) Make the account a BUSINESS account, not Creator, because Meta's Stories launch and Ayrshare both limit Stories publishing to Business accounts, and the current docs are silent. (2) Create the app with the new 'Manage messaging & content on Instagram' use case, not 'Other' then 'Business'. (3) Stories ignore captions, so render all story text into the media and keep a separate caption field for feed and Reels. (4) Read the publishing quota at runtime, because the docs give both 50 and 100. (5) Pin the Graph API version (v25 in the docs, v26 reportedly released July 2026) in one config value. (6) Poll video containers past the 5-minute guideline. (7) Use royalty-free audio in video templates and surface copyright_check_status. Two points are still unverified and should be tested before building the full integration: whether Development-mode posts are visible to people without a role on the app (Meta's generic App Modes doc says no, and third-party guides say yes), and the exact dashboard-token lifetime and 'public account' requirement. The first real test should be one image story on a Business account, checked from a second account that has no role on the app. The 1–2 day effort estimate is reasonable.

### Blockers

- Public URL requirement: Meta downloads every image, video and Reel cover from a public HTTPS URL. With Instagram Login there is no local upload option at all (rupload is documented as Facebook Login for Business only, and only for video), so a local-only Pullup needs external hosting (R2/S3) or a tunnel.
- Mario's Instagram account must be a professional account (Creator or Business) and, for the dashboard token flow, public. Personal accounts cannot use the API.
- A Meta developer account is required, which needs a Facebook account with phone and email verification, even though Instagram Login needs no Facebook Page.
- Unclear whether posts from a Development-mode app are publicly visible. Meta's general doc says test posts are visible only to users with a role on the app; third-party Instagram guides say they are public. If they turn out to be private, the app has to go Live, which per Meta's create-app guide needs a Business-Verified business connected (Nonlinear Studio OÜ could do this). Meta's docs contradict each other on this.
- Tokens last 60 days and must be refreshed while still valid (and at least 24h old). If Pullup is not run for more than 60 days, Mario has to regenerate the token by hand.
- Stories published through the API cannot have link, poll or location stickers, music, or native text. All overlays must be rendered into the JPEG or MP4, and link stickers are impossible.
- Strict media specs: stories and feed images must be JPEG (not PNG); videos must be H.264/HEVC + AAC, closed GOP, moov atom at the front; stories 3–60 s and ≤100 MB. Pullup needs an ffmpeg/transcode step and must split longer stories.
- OAuth redirect URIs are effectively HTTPS-only (not explicitly documented for Instagram Login). An in-app OAuth flow on http://localhost:4500 will likely be rejected. Use the dashboard-generated token or an https://localhost callback with a locally trusted certificate.

### Recommended approach

Use the Instagram API with Instagram Login, keep the Meta app in Development mode with Standard Access, host media on Cloudflare R2, and pass 24-hour pre-signed links to Meta.

What Mario sets up himself:
1. In the Instagram app, switch his account to a Creator (or Business) account and keep it public. No Facebook Page is needed.
2. Register at developers.facebook.com with his Facebook account (phone and email verification).
3. Create an app: use case 'Other', type 'Business'. Add the Instagram product and choose 'API setup with Instagram login'. Don't connect a Business portfolio yet, because of the reported tester conflict.
4. In 'Generate access tokens', add his Instagram account and log in. Accept the tester invite in Instagram if asked. Copy the token and his IG user ID into Pullup's settings. Pullup needs only the instagram_business_basic and instagram_business_content_publish permissions.
5. Create a Cloudflare account and an R2 bucket (e.g. 'pullup-media'). Add a lifecycle rule that deletes the prefix 'ig/' after 1 day. Create an R2 API token with Object Read & Write on that bucket only, and put the account ID, key and secret in Pullup's .env. Cloudflare may ask for a payment method to turn on R2 even on the free tier; I did not verify this. Expected cost is $0 at his volume.

What Pullup does:
1. **Rendering.** Text, image and video templates render to IG-safe files:
   - Stories: 1080x1920 sRGB JPEG under 8 MB.
   - Feed and carousel: 1080x1350 (4:5) JPEG, every slide the same aspect as the first.
   - Story video: ffmpeg to H.264 High, yuv420p, closed GOP, 30 fps, AAC 48 kHz 128k, `-movflags +faststart`, 3–60 s, under 100 MB. Split anything longer into 60 s parts; each part is its own post.
   - Reels: same codecs, up to 15 min and 300 MB, with a JPEG cover.
2. **Publishing.**
   - Upload the file to R2 over the S3 API (@aws-sdk/client-s3 or aws4fetch, both fine from Hono).
   - Create a pre-signed GET URL with a 24h expiry (the container lifetime).
   - POST graph.instagram.com/v26.0/{ig_id}/media with image_url or video_url, media_type=STORIES/REELS/CAROUSEL, and caption for feed posts. user_tags can be used for mentions.
   - Poll status_code once a minute for up to 5 minutes until FINISHED, then POST /media_publish.
   - Store the returned media ID, then delete the R2 object. The lifecycle rule is a safety net.
   - Read quota_total and quota_usage from /content_publishing_limit instead of hardcoding 100 or 50.
3. **Token refresh.** Save the token with its issue date in SQLite (or the macOS Keychain). On startup or daily, call graph.instagram.com/refresh_access_token when the token is older than about 7 days. Show a 'reconnect Instagram' warning if it is close to 60 days or a refresh fails.
4. **Optional in-app OAuth later.** Register https://localhost:4500/auth/instagram/callback with an mkcert certificate. Meta never calls it, only Mario's browser does. Exchange the code server-side with the app secret.

First test: publish one image story and check from a second account that has no role on the app. If the story is not publicly visible, connect Nonlinear Studio OÜ as a business portfolio, complete Business Verification, and switch the app to Live. Standard Access still needs no App Review for his own account.

Why not the alternatives:
- A tunnel (cloudflared quick tunnel, Tailscale Funnel) avoids a cloud account, but the Mac must be awake, the home upload link can cause Meta fetch timeouts, and it exposes the local server. Use it for testing only.
- Facebook Login for Business with a linked Page unlocks local video upload through rupload.facebook.com, but images and Reel covers still need public URLs. It also adds the Page and PPA requirements, so it doesn't remove the hosting need.

Product constraints for the templates:
- Instagram has no text-only posts, so Pullup's text 'styles' become rendered story or feed images.
- Links can't be clickable in API stories. Put the URL in the artwork or bio, or add a link sticker by hand in the Instagram app when it matters.
- Music has to be baked into the video.

### Fact-check corrections

- **unverifiable:** 13. The redirect URI must match exactly, and plain http://localhost is effectively rejected, so plan for HTTPS (https://localhost works).
  → No official Instagram statement exists. Community evidence consistently says HTTPS is required and https://localhost works. The plan to use HTTPS with mkcert stands.
- **unverifiable:** 14. The dashboard 'Generate access tokens' step gives a roughly 60-day long-lived token for his own account, and the account 'must be public'.
  → Third-party guides agree that the dashboard token is long-lived (60 days). The 'must be public' requirement could not be verified against the current Meta page. Pullup should call GET /debug_token-style introspection or check the expiry at import rather than assume it.
- **unverifiable:** 16. Meta's docs conflict about App Review and Business Verification before going Live.
  → The conflict remains, and the researcher's quoted step-10/step-2 wording can no longer be checked on the current page.
- **unverifiable:** 17. It is unclear whether posts published from a Development-mode app are public.
  → Still unresolved officially. The researcher's plan to test from a second account that has no role on the app is correct.
- **corrected:** 18. Registering as a Meta developer needs a Facebook account with phone and email verification. The app is created with use case 'Other' and type 'Business'.
  → Registration requirements are confirmed. App creation has changed: the current flow asks you to pick the 'Manage messaging & content on Instagram' use case, then Customize, then Permissions, then 'Generate access tokens'. 'Other, then Business type' is the older flow and may no longer be shown. Update setup step 3.
- **unverifiable:** 20. Nothing official says whether Meta's fetcher accepts S3/R2 pre-signed query-string URLs, so test it. Expiry should cover the whole 24h container window.
  → 

### Missed by first pass

- STORIES MAY NEED A BUSINESS ACCOUNT, NOT A CREATOR ACCOUNT. Meta's Stories-publishing launch post only mentions 'Instagram Business accounts' (https://developers.facebook.com/blog/post/2023/05/16/introducing-stories-publishing-to-the-content-publishing-api-on-instagram/). Ayrshare's current docs state 'Instagram currently only supports Story publishing on Instagram Business Accounts and not Creator Accounts' (https://www.ayrshare.com/docs/apis/post/social-networks/instagram). The current Meta content-publishing page doesn't make this distinction, and an April 2026 reference gist says both account types work. Stories are Mario's main use case, so he should switch to a BUSINESS account, not Creator, to be safe.
- PUBLISHING QUOTA CONFLICT: 50 OR 100. content-publishing says 'limited to 100 API-published posts within a 24-hour moving period', but the content_publishing_limit reference says quota_total is 'currently 50' (https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit). Reading the value at runtime is correct. Either number is far above Mario's volume.
- STORIES IGNORE CAPTIONS. Any caption text or hashtags sent with a story are dropped (Ayrshare docs above; ig-user/media lists no caption support for stories). Pullup's cross-post model must keep a separate caption field for IG feed/Reels and render story text into the image.
- The Meta app setup flow has changed to a use case: pick 'Manage messaging & content on Instagram', then Customize, then Permissions and 'Generate access tokens' (https://developers.facebook.com/docs/instagram-platform/create-an-instagram-app/). The researcher's step 3 ('Other' then 'Business') is outdated.
- API VERSION: the Meta reference examples still show v25.0 (Graph API v25 was announced Feb 18, 2026: https://developers.facebook.com/blog/post/2026/02/18/introducing-graph-api-v25-and-marketing-api-v25/). A third-party report says v26.0 shipped July 29, 2026 (https://unalsoft.com/blog/2026-07-31-meta-graph-api-v26/en/). Pin the version in one config constant.
- Music and copyright: IG Containers expose copyright_check_status (https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-container.md). API posts cannot use Instagram's licensed music library, and copyrighted music baked into a video can get the video muted or blocked. Pullup's video templates should use royalty-free audio, and Pullup should show copyright_check_status after publishing.
- alt_text is supported on IMAGE feed posts since Mar 24, 2025, but not on Reels or Stories (content-publishing.md). Pullup can pass the image alt text it already has to LinkedIn and X as well.
- Mixed carousel crop: all carousel items are cropped to the FIRST item's aspect ratio (default 1:1). A carousel template that mixes a 9:16 video with 4:5 images will be cropped. Force one aspect ratio per carousel template.
- Container polling: the 5-minute guidance from Meta is a soft recommendation. A 15-minute, 300 MB Reel can take longer, so treat IN_PROGRESS beyond 5 minutes as 'keep waiting' until the container expires, not as a failure.
- Cloudflare R2 needs a payment method on file to enable, even on the free tier (community reports: https://community.cloudflare.com/t/why-using-r2-free-tier-involves-giving-card-info/945179). Mario has to add the card himself, and Pullup can't do this for him.

### Sources

- https://developers.facebook.com/docs/instagram-platform/overview
- https://developers.facebook.com/documentation/instagram-platform/content-publishing
- https://developers.facebook.com/documentation/instagram-platform/changelog
- https://developers.facebook.com/documentation/instagram-platform/app-review
- https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media
- https://developers.facebook.com/documentation/instagram-platform/content-publishing/resumable-uploads
- https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login
- https://developers.facebook.com/documentation/facebook-login/security
- https://developers.facebook.com/documentation/instagram-platform/create-an-instagram-app
- https://developers.facebook.com/documentation/development/build-and-test/app-modes
- https://keryx.phpboyscout.uk/how-to/instagram-credentials/
- https://developers.facebook.com/documentation/development/register
- https://www.blotato.com/blog/instagram-api-pricing
- https://github.com/gitroomhq/postiz-app/issues/2000
- https://developers.cloudflare.com/r2/pricing/
- https://dravo.dev/docs/platforms/instagram
- https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/

## LinkedIn

### Verdict (after fact-check)

The researcher's verdict holds, and they did careful work. Pullup can publish text, single images, 2–20 images, videos, PDF or other documents, and polls to Mario's personal LinkedIn profile for free. It needs only the self-serve Share on LinkedIn and OpenID Connect products, and it uploads bytes directly from the local Node server, so no public hosting is required. Every load-bearing claim checked out against 2025–2026 official docs, apart from minor corrections: 'three open permissions across two products' rather than 'three products'; Standard-tier narration is recommended, not required; and CM can eventually be applied to an existing app through the Standard-tier form.

Implementation corrections that matter:
(1) The image upload PUT needs the Authorization header, but video part PUTs must not send it.
(2) The legacy GET on rest/images is documented as working with w_member_social, so an image readiness check may be possible. Test it rather than assuming it is impossible.
(3) Enforce the 150-requests-per-member-per-day Share on LinkedIn limit.
(4) The Posts API cannot schedule posts, so a local-only Pullup must be running and awake at post time.

The two real uncertainties are unchanged:
- http://localhost redirect acceptance: the official page says HTTPS, while LinkedIn's own sample uses http://localhost. Keep the Token Generator or local HTTPS fallback.
- Whether self-serve apps may officially use the versioned /rest endpoints: very likely, since every content API page lists w_member_social and person owners, but no page says so explicitly.

Plan for the 60-day reconnect before expiry, since silent re-auth needs an unexpired token, and for a yearly Linkedin-Version bump; 202609 is good until at least September 2027. The company page stays a Phase-2 CM application with uncertain approval. If it is approved, it may also bring refresh tokens, which is unconfirmed. Pullup must then follow the 24/48-hour storage limits for any comment or profile data it displays.

### Blockers

- No refresh token for self-serve apps. The access token dies after 60 days and Mario must reconnect through the browser. This is usually one click if he is logged in to linkedin.com and the old token has not yet expired. It is not a blocker, but Pullup needs an expiry warning and a Reconnect button, or scheduled posts will quietly fail around day 60.
- Posting as the Nonlinear Studio company page needs w_organization_social, which only the manually reviewed Community Management API provides. That requires a registered legal entity (Nonlinear Studio OÜ qualifies), a verified business-domain email (not Gmail), a website, a privacy policy, and a Page-verified, brand-new app. Approval of a one-company internal tool is not guaranteed, and the Standard tier needs a narrated screencast.
- The developer app has to be linked to a LinkedIn Page, and the link is permanent. Mario must pick Nonlinear Studio's Page, where he approves the link as super admin, or LinkedIn's default page for individual developers.
- Pullup cannot read back personal posts or analytics: r_member_social is closed and post analytics need Community Management. It must record each post URN from the x-restli-id header at publish time and cannot sync edits made in the LinkedIn app.
- A w_member_social token cannot GET /rest/images on the versioned API, so Pullup cannot confirm an image finished processing. The docs don't say whether the same restriction applies to /rest/videos. Pullup should post right after finalizeUpload and retry with backoff on errors such as MEDIA_ASSET_WAITING_UPLOAD or PROCESSING.
- Small risk: the official OAuth page says redirect URLs must be HTTPS, while LinkedIn's own sample app uses http://localhost. If the portal rejects http://localhost:4500, fall back to the Developer Portal Token Generator and paste the token in, or use a local HTTPS redirect.
- Annual maintenance: the Linkedin-Version header must be raised before its version is sunset (each lasts at least 12 months), or every call returns an error.

### Recommended approach

Build LinkedIn as a self-serve integration for the personal profile: Share on LinkedIn plus OpenID Connect, calling the versioned /rest API from Pullup's local Hono server. Treat the company page as a separate phase 2.

WHAT MARIO SETS UP HIMSELF (about 15 minutes, free):
1. Make sure Nonlinear Studio has a LinkedIn Page with Mario as super admin, or plan to pick LinkedIn's default page for individual developers.
2. Go to developer.linkedin.com, then My apps, then Create app. Name it "Pullup" (avoid "Linked" and "In" in the name), link it to the Nonlinear Studio Page, and add a logo and a privacy-policy URL (a simple page on the studio site is fine). Then approve the Page-verification request as super admin.
3. On the Products tab, add "Share on LinkedIn" and "Sign In with LinkedIn using OpenID Connect". Both are self-serve.
4. On the Auth tab, add the redirect URL http://localhost:4500/api/oauth/linkedin/callback. Copy the Client ID and Client Secret into Pullup's local config, stored in the macOS Keychain or a gitignored .env. The secret stays on the local server and never goes to the React front end.

WHAT PULLUP IMPLEMENTS:
- OAuth: authorization-code flow with scope "openid profile w_member_social", a CSRF state value, and the code exchange done on the server at https://www.linkedin.com/oauth/v2/accessToken. Store access_token (allow at least 1000 characters) and expires_at in SQLite. Call GET /v2/userinfo, then save urn:li:person:{sub}. Keep the scope list fixed, because changing scopes invalidates old tokens.
- Token UX: show "LinkedIn expires in N days", warn at 7 days, and offer a one-click Reconnect that is usually silent. Block scheduled LinkedIn posts once the token has expired.
- Every API call sends the headers Authorization: Bearer, Linkedin-Version: 202609 (a config constant), X-Restli-Protocol-Version: 2.0.0, and Content-Type: application/json. URL-encode any URN used in a path. Add a yearly reminder to raise the version; 202609 is supported until at least September 2027.
- Text: escape the reserved characters | { } @ [ ] ( ) < > # \ * _ ~ except in hashtags and mentions Pullup builds on purpose. Enforce roughly 3,000 characters.
- Images: initializeUpload with owner = the person URN, PUT the bytes to uploadUrl, then use urn:li:image in content.media (with altText). For 2–20 images, use content.multiImage.images.
- Video (screen recordings, 1080x1920 story renders): initializeUpload with fileSizeBytes, and uploadThumbnail true if Pullup renders a cover frame. PUT each byte range exactly as uploadInstructions gives it, collect ETags in order, call finalizeUpload, then post content.media.id = urn:li:video. Export MP4 H.264 under 500 MB and between 3 s and 10 min; 9:16 is allowed. An optional English SRT caption file can be added.
- Slide carousels: export a PDF and post it as a document (up to 100 MB and 300 pages; title required). This is LinkedIn's only swipeable format that doesn't require paying for ads.
- Links: the API will not build previews. Either put the URL in the text, or send an article object with a title, a description and a thumbnail uploaded through the Images API.
- After publishing, save x-restli-id and https://www.linkedin.com/feed/update/{urn}/ in SQLite. Offer Edit (PARTIAL_UPDATE) and Delete. Retry 409, 429 and 5xx responses with backoff.

FORMAT MAPPING FOR PULLUP'S STYLE SYSTEM: an Instagram Story video goes to LinkedIn as a vertical video post, and a story image goes as a single image post. A multi-frame text or image story becomes a multi-image post (2–20) or a PDF document post. Plain text goes as the post body with the escaping above.

PHASE 2, COMPANY PAGE (only if still wanted): create a new, separate developer app, because Community Management cannot be added to an app that already has other products. Apply for Community Management API Development tier as Nonlinear Studio OÜ. This needs a studio-domain email (not Gmail), the legal name and registered address, the website, a privacy policy, and the app verified by the studio Page. The Page Management use case covers posting to its own page. The Development-tier limits (500 calls per app and 100 per member per day) are plenty for one user. Standard tier later needs a narrated screencast. Approval of a single-company internal tool is uncertain, so Pullup should keep a manual fallback: copy the text and export the media for posting by hand. If approved, this one app could also replace the personal app, since Community Management includes w_member_social.

### Fact-check corrections

- **corrected:** 1. Only three products are open to all developers: OIDC (profile, email) and Share on LinkedIn (w_member_social), all self-serve on the Products tab. Most other permissions need explicit approval.
  → The substance is right, but the page lists three open PERMISSIONS (profile, email, w_member_social) spread over TWO products (Sign in with LinkedIn using OpenID Connect, and Share on LinkedIn). The page says 'Open Permissions are the only permissions that are available to all developers without special approval.' The openid scope belongs to the OIDC product. Separately, the Increasing Access page (updated 2026-08-17) calls Events Management API 'self-serve ... on request', but it is not relevant to Pullup.
- **corrected:** 9. Images: initializeUpload with a person owner, upload bytes to uploadUrl, no synchronous upload. Formats JPG/PNG/GIF (up to 250 frames), under 36,152,320 px. A w_member_social token cannot GET /rest/images, so image status cannot be polled.
  → Mostly right, with two corrections. (a) The Images page says the write-only restriction 'only applies to versioned gateway calls. w_member_social permissions are sufficient to make legacy GET calls to rest/images.' So a status check may be possible through the legacy (unversioned) call. That is worth testing rather than treating as impossible. (b) The researcher left out that the image PUT to uploadUrl REQUIRES the OAuth Authorization header. The Images page defers to the Assets 'Upload the Image' section, which says: 'The upload call requires a valid OAuth token in the Authorization header. This is different than the upload video call which doesn't accept an OAuth token.' altText is at most 4,086 characters, and fewer than 120 is recommended.
- **corrected:** 19. Dev tier: 500 calls per app and 100 per member per 24 h, no BATCH_GET, webhooks off, 12 months to build. Standard needs a narrated screencast. Dev tier only on a new app with no other products, so it cannot be added to the personal app. CM includes w_member_social.
  → The limits, BATCH_GET, webhooks, 12 months and the inclusion of w_member_social are all confirmed. Two corrections. (a) Narration is only 'recommended', not required. The screencast must be high resolution and downloadable, and for Page Management it must show the OAuth flow, posting, and how comments and commenter data are displayed. Missing functionality may simply be noted in the recording. (b) 'Cannot be added to the personal app' is too absolute. Development tier must be requested on a new app with no other API products (FAQ #4). But once Standard tier is approved, the App Review page says you can apply Standard to a different, existing app by giving the approved app's client ID, and FAQ #5 says CM can be added to an existing app via those steps. So Phase 2 could end with CM on one consolidated app.

### Missed by first pass

- Rate limit: the only official Share on LinkedIn limit is 150 requests per member per day and 100,000 per app per day, reset at UTC midnight (https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin, updated 2023-12-14; repeated by https://www.blotato.com/blog/linkedin-posting-api, 2026-09-08). One video post costs initializeUpload, finalizeUpload and posts, plus optional retries. Pullup should count its LinkedIn API calls per day and never retry in tight loops. Whether the dms-uploads PUTs count toward the limit is undocumented.
- Upload auth differs by media type. Image PUT to uploadUrl REQUIRES 'Authorization: Bearer'. Video part PUTs must NOT send it. The thumbnail PUT needs 'media-type-family: STILLIMAGE'. Captions are a multipart/form-data POST (https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/vector-asset-api 'Upload the Image'/'Upload the Video', updated 2026-01-28; https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api, 2026-03-02). A shared 'uploadBytes' helper that always adds the token will break video, or else image.
- Image readiness can maybe be checked after all. The Images API says the w_member_social write-only restriction 'only applies to versioned gateway calls. w_member_social permissions are sufficient to make legacy GET calls to rest/images' (https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api, 2026-06-24). The Assets page warns that a post created before its image finishes processing 'won't be visible to members' if processing fails. Pullup should test the legacy GET, for example without the Linkedin-Version header, as a readiness check before POST /rest/posts.
- Organic polls are available with w_member_social: 2–4 options of at most 30 characters each, a question of at most 140 characters, and a duration of 1, 3, 7 or 14 days. Polls cannot be edited after posting (https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/poll-post-api, updated 2026-04-30). This gives a direct mapping for an IG Story poll sticker in Pullup's format system.
- Per-post visibility options are PUBLIC, CONNECTIONS and LOGGED_IN (https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/post-api-schema, updated 2026-04-30). Pullup can offer an audience selector per LinkedIn post.
- The Posts API has no scheduled-publish field. lifecycleState accepts only PUBLISHED on create (post-api-schema, 2026-04-30). All scheduling must be done by Pullup's local server, so on a local-only Mac, scheduled LinkedIn posts fire only if the Mac is awake and the Hono server is running at that moment. Pullup needs catch-up or missed-schedule handling, and possibly pmset/launchd wake scheduling. The same applies to X and IG.
- Documents: PPT, PPTX, DOC, DOCX and PDF are allowed, up to 100 MB and 300 pages. content.media.title is 'Required field for Documents API'. Person owners are allowed with w_member_social (https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/documents-api, updated 2026-06-24). This confirms the researcher's PDF-carousel plan and fills in the formats.
- Phase 2 compliance: under the Marketing API Terms, member social activity data (for example comments shown in Pullup) may only be stored for 48 hours and most profile data for 24 hours. There are also 'no social feeds' and data-minimization rules (https://learn.microsoft.com/en-us/linkedin/marketing/restricted-use-cases, updated 2025-08-29). If Pullup ever displays comments for the Standard-tier screencast, it must not store them long-term in SQLite.
- Phase 2 may remove the 60-day reconnect. Programmatic refresh tokens are available to 'all approved Marketing Developer Platform (MDP) partners' (https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens, 2025-10-08). Whether a CM Development-tier app counts as an MDP partner with refresh tokens enabled is not stated officially, so this is UNCERTAIN. Pullup's token table should include nullable refresh_token and refresh_expires_at columns from the start.
- Posts API errors to handle explicitly: FIELD_LENGTH_TOO_LONG (the commentary limit is not officially documented; 3,000 comes only from third-party sources such as https://authoredup.com/blog/linkedin-character-limit), MEDIA_ASSET_WAITING_UPLOAD and MEDIA_ASSET_PROCESSING_FAILED on the video side, EXPIRED_UPLOAD_URL, and 409, 429, 500 and 503 (posts-api and videos-api error tables). Whether escape backslashes count toward the length is unknown, so validate on the unescaped text and leave headroom.
- Developer Portal has a Token Inspector (https://www.linkedin.com/developers/tools/oauth/token-inspector) for checking a token's TTL and status (https://learn.microsoft.com/en-us/linkedin/marketing/quick-start, updated 2026-08-17). It is useful for debugging Pullup's expiry UI.

### Sources

- https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access
- https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin
- https://www.linkedin.com/help/linkedin/answer/a548360/associate-an-app-with-a-linkedin-page
- https://www.linkedin.com/help/linkedin/answer/a1667239
- https://github.com/vjpixel/diaria-studio/issues/8178
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api
- https://www.blotato.com/blog/linkedin-posting-api
- https://learn.microsoft.com/en-us/linkedin/marketing/versioning
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/contentapi-migration-guide
- https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api
- https://www.linkedin.com/help/linkedin/answer/a548372
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/multiimage-post-api
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/documents-api
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/little-text-format
- https://ferryman.io/character-limits/linkedin
- https://learn.microsoft.com/en-us/linkedin/shared/authentication/sample-applications
- https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow
- https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens
- https://learn.microsoft.com/en-us/linkedin/shared/authentication/developer-portal-tools
- https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview
- https://learn.microsoft.com/en-us/linkedin/marketing/restricted-use-cases
