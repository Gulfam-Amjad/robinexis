export interface FakeCalendarBooking {
  uid: string;
  eventTypeSlug: string;
  start: string;
  attendeeName: string;
  notes?: string;
  cancelled?: boolean;
}

export class FakeCalendar {
  slots: string[];
  bookings = new Map<string, FakeCalendarBooking>();
  notes: Record<string, string> = {};

  constructor(slots: string[] = ["2026-09-01T10:00:00.000Z", "2026-09-01T11:00:00.000Z"]) {
    this.slots = slots;
  }

  check(eventTypeSlug: string) {
    void eventTypeSlug;
    return { slots: [...this.slots] };
  }

  create(input: Omit<FakeCalendarBooking, "uid" | "cancelled"> & { uid?: string }) {
    const uid = input.uid ?? `bk_${this.bookings.size + 1}`;
    const row: FakeCalendarBooking = { ...input, uid, cancelled: false };
    this.bookings.set(uid, row);
    return { uid, status: "accepted" };
  }

  reschedule(uid: string, newStart: string) {
    const b = this.bookings.get(uid);
    if (!b || b.cancelled) throw new Error("booking_not_found");
    b.start = newStart;
    return { uid, status: "rescheduled" };
  }

  cancel(uid: string) {
    const b = this.bookings.get(uid);
    if (!b) throw new Error("booking_not_found");
    b.cancelled = true;
    return { status: "cancelled" };
  }

  appendNote(uid: string, note: string) {
    this.notes[uid] = (this.notes[uid] ? this.notes[uid] + "\n---\n" : "") + note;
    return { appended: true };
  }
}
