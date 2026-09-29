import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

function Signup({ setIsAuthenticated }) {
  // Changed firstName/lastName to username to match the Flask backend's User model
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

    // Check that passwords match
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    // Check terms
    if (!agreeTerms) {
      setError(
        "Please agree to the Terms of Service and Privacy Policy."
      );
      return;
    }

    setLoading(true);

    try {
      // Changed to localhost to prevent CORS domain mismatch
      const response = await fetch(
        "http://localhost:5000/signup",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include", // Required to save the Flask session cookie
          body: JSON.stringify({
            username: username, // Aligned with app.py expected keys
            email: email,
            password: password,
          }),
        }
      );

      const data = await response.json();

      if (response.ok && data.success) {
        // Cache authentication state to survive page refreshes
        localStorage.setItem("isAuthenticated", "true");
        if (data.is_admin) {
          localStorage.setItem("isAdmin", "true");
        }

        if (setIsAuthenticated) {
          setIsAuthenticated(true);
        }

        // Navigate to the dashboard instead of the landing page
        navigate("/account");
      } else {
        setError(
          data.error ||
            data.message ||
            "Unable to create account."
        );
      }
    } catch (error) {
      console.error("Signup error:", error);

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
          marginTop: "-80px",
        }}
      >
        <div className="Sign-up-container">

          {/* LOGO */}
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

          {/* TITLE */}
          <div style={{ justifyItems: "center" }}>
            <br />

            <h3 className="sign-text">
              Sign up as Customer
            </h3>

            <p style={{ fontSize: "15px" }}>
              Enter your details to create your personal account
            </p>

            <br />
          </div>

          {/* ERROR MESSAGE */}
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

          {/* SIGNUP FORM */}
          <form onSubmit={handleSignup}>

            <div style={{ justifyItems: "center" }}>

              {/* USERNAME */}
              <div>
                <label
                  htmlFor="username"
                  style={{ fontSize: "13px" }}
                >
                  Username
                </label>

                <input
                  className="Username-box2"
                  id="username"
                  type="text"
                  placeholder="Choose a username"
                  required
                  value={username}
                  onChange={(e) =>
                    setUsername(e.target.value)
                  }
                />
              </div>

              {/* EMAIL */}
              <div style={{ marginTop: "10px" }}>
                <label
                  htmlFor="email"
                  style={{ fontSize: "13px" }}
                >
                  Email address
                </label>

                <input
                  className="Username-box2"
                  id="email"
                  type="email"
                  placeholder="Enter your email address"
                  required
                  value={email}
                  onChange={(e) =>
                    setEmail(e.target.value)
                  }
                />
              </div>

              {/* PASSWORD */}
              <div style={{ marginTop: "10px" }}>
                <label
                  htmlFor="password"
                  style={{ fontSize: "13px" }}
                >
                  Password
                </label>

                <input
                  className="Username-box2"
                  id="password"
                  type="password"
                  placeholder="Create a password"
                  required
                  value={password}
                  onChange={(e) =>
                    setPassword(e.target.value)
                  }
                />
              </div>

              {/* CONFIRM PASSWORD */}
              <div style={{ marginTop: "10px" }}>
                <label
                  htmlFor="confirmPassword"
                  style={{ fontSize: "13px" }}
                >
                  Confirm password
                </label>

                <input
                  className="Username-box2"
                  id="confirmPassword"
                  type="password"
                  placeholder="Confirm your password"
                  required
                  value={confirmPassword}
                  onChange={(e) =>
                    setConfirmPassword(e.target.value)
                  }
                />
              </div>

              <br />

              {/* TERMS */}
              <div className="form-check">

                <label className="form-check-label">

                  <input
                    type="checkbox"
                    className="form-check-input"
                    checked={agreeTerms}
                    onChange={(e) =>
                      setAgreeTerms(e.target.checked)
                    }
                  />

                  {" "}I agree to the

                  <strong
                    style={{ color: "#2563eb" }}
                  >
                    {" "}Terms of Service
                  </strong>

                  {" "}and

                  <strong
                    style={{ color: "#2563eb" }}
                  >
                    {" "}Privacy Policy
                  </strong>

                </label>

              </div>

              <br />

              {/* SIGNUP BUTTON */}
              <div style={{ justifyItems: "center" }}>

                <button
                  id="signup-btn"
                  type="submit"
                  disabled={loading}
                >
                  {loading
                    ? "Creating account..."
                    : "Sign up"}
                </button>

                <br />

                <p
                  className="Text-sign-page"
                  style={{ marginTop: "10px" }}
                >
                  OR
                </p>

                {/* GOOGLE BUTTON */}
                <button
                  type="button"
                  id="google-btn"
                >
                  Sign up with Google
                </button>

              </div>

              <br />

            </div>

          </form>

          <br />

          {/* LOGIN LINK */}
          <p
            style={{
              fontWeight: "bold",
              marginTop: "-10px",
              marginBottom: "25px",
              textAlign: "center",
            }}
          >
            Already have an account?{" "}

            <span
              onClick={() => navigate("/login")}
              style={{
                color: "blue",
                cursor: "pointer",
              }}
            >
              Sign in
            </span>

          </p>

        </div>
      </div>
    </div>
  );
}

export default Signup;