import { html, mount, ic, badge, avatar, errorState, loading, statsSummary, pageHead, $ } from '../ui.js';
import { get, errMsg } from '../api.js';
import { state } from '../state.js';
import { formatDate } from '../format.js';
import { passwordCard, bindPasswordCard } from '../password-card.js';

const detail = (label, value, wide = false) => html`<div class="${wide ? 'wide' : ''}"><dt>${label}</dt><dd>${value || '—'}</dd></div>`;

/** Shows one teacher. Used by /teachers/:id (admin) and /profile (a teacher viewing themselves). */
export async function renderTeacherProfile({ root, params }, self = false) {
  mount(root, loading());
  let teacher, stats;
  try {
    teacher = (await get(self ? '/teachers/me' : `/teachers/${params.id}`)).data;
    stats = (await get('/attendance/summary', self ? {} : { teacher: teacher.id })).data;
  } catch (error) {
    mount(root, html`<div class="card">${errorState(errMsg(error, 'Unable to load this profile. Please try again.'))}</div>`);
    $('[data-retry]', root).addEventListener('click', () => renderTeacherProfile({ root, params }, self));
    return;
  }

  const admin = state.user.role === 'admin';
  mount(root, html`
    ${pageHead(self ? 'My Profile' : 'Teacher Profile', '', self ? null : html`
      <a class="btn btn-secondary" href="#/teachers">${ic('arrow-left', 16)} Back</a>
      <a class="btn btn-secondary" href="#/attendance?teacher=${teacher.id}">${ic('history', 16)} Attendance</a>
      <a class="btn btn-primary" href="#/teachers/${teacher.id}/edit">${ic('pencil', 16)} Edit</a>`)}
    <div class="stack">
      <section class="card"><div class="card-body">
        <div class="profile-summary-row"><div class="profile-top">${avatar(teacher.name, 'xl')}
          <div style="flex:1">
            <div class="profile-tags"><h2>${teacher.name}</h2>${badge(teacher.status)}</div>
            <p class="dim" style="margin-top:4px;font-size:14px">${teacher.subject} · ${teacher.teacher_id}</p>
            <div class="profile-contact"><span>${ic('mail', 16)} ${teacher.email}</span><span>${ic('phone', 16)} ${teacher.phone}</span></div>
          </div></div></div>
        <dl class="details">
          ${detail('Teacher ID', teacher.teacher_id)}${detail('Subject', teacher.subject)}${detail('Joining date', formatDate(teacher.joining_date))}${detail('Account status', teacher.status === 'active' ? 'Active' : 'Inactive')}
          ${admin ? html`${detail('Date of birth', teacher.date_of_birth ? formatDate(teacher.date_of_birth) : '')}${detail('Address', teacher.address, true)}` : ''}
        </dl></div></section>
      <section class="card"><div class="card-head"><h2>Attendance</h2></div><div class="card-body">${stats.totalDays
        ? statsSummary(stats)
        : html`<p class="muted">No attendance has been recorded yet. ${admin ? html`<a class="link-btn" href="#/mark-attendance">Mark attendance</a>` : ''}</p>`}</div></section>
    </div>`);

  if (self) { // a teacher's own profile also offers "Change password"
    const wrap = document.createElement('div');
    wrap.className = 'mt';
    mount(wrap, passwordCard());
    root.appendChild(wrap);
    bindPasswordCard(wrap);
  }
}

export default (ctx) => renderTeacherProfile(ctx, false);
