import { html, mount, ic, emptyState, errorState, tableSkeleton, pageHead, toast, setLoading, $, $$ } from '../ui.js';
import { get, post, errMsg } from '../api.js';
import { formatLongDate } from '../format.js';
import { state } from '../state.js';
import { STATUS_OPTIONS } from '../components.js';

const row = (r) => {
  const t = r.teacher;
  const off = !r.status || r.status === 'absent' || r.status === 'leave';
  return html`<li class="sheet-row" data-id="${t.id}" data-status="${r.status}" data-search="${`${t.name} ${t.teacher_id} ${t.subject}`.toLowerCase()}">
    <div><p class="sheet-name">${t.name}</p><p class="sheet-meta"><b>${t.teacher_id}</b> · ${t.subject}</p></div>
    <div class="picker" role="radiogroup" aria-label="Attendance status for ${t.name}">${STATUS_OPTIONS.map((o) =>
      html`<button type="button" class="pick s-${o.value}" role="radio" aria-checked="${r.status === o.value}" data-value="${o.value}">${o.label}</button>`)}</div>
    <div class="time-pair">
      <label><small>Check in</small><input class="input" type="time" data-f="check_in" value="${r.check_in}" ${off ? 'disabled' : ''} aria-label="Check in for ${t.name}"></label>
      <label><small>Check out</small><input class="input" type="time" data-f="check_out" value="${r.check_out}" ${off ? 'disabled' : ''} aria-label="Check out for ${t.name}"></label>
    </div>
    <input class="input" data-f="remarks" maxlength="200" value="${r.remarks}" placeholder="Remarks (optional)" aria-label="Remarks for ${t.name}">
  </li>`;
};

