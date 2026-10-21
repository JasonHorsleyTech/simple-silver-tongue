# T18 engineer: a model per brain

## What I built

A brain may now name its own text model (`Brain.textModel`), and an image brain its own image model too (`Brain.imageModel`). Absent means the conversation's, so changing the conversation's model moves every brain without one of its own. `null` puts a brain back on the conversation's. Old files load unchanged (no brain has its own, so every brain uses the conversation's model); no schema bump was needed.

- **One rule, one place each.** `textModelOf(conv, brain)` and `imageModelOf(conv, brain)` live in `types.ts`, which is dependency-free, so the browser imports the same rule (re-exported from `web/src/api/types.ts`). The text model is chosen in one place, `assembleRequest` (the body's `model`). The image model is chosen in one place, `painterFor`, which every painting path already went through: turn, regenerate, `image.retry`, an edited prompt, a prompt added by hand.
- **The order changed, as the ticket expected.** The generating commands used to look up the conversation's model before planning, so before anyone knew which brain answers. Now the planners get a **model book** (`ModelBook` in `prompt.ts`): a lookup by id (`textModels(venice)` in `turn.ts`, from the cached `/models` list), or one model's caps (tests). The plan finds the answering brain's model itself (`capsFor`) and returns the caps it used as `plan.model`. So turn, regenerate, steer, fresh take and their previews can't disagree about the model, the reasoning fields, `REASONING_NOTE` or the always-reasons note: the plan is the one place that knows the brain. `buildRequest` refuses caps whose `id` isn't the brain's model, so one model's caps can't shape another's request.
- **An unknown model** is refused at planning (400 `unknown_model`, nothing saved or sent). The message says whose model it is and which command fixes it (`brain.update --text-model`, or `conversation.update`).
- **Follows the brain's model:** the request's `model`, `reasoning_effort` / `disable_thinking`, the reasoning and always-reasons notes, the image brain's prompt (written by its text model), and the picture's size and price (its image model). Each version and image records its model (as before).
- **Commands.** `brain.add` / `brain.update --text-model <id|null>` and `--image-model <id|null>`. Both are checked against Venice's list when set, and any Venice id works. An image model on a text brain is a 400, like safe mode.
- **CLI.** `--flag null` is now null for any field that takes null. It used to send the word "null": `--settings.image.negative-prompt null` set a negative prompt of "null", and `--settings.max-tokens null` was a usage error.
- **Visible.**
  - `brain.list` gives every brain's model and whose it is: "model grok-4-7 (the conversation's)", "model z-ai-glm-5-3 (its own)".
  - `conversation.get` marks a brain's own model.
  - `prompt.preview` returns `models: {text, image?}`, each `{id, name?, own, conversation}`. Its text adds a line: "Text model: GLM 5.3 (z-ai-glm-5-3), the brain's own; the conversation's is grok-4-7."
  - The `start` event carries `model` and `ownModel`. The CLI header names a brain's own model: `[Co-GM · own model z-ai-glm-5-3]`.
  - `conversation.update` names the brains that keep their own model.
- **Carried through.**
  - Campaign files: brains take `textModel` / `imageModel`. They are checked against Venice's list like the settings (`brains.1.textModel: …`), and an image model on a text brain is refused. `conversation.get --json` → `conversation.import` round-trips them.
  - `brain.import`: the models are checked, and the notes say when a brain came with its own.
  - A maker's blueprint: `--makes.blueprint.text-model` / `.image-model`. Each made brain gets them as its own.
  - `presets.list` / `examples.list` list a brain's own models.
  - Clone: see below.
- **Resolution.** An image brain whose own model doesn't list the conversation's resolution keeps today's rule: the resolution is left out of that brain's request, with a note. `conversation.update --settings.image.resolution` is now accepted when the conversation's image model **or any image brain's own model** lists it. Before, a Krea painter in a Z-Image conversation could never get 2K.

## Calls I made

