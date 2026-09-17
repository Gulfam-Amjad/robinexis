Routines, Schedules & Loops

This is the last C, and it's the one that makes your AI OS feel like it has a heartbeat. Cadence is everything that runs while you sleep. Scheduled tasks, web-triggered automations, daily loops, and reminders.

This guide covers the difference between local scheduled tasks and cloud routines, how to set both up, and the new /loop feature for short-burst recurring tasks. By the end you'll know when to use each one.

Push your AI OS to GitHub

Step one: get your AI OS into a private GitHub repo. Two reasons:

Sync across machines. Your AI OS lives locally on whatever laptop you set it up on. Push it to GitHub and you can clone it onto a second laptop. Now your AI OS is portable.

Cloud routines need it. Cloud routines (running on Anthropic's infrastructure with your laptop closed) work off a cloned GitHub repo. No repo, no cloud routines.

Keep the repo private. Make sure .env is in your .gitignore. Your secrets stay local.

Local scheduled tasks

Inside the Claude desktop app under co-work, you can create scheduled tasks. These run on your machine while the desktop app is open. They can run as often as every minute. They can call any skill you've built.

Local scheduled tasks are good for things you want firing constantly while you're working but that don't need to run if your laptop is closed.

Cloud routines

Cloud routines run on Anthropic's infrastructure. Laptop closed, machine off, doesn't matter. They fire on schedule (minimum once per hour), via API call, or on a GitHub event.

Setup gotchas to know up front:

.env doesn't transfer. Your local .env isn't in the GitHub repo, so the cloud environment can't see it. You set environment variables inside the routine's cloud environment settings.

Network access modes. Default is "trusted" which only allows Anthropic-verified domains. If your routine needs to hit a tool that isn't on that list, switch to "full" access. Read the security docs first.

Resource limits. Cloud routines get 4 vCPUs, 16GB RAM, 30GB disk per run. If your repo is massive, that's wasteful. Consider a separate repo per routine.

Daily run limits. Pro plan gets 5 routine runs per day, Max gets 15, Team/Enterprise gets 25.

Once it's set up, a routine is basically you typing a prompt into Claude Code at a scheduled time. Whatever the AI would do with that prompt, the routine does.

Writing good routine prompts

A routine has to be one-shot. You're not around to redirect it. So the prompt has to be specific enough to succeed without follow-up.

Instead of: "Pull my YouTube comments and let me know what I should focus on." That's too vague for an unsupervised run.

Try: "Run the /comment-analysis skill. Pull the 50 most recent comments. Output a bullet rundown of themes, sentiment, and top three priorities. Post the result to my YouTube Ops board on Monday.com."

That's a routine that can run on its own.

The /loop feature

This is newer and different from scheduled tasks. Loops are for short-burst recurring tasks inside a single session.

Two flavors:

Recurring intervals. "Every 10 minutes, check my Monday.com for new updates." Runs for up to 3 days, then auto-cleans.

One-time reminders. "At 3pm, remind me to take out the garbage." Fires once and deletes itself.

Loops live inside the session you start them in. Close the tab, the loop dies. They're great for active work where you want a heartbeat going while you focus on something else. Bad for anything you need running long-term.

When to use what

Loop = short bursts of recurring tasks during active work. Days, not weeks.

Local scheduled task = recurring task that needs your machine on but runs frequently.

Cloud routine = recurring task that needs to run with your laptop closed.

Practical patterns

A few real automations I run:

Every morning at 6am, a cloud routine pulls my calendar, Monday.com priorities, and yesterday's progress and sends me a morning brief.

Every weekday at 10am, a routine analyzes new community platform wins and shoots engagement responses to anyone who hit a milestone.

During active work, I'll often set a loop: "Every 15 minutes, check if PR #43 has new comments and let me know."

Key takeaways

Push your AI OS to a private GitHub repo. It enables sync and cloud routines.

Local scheduled tasks need your machine on. Cloud routines don't.

Cloud routines need explicit env vars and the right network access mode.

Loops are for active sessions (max 3 days). Routines are for long-term cadence.

Routine prompts have to be specific. Treat them like one-shot prompts.
