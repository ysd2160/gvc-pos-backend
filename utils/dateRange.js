// The shop operates in India (IST, UTC+5:30). Date-only query params like
// "2026-09-06" (coming from <input type="date">) represent an IST calendar
// day, so we must compute that day's start/end as explicit IST instants.
//
// Why this matters: the old code did `new Date(to).setHours(23,59,59,999)`.
// `new Date("2026-09-06")` parses as UTC midnight, but `.setHours()` sets the
// time using the SERVER's local timezone. That mixes two different
// timezones in one calculation, so the actual UTC cutoff produced depends on
// where the server happens to be running (UTC host vs IST host give
// different, both wrong, answers). On an IST machine this pushes the "end of
// day" cutoff back by 5:30, silently excluding bills created in the last
// few hours of the day.
//
// Fix: build the boundary with an explicit "+05:30" offset in the ISO
// string, so the result is correct no matter what timezone the server runs
// in.
export const buildDateFilter = (from, to) => {
  const filter = {};
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(`${from}T00:00:00.000+05:30`);
    if (to) filter.createdAt.$lte = new Date(`${to}T23:59:59.999+05:30`);
  }
  return filter;
};
