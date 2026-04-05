import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { User, Mail, ShieldCheck, Hash, KeyRound, Loader2, CheckCircle2 } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function Profile() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword]         = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving]                   = useState(false);

  if (!user) return null;

  const initials = user.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    if (newPassword.length < 8) {
      toast({ title: "Password must be at least 8 characters", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const r = await fetch(`${BASE}/api/auth/change-password`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to change password");
      }
      toast({ title: "Password updated successfully" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 py-4">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">My Profile</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your account information</p>
      </div>

      {/* Avatar + identity card */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-6">
        <div className="flex items-center gap-5">
          <div className="w-20 h-20 rounded-2xl bg-primary/20 flex items-center justify-center text-3xl font-bold text-primary select-none shrink-0">
            {initials}
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground">{user.name}</p>
            <p className="text-base text-muted-foreground">{user.email}</p>
            <Badge className="mt-2 capitalize bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-700/50 hover:bg-blue-100 dark:hover:bg-blue-900/30">
              <ShieldCheck className="w-3 h-3 mr-1" />
              {user.role}
            </Badge>
          </div>
        </div>

        <Separator />

        {/* Info grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { icon: User,        label: "Full Name",     value: user.name },
            { icon: Mail,        label: "Email Address", value: user.email },
            { icon: ShieldCheck, label: "Role",          value: user.role.charAt(0).toUpperCase() + user.role.slice(1) },
            { icon: Hash,        label: "Account ID",    value: `#${user.id}` },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="rounded-lg border border-border bg-background px-4 py-3 space-y-1">
              <div className="flex items-center gap-1.5 text-xs uppercase tracking-widest text-muted-foreground font-semibold">
                <Icon className="w-3.5 h-3.5" />
                {label}
              </div>
              <p className="text-base font-semibold text-foreground break-all">{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Change password */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-5">
        <div className="flex items-center gap-2">
          <KeyRound className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">Change Password</h2>
        </div>

        <form onSubmit={handleChangePassword} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold uppercase tracking-widest text-foreground">Current Password</Label>
            <Input
              type="password"
              className="h-11 bg-background border-border text-base"
              placeholder="Enter current password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold uppercase tracking-widest text-foreground">New Password</Label>
            <Input
              type="password"
              className="h-11 bg-background border-border text-base"
              placeholder="At least 8 characters"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold uppercase tracking-widest text-foreground">Confirm New Password</Label>
            <Input
              type="password"
              className="h-11 bg-background border-border text-base"
              placeholder="Repeat new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>
          <Button
            type="submit"
            disabled={saving || !currentPassword || !newPassword || !confirmPassword}
            className="w-full h-11 text-base font-bold gap-2"
            style={{ background: "linear-gradient(135deg,hsl(217,91%,55%),hsl(217,91%,65%))" }}
          >
            {saving ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
            ) : (
              <><CheckCircle2 className="w-4 h-4" /> Update Password</>
            )}
          </Button>
        </form>
      </div>

    </div>
  );
}
