# ResearchPulse data Worker

This Worker lives with the frontend and handles authenticated PDF access through the Cloudflare R2 bucket binding. The browser sends Firebase ID tokens to the Worker. Manuscript metadata extraction uses `NEXT_PUBLIC_GROBID_URL` directly from the frontend.

## Routes

- `POST /r2/upload?fileName=...`: uploads a PDF from an authenticated student or lecturer to the `storage-pdf` bucket.
- `GET /r2/object?key=...&publicationId=...`: checks Firestore access and streams the PDF, including HTTP byte-range requests for in-browser PDF rendering. Public guest publications can be read without signing in.
- `DELETE /r2/object?key=...&publicationId=...`: deletes a draft owner's PDF after checking ownership; admins may delete by key.
- `POST /auth/register` and `POST /auth/invite`: registration and admin invitation routes.
- `POST /api/processHeaderDocument`: optional forwarding route for private GROBID deployments.
- `GET /health`: Worker health response.

## Run locally

From the FE repository root:

```powershell
npm run worker:dev
```

The local Worker listens on `http://localhost:8787`. Wrangler uses a local R2 emulator by default; local uploads do not prove that a deployed Worker can write to the Cloudflare bucket.

Optional local Worker secrets go in `worker/.dev.vars`, which is ignored by Git. See `.dev.vars.example` for variable names.

## Deploy

From the FE repository root, authenticate with Cloudflare once, then deploy:

```powershell
npx wrangler login
npm run worker:deploy
```

Wrangler prints the deployed `workers.dev` URL. Set its origin as `NEXT_PUBLIC_R2_WORKER_URL` in `.env.local`, restart the FE, and check `<worker-url>/health` before testing an upload with a student or lecturer account. Admin uploads are intentionally rejected.

The `PUBLICATION_PDFS` binding and `storage-pdf` bucket are declared in `wrangler.toml`. Do not place R2 S3 credentials in FE environment variables; the Worker accesses the bucket through the binding. Set `FRONTEND_ORIGINS` to exact browser origins. The Firebase Web API key is only required for the Worker registration and invitation routes and must be stored as a Worker secret, not committed.
