# Railway Infrastructure as Code

Railway no longer applies `railway.toml` / `railway.json` to **new** services. This folder is the replacement.

```bash
npm install
npx railway login
npx railway link
npx railway config plan
npx railway config apply
```

Do not put secrets in `railway.ts`. Paste `.railway-vars/api.env` (and gateway/worker) into each service's Raw Editor, then apply this file so build/start commands and `RAILWAY_BUILD_TARGET` are set.

The dashboard frontend stays on Vercel — there is no web service here.
