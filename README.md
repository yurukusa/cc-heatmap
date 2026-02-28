# cc-heatmap

**GitHub-style activity heatmap for your AI development sessions.**

Reads `~/ops/proof-log/YYYY-MM-DD.md` files and generates a beautiful standalone HTML heatmap — like GitHub's contribution graph but for Claude Code sessions.

**[Live Demo →](https://yurukusa.github.io/cc-heatmap/)** *(synthetic example data)*

![screenshot preview: dark green heatmap grid showing 52 weeks of AI activity]

## Install & run

```bash
# Generate heatmap (outputs HTML to stdout)
npx cc-heatmap > heatmap.html

# Open directly in browser
npx cc-heatmap --open

# Last 26 weeks
npx cc-heatmap --weeks 26

# Write to file
npx cc-heatmap --out ~/Desktop/my-heatmap.html
```

## What it shows

- **GitHub-style 52-week grid** — each cell = one day, color = hours of AI activity
- **Stats strip** — total hours, active days, longest streak, current streak
- **Hover tooltips** — date + hours + top project for each day
- **Month labels** across the top

## Color scale

| Color | Activity |
|-------|----------|
| Dark gray | No activity |
| Light green | < 30 min |
| Green | 30 min – 2h |
| Bright green | 2h – 4h |
| Neon green | 4h+ |

## Requirements

- Node.js 18+
- `~/ops/proof-log/YYYY-MM-DD.md` files (from [proof-log](https://github.com/yurukusa/cc-loop))

## Options

```
--weeks N       Number of weeks to show (default: 52)
--dir PATH      Proof-log directory (default: ~/ops/proof-log)
--out PATH      Write to file instead of stdout
--open          Write to /tmp and open in browser
```

## Part of cc-toolkit

One of 27 free tools for understanding your Claude Code usage.
→ [yurukusa.github.io/cc-toolkit](https://yurukusa.github.io/cc-toolkit/)

## License

MIT
