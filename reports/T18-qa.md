# T18 QA: A model per brain

**Verdict:** Acceptance passes, on the mock and live. 0 blockers, 1 major, 3 minors, 1 nit. No DESIGN CONCERN.

**The main claim holds.** I checked every request a brain causes. Each one goes out on that brain's model, with that model's reasoning fields, and preview equals send:
- `turn`, plain re-roll, steer, fresh take (with a Muse made on the way) and roll-and-send;
- a made brain, and an image brain's chat call and its `/image/generate` call;
- image retry, an edited prompt and an added prompt.

Changing the conversation's model moves only the brains without their own, and `null` puts a brain back. A model Venice stops listing stops only that brain, with an error that names the brain and the fix. The models survive a restart, a clone and a campaign round trip.

**The weak spot is the new resolution rule.** `conversation.update` now accepts a resolution when only a painter's own model lists it. The campaign import still checks the resolution against the conversation's image model alone, so Jason's own case won't import: a Krea painter at 2K in a Z-Image conversation (QA-1).

## How I ran it

- **Tests:** `npm test` passes 230/230 and `npm run typecheck` is clean, at fd36d8f. I changed no code.
- **Jason's server was left alone.** His live server on 4747 was never stopped, restarted or touched, and `web/dist` was not rebuilt.
- **Mock:** a scratch mock on 4878 and a server on 4877, started by hand. Data, run dir and web dist were all in my scratchpad. User `qa-t18-a` (plaintext). I restarted that server once mid-run to check persistence.
- **Live:** a scratch live server on 4887 (`SS_MODE=live`, `env -u VENICE_BASE_URL`), user `qa-t18-live`. Cheap models only, as Jason asked: no Grok, no GLM, Z-Image Turbo for the one image.
- **Preview against send:** a small script (`cmp.sh`). It saves `prompt.preview … --json`, runs the command, then `diff`s `jq -S .body` against the newest `/chat/completions` body in the mock's `/_mock/requests`.

The conversation for most of the run was the Tabletop RPG preset plus a one-line World Bible:
- conversation: `venice-uncensored-1-2` (no reasoning);
- Co-GM on its own `deepseek-v4-1-flash`, reasoning low;
- Show Me the Odds on its own `z-ai-glm-5-3`, then `abliteration-abliterated-model-large-v2`;
- Scene Painter on its own `deepseek-v4-1-flash` and `krea-2-turbo`, later `grok-imagine-image-2-0`;
- the Character Creator's blueprint on `deepseek-v4-1-flash`, and an image maker whose blueprint had both models of its own.

## Acceptance checklist

| Bullet | Result | Evidence |
|---|---|---|
| Brain on B in a conversation on A: its preview and its send both name B; every other brain names A | **pass** | `cmp.sh`: EQUAL for the Co-GM's turn, re-roll, steer, `--thought --wrap` fresh take (it added the Muse) and `--roll`. The GM and Show Me the Odds sent `venice-uncensored-1-2` with no reasoning fields; the Co-GM sent `deepseek-v4-1-flash` with `reasoning_effort: "low"`. Each version records its model (`conversation.get --json`). |
| Changing the conversation's model moves only the brains without their own; clearing puts a brain back | **pass** | `conversation.update --settings.text-model deepseek-v4-1-flash --settings.image-model hunyuan-image-v3`. In `prompt.preview` the GM, Portraitist and Muse moved; the Co-GM, Odds (GLM), Scene Painter (Krea) and Character 1 stayed. The answer names the brains that kept their own. `--text-model null` gave `own: false` and the conversation's model in preview and send. |
| An image brain with its own image model paints with it, at that model's price | **pass** | Scene Painter: the chat body and the `/image/generate` params equalled the preview's. Prices: `krea-2-turbo` at $0.04, then $0.06 at 2K on a steered re-roll, while the Portraitist stayed on the conversation's model. After a switch to `grok-imagine-image-2-0`, a `message.edit` of the prompt painted on Grok Imagine ($0.10), and `message.add --as "Scene Painter"` on Krea. |
| An always-reasoning brain with reasoning off gets that model's note, while the conversation's model doesn't reason | **pass** | Odds on GLM 5.3, reasoning off: the preview carries the GLM note and `disable_thinking: true`; `turn` gives the 400 plus "Turn reasoning on for Show Me the Odds". On Abliterated: the "reasons anyway" note, and preview == send. The conversation's Venice Uncensored sends nothing about reasoning. |
| Old files load unchanged; a campaign round-trips a brain's model | **pass, with QA-1** | A preset import (no models in the file) puts every brain on the conversation's model. `conversation.get --json` → `conversation.import` kept `textModel` / `imageModel`, the blueprint's `textModel` and the made brain's own model. The import fails, though, when the resolution is one only a painter's own model lists (QA-1); I cleared it in the file to finish the check. |
| Live: a brain on another curated model answers; the Grok probe is recorded | **pass** | Conversation on DeepSeek V4.1 Flash, image model Krea. GM turn: 34 in / 24 out, $0.000039, DeepSeek's price. Co-GM on its own Gemma 4 31B: $0.0000167 for 103 in / 12 out, which is Gemma's $0.12/$0.36 per million, not DeepSeek's. Its steered re-roll was on Gemma too. A painter on its own Z-Image Turbo painted for $0.01 while the conversation's image model was Krea. The engineer recorded the Grok probe in design.md, and I didn't re-measure it, as asked. |
| Every word sent stays visible and editable; tests and typecheck pass | **pass** | The preview's new lines name the model and whose it is. No new text reaches a model. 230/230, typecheck clean. |

