// The nine 2026 sessions. To add a term later, add rows here (or new seed file) and run `npm run db:seed`.
const DATES = ['2026-11-28', '2026-12-05', '2026-12-12'];
const SLOTS = [
  { time: '09:00', ageGroup: 'Ages 4–7', ageMin: 4, ageMax: 7 },
  { time: '10:00', ageGroup: 'Ages 8–12', ageMin: 8, ageMax: 12 },
  { time: '11:00', ageGroup: 'Teens & adults', ageMin: 13, ageMax: null },
];

export const SEED_SESSIONS = DATES.flatMap((date) =>
  SLOTS.map((s) => ({
    slug: `${date}-${s.time.replace(':', '')}`,
    startsAt: new Date(`${date}T${s.time}:00+08:00`), // AWST, no daylight saving
    durationMin: 60,
    ageGroup: s.ageGroup,
    ageMin: s.ageMin,
    ageMax: s.ageMax,
    capacity: 10,
    priceCents: 2000,
  })),
);
