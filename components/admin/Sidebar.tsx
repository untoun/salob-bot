"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/app/admin/login/actions";

export interface NavItem {
  href: string;
  label: string;
}

export function Sidebar({ items, name, role, csrf }: { items: NavItem[]; name: string; role: string; csrf: string }) {
  const path = usePathname();
  return (
    <aside className="side">
      <div className="brand">{name}</div>
      <nav className="nav" aria-label="Разделы">
        {items.map((i) => {
          const active = i.href === "/admin" ? path === "/admin" : path.startsWith(i.href);
          return (
            <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined}>
              {i.label}
            </Link>
          );
        })}
      </nav>
      <div className="who">
        {role}
        <form action={logout}>
          <input type="hidden" name="_csrf" value={csrf} />
          <button className="linkbtn" type="submit">
            Выйти
          </button>
        </form>
      </div>
    </aside>
  );
}
