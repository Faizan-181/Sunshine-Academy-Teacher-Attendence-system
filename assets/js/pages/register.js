import { html, mount, ic, setLoading, showFieldErrors, field, input, textarea, passwordControl, bindPasswordToggles, formValues, toast, dbOutdatedNotice } from '../ui.js';
import { state } from '../state.js';
import { post, errMsg } from '../api.js';
import { brandPanel } from './login.js';

// Same rules as the server, so people get instant feedback.
function validate(v) {
  const e = {};
  if (v.name.trim().length < 2) e.name = 'Enter your full name.';
  if (!/^\S+@\S+\.\S+$/.test(v.email.trim())) e.email = 'Enter a valid email address.';
  if (!/^[0-9+\-\s()]{7,20}$/.test(v.phone.trim())) e.phone = 'Enter a valid phone number.';
  if (v.subject.trim().length < 2) e.subject = 'Enter the subject you teach.';
  if (v.password.length < 8) e.password = 'Password must be at least 8 characters.';
  if (v.confirm_password !== v.password) e.confirm_password = 'The passwords do not match.';
  return e;
}

/** Teachers sign themselves up. An administrator must approve the account before it can be used. */
export default function renderRegister({ app }) {
  mount(app, html`
    <div class="login">
      ${brandPanel('Join Sunshine Academy', 'Register your teacher account. The administrator will review and approve it, then you can sign in.')}
      <div class="login-panel">
        <div class="login-box" style="max-width:640px">
          <div class="login-logo"><img src="assets/img/logo.png" alt="Sunshine Academy crest"></div>
          ${state.dbOutdated ? dbOutdatedNotice() : ''}
          <div class="card login-card" id="reg-card">
            <h1>Create your account</h1>
            <p class="sub">Fields marked <b class="req">*</b> are required.</p>
            <form id="reg-form" novalidate>
              <div class="form-grid">
                ${field({ name: 'name', label: 'Full name', required: true, control: input({ name: 'name', autocomplete: 'name', placeholder: 'e.g. Ayesha Khan' }) })}
                ${field({ name: 'email', label: 'Email', required: true, hint: 'You will sign in with this email address.', control: input({ name: 'email', type: 'email', autocomplete: 'email', placeholder: 'name@example.com' }) })}
                ${field({ name: 'phone', label: 'Phone number', required: true, control: input({ name: 'phone', type: 'tel', autocomplete: 'tel', placeholder: 'e.g. 0300 1234567' }) })}
                ${field({ name: 'subject', label: 'Subject you teach', required: true, control: input({ name: 'subject', placeholder: 'e.g. Mathematics' }) })}
                ${field({ name: 'date_of_birth', label: 'Date of birth', control: input({ name: 'date_of_birth', type: 'date', autocomplete: 'bday' }) })}
                ${field({ name: 'address', label: 'Address', control: textarea({ name: 'address', placeholder: 'Street, city' }) })}
                ${field({ name: 'password', label: 'Password', required: true, hint: 'At least 8 characters.', control: passwordControl({ name: 'password' }) })}
                ${field({ name: 'confirm_password', label: 'Confirm password', required: true, control: passwordControl({ name: 'confirm_password' }) })}
              </div>
              <!-- Hidden trap for spam bots. Real people never see or fill this in. -->
              <div class="hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
              <button type="submit" class="btn btn-primary btn-block" id="reg-btn" style="margin-top:20px">${ic('user-plus', 16)} Register</button>
            </form>
            <p class="login-alt">Already registered? <a class="link-btn" href="#/login">Sign in</a></p>
          </div>
        </div>
      </div>
    </div>`);

  const form = app.querySelector('#reg-form');
  bindPasswordToggles(app);
  form.elements.name.focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const values = formValues(form);
    const errors = validate(values);
    showFieldErrors(form, errors);
    if (Object.keys(errors).length) return;

    const button = app.querySelector('#reg-btn');
    setLoading(button, true);
    try {
      const data = await post('/auth/register', values);
      mount(app.querySelector('#reg-card'), html`
        <div class="state" style="padding:24px 8px">
          <span class="state-icon" style="background:var(--leaf-light);color:var(--leaf)">${ic('circle-check', 28)}</span>
          <h3>Registration submitted</h3>
          <p>${data.message}</p>
          <a class="btn btn-primary" href="#/login">Back to sign in</a>
        </div>`);
    } catch (error) {
      showFieldErrors(form, error.errors || {});
      toast.error(errMsg(error, 'Unable to register right now. Please try again.'));
      setLoading(button, false);
    }
  });
}
