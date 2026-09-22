import { prisma } from "@/lib/db/prisma";
import { logger, errorMessage } from "@/lib/logging/logger";
import { ackCallback, answerCallback, sendMessage } from "@/lib/max/client";
import type { MaxUpdate, Screen } from "@/lib/max/types";
import { decode, type Action, type AdminAction, type BookingAction } from "./callbacks";
import { handleAdminAction, handleAdminReplyText, handleAskText, startAskAdmin } from "./admin-flow";
import { rateLimit } from "@/lib/security/rate-limit";
import { handleAiText, startAi } from "./ai-flow";
import { isAiEnabled } from "@/lib/openai/client";
import { handleBookingAction, handleBookingText, type Actor } from "./booking-flow";
import * as screens from "./screens";
import { getSession, setSession } from "./session";

export interface Ctx {
  requestId: string;
  eventId: string;
}

interface Identity {
  maxUserId: number;
  chatId?: number;
  name?: string;
  username?: string;
}

async function upsertUser(who: Identity, source?: string | null) {
  const data = {
    maxChatId: who.chatId !== undefined ? BigInt(who.chatId) : undefined,
    name: who.name,
    username: who.username,
    blockedBot: false,
  };
  return prisma.user.upsert({
    where: { maxUserId: BigInt(who.maxUserId) },
    create: { maxUserId: BigInt(who.maxUserId), ...data, source: source ?? undefined },
    update: data,
  });
}

const LIMIT = 15; // событий
const WINDOW_SEC = 10;

async function passRateLimit(maxUserId: number): Promise<boolean> {
  const r = await rateLimit(`u:${maxUserId}`, LIMIT, WINDOW_SEC);
  if (r.count === LIMIT + 1) {
    await sendMessage({ userId: maxUserId }, { text: "Слишком много запросов. Пожалуйста, подождите несколько секунд." }).catch(() => undefined);
  }
  return r.allowed;
}

const COMMANDS: Record<string, Action> = {
  "/start": { kind: "menu" },
  "/menu": { kind: "menu" },
  "/booking": { kind: "bkStart" },
  "/services": { kind: "services" },
  "/masters": { kind: "masters" },
  "/promotions": { kind: "promos" },
  "/mybooking": { kind: "myList" },
  "/contacts": { kind: "contacts" },
  "/help": { kind: "faq" },
};

async function screenFor(action: Action, actor?: Actor): Promise<Screen> {
  if (action.kind.startsWith("bk") || action.kind.startsWith("my")) {
    if (!actor) return screens.technicalProblem();
    return handleBookingAction(action as BookingAction, actor);
  }
  if (action.kind === "aiStart") {
    if (!actor) return screens.technicalProblem();
    return startAi(actor);
  }
  if (action.kind === "askAdmin") {
    if (!actor) return screens.technicalProblem();
    return startAskAdmin(actor);
  }
  if (action.kind.startsWith("adm")) {
    if (!actor) return screens.technicalProblem();
    return handleAdminAction(action as AdminAction, actor);
  }
  switch (action.kind) {
    case "menu":
      if (actor) await setSession(actor.userId, "IDLE"); // выход из AI-диалога и др. сценариев
      return screens.mainMenu();
    case "services":
      return screens.servicesScreen();
    case "category":
      return screens.categoryScreen(action.id);
    case "service":
      return screens.serviceScreen(action.id);
    case "price":
      return screens.priceScreen();
    case "masters":
      return screens.mastersScreen();
    case "master":
      return screens.masterScreen(action.id);
    case "promos":
      return screens.promosScreen();
    case "contacts":
      return screens.contactsScreen();
    case "faq":
      return screens.faqScreen();
    case "faqItem":
      return screens.faqItemScreen(action.id);
    case "planned":
      return screens.plannedScreen();
    default:
      return screens.mainMenu();
  }
}

export async function handleUpdate(update: MaxUpdate, ctx: Ctx): Promise<void> {
  const started = Date.now();
  try {
    switch (update.update_type) {
      case "bot_started":
        return await onBotStarted(update);
      case "message_created":
        return await onMessage(update);
      case "message_callback":
        return await onCallback(update);
      case "bot_stopped":
      case "dialog_removed": {
        const id = update.user?.user_id;
        if (id !== undefined) await prisma.user.updateMany({ where: { maxUserId: BigInt(id) }, data: { blockedBot: true } });
        return;
      }
      default:
        logger.debug("update ignored", { ...ctx, operation: update.update_type });
    }
  } finally {
    logger.info("update handled", { ...ctx, operation: update.update_type, duration: Date.now() - started });
  }
}

