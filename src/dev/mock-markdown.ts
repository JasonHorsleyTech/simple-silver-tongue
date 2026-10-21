/**
 * A long Markdown reply for the mock (trigger: MOCK_MARKDOWN in the last message), so the browser's
 * scrollback can be checked with every construct a model uses: headings, emphasis, lists (nested, ordered,
 * tasks), fenced code in several languages, a GFM table with alignment, nested block quotes, a footnote,
 * a horizontal rule, long unbroken lines and an HTML comment (which must stay visible, not vanish).
 */
export const MOCK_MARKDOWN = `## The Gilded Goat, by lamplight

The tavern smells of **woodsmoke** and *spilled cider*. A hooded figure sits alone by the hearth, turning a coin across ~~her~~ his knuckles. You can \`inspect\` things, talk to people, or [read the rules](https://example.com/rules).

### What you notice

1. The barkeep, **Old Maren**, polishes the same mug for the third time.
2. Three dwarves argue over a map:
   - one insists the pass is *closed*,
   - one says it is merely **haunted**,
   - and the third is asleep.
3. A notice board by the door.

- [x] Order a drink
- [ ] Approach the hooded figure
- [ ] Read the notice board

> "Strangers who sit by the fire pay for the wood."
>
> > Carved into the mantel, in a careful hand.

---

### Prices at the bar

| Item | Price | Notes |
|:-----|------:|:-----:|
| Plum wine | 4 cp | house special |
| Dwarven stout | 6 cp | *very* strong |
| Room for the night | 2 sp | breakfast included |
| Hot bath | 5 cp | ask Maren |

### A dice helper

\`\`\`ts
type Roll = { dice: number; sides: number; bonus: number };

export function roll({ dice, sides, bonus }: Roll): number {
  let total = bonus;
  for (let i = 0; i < dice; i++) total += 1 + Math.floor(Math.random() * sides);
  return total; // 2d6+1 → between 3 and 13
}
\`\`\`

The same idea in Python:

\`\`\`python
import random

def roll(dice: int, sides: int, bonus: int = 0) -> int:
    """Roll NdS+B."""
    return bonus + sum(random.randint(1, sides) for _ in range(dice))

print(roll(2, 6, 1))
\`\`\`

And from a shell, with a line that is far too long to fit: \`./sst turn --conversation c_k3j9x0q2ma --content "I walk over to the hooded figure and say hello"\`

\`\`\`bash
./sst turn --conversation c_k3j9x0q2ma --content "I approach the hooded figure, sit down across from them without asking, and slide a silver coin over the table."
\`\`\`

<!-- from: the GM, a note to self: the figure is the missing heir -->

The figure looks up. Roll for **Insight**[^1].

[^1]: Wisdom (Insight), DC 13.
`;
