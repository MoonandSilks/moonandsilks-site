// Client side of /book: cart, waivers and payment in three steps. The server re-validates everything.
type Session = {
  id: number;
  date: string;
  label: string;
  dayLong: string;
  ageGroup: string;
  ageMin: number | null;
  ageMax: number | null;
  priceCents: number;
  spotsLeft: number;
  past: boolean;
  closed: boolean;
};
type Config = {
  sessions: Session[];
  feePercent: number;
  feeFixedCents: number;
  cardEnabled: boolean;
  waiverVersion: string;
  today: string;
};

const ACK_KEYS = ['read_understood', 'asked_questions', 'understand_risks', 'voluntary', 'accept_responsibility', 'follow_instructions', 'statutory_rights'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[+()\d\s-]{6,20}$/;
const MAX_PARTICIPANTS = 8;

const aud = (c: number) => `$${(c / 100).toFixed(2)}`;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function ageOn(dob: string, on: string) {
  const [by, bm, bd] = dob.split('-').map(Number);
  const [y, m, d] = on.split('-').map(Number);
  let a = y - by;
  if (m < bm || (m === bm && d < bd)) a--;
  return a;
}
const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export function initBooking() {
  const form = document.getElementById('booking') as HTMLFormElement | null;
  const cfgEl = document.getElementById('booking-config');
  if (!form || !cfgEl) return;
  const cfg = JSON.parse(cfgEl.textContent || '{}') as Config;
  const byId = new Map(cfg.sessions.map((s) => [s.id, s]));
  const unitPrice = cfg.sessions[0]?.priceCents ?? 2000;
  form.hidden = false;

  const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = form) => root.querySelector<T>(sel);
  const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = form) => [...root.querySelectorAll<T>(sel)];
  const pList = $('#participants')!;
  const wList = $('#waivers')!;
  const tplP = document.getElementById('tpl-participant') as HTMLTemplateElement;
  const tplW = document.getElementById('tpl-waiver') as HTMLTemplateElement;
  const summaryBox = $('#error-summary')!;
  let step = 1;
  let counter = 0; // stable index for ids; never reused

  // ---------- helpers ----------
  const clone = (tpl: HTMLTemplateElement, i: number) => {
    const html = tpl.innerHTML.replaceAll('__i', String(i));
    const t = document.createElement('template');
    t.innerHTML = html;
    return t.content.firstElementChild as HTMLElement;
  };
  const field = (root: ParentNode, key: string) => $<HTMLInputElement>(`[data-key="${key}"]`, root);
  const val = (root: ParentNode, key: string) => field(root, key)?.value.trim() ?? '';

  function setError(key: string, msg: string | null) {
    const err = document.getElementById(`err-${key}`);
    const input = field(form!, key);
    if (err) {
      err.textContent = msg ?? '';
      err.hidden = !msg;
    }
    const target = input ?? (key.endsWith('.health') ? field(form!, key.replace('.health', '.healthNotes')) : null);
    if (target) {
      target.setAttribute('aria-invalid', msg ? 'true' : 'false');
      const ids = new Set((target.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean));
      if (err) ids.add(err.id);
      target.setAttribute('aria-describedby', [...ids].join(' '));
    }
  }
  function clearErrors(root: ParentNode = form!) {
    $$('.error', root).forEach((e) => {
      e.hidden = true;
      e.textContent = '';
    });
    $$('[aria-invalid="true"]', root).forEach((e) => e.setAttribute('aria-invalid', 'false'));
    summaryBox.hidden = true;
  }
  function showErrors(errors: Record<string, string>, message = 'Please fix the highlighted fields.') {
    Object.entries(errors).forEach(([k, m]) => setError(k, m));
    summaryBox.textContent = message;
    summaryBox.hidden = false;
    const firstKey = Object.keys(errors)[0];
    const first =
      (firstKey && (field(form!, firstKey) ?? field(form!, firstKey.replace('.health', '.healthNotes')))) ||
      (firstKey && document.getElementById(`err-${firstKey}`)?.closest('fieldset')?.querySelector<HTMLElement>('input')) ||
      summaryBox;
    (first as HTMLElement).focus();
  }

  const participantEls = () => $$('.participant', pList);
  const idx = (el: HTMLElement) => Number(el.dataset.index);
  const selectedSessions = (pEl: HTMLElement) => $$<HTMLInputElement>('.class-list input:checked', pEl).map((c) => Number(c.value));

  // ---------- step 1: participants & classes ----------
  function addParticipant() {
    if (participantEls().length >= MAX_PARTICIPANTS) return;
    const i = counter++;
    const el = clone(tplP, i);
    const list = $('.class-list', el)!;
    list.innerHTML = cfg.sessions
      .map((s) => {
        const id = `p${i}-s${s.id}`;
        return `<div class="check" data-session="${s.id}"><input type="checkbox" id="${id}" value="${s.id}" ${s.spotsLeft === 0 ? 'disabled' : ''}/><label for="${id}">${esc(s.label)} <span class="hint" data-left></span></label></div>`;
      })
      .join('');
    pList.appendChild(el);
    renumber();
    refreshCart();
    return el;
  }
  function renumber() {
    participantEls().forEach((el, n) => {
      $('.pnum', el)!.textContent = String(n + 1);
      $<HTMLButtonElement>('.remove-participant', el)!.hidden = participantEls().length === 1;
    });
    $<HTMLButtonElement>('#add-participant')!.hidden = participantEls().length >= MAX_PARTICIPANTS;
  }

  function cartCounts() {
    const counts = new Map<number, number>();
    participantEls().forEach((p) => selectedSessions(p).forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1)));
    return counts;
  }

  function refreshCart() {
    const counts = cartCounts();
    // Spots left, allowing for what's already in this cart; stop over-selecting.
    participantEls().forEach((p) => {
      $$<HTMLElement>('.class-list .check', p).forEach((row) => {
        const s = byId.get(Number(row.dataset.session))!;
        const box = $<HTMLInputElement>('input', row)!;
        const left = s.spotsLeft - (counts.get(s.id) ?? 0);
        const blocked = s.spotsLeft === 0 || (!box.checked && left <= 0);
        box.disabled = blocked;
        row.classList.toggle('is-disabled', blocked);
        $('[data-left]', row)!.textContent = s.past ? '(finished)' : s.closed ? '(closed)' : s.spotsLeft === 0 ? '(sold out)' : !box.checked && left <= 0 ? '(no spots left)' : `(${s.spotsLeft} left)`;
      });
      // Age warnings: allowed, but flagged.
      const dob = val(p, `p${idx(p)}.dateOfBirth`);
      const name = val(p, `p${idx(p)}.fullName`) || 'This participant';
      const warn = $('.age-warnings', p)!;
      const msgs = validDate(dob)
        ? selectedSessions(p)
            .map((id) => byId.get(id)!)
            .filter((s) => {
              const a = ageOn(dob, s.date);
              return (s.ageMin !== null && a < s.ageMin) || (s.ageMax !== null && a > s.ageMax);
            })
            .map((s) => `Heads up: ${esc(name)} will be ${ageOn(dob, s.date)} on ${esc(s.dayLong)}, outside the ${esc(s.ageGroup)} group. You can still book, and we’ll be in touch if it isn’t a good fit.`)
        : [];
      warn.innerHTML = msgs.map((m) => `<p class="warn">${m}</p>`).join('');
    });

    const net = [...counts.entries()].reduce((sum, [id, n]) => sum + n * byId.get(id)!.priceCents, 0);
    const spots = [...counts.values()].reduce((a, b) => a + b, 0);
    const lines = participantEls().flatMap((p) => {
      const name = val(p, `p${idx(p)}.fullName`) || `Participant ${$('.pnum', p)!.textContent}`;
      return selectedSessions(p).map((id) => `<li>${esc(name)} — ${esc(byId.get(id)!.label)}</li>`);
    });
    $('#cart-summary')!.innerHTML = spots
      ? `<strong>Your booking</strong><ul>${lines.join('')}</ul>${spots} ${spots === 1 ? 'spot' : 'spots'} × ${aud(unitPrice)} = <strong>${aud(net)}</strong>`
      : '';
    refreshPayment();
  }

  function validateStep1() {
    const errors: Record<string, string> = {};
    const seen = new Set<string>();
    participantEls().forEach((p) => {
      const i = idx(p);
      const name = val(p, `p${i}.fullName`);
      const dob = val(p, `p${i}.dateOfBirth`);
      if (!name) errors[`p${i}.fullName`] = 'Enter the participant’s full name.';
      else if (seen.has(`${name.toLowerCase()}|${dob}`)) errors[`p${i}.fullName`] = 'This participant is already in your booking.';
      seen.add(`${name.toLowerCase()}|${dob}`);
      if (!validDate(dob) || dob > cfg.today || dob < '1900-01-01') errors[`p${i}.dateOfBirth`] = 'Enter a valid date of birth.';
      if (!selectedSessions(p).length) errors[`p${i}.sessions`] = 'Choose at least one class.';
    });
    return errors;
  }

  // ---------- step 2: waivers ----------
  function isMinor(p: HTMLElement) {
    const dob = val(p, `p${idx(p)}.dateOfBirth`);
    const dates = selectedSessions(p).map((id) => byId.get(id)!.date).sort();
    return validDate(dob) && dates.length > 0 && ageOn(dob, dates[0]) < 18;
  }

  function syncWaivers() {
    const keep = new Set(participantEls().map(idx));
    $$('.waiver', wList).forEach((w) => {
      if (!keep.has(idx(w))) w.remove();
    });
    participantEls().forEach((p, n) => {
      const i = idx(p);
      let w = $<HTMLElement>(`.waiver[data-index="${i}"]`, wList);
      if (!w) {
        w = clone(tplW, i);
        wList.appendChild(w);
        const none = field(w, `p${i}.healthNone`)!;
        const notes = field(w, `p${i}.healthNotes`)!;
        none.addEventListener('change', () => {
          if (none.checked) notes.value = '';
          notes.disabled = none.checked;
        });
      }
      wList.appendChild(w); // keep order in step with participants
      $$('.wname', w).forEach((e) => (e.textContent = val(p, `p${i}.fullName`)));
      const dob = val(p, `p${i}.dateOfBirth`);
      $('.wdob', w)!.textContent = dob ? new Date(`${dob}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
      const minor = isMinor(p);
      $('.guardian', w)!.hidden = !minor;
      ['guardianName', 'guardianRelationship', 'guardianSignature'].forEach((f) => (field(w!, `p${i}.${f}`)!.required = minor));
      $<HTMLButtonElement>('.copy-details', w)!.hidden = n === 0;
    });
  }

  function validateStep2() {
    const errors: Record<string, string> = {};
    participantEls().forEach((p) => {
      const i = idx(p);
      const w = $<HTMLElement>(`.waiver[data-index="${i}"]`, wList)!;
      if (!PHONE.test(val(w, `p${i}.phone`))) errors[`p${i}.phone`] = 'Enter a phone number.';
      if (!EMAIL.test(val(w, `p${i}.email`))) errors[`p${i}.email`] = 'Enter a valid email address.';
      if (!val(w, `p${i}.emergencyName`)) errors[`p${i}.emergencyName`] = 'Enter an emergency contact name.';
      if (!PHONE.test(val(w, `p${i}.emergencyPhone`))) errors[`p${i}.emergencyPhone`] = 'Enter an emergency contact phone number.';
      if (!field(w, `p${i}.healthNone`)!.checked && !val(w, `p${i}.healthNotes`))
        errors[`p${i}.health`] = 'Describe any injuries or medical conditions, or tick “None”.';
      if ($$<HTMLInputElement>('[data-ack]', w).some((c) => !c.checked)) errors[`p${i}.acks`] = 'Tick every acknowledgement to continue.';
      if (!val(w, `p${i}.signature`)) errors[`p${i}.signature`] = 'Type the participant’s full name to sign.';
      if (isMinor(p)) {
        if (!val(w, `p${i}.guardianName`)) errors[`p${i}.guardianName`] = 'Enter the parent or guardian’s name.';
        if (!val(w, `p${i}.guardianRelationship`)) errors[`p${i}.guardianRelationship`] = 'Enter the relationship to the participant.';
        if (!val(w, `p${i}.guardianSignature`)) errors[`p${i}.guardianSignature`] = 'Parent or guardian: type your full name to sign.';
      }
    });
    return errors;
  }

  // ---------- step 3: payment ----------
  function surcharge(net: number) {
    if (net <= 0) return 0;
    return Math.ceil((net + cfg.feeFixedCents) / (1 - cfg.feePercent / 100)) - net;
  }
  function refreshPayment() {
    const counts = cartCounts();
    const spots = [...counts.values()].reduce((a, b) => a + b, 0);
    const net = [...counts.entries()].reduce((sum, [id, n]) => sum + n * byId.get(id)!.priceCents, 0);
    const box = $('#pay-summary')!;
    const btn = $<HTMLButtonElement>('#submit-btn')!;
    if (!spots) {
      box.innerHTML = '';
      return;
    }
    const base = `<tr><td>${spots} ${spots === 1 ? 'session' : 'sessions'} × ${aud(unitPrice)}</td><td>${aud(net)}</td></tr>`;
    const s = surcharge(net);
    box.innerHTML = `<table>${base}<tr><td>Card surcharge</td><td>${aud(s)}</td></tr><tr class="total"><td>Total to pay now</td><td>${aud(net + s)}</td></tr></table>`;
    btn.textContent = `Pay ${aud(net + s)} by card`;
  }
  function validateStep3() {
    const errors: Record<string, string> = {};
    if (!val(form!, 'booker.name')) errors['booker.name'] = 'Enter your name.';
    if (!EMAIL.test(val(form!, 'booker.email'))) errors['booker.email'] = 'Enter a valid email address.';
    if (!PHONE.test(val(form!, 'booker.phone'))) errors['booker.phone'] = 'Enter a phone number.';
    return errors;
  }
  function prefillBooker() {
    const first = participantEls()[0];
    if (!first) return;
    const i = idx(first);
    const w = $<HTMLElement>(`.waiver[data-index="${i}"]`, wList);
    const set = (key: string, v: string) => {
      const f = field(form!, key)!;
      if (!f.value) f.value = v;
    };
    if (w) {
      set('booker.name', isMinor(first) ? val(w, `p${i}.guardianName`) : val(first, `p${i}.fullName`));
      set('booker.email', val(w, `p${i}.email`));
      set('booker.phone', val(w, `p${i}.phone`));
    }
  }

  // ---------- navigation ----------
  function go(to: number) {
    step = to;
    $$<HTMLElement>('.step').forEach((s) => (s.hidden = Number(s.dataset.step) !== to));
    $('#step-num')!.textContent = String(to);
    if (to === 2) syncWaivers();
    if (to === 3) {
      prefillBooker();
      refreshPayment();
    }
    $<HTMLElement>(`#h-step-${to}`)!.focus();
    window.scrollTo({ top: form!.getBoundingClientRect().top + window.scrollY - 16 });
  }
  function validateUpTo(n: number) {
    const checks = [validateStep1, validateStep2, validateStep3];
    for (let s = 1; s <= n; s++) {
      const errs = checks[s - 1]();
      if (Object.keys(errs).length) return { step: s, errs };
    }
    return null;
  }

  // ---------- events ----------
  $('#add-participant')!.addEventListener('click', () => {
    const el = addParticipant();
    el && field(el, `p${idx(el)}.fullName`)?.focus();
  });
  pList.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.remove-participant');
    if (!btn) return;
    const p = btn.closest<HTMLElement>('.participant')!;
    p.remove();
    renumber();
    refreshCart();
    $<HTMLElement>('#add-participant')!.focus();
  });
  pList.addEventListener('input', refreshCart);
  pList.addEventListener('change', refreshCart);
  wList.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.copy-details');
    if (!btn) return;
    const w = btn.closest<HTMLElement>('.waiver')!;
    const firstIdx = idx(participantEls()[0]);
    const src = $<HTMLElement>(`.waiver[data-index="${firstIdx}"]`, wList)!;
    ['phone', 'email', 'emergencyName', 'emergencyPhone'].forEach((f) => {
      field(w, `p${idx(w)}.${f}`)!.value = val(src, `p${firstIdx}.${f}`);
    });
  });
  // Clear an error as soon as the person fixes the field.
  form.addEventListener('input', (e) => {
    const t = e.target as HTMLElement;
    const key = t.dataset.key;
    if (key && t.getAttribute('aria-invalid') === 'true') setError(key.endsWith('healthNotes') ? key.replace('healthNotes', 'health') : key, null);
  });
  $$<HTMLButtonElement>('[data-next]').forEach((b) =>
    b.addEventListener('click', () => {
      clearErrors();
      const to = Number(b.dataset.next);
      const bad = validateUpTo(to - 1);
      if (bad) {
        if (bad.step !== step) go(bad.step);
        return showErrors(bad.errs);
      }
      go(to);
    }),
  );
  $$<HTMLButtonElement>('[data-prev]').forEach((b) => b.addEventListener('click', () => (clearErrors(), go(Number(b.dataset.prev)))));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();
    const bad = validateUpTo(3);
    if (bad) {
      if (bad.step !== step) go(bad.step);
      return showErrors(bad.errs);
    }
    const participants = participantEls().map((p) => {
      const i = idx(p);
      const w = $<HTMLElement>(`.waiver[data-index="${i}"]`, wList)!;
      const minor = isMinor(p);
      return {
        fullName: val(p, `p${i}.fullName`),
        dateOfBirth: val(p, `p${i}.dateOfBirth`),
        sessionIds: selectedSessions(p),
        phone: val(w, `p${i}.phone`),
        email: val(w, `p${i}.email`),
        emergencyName: val(w, `p${i}.emergencyName`),
        emergencyPhone: val(w, `p${i}.emergencyPhone`),
        healthNone: field(w, `p${i}.healthNone`)!.checked,
        healthNotes: field(w, `p${i}.healthNone`)!.checked ? '' : val(w, `p${i}.healthNotes`),
        acknowledgements: Object.fromEntries(ACK_KEYS.map((k) => [k, $<HTMLInputElement>(`[data-ack="${k}"]`, w)!.checked])),
        signature: val(w, `p${i}.signature`),
        guardianName: minor ? val(w, `p${i}.guardianName`) : '',
        guardianRelationship: minor ? val(w, `p${i}.guardianRelationship`) : '',
        guardianSignature: minor ? val(w, `p${i}.guardianSignature`) : '',
      };
    });
    // Server keys use the position in this list; map them back to our stable indexes.
    const order = participantEls().map(idx);
    const body = {
      participants,
      booker: { name: val(form!, 'booker.name'), email: val(form!, 'booker.email'), phone: val(form!, 'booker.phone') },
      waiverVersion: cfg.waiverVersion,
    };
    const btn = $<HTMLButtonElement>('#submit-btn')!;
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Booking…';
    try {
      const res = await fetch('/api/book', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.redirect) {
        window.location.href = data.redirect;
        return;
      }
      if (data.soldOut) {
        // Someone else took the spots: reload fresh counts, keep it simple.
        summaryBox.innerHTML = `${esc(data.error)} <a href="/book">Reload the schedule</a>.`;
        summaryBox.hidden = false;
        summaryBox.focus();
        return;
      }
      const mapped: Record<string, string> = {};
      Object.entries((data.fields ?? {}) as Record<string, string>).forEach(([k, m]) => {
        mapped[k.replace(/^p(\d+)\./, (_, n) => `p${order[Number(n)]}.`)] = m;
      });
      const firstKey = Object.keys(mapped)[0] ?? '';
      const target = /\.(fullName|dateOfBirth|sessions)$/.test(firstKey) ? 1 : firstKey.startsWith('p') ? 2 : 3;
      if (firstKey && target !== step) go(target);
      showErrors(mapped, data.error ?? 'Something went wrong. Please try again.');
    } catch {
      summaryBox.textContent = 'Could not reach the server. Check your connection and try again.';
      summaryBox.hidden = false;
      summaryBox.focus();
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  });

  addParticipant();
}
