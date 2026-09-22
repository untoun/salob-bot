import { createHash } from "node:crypto";
import type { MaxUpdate } from "./types";

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * В Update нет собственного id события, поэтому строим стабильный ключ идемпотентности:
 * повторная доставка того же события даст тот же eventId.
 */
export function deriveEventId(u: MaxUpdate, payloadHash: string): string {
  switch (u.update_type) {
    case "message_created": {
      const mid = u.message?.body?.mid;
      if (mid) return `msg:${mid}`;
      break;
    }
    case "message_callback": {
      if (u.callback?.callback_id) return `cb:${u.callback.callback_id}`;
      break;
    }
    case "bot_started": {
      const uid = u.user?.user_id;
      if (uid !== undefined && u.timestamp !== undefined) return `bs:${uid}:${u.timestamp}`;
      break;
    }
  }
  return `${u.update_type}:${payloadHash.slice(0, 32)}`;
}
