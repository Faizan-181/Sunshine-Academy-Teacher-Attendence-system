import { html, mount, ic, emptyState, errorState, tableSkeleton, pageHead, field, select, input, statsSummary, bar, toast, setLoading, $, $$ } from '../ui.js';
import { get, errMsg } from '../api.js';
import { currentMonth, monthLabel, MONTH_NAMES } from '../format.js';
import { state } from '../state.js';
import { exportCsv, exportPdf, exportYearlyCsv, exportYearlyPdf, periodText, downloadRowsCsv } from '../export.js';

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

  const academyToday = () => state.today || new Date().toISOString().slice(0, 10);
  const dateFromParts = (year, month, day) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const shiftDate = (iso, days) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const dayLabel = (iso) => new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
  const dailyRange = (mode, params) => {
    const today = academyToday();
    let from, to;
    if (mode === 'month') {
      const [year, month] = params.month.split('-').map(Number);
      from = `${params.month}-01`;
      to = dateFromParts(year, month, new Date(Date.UTC(year, month, 0)).getUTCDate());
    } else if (mode === 'year') {
      from = `${params.year}-01-01`;
      to = `${params.year}-12-31`;
    } else {
      from = params.from;
      to = params.to || today;
    }
    if (!from) return { error: 'Choose a From date to see the teacher’s daily report.' };
    if (to > today) to = today;
    if (from > to) return { dates: [] };
    const count = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1;
    if (count > 366) return { error: 'Choose a date range of 366 days or less for the daily report.' };
    return { dates: Array.from({ length: count }, (_, i) => shiftDate(from, i)) };
  };

  async function dailyTeacherReport(mode, params) {
    if (!params.teacher) return html`<section class="card"><div class="card-body"><p class="muted">Select one teacher to see their date-wise attendance report.</p></div></section>`;
    const range = dailyRange(mode, params);
    if (range.error) return html`<section class="card"><div class="card-body"><p class="muted">${range.error}</p></div></section>`;
    if (!range.dates.length) return html`<section class="card"><div class="card-body"><p class="muted">There are no dates in this period up to today.</p></div></section>`;

    const result = await get('/reports/teacher-daily', { teacher: params.teacher, from: range.dates[0], to: range.dates.at(-1) });
    const rows = result.data.map((row) => ({
      ...row,
      weekday: dayLabel(row.date),
      statusText: row.status === 'late' ? 'Late (present)' : row.status === 'weekly_off' ? 'Weekly off'
        : row.status === 'approved_leave' ? 'Approved leave' : row.status === 'not_marked' ? 'Not marked'
          : row.status[0].toUpperCase() + row.status.slice(1),
    }));
    const teacherName = form.elements.teacher.selectedOptions[0]?.textContent || 'Selected teacher';
    return html`<section class="card"><div class="card-head"><div><h2>Date-wise attendance</h2><span class="dim" style="font-size:14px">${teacherName}</span></div>
        <button type="button" class="btn btn-secondary btn-sm" id="daily-export">${ic('file-spreadsheet', 16)} Download CSV</button></div>
      <div class="table-scroll"><table class="table w760"><thead><tr><th>Date</th><th>Day</th><th>Status</th><th>Check in</th><th>Check out</th><th>Remarks</th></tr></thead>
        <tbody>${rows.map((row) => html`<tr><td data-label="Date" class="nowrap strong">${row.date}</td><td data-label="Day">${row.weekday}</td><td data-label="Status" class="strong">${row.statusText}</td>
          <td data-label="Check in" class="nowrap">${row.check_in || '—'}</td><td data-label="Check out" class="nowrap">${row.check_out || '—'}</td><td data-label="Remarks" class="dim">${row.remarks || '—'}</td></tr>`)}</tbody></table></div></section>`;
  }

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
    <thead><tr><th>Teacher ID</th><th>Teacher</th><th>Subject</th><th class="num">Working days</th><th class="num">Present (incl. late)</th><th class="num">Absent</th><th class="num">Late*</th><th class="num">Leave</th><th>Attendance</th></tr></thead>
    <tbody>${rows.map((r) => html`<tr><td data-label="Teacher ID" class="dim">${r.teacher.teacher_id}</td><td data-label="Teacher" class="strong">${r.teacher.name}</td><td data-label="Subject">${r.teacher.subject}</td>
      <td data-label="Working days" class="num">${r.totalDays}</td><td data-label="Present (incl. late)" class="num strong" style="color:var(--leaf)">${r.present}</td><td data-label="Absent" class="num strong" style="color:var(--red)">${r.absent}</td>
      <td data-label="Late*" class="num strong" style="color:var(--amber)">${r.late}</td><td data-label="Leave" class="num strong" style="color:var(--royal)">${r.leave}</td><td data-label="Attendance">${bar(r.percentage)}</td></tr>`)}</tbody></table></div></section>`;

  const monthCard = (months) => html`<section class="card"><div class="card-head"><h2>By month</h2></div><div class="table-scroll"><table class="table w760">
    <thead><tr><th>Month</th><th class="num">Working days</th><th class="num">Present (incl. late)</th><th class="num">Absent</th><th class="num">Late*</th><th class="num">Leave</th><th>Attendance</th></tr></thead>
    <tbody>${months.map((m) => html`<tr><td data-label="Month" class="strong">${MONTH_NAMES[m.month - 1]}</td><td data-label="Working days" class="num">${m.totalDays}</td>
      <td data-label="Present (incl. late)" class="num strong" style="color:var(--leaf)">${m.present}</td><td data-label="Absent" class="num strong" style="color:var(--red)">${m.absent}</td>
      <td data-label="Late*" class="num strong" style="color:var(--amber)">${m.late}</td><td data-label="Leave" class="num strong" style="color:var(--royal)">${m.leave}</td><td data-label="Attendance">${bar(m.percentage)}</td></tr>`)}</tbody></table></div></section>`;

  async function generate() {
    const mode = form.elements.mode.value;
    const params = { teacher: form.elements.teacher.value };
    if (mode === 'month') {
      params.month = form.elements.month.value;
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(params.month)) return toast.error('Choose a valid month.');
    }
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

    if (!hasData(report) && !params.teacher) {
      mount(out, html`<div class="card">${emptyState({ icon: 'chart-column', title: 'No reports available.', text: 'There are no attendance records for this selection. Try another month, year or date range.' })}</div>`);
      return;
    }
    exportBtn.disabled = false;
    const detailRows = mode === 'year' ? report.teachers : report.rows;
    mount(out, html`<div class="stack">
      <section class="card"><div class="card-head"><h2>Summary</h2><span class="dim" style="font-size:14px">${report.label}</span></div><div class="card-body">${statsSummary(report.totals)}</div></section>
      ${mode === 'year' ? monthCard(report.months) : ''}
      ${detailRows.length ? teacherCard(mode === 'year' ? 'By teacher (whole year)' : 'By teacher', detailRows) : ''}
      ${params.teacher ? html`<div id="daily-report"></div>` : ''}
      <p class="hint">* Late is included in Present.</p></div>`);
    if (params.teacher) {
      const dailyBox = $('#daily-report', out);
      try {
        mount(dailyBox, await dailyTeacherReport(mode, params));
        const dailyExport = $('#daily-export', dailyBox);
        if (dailyExport) dailyExport.addEventListener('click', () => {
          const rows = [...dailyBox.querySelectorAll('tbody tr')].map((tr) => [...tr.cells].map((cell) => cell.textContent.trim()));
          downloadRowsCsv(['Date', 'Day', 'Status', 'Check in', 'Check out', 'Remarks'], rows, `teacher-attendance-${params.teacher}-${report.file}-daily.csv`);
          toast.success('Daily report exported successfully.');
        });
      } catch (error) {
        mount(dailyBox, html`<section class="card">${errorState(errMsg(error, 'Unable to load this teacher’s date-wise report.'))}</section>`);
      }
    }
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
