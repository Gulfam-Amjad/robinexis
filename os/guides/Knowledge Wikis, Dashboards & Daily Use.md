Knowledge Wikis, Dashboards & Daily Use

You've got Context, Connections, Capabilities, and Cadence. This final guide is about making your AI OS feel like a real second brain and using it every day.

We cover Karpathy's LLM Wiki pattern for turning raw documents into a self-organizing knowledge graph. Claude Co-work Artifacts for fast dashboard proof-of-concepts. The daily and weekly loops that turn this from a build into a habit. And the three success criteria that tell you it's actually working.

Karpathy's LLM Wiki pattern

Andrej Karpathy posted recently about a knowledge base pattern that's gotten a lot of traction. The idea is simple. Instead of a fancy vector database with embeddings and a rag pipeline, you give the AI a folder of markdown files and let it organize them itself.

The structure looks like this:

raw/ is where you dump source documents (articles, transcripts, PDFs, meeting notes)

wiki/ is where the AI writes organized pages with cross-links

index.md and log.md track what's in the wiki and what's been ingested

When you drop a new article into raw/, you tell Claude Code "ingest this." It reads the article, breaks it into 10 to 25 wiki pages, creates [[backlinks]] between related concepts, and updates the index.

Cost is basically zero. Maintenance is a periodic "lint" where you ask Claude Code to find inconsistencies, fill gaps with web search, and prune duplicates.

Works great up to a few thousand documents. Past that you probably want a real rag pipeline.

Setting up Obsidian as the front-end

Obsidian is free. Download it, create a new vault pointing at your wiki folder, and you get a visual graph view of every concept and its connections. Backlinks become clickable. Hubs become visible.

Useful for:

Browsing your knowledge visually

Spotting orphan pages that need more linking

Seeing which concepts are dense and which are thin

You don't need Obsidian for the wiki to work. The AI doesn't care about the UI. But it's nice to see what's going on.

Dashboards with Claude Artifacts

Inside Claude desktop, under co-work, there's a "live artifacts" feature. You can build a dashboard in five minutes that pulls real data from any connection you've set up.

Examples I run:

QuickBooks dashboard: revenue, expenses, runway, AI-generated financial analysis

Monday.com weekly commitments dashboard: tasks, completion %, at-risk items

Fireflies dashboard: meeting summaries and action items

These are proof-of-concept dashboards. They're not custom-built, so they're a little rough. But the value is speed. You spin up a dashboard in 5 minutes, see if you actually check it, and only invest in a custom build if you do.

This is the POC mindset. Build something cheap and fast to prove the concept. If the concept proves out, invest more. If it doesn't, you wasted nothing.

The daily and weekly loops

Daily, in the morning: "Help me plan my day." If the response is good, great. If it's missing context, note what was missing and patch that gap.

At the end of the day: which skills did I use? What did I have to correct? What did I copy-paste manually that should've been automated?

Weekly, on Friday: run /audit. Look at how many skills got used, which got used daily. If a skill runs daily, is it worth turning into a scheduled routine? Could it run while you sleep instead of you triggering it?

Workflows beat agents most of the time

Reminder from the field. Most business processes don't need a fully autonomous AI agent. They need a deterministic workflow with maybe one AI step inside it. We barely used AI on most automations we built for clients in my last business. We mostly just used workflows.

When in doubt, build the simplest thing that works. A Python script. A scheduled routine. A skill that calls one API. Save the agentic stuff for the parts that actually need judgment.

Three success criteria

How do you know your AI OS is working? Three signals:

Your team starts asking your AI OS instead of you. When someone has a business question, it's faster to paste it into your AI OS than to ask you. Your AI OS has the same data, better memory, and never sleeps.

You stop opening new tabs. Most of your work happens inside Claude Code. You're not bouncing between 15 browser tabs and 8 desktop apps.

Knowledge leaves your head. You stop trying to remember everything. You stop having a stack of sticky notes. The system holds it for you and reminds you when something matters.

If two of three are true within your first month, your AI OS took. You're on the curve.

Personal before team

The whole point of this guide was your personal productivity first. You can't scale a system you haven't lived in. You can't help your team connect to data sources you haven't connected yourself.

Once your personal AI OS works, the company can build around it. A team where every operator runs a personal AI OS is a team that's actually AI-ready. The data is structured for AI. The workflows are documented as skills. The connections are mapped.

That's the long game. Start with you.

Key takeaways

Karpathy's LLM Wiki turns markdown folders into a self-organizing knowledge graph.

Obsidian is a nice optional front-end for browsing the wiki.

Use Claude Artifacts for fast dashboard proofs-of-concept before building custom.

Daily and weekly loops are how this becomes a habit, not just a build.

Workflows beat agents most of the time. Default to the simplest thing.

Three success criteria: team asks the AI OS, you stop opening tabs, knowledge leaves your head.

Build personal first. Team scales from there.
