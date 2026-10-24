const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

export async function apiRequest(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;

  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  return response;
}

export async function apiJson<T = unknown>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await apiRequest(endpoint, options);

  if (!response.ok) {
    const errorData: { detail?: string } = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Error ${response.status}`);
  }

  if (response.status === 204) return undefined as T;
  return response.json();
}

export interface User {
  id: string;
  username: string;
  email: string;
  role: string;
  is_active: boolean;
  created_at: string;
}

export interface Alert {
  id: string;
  title: string;
  description?: string;
  severity: string;
  status: string;
  created_by?: string;
  assigned_to?: string;
  created_at: string;
  updated_at: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  user: {
    id: string;
    username: string;
    email: string;
    role: string;
  };
}

export const authApi = {
  login: (username: string, password: string) =>
    apiJson<LoginResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
};

export const usersApi = {
  list: () => apiJson<User[]>("/api/users"),
  create: (data: { username: string; email: string; password: string; role: string }) =>
    apiJson<User>("/api/users", { method: "POST", body: JSON.stringify(data) }),
  get: (id: string) => apiJson<User>(`/api/users/${id}`),
  update: (id: string, data: Partial<User>) =>
    apiJson<User>(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  changePassword: (id: string, password: string) =>
    apiJson(`/api/users/${id}/change-password`, {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  delete: (id: string) =>
    apiJson(`/api/users/${id}`, { method: "DELETE" }),
};

export const alertsApi = {
  list: () => apiJson<Alert[]>("/api/alerts"),
  create: (data: Partial<Alert>) =>
    apiJson<Alert>("/api/alerts", { method: "POST", body: JSON.stringify(data) }),
  get: (id: string) => apiJson<Alert>(`/api/alerts/${id}`),
  update: (id: string, data: Partial<Alert>) =>
    apiJson<Alert>(`/api/alerts/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (id: string) =>
    apiJson(`/api/alerts/${id}`, { method: "DELETE" }),
};
