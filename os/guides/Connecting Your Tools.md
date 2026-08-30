Connecting Your Tools

Context without connections is just a journal. This guide is where your AI OS gets eyes and hands. You'll learn the right way to think about connections. API vs MCP, separate AI accounts with scoped permissions, and how to keep secrets out of your codebase.

We'll wire up Monday.com end-to-end as the first real connection. Then we'll cover Google Workspace CLI, which is one tool that unlocks Drive, Docs, Sheets, Gmail, Calendar, and Slides with over 100 built-in skills.

CLI vs API vs MCP — the order we connect in

A lot of AI models default to suggesting an MCP server when you want to connect a tool. MCP works, but here's the catch. It loads every single function the tool offers into your context, even ones you don't need. That eats tokens fast.

So we connect in a deliberate order, leanest first:

CLI first — if the tool ships a quality official one (like gh, the Stripe CLI, or the Google Workspace CLI covered below). It's token-light and zero-maintenance: the CLI handles auth, pagination, and retries, and the AI just runs a command and reads the output.

API second — when there's no good CLI. I tell Claude Code: "I want to use Monday.com's API because it's more token-efficient than an MCP server. Research the API docs, and create a markdown reference file with all the endpoints I might use." Now Claude Code has a local reference file to look up endpoints from. No web searches, no MCP bloat, just a clean markdown doc.

MCP last — and that's the rule. Reserve it for tools with no API or CLI, tools you use constantly, or an MCP that's already connected and convenient.

Better yet, don't do this by hand. Run /connect with a tool name or a docs link and it walks this exact order for you: researches the official docs, writes the reference file, registers the connection in connections.md, and drops the .env placeholder.

Create a dedicated AI account

Here's something most people skip. Don't give your AI OS your personal account credentials. Create a new account specifically for the AI. I called mine "Sturdy Ai" in Monday.com.

Why this matters:

You can scope permissions. Maybe the AI account only gets read access in QuickBooks, never write.

You can track usage. If the AI is making API calls or spending money on a platform, you see exactly which automation is doing what.

You contain blast radius. If something goes wrong, the damage is limited to what that scoped account can touch.

Use a .env file for secrets

When Claude Code asks for your API key, never paste it directly into the chat. Tell Claude Code: "Create a .env file with placeholders for the keys you need. I'll fill them in."

.env files are excluded from git pushes by default. Your secrets stay local. Claude Code reads them when it needs to make an API call.

For every new tool you connect, the flow is the same:

Create a dedicated account on the platform

Generate an API key with the right scope

Have Claude Code add a placeholder in .env

Paste your key in

Have Claude Code research the API and build a reference doc in references/

Wiring up Monday.com

Walking through it concretely:

In Monday.com, create (or invite) a dedicated user for AI access. Grab a personal API token from your avatar (bottom-left) > Developers > My Access Tokens.

Back in Claude Code, tell it to research the Monday.com GraphQL API and save a reference doc.

Add MONDAY_API_TOKEN and MONDAY_BOARD_ID to .env.

Test it. Ask: "Run a workload snapshot across all 17 team members."

If it fails, it'll learn from the failure. Tell it to update the reference doc so the same mistake never happens twice. Failures are a feature here, not a bug.

The /audit and /level-up skills

Once you have your first connection wired, run /audit. It scores your AI OS against the Four Cs and tells you the biggest gaps. You might score 16/25 on Connections because you've only wired one tool. That's normal on day one.

Then run /level-up. It asks you five questions about your week (what you did three or more times, what felt manual, what a smart intern could've handled, what would break if 500 new customers showed up, what would 10x your growth) and gives you the next thing to automate.

Together these two skills are your improvement loop. Audit shows the gaps. Level-up tells you which gap to fix next.

Google Workspace CLI

If you live in Google (Drive, Docs, Sheets, Gmail, Calendar, Slides), this one tool is a massive unlock. It's an open-source Google product, free, with over 100 built-in workflow skills.

Install steps:

Go to the GWS CLI GitHub repo (search "Google Workspace CLI" or grab the repo link from your Sturdy Ai kit)

Give Claude Code the repo link and say: "Help me install this CLI."

Claude Code reads the docs and walks you through the rest. You'll create a Google Cloud project, set up an OAuth client, and download credentials.

Authenticate with gws auth login. Done.

What you can do with it:

Search Drive: "Find my Google Doc from April 2025 about X."

Read emails: "Pull my unread emails from today, score them by priority based on what you know about my business, archive anything below a 5."

Build sheets: "Read this doc about our event and create me a tracker sheet with drop-downs and color coding."

Build slide decks: "Use my brand assets to create a 10-slide presentation on X."

The reason this is so powerful is that everything you create lives in your shared Drive, which means every other AI agent on your team can also reach it.

Key takeaways

Use APIs over MCPs when possible. Token-efficient and cleaner.

Create dedicated AI accounts with scoped permissions.

Never paste API keys into chat. Use .env.

Wire one tool at a time. Have Claude Code build a reference doc for each.

Run /audit and /level-up to find what to wire next.

GWS CLI is the single biggest unlock for anyone living in Google Workspace.
