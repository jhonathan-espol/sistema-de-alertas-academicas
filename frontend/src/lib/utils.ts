import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("es-EC", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString("es-EC", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function severityColor(severity: string): string {
  switch (severity) {
    case "critica":
      return "bg-red-100 text-red-800 border border-red-200";
    case "alta":
      return "bg-orange-100 text-orange-800 border border-orange-200";
    case "media":
      return "bg-amber-100 text-amber-800 border border-amber-200";
    case "baja":
      return "bg-green-100 text-green-800 border border-green-200";
    default:
      return "bg-gray-100 text-gray-800 border border-gray-200";
  }
}

export function statusColor(status: string): string {
  switch (status) {
    case "activa":
      return "bg-green-100 text-green-800 border border-green-200";
    case "resuelta":
      return "bg-blue-100 text-blue-800 border border-blue-200";
    case "archivada":
      return "bg-gray-100 text-gray-800 border border-gray-200";
    default:
      return "bg-gray-100 text-gray-800 border border-gray-200";
  }
}

export function roleLabel(role: string): string {
  switch (role) {
    case "administrador":
      return "Administrador";
    case "invitado":
      return "Invitado";
    default:
      return role;
  }
}
