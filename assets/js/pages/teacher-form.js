import { html, mount, ic, pageHead, field, input, select, textarea, passwordControl, bindPasswordToggles, showFieldErrors, formValues, setLoading, toast, errorState, loading, $ } from '../ui.js';
import { get, post, put, errMsg } from '../api.js';

// The same rules the server uses, so people get instant feedback.
function validate(v, isEdit) {
  const e = {};
  if (!/^[A-Za-z0-9-]{2,20}$/.test(v.teacher_id.trim())) e.teacher_id = 'Use letters, numbers and dashes only (2–20 characters).';
  if (v.name.trim().length < 2) e.name = 'Enter the full name.';
  if (!/^\S+@\S+\.\S+$/.test(v.email.trim())) e.email = 'Enter a valid email address.';
  if (!/^[0-9+\-\s()]{7,20}$/.test(v.phone.trim())) e.phone = 'Enter a valid phone number.';
  if (v.subject.trim().length < 2) e.subject = 'Enter the subject.';
  if (!v.joining_date) e.joining_date = 'Choose the joining date.';
  if (v.date_of_birth && v.joining_date && v.date_of_birth >= v.joining_date) e.date_of_birth = 'Date of birth must be before the joining date.';
  if (!isEdit && v.password.length < 8) e.password = 'Password must be at least 8 characters.';
  return e;
}

export default async function teacherForm({ root, params }) {
  const isEdit = Boolean(params.id);
  let t = { teacher_id: '', name: '', email: '', phone: '', subject: '', date_of_birth: '', joining_date: '', address: '', status: 'active' };

  if (isEdit) {
    mount(root, loading('Loading teacher…'));
    try {
      t = (await get(`/teachers/${params.id}`)).data;
    } catch (error) {
      mount(root, html`<div class="card">${errorState(errMsg(error, 'Unable to load this teacher. Please try again.'))}</div>`);
      $('[data-retry]', root).addEventListener('click', () => location.reload());
      return;
    }
  }

  mount(root, html`
    ${pageHead(isEdit ? 'Edit Teacher' : 'Add Teacher', html`Fields marked <b class="req">*</b> are required.`, html`<a class="btn btn-secondary" href="#/teachers">${ic('arrow-left', 16)} Back to teachers</a>`)}
    <form id="teacher-form" class="stack" novalidate>
      <section class="card"><div class="card-head"><h2>Teacher details</h2></div><div class="card-body form-grid">
        ${field({ name: 'teacher_id', label: 'Teacher ID', required: true, control: input({ name: 'teacher_id', value: t.teacher_id, placeholder: 'e.g. T-001' }) })}
        ${field({ name: 'name', label: 'Full name', required: true, control: input({ name: 'name', value: t.name, placeholder: 'e.g. Ayesha Khan' }) })}
        ${field({ name: 'email', label: 'Email', required: true, hint: isEdit ? 'This is the teacher\'s login, so it cannot be changed here.' : 'The teacher signs in with this email address.', control: input({ name: 'email', type: 'email', value: t.email, placeholder: 'name@example.com', extra: isEdit ? 'readonly' : '' }) })}
        ${field({ name: 'phone', label: 'Phone number', required: true, control: input({ name: 'phone', type: 'tel', value: t.phone, placeholder: 'e.g. 0300 1234567' }) })}
        ${field({ name: 'subject', label: 'Subject', required: true, control: input({ name: 'subject', value: t.subject, placeholder: 'e.g. Mathematics' }) })}
        ${field({ name: 'joining_date', label: 'Joining date', required: true, control: input({ name: 'joining_date', type: 'date', value: t.joining_date }) })}
        ${field({ name: 'date_of_birth', label: 'Date of birth', control: input({ name: 'date_of_birth', type: 'date', value: t.date_of_birth }) })}
        ${field({ name: 'status', label: 'Status', required: true, control: select({ name: 'status', value: t.status, options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, ...(t.status === 'pending' ? [{ value: 'pending', label: 'Pending approval' }] : [])] }) })}
        ${field({ name: 'address', label: 'Address', span: true, control: textarea({ name: 'address', value: t.address, placeholder: 'Street, city' }) })}
      </div></section>
      <section class="card"><div class="card-head"><h2>Sign-in details</h2></div><div class="card-body form-grid">
        ${isEdit
          ? html`<div class="span-2"><p class="muted" style="font-size:14px;margin-bottom:12px">${t.name} signs in with <b>${t.email}</b>. To give them a new password, send a password reset email.</p>
              <button type="button" class="btn btn-secondary" id="send-reset">${ic('mail', 16)} Send password reset email</button></div>`
          : field({ name: 'password', label: 'Password', required: true, hint: 'At least 8 characters.', control: passwordControl({ name: 'password' }) })}
      </div></section>
      <div class="form-actions"><a class="btn btn-secondary" href="#/teachers">Cancel</a><button type="submit" class="btn btn-primary" id="save-btn">${ic('save', 16)} ${isEdit ? 'Save changes' : 'Add teacher'}</button></div>
    </form>`);

  const form = $('#teacher-form', root);
  bindPasswordToggles(root);
  if (!isEdit) form.elements.teacher_id.focus();

  $('#send-reset', root)?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    setLoading(btn, true);
    try {
      await post('/auth/forgot-password', { email: t.email });
      toast.success(`If email delivery is set up in Supabase, a reset link is on its way to ${t.email}.`);
    } catch (error) {
      toast.error(errMsg(error, 'Unable to send the reset email. Please try again.'));
    } finally {
      setLoading(btn, false);
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const values = formValues(form);
    const errors = validate(values, isEdit);
    showFieldErrors(form, errors);
    if (Object.keys(errors).length) return;

    const button = $('#save-btn', root);
    setLoading(button, true);
    try {
      const data = isEdit ? await put(`/teachers/${params.id}`, values) : await post('/teachers', values);
      toast.success(data.message);
      location.hash = '#/teachers';
    } catch (error) {
      showFieldErrors(form, error.errors || {});
      toast.error(errMsg(error, isEdit ? 'Unable to update the teacher. Please try again.' : 'Unable to add the teacher. Please try again.'));
      setLoading(button, false);
    }
  });
}
