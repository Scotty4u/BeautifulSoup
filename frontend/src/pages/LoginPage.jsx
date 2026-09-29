import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

function Login({ setIsAuthenticated }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setLoading] = useState(false);

  const navigate = useNavigate();

  async function handleLogin(e) {
    e.preventDefault();

    setError("");
    setLoading(true);

    try {
      // FIX 1: Changed 127.0.0.1 to localhost. 
      // This ensures the browser domain matches the API domain, 
      // allowing the Flask session cookie to be saved correctly.
      const response = await fetch("http://localhost:5000/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include", // Crucial for accepting the Flask session cookie
        body: JSON.stringify({
          email,
          password,
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // FIX 2: Save state to localStorage so it survives page refreshes
        localStorage.setItem("isAuthenticated", "true");
        if (data.is_admin) {
          localStorage.setItem("isAdmin", "true");
        }

        // Tell React that the user is authenticated
        if (setIsAuthenticated) {
          setIsAuthenticated(true);
        }

        // Redirect based on user role
        if (data.is_admin) {
          navigate("/admin");
        } else {
          navigate("/account");
        }
      } else {
        setError(
          data.error ||
            data.message ||
            "Invalid email or password."
        );
      }
    } catch (error) {
      console.error("Login error:", error);
      setError(
        "Unable to connect to the server. Make sure app.py is running."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div
        style={{
          justifyItems: "center",
          marginTop: "-50px",
        }}
      >
        <div className="login-card-logo">

          {/* Logo */}
          <div
            className="logo"
            style={{
              marginTop: "30px",
              marginBottom: "5px",
              display: "grid",
              justifyItems: "center",
            }}
          >
            <span style={{ fontSize: "70px" }}>
              🛒
            </span>

            <span
              style={{
                marginTop: "5%",
                color: "black",
                fontWeight: "bolder",
                fontSize: "30px",
              }}
            >
              Smart Basket
            </span>
          </div>

          {/* Heading */}
          <div style={{ justifyItems: "center" }}>
            <br />

            <h3 className="sign-text">
              Sign in
            </h3>

            <p style={{ fontSize: "15px" }}>
              Welcome back! Please sign in to your account
            </p>
          </div>

          <br />

          {/* Error message */}
          {error && (
            <div
              style={{
                color: "red",
                textAlign: "center",
                marginBottom: "10px",
                fontSize: "14px",
              }}
            >
              {error}
            </div>
          )}

          {/* Login form */}
          <form onSubmit={handleLogin}>
            <div className="Content">

              {/* Email */}
              <label
                htmlFor="email"
                style={{ fontSize: "13px" }}
              >
                Email Address
              </label>

              <br />

              <input
                className="Username-box"
                type="email"
                id="email"
                placeholder="Enter your email address"
                style={{ marginTop: "5px" }}
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />

              <br />

              {/* Password */}
              <label
                htmlFor="password"
                style={{ fontSize: "13px" }}
              >
                Password
              </label>

              <br />

              <input
                className="Username-box"
                type="password"
                id="password"
                placeholder="Enter your password"
                style={{ marginTop: "5px" }}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />

              <br />

              {/* Login button */}
              <div>
                <button
                  id="log-btn"
                  type="submit"
                  style={{ marginBottom: "-10px" }}
                  disabled={isLoading}
                >
                  {isLoading ? "Logging in..." : "Login"}
                </button>
              </div>

              <br />
            </div>

            {/* OR */}
            <div style={{ justifyItems: "center" }}>
              <p className="Text-sign-page">
                OR
              </p>
            </div>

            <br />

            {/* Google button */}
            <div style={{ marginTop: "-20px" }}>
              <button
                type="button"
                id="google-btn"
                onClick={() => {
                  alert(
                    "Google login is not implemented yet."
                  );
                }}
              >
                Sign in with Google
              </button>
            </div>
          </form>

          <br />

          {/* Sign up */}
          <p style={{ fontWeight: "bold" }}>
            Don't have an account?{" "}

            <span
              onClick={() => navigate("/signup")}
              style={{
                color: "blue",
                cursor: "pointer",
              }}
            >
              Sign up
            </span>
          </p>

          <br />

        </div>
      </div>
    </div>
  );
}

export default Login;