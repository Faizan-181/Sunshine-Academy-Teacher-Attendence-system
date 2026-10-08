import { html, ic, field, passwordControl, bindPasswordToggles, showFieldErrors, formValues, setLoading, toast, $ } from './ui.js';
import { post, errMsg } from './api.js';

/** The "Change password" card (admin Settings and the teacher's My Profile share it). Passwords are handled by Supabase Auth. */
export const passwordCard = () => html`
  <section class="card"><div class="card-head"><h2>Change password</h2></div><div class="card-body">
    <form id="pw-form" novalidate style="max-width:448px;display:flex;flex-direction:column;gap:16px">
      ${field({ name: 'currentPassword', label: 'Current password', required: true, control: passwordControl({ name: 'currentPassword', autocomplete: 'current-password' }) })}
      ${field({ name: 'newPassword', label: 'New password', required: true, hint: 'At least 8 characters.', control: passwordControl({ name: 'newPassword' }) })}
      ${field({ name: 'confirmPassword', label: 'Confirm new password', required: true, control: passwordControl({ name: 'confirmPassword' }) })}
      <div><button type="submit" class="btn btn-primary" id="pw-btn">${ic('key-round', 16)} Change password</button></div>
    </form></div></section>`;

export function bindPasswordCard(root) {
  const form = $('#pw-form', root);
  bindPasswordToggles(root);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = formValues(form);
    const errors = {};
    if (!v.currentPassword) errors.currentPassword = 'Enter your current password.';
    if (v.newPassword.length < 8) errors.newPassword = 'New password must be at least 8 characters.';
    else if (v.newPassword === v.currentPassword) errors.newPassword = 'Choose a password different from the current one.';
    if (v.confirmPassword !== v.newPassword) errors.confirmPassword = 'The passwords do not match.';
    showFieldErrors(form, errors);
    if (Object.keys(errors).length) return;

    const btn = $('#pw-btn', root);
    setLoading(btn, true);
    try {
      const data = await post('/auth/change-password', { currentPassword: v.currentPassword, newPassword: v.newPassword });
      toast.success(data.message);
      form.reset();
    } catch (error) {
      showFieldErrors(form, error.errors || {});
      toast.error(errMsg(error, 'Unable to change your password. Please try again.'));
    } finally {
      setLoading(btn, false);
    }
  });
}
