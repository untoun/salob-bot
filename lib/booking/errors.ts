export class SlotTakenError extends Error {
  constructor() {
    super("slot_taken");
    this.name = "SlotTakenError";
  }
}

export class BookingValidationError extends Error {
  constructor(public reason: string) {
    super(`booking_invalid:${reason}`);
    this.name = "BookingValidationError";
  }
}
