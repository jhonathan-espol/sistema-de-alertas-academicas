"use client";

import { Bell, HelpCircle, Menu, Search } from "lucide-react";

export default function Navbar({ onMenuClick = () => {} }: { onMenuClick?: () => void }) {

  return (
    <header className="sticky top-0 z-30 w-full bg-white border-b border-gray-200">
      <div className="flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-4">
          <button
            onClick={onMenuClick}
            className="p-2 md:hidden text-gray-600 hover:bg-gray-100 rounded-md"
            aria-label="Menú"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>

        <div className="hidden md:flex items-center gap-1 w-full max-w-md">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar alertas, usuarios o notas..."
              className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button className="p-2 text-gray-600 hover:bg-gray-100 rounded-md" aria-label="Ayuda">
            <HelpCircle className="w-5 h-5" />
          </button>
          <button className="relative p-2 text-gray-600 hover:bg-gray-100 rounded-md" aria-label="Notificaciones">
            <Bell className="w-5 h-5" />
            <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full"></span>
          </button>
        </div>
      </div>
    </header>
  );
}