1. **Clone `--text-model` leaves a brain's own model alone.** It sets the copy's conversation model, exactly as `conversation.update` would. An explicit per-brain choice is part of the setup being cloned, and the copy behaves the same as "clone, then change the conversation's model". The answer names the brains that keep their own model and how to move one: `Co-GM, Scene Painter have models of their own and keep them; … brain.update --brain <name> --text-model null (or --image-model null) puts one on the conversation's.`
2. **The planners take a model book** instead of the caller choosing the model first. The other option was to resolve the brain in each command before planning. That would put the "who answers" logic in two places for regenerate (the message's author, after the last-message checks), which could drift.
3. **`brain.update`'s text doesn't warn when you put a brain with reasoning off on an always-reasoning model** (GLM 5.3). `format` sees only the brain, not the model's caps. The warning is in `prompt.preview`'s notes, as for a conversation on GLM, and the 400 says which switch to flip. The browser's brain card should show it (Frontend).

## Commands added or changed

- `brain.add` / `brain.update`: `--text-model <id|null>` and `--image-model <id|null>` (image brains), plus `--makes.blueprint.text-model` / `.image-model`.
- `brain.list` → adds `settings: {textModel, imageModel}` (the conversation's). Each brain's line names its model.
- `prompt.preview` → adds `models`, plus a text line per model.
- `turn` / `message.regenerate` `start` → adds `model` and `ownModel?`.
- `conversation.update`: its text names the brains on a model of their own. A resolution is accepted when any image model in use lists it.
- `conversation.clone --text-model`: a brain's own model is kept, and the answer says so.
- `conversation.import`: campaign brains take `textModel` / `imageModel`. `presets.list` / `examples.list` brains carry them when set.
- CLI: `--flag null` → null for nullable fields.
- `web/src/api/types.ts` (types only): `BrainFields.textModel/imageModel` (`string | null`), the same on `MakesUpdate.blueprint`, `Preview.models` / `ModelUse`, the `start` event's `model` / `ownModel`, `LibraryBrain.textModel/imageModel`, and `textModelOf` / `imageModelOf` re-exported.

## Transcript (trimmed)

Mock: a scratch server on :4857 and mock on :4858, with their own data/run dirs, user `dev-t18-mock`, the Tabletop RPG preset. The conversation is on `venice-uncensored-1-2`, standing in for Grok (the mock has no Grok).

```
$ ./sst brain.update --brain "Co-GM" --text-model z-ai-glm-5-3
Updated brain Co-GM (b_mgqd22yxf6) · text · model z-ai-glm-5-3 (its own) · reasoning off · …
$ ./sst brain.update --brain "Scene Painter" --image-model krea-2-turbo
Updated brain Scene Painter (b_sse2fs605t) · image · image model krea-2-turbo (its own) · …
$ ./sst brain.list | grep "^──"
── Game Master (b_…) · text · default · model venice-uncensored-1-2 (the conversation's) · …
── Co-GM (b_…) · text · model z-ai-glm-5-3 (its own) · …
── Scene Painter (b_…) · image · model venice-uncensored-1-2 (the conversation's) · image model krea-2-turbo (its own) · …
── Character Portraitist (b_…) · image · model venice-uncensored-1-2 (the conversation's) · image model z-image-turbo (the conversation's) · …
$ ./sst prompt.preview --brain "Co-GM" --content "How far is the drop?"
Exact request for brain "Co-GM" (b_mgqd22yxf6): POST /chat/completions
Text model: GLM 5.3 (z-ai-glm-5-3), the brain's own; the conversation's is venice-uncensored-1-2.
Note: GLM 5.3 always reasons: Venice refuses a request with reasoning off (a 400, "thinking-only"). Turn reasoning on for Co-GM.
{"model":"z-ai-glm-5-3", … "disable_thinking":true …}
$ ./sst turn --brain "Co-GM" --content "How far is the drop to the harbor?"
error: Venice 400 on /chat/completions: GLM-5.3 is a thinking-only model; … Turn reasoning on for Co-GM: … ./sst brain.update --brain "Co-GM" --reasoning.enabled.
$ ./sst brain.update --brain "Co-GM" --reasoning.enabled && ./sst turn --brain "Co-GM" --content "…"
[Co-GM · own model z-ai-glm-5-3 · in "Two models"]
[Co-GM · 984 in / 48 out · $0.002]
$ ./sst turn --brain "Scene Painter"
(making image img_vbvgbmrsz9 with krea-2-turbo... the conversation is free meanwhile)
[Scene Painter · 1076 in / 30 out · $0.00024 · image img_vbvgbmrsz9 done (krea-2-turbo, png, $0.04)]
mock /image/generate: {"model":"krea-2-turbo","safe_mode":true,"format":"webp","hide_watermark":true,"aspect_ratio":"3:2"}
$ ./sst conversation.update --settings.text-model deepseek-v4-1-flash
Updated c_4e1k8jgx1f "Two models" · deepseek-v4-1-flash · …
Brains on a model of their own, which they keep: Co-GM (z-ai-glm-5-3), Scene Painter (images: krea-2-turbo). The others use the conversation's.
$ ./sst conversation.clone --title "Under abliterated" --text-model abliteration-abliterated-model-large-v2
Cloned into c_1djeak8hhx "Under abliterated" · abliteration-abliterated-model-large-v2 · images z-image-turbo
Brains: Game Master (default), Co-GM (reasoning low) (its own model z-ai-glm-5-3), …, Scene Painter (image) (its own image model krea-2-turbo), …
Co-GM, Scene Painter have models of their own and keep them; the rest use the conversation's. …
$ ./sst conversation.get --json > export.json && ./sst conversation.import --campaign @export.json --json | jq '[.brains[]|{name,textModel,imageModel}]'
… {"name":"Co-GM","textModel":"z-ai-glm-5-3"} … {"name":"Scene Painter","imageModel":"krea-2-turbo"} …
$ ./sst brain.update --brain "Co-GM" --text-model null && ./sst prompt.preview --brain Co-GM --content x | sed -n 2p
Text model: DeepSeek V4.1 Flash (deepseek-v4-1-flash), the conversation's.
$ ./sst brain.update --brain "Co-GM" --text-model nope
error: --text-model: Venice has no text model "nope". ./sst models.list --type text lists the curated ones (--all: every one); any id Venice lists works.
```

Live: a scratch live server on :4867 (`SST_MODE=live`, `env -u VENICE_BASE_URL`, its own data/run dirs), user `dev-t18-live`, the Tabletop RPG preset, a three-line harbor World Bible and a GM opener. Jason's scenario: the conversation on Grok 4.7 (image model Krea 2 Turbo), the Co-GM on GLM 5.3 with reasoning low, and the Scene Painter on its own DeepSeek V4.1 Flash and Z-Image Turbo.

```
$ ./sst turn --content "I walk up to the hooded figure at the bar."
A gloved hand stays on the cup. Under the hood, a pale face, sharp and tired, looks you over once. …
[Game Master · 2406 in / 187 out · $0.0048]
$ ./sst turn --brain "Co-GM" --content "How far is the drop from the harbor wall?"
[Co-GM · own model z-ai-glm-5-3 · in "T18 live"]
From the top of Grey Wick's harbor wall it's about fifteen feet down to the water, more like twenty at low tide …
[Co-GM · 994 in / 340 out · $0.0036]
$ ./sst turn --brain "Scene Painter"
(making image img_dagoccegol with z-image-turbo... the conversation is free meanwhile)
[Scene Painter · 1417 in / 213 out · $0.00068 · image img_dagoccegol done (z-image-turbo, webp, $0.01)]
versions: GM model grok-4-7 (reasoning 92, cached 1152) · Co-GM z-ai-glm-5-3 (reasoning 278) · Painter deepseek-v4-1-flash, image z-image-turbo $0.01
```

## The Grok 4.7 probe (the ticket's question)

I sent the same bodies to both models with `stream: false`, using the key from `.env` (never printed). Each body carried the reasoning fields the app would send (DeepSeek `reasoning_effort: "none"`; Grok `disable_thinking: true`, since its effort levels have no `none`).

| Body | DeepSeek V4.1 Flash | Grok 4.7 |
|---|---|---|
| Two lines ("You answer in one word." / "What colour is the sky on a clear day?") | **21** prompt tokens | **1,261** (reasoning off), **1,261** (effort low); 1,152 cached each time |
| The preset GM's real body (5 messages, ~5,200 characters) | **1,185** | **2,406** (1,152 cached); 2,406 again through the app |

**Grok adds about 1,240 prompt tokens of its own to every request, whatever the body.** The difference is constant (1,240 and 1,221), not a ratio. And 1,152 tokens were cached on the very first call, so it is a fixed prefix shared across requests: a provider-side prompt (xAI's or Venice's), not a tokenizer that counts differently. We can't see or edit it, so a Grok brain's requests break hard rule 1, the way DeepSeek's ~25-token reasoning instruction does, only far larger and with reasoning off as well.

**Grok also reasons with reasoning off.** `disable_thinking: true` still gave 50, 221 and 92 reasoning tokens. They are billed, and none of the reasoning streamed as text the app could show.

Per the ticket, I didn't remove Grok, and I didn't change what the payload view says about it. The numbers are recorded in design.md ("Models") and in the `curated.ts` comment. **Recommendation:**
- A per-model payload note like `REASONING_NOTE`: "Grok 4.7 adds about 1,240 tokens of its own to every request, which we can't see or edit".
- Grok in `ALWAYS_REASONS` as `"ignored"`. Its note's last clause ("turning reasoning on only stops sending disable_thinking") would need rewording for a model with effort levels.

## Live spend

The balance went from **$5.63344213 to $5.6057186**: $0.0277 in all. That was 8 text calls (5 probe calls, $0.0087; 3 app turns, $0.0091) and 1 image ($0.01, Z-Image Turbo).

## Tests

- `test/brain-models.test.ts` (new, mock):
  - Preview == send (`deepEqual` with the mock's body) for a brain on its own text model, through turn, plain re-roll, steer and fresh take. Each version records the model.
  - The conversation's change moves only the brains without their own; `null` puts a brain back; an unknown model is refused and nothing changes.
  - GLM 5.3's note on a brain with reasoning off, while the conversation's model (Venice Uncensored, no reasoning) sends nothing about reasoning; the 400 hint; preview == send with reasoning on.
  - An image brain on its own image and text models: the chat body and the `/image/generate` body equal the preview's. Krea's $0.04, and the balance moved by what was recorded. 2K is accepted because only the painter's model lists it. Retry and an edited prompt paint on Krea; `null` is back to Z-Image's 1216×832.
  - A campaign round-trip; an unknown model and an image model on a text brain refused with a path; a clone under GLM keeping the Co-GM's own; a blueprint's model given to a made brain.
- `test/prompt.test.ts`: a builder unit test. A file with no brain models uses the conversation's for every brain. A model book is asked for each brain's own model, and the reasoning fields follow it. Caps for the wrong model throw. A plan carries its caps and the GLM note.
- `test/cli-args.test.ts`: `--note null` → null; `--username null` stays the word.
- Changed expectations in `chat`, `images` and `regenerate` tests: the preview's model line, the image-only error text, and `model` in `start`.
- Mutation check: putting `conv.settings.textModel` back in the builder fails all four new end-to-end tests. Putting the conversation's image model back in `painterFor` fails the image one.
- `npm run typecheck` passes. `npm test`: 230/230.

## Known gaps

- **Frontend's:** a model picker on each brain card ("Conversation default (<model>)" first, then the curated list; `textModel: null` clears), with the reasoning switch, effort levels, always-reasons note and image price following `textModelOf` / `imageModelOf`. The chat header, the clone menu and the Conversation tab should say when some brains have their own. The payload dialog has `preview.models`.
- `brain.update`'s CLI text doesn't warn about an always-reasoning model with reasoning off (call 3 above).
- **Pre-existing, not T18's:** an image brain switched back to text keeps its tool text and safe mode, unused. Its `conversation.get --json` then fails `conversation.import` ("safe mode, shape, tool text and an image model are for image brains"). It now names the image model too, but the refusal came from the leftover tool text before T18 as well. Worth a look in triage: drop the leftovers on import, or don't export them.
- An effort level the brain's model doesn't list is still sent as set (as before T18). A brain moved to another model keeps its effort, which that model may not offer. The browser's effort picker following the brain's model will make this visible.

## design.md changes

- The document's `Brain` and blueprint gain `textModel` / `imageModel`, and the settings comments say they are the defaults.
- "Prompt assembly" describes the model book and the brain's model in the body.
- "Image generation" says `painterFor` uses the brain's image model.
- "Models" has a new subsection, *A model per brain (T18)*, plus the Grok measurement.
- The command surface gains "Implemented in T18". The clone note, the `start` event shape and the preview shape are updated.
- README gets a "A model per brain" paragraph. AGENTS.md's model defaults, a command example and the CLI's `null` are updated.
