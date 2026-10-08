import { lateTitle, html, mount, badge, emptyState, errorState, tableSkeleton, pager, pageHead, field, select, input, statsSummary, $, $$ } from '../ui.js';
import { get, errMsg } from '../api.js';
import { currentMonth, formatDate, formatTime } from '../format.js';
import { STATUS_OPTIONS } from '../components.js';

// A teacher's read-only view of their own attendance.
export default async function myAttendance({ root }) {
  const f = { month: '', status: '' };
  let page = 1, last = null;

  mount(root, html`${pageHead('My Attendance', 'Your attendance history. Records can only be changed by the administrator.')}
    <div class="stack">
      <section class="card"><div class="card-head"><h2 id="period-title">All time</h2></div><div class="card-body" id="summary">${tableSkeleton(2, 4)}</div></section>
      <section class="card"><div class="toolbar"><form id="filters" style="display:grid;gap:12px;width:100%;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))" novalidate>
        ${field({ name: 'month', label: 'Month', control: input({ name: 'month', type: 'month', extra: `max="${currentMonth()}"` }) })}
        ${field({ name: 'status', label: 'Status', control: select({ name: 'status', options: [{ value: '', label: 'All statuses' }, ...STATUS_OPTIONS] }) })}
        <div style="display:flex;align-items:flex-end"><button type="button" class="btn btn-ghost hidden" id="clear">Clear filters</button></div>
      </form></div><div id="results"></div></section></div>`);
  const results = $('#results', root), summary = $('#summary', root), form = $('#filters', root), clearBtn = $('#clear', root);

  async function load() {
    clearBtn.classList.toggle('hidden', !(f.month || f.status));
    $('#period-title', root).textContent = f.month ? 'Selected month' : 'All time';
    if (!last) mount(results, tableSkeleton(5, 5)); else results.classList.add('fade');
    try {
      const [stats, list] = await Promise.all([get('/attendance/summary', { month: f.month }), get('/attendance', { month: f.month, status: f.status, page, limit: 10 })]);
      last = list;
      mount(summary, stats.data.totalDays ? statsSummary(stats.data) : html`<p class="muted">No attendance has been recorded for this period.</p>`);
    } catch (error) {
      mount(results, errorState(errMsg(error, 'Unable to load your attendance. Please try again.')));
      $('[data-retry]', results).addEventListener('click', load);
      return;
    }
    results.classList.remove('fade');
    if (!last.data.length) {
      mount(results, emptyState({ icon: 'calendar-x', title: 'No attendance records found.', text: f.month || f.status ? 'Try changing or clearing the filters.' : 'Your records will appear here once attendance is marked.' }));
      return;
    }
    mount(results, html`<div class="table-scroll"><table class="table"><thead><tr><th>Date</th><th>Check In</th><th>Check Out</th><th>Status</th><th>Remarks</th></tr></thead>
      <tbody>${last.data.map((r) => html`<tr><td class="nowrap strong" style="color:var(--ink)">${formatDate(r.date)}</td><td class="nowrap">${formatTime(r.check_in)}</td><td class="nowrap">${formatTime(r.check_out)}</td><td>${badge(r.status, lateTitle(r))}</td><td class="dim">${r.remarks || '—'}</td></tr>`)}</tbody></table></div>${pager(last.pagination)}`);
    $$('[data-page]', results).forEach((b) => b.addEventListener('click', () => { page = Number(b.dataset.page); load(); }));
  }

  form.addEventListener('change', (e) => { f[e.target.name] = e.target.value; page = 1; load(); });
  clearBtn.addEventListener('click', () => { f.month = f.status = ''; form.reset(); page = 1; load(); });
  await load();
}
