import { html, mount, ic, pageHead, field, input, select, showFieldErrors, setLoading, toast, $ } from '../ui.js';
import { get, put, errMsg } from '../api.js';
import { state } from '../state.js';
import { formatTime } from '../format.js';
import { downloadRowsCsv } from '../export.js';
import { passwordCard, bindPasswordCard } from '../password-card.js';

const ATT_HEAD = ['Teacher ID', 'Teacher', 'Subject', 'Date', 'Check in', 'Check out', 'Status', 'Late minutes', 'Remarks'];
const TEACHER_HEAD = ['Teacher ID', 'Name', 'Email', 'Phone', 'Subject', 'Date of birth', 'Joining date', 'Address', 'Status'];

const daysSince = (iso) => Math.floor((new Date(state.today || Date.now()) - new Date(iso)) / 86400000);

function lastBackupText() {
  const last = localStorage.getItem('sunshine_last_backup');
  if (!last) return { text: 'No backup has been downloaded on this computer yet.', warn: true };
  const d = daysSince(last);
  return { text: `Last download on this computer: ${last} (${d <= 0 ? 'today' : d + ' day' + (d === 1 ? '' : 's') + ' ago'}).`, warn: d > 7 };
}

const backupCard = () => {
  const year = Number((state.today || new Date().toISOString()).slice(0, 4));
  const years = Array.from({ length: 8 }, (_, i) => year - i);
  return html`<section class="card"><div class="card-head"><h2>Backup &amp; archive</h2></div><div class="card-body" style="max-width:640px">
    <p class="muted" style="font-size:14px;margin-bottom:14px">Attendance is permanent: nothing is ever deleted automatically, and older months and years stay available in History and Reports.
      Still, download a copy regularly and keep it <b>somewhere else</b> (a USB drive or cloud storage), not only on this computer.</p>
    <div class="form-grid">${field({ name: 'backup_year', label: 'Attendance to download', control: select({ name: 'backup_year', options: [{ value: '', label: 'All years (complete history)' }, ...years.map((y) => ({ value: y, label: String(y) }))] }) })}</div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:14px">
      <button type="button" class="btn btn-secondary" id="bk-att">${ic('file-spreadsheet', 16)} Download attendance (CSV)</button>
      <button type="button" class="btn btn-secondary" id="bk-teach">${ic('file-spreadsheet', 16)} Download teachers (CSV)</button>
    </div>
    <p class="hint" id="bk-last" style="margin-top:12px"></p></div></section>`;
};

function bindBackup(root) {
  const note = $('#bk-last', root);
  const showLast = () => {
    const { text, warn } = lastBackupText();
    note.textContent = text;
    note.style.color = warn ? 'var(--amber)' : '';
    note.style.fontWeight = warn ? '700' : '';
  };
  showLast();
  const done = () => { localStorage.setItem('sunshine_last_backup', state.today || new Date().toISOString().slice(0, 10)); showLast(); };

  $('#bk-att', root).addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const year = $('#backup_year', root).value;
    setLoading(btn, true);
    try {
      const range = year ? { from: `${year}-01-01`, to: `${year}-12-31` } : {};
      const rows = [];
      let after = 0;
      for (;;) { // fetched in pages, so even many years of history works
        const { data } = await get('/export/attendance', { after, ...range });
        rows.push(...data);
        if (data.length < 1000) break;
        after = data[data.length - 1].id;
      }
      downloadRowsCsv(ATT_HEAD, rows.map((r) => [r.teacher_id, r.teacher_name, r.subject, r.date, r.check_in, r.check_out, r.status, r.late_minutes, r.remarks]),
        `sunshine-attendance-${year || 'all-years'}-${state.today || 'backup'}.csv`);
      toast.success(`Downloaded ${rows.length} attendance records.`);
      done();
    } catch (error) {
      toast.error(errMsg(error, 'Unable to download the backup. Please try again.'));
    } finally {
      setLoading(btn, false);
    }
  });

  $('#bk-teach', root).addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    setLoading(btn, true);
    try {
      const { data } = await get('/export/teachers');
      downloadRowsCsv(TEACHER_HEAD, data.map((t) => [t.teacher_id, t.name, t.email, t.phone, t.subject, t.date_of_birth, t.joining_date, t.address, t.status]),
        `sunshine-teachers-${state.today || 'backup'}.csv`);
      toast.success(`Downloaded ${data.length} teachers.`);
      done();
    } catch (error) {
      toast.error(errMsg(error, 'Unable to download the backup. Please try again.'));
    } finally {
      setLoading(btn, false);
    }
  });
}

