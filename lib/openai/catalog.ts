import { DateTime } from "luxon";
import { env } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";
import type { Catalog } from "./prompt";

/**
 * В OpenAI уходит ТОЛЬКО публичный каталог салона: услуги, мастера, FAQ, акции.
 * Никаких клиентов, телефонов, записей, токенов и внутренних id пользователей.
 */
export async function loadCatalog(): Promise<Catalog> {
  const e = env();
  const now = new Date();
  const [services, masters, faq, promos] = await Promise.all([
    prisma.service.findMany({ where: { active: true, isAddon: false }, include: { category: true }, orderBy: { sortOrder: "asc" } }),
    prisma.master.findMany({ where: { active: true }, include: { services: { select: { serviceId: true } } }, orderBy: { name: "asc" } }),
    prisma.fAQ.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, take: 30 }),
    prisma.promotion.findMany({ where: { active: true, startsAt: { lte: now }, endsAt: { gte: now } }, take: 10 }),
  ]);
  return {
    salon: { name: e.SALON_NAME, address: e.SALON_ADDRESS, phone: e.SALON_PHONE },
    services: services.map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category.name,
      description: s.description,
      priceRub: s.priceRub,
      priceFrom: s.priceFrom,
      durationMin: s.durationMin,
    })),
    masters: masters.map((m) => ({ id: m.id, name: m.name, specialization: m.specialization, serviceIds: m.services.map((x) => x.serviceId) })),
    faq: faq.map((f) => ({ q: f.question, a: f.answer })),
    promos: promos.map((p) => ({
      title: p.title,
      description: p.description,
      until: DateTime.fromJSDate(p.endsAt, { zone: e.SALON_TIMEZONE }).toFormat("yyyy-MM-dd"),
    })),
  };
}
