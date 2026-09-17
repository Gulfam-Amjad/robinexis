# The Sturdy Ai GitHub App — your auto-update channel

Your AIOS and brains are **living software**. Sturdy Ai keeps improving the skills, references and routines that make them work. The **Sturdy Ai GitHub App** is how those improvements reach you — automatically, with your laptop closed, no manual pull.

Install link: **https://github.com/apps/sturdy-ai**

## What it is

A GitHub App (not a person, not an API key) that Sturdy Ai owns. You install it on **your own** GitHub account and grant it access to **your** AIOS + brain repos. Once installed, whenever Sturdy Ai ships an improvement to the upstream template, the App pushes the new logic into your repos for you.

It only ever touches **logic** — skills (`.claude/skills/`), `references/`, `ROUTINES.md`, `EXPANSIONS.md`. It **never** reads, writes, or deletes your knowledge: your brains' wiki pages, your `context/`, your `connections.md`, your `.env`, your decisions log. Your data is yours and stays untouched.

## How it works (the short version)

1. Sturdy Ai improves a skill or reference in the upstream template and pushes it.
2. A workflow on the template mints a **short-lived (1-hour) install token** scoped to each installed repo.
3. It **overlays** the updated logic onto your repo and commits as `sturdy-ai[bot]` — adding/updating logic files, never removing your own.
4. Next time you `git pull`, you have the latest version. That's it.

Because the token is minted per-push and expires in an hour, there's no standing credential sitting in any repo. Nothing to leak, nothing to rotate.

## Installing it (Day 2 of onboarding)

Because it lives on **your** GitHub account, only you can authorise it — exactly like connecting a tool or generating an API key on your own machine.

1. Open **https://github.com/apps/sturdy-ai/installations/new**
2. Choose the account that owns your AIOS + brain repos.
3. Select your AIOS repo and each brain repo — or **"All repositories"** if you'd rather not pick.
4. Authorise. Done. Improvements now land automatically.

Then tell Sturdy Ai your repo names so they're added to the update roster. Until **both** are done (App installed **and** your repos on the roster), you won't receive updates.

## You're always in control

This is a transparent, revocable arrangement — you can see and undo everything:

- **See what it did:** every update is a normal git commit authored by `sturdy-ai[bot]`. Read them in your repo history like any other change.
- **Pause updates for one repo:** GitHub → **Settings → Applications → Installed GitHub Apps → Sturdy Ai → Configure** → deselect that repo. Updates stop for it immediately; nothing already delivered is removed.
- **Revoke entirely:** the same screen → **Uninstall**. The App loses all access in seconds. Your repos, history and data remain exactly as they are — you simply stop receiving new improvements.

If you ever want to force a manual sync without waiting for the next push, run `/update` from your AIOS — it pulls the latest template logic on demand.

## One App, by design

There is a single general-purpose Sturdy Ai App for the whole fleet. It's extended over time — never replaced by a second app. If the install link above works, you're looking at the right one.
