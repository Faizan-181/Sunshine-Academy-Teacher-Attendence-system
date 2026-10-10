import { html } from './ui.js';

const point = (radius, angle) => ({
  x: (120 + Math.cos(angle) * radius).toFixed(2),
  y: (120 + Math.sin(angle) * radius).toFixed(2),
});

function clockFace() {
  const ticks = Array.from({ length: 60 }, (_, index) => {
    const major = index % 5 === 0;
    return html`<line class="clock-tick ${major ? 'major' : ''}" x1="120" y1="${major ? 15 : 18}" x2="120" y2="${major ? 29 : 23}"
      transform="rotate(${index * 6} 120 120)" />`;
  });
  const numbers = Array.from({ length: 12 }, (_, index) => {
    const number = index || 12;
    const at = point(81, (index * 30 - 90) * Math.PI / 180);
    return html`<text class="clock-number" x="${at.x}" y="${at.y}" text-anchor="middle" dominant-baseline="central">${number}</text>`;
  });

  return html`<svg class="clock-dial" viewBox="0 0 240 240" role="img" aria-label="Sunshine Academy analog clock">
    <circle class="clock-face" cx="120" cy="120" r="111" />
    ${ticks}
    ${numbers}
    <g data-clock-hour class="clock-hand hour"><line x1="120" y1="126" x2="120" y2="76" /></g>
    <g data-clock-minute class="clock-hand minute"><line x1="120" y1="127" x2="120" y2="49" /></g>
    <g data-clock-second class="clock-hand second"><line x1="120" y1="135" x2="120" y2="38" /></g>
    <rect class="clock-brand-plate" x="62" y="145" width="116" height="17" rx="8.5" />
    <text class="clock-brand" x="120" y="156.5" text-anchor="middle">SUNSHINE ACADEMY</text>
    <circle class="clock-pin" cx="120" cy="120" r="5.5" />
  </svg>`;
}

export function clockWidget(variant = 'admin') {
  return html`<section class="academy-clock academy-clock--${variant}" data-academy-clock aria-label="Sunshine Academy local time">
    ${clockFace()}
    <div class="clock-readout"><time data-clock-time></time><span class="clock-zone">PKT</span></div>
    <p class="clock-date" data-clock-date></p>
    <p class="clock-caption">Pakistan Standard Time</p>
  </section>`;
}

/** Keep the visible clock in sync with Pakistan Standard Time, independent of the device timezone. */
export function startClocks(root = document) {
  const clocks = [...root.querySelectorAll('[data-academy-clock]')];
  if (!clocks.length) return;

  let timer;
  const update = () => {
    const connected = clocks.filter((clock) => clock.isConnected);
    if (!connected.length) {
      clearInterval(timer);
      return;
    }

    const now = new Date();
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-PK', {
      timeZone: 'Asia/Karachi', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h12',
    }).formatToParts(now).map(({ type, value }) => [type, value]));
    const hour = Number(parts.hour) % 12;
    const minute = Number(parts.minute);
    const second = Number(parts.second);
    const angles = {
      hour: (hour * 30 + minute / 2),
      minute: (minute * 6 + second / 10),
      second: second * 6,
    };
    const time = new Intl.DateTimeFormat('en-PK', {
      timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h12',
    }).format(now);
    const date = new Intl.DateTimeFormat('en-PK', {
      timeZone: 'Asia/Karachi', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    }).format(now);

    connected.forEach((clock) => {
      for (const [hand, angle] of Object.entries(angles)) {
        clock.querySelector(`[data-clock-${hand}]`)?.setAttribute('transform', `rotate(${angle} 120 120)`);
      }
      const timeElement = clock.querySelector('[data-clock-time]');
      if (timeElement) {
        timeElement.textContent = time;
        timeElement.dateTime = now.toISOString();
      }
      const dateElement = clock.querySelector('[data-clock-date]');
      if (dateElement) dateElement.textContent = date;
      clock.setAttribute('aria-label', `Sunshine Academy clock: ${time} Pakistan Standard Time`);
    });
  };

  update();
  timer = setInterval(update, 1000);
}
