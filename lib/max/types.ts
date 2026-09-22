import { z } from "zod";

// Разбор намеренно мягкий (passthrough): MAX может добавлять поля.
// Проверьте формат на реальных событиях (первые вебхуки логируются с типом события).
const userSchema = z
  .object({
    user_id: z.number(),
    name: z.string().nullish(),
    first_name: z.string().nullish(),
    username: z.string().nullish(),
    is_bot: z.boolean().nullish(),
  })
  .passthrough();

export const updateSchema = z
  .object({
    update_type: z.string(),
    timestamp: z.number().optional(),
    chat_id: z.number().optional(),
    user: userSchema.optional(),
    payload: z.string().nullish(), // bot_started: deep-link payload
    message: z
      .object({
        sender: userSchema.optional(),
        recipient: z
          .object({
            chat_id: z.number().nullish(),
            user_id: z.number().nullish(),
            chat_type: z.string().nullish(),
          })
          .passthrough()
          .optional(),
        body: z
          .object({ mid: z.string().optional(), text: z.string().nullish() })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
    callback: z
      .object({
        callback_id: z.string(),
        payload: z.string().nullish(),
        user: userSchema.optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type MaxUpdate = z.infer<typeof updateSchema>;

export type Button =
  | { type: "callback"; text: string; payload: string; intent?: "default" | "positive" | "negative" }
  | { type: "link"; text: string; url: string };

export interface Screen {
  text: string;
  buttons: Button[][];
}
