import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Shield, UserPlus, Building2, Check } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Badge, Button, Card, Input, PageHeader, SectionTitle, Select } from "@/components/ui-bits";
import { CUSTOMERS } from "@/data/customers";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin-access")({
  head: () => ({
    meta: [
      { title: "Accounts & access — FreDA admin" },
      { name: "description", content: "Manage FreDA accounts, invite users and control per-workspace access levels for viewers, reviewers, owners and admins." },
      { property: "og:title", content: "Accounts & access — FreDA admin" },
      { property: "og:description", content: "Manage FreDA accounts, invite users and control per-workspace access levels." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AdminAccessPage,
});

type AccessRole = "Viewer" | "Reviewer" | "Owner" | "Admin";

const ROLES: AccessRole[] = ["Viewer", "Reviewer", "Owner", "Admin"];

const ROLE_RIGHTS: Record<AccessRole, string> = {
  Viewer: "Read dashboard, monitor and download completed files",
  Reviewer: "Everything in Viewer + approve/reject records in review",
  Owner: "Everything in Reviewer + create projects, sources and schedules",
  Admin: "Full FreDA console: all workspaces, users and build requests",
};

type UserRow = { id: string; name: string; email: string; account: string; role: AccessRole; status: "Active" | "Invited" };

const SEED: UserRow[] = [
  { id: "u1", name: "Priya Nair", email: "priya.nair@freda.ai", account: "All workspaces", role: "Admin", status: "Active" },
  { id: "u2", name: "Daniel Roy", email: "daniel.roy@ntmglobal.com", account: CUSTOMERS[0]!.name, role: "Owner", status: "Active" },
  { id: "u3", name: "Mei Chen", email: "mei.chen@ntmglobal.com", account: CUSTOMERS[0]!.name, role: "Reviewer", status: "Active" },
  { id: "u4", name: "Arun Sethi", email: "arun.sethi@cengage.com", account: CUSTOMERS[1]?.name ?? "Cengage", role: "Reviewer", status: "Active" },
  { id: "u5", name: "Laura Weiss", email: "laura.weiss@candid.io", account: CUSTOMERS[2]?.name ?? "Candid", role: "Viewer", status: "Invited" },
];

function AdminAccessPage() {
  const [users, setUsers] = useState<UserRow[]>(SEED);
  const [account, setAccount] = useState("all");
  const [invite, setInvite] = useState({ email: "", account: CUSTOMERS[0]!.name, role: "Viewer" as AccessRole });

  const filtered = account === "all" ? users : users.filter((u) => u.account === account);

  function setRole(id: string, role: AccessRole) {
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, role } : u)));
  }

  function sendInvite() {
    if (!invite.email.trim()) return;
    setUsers((prev) => [
      ...prev,
      {
        id: `u${prev.length + 1}`,
        name: invite.email.split("@")[0]!.replace(/[._]/g, " "),
        email: invite.email,
        account: invite.account,
        role: invite.role,
        status: "Invited",
      },
    ]);
    setInvite({ ...invite, email: "" });
  }

  return (
    <AdminLayout>
      <PageHeader title="Accounts & access" subtitle="Accounts, users and per-workspace access levels" />

      <div className="grid xl:grid-cols-[1.7fr_1fr] gap-5 items-start">
        <Card className="overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border flex flex-wrap items-center gap-3">
            <div>
              <h3 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">Users</h3>
              <p className="text-[12px] text-muted-foreground mt-0.5">Access level controls what each user can do inside a workspace.</p>
            </div>
            <Select className="ml-auto w-[220px]" value={account} onChange={(e) => setAccount(e.target.value)}>
              <option value="all">All accounts</option>
              <option value="All workspaces">FreDA internal</option>
              {CUSTOMERS.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <th className="px-5 py-2 font-semibold">User</th>
                <th className="px-3 py-2 font-semibold">Account</th>
                <th className="px-3 py-2 font-semibold w-[170px]">Access level</th>
                <th className="px-5 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id} className="border-b border-border/60">
                  <td className="px-5 py-3">
                    <div className="font-medium capitalize">{u.name}</div>
                    <div className="text-[11px] text-muted-foreground">{u.email}</div>
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">{u.account}</td>
                  <td className="px-3 py-3">
                    <Select value={u.role} onChange={(e) => setRole(u.id, e.target.value as AccessRole)}>
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="px-5 py-3">
                    <Badge tone={u.status === "Active" ? "success" : "warning"}>{u.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <div className="space-y-5">
          <Card className="p-5">
            <SectionTitle hint="access matrix">Role permissions</SectionTitle>
            <div className="space-y-2 mt-3">
              {ROLES.map((r) => (
                <div key={r} className={cn("rounded-lg border border-border p-3")}>
                  <div className="flex items-center gap-2 text-[13px] font-semibold">
                    <Shield className="h-3.5 w-3.5 text-info" /> {r}
                  </div>
                  <div className="text-[11.5px] text-muted-foreground mt-1">{ROLE_RIGHTS[r]}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <SectionTitle hint="email invite">Invite a user</SectionTitle>
            <div className="space-y-3 mt-3">
              <Input placeholder="name@company.com" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
              <Select value={invite.account} onChange={(e) => setInvite({ ...invite, account: e.target.value })}>
                {CUSTOMERS.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <Select value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value as AccessRole })}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
              <Button size="sm" className="w-full justify-center" onClick={sendInvite}>
                <UserPlus className="h-3.5 w-3.5" /> Send invite
              </Button>
            </div>
          </Card>

          <Card className="p-5">
            <SectionTitle>Accounts</SectionTitle>
            <div className="space-y-2 mt-3">
              {CUSTOMERS.map((c) => (
                <div key={c.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                  <Building2 className="h-3.5 w-3.5 text-info shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-medium truncate">{c.name}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {c.industry} · {c.projects.length} projects
                    </div>
                  </div>
                  <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                    <Check className="h-3 w-3 text-success" /> {users.filter((u) => u.account === c.name).length} users
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}
