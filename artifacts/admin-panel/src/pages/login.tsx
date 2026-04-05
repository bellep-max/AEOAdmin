import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { AlertCircle, Loader2 } from "lucide-react";

export default function Login() {
  const { login } = useAuth();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("admin@signalaeo.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      navigate("/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-bg min-h-screen flex items-center justify-center overflow-hidden relative">
      {/* Animated background orbs */}
      <div
        className="login-orb absolute top-1/4 left-1/6 w-[500px] h-[500px] rounded-full pointer-events-none"
        style={{
          background: "radial-gradient(circle, rgba(14,116,214,0.35) 0%, transparent 65%)",
          filter: "blur(60px)",
        }}
      />
      <div
        className="login-orb absolute bottom-1/4 right-1/6 w-[400px] h-[400px] rounded-full pointer-events-none"
        style={{
          background: "radial-gradient(circle, rgba(16,185,129,0.25) 0%, transparent 65%)",
          filter: "blur(55px)",
          animationDelay: "-4s",
        }}
      />
      <div
        className="login-orb absolute top-1/3 right-1/3 w-72 h-72 rounded-full pointer-events-none"
        style={{
          background: "radial-gradient(circle, rgba(56,189,248,0.12) 0%, transparent 65%)",
          filter: "blur(40px)",
          animationDelay: "-8s",
        }}
      />

      {/* Grid overlay */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.025]"
        style={{
          backgroundImage: `linear-gradient(hsl(215,20%,55%) 1px, transparent 1px),
                            linear-gradient(90deg, hsl(215,20%,55%) 1px, transparent 1px)`,
          backgroundSize: "48px 48px",
        }}
      />

      <div className="relative w-full max-w-sm px-4 fade-in-up">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="relative mb-4">
            <div className="w-14 h-14 rounded-2xl bg-[#0b1a2e] flex items-center justify-center shadow-xl border border-white/10"
              style={{ boxShadow: "0 0 30px rgba(37,99,235,0.4), 0 4px 16px rgba(0,0,0,0.4)" }}>
              <img src="/signal-aeo-logo.svg" alt="Signal AEO" className="w-8 h-7" />
            </div>
            <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-emerald-500 rounded-full border-2 border-[hsl(222,47%,8%)]">
              <span className="absolute inset-0 rounded-full bg-emerald-400 dot-ping" />
            </span>
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Signal AEO</h1>
          <p className="text-muted-foreground text-sm mt-1">Answer Engine Optimization</p>
        </div>

        {/* Card */}
        <div
          className="login-card-glow rounded-2xl border border-border/60 bg-card/80 backdrop-blur-xl p-8 shadow-2xl"
          style={{ boxShadow: "0 0 0 1px rgba(37,99,235,0.1), 0 24px 48px rgba(0,0,0,0.5)" }}
        >
          <h2 className="text-lg font-semibold text-foreground mb-1">Welcome back</h2>
          <p className="text-sm text-muted-foreground mb-6">Sign in to the operations dashboard</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@signalaeo.com"
                required
                className="h-10 bg-muted/40 border-border/60 focus:border-primary/60 transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="h-10 bg-muted/40 border-border/60 focus:border-primary/60 transition-colors"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-10 font-semibold mt-2"
              disabled={loading}
              style={{
                background: loading ? undefined : "linear-gradient(135deg, hsl(217,91%,55%), hsl(217,91%,65%))",
                boxShadow: loading ? undefined : "0 4px 16px rgba(37,99,235,0.3)",
              }}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 w-4 h-4 animate-spin" />
                  Signing in…
                </>
              ) : (
                "Sign In"
              )}
            </Button>
          </form>

          <div className="mt-6 pt-5 border-t border-border/40">
            <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
              <img src="/signal-aeo-logo.svg" alt="" className="w-3.5 h-3" />
              <span>
                Default: <span className="font-mono text-muted-foreground">admin@signalaeo.com</span>
                {" / "}
                <span className="font-mono text-muted-foreground">Admin123!</span>
              </span>
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground/50 mt-6">
          Signal AEO Platform © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
