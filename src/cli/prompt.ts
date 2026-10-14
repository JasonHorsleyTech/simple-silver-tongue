/** Read one line from the terminal without echoing it. Ctrl-C aborts. */
export function promptHidden(question: string): Promise<string> {
  const input = process.stdin;
  const output = process.stderr;
  output.write(question);
  return new Promise((resolve) => {
    let value = "";
    input.setRawMode(true);
    input.setEncoding("utf8");
    input.resume();
    const finish = () => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      output.write("\n");
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") {
          finish();
          resolve(value);
          return;
        }
        if (ch === "\u0003") {
          finish();
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") value = Array.from(value).slice(0, -1).join("");
        else if (ch >= " ") value += ch;
      }
    };
    input.on("data", onData);
  });
}

export async function readAllStdin(): Promise<string> {
  const parts: Buffer[] = [];
  for await (const p of process.stdin) parts.push(typeof p === "string" ? Buffer.from(p) : (p as Buffer));
  return Buffer.concat(parts).toString("utf8");
}
