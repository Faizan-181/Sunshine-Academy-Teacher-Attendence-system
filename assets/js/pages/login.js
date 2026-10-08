import { html, mount, ic, setLoading, showFieldErrors, field, input, passwordControl, bindPasswordToggles, openModal, dbOutdatedNotice } from '../ui.js';
import { post, errMsg } from '../api.js';
import { state } from '../state.js';

/** The left-hand brand panel and logo shared by the login, register and setup pages. */
export const brandPanel = (title, text) => html`
  <div class="login-brand">
    <div class="logo-tile"><img src="assets/img/logo.png" alt="Sunshine Academy crest"></div>
    <h2>${title}</h2>
    <p>${text}</p>
  </div>`;

export default function renderLogin({ app, onSignedIn }) {
  mount(app, html`
    <div class="login">
      ${brandPanel('Teacher Attendance', 'Mark, review and report teacher attendance for Sunshine Academy, all in one place.')}
      <div class="login-panel">
        <div class="login-box">
          <div class="login-logo"><img src="assets/img/logo.png" alt="Sunshine Academy crest"></div>
          ${state.dbOutdated ? dbOutdatedNotice() : ''}
          ${state.needsSetup ? html`<div class="alert alert-info" style="margin-bottom:16px">${ic('info', 18)}<span><b>Welcome!</b> No administrator exists yet. <a class="link-btn" href="#/setup">Create the administrator account</a> to get started.</span></div>` : ''}
          <div class="card login-card">
            <h1>Welcome Back</h1>
            <p class="sub">Sign in to manage Sunshine Academy attendance.</p>
            <form id="login-form" novalidate>
              <div id="form-error" class="alert alert-error hidden" role="alert"></div>
              ${field({ name: 'identifier', label: 'Email', control: input({ name: 'identifier', type: 'email', autocomplete: 'email', placeholder: 'you@sunshineacademy.com' }) })}
              ${field({ name: 'password', label: 'Password', control: passwordControl({ name: 'password', autocomplete: 'current-password', placeholder: 'Enter your password' }) })}
              <div class="login-row">
                <label class="check"><input type="checkbox" name="remember"> Remember me</label>
                <button type="button" class="link-btn" id="forgot">Forgot password?</button>
              </div>
              <button type="submit" class="btn btn-primary btn-block" id="login-btn">${ic('log-in', 16)} Sign in</button>
            </form>
            <p class="login-alt">New teacher? <a class="link-btn" href="#/register">Create an account</a></p>
          </div>
        </div>
      </div>
    </div>`);

  const form = app.querySelector('#login-form');
  const formError = app.querySelector('#form-error');
  const button = app.querySelector('#login-btn');
  bindPasswordToggles(app);
  form.elements.identifier.focus();

  app.querySelector('#forgot').addEventListener('click', () => {
    const modal = openModal({
      title: 'Reset your password',
      size: 'sm',
      body: html`<form id="fp-form" novalidate>
        <p class="muted" style="font-size:14px;margin-bottom:14px">Enter your email address and we will send you a link to choose a new password.</p>
        ${field({ name: 'fp_email', label: 'Email', required: true, control: input({ name: 'fp_email', type: 'email', autocomplete: 'email', placeholder: 'you@sunshineacademy.com' }) })}
      </form>`,
      footer: html`<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="button" class="btn btn-primary" id="fp-send">Send reset link</button>`,
    });
    const fp = modal.el.querySelector('#fp-form');
    const send = modal.el.querySelector('#fp-send');
    const submit = async () => {
      const email = fp.elements.fp_email.value.trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) return showFieldErrors(fp, { fp_email: 'Enter a valid email address.' });
      showFieldErrors(fp, {});
      setLoading(send, true);
      try {
        const r = await post('/auth/forgot-password', { email });
        mount(modal.el.querySelector('.modal-body'), html`<p style="font-size:14px">${r.message}</p><p class="muted" style="font-size:13px;margin-top:10px">If nothing arrives within a few minutes, check your spam folder or ask the administrator.</p>`);
        send.classList.add('hidden');
      } catch (error) {
        showFieldErrors(fp, { fp_email: errMsg(error, 'Unable to send the reset link. Please try again.') });
        setLoading(send, false);
      }
    };
    send.addEventListener('click', submit);
    fp.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const identifier = form.elements.identifier.value.trim();
    const password = form.elements.password.value;
    const errors = {};
    if (!identifier) errors.identifier = 'Enter your email address.';
    if (!password) errors.password = 'Enter your password.';
    showFieldErrors(form, errors);
    formError.classList.add('hidden');
    if (Object.keys(errors).length) return;

    setLoading(button, true);
    try {
      const data = await post('/auth/login', { identifier, password, remember: form.elements.remember.checked });
      state.user = data.user;
      state.csrf = data.csrf;
      state.today = data.today || '';
      onSignedIn();
    } catch (error) {
      formError.textContent = errMsg(error, 'Unable to sign in. Please try again.');
      formError.classList.remove('hidden');
      setLoading(button, false);
    }
  });
}
