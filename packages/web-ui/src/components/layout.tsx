import { NavLink } from "react-router-dom";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Layout({ children, width = "default" }: { children: ReactNode; width?: "default" | "wide" }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line/80 bg-paper/90">
        <div className={cn("mx-auto flex items-center gap-4 px-4 py-3", width === "wide" ? "max-w-[1400px]" : "max-w-6xl")}>
          <NavLink to="/" className="font-serif text-2xl tracking-tight text-ink">
            Workstate
          </NavLink>
          <nav className="flex items-center gap-1 text-sm">
            <TopLink to="/">Environments</TopLink>
            <TopLink to="/runs">Runs</TopLink>
          </nav>
          <p className="ml-auto hidden font-mono text-[11px] text-muted sm:block">local control plane</p>
        </div>
      </header>
      <main className={cn("mx-auto px-4 py-6", width === "wide" ? "max-w-[1400px]" : "max-w-6xl")}>{children}</main>
    </div>
  );
}

function TopLink({ to, children }: { to: string; children: string }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        cn("rounded-full px-3 py-1.5", isActive ? "bg-ink text-paper" : "text-muted hover:text-ink")
      }
    >
      {children}
    </NavLink>
  );
}
