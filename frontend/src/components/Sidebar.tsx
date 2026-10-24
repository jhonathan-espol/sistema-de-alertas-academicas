"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  GraduationCap,
  BarChart3,
  Users,
  Settings,
  LogOut,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isAdmin, getUser, removeToken } from "@/lib/auth";

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Entrenamiento", href: "/dashboard/entrenamiento", icon: GraduationCap },
  { name: "Resultados", href: "/dashboard/resultados", icon: BarChart3 },
  { name: "Usuarios", href: "/dashboard/usuarios", icon: Users, adminOnly: true },
  { name: "Configuración", href: "/dashboard/configuracion", icon: Settings },
];

export default function Sidebar({ mobileOpen = false, onClose = () => {} }: { mobileOpen?: boolean; onClose?: () => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const user = getUser();

  return (
    <aside className={cn("fixed left-0 top-0 z-40 h-screen w-64 border-r border-gray-200 bg-white transition-transform duration-300 sm:relative sm:translate-x-0", mobileOpen ? "translate-x-0" : "-translate-x-full", collapsed ? "lg:w-[76px]" : "lg:w-64")}>
      <div className="flex h-16 items-center justify-between px-6 bg-white border-b border-gray-200">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center text-white font-bold text-lg">
            A
          </div>
          <span className={cn("font-bold text-gray-900", collapsed ? "hidden" : "block")}>
            Alertas
          </span>
        </div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={cn("p-2 rounded-md text-gray-500 hover:bg-gray-100", collapsed ? "lg:hidden" : "hidden sm:block")}
          aria-label="Abrir menú"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>

      <nav className="mt-6 px-3 space-y-1">
        {navigation.map((item) => {
          if (item.adminOnly && !isAdmin()) return null;
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.name}
              href={item.href}
              onClick={onClose}
              className={cn(
                "flex items-center gap-3 px-3 py-3 text-sm font-medium rounded-lg transition-colors",
                isActive
                  ? "bg-emerald-50 text-emerald-700"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              )}
            >
              <Icon className="w-5 h-5" />
              <span className={cn(collapsed ? "hidden" : "block")}>{item.name}</span>
              {!isActive && <ChevronRight className={cn("w-4 h-4 ml-auto text-gray-400", collapsed ? "hidden" : "block")} />}
            </Link>
          );
        })}
      </nav>

      <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-200 bg-white">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 text-sm font-medium">
            {user?.username?.[0]?.toUpperCase() || "U"}
          </div>
          <div className={cn("flex-1 min-w-0", collapsed ? "hidden" : "block")}>
            <p className="text-sm font-medium text-gray-900 truncate">{user?.username || "Usuario"}</p>
            <p className="text-xs text-gray-500 truncate">{roleLabel(user?.role)}</p>
          </div>
          <button
            onClick={() => {
              removeToken();
              window.location.href = "/login";
            }}
            className={cn("p-2 rounded-md text-gray-500 hover:bg-gray-100", collapsed ? "hidden" : "block")}
            aria-label="Cerrar sesión"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}

function roleLabel(role: string | undefined): string {
  switch (role) {
    case "administrador":
      return "Administrador";
    case "invitado":
      return "Invitado";
    default:
      return "Usuario";
  }
}