export default async function settings({ root }) {
  let rules = null;
  try {
    rules = (await get('/settings')).data;
  } catch {
    rules = { startTime: '08:00', graceMinutes: 15, selfCheckin: true, lateAfter: '08:15' };
    toast.error('Unable to load the attendance rules. Showing the defaults.');
  }

  mount(root, html`${pageHead('Settings', 'Attendance rules, backups and sign-in security.')}
    <div class="stack">
    <section class="card"><div class="card-head"><h2>Attendance rules</h2></div><div class="card-body">
      <form id="rules-form" novalidate style="max-width:560px;display:flex;flex-direction:column;gap:16px">
        <label class="check" style="align-items:flex-start"><input type="checkbox" name="selfCheckin" ${rules.selfCheckin ? 'checked' : ''} style="margin-top:3px">
          <span>Let teachers check themselves in and out<br><span class="hint">When on, each teacher sees <b>Check In</b> and <b>Check Out</b> buttons on their dashboard. The time is recorded by the server and teachers cannot change it. You can still edit any record.</span></span></label>
        <div class="form-grid">
          ${field({ name: 'startTime', label: 'School start time', required: true, control: input({ name: 'startTime', type: 'time', value: rules.startTime }) })}
          ${field({ name: 'graceMinutes', label: 'Grace period (minutes)', required: true, hint: 'Teachers who check in within this time after the start are still Present.', control: input({ name: 'graceMinutes', type: 'number', value: rules.graceMinutes, extra: 'min="0" max="120" step="1" inputmode="numeric"' }) })}
        </div>
        <p class="muted" id="late-hint" style="font-size:14px"></p>
        <div><button type="submit" class="btn btn-primary" id="rules-btn">${ic('save', 16)} Save rules</button></div>
      </form></div></section>
    ${backupCard()}
    ${passwordCard()}</div>`);

  // Attendance rules form
  const rulesForm = $('#rules-form', root);
  const lateHint = $('#late-hint', root);
  const updateHint = () => {
    const [h, m] = (rulesForm.elements.startTime.value || '08:00').split(':').map(Number);
    const total = Math.min(h * 60 + m + (Number(rulesForm.elements.graceMinutes.value) || 0), 23 * 60 + 59);
    const after = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    lateHint.innerHTML = '';
    lateHint.textContent = `Checking in after ${formatTime(after)} will be marked Late.`;
  };
  rulesForm.addEventListener('input', updateHint);
  updateHint();

  rulesForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const grace = Number(rulesForm.elements.graceMinutes.value);
    const errors = {};
    if (!rulesForm.elements.startTime.value) errors.startTime = 'Choose the time school starts.';
    if (!Number.isInteger(grace) || grace < 0 || grace > 120) errors.graceMinutes = 'Enter a whole number of minutes (0–120).';
    showFieldErrors(rulesForm, errors);
    if (Object.keys(errors).length) return;

    const btn = $('#rules-btn', root);
    setLoading(btn, true);
    try {
      const data = await put('/settings', { startTime: rulesForm.elements.startTime.value, graceMinutes: grace, selfCheckin: rulesForm.elements.selfCheckin.checked });
      toast.success(data.message);
    } catch (error) {
      showFieldErrors(rulesForm, error.errors || {});
      toast.error(errMsg(error, 'Unable to save the settings. Please try again.'));
    } finally {
      setLoading(btn, false);
    }
  });

  bindBackup(root);
  bindPasswordCard(root);
}
