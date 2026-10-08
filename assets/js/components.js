import { html, openModal, toast, setLoading, field, select, input, textarea, showFieldErrors } from './ui.js';
import { put, errMsg } from './api.js';
import { formatDate } from './format.js';

export const STATUS_OPTIONS = [
  { value: 'present', label: 'Present' },
  { value: 'absent', label: 'Absent' },
  { value: 'late', label: 'Late' },
  { value: 'leave', label: 'Leave' },
];

/** Lets the admin correct a single attendance record. */
export function attendanceEditModal(record, onSaved) {
  const modal = openModal({
    title: 'Edit attendance',
    body: html`<p style="background:var(--surface);border-radius:12px;padding:12px 16px;margin-bottom:16px;font-size:14px">
        <b class="strong">${record.teacher?.name}</b><span class="muted"> · ${record.teacher?.teacher_id} · ${formatDate(record.date)}</span></p>
      <form id="edit-form" novalidate class="form-grid">
        ${field({ name: 'status', label: 'Status', required: true, span: true, control: select({ name: 'status', value: record.status, options: STATUS_OPTIONS }) })}
        ${field({ name: 'check_in', label: 'Check in', control: input({ name: 'check_in', type: 'time', value: record.check_in }) })}
        ${field({ name: 'check_out', label: 'Check out', control: input({ name: 'check_out', type: 'time', value: record.check_out }) })}
        ${field({ name: 'remarks', label: 'Remarks', span: true, control: textarea({ name: 'remarks', value: record.remarks, placeholder: 'Optional note' }) })}
      </form>`,
    footer: html`<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="button" class="btn btn-primary" id="edit-save">Save changes</button>`,
  });

  const form = modal.el.querySelector('#edit-form');
  const statusEl = form.elements.status;
  const syncTimes = () => {
    const off = statusEl.value === 'absent' || statusEl.value === 'leave';
    for (const name of ['check_in', 'check_out']) {
      form.elements[name].disabled = off;
      if (off) form.elements[name].value = '';
    }
  };
  statusEl.addEventListener('change', syncTimes);
  syncTimes();

  const saveBtn = modal.el.querySelector('#edit-save');
  saveBtn.addEventListener('click', async () => {
    const body = { status: statusEl.value, check_in: form.elements.check_in.value, check_out: form.elements.check_out.value, remarks: form.elements.remarks.value };
    if (body.check_in && body.check_out && body.check_out <= body.check_in) {
      showFieldErrors(form, { check_out: 'Check-out must be after check-in.' });
      return;
    }
    showFieldErrors(form, {});
    setLoading(saveBtn, true);
    try {
      const data = await put(`/attendance/${record.id}`, body);
      toast.success(data.message);
      modal.close();
      onSaved(data.data);
    } catch (error) {
      showFieldErrors(form, error.errors || {});
      toast.error(errMsg(error, 'Unable to update attendance. Please try again.'));
      setLoading(saveBtn, false);
    }
  });
}
