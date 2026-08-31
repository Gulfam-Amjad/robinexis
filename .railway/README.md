# Railway Infrastructure as Code

Railway no longer applies `railway.toml` / `railway.json` to **new** services. This folder is the replacement.

```bash
npm install
npx @railway/cli login
npx @railway/cli link
npx @railway/cli config plan
npx @railway/cli config apply
```

Do not put secrets in `railway.ts`. Paste `.railway-vars/api.env` (and gateway/worker) into each service's Raw Editor, then apply this file so build/start commands and `RAILWAY_BUILD_TARGET` are set.

The dashboard frontend stays on Vercel — there is no web service here.
