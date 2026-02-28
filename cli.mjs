#!/usr/bin/env node

// cc-heatmap — GitHub-style AI activity heatmap from proof-log
// Reads ~/ops/proof-log/YYYY-MM-DD.md files, generates a standalone HTML heatmap.
// Zero dependencies.

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

// ── Config ──────────────────────────────────────────────────────

const DEFAULT_WEEKS = 52;
const DEFAULT_LOG_DIR = join(homedir(), 'ops', 'proof-log');

// ── CLI args ────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`cc-heatmap — GitHub-style AI activity heatmap from proof-log

Usage:
  cc-heatmap > heatmap.html        # Generate HTML (last 52 weeks)
  cc-heatmap --weeks 26            # Last 26 weeks
  cc-heatmap --dir ~/my-logs       # Custom log dir
  cc-heatmap --out heatmap.html    # Write to file (and open in browser)
  cc-heatmap --open                # Write to /tmp/cc-heatmap.html and open

Output: Standalone HTML file with embedded styles and interactivity.

Options:
  --weeks N       Number of weeks to show (default: 52)
  --dir PATH      Proof-log directory (default: ~/ops/proof-log)
  --out PATH      Write output to file instead of stdout
  --open          Write to /tmp and open in default browser
  --version       Show version
  --help          Show this help
`);
  process.exit(0);
}

if (args.includes('--version')) {
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)));
  console.log(pkg.version);
  process.exit(0);
}

const weeksIdx = args.indexOf('--weeks');
const numWeeks = weeksIdx >= 0 ? parseInt(args[weeksIdx + 1], 10) : DEFAULT_WEEKS;

const dirIdx = args.indexOf('--dir');
const logDir = dirIdx >= 0
  ? args[dirIdx + 1].replace('~', homedir())
  : DEFAULT_LOG_DIR;

const outIdx = args.indexOf('--out');
const outFile = outIdx >= 0 ? args[outIdx + 1] : null;
const openBrowser = args.includes('--open');

// ── Date helpers ────────────────────────────────────────────────

function toYMD(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// ── Proof-log parser ────────────────────────────────────────────

const SESSION_HEADER = /^### (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})-(\d{2}:\d{2}) JST/;
const DURATION_LINE  = /^- いつ: .+JST（(\d+)分）/;
const WHERE_LINE     = /^- どこで: (.+)$/;

function parseProofLog(content) {
  const sessions = [];
  let current = null;

  for (const raw of content.split('\n')) {
    const line = raw.trim();
    const headerMatch = SESSION_HEADER.exec(line);
    if (headerMatch) {
      if (current) sessions.push(current);
      current = { date: headerMatch[1], durationMin: 0, project: null };
      continue;
    }
    if (!current) continue;

    const durMatch = DURATION_LINE.exec(line);
    if (durMatch) { current.durationMin = parseInt(durMatch[1], 10); continue; }

    const whereMatch = WHERE_LINE.exec(line);
    if (whereMatch) { current.project = whereMatch[1].trim(); continue; }
  }
  if (current) sessions.push(current);
  return sessions;
}

// ── Build date range ────────────────────────────────────────────

// Start from the Sunday that is (numWeeks * 7) days before today
const today = new Date();
today.setHours(12, 0, 0, 0);

const rangeStart = new Date(today);
rangeStart.setDate(today.getDate() - numWeeks * 7);
// Rewind to previous Sunday
const dow = rangeStart.getDay(); // 0=Sun
rangeStart.setDate(rangeStart.getDate() - dow);

// ── Load logs ───────────────────────────────────────────────────

const minutesByDate = {};   // { 'YYYY-MM-DD': totalMin }
const projectsByDate = {};  // { 'YYYY-MM-DD': { project: minutes } }

// Scan all .md files in logDir that fall in range
const rangeStartStr = toYMD(rangeStart);
const todayStr = toYMD(today);

let d = new Date(rangeStart);
while (toYMD(d) <= todayStr) {
  const dateStr = toYMD(d);
  const filePath = join(logDir, `${dateStr}.md`);
  if (existsSync(filePath)) {
    try {
      const content = readFileSync(filePath, 'utf8');
      const sessions = parseProofLog(content);
      for (const s of sessions) {
        if (!s.durationMin) { d = addDays(d, 1); continue; }
        minutesByDate[dateStr] = (minutesByDate[dateStr] || 0) + s.durationMin;
        if (s.project) {
          if (!projectsByDate[dateStr]) projectsByDate[dateStr] = {};
          projectsByDate[dateStr][s.project] = (projectsByDate[dateStr][s.project] || 0) + s.durationMin;
        }
      }
    } catch (e) { /* skip */ }
  }
  d = addDays(d, 1);
}

// ── Aggregate stats ─────────────────────────────────────────────

let totalMinutes = 0;
let activeDays = 0;
let longestStreak = 0;
let currentStreak = 0;
let tempStreak = 0;
const allProjects = {};

const datesCursor = new Date(rangeStart);
while (toYMD(datesCursor) <= todayStr) {
  const ds = toYMD(datesCursor);
  const min = minutesByDate[ds] || 0;
  if (min > 0) {
    totalMinutes += min;
    activeDays++;
    tempStreak++;
    if (tempStreak > longestStreak) longestStreak = tempStreak;
    // Only count current streak up to today
    if (ds <= todayStr) currentStreak = tempStreak;
  } else {
    if (ds < todayStr) {
      tempStreak = 0;
      currentStreak = 0;
    }
  }
  if (projectsByDate[ds]) {
    for (const [proj, min2] of Object.entries(projectsByDate[ds])) {
      allProjects[proj] = (allProjects[proj] || 0) + min2;
    }
  }
  datesCursor.setDate(datesCursor.getDate() + 1);
}

const topProject = Object.entries(allProjects).sort((a, b) => b[1] - a[1])[0];

function fmtHours(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── Generate heatmap cells ──────────────────────────────────────

// Color levels (dark GitHub style)
const LEVELS = ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'];

function getLevel(minutes) {
  if (!minutes) return 0;
  if (minutes < 30) return 1;
  if (minutes < 120) return 2;
  if (minutes < 240) return 3;
  return 4;
}

const CELL = 13;  // cell size
const GAP  = 3;   // gap
const STEP = CELL + GAP;

// Month labels: collect month label positions
const months = [];
let prevMonth = -1;

const cells = [];
let col = 0;
let weekCursor = new Date(rangeStart);

while (toYMD(weekCursor) <= todayStr) {
  for (let row = 0; row < 7; row++) {
    const ds = toYMD(weekCursor);
    if (ds > todayStr) { weekCursor = addDays(weekCursor, 1); continue; }

    const min = minutesByDate[ds] || 0;
    const level = getLevel(min);
    const color = LEVELS[level];
    const x = col * STEP;
    const y = row * STEP;

    // Build tooltip
    const h = (min / 60).toFixed(1);
    const topProj = projectsByDate[ds]
      ? Object.entries(projectsByDate[ds]).sort((a, b) => b[1] - a[1])[0]
      : null;
    const tipText = min > 0
      ? `${ds}\\n${h}h AI time${topProj ? '\\n' + topProj[0] : ''}`
      : ds;

    cells.push(
      `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${color}" data-date="${ds}" data-min="${min}"><title>${tipText}</title></rect>`
    );

    // Track month label
    const month = weekCursor.getMonth();
    if (month !== prevMonth && row === 0) {
      const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      months.push({ x: col * STEP, label: MONTHS[month] });
      prevMonth = month;
    }

    weekCursor = addDays(weekCursor, 1);
  }
  col++;
}

