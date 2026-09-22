import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  if ((await prisma.service.count()) > 0) {
    console.log("Данные уже есть, seed пропущен");
    return;
  }
  const women = await prisma.serviceCategory.create({ data: { name: "Женские стрижки", sortOrder: 1 } });
  const men = await prisma.serviceCategory.create({ data: { name: "Мужские стрижки", sortOrder: 2 } });
  const color = await prisma.serviceCategory.create({ data: { name: "Окрашивание", sortOrder: 3 } });
  const care = await prisma.serviceCategory.create({ data: { name: "Дополнительные услуги", sortOrder: 4 } });

  const wCut = await prisma.service.create({ data: { categoryId: women.id, name: "Женская стрижка", description: "Стрижка с мытьём и укладкой", priceRub: 1500, durationMin: 60 } });
  const mCut = await prisma.service.create({ data: { categoryId: men.id, name: "Мужская стрижка", priceRub: 1000, durationMin: 45 } });
  const dye = await prisma.service.create({ data: { categoryId: color.id, name: "Окрашивание", description: "Цена зависит от длины волос", priceRub: 3500, priceFrom: true, durationMin: 180 } });
  await prisma.service.create({ data: { categoryId: care.id, name: "Уход для волос", priceRub: 500, durationMin: 15, isAddon: true } });

  const anna = await prisma.master.create({ data: { name: "Анна", specialization: "Женские стрижки", experienceYears: 8, rating: 4.9 } });
  const maria = await prisma.master.create({ data: { name: "Мария", specialization: "Окрашивание", experienceYears: 6, rating: 4.8 } });
  await prisma.masterService.createMany({
    data: [
      { masterId: anna.id, serviceId: wCut.id },
      { masterId: anna.id, serviceId: mCut.id },
      { masterId: maria.id, serviceId: dye.id },
      { masterId: maria.id, serviceId: wCut.id },
    ],
  });

  // Анна: Пн/Вт/Пт 9–18, Чт 10–20, Сб 10–16; Ср, Вс — выходной. Перерыв 13:00–14:00.
  const day = (weekday: number, s: number, e: number) => ({ masterId: anna.id, weekday, startMin: s * 60, endMin: e * 60, breakStartMin: 13 * 60, breakEndMin: 14 * 60 });
  await prisma.schedule.createMany({ data: [day(1, 9, 18), day(2, 9, 18), day(4, 10, 20), day(5, 9, 18), day(6, 10, 16)] });
  await prisma.schedule.createMany({
    data: [1, 2, 3, 4, 5].map((w) => ({ masterId: maria.id, weekday: w, startMin: 10 * 60, endMin: 19 * 60, breakStartMin: 14 * 60, breakEndMin: 15 * 60 })),
  });

  await prisma.fAQ.createMany({
    data: [
      { question: "Можно ли оплатить картой?", answer: "Да, принимаем карты и наличные.", sortOrder: 1 },
      { question: "Можно ли отменить запись?", answer: "Да, через раздел «Моя запись». Просим отменять не позднее чем за 2 часа.", sortOrder: 2 },
      { question: "Есть ли парковка?", answer: "Уточните у администратора — мы подскажем ближайшую парковку.", sortOrder: 3 },
    ],
  });
  console.log("Seed выполнен");
}

main().finally(() => prisma.$disconnect());
