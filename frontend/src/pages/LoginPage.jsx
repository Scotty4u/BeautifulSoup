import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import axios from "axios";

function Login() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setLoading] = useState(false);

  const navigate = useNavigate();
  const googleMessages = {
    unavailable: "Google login hasn't been configured on the server yet.",
    configuration: "Google login isn't configured correctly. Contact SmartBasket support.",
    failed: "Google sign-in failed or was cancelled. Try again.",
    link_required: "You already have an account with this email. Sign in using your password, then choose Connect Google on your Account page.",
    sign_in_first: "Sign in with your existing password before linking Google.",
    disabled: "This SmartBasket account is unavailable.",
    admin_disabled: "Administrators must use their password and authenticator code.",
  };
  const googleMessage = googleMessages[new URLSearchParams(window.location.search).get("google")];

  async function handleLogin(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await axios.post("/login", {
        identifier: identifier.trim(),
        password,
        totp_code: totpCode.trim(),
      });

      const data = response.data;

      if (data.success) {
        // Save fallback state to localStorage
        localStorage.setItem("isAuthenticated", "true");
        if (data.is_admin) {
          localStorage.setItem("isAdmin", "true");
        }

        // Force a hard redirect so AuthContext re-fetches the user session
        window.location.href = data.is_admin ? "/admin" : "/account";
      } else {
        setError(data.error || data.message || "Invalid email/username or password.");
      }
    } catch (err) {
      console.error("Login error:", err);
      setError(
        err.response?.data?.error ||
        err.response?.data?.message ||
        "Unable to connect to the server. Make sure app.py is running."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex-grow flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full bg-white p-8 rounded-2xl shadow-sm border border-[#badbbd]">

        <div className="text-center mb-8">
          <div className="text-6xl mb-4">🛒</div>
          <h2 className="text-3xl font-black text-[#1b4332] tracking-tight">Smart Basket</h2>
          <h3 className="mt-4 text-xl font-bold text-slate-800">Sign in</h3>
          <p className="mt-2 text-sm text-slate-500">Welcome back! Please sign in to your account</p>
        </div>

        {/* Error Alert */}
        {(error || googleMessage) && (
          <div className="mb-6 bg-red-50 border-l-4 border-red-500 p-4 rounded-r-md">
            <p className="text-sm text-red-700 font-medium">{error || googleMessage}</p>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label htmlFor="identifier" className="block text-sm font-bold text-slate-700 mb-1.5">
              Email or Username
            </label>
            <input
              type="text"
              id="identifier"
              name="identifier"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="Enter your email or username"
              required
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#2E7D32] focus:border-[#2E7D32] outline-none transition-all"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-bold text-slate-700 mb-1.5">
              Password
            </label>
            <input
              type="password"
              id="password"
              autoComplete="current-password"
              placeholder="Enter your password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#2E7D32] focus:border-[#2E7D32] outline-none transition-all"
            />
          </div>

          {/* Admin MFA is optional; required only when Railway TOTP secret is configured. */}
          <div>
            <label htmlFor="totp-code" className="mb-1.5 block text-sm font-bold text-slate-700">Authenticator code <span className="font-normal text-slate-500">(admin accounts only)</span></label>
            <input id="totp-code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" placeholder="6-digit code, if enabled" value={totpCode} onChange={e => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:ring-2 focus:ring-emerald-500" />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 px-4 mt-2 bg-[#2E7D32] hover:bg-[#256629] text-white font-bold rounded-xl shadow-sm transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {isLoading ? "Logging in..." : "Login"}
          </button>

          <div className="relative flex items-center py-2">
            <div className="flex-grow border-t border-slate-200"></div>
            <span className="flex-shrink-0 mx-4 text-slate-400 text-sm font-medium">OR</span>
            <div className="flex-grow border-t border-slate-200"></div>
          </div>

          <button
            type="button"
            onClick={() => { window.location.assign(import.meta.env.DEV ? "http://localhost:5000/auth/google" : "/auth/google"); }}
            className="w-full flex justify-center items-center gap-2 py-2.5 px-4 bg-white border border-slate-300 rounded-xl shadow-sm text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <img src="https://www.svgrepo.com/show/475656/google-color.svg" alt="Google" className="w-5 h-5" />
            Sign in with Google
          </button>
        </form>

        <p className="mt-8 text-center text-sm text-slate-600 font-medium">
          Don't have an account?{" "}
          <Link to="/signup" className="text-[#2E7D32] hover:text-[#1b4332] font-bold">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}

export default Login;
