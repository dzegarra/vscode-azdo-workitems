import { FEATURE_LABELS, FEATURES } from './requestContext';
import { formatClock, formatThrottle } from './requestLog';
import { MINUTE_MS, StatsSnapshot, WINDOW_MINUTES } from './requestStats';

const SPARK_MINUTES = 15;
const RECENT_AVERAGE_MINUTES = 5;
const BAR_WIDTH = 20;
const BAR = '█';

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function rate(value: number): string {
  return value.toFixed(1);
}

function minuteLabel(minuteStart: number): string {
  return formatClock(minuteStart).slice(0, 5);
}

function featuresSection(s: StatsSnapshot): string[] {
  const rows = FEATURES.map((feature) => ({
    label: FEATURE_LABELS[feature],
    total: s.total[feature],
    hour: s.lastHour[feature],
  }))
    .filter((r) => r.total.requests > 0)
    .sort((a, b) => b.hour.requests - a.hour.requests || b.total.requests - a.total.requests);
  const lines = ['## Requests per feature', ''];
  if (!rows.length) {
    return [...lines, 'No requests yet.', ''];
  }
  lines.push(
    '| Feature | Last 60 min | Errors (60 min) | Since start | Errors (since start) |',
    '| --- | ---: | ---: | ---: | ---: |'
  );
  for (const r of rows) {
    lines.push(`| ${r.label} | ${r.hour.requests} | ${r.hour.errors} | ${r.total.requests} | ${r.total.errors} |`);
  }
  const all = (pick: (r: (typeof rows)[number]) => number) => sum(rows.map(pick));
  lines.push(
    `| **Total** | **${all((r) => r.hour.requests)}** | **${all((r) => r.hour.errors)}** | **${all(
      (r) => r.total.requests
    )}** | **${all((r) => r.total.errors)}** |`,
    ''
  );
  return lines;
}

function ratesSection(s: StatsSnapshot): string[] {
  const hour = sum(s.perMinute);
  const lastFive = s.perMinute.slice(-RECENT_AVERAGE_MINUTES);
  const busiestCount = Math.max(...s.perMinute);
  const lines = [
    '## Requests per minute',
    '',
    `- Average, last ${WINDOW_MINUTES} minutes: **${rate(hour / WINDOW_MINUTES)}**`,
    `- Average, last ${RECENT_AVERAGE_MINUTES} minutes: **${rate(sum(lastFive) / RECENT_AVERAGE_MINUTES)}**`,
  ];
  if (busiestCount > 0) {
    const index = s.perMinute.lastIndexOf(busiestCount);
    lines.push(`- Busiest minute: **${busiestCount}** at ${minuteLabel(s.firstMinuteStart + index * MINUTE_MS)}`);
  } else {
    lines.push('- Busiest minute: none in the last hour');
  }
  const recent = s.perMinute.slice(-SPARK_MINUTES);
  const recentMax = Math.max(...recent, 1);
  lines.push(
    '',
    `Last ${SPARK_MINUTES} minutes (the last row is the current minute):`,
    '',
    '| Minute | Requests | |',
    '| --- | ---: | --- |'
  );
  recent.forEach((count, i) => {
    const start = s.firstMinuteStart + (WINDOW_MINUTES - SPARK_MINUTES + i) * MINUTE_MS;
    const width = count > 0 ? Math.max(1, Math.round((count / recentMax) * BAR_WIDTH)) : 0;
    lines.push(`| ${minuteLabel(start)} | ${count} | ${BAR.repeat(width)} |`);
  });
  lines.push('');
  return lines;
}

function errorsSection(s: StatsSnapshot): string[] {
  const lines = ['## Errors and throttling', '', '### Errors by status', ''];
  if (!s.statusCounts.length) {
    lines.push('No errors.', '');
  } else {
    lines.push(
      '| Status | Count |',
      '| --- | ---: |',
      ...s.statusCounts.map((c) => `| ${c.status} | ${c.count} |`),
      ''
    );
    lines.push(
      `### Last ${s.recentErrors.length} errors`,
      '',
      '| Time | Feature | Status | URL |',
      '| --- | --- | --- | --- |'
    );
    for (const e of s.recentErrors) {
      lines.push(`| ${formatClock(e.time)} | ${FEATURE_LABELS[e.feature]} | ${e.status} | \`${e.url}\` |`);
    }
    lines.push('');
  }
  lines.push('### Throttling', '');
  const { count, last } = s.throttle;
  if (!count || !last) {
    lines.push('No throttling.');
  } else {
    lines.push(
      `- Throttled responses: **${count}**`,
      `- Last: ${formatClock(last.time)}, ${FEATURE_LABELS[last.feature]}, status ${last.status}`,
      `- Headers: \`${formatThrottle(last.headers)}\``
    );
  }
  lines.push('');
  return lines;
}

/** Markdown of the usage of Azure DevOps by this extension in this session */
export function buildUsageReport(s: StatsSnapshot): string {
  const since = (s.now - s.startedAt) / MINUTE_MS;
  return [
    '# Azure DevOps usage',
    '',
    `Totalflow X devtools, requests made by this extension since it started (${formatClock(s.startedAt)}, ${rate(
      since
    )} min ago). Generated at ${formatClock(s.now)}.`,
    '',
    ...featuresSection(s),
    ...ratesSection(s),
    ...errorsSection(s),
  ].join('\n');
}
