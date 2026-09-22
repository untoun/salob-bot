// Callback payload короткий: `<действие>[:<аргумент>]`. Состояние сценария хранится в БД (BotSession).
// ID самого нажатия (callback_id) выдаёт MAX; по нему события дедуплицируются в WebhookEvent.
const ID = /^[A-Za-z0-9_-]{8,40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type PlannedSection = "portfolio" | "ask" | "admin";
export type BackStep = "cat" | "svc" | "master" | "date";

export type Action =
  | { kind: "menu" }
  | { kind: "services" }
  | { kind: "category"; id: string }
  | { kind: "service"; id: string }
  | { kind: "price" }
  | { kind: "masters" }
  | { kind: "master"; id: string }
  | { kind: "promos" }
  | { kind: "contacts" }
  | { kind: "faq" }
  | { kind: "faqItem"; id: string }
  | { kind: "planned"; section: PlannedSection }
  // запись
  | { kind: "bkStart" }
  | { kind: "bkCat"; id: string }
  | { kind: "bkSvc"; id: string }
  | { kind: "bkAddon"; id: string } // "0" — без допуслуги
  | { kind: "bkMaster"; id: string } // "any" или id мастера
  | { kind: "bkDate"; date: string }
  | { kind: "bkTime"; minutes: number }
  | { kind: "bkBack"; step: BackStep }
  | { kind: "bkConfirm" }
  | { kind: "bkEdit" }
  | { kind: "bkAbort" }
  // моя запись
  | { kind: "myList" }
  | { kind: "myItem"; id: string }
  | { kind: "myResched"; id: string }
  | { kind: "myCancelAsk"; id: string }
  | { kind: "myCancelYes"; id: string }
  // связь с администратором
  | { kind: "askAdmin" }
  | { kind: "aiStart" }
  | { kind: "admConfirm"; id: string }
  | { kind: "admCancelAsk"; id: string }
  | { kind: "admCancelYes"; id: string }
  | { kind: "admReply"; id: string }; // id — User.id клиента

export type AdminAction = Extract<Action, { kind: `adm${string}` }>;
export type BookingAction = Extract<Action, { kind: `bk${string}` | `my${string}` }>;

const pad = (n: number) => String(n).padStart(2, "0");

export const cb = {
  menu: "menu",
  services: "svc",
  category: (id: string) => `svc:c:${id}`,
  service: (id: string) => `svc:i:${id}`,
  price: "price",
  masters: "mst",
  master: (id: string) => `mst:${id}`,
  promos: "promo",
  contacts: "contacts",
  faq: "faq",
  faqItem: (id: string) => `faq:${id}`,
  planned: (s: PlannedSection) => `soon:${s}`,
  bkStart: "bk",
  bkCat: (id: string) => `bk:c:${id}`,
  bkSvc: (id: string) => `bk:s:${id}`,
  bkAddon: (id: string) => `bk:a:${id}`,
  bkMaster: (id: string) => `bk:m:${id}`,
  bkDate: (d: string) => `bk:d:${d}`,
  bkTime: (minutes: number) => `bk:t:${pad(Math.floor(minutes / 60))}${pad(minutes % 60)}`,
  bkBack: (s: BackStep) => `bk:b:${s}`,
  bkConfirm: "bk:ok",
  bkEdit: "bk:ed",
  bkAbort: "bk:x",
  myList: "my",
  myItem: (id: string) => `my:i:${id}`,
  myResched: (id: string) => `my:r:${id}`,
  myCancelAsk: (id: string) => `my:x:${id}`,
  myCancelYes: (id: string) => `my:y:${id}`,
  askAdmin: "ask",
  aiStart: "ai",
  admConfirm: (id: string) => `adm:ok:${id}`,
  admCancelAsk: (id: string) => `adm:x:${id}`,
  admCancelYes: (id: string) => `adm:y:${id}`,
  admReply: (id: string) => `adm:r:${id}`,
} as const;

const PLANNED = new Set<string>(["portfolio", "ask", "admin"]);
const BACK = new Set<string>(["cat", "svc", "master", "date"]);

export function decode(payload: string | null | undefined): Action | null {
  if (!payload || payload.length > 100) return null;
  const [a, b, c] = payload.split(":");
  switch (a) {
    case "menu":
      return { kind: "menu" };
    case "svc":
      if (b === undefined) return { kind: "services" };
      if (b === "c" && c && ID.test(c)) return { kind: "category", id: c };
      if (b === "i" && c && ID.test(c)) return { kind: "service", id: c };
      return null;
    case "price":
      return { kind: "price" };
    case "mst":
      if (b === undefined) return { kind: "masters" };
      return ID.test(b) ? { kind: "master", id: b } : null;
    case "promo":
      return { kind: "promos" };
    case "contacts":
      return { kind: "contacts" };
    case "faq":
      if (b === undefined) return { kind: "faq" };
      return ID.test(b) ? { kind: "faqItem", id: b } : null;
    case "soon":
      return b && PLANNED.has(b) ? { kind: "planned", section: b as PlannedSection } : null;
    case "bk":
      switch (b) {
        case undefined:
          return { kind: "bkStart" };
        case "c":
          return c && ID.test(c) ? { kind: "bkCat", id: c } : null;
        case "s":
          return c && ID.test(c) ? { kind: "bkSvc", id: c } : null;
        case "a":
          return c === "0" || (c && ID.test(c)) ? { kind: "bkAddon", id: c } : null;
        case "m":
          return c === "any" || (c && ID.test(c)) ? { kind: "bkMaster", id: c } : null;
        case "d":
          return c && DATE.test(c) ? { kind: "bkDate", date: c } : null;
        case "t": {
          if (!c || !/^\d{4}$/.test(c)) return null;
          const h = Number(c.slice(0, 2));
          const m = Number(c.slice(2));
          return h < 24 && m < 60 ? { kind: "bkTime", minutes: h * 60 + m } : null;
        }
        case "b":
          return c && BACK.has(c) ? { kind: "bkBack", step: c as BackStep } : null;
        case "ok":
          return { kind: "bkConfirm" };
        case "ed":
          return { kind: "bkEdit" };
        case "x":
          return { kind: "bkAbort" };
        default:
          return null;
      }
    case "my":
      if (b === undefined) return { kind: "myList" };
      if (!c || !ID.test(c)) return null;
      if (b === "i") return { kind: "myItem", id: c };
      if (b === "r") return { kind: "myResched", id: c };
      if (b === "x") return { kind: "myCancelAsk", id: c };
      if (b === "y") return { kind: "myCancelYes", id: c };
      return null;
    case "ask":
      return { kind: "askAdmin" };
    case "ai":
      return { kind: "aiStart" };
    case "adm":
      if (!b || !c || !ID.test(c)) return null;
      if (b === "ok") return { kind: "admConfirm", id: c };
      if (b === "x") return { kind: "admCancelAsk", id: c };
      if (b === "y") return { kind: "admCancelYes", id: c };
      if (b === "r") return { kind: "admReply", id: c };
      return null;
    default:
      return null;
  }
}
