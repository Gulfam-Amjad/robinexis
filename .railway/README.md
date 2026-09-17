# Railway Infrastructure as Code

Railway no longer applies `railway.toml` / `railway.json` to **new** services. This folder is the replacement.

```bash
npm install
npx @railway/cli login
npx @railway/cli link
npx @railway/cli config plan
npx @railway/cli config apply
```

Do not put secrets in `railway.ts`. Paste `.railway-vars/api.env` and
`.railway-vars/worker.env` into the matching services before applying. On the
free two-resource Railway plan, the worker service supervises both the normal
background worker and the optional LiveKit voice runtime. Keep
`VOICE_RUNTIME_ENABLED=false` until dark-room tests pass. The generated
`.railway-vars/voice-runtime.env` is only for a future dedicated service after
the Railway resource limit is upgraded.

The dashboard frontend stays on Vercel — there is no web service here.