const svgWidth = col * STEP;
const svgHeight = 7 * STEP;

const monthLabels = months.map(m =>
  `<text x="${m.x}" y="-4" font-size="11" fill="#7d8590" font-family="system-ui,sans-serif">${m.label}</text>`
).join('\n');

const dayLabels = [
  { y: 1 * STEP + CELL - 3, label: 'Mon' },
  { y: 3 * STEP + CELL - 3, label: 'Wed' },
  { y: 5 * STEP + CELL - 3, label: 'Fri' },
].map(d => `<text x="-28" y="${d.y}" font-size="10" fill="#7d8590" font-family="system-ui,sans-serif">${d.label}</text>`).join('\n');

// ── HTML template ───────────────────────────────────────────────

const generatedDate = todayStr;
const topProjectStr = topProject
  ? `${topProject[0]} (${fmtHours(topProject[1])})`
  : 'N/A';

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Activity Heatmap</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0d1117;
      color: #e6edf3;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      min-height: 100vh;
      padding: 40px 24px;
    }
    .container {
      max-width: 960px;
      margin: 0 auto;
    }
    header {
      margin-bottom: 32px;
    }
    .badge {
      display: inline-block;
      background: rgba(57,211,83,0.1);
      color: #39d353;
      border: 1px solid rgba(57,211,83,0.3);
      border-radius: 20px;
      padding: 4px 12px;
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      margin-bottom: 12px;
    }
    h1 {
      font-size: 1.75rem;
      font-weight: 700;
      color: #f0f6fc;
      margin-bottom: 6px;
    }
    .subtitle {
      color: #7d8590;
      font-size: 0.9rem;
    }
    .stats-strip {
      display: flex;
      gap: 24px;
      flex-wrap: wrap;
      margin-bottom: 32px;
      padding: 20px 24px;
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 12px;
    }
    .stat { flex: 1; min-width: 120px; }
    .stat-n {
      font-size: 1.8rem;
      font-weight: 700;
      color: #39d353;
      line-height: 1;
    }
    .stat-l {
      font-size: 0.8rem;
      color: #7d8590;
      margin-top: 4px;
    }
    .heatmap-wrap {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 12px;
      padding: 24px;
      overflow-x: auto;
      margin-bottom: 24px;
    }
    .heatmap-inner {
      display: inline-block;
    }
    svg { display: block; overflow: visible; margin: 20px 32px 8px 36px; }
    .legend {
      display: flex;
      align-items: center;
      gap: 6px;
      justify-content: flex-end;
      margin-top: 16px;
      font-size: 0.78rem;
      color: #7d8590;
    }
    .legend-cell {
      display: inline-block;
      width: 12px;
      height: 12px;
      border-radius: 2px;
    }
    .footer-note {
      text-align: center;
      color: #484f58;
      font-size: 0.78rem;
      margin-top: 24px;
    }
    .footer-note a { color: #7d8590; text-decoration: none; }
    .footer-note a:hover { color: #39d353; }
    .top-project {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(57,211,83,0.08);
      border: 1px solid rgba(57,211,83,0.2);
      border-radius: 8px;
      padding: 8px 14px;
      font-size: 0.85rem;
      margin-top: 12px;
    }
    .top-project-dot {
      width: 8px;
      height: 8px;
      background: #39d353;
      border-radius: 50%;
    }

    /* Tooltip on hover */
    rect:hover { opacity: 0.85; cursor: default; }

    @media (max-width: 600px) {
      .stats-strip { gap: 16px; padding: 16px; }
      .stat-n { font-size: 1.4rem; }
    }
  </style>
</head>
<body>
<div class="container">
  <header>
    <div class="badge">Claude Code Activity</div>
    <h1>AI Activity Heatmap</h1>
    <p class="subtitle">Last ${numWeeks} weeks of autonomous AI development · Generated ${generatedDate}</p>
    ${topProject ? `<div class="top-project"><span class="top-project-dot"></span>Most active project: <strong>${topProjectStr}</strong></div>` : ''}
  </header>

  <div class="stats-strip">
    <div class="stat">
      <div class="stat-n">${fmtHours(totalMinutes)}</div>
      <div class="stat-l">Total AI time</div>
    </div>
    <div class="stat">
      <div class="stat-n">${activeDays}</div>
      <div class="stat-l">Active days</div>
    </div>
    <div class="stat">
      <div class="stat-n">${longestStreak}</div>
      <div class="stat-l">Longest streak</div>
    </div>
    <div class="stat">
      <div class="stat-n">${currentStreak}</div>
      <div class="stat-l">Current streak</div>
    </div>
    <div class="stat">
      <div class="stat-n">${numWeeks * 7}</div>
      <div class="stat-l">Days tracked</div>
    </div>
  </div>

  <div class="heatmap-wrap">
    <div class="heatmap-inner">
      <svg width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" xmlns="http://www.w3.org/2000/svg" overflow="visible">
        ${monthLabels}
        ${dayLabels}
        ${cells.join('\n        ')}
      </svg>
      <div class="legend">
        <span>Less</span>
        ${LEVELS.map(c => `<span class="legend-cell" style="background:${c}"></span>`).join('')}
        <span>More</span>
        <span style="margin-left:12px;color:#484f58">1 cell = 1 day · hover for details</span>
      </div>
    </div>
  </div>

  <p class="footer-note">
    Generated by <a href="https://github.com/yurukusa/cc-heatmap">cc-heatmap</a> ·
    Part of <a href="https://yurukusa.github.io/cc-toolkit/">cc-toolkit</a> ·
    Reads from <code style="background:#21262d;padding:1px 5px;border-radius:3px;font-size:0.75em">~/ops/proof-log/</code>
  </p>
</div>
</body>
</html>`;

// ── Output ──────────────────────────────────────────────────────

if (openBrowser) {
  const tmpFile = '/tmp/cc-heatmap.html';
  writeFileSync(tmpFile, html, 'utf8');
  try {
    execSync(`xdg-open "${tmpFile}" 2>/dev/null || open "${tmpFile}" 2>/dev/null || true`);
  } catch (e) { /* ignore */ }
  process.stderr.write(`Opened: ${tmpFile}\n`);
} else if (outFile) {
  const expanded = outFile.replace('~', homedir());
  writeFileSync(expanded, html, 'utf8');
  process.stderr.write(`Written: ${expanded}\n`);
} else {
  process.stdout.write(html);
}

process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') process.exit(0);
});
