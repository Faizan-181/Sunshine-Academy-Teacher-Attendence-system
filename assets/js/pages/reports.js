import { html, mount, ic, emptyState, errorState, tableSkeleton, pageHead, field, select, input, statsSummary, bar, toast, setLoading, $, $$ } from '../ui.js';
import { get, errMsg } from '../api.js';
import { currentMonth, monthLabel, MONTH_NAMES } from '../format.js';
import { state } from '../state.js';
import { exportCsv, exportPdf, exportYearlyCsv, exportYearlyPdf, periodText } from '../export.js';

export default async function reports({ root }) {
  let report = null;

  mount(root, html`${pageHead('Reports', 'Attendance summaries by teacher, month or date range.', html`
      <div class="menu" id="export-menu">
        <button type="button" class="btn btn-primary" id="export-btn" disabled aria-haspopup="menu" aria-expanded="false">${ic('download', 16)} Export Report ${ic('chevron-down', 16)}</button>
        <div class="menu-list hidden" role="menu" id="export-list">
          <button type="button" role="menuitem" data-export="csv"><span style="color:var(--leaf)">${ic('file-spreadsheet', 16)}</span> Download CSV</button>
          <button type="button" role="menuitem" data-export="pdf"><span style="color:var(--ember)">${ic('file-text', 16)}</span> Download PDF</button>
        </div></div>`)}
    <section class="card" style="margin-bottom:24px"><div class="card-body" style="padding:16px"><form id="report-form" class="report-form" novalidate>
      ${field({ name: 'teacher', label: 'Teacher', control: select({ name: 'teacher', options: [{ value: '', label: 'All teachers' }] }) })}
      ${field({ name: 'mode', label: 'Period', control: select({ name: 'mode', options: [{ value: 'month', label: 'Month' }, { value: 'year', label: 'Yearly' }, { value: 'range', label: 'Date range' }] }) })}
      <div id="period"></div>
      <button type="submit" class="btn btn-navy" id="generate">${ic('chart-column', 16)} Generate</button>
    </form></div></section>
    <div id="out"></div>`);
  const form = $('#report-form', root), out = $('#out', root), periodBox = $('#period', root);
  const exportBtn = $('#export-btn', root), exportList = $('#export-list', root);

  get('/teachers/options').then((r) => r.data.forEach((t) => form.elements.teacher.add(new Option(t.name, t.id)))).catch(() => {});

  function drawPeriod() {
    const mode = form.elements.mode.value;
    const thisYear = Number((state.today || new Date().toISOString()).slice(0, 4));
    mount(periodBox, mode === 'month'
      ? field({ name: 'month', label: 'Month', control: input({ name: 'month', type: 'month', value: currentMonth(), extra: 'required' }) })
      : mode === 'year'
        ? field({ name: 'year', label: 'Year', control: input({ name: 'year', type: 'number', value: thisYear, extra: 'min="2000" max="2100" step="1" inputmode="numeric" required' }) })
        : html`<div class="pair">${field({ name: 'from', label: 'From', control: input({ name: 'from', type: 'date' }) })}${field({ name: 'to', label: 'To', control: input({ name: 'to', type: 'date' }) })}</div>`);
  }
  form.elements.mode.addEventListener('change', drawPeriod);
  drawPeriod();

  const hasData = (r) => (r.mode === 'year' ? r.totals.totalDays > 0 : r.rows.length > 0);

  const teacherCard = (title, rows) => html`<section class="card"><div class="card-head"><h2>${title}</h2></div><div class="table-scroll"><table class="table w760">
    <thead><tr><th>Teacher ID</th><th>Teacher</th><th>Subject</th><th class="num">Working days</th><th class="num">Present</th><th class="num">Absent</th><th class="num">Late</th><th class="num">Leave</th><th>Attendance</th></tr></thead>
    <tbody>${rows.map((r) => html`<tr><td class="dim">${r.teacher.teacher_id}</td><td class="strong">${r.teacher.name}</td><td>${r.teacher.subject}</td>
      <td class="num">${r.totalDays}</td><td class="num strong" style="color:var(--leaf)">${r.present}</td><td class="num strong" style="color:var(--red)">${r.absent}</td>
      <td class="num strong" style="color:var(--amber)">${r.late}</td><td class="num strong" style="color:var(--royal)">${r.leave}</td><td>${bar(r.percentage)}</td></tr>`)}</tbody></table></div></section>`;

  const monthCard = (months) => html`<section class="card"><div class="card-head"><h2>By month</h2></div><div class="table-scroll"><table class="table w760">
    <thead><tr><th>Month</th><th class="num">Working days</th><th class="num">Present</th><th class="num">Absent</th><th class="num">Late</th><th class="num">Leave</th><th>Attendance</th></tr></thead>
    <tbody>${months.map((m) => html`<tr><td class="strong">${MONTH_NAMES[m.month - 1]}</td><td class="num">${m.totalDays}</td>
      <td class="num strong" style="color:var(--leaf)">${m.present}</td><td class="num strong" style="color:var(--red)">${m.absent}</td>
      <td class="num strong" style="color:var(--amber)">${m.late}</td><td class="num strong" style="color:var(--royal)">${m.leave}</td><td>${bar(m.percentage)}</td></tr>`)}</tbody></table></div></section>`;

  async function generate() {
    const mode = form.elements.mode.value;
    const params = { teacher: form.elements.teacher.value };
    if (mode === 'month') params.month = form.elements.month.value;
    else if (mode === 'year') {
      params.year = form.elements.year.value;
      if (!/^\d{4}$/.test(params.year) || params.year < 2000 || params.year > 2100) return toast.error('Enter a valid year, for example 2026.');
    } else { params.from = form.elements.from.value; params.to = form.elements.to.value; }
    if (params.from && params.to && params.from > params.to) return toast.error('The start date must be before the end date.');

    const btn = $('#generate', root);
    setLoading(btn, true);
    exportBtn.disabled = true;
    if (!report) mount(out, tableSkeleton(5, 6)); else out.classList.add('fade');
    try {
      report = await get(mode === 'year' ? '/reports/yearly' : '/reports/attendance', params);
      report.mode = mode;
      if (mode === 'year') {
        report.label = `Year ${params.year}`;
        report.file = `attendance-yearly-${params.year}`;
      } else {
        report.label = mode === 'month' ? monthLabel(params.month) : periodText(report.period);
        report.file = `attendance-report-${mode === 'month' ? params.month : `${params.from || 'start'}-to-${params.to || 'today'}`}`;
      }
    } catch (error) {
      report = null;
      mount(out, html`<div class="card">${errorState(errMsg(error, 'Unable to generate the report. Please try again.'))}</div>`);
      $('[data-retry]', out).addEventListener('click', generate);
      setLoading(btn, false);
      return;
    }
    setLoading(btn, false);
    out.classList.remove('fade');

    if (!hasData(report)) {
      mount(out, html`<div class="card">${emptyState({ icon: 'chart-column', title: 'No reports available.', text: 'There are no attendance records for this selection. Try another month, year or date range.' })}</div>`);
      return;
    }
    exportBtn.disabled = false;
    mount(out, html`<div class="stack">
      <section class="card"><div class="card-head"><h2>Summary</h2><span class="dim" style="font-size:14px">${report.label}</span></div><div class="card-body">${statsSummary(report.totals)}</div></section>
      ${mode === 'year' ? monthCard(report.months) : ''}
      ${teacherCard(mode === 'year' ? 'By teacher (whole year)' : 'By teacher', mode === 'year' ? report.teachers : report.rows)}</div>`);
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); generate(); });

  // Export menu
  const toggleMenu = (open) => { exportList.classList.toggle('hidden', !open); exportBtn.setAttribute('aria-expanded', String(open)); };
  exportBtn.addEventListener('click', () => toggleMenu(exportList.classList.contains('hidden')));
  const outside = (e) => { if (!root.isConnected) return document.removeEventListener('mousedown', outside); if (!e.target.closest('#export-menu')) toggleMenu(false); };
  document.addEventListener('mousedown', outside);
  $$('[data-export]', root).forEach((b) => b.addEventListener('click', async () => {
    toggleMenu(false);
    if (!report || !hasData(report)) return;
    try {
      const yearly = report.mode === 'year';
      if (b.dataset.export === 'csv') (yearly ? exportYearlyCsv : exportCsv)(report, `${report.file}.csv`);
      else await (yearly ? exportYearlyPdf : exportPdf)(report, `${report.file}.pdf`);
      toast.success('Report exported successfully.');
    } catch {
      toast.error('Unable to export the report. Please try again.');
    }
  }));

  await generate();
}
