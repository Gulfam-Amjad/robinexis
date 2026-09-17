Onboarding

This is where you stop thinking and start building. You'll install VS Code, install the Claude Code extension, clone the AI OS template repo, and walk through the actual folder structure that runs the whole system.

Then you'll run the /onboard skill. It's a seven-question interview that scaffolds your day-one file set. By the end, your AI OS has the foundational context it needs to start being useful.

A quick note before we start

The rest of this guide walks through Claude Code specifically because that's what I use. But you could follow along in Codex, Hermes agent, Anti-Gravity, or any other coding agent and end up in the same place. The folder structure, the CLAUDE.md file, the skills, all of it ports over. If you're using a different tool, the install steps below change but everything from "folder walkthrough" onward is the same. Pick the harness you like, get it open in VS Code (or its native UI), and keep going.

Step 1: Install VS Code

I use Claude Code inside VS Code. You can also use the desktop app, but VS Code is what I record everything in and what I recommend. Search "VS Code," download it, install it. It's free.

Step 2: Install the Claude Code extension

Open VS Code. On the left, click the extensions icon. Search "Claude Code." Install the extension. When prompted, log in with your paid Claude subscription. You need at least the $17 to $20/month plan to use Claude Code.

Once logged in, click the Anthropic logo in the top right. That opens the Claude Code agent panel. Now you have a chat interface inside your editor.

Step 3: Create your AI OS folder and clone the repo

Open your file explorer. Make a new folder anywhere you want. Call it "AI OS" or whatever. In VS Code, go to File > Open Folder and open that folder. You'll see "you have not yet opened a folder" until you do this.

Now go grab the repo link from your Sturdy Ai kit and paste it into Claude Code with something like "clone this repo into the current project." Hit allow when it asks. You'll see a bunch of folders and files populate on the left.

Step 4: Folder walkthrough

Here's what you're looking at:

.claude/ is the project's brain. Inside it lives a skills/ folder. Skills are reusable recipes the AI can run. We'll dig into skills properly in the skills guide.

archives/ is where old or deprecated files get moved. Don't delete things, archive them.

context/ is where context about you and your business lives. About me, about the business, current priorities. The onboarding skill writes the first versions of these.

decisions/ holds a log of meaningful decisions you and the AI have made together.

references/ holds longer reference material. API endpoint reference docs, frameworks, anything that's lookup-heavy.

CLAUDE.md is the master prompt. This file gets loaded into every session. It tells Claude Code who you are, what tools you have, what skills are available, and where things live.

As you add new folders, you update CLAUDE.md so Claude Code knows where things live. My own CLAUDE.md gets updated multiple times a day. It's a living document.

Step 5: Run the onboarding skill

In the chat, type something like: "I just cloned this repo. I want to set up my AI operating system. My name is Joe Sturdy. Can you help me get onboarded?"

Claude Code will pick up that this matches the onboard skill and start running it. It's a seven-question interview that asks:

Who you are and what you sell

Samples of your writing so it can pick up your voice

Your top two to three priorities for the next 90 days

(And four more)

Answer each one in real detail. The more context here, the better. If you have a voice-to-text tool like Glyph or Whisper Flow, use it. It's faster to dictate two paragraphs than to type one.

What just happened

The onboarding skill wrote three files into context/:

about-business.md

about-me.md

priorities.md

Now if you start a fresh session and ask "what should I focus on this week?" Claude Code reads those files and gives you a real answer instead of a generic one. That's the Context pillar wired in.

Key takeaways

VS Code + Claude Code extension is the setup. Free + paid Claude subscription.

Clone the AI OS template repo from your Sturdy Ai kit.

Every folder has a purpose. CLAUDE.md is the master prompt.

Run /onboard and answer the seven questions in depth. Voice dictation helps. Use this tool.
