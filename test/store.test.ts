import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { newConversation } from "../src/conversations/defaults.ts";
import { assertBrainIdle, assertLedgerIdle, beginGeneration, createConversationFile, mutateConversation } from "../src/conversations/store.ts";
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

test("a brain is busy while it writes; before the generation has named its brain, every brain is (T04)", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "ss-store-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const vault: Vault = { dir, key: null };
  const gm = { id: "b_gm", name: "Game Master" };
  const dice = { id: "b_dice", name: "Dice Master" };
  assertBrainIdle(vault, "c_test", dice, "delete"); // nothing running

  const gen = beginGeneration(vault, "c_test");
  try {
    // Between the lock and the plan (gen.load(), the model lookup), the brain isn't known yet.
    assert.throws(() => assertBrainIdle(vault, "c_test", dice, "delete"), { code: "conflict", message: /Can't delete Dice Master: a reply is just starting/ });
    gen.forBrain(gm.id);
    assertBrainIdle(vault, "c_test", dice, "delete");
    assert.throws(() => assertBrainIdle(vault, "c_test", gm, "delete"), { code: "conflict", message: /Game Master is writing a reply right now/ });
  } finally {
    gen.release();
  }
  assertBrainIdle(vault, "c_test", gm, "delete");
});
