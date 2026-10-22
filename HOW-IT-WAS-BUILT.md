# How this was built

I talked for about two hours. Claude worked for about twenty-four. This repo is what came out.

I'm sharing it to make one argument: engineering is moving away from writing the best code and toward designing the loop that writes it. A good loop may spend twice the agent-hours a person would need to reach the same place, and that doesn't matter. What matters is how few of *your* hours it takes.

## The numbers

| | |
|---|---|
| **My input** | 42 prompts, 19,118 words, all dictated (Wispr Flow). At a normal speaking pace of 150 words a minute, that's **about 2 hours 7 minutes of talking**. |
| **Claude's work** | **About 24 hours** of wall-clock time over 15 Claude Code sessions and 64 subagents. That's 27 agent-hours (the passes mostly ran one after another, not in parallel), about 20 of them spent generating. |
| **Model** | Claude Opus 5.5 for everything, in Claude Code 2.1. Claude Code's own small housekeeping calls went to Haiku, for 3 cents. |
| **Tokens** | 6.7 million output tokens and 1.9 billion input tokens, 98.7% of the input read from cache. |
| **Cost** | Everything ran on my personal Claude Max subscription ($200 a month). Claude Code's own `/cost` tally puts the same usage at **$633** at pay-as-you-go API prices. |
| **What came out** | 81 commits and 19 tickets. About 33,500 lines of code (11,500 for the server and CLI, 14,900 for the web app, 7,200 for tests), 238 tests and 52 pass reports. |

That works out to about 11 hours of Claude for each hour I spent talking. The work happened on six days out of nine calendar days.

## Day by day

| Day | Claude working | My words | Talking | Cost at API prices | What shipped |
|---|---:|---:|---:|---:|---|
| Tue, Oct 13 | 0.4 h | 7,593 | 51 min | $4 | The brief and the plan (T00) |
| Wed, Oct 14 | 15.8 h | 4,958 | 33 min | $416 | T01–T07 (the first run, below), then hidden notes, dice, presets, a curated model list and layout fixes (T08–T14) |
| Thu, Oct 15 | 4.9 h | 4,674 | 31 min | $131 | Fresh takes, brains that make brains, the Muse (T15–T17), dialogue colored by speaker, saner scrolling |
| Mon, Oct 19 | 0.4 h | 78 | 1 min | $7 | Two more models |
| Tue, Oct 20 | 0.9 h | 848 | 6 min | $18 | Failure diagnostics, "clone from here" |
| Wed, Oct 21 | 2.0 h | 967 | 6 min | $56 | A model per brain (T18), then prep for GitHub, the rename and the README (T19) |
| **Total** | **24.3 h** | **19,118** | **2 h 7 min** | **$633** | **81 commits** |

## The first run: from a plan to a playable game, unattended

I opened Claude Code in an empty folder and dictated a brief of 6,548 words, about 45 minutes of talking. It covered what the app should do, four checkpoints, the four-pass loop I wanted, and when to stop:

> This isn't done until you can play a really boring game of Dungeons and Dragons where you're in the tavern. You can walk up to the hooded figure, and you can regenerate what the AI said with a slight steer.

Claude turned the brief into a plan: [AGENTS.md](AGENTS.md) (the handbook every agent reads), [docs/design.md](docs/design.md) (data model and prompt rules), [TICKETS.md](TICKETS.md) (T01–T07) and four role skills, 619 lines in all. That's the first commit, `6fc9cc3`. There was no code yet. I read the plan, dictated about a thousand words of answers and corrections, approved the stack, and handed it over:

> Go ahead and run this. You are now promoted. You're CTO or whatever, and I don't want you to do any coding. I just want you to delegate and make sure that the delegations are working.

That approval is commit `b2f9e5d`. From there it ran overnight through T01 to T07, four passes per ticket: 28 Opus subagents in sequence, **about 10½ hours with Claude busy the whole time**. I sent one message during the run. It was 42 words, asking it to keep Venice's hidden system prompt out of every request. The plan already required that, and T01's QA pass had already found the one case where Venice slipped its prompt in anyway (an empty system message). The triage pass was fixing it when my message arrived.

At the end of T07 the brief was met. Accounts are created from the terminal and their data is encrypted on disk. Chat streams. You can regenerate a reply with a steer, and edit or delete any message. Several brains share one conversation, image brains paint the scene, and an agent played the tavern scene through both the CLI and Chrome. That first session (the brief, the plan and T01–T07) came to $287 at API prices.

### Run it yourself

