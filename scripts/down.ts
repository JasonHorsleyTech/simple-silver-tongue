import { foreignHolder, MOCK, SERVER, stop } from "./proc.ts";

let code = 0;
for (const p of [SERVER, MOCK]) {
  try {
    console.log((await stop(p)) ? `down: stopped the ${p.name}` : `down: the ${p.name} was not running`);
    const holder = foreignHolder(p);
    if (holder) console.log(`down: note: ${holder}. Not ours, so left alone.`);
  } catch (err) {
    console.error(`down: ${(err as Error).message}`);
    code = 1;
  }
}
process.exitCode = code;