**The engineer's hunting list:**
- **A model Venice stops listing** (I wrote `gone-text-1` / `gone-image-1` into a cloned file by hand):
  - That brain's `prompt.preview` and `turn` are a 400. It names the brain, its own model and `brain.update --text-model <id>` / `null`.
  - `image.retry` and `message.edit` of its prompt are refused, with nothing changed.
  - The GM carried on. Renaming the broken brain still worked.
  - The export's import is refused, naming `brains.1.textModel`.
  - Pass.
- **An effort level the model doesn't offer:** sent as set, with no note (QA-3).
- **Resolution with several painters on different models:** sending is right. Krea gets `resolution: "2K"`; the Z-Image Portraitist leaves it out, with its note. Import isn't (QA-1).
- **A blueprint's model through clone and import:** it round-trips, and a made brain keeps its own model. An image blueprint with both models made `Pic 1` on them (preview: `own: true` for both). Pass.
- **An image brain switched back to text:** still refused on import. I confirmed it pre-exists, and it now covers blueprints too (QA-4).

## Findings

### QA-1 · major · `conversation.update` accepts a resolution for a painter's own model, but importing that conversation refuses it

T18 lets `--settings.image.resolution` through when the conversation's image model **or any image brain's own** lists it. That is exactly Jason's case: the conversation on Z-Image, the Scene Painter on Krea, 2K. The campaign import still checks the resolution against the conversation's image model only. So the round trip that `conversation.get --json` promises fails for a state the app itself accepted.

```
./ss conversation.update --settings.image-model z-image-turbo            # (the default)
./ss brain.update --brain "Scene Painter" --image-model krea-2-turbo
./ss conversation.update --settings.image.resolution 2K                   # accepted: Krea lists 2K
./ss prompt.preview --brain "Scene Painter" --json | jq .image.params     # resolution "2K" sent to Krea, correct
./ss conversation.get --json > export.json
./ss conversation.import --campaign @export.json
error: The campaign: settings.image: z-image-turbo has no resolution setting: its size is the brain's shape alone.
```

- **Expected:** the import accepts what `conversation.update` accepted. The import resolves brains' own models anyway, since `checkBrainModels` runs right before.
- **Actual:** refused. Only removing `resolution` from the file gets it in. `conversation.clone` is fine, because it doesn't check settings.
- **Cause:** `checkSettings` in `src/commands/campaigns.ts` (lines ~431-436) calls `imageSettingsProblem(conv.settings.image, model, set)` with the conversation's image model alone. `conversation.update` (`src/commands/conversations.ts` ~164-195) uses the "any image model in use" rule.
- **A sibling that predates T18:** a resolution left behind by a model switch fails the same way.

  ```
  conversation.update --settings.image-model krea-2-turbo --settings.image.resolution 2K
  conversation.update --settings.image-model z-image-turbo     # not re-checked
  conversation.get --json → import                             # refused
  ```

  At send time the app already treats an unlisted resolution as "left out, with a note". The import could do the same, or at least apply the same rule as `conversation.update`. One fix would cover both.

### QA-2 · minor · Mistral Small 3.2 as a painter's own text model writes text before its forced tool call, and once ran away for over two minutes

Live, user `qa-t18-live`. The Painter had its own text model `mistral-small-3-2-24b-instruct` (curated; Venice says `supportsFunctionCalling: true`) and its own image model `z-image-turbo`. The request was right: Mistral, `tool_choice` forced to `generate_image`, no stop sequences (image brains have none), no `max_tokens`. But `turn --brain Painter` streamed plain text instead:
- first `<!-- from: Assistant -->`, a framing line in the GM's name;
- then narration that turned into a repeating loop: about 28 KB in two minutes, with no tool call in sight.

It held the conversation's lock the whole time, and `generation.stop` ended it ("Stopped before any of the prompt arrived. No reply was saved."). I then sent the same body once with `stream: false` and `max_tokens: 120`. Again the GM's framing line and a sentence of narration came first, then a proper `generate_image` call (`finish_reason: "tool_calls"`).

So with Mistral, an image brain gets text first and the call second. The app already handles that: the text is noted ("it also wrote N characters of text beside the call, not kept") and not saved. What it doesn't bound is a model that loops in that text. That runs to the model's 16k-token maximum, with the conversation locked. Venice hadn't billed the stopped reply when I finished (the balance moved by exactly the recorded costs plus my probe).