```bash
git clone https://github.com/JasonHorsleyTech/simple-silver-tongue.git
cd simple-silver-tongue
git checkout b2f9e5d    # the approved plan: docs, tickets and skills, no code
cp .env.example .env    # add a Venice API key
claude                  # Opus; then tell it to go
```

Something like *"Read AGENTS.md. You're the orchestrator. Work TICKETS.md through T07 with the four-pass loop, every pass delegated to an Opus subagent, and don't stop until T07's acceptance bar is met."* will do. Two caveats. I ran it with permission prompts off (bypass mode) on my own machine: a loop that stops to ask permission isn't unattended. And you won't get my code back, because models don't repeat themselves and the tickets leave the method to the agents. What's fixed is the acceptance bar, so you should end up with the same app. I haven't re-run it myself, and I'd like to hear from anyone who does.

## After the first run

Everything after T07 came from playing the game and noticing what bugged me. The other 39 prompts are mostly a paragraph or two each: dice that really roll, a brain for every character I meet, a regenerate that never sees the reply I'm throwing away. The bigger ideas got a ticket and the full loop (T08–T10, T16–T18). For the small ones I told it the loop was overkill, and a single agent made the change.

## The loop

The README's [How it was built](README.md#how-it-was-built) has the details. In short:

- **A brief with an acceptance bar, not a spec.** I said what "done" looks like. The agent wrote the spec, the tickets and the skills, and I reviewed them once.
- **An orchestrator that writes no code.** The main session acts as CTO. It writes tickets, delegates, reads reports and tunes the skills.
- **Four passes per ticket, each one a fresh agent with its own job.** The engineer builds and proves the feature through the CLI. QA hunts for bugs and changes no code. Triage fixes, defers or dismisses each finding, with a reason. Frontend builds the UI and checks it in Chrome. Over 13 tickets, QA raised 82 findings: 73 fixed, 5 deferred, 4 dismissed.
- **Goals, not methods (Auftragstaktik).** Agents may swap a library or a design if they find a better one. If the design itself is wrong, they say so at the top of their report under **DESIGN CONCERN**, and that counts as a success.
- **Everything checkable by an agent.** The app is terminal-first: every button in the browser is a CLI command, so an agent can test any feature without a browser. A mock Venice server echoes what each brain saw, so routing tests cost nothing. A test checks that the request the app says it will send is exactly the one it sends.
- **A handbook that learns.** Each pass appends what it learned to [AGENTS.md](AGENTS.md#lessons-learned): traps, test tricks, anything that would have saved the next agent an hour. It has 82 entries now.
- **Guardrails written down.** The handbook lists hard requirements that override everything else, a budget for live API calls per pass, and a rule that agents never touch my own data.

## Where my two hours went

About 50 minutes went into the first night: the brief, then answers to the plan. The rest was reactions after playing it, a few minutes at a time.

These numbers leave things out. The logs can't see the time I spent reading Claude's replies and reports, reviewing the plan, or playing the game, and that time was real. Even so, my total is a handful of hours, against weeks for a person writing this by hand.

## The argument

**The loop spends agent-hours on purpose.** The passes run one after another, and each starts cold. QA re-checks everything the engineer claims, and triage re-reads all of it. A person wouldn't work that way, and it doesn't matter.

**What to optimize is human hours per working feature.** Agent-hours on a flat subscription cost almost nothing at the margin. At pay-as-you-go prices, this project came to about $26 per hour of Claude working. Metered access makes every agent-hour feel expensive, and that pushes people to sit and babysit a session, which is the opposite of what works.

**The engineering moves up a level.** The skill isn't typing the code. It's writing a brief with a clear acceptance bar, making the product checkable by an agent (terminal-first, a mock of every paid API, tests that pin the contract), writing down the guardrails, reading the reports, and tuning the loop when a pass goes wrong.

## How these numbers were measured

- **Source:** Claude Code's local session transcripts for this folder: 15 sessions and 64 subagent transcripts, not counting the session that wrote this page.
- **Tokens and cost:** the per-session tally Claude Code keeps (what `/cost` shows), summed over the sessions. Counting the transcripts directly gives the same output tokens within 1% and about 25% fewer cache reads, so I've used Claude Code's numbers.
- **Hours:** the union of activity across every transcript, counting any gap over 10 minutes as idle. A 5-minute cutoff gives 23.5 hours and a 15-minute cutoff 25.4. "Generating" is the model time Claude Code records for API calls.
- **Words:** only the prompts I wrote myself, not tool output or agent notifications. One pasted JSON error log is left out. I use 150 words a minute, a typical speaking pace.
- **Cost per day:** the first session ran past midnight, so its cost is split between the two days by token use.
