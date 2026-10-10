import { lateTitle, html, mount, ic, badge, emptyState, errorState, cardsSkeleton, tableSkeleton, statsSummary, statCard, pageHead, confirmDialog, toast, $, $$ } from '../ui.js';
import { get, post, errMsg } from '../api.js';
import { state } from '../state.js';
import { formatDate, formatLongDate, formatTime } from '../format.js';
import { attendanceEditModal } from '../components.js';

export default function dashboard(ctx) {
  return state.user.role === 'admin' ? adminDashboard(ctx) : teacherDashboard(ctx);
}

async function adminDashboard({ root }) {
  mount(root, html`
    ${pageHead('Dashboard', 'Attendance overview for today', html`<a class="btn btn-primary" href="#/mark-attendance">${ic('clipboard-check', 16)} Mark attendance</a>`)}
    <div id="pending"></div>
    <div id="pending-leaves"></div>
    <div id="stats"></div>
    <section class="card mt"><div class="card-head"><h2>Today's Attendance</h2><span id="not-marked"></span></div><div id="today"></div></section>`);
  const stats = $('#stats', root), today = $('#today', root), notMarked = $('#not-marked', root), pending = $('#pending', root);
  const pendingLeaves = $('#pending-leaves', root);

  async function refreshPendingLeaves() {
    if (!pendingLeaves?.isConnected) return;
    if (document.visibilityState === 'hidden') return;
    try {
      const result = await get('/leave-requests', { status: 'pending', page: 1, limit: 1 });
      const count = Number(result.pagination?.total) || 0;
      mount(pendingLeaves, count > 0
        ? html`<div class="notice"><span class="stat-icon tone-amber">${ic('calendar-check', 22)}</span>
            <p><b>${count} teacher leave ${count === 1 ? 'request is' : 'requests are'} waiting for review.</b><br><span class="muted">Review pending leave requests before marking attendance.</span></p>
            <a class="btn btn-primary btn-sm" href="#/leave-requests">Review leave requests</a></div>`
        : html``);
    } catch {
      mount(pendingLeaves, html`<div class="notice"><span class="stat-icon tone-amber">${ic('calendar-check', 22)}</span>
          <p><b>Pending leave requests could not be checked.</b><br><span class="muted">Open Leave Requests to review them.</span></p>
          <a class="btn btn-secondary btn-sm" href="#/leave-requests">Open requests</a></div>`);
    }
  }
  refreshPendingLeaves();
  const leaveRefreshTimer = setInterval(() => {
    if (!pendingLeaves?.isConnected) { clearInterval(leaveRefreshTimer); return; }
    refreshPendingLeaves();
  }, 30_000);

  async function load() {
    mount(stats, cardsSkeleton());
    mount(today, tableSkeleton(5, 7));
    let data;
    try {
      data = await get('/dashboard/admin');
    } catch (error) {
      mount(stats, html``);
      mount(today, errorState(errMsg(error, 'Unable to load the dashboard. Please try again.')));
      $('[data-retry]', today).addEventListener('click', load);
      return;
    }

    const s = data.stats;
    mount(pending, s.pending > 0
      ? html`<div class="notice"><span class="stat-icon tone-amber">${ic('user-plus', 22)}</span>
          <p><b>${s.pending} ${s.pending === 1 ? 'teacher is' : 'teachers are'} waiting for approval.</b><br><span class="muted">They registered themselves and cannot sign in until you approve them.</span></p>
          <a class="btn btn-primary btn-sm" href="#/teachers?status=pending">Review</a></div>`
      : html``);
    mount(stats, html`<div class="stat-grid">
      ${statCard('users', 'Total Teachers', s.totalTeachers, 'navy')}
      ${statCard('user-check', 'Present Today', s.present, 'leaf')}
      ${statCard('user-x', 'Absent Today', s.absent, 'red')}
      ${statCard('clock', 'Late Today', s.late, 'amber')}</div>`);
    mount(notMarked, s.notMarked > 0
      ? html`<a class="link-btn" href="#/mark-attendance">${s.notMarked} ${s.notMarked === 1 ? 'teacher' : 'teachers'} not marked yet</a>` : html``);

    if (!data.todayAttendance.length) {
      mount(today, emptyState({ icon: 'clipboard-list', title: 'No attendance has been marked today.', text: "Once you mark attendance, today's records will appear here.",
        action: html`<a class="btn btn-primary" href="#/mark-attendance">${ic('clipboard-check', 16)} Mark attendance</a>` }));
      return;
    }
    mount(today, html`<div class="table-scroll"><table class="table">
      <thead><tr><th>Teacher ID</th><th>Teacher Name</th><th>Subject</th><th>Date</th><th>Check In</th><th>Check Out</th><th>Status</th><th class="right">Action</th></tr></thead>
      <tbody>${data.todayAttendance.map((r, i) => html`<tr>
        <td class="dim">${r.teacher.teacher_id}</td><td class="strong">${r.teacher.name}</td><td>${r.teacher.subject}</td>
        <td class="nowrap">${formatDate(r.date)}</td><td class="nowrap">${formatTime(r.check_in)}</td><td class="nowrap">${formatTime(r.check_out)}</td>
        <td>${badge(r.status, lateTitle(r))}</td>
        <td><div class="actions">
          <a class="icon-btn" href="#/teachers/${r.teacher.id}" aria-label="View teacher" title="View teacher">${ic('eye')}</a>
          <button type="button" class="icon-btn" data-edit="${i}" aria-label="Edit attendance" title="Edit attendance">${ic('pencil')}</button></div></td></tr>`)}</tbody></table></div>`);
    $$('[data-edit]', today).forEach((btn) => btn.addEventListener('click', () => attendanceEditModal(data.todayAttendance[btn.dataset.edit], load)));
  }
  await load();
}