async function onBotStarted(u: MaxUpdate) {
  if (!u.user) return;
  const user = await upsertUser(
    { maxUserId: u.user.user_id, chatId: u.chat_id, name: u.user.name ?? u.user.first_name ?? undefined, username: u.user.username ?? undefined },
    u.payload,
  );
  await prisma.analyticsEvent.create({ data: { userId: user.id, type: "bot_started", data: { source: u.payload ?? null } } });
  await setSession(user.id, "IDLE");
  const s = screens.greeting();
  await sendMessage({ userId: u.user.user_id }, { text: s.text, buttons: s.buttons });
}

async function onMessage(u: MaxUpdate) {
  const sender = u.message?.sender;
  if (!sender || sender.is_bot) return;
  // Только личные диалоги
  const chatType = u.message?.recipient?.chat_type;
  if (chatType && chatType !== "dialog") return;

  const user = await upsertUser({
    maxUserId: sender.user_id,
    chatId: u.message?.recipient?.chat_id ?? undefined,
    name: sender.name ?? sender.first_name ?? undefined,
    username: sender.username ?? undefined,
  });

  if (!(await passRateLimit(sender.user_id))) return;

  const text = (u.message?.body?.text ?? "").trim();
  const command = text.startsWith("/") ? text.split(/[\s@]/)[0]?.toLowerCase() : undefined;
  const actor: Actor = { userId: user.id, maxUserId: sender.user_id };

  // служебная команда: узнать свой MAX ID (нужен для ADMIN_MAX_USER_IDS)
  if (command === "/id") {
    await sendMessage({ userId: sender.user_id }, { text: `Ваш MAX ID: ${sender.user_id}` });
    return;
  }

  let s: Screen;
  try {
    const session = await getSession(user.id);
    if (!command && (session.state === "ENTER_NAME" || session.state === "ENTER_PHONE")) {
      s = (await handleBookingText(actor, text)) ?? screens.mainMenu();
    } else if (!command && session.state === "ASK_ADMIN") {
      s = await handleAskText(actor, text);
    } else if (!command && session.state === "ADMIN_REPLY") {
      s = (await handleAdminReplyText(actor, text)) ?? screens.mainMenu();
    } else if (!command && text && isAiEnabled() && ["IDLE", "AI_CHAT", "BOOKING_CREATED"].includes(session.state)) {
      s = await handleAiText(actor, text); // свободный текст -> AI-консультант (при выключенном AI показывается меню)
    } else {
      const action: Action = (command && COMMANDS[command]) || { kind: "menu" };
      if (action.kind === "menu") await setSession(user.id, "IDLE");
      s = command && !COMMANDS[command] ? screens.mainMenu() : await screenFor(action, actor);
    }
  } catch (e) {
    logger.error("message handling failed", { operation: "message_created", error: errorMessage(e) });
    s = screens.technicalProblem();
  }
  await sendMessage({ userId: sender.user_id }, { text: s.text, buttons: s.buttons });
}

async function onCallback(u: MaxUpdate) {
  const c = u.callback;
  if (!c) return;
  const maxUserId = c.user?.user_id ?? u.message?.recipient?.user_id ?? undefined;

  if (maxUserId !== undefined && !(await passRateLimit(maxUserId))) {
    await ackCallback(c.callback_id).catch(() => undefined);
    return;
  }

  const action = decode(c.payload);
  if (!action) {
    await ackCallback(c.callback_id).catch(() => undefined);
    return;
  }

  let screen: Screen;
  try {
    const user =
      maxUserId !== undefined
        ? await upsertUser({ maxUserId, name: c.user?.name ?? c.user?.first_name ?? undefined, username: c.user?.username ?? undefined })
        : undefined;
    screen = await screenFor(action, user && maxUserId !== undefined ? { userId: user.id, maxUserId } : undefined);
  } catch (e) {
    logger.error("screen failed", { operation: action.kind, error: errorMessage(e) });
    screen = screens.technicalProblem();
  }

  try {
    const res = await answerCallback(c.callback_id, { text: screen.text, buttons: screen.buttons });
    if (res.success !== false) return;
  } catch (e) {
    logger.warn("answerCallback failed, falling back to sendMessage", { error: errorMessage(e) });
  }
  if (maxUserId !== undefined) await sendMessage({ userId: maxUserId }, { text: screen.text, buttons: screen.buttons });
}