This was reachable before T18 by putting the whole conversation on Mistral. But a painter on its own cheap model is now the feature's point, and the browser picker will offer Mistral for it.
- **Expected:** a curated text model an image brain can be given makes the forced call, or the app ends the request when the call doesn't come.
- **Actual:** an unbounded text stream from an image brain.
- **Suggestions, for triage to choose from:**
  - Measure which curated text models write text before a forced call, and say so (a curated comment, a payload-view note for an image brain on one).
  - Have an image brain's request give up once a few hundred characters of text arrive with no tool call.

  Whether image brains should also stop at `<!-- from:` is a design call. It would end such a reply quickly, but with no call.

### QA-3 · minor · an effort level the brain's model doesn't offer is sent as set, with no note

The ticket says the effort options follow the brain's model. The body takes the brain's effort as stored, and nothing says when that model doesn't list it.

The curated pair that per-brain models make likely shows the gap:
- Gemma 4 31B offers none/low/medium/high.
- DeepSeek V4.1 Flash offers none/low/high/max.

A Co-GM at "medium" on Gemma, put back on a DeepSeek conversation with `--text-model null`, sends `reasoning_effort: "medium"` to DeepSeek.

```
./ss brain.update --brain Co-GM --reasoning.effort medium     # Co-GM on its own deepseek-v4-1-flash
./ss prompt.preview --brain Co-GM --content x --json | jq '{e: .body.reasoning_effort, notes}'
{"e":"medium", "notes":[reasoning on, stop sequences, stop+reasoning]}   # no word about medium
```

- **Expected:** at least a payload-view note ("DeepSeek V4.1 Flash has no 'medium' effort; Venice may refuse it or pick its own"), or the nearest level the model offers.
- **Actual:** silent.
- **Pre-existing for the conversation's model.** The engineer listed it, and the browser's effort picker following the brain's model (Frontend) will cover new choices, but not a brain moved by `--text-model null` or a conversation change.
- **Not checked live:** I kept within the call budget, so I don't know whether Venice refuses `medium` on DeepSeek or ignores it.

### QA-4 · minor (predates T18, now wider) · image fields left on a brain or blueprint switched to text make the export unimportable

`brain.update --kind text` keeps an image brain's tool text, safe mode and (now) its image model, unused. `conversation.get --json` exports them, and the import refuses the file:

```
./ss conversation.create --title "Kind switch" --system-prompt "Narrate."
./ss brain.add --name P --kind image --system-prompt paint
./ss brain.update --brain P --kind text
./ss conversation.get --json > ks.json && ./ss conversation.import --campaign @ks.json
error: The campaign: brains.1: safe mode, shape, tool text and an image model are for image brains, and P is a text brain.
```

No image model is needed: the leftover tool text alone does it, so this predates T18. T18 adds the same for blueprints. `brain.update --makes.blueprint.kind text` on an image maker keeps `blueprint.imageModel` (and `tool`), which `applyMakes` refuses on import in the same way.
- **Expected:** a conversation the app made imports.
- **Suggestion:** the import drops the leftovers on a text brain or blueprint (with a note), rather than refusing; or the export leaves them out.

### QA-5 · nit · wording

- `conversation.update` names a brain twice when it has both models of its own: "Scene Painter (deepseek-v4-1-flash), Scene Painter (images: krea-2-turbo)" (`src/commands/conversations.ts` ~207). One entry per brain would read better: "Scene Painter (deepseek-v4-1-flash; images: krea-2-turbo)".
- `brain.import`'s note (`campaigns.ts` ~546) and the clone answer (`campaigns.ts` ~647) say `--text-model null (or --image-model null)` even for a brain whose only own model is its image model.
- `presets.list` / `examples.list` text output doesn't show a brain's own models (only `--json` does), though design.md says they list them.
- `brain.add`'s help still says an image brain is "painted with the conversation's image model" before the T18 sentence below it.
- `brain.update --text-model z-ai-glm-5-3` on a brain with reasoning off says nothing (engineer's call 3). `prompt.preview` and the 400 do, but Jason's own example scenario (Co-GM on GLM) meets the 400 first. `checkBrainModels` already holds the model's caps, so a one-line warning in the answer would be cheap.

## Not a finding, worth knowing

- Clone `--text-model` leaves a brain's own model alone, and the answer says so. If Jason gave the GM a model of its own, "Clone from here … under GLM" doesn't move the GM. That is the engineer's documented call, and the browser's clone menu should say it (Frontend).
- A brain whose own model equals the conversation's is reported as "its own" (it won't follow a change of the conversation's model). True, and intended.
- README already describes the payload view naming the model. The browser side is Frontend's.

## Spending

- **Balance:** $5.6057186 before, $5.59538192 after: **$0.0103**.
- **Text calls: 6.**
  - DeepSeek GM turn;
  - Gemma Co-GM turn and steered re-roll;
  - the Mistral painter turn (stopped, apparently unbilled);
  - one Mistral `stream: false` probe;
  - one DeepSeek painter turn.
- **Images: 1** (Z-Image Turbo, $0.01).

## Cleanup

- I killed my scratch mock (4878) and servers (4877, 4887), and removed my `qa-t18-*` users from the scratch data dirs.
- The scratch mock data dir also holds a `dev-t18-mock` user from the engineer's pass. I left it alone.
- Jason's server on 4747 was never touched.
