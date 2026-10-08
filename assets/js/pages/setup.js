import { html, mount, ic, setLoading, showFieldErrors, field, input, passwordControl, bindPasswordToggles, formValues, toast } from '../ui.js';
import { post, errMsg } from '../api.js';
import { state } from '../state.js';
import { brandPanel } from './login.js';

function validate(v) {
  const e = {};
  if (v.name.trim().length < 2) e.name = 'Enter your full name.';
  if (!/^\S+@\S+\.\S+$/.test(v.email.trim())) e.email = 'Enter a valid email address.';
  if (!v.setup_code.trim()) e.setup_code = 'Enter the setup code.';
  if (v.password.length < 8) e.password = 'Password must be at least 8 characters.';
  if (v.confirm_password !== v.password) e.confirm_password = 'The passwords do not match.';
  return e;
}

/** First-time setup: creates the administrator account. Only works while no admin exists. */
export default function renderSetup({ app, onSignedIn }) {
  if (!state.needsSetup) {
    location.hash = '#/login';
    return;
  }
  mount(app, html`
    <div class="login">
      ${brandPanel('Welcome to Sunshine Academy', 'Create the administrator account to start managing teachers and attendance.')}
      <div class="login-panel">
        <div class="login-box">
          <div class="login-logo"><img src="assets/img/logo.png" alt="Sunshine Academy crest"></div>
          <div class="card login-card">
            <h1>Create administrator</h1>
            <p class="sub">This is a one-time step. Choose a strong password you will remember.</p>
            <form id="setup-form" novalidate>
              ${field({ name: 'setup_code', label: 'Setup code', required: true, hint: 'In Supabase open the SQL Editor and run: select code from private.setup_secret;', control: input({ name: 'setup_code', autocomplete: 'off', placeholder: 'Paste the setup code' }) })}
              ${field({ name: 'name', label: 'Full name', required: true, control: input({ name: 'name', autocomplete: 'name', placeholder: 'e.g. Academy Admin' }) })}
              ${field({ name: 'email', label: 'Email', required: true, control: input({ name: 'email', type: 'email', autocomplete: 'email', placeholder: 'admin@sunshineacademy.com' }) })}
              ${field({ name: 'password', label: 'Password', required: true, hint: 'At least 8 characters.', control: passwordControl({ name: 'password' }) })}
              ${field({ name: 'confirm_password', label: 'Confirm password', required: true, control: passwordControl({ name: 'confirm_password' }) })}
              <button type="submit" class="btn btn-primary btn-block" id="setup-btn">${ic('shield-check', 16)} Create administrator</button>
            </form>
          </div>
        </div>
      </div>
    </div>`);

  const form = app.querySelector('#setup-form');
  bindPasswordToggles(app);
  form.elements.name.focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const values = formValues(form);
    const errors = validate(values);
    showFieldErrors(form, errors);
    if (Object.keys(errors).length) return;

    const button = app.querySelector('#setup-btn');
    setLoading(button, true);
    try {
      const data = await post('/auth/setup', values);
      state.user = data.user;
      state.csrf = data.csrf;
      state.today = data.today || '';
      state.needsSetup = false;
      toast.success(data.message);
      onSignedIn();
    } catch (error) {
      showFieldErrors(form, error.errors || {});
      toast.error(errMsg(error, 'Unable to create the account. Please try again.'));
      setLoading(button, false);
    }
  });
}
