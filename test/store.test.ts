import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { newConversation } from "../src/conversations/defaults.ts";
import { assertLedgerIdle, beginGeneration, createConversationFile, mutateConversation } from "../src/conversations/store.ts";
import type { Vault } from "../src/storage/vault.ts";

test("a generation reads the ledger only after an edit that passed its idle check before the lock (T03 QA-1)", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "ss-store-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const vault: Vault = { dir, key: null };
  const conv = newConversation({ title: "before", systemPrompt: "Be brief." });
  await createConversationFile(vault, conv);

  // An edit whose idle check has passed (nothing is generating yet) and which is still writing.
  let checked!: () => void;
  let finish!: () => void;
  const passed = new Promise<void>((resolve) => (checked = resolve));
  const gate = new Promise<void>((resolve) => (finish = resolve));
  const edit = mutateConversation(vault, conv.id, async (c) => {
    assertLedgerIdle(vault, c.id);
    checked();
    await gate;
    c.title = "edited";
  });
  await passed;

  const gen = beginGeneration(vault, conv.id); // the lock is taken after the edit's check
  try {
    const later = mutateConversation(vault, conv.id, (c) => assertLedgerIdle(vault, c.id));
    let read = false;
    const loading = gen.load().then((c) => ((read = true), c));
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(read, false, "the generation's read waits for the edit in flight");

    finish();
    await edit;
    await assert.rejects(later, { code: "conflict" }, "an edit checked after the lock gets the 409");
    assert.equal((await loading).title, "edited", "and the generation answers the edited ledger, not the old one");
  } finally {
    gen.release();
  }
});
