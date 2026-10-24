"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usersApi, type User } from "@/lib/api";
import { formatDate, roleLabel } from "@/lib/utils";
import { Plus, ShieldCheck, UsersRound, KeyRound, Trash2, X, Pencil } from "lucide-react";

const emptyForm = { username: "", email: "", password: "", role: "invitado" };

export default function UsuariosPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState({ email: "", role: "invitado", is_active: true });
  const [passwordUser, setPasswordUser] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => { void loadUsers(); }, []);

  async function loadUsers() {
    try {
      const data = await usersApi.list();
      setUsers(data);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar los usuarios");
    } finally { setLoading(false); }
  }

  async function createUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setSuccess("");
    try {
      await usersApi.create(form);
      setCreating(false); setForm(emptyForm); setSuccess("Usuario creado correctamente."); await loadUsers();
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo crear el usuario"); }
    finally { setBusy(false); }
  }

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!passwordUser) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      await usersApi.changePassword(passwordUser.id, newPassword);
      setPasswordUser(null); setNewPassword(""); setSuccess(`Contraseña de ${passwordUser.username} actualizada.`);
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo cambiar la contraseña"); }
    finally { setBusy(false); }
  }

  async function updateUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editingUser) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      await usersApi.update(editingUser.id, editForm);
      setEditingUser(null); setSuccess(`Datos de ${editingUser.username} actualizados.`); await loadUsers();
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo actualizar el usuario"); }
    finally { setBusy(false); }
  }

  async function deleteUser(user: User) {
    if (!window.confirm(`¿Eliminar la cuenta de ${user.username}?`)) return;
    setError(""); setSuccess("");
    try { await usersApi.delete(user.id); setSuccess("Usuario eliminado."); await loadUsers(); }
    catch (err) { setError(err instanceof Error ? err.message : "No se pudo eliminar el usuario"); }
  }

  const admins = users.filter((user) => user.role === "administrador" && user.is_active).length;

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div><div className="eyebrow">ADMINISTRACIÓN</div><h1>Usuarios</h1><p>Administra accesos y credenciales del sistema.</p></div>
        <Button onClick={() => { setCreating(true); setError(""); }}><Plus className="mr-2 h-4 w-4" />Nuevo usuario</Button>
      </div>

      {error && <div className="notice notice-error" role="alert">{error}</div>}
      {success && <div className="notice notice-success" role="status">{success}</div>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card><CardContent className="flex items-center gap-4 p-5"><div className="metric-icon bg-emerald-50 text-emerald-700"><UsersRound /></div><div><div className="metric-label">Cuentas registradas</div><div className="metric-value">{users.length}</div></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-4 p-5"><div className="metric-icon bg-blue-50 text-blue-700"><ShieldCheck /></div><div><div className="metric-label">Administradores activos</div><div className="metric-value">{admins}</div></div></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Directorio de usuarios</CardTitle></CardHeader>
        <CardContent><div className="overflow-x-auto">
          <Table><TableHeader><TableRow><TableHead>Cuenta</TableHead><TableHead className="hidden md:table-cell">Correo</TableHead><TableHead>Rol</TableHead><TableHead className="hidden sm:table-cell">Estado</TableHead><TableHead className="hidden lg:table-cell">Creado</TableHead><TableHead className="text-right">Acciones</TableHead></TableRow></TableHeader>
            <TableBody>{loading ? <TableRow><TableCell colSpan={6} className="py-10 text-center text-gray-500">Cargando usuarios…</TableCell></TableRow> : users.length === 0 ? <TableRow><TableCell colSpan={6} className="py-10 text-center text-gray-500">Aún no hay usuarios.</TableCell></TableRow> : users.map((user) => <TableRow key={user.id}>
              <TableCell><span className="font-semibold text-slate-800">{user.username}</span><span className="block text-xs text-slate-400 md:hidden">{user.email}</span></TableCell>
              <TableCell className="hidden text-slate-500 md:table-cell">{user.email}</TableCell>
              <TableCell><Badge variant={user.role === "administrador" ? "default" : "info"}>{roleLabel(user.role)}</Badge></TableCell>
              <TableCell className="hidden sm:table-cell"><span className={`status-dot ${user.is_active ? "status-on" : "status-off"}`} />{user.is_active ? "Activo" : "Inactivo"}</TableCell>
              <TableCell className="hidden text-xs text-slate-500 lg:table-cell">{formatDate(user.created_at)}</TableCell>
              <TableCell><div className="flex justify-end gap-1">
                <Button variant="ghost" size="sm" onClick={() => { setEditingUser(user); setEditForm({ email: user.email, role: user.role, is_active: user.is_active }); setError(""); }} title="Editar usuario"><Pencil className="h-4 w-4" /></Button>
                <Button variant="outline" size="sm" onClick={() => { setPasswordUser(user); setNewPassword(""); setError(""); }} title="Cambiar contraseña"><KeyRound className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">Contraseña</span></Button>
                <Button variant="ghost" size="sm" onClick={() => void deleteUser(user)} title="Eliminar usuario"><Trash2 className="h-4 w-4 text-rose-600" /></Button>
              </div></TableCell>
            </TableRow>)}</TableBody>
          </Table></div>
        </CardContent>
      </Card>

      {(creating || editingUser || passwordUser) && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setCreating(false); setEditingUser(null); setPasswordUser(null); } }}>
        <Card className="modal-card" role="dialog" aria-modal="true" aria-labelledby="user-modal-title">
          <div className="flex items-start justify-between gap-4"><div><div className="eyebrow">{creating ? "NUEVA CUENTA" : editingUser ? "PERFIL DE ACCESO" : "SEGURIDAD"}</div><h2 id="user-modal-title" className="mt-1 text-xl font-bold text-slate-900">{creating ? "Crear usuario" : editingUser ? "Editar usuario" : "Cambiar contraseña"}</h2><p className="mt-1 text-sm text-slate-500">{creating ? "El acceso quedará guardado en Supabase." : editingUser ? `Cuenta: ${editingUser.username}` : `Cuenta: ${passwordUser?.username}`}</p></div><button className="icon-button" onClick={() => { setCreating(false); setEditingUser(null); setPasswordUser(null); }} aria-label="Cerrar"><X className="h-5 w-5" /></button></div>
          {creating ? <form className="mt-6 space-y-4" onSubmit={createUser}>
            <label className="form-label">Usuario<Input autoComplete="off" minLength={3} maxLength={100} required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></label>
            <label className="form-label">Correo electrónico<Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
            <label className="form-label">Contraseña temporal<Input type="password" minLength={10} required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /><span className="form-hint">Usa al menos 10 caracteres.</span></label>
            <label className="form-label">Rol<select className="form-select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="invitado">Invitado</option><option value="administrador">Administrador</option></select></label>
            <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="outline" onClick={() => setCreating(false)}>Cancelar</Button><Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Crear usuario"}</Button></div>
          </form> : editingUser ? <form className="mt-6 space-y-4" onSubmit={updateUser}>
            <label className="form-label">Correo electrónico<Input type="email" required value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} /></label>
            <label className="form-label">Rol<select className="form-select" value={editForm.role} onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}><option value="invitado">Invitado</option><option value="administrador">Administrador</option></select></label>
            <label className="flex items-center justify-between rounded-lg border border-slate-100 p-3 text-sm font-medium text-slate-700">Cuenta activa<Switch type="checkbox" checked={editForm.is_active} onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })} aria-label="Cuenta activa" /></label>
            <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="outline" onClick={() => setEditingUser(null)}>Cancelar</Button><Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar cambios"}</Button></div>
          </form> : <form className="mt-6 space-y-4" onSubmit={changePassword}>
            <label className="form-label">Nueva contraseña<Input type="password" minLength={10} required autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /><span className="form-hint">Usa al menos 10 caracteres.</span></label>
            <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="outline" onClick={() => setPasswordUser(null)}>Cancelar</Button><Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Actualizar contraseña"}</Button></div>
          </form>}
        </Card>
      </div>}
    </div>
  );
}
