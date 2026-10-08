import { html, mount, ic, setLoading, showFieldErrors, field, passwordControl, bindPasswordToggles, formValues, toast } from '../ui.js';
import { post, errMsg } from '../api.js';
import { state } from '../state.js';
import { brandPanel } from './login.js';

/** Shown after someone clicks the link in a password-reset email. Supabase has already signed them in with a one-time session. */
export default function renderResetPassword({ app }) {
  const valid = Boolean(state.user) && sessionStorage.getItem('sunshine_recovery') === '1';
  mount(app, html`
    <div class="login">
      ${brandPanel('Reset your password', 'Choose a new password for your Sunshine Academy account.')}
      <div class="login-panel"><div class="login-box">
        <div class="login-logo"><img src="assets/img/logo.png" alt="Sunshine Academy crest"></div>
        <div class="card login-card">
          ${valid ? html`
            <h1>New password</h1><p class="sub">Choose a password you have not used before.</p>
            <form id="reset-form" novalidate>
              ${field({ name: 'password', label: 'New password', required: true, hint: 'At least 8 characters.', control: passwordControl({ name: 'password' }) })}
              ${field({ name: 'confirm_password', label: 'Confirm new password', required: true, control: passwordControl({ name: 'confirm_password' }) })}
              <button type="submit" class="btn btn-primary btn-block" id="reset-btn">${ic('key-round', 16)} Save new password</button>
            </form>`
          : html`
            <h1>Link not valid</h1><p class="sub">This password-reset link is no longer valid or has already been used. Please request a new one from the sign-in page.</p>
            <a class="btn btn-primary btn-block" style="margin-top:20px" href="#/login">Back to sign in</a>`}
        </div>
      </div></div>
    </div>`);
  if (!valid) return;

  const form = app.querySelector('#reset-form');
  bindPasswordToggles(app);
  form.elements.password.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = formValues(form);
    const errors = {};
    if (v.password.length < 8) errors.password = 'Password must be at least 8 characters.';
    if (v.confirm_password !== v.password) errors.confirm_password = 'The passwords do not match.';
    showFieldErrors(form, errors);
    if (Object.keys(errors).length) return;
    const button = app.querySelector('#reset-btn');
    setLoading(button, true);
    try {
      await post('/auth/update-password', { password: v.password });
      sessionStorage.removeItem('sunshine_recovery');
      state.signingOut = true;
      await post('/auth/logout');
      state.user = null;
      state.signingOut = false;
      toast.success('Password changed successfully. Please sign in with your new password.');
      location.hash = '#/login';
    } catch (error) {
      showFieldErrors(form, error.errors || {});
      toast.error(errMsg(error, 'Unable to change your password. Please try again.'));
      setLoading(button, false);
    }
  });
}
