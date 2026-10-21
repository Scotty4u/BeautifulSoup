import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import axios from "axios";

function Signup() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agreeTerms, setAgreeTerms] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const navigate = useNavigate();

  async function handleSignup(e) {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (!agreeTerms) {
      setError("Please agree to the Terms of Service and Privacy Policy.");
      return;
    }

    setLoading(true);

    try {
      // Using global axios instance configured in App.jsx
      const response = await axios.post("/signup", {
        username,
        email,
        password,
      });

      const data = response.data;

      if (data.success) {
        localStorage.setItem("isAuthenticated", "true");
        if (data.is_admin) {
          localStorage.setItem("isAdmin", "true");
        }

        // Force reload so AuthContext registers the new session cookie
        window.location.href = "/account";
      } else {
        setError(data.error || data.message || "Unable to create account.");
      }
    } catch (err) {
      console.error("Signup error:", err);
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

        {/* Logo Header */}
        <div className="text-center mb-8">
          <div className="text-6xl mb-4">🛒</div>
          <h2 className="text-3xl font-black text-[#1b4332] tracking-tight">Smart Basket</h2>
          <h3 className="mt-4 text-xl font-bold text-slate-800">Sign up as Customer</h3>
          <p className="mt-2 text-sm text-slate-500">Enter your details to create your personal account</p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-6 bg-red-50 border-l-4 border-red-500 p-4 rounded-r-md">
            <p className="text-sm text-red-700 font-medium">{error}</p>
          </div>
        )}

        <form onSubmit={handleSignup} className="space-y-4">
          {/* Username */}
          <div>
            <label htmlFor="username" className="block text-sm font-bold text-slate-700 mb-1.5">
              Username
            </label>
            <input
              id="username"
              type="text"
              placeholder="Choose a username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#2E7D32] focus:border-[#2E7D32] outline-none transition-all"
            />
          </div>

          {/* Email */}
          <div>
            <label htmlFor="email" className="block text-sm font-bold text-slate-700 mb-1.5">
              Email address
            </label>
            <input
              id="email"
              type="email"
              placeholder="Enter your email address"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#2E7D32] focus:border-[#2E7D32] outline-none transition-all"
            />
          </div>

          {/* Password */}
          <div>
            <label htmlFor="password" className="block text-sm font-bold text-slate-700 mb-1.5">
              Password
            </label>
            <input
              id="password"
              type="password"
              placeholder="Create a password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#2E7D32] focus:border-[#2E7D32] outline-none transition-all"
            />
          </div>

          {/* Confirm Password */}
          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-bold text-slate-700 mb-1.5">
              Confirm password
            </label>
            <input
              id="confirmPassword"
              type="password"
              placeholder="Confirm your password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#2E7D32] focus:border-[#2E7D32] outline-none transition-all"
            />
          </div>

          {/* Terms & Conditions Checkbox */}
          <div className="flex items-start py-2">
            <div className="flex items-center h-5">
              <input
                id="terms"
                type="checkbox"
                checked={agreeTerms}
                onChange={(e) => setAgreeTerms(e.target.checked)}
                className="w-4 h-4 text-[#2E7D32] bg-gray-100 border-gray-300 rounded focus:ring-[#2E7D32]"
              />
            </div>
            <div className="ml-3 text-sm">
              <label htmlFor="terms" className="font-medium text-slate-600">
                I agree to the{" "}
                <span className="text-[#2E7D32] font-bold hover:underline cursor-pointer">Terms of Service</span>
                {" "}and{" "}
                <span className="text-[#2E7D32] font-bold hover:underline cursor-pointer">Privacy Policy</span>
              </label>
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 mt-2 bg-[#2E7D32] hover:bg-[#256629] text-white font-bold rounded-xl shadow-sm transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {loading ? "Creating account..." : "Sign up"}
          </button>

          {/* Divider */}
          <div className="relative flex items-center py-2">
            <div className="flex-grow border-t border-slate-200"></div>
            <span className="flex-shrink-0 mx-4 text-slate-400 text-sm font-medium">OR</span>
            <div className="flex-grow border-t border-slate-200"></div>
          </div>

          {/* Google Button */}
          <button
            type="button"
            onClick={() => { if (!agreeTerms) { setError("Please agree to the Terms of Service and Privacy Policy before continuing with Google."); return; } window.location.assign(import.meta.env.DEV ? "http://localhost:5000/auth/google" : "/auth/google"); }}
            className="w-full flex justify-center items-center gap-2 py-2.5 px-4 bg-white border border-slate-300 rounded-xl shadow-sm text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <img src="https://www.svgrepo.com/show/475656/google-color.svg" alt="Google" className="w-5 h-5" />
            Sign up with Google
          </button>
        </form>

        {/* Footer Link */}
        <p className="mt-8 text-center text-sm text-slate-600 font-medium">
          Already have an account?{" "}
          <Link to="/login" className="text-[#2E7D32] hover:text-[#1b4332] font-bold">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

export default Signup;
