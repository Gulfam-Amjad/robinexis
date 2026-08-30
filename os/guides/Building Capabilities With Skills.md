Building Capabilities With Skills

Capabilities is where the AI OS goes from "smart database" to "actual employee." Skills are reusable recipes that turn any repeated workflow into a single command.

This guide covers everything you need to know about skills: what they are, how progressive context loading keeps them lightweight, the six-step framework for building one, and how to debug them when they don't work. We'll also do a live build using the /skill-builder skill, which interviews you instead of making you write a prompt blind.

What skills actually are

A skill is a folder that lives somewhere in your project (usually under .claude/skills/skill-name/). Inside that folder is a SKILL.md file. That file has YAML frontmatter at the top (name, description) and instructions in plain markdown below.

Think of a skill as a recipe. If you write a LinkedIn post the same way every time (research, generate a graphic, write the copy, review, post), you bundle those steps into a skill. Then you say "/linkedin-post" or "write me a LinkedIn post about X" and Claude Code reads the skill and runs the steps.

Skills aren't just text generators. They can run scripts, call APIs, use sub-agents, and trigger other skills. They're full automations.

Anatomy of a skill

Every SKILL.md has three layers:

Frontmatter (required). Name and description. Tells Claude Code what the skill does and when to trigger it.

Instructions. The step-by-step recipe. The actual SOP the AI follows.

Supporting files (optional). Reference docs, scripts, brand assets, anything the skill needs to do its job well.

Supporting files can live inside the skill folder or somewhere else in the project, as long as the SKILL.md points to the right path.

Progressive context loading

Skills stay lightweight because of progressive context loading. Three levels:

Claude Code reads only the frontmatter (name + description) when scanning for the right skill. Maybe 100 tokens per skill.

Once it picks the right skill, it reads the full SKILL.md. Maybe 1000 to 2000 tokens.

Supporting files only get loaded if the specific run actually needs them.

This is why you can have 30 skills in a project and not blow your token budget on every query.

The six-step skill-building framework

When you build a skill, walk through these in order:

Name and trigger. What's it called and what natural language fires it off.

Goal. In one sentence, what does this skill produce?

Step-by-step process. If you did this manually, exactly what would you do?

Reference files. What context, style guides, brand assets, or API docs does it need?

Rules. What could go wrong? Add guardrails for the failure modes.

Improvement loop. First runs are rough. Watch the skill work, give feedback, refine.

Live build using /skill-builder

You don't have to write a skill from scratch. Use the /skill-builder skill (included in your Sturdy Ai AIOS kit). It interviews you with questions like "what problem are you solving," "how should it be triggered," "walk me through the steps," and writes the skill file for you.

For example, you can build an infographic generator that uses Nano Banana for the image and overlays your brand logo. It takes about three rounds of feedback to dial in. First run is rough. Second run is usable. By the time you've run a skill 10 to 20 times, it's locked in.

When to build a skill

Easy heuristic: if you've done the same thing twice and you'll do it again, it's a skill candidate. If you find yourself repeating prompts ("don't use em dashes," "stay in my voice," "use this brand color"), that's another signal. Bundle those rules into a skill.

Debugging skills

If a skill misbehaves, here's the troubleshooting map:

Wrong steps or wrong order? Edit SKILL.md instructions.

Missing tone or style? Add a reference file.

Same mistake twice? Add an explicit rule.

Skill keeps searching for the same thing? Build a reference doc with that data hardcoded.

Works but could be better? Run it more. Each run you nitpick adds polish.

Skill not triggering? Check the YAML description. Make it more specific.

Skill triggering too often? Restrict to slash-command-only invocation.

Project-scoped vs global skills

Skills in .claude/skills/ only exist in that project. Skills in your home directory (~/.claude/skills/) are global. They work in any Claude Code session anywhere on your machine.

Use global for things that are universal: your tone of voice, your company brand assets, a front-end design skill you use everywhere. Use project-scoped for things specific to one workflow.

Key takeaways

Skills are markdown recipes the AI runs when triggered.

Progressive context loading keeps them token-efficient.

Use /skill-builder to build new ones instead of writing from scratch.

First runs are rough. Watch them, give feedback, iterate.

Project-scoped vs global depending on how universal the skill is.