export default async function markAttendance({ root }) {
  mount(root, html`${pageHead("Mark Today's Attendance", 'Loading date…', html`
      <label class="sr-only" for="sheet-date">Attendance date</label>
      <input class="input" type="date" id="sheet-date" style="width:auto" aria-label="Attendance date">
      <button type="button" class="btn btn-secondary" id="all-present" disabled>${ic('check-check', 16)} Mark all present</button>
      <button type="button" class="btn btn-primary" id="save-top" disabled>${ic('save', 16)} Save Attendance</button>`)}
    <section class="card" id="sheet">${tableSkeleton(6, 5)}</section>`);
  const sheet = $('#sheet', root);
  let date = '';

  const dateInput = $('#sheet-date', root);
  if (state.today) dateInput.max = state.today; // no future dates (the database refuses them too)

  // Loads the sheet for one date. With no argument it is today by the academy clock (server date).
  async function load(requested) {
    mount(sheet, tableSkeleton(6, 5));
    $('#all-present', root).disabled = true;
    $('#save-top', root).disabled = true;
    let data;
    try {
      data = await get('/attendance/today', requested ? { date: requested } : {});
    } catch (error) {
      mount(sheet, errorState(errMsg(error, 'Unable to load teachers. Please try again.')));
      $('[data-retry]', sheet).addEventListener('click', () => load(requested));
      return;
    }
    date = data.date;
    dateInput.value = date;
    if (!state.today) dateInput.max = date;
    const isToday = !state.today || date === state.today;
    $('.page-head h1', root).textContent = isToday ? "Mark Today's Attendance" : 'Mark Attendance';
    $('.page-head p', root).textContent = `Date: ${formatLongDate(date)}${isToday ? '' : ' (past date)'}`;

    if (!data.data.length) {
      mount(sheet, emptyState({ icon: 'clipboard-list', title: 'No active teachers found.', text: 'Add a teacher, or activate an inactive one, to start marking attendance.' }));
      return;
    }
    const rows = data.data.map(({ teacher, attendance: a }) => ({ teacher, status: a?.status || '', check_in: a?.check_in || '', check_out: a?.check_out || '', remarks: a?.remarks || '' }));

    mount(sheet, html`
      <div class="toolbar"><div class="search" style="min-width:280px">${ic('search', 16)}<input class="input" id="filter" type="search" placeholder="Search teachers" aria-label="Search teachers" autocomplete="off"></div><p class="counts" id="counts"></p></div>
      <div class="sheet-head"><span>Teacher</span><span>Status</span><span>Check In</span><span>Check Out</span><span>Remarks</span></div>
      <ul id="rows">${rows.map(row)}</ul>
      <div id="none" class="hidden">${emptyState({ icon: 'search', title: 'No teachers found.', text: 'Try a different search.' })}</div>
      <div style="display:flex;justify-content:flex-end;padding:16px;border-top:1px solid var(--line)"><button type="button" class="btn btn-primary" id="save-bottom">${ic('save', 16)} Save Attendance</button></div>`);

    const list = $('#rows', sheet);
    const items = $$('.sheet-row', list);

    function updateCounts() {
      const c = { present: 0, absent: 0, late: 0, leave: 0, none: 0 };
      items.forEach((li) => { c[li.dataset.status || 'none'] += 1; });
      $('#counts', sheet).innerHTML = `<span style="color:var(--leaf)">${c.present} present</span> · <span style="color:var(--red)">${c.absent} absent</span> · <span style="color:var(--amber)">${c.late} late</span> · <span style="color:var(--royal)">${c.leave} leave</span> · ${c.none} not marked`;
    }

    function setStatus(li, status) {
      li.dataset.status = status;
      $$('.pick', li).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === status)));
      const off = status === 'absent' || status === 'leave';
      ['check_in', 'check_out'].forEach((f) => {
        const inp = $(`[data-f="${f}"]`, li);
        inp.disabled = off;
        if (off) inp.value = ''; // absent and leave days have no times
      });
      updateCounts();
    }

    list.addEventListener('click', (e) => {
      const pick = e.target.closest('.pick');
      if (pick) setStatus(pick.closest('.sheet-row'), pick.dataset.value);
    });
    $('#filter', sheet).addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      let shown = 0;
      items.forEach((li) => { const ok = !q || li.dataset.search.includes(q); li.classList.toggle('hidden', !ok); if (ok) shown += 1; });
      $('#none', sheet).classList.toggle('hidden', shown > 0);
    });

    const allPresent = $('#all-present', root);
    allPresent.disabled = false;
    allPresent.onclick = () => items.forEach((li) => { if (!li.dataset.status) setStatus(li, 'present'); });

    async function save(button) {
      const records = items.filter((li) => li.dataset.status).map((li) => ({
        teacher: li.dataset.id, status: li.dataset.status,
        check_in: $('[data-f="check_in"]', li).value, check_out: $('[data-f="check_out"]', li).value, remarks: $('[data-f="remarks"]', li).value,
      }));
      if (!records.length) return toast.error('Choose a status for at least one teacher before saving.');
      const bad = records.findIndex((r) => r.check_in && r.check_out && r.check_out <= r.check_in);
      if (bad >= 0) return toast.error(`Check-out must be after check-in for ${rows.find((r) => String(r.teacher.id) === records[bad].teacher).teacher.name}.`);

      const buttons = [$('#save-top', root), $('#save-bottom', sheet)];
      buttons.forEach((b) => setLoading(b, true));
      try {
        const r = await post('/attendance/bulk', { date, records });
        toast.success(r.message);
      } catch (error) {
        toast.error(errMsg(error, 'Unable to save attendance. Please try again.'));
      } finally {
        buttons.forEach((b) => setLoading(b, false));
      }
    }
    const top = $('#save-top', root);
    top.disabled = false;
    top.onclick = () => save(top);
    $('#save-bottom', sheet).onclick = (e) => save(e.currentTarget);
    updateCounts();
  }
  dateInput.addEventListener('change', () => { if (dateInput.value) load(dateInput.value); });
  await load();
}
