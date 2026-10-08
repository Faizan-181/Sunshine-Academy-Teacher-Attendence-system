import { html, mount, ic, badge, lateTitle, emptyState, errorState, tableSkeleton, pager, pageHead, field, select, input, $, $$ } from '../ui.js';
import { get, errMsg } from '../api.js';
import { formatDate, formatTime } from '../format.js';
import { state } from '../state.js';
import { attendanceEditModal, STATUS_OPTIONS } from '../components.js';

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const QUICK_RANGES = [
  { value: '', label: 'Any date (choose below)' }, { value: 'today', label: 'Today' }, { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' }, { value: 'prevmonth', label: 'Previous month' }, { value: 'year', label: 'This year' },
  { value: 'prevyear', label: 'Previous year' }, { value: 'all', label: 'All historical data' },
];

// "Today" is the academy's date from the server, not the browser's clock.
function rangeFor(kind) {
  const [y, m, d] = (state.today || iso(new Date())).split('-').map(Number);
  const today = new Date(y, m - 1, d);
  switch (kind) {
    case 'today': return { date: iso(today), from: '', to: '' };
    case 'week': return { date: '', from: iso(new Date(y, m - 1, d - ((today.getDay() + 6) % 7))), to: iso(today) }; // Monday to today
    case 'month': return { date: '', from: iso(new Date(y, m - 1, 1)), to: iso(today) };
    case 'prevmonth': return { date: '', from: iso(new Date(y, m - 2, 1)), to: iso(new Date(y, m - 1, 0)) };
    case 'year': return { date: '', from: `${y}-01-01`, to: iso(today) };
    case 'prevyear': return { date: '', from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    default: return { date: '', from: '', to: '' };
  }
}

export default async function history({ root, query }) {
  const blank = { teacher: '', subject: '', status: '', date: '', from: '', to: '' };
  const f = { ...blank, teacher: /^\d+$/.test(query.teacher || '') ? query.teacher : '' };
  let page = 1, last = null;

  mount(root, html`${pageHead('Attendance History', 'Search and review attendance records.')}
    <section class="card"><div class="toolbar"><form id="filters" class="filters" style="width:100%" novalidate>
      ${field({ name: 'range', label: 'Quick range', control: select({ name: 'range', options: QUICK_RANGES }) })}
      ${field({ name: 'teacher', label: 'Teacher', control: select({ name: 'teacher', value: f.teacher, options: [{ value: '', label: 'All teachers' }] }) })}
      ${field({ name: 'subject', label: 'Subject', control: select({ name: 'subject', options: [{ value: '', label: 'All subjects' }] }) })}
      ${field({ name: 'status', label: 'Status', control: select({ name: 'status', options: [{ value: '', label: 'All statuses' }, ...STATUS_OPTIONS] }) })}
      ${field({ name: 'date', label: 'Date', control: input({ name: 'date', type: 'date' }) })}
      ${field({ name: 'from', label: 'From', control: input({ name: 'from', type: 'date' }) })}
      ${field({ name: 'to', label: 'To', control: input({ name: 'to', type: 'date' }) })}
      <div class="span-2"><button type="button" class="btn btn-ghost btn-sm hidden" id="clear">${ic('x', 16)} Clear filters</button></div>
    </form></div><div id="results"></div></section>`);
  const form = $('#filters', root), results = $('#results', root), clearBtn = $('#clear', root);

  // Fill the dropdowns without blocking the table.
  Promise.all([get('/teachers/options'), get('/teachers/subjects')]).then(([t, s]) => {
    const add = (el, items) => items.forEach(([value, label]) => el.add(new Option(label, value)));
    add(form.elements.teacher, t.data.map((x) => [x.id, `${x.teacher_id} · ${x.name}`]));
    add(form.elements.subject, s.data.map((x) => [x, x]));
    form.elements.teacher.value = f.teacher;
  }).catch(() => {}); // the page still works without the dropdown data

  const hasFilters = () => Object.values(f).some(Boolean);

  async function load(first = false) {
    clearBtn.classList.toggle('hidden', !hasFilters());
    if (first || !last) mount(results, tableSkeleton(6, 7)); else results.classList.add('fade');
    try {
      last = await get('/attendance', { ...f, page, limit: 10 });
    } catch (error) {
      mount(results, errorState(errMsg(error, 'Unable to load attendance records. Please try again.')));
      $('[data-retry]', results).addEventListener('click', () => load(true));
      return;
    }
    results.classList.remove('fade');
    const records = last.data;
    if (!records.length) {
      mount(results, emptyState({ icon: 'calendar-x', title: 'No attendance records found.',
        text: hasFilters() ? 'Try changing or clearing the filters.' : 'Records will appear here once attendance is marked.',
        action: hasFilters() ? html`<button type="button" class="btn btn-secondary" data-clear>Clear filters</button>` : '' }));
      $('[data-clear]', results)?.addEventListener('click', clear);
      return;
    }
    mount(results, html`<div class="table-scroll"><table class="table w820">
      <thead><tr><th>Date</th><th>Teacher</th><th>Subject</th><th>Check In</th><th>Check Out</th><th>Status</th><th>Remarks</th><th class="right">Action</th></tr></thead>
      <tbody>${records.map((r, i) => html`<tr>
        <td class="nowrap strong" style="color:var(--ink)">${formatDate(r.date)}</td><td class="strong">${r.teacher.name}</td><td>${r.teacher.subject}</td>
        <td class="nowrap">${formatTime(r.check_in)}</td><td class="nowrap">${formatTime(r.check_out)}</td><td>${badge(r.status, lateTitle(r))}</td>
        <td class="dim truncate" title="${r.remarks}">${r.remarks || '—'}</td>
        <td><div class="actions"><button type="button" class="icon-btn" data-edit="${i}" aria-label="Edit attendance" title="Edit attendance">${ic('pencil')}</button></div></td></tr>`)}</tbody></table></div>${pager(last.pagination)}`);
    $$('[data-page]', results).forEach((b) => b.addEventListener('click', () => { page = Number(b.dataset.page); load(); }));
    $$('[data-edit]', results).forEach((b) => b.addEventListener('click', () => attendanceEditModal(records[b.dataset.edit], () => load())));
  }

  function clear() {
    Object.keys(f).forEach((k) => { f[k] = ''; });
    form.reset();
    page = 1;
    syncRange();
    load();
  }

  // A single date and a date range don't make sense together.
  function syncRange() {
    form.elements.from.disabled = form.elements.to.disabled = Boolean(f.date);
    form.elements.from.max = f.to || '';
    form.elements.to.min = f.from || '';
  }

  form.addEventListener('change', (e) => {
    if (!(e.target.name in f)) return;
    f[e.target.name] = e.target.value;
    if (['date', 'from', 'to'].includes(e.target.name)) form.elements.range.value = '';
    page = 1;
    syncRange();
    load();
  });
  form.elements.range.addEventListener('change', (e) => {
    const r = rangeFor(e.target.value);
    Object.assign(f, r);
    form.elements.date.value = r.date; form.elements.from.value = r.from; form.elements.to.value = r.to;
    page = 1;
    syncRange();
    load();
  });
  clearBtn.addEventListener('click', clear);
  syncRange();
  await load(true);
}