/** What the teacher sees for today: a Check In button, a Check Out button, or the result. */
function todayCard(d) {
  const { today, rules } = d;
  const hint = html`<p class="hint" style="margin-top:0">School starts at <b>${formatTime(rules.startTime)}</b>. Checking in after <b>${formatTime(rules.lateAfter)}</b> is marked Late.</p>`;

  if (!today) {
    return rules.selfCheckin
      ? html`<div class="today-main"><div><p class="today-title">You have not checked in yet.</p>${hint}</div>
          <button type="button" class="btn btn-primary btn-lg" id="check-in">${ic('log-in', 18)} Check In</button></div>`
      : html`<p class="muted">Your attendance for today has not been marked yet. The administrator will mark it for you.</p>`;
  }

  const times = html`<p class="muted">Check in <b style="color:var(--ink)">${formatTime(today.check_in)}</b> · Check out <b style="color:var(--ink)">${formatTime(today.check_out)}</b></p>`;
  const working = today.check_in && !today.check_out && rules.selfCheckin;
  return html`<div class="today-main"><div style="display:flex;flex-wrap:wrap;align-items:center;gap:12px">${badge(today.status, lateTitle(today))}${times}</div>
    ${working ? html`<button type="button" class="btn btn-navy btn-lg" id="check-out">${ic('log-out', 18)} Check Out</button>` : ''}</div>
    ${today.check_in && today.check_out ? html`<p class="hint">You have checked out for today. Only the administrator can change this record.</p>` : ''}
    ${!today.check_in ? html`<p class="hint">This was marked by the administrator.</p>` : ''}`;
}

async function teacherDashboard({ root }) {
  mount(root, html`${pageHead(`Hello, ${state.user.name.split(' ')[0]}`, 'Your attendance at a glance')}<div id="body">${tableSkeleton(4, 4)}</div>`);
  const body = $('#body', root);

  async function load() {
    mount(body, tableSkeleton(4, 4));
    let d;
    try {
      d = await get('/dashboard/teacher');
    } catch (error) {
      mount(body, html`<div class="card">${errorState(errMsg(error, 'Unable to load your dashboard. Please try again.'))}</div>`);
      $('[data-retry]', body).addEventListener('click', load);
      return;
    }
    mount(body, html`<div class="stack">
      <section class="card"><div class="card-head"><h2>Today · ${formatLongDate(d.date)}</h2></div>
        <div class="card-body today">${todayCard(d)}</div></section>
      <section class="card"><div class="card-head"><h2>This month</h2></div><div class="card-body">${d.thisMonth.totalDays
        ? statsSummary(d.thisMonth) : html`<p class="muted">No attendance has been recorded this month yet.</p>`}</div></section>
      <section class="card"><div class="card-head"><h2>Recent records</h2><a class="btn btn-secondary btn-sm" href="#/my-attendance">View all</a></div>${d.recent.length
        ? html`<div class="table-scroll"><table class="table"><thead><tr><th>Date</th><th>Check In</th><th>Check Out</th><th>Status</th><th>Remarks</th></tr></thead>
          <tbody>${d.recent.map((r) => html`<tr><td class="nowrap strong">${formatDate(r.date)}</td><td class="nowrap">${formatTime(r.check_in)}</td><td class="nowrap">${formatTime(r.check_out)}</td><td>${badge(r.status, lateTitle(r))}</td><td class="dim">${r.remarks || '—'}</td></tr>`)}</tbody></table></div>`
        : emptyState({ icon: 'calendar-x', title: 'No attendance records found.', text: 'Your records will appear here once attendance is marked.' })}</section></div>`);

    // Check In / Check Out. The time is taken from the server, so it cannot be changed from the browser.
    const act = (selector, path, title, message, label) => $(selector, body)?.addEventListener('click', () => confirmDialog({
      title, message, confirmLabel: label, variant: 'navy',
      onConfirm: async () => {
        try {
          toast.success((await post(path)).message);
        } catch (error) {
          toast.error(errMsg(error)); // e.g. "You have already checked in today."
        }
        load();
      },
    }));
    act('#check-in', '/attendance/me/check-in', 'Check in now?', 'Your check-in time will be recorded as the current time. You cannot change it afterwards.', 'Check In');
    act('#check-out', '/attendance/me/check-out', 'Check out now?', 'Your check-out time will be recorded as the current time.', 'Check Out');
  }
  await load();
}
