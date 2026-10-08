import { html, mount, pageHead, field, input, avatar, showFieldErrors, setLoading, toast, ic, $ } from '../ui.js';
import { patch, errMsg } from '../api.js';
import { state } from '../state.js';
import { renderTeacherProfile } from './teacher-profile.js';

// Teachers see their teacher profile; admins see their account.
export default async function profile(ctx) {
  if (state.user.role !== 'admin') return renderTeacherProfile(ctx, true);

  const { root } = ctx;
  const u = state.user;
  mount(root, html`${pageHead('Profile', 'Your administrator account.')}
    <section class="card"><div class="card-body">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:24px">${avatar(u.name, 'xl')}<div><p class="strong" style="font-size:20px">${u.name}</p><p class="dim">Administrator</p></div></div>
      <form id="profile-form" class="form-grid" style="max-width:640px" novalidate>
        ${field({ name: 'name', label: 'Full name', required: true, control: input({ name: 'name', value: u.name }) })}
        ${field({ name: 'email', label: 'Email', control: input({ name: 'email', value: u.email, extra: 'disabled' }) })}
        <div class="span-2"><button type="submit" class="btn btn-primary" id="save-btn">${ic('save', 16)} Save changes</button></div>
      </form></div></section>`);

  const form = $('#profile-form', root);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = form.elements.name.value.trim();
    if (name.length < 2) return showFieldErrors(form, { name: 'Enter your full name.' });
    showFieldErrors(form, {});
    const button = $('#save-btn', root);
    setLoading(button, true);
    try {
      const data = await patch('/auth/me', { name });
      state.user = data.user;
      toast.success(data.message);
      location.reload();
    } catch (error) {
      showFieldErrors(form, error.errors || {});
      toast.error(errMsg(error, 'Unable to update your profile. Please try again.'));
      setLoading(button, false);
    }
  });
}
