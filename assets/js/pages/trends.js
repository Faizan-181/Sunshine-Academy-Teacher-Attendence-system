import { html, mount, pageHead, field, select, statCard, setLoading, loading, errorState, emptyState, $ } from '../ui.js';
import { get, errMsg } from '../api.js';
import { state } from '../state.js';
import { MONTH_NAMES } from '../format.js';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_COUNT_OPTIONS = [
  { value: '6', label: 'Last 6 months' },
  { value: '12', label: 'Last 12 months' },
];

function monthKey(date) {
  return date.slice(0, 7);
}

function monthRange(count, today) {
  const [year, month] = today.slice(0, 7).split('-').map(Number);
  const keys = Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - (count - 1) + index, 1));
    return date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0');
  });
  return { keys, from: keys[0] + '-01', to: today };
}

function monthLabel(key) {
  const [year, month] = key.split('-').map(Number);
  return MONTH_NAMES[month - 1].slice(0, 3) + ' ' + String(year).slice(-2);
}

const percent = (value) => Number(value || 0).toFixed(1) + '%';
const signedPoints = (value) => (value > 0 ? '+' : '') + Number(value || 0).toFixed(1) + ' pp';

function attendanceLineChart(months) {
  const width = 720, height = 260, left = 48, right = 18, top = 18, bottom = 46;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const points = months.map((item, index) => ({
    ...item,
    x: months.length === 1 ? left + plotWidth / 2 : left + index * plotWidth / (months.length - 1),
    y: item.rate === null ? null : top + (100 - item.rate) * plotHeight / 100,
  }));
  const segments = [];
  let segment = [];
  points.forEach((point) => {
    if (point.y === null) {
      if (segment.length > 1) segments.push(segment);
      segment = [];
    } else {
      segment.push(point);
    }
  });
  if (segment.length > 1) segments.push(segment);

  return html`<section class="card trend-chart-card">
    <div class="card-head"><div><h2>Monthly attendance rate</h2><p class="dim">Present, including late, as a share of recorded days.</p></div></div>
    <div class="card-body trend-chart-body"><div class="trend-svg-scroll"><svg class="trend-line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Monthly attendance rate">
      ${[100, 75, 50, 25, 0].map((value) => {
        const y = top + (100 - value) * plotHeight / 100;
        return html`<g><line class="trend-grid-line" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"></line><text class="trend-axis-label" x="${left - 10}" y="${y + 4}" text-anchor="end">${value}%</text></g>`;
      })}
      ${segments.map((group) => html`<polyline class="trend-line" points="${group.map((point) => point.x + ',' + point.y).join(' ')}"></polyline>`)}
      ${points.filter((point) => point.y !== null).map((point) => html`<g><circle class="trend-point" cx="${point.x}" cy="${point.y}" r="5"><title>${monthLabel(point.key)}: ${percent(point.rate)}</title></circle><text class="trend-month-label" x="${point.x}" y="${height - 14}" text-anchor="middle">${monthLabel(point.key)}</text></g>`)}
      ${points.filter((point) => point.y === null).map((point) => html`<text class="trend-month-label" x="${point.x}" y="${height - 14}" text-anchor="middle">${monthLabel(point.key)}</text>`)}
    </svg></div>
    <p class="trend-chart-note">Months with no attendance records are left blank rather than shown as 0%.</p></div>
  </section>`;
}

function weekdayChart(weekdays) {
  const max = Math.max(1, ...weekdays.map((day) => day.count));
  return html`<section class="card trend-chart-card">
    <div class="card-head"><div><h2>Absences by weekday</h2><p class="dim">Which weekdays have the most recorded absences?</p></div></div>
    <div class="card-body trend-weekday-list">${weekdays.map((day) => {
      const width = Math.round(day.count * 100 / max);
      return html`<div class="trend-weekday-row"><span>${day.label}</span><div class="trend-bar-track" role="progressbar" aria-label="${day.label} absences" aria-valuenow="${day.count}" aria-valuemin="0" aria-valuemax="${max}"><i style="width:${width}%"></i></div><b>${day.count}</b></div>`;
    })}</div>
    <div class="trend-chart-note">Only attendance records marked Absent are counted.</div>
  </section>`;
}

function teacherTrendTable(comparisons, notComparable, earlierLabel, recentLabel) {
  const note = notComparable ? notComparable + ' teacher(s) did not have check-ins in both periods and were left out.' : '';
  return html`<section class="card trend-chart-card">
    <div class="card-head"><div><h2>Late attendance by teacher</h2><p class="dim">Sorted by the largest increase in late rate.</p></div></div>
    ${comparisons.length ? html`<div class="table-scroll"><table class="table trend-teacher-table">
      <thead><tr><th>Teacher</th><th class="num">${earlierLabel}</th><th class="num">${recentLabel}</th><th class="num">Change</th></tr></thead>
      <tbody>${comparisons.slice(0, 10).map((teacher) => html`<tr>
        <td data-label="Teacher"><span class="strong">${teacher.name}</span><small class="trend-teacher-code">${teacher.code}</small></td>
        <td data-label="${earlierLabel}" class="num">${percent(teacher.earlierRate)}</td>
        <td data-label="${recentLabel}" class="num strong">${percent(teacher.recentRate)}</td>
        <td data-label="Change" class="num"><span class="trend-delta ${teacher.delta > 0 ? 'trend-delta-up' : teacher.delta < 0 ? 'trend-delta-down' : ''}">${signedPoints(teacher.delta)}</span></td>
      </tr>`)}</tbody>
    </table></div>` : html`<div class="card-body">${emptyState({ icon: 'chart-column', title: 'Not enough data to compare teachers yet.', text: 'Teachers need recorded check-ins in both comparison periods.' })}</div>`}
    <div class="trend-chart-note">Late rate = late check-ins ÷ recorded check-ins. ${note}</div>
  </section>`;
}

function summarize(rows, keys) {
  const monthIndex = new Map(keys.map((key, index) => [key, index]));
  const months = keys.map((key) => ({ key, total: 0, present: 0, absent: 0, late: 0, leave: 0, rate: null }));
  const weekdays = WEEKDAYS.map((label) => ({ label, count: 0 }));
  const teachers = new Map();
  const split = Math.floor(keys.length / 2);
  let earlierCheckins = 0, earlierLate = 0, recentCheckins = 0, recentLate = 0;

  rows.forEach((row) => {
    const index = monthIndex.get(monthKey(row.date));
    if (index === undefined) return;
    const month = months[index];
    month.total += 1;
    const teacherKey = String(row.teacher_id || row.teacher_name || 'unknown');
    if (!teachers.has(teacherKey)) teachers.set(teacherKey, {
      name: row.teacher_name || 'Unknown teacher', code: row.teacher_id || '—',
      earlierCheckins: 0, earlierLate: 0, recentCheckins: 0, recentLate: 0,
    });
    const teacher = teachers.get(teacherKey);
    const isRecent = index >= split;

    if (row.status === 'present') month.present += 1;
    if (row.status === 'late') month.late += 1;
    if (row.status === 'absent') {
      month.absent += 1;
      const day = new Date(row.date + 'T00:00:00Z').getUTCDay();
      weekdays[day].count += 1;
    }
    if (row.status === 'leave') month.leave += 1;

    if (row.status === 'present' || row.status === 'late') {
      if (isRecent) teacher.recentCheckins += 1;
      else teacher.earlierCheckins += 1;
      if (isRecent) recentCheckins += 1;
      else earlierCheckins += 1;
    }
    if (row.status === 'late') {
      if (isRecent) {
        teacher.recentLate += 1;
        recentLate += 1;
      } else {
        teacher.earlierLate += 1;
        earlierLate += 1;
      }
    }
  });

  months.forEach((month) => {
    month.rate = month.total ? Math.round((month.present + month.late) * 1000 / month.total) / 10 : null;
  });

  const comparisons = [...teachers.values()]
    .filter((teacher) => teacher.earlierCheckins > 0 && teacher.recentCheckins > 0)
    .map((teacher) => {
      const earlierRate = teacher.earlierLate * 100 / teacher.earlierCheckins;
      const recentRate = teacher.recentLate * 100 / teacher.recentCheckins;
      return { ...teacher, earlierRate, recentRate, delta: recentRate - earlierRate };
    })
    .sort((a, b) => b.delta - a.delta);
  const notComparable = [...teachers.values()].length - comparisons.length;
  const earlierRate = earlierCheckins ? earlierLate * 100 / earlierCheckins : null;
  const recentRate = recentCheckins ? recentLate * 100 / recentCheckins : null;
  const presentTotal = months.reduce((sum, month) => sum + month.present + month.late, 0);
  const recordedTotal = months.reduce((sum, month) => sum + month.total, 0);

  return {
    months, weekdays, comparisons, notComparable,
    total: recordedTotal,
    absent: months.reduce((sum, month) => sum + month.absent, 0),
    late: months.reduce((sum, month) => sum + month.late, 0),
    attendanceRate: recordedTotal ? Math.round(presentTotal * 1000 / recordedTotal) / 10 : 0,
    risingTeachers: comparisons.filter((teacher) => teacher.delta > 0).length,
    lateRateChange: earlierRate === null || recentRate === null ? null : recentRate - earlierRate,
  };
}

function renderDashboard(summary, range, count) {
  if (!summary.total) {
    return html`<section class="card">${emptyState({ icon: 'chart-column', title: 'No attendance records for this period.', text: 'Choose a wider period or check Attendance History.' })}</section>`;
  }
  const earlierLabel = 'Previous ' + (count / 2) + ' months';
  const recentLabel = 'Latest ' + (count / 2) + ' months';
  const changeText = summary.lateRateChange === null ? '—' : signedPoints(summary.lateRateChange);
  return html`<div class="stack">
    <div class="trend-stat-grid">
      ${statCard('chart-column', 'Attendance rate', summary.attendanceRate + '%', 'leaf')}
      ${statCard('user-x', 'Absence records', summary.absent, 'red')}
      ${statCard('clock', 'Late check-ins', summary.late, 'amber')}
      ${statCard('chart-column', 'Teachers with rising late rates', summary.risingTeachers, 'navy')}
    </div>
    ${attendanceLineChart(summary.months)}
    <div class="trend-grid">
      ${weekdayChart(summary.weekdays)}
      ${teacherTrendTable(summary.comparisons, summary.notComparable, earlierLabel, recentLabel)}
    </div>
    <p class="hint">Showing ${range.from} to ${range.to}. Late check-ins count as Present; late-rate changes compare the two halves of the selected period (${changeText} overall).</p>
  </div>`;
}

export default async function attendanceTrends({ root }) {
  const today = state.today || new Date().toISOString().slice(0, 10);
  mount(root, html`${pageHead('Attendance Trends', 'Spot attendance patterns by month, weekday and teacher.', html`<a class="btn btn-secondary" href="#/reports">Open Reports</a>`)}
    <section class="card trend-filter-card"><div class="card-body"><form id="trend-form" class="trend-controls">
      ${field({ name: 'months', label: 'Period', control: select({ name: 'months', value: '6', options: MONTH_COUNT_OPTIONS }) })}
      <p class="hint trend-period-hint">Late-rate change compares the first half with the latest half of this period.</p>
      <button type="submit" class="btn btn-navy" id="trend-refresh">Refresh trends</button>
    </form></div></section>
    <div id="trend-content">${loading('Loading attendance trends…')}</div>`);

  const form = $('#trend-form', root);
  const output = $('#trend-content', root);
  const refresh = $('#trend-refresh', root);

  async function load() {
    const count = Number(form.elements.months.value) || 6;
    const range = monthRange(count, today);
    setLoading(refresh, true);
    form.elements.months.disabled = true;
    mount(output, html`<section class="card">${loading('Loading attendance records…')}</section>`);
    try {
      const rows = [];
      let after = 0;
      for (;;) {
        const { data } = await get('/export/attendance', { after, from: range.from, to: range.to });
        rows.push(...data);
        if (data.length < 1000) break;
        after = data[data.length - 1].id;
      }
      mount(output, renderDashboard(summarize(rows, range.keys), range, count));
    } catch (error) {
      mount(output, html`<section class="card">${errorState(errMsg(error, 'Unable to load attendance trends. Please try again.'))}</section>`);
      $('[data-retry]', output)?.addEventListener('click', load);
    } finally {
      setLoading(refresh, false);
      form.elements.months.disabled = false;
    }
  }

  form.addEventListener('submit', (event) => { event.preventDefault(); load(); });
  form.elements.months.addEventListener('change', load);
  await load();
}