
import React, { useState } from "react";
import api from "./api";

function Signup({ setShowSignup }) {

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agreeTerms, setAgreeTerms] = useState(false);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSignup = async (e) => {
    e.preventDefault();

    setError("");
    setMessage("");

    // Check required fields
    if (!firstName || !lastName || !email || !password || !confirmPassword) {
      setError("Please fill in all fields.");
      return;
    }

    // Check passwords
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    // Check terms
    if (!agreeTerms) {
      setError("Please agree to the Terms of Service and Privacy Policy.");
      return;
    }

    try {
      setLoading(true);

      // Send the information to Flask
      const response = await api.post("/api/auth/signup", {
        first_name: firstName,
        last_name: lastName,
        email: email,
        password: password
      });

      setMessage(response.data.message || "Account created successfully!");

      // Clear form
      setFirstName("");
      setLastName("");
      setEmail("");
      setPassword("");
      setConfirmPassword("");

      // After successful signup, return to login
      setTimeout(() => {
        setShowSignup(false);
      }, 1500);

   } catch (error) {
    console.log("FULL ERROR:", error);
    console.log("STATUS:", error.response?.status);
    console.log("DATA:", error.response?.data);
    console.log("MESSAGE:", error.message);

    setError(
        error.response?.data?.message ||
        error.response?.data?.error ||
        error.message ||
        "Signup failed"
    );
} 
finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div style={{ justifyItems: "center", marginTop: "-80px" }}>
        <div
          className="Sign-up-container"
          style={{ maxHeight: "100%", height: "900px" }}
        >

          <div
            className="logo"
            style={{
              marginTop: "30px",
              marginBottom: "5px",
              display: "grid",
              justifyItems: "center"
            }}
          >
            <i
              className="fas fa-shopping-bag"
              style={{
                fontSize: "70px",
                color: "#2563eb"
              }}
            ></i>

            <span
              style={{
                marginTop: "5%",
                color: "black",
                fontWeight: "bolder",
                fontSize: "30px"
              }}
            >
              Smart Basket
            </span>
          </div>

          <div style={{ justifyItems: "center" }}>
            <br />

            <h3 className="sign-text">Sign up as Customer</h3>

            <p style={{ fontSize: "15px" }}>
              Enter your details to create your personal account
            </p>

            <br />
          </div>

          <form onSubmit={handleSignup}>

            <div style={{ justifyItems: "center" }}>

              <div>
                <label htmlFor="firstName" style={{ fontSize: "13px" }}>
                  First Name
                </label>

                <input
                  className="Username-box2"
                  id="firstName"
                  type="text"
                  placeholder="Enter your first name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>

              <div style={{ marginTop: "10px" }}>
                <label htmlFor="lastName" style={{ fontSize: "13px" }}>
                  Last Name
                </label>

                <input
                  className="Username-box2"
                  id="lastName"
                  type="text"
                  placeholder="Enter your last name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>

              <div style={{ marginTop: "10px" }}>
                <label htmlFor="email" style={{ fontSize: "13px" }}>
                  Email address
                </label>

                <input
                  className="Username-box2"
                  id="email"
                  type="email"
                  placeholder="Enter your email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div style={{ marginTop: "10px" }}>
                <label htmlFor="password" style={{ fontSize: "13px" }}>
                  Password
                </label>

                <input
                  className="Username-box2"
                  id="password"
                  type="password"
                  placeholder="Create a password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <div style={{ marginTop: "10px" }}>
                <label htmlFor="confirmPassword" style={{ fontSize: "13px" }}>
                  Confirm password
                </label>

                <input
                  className="Username-box2"
                  id="confirmPassword"
                  type="password"
                  placeholder="Confirm your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>

              <br />

              <div className="form-check">

                <label className="form-check-label">

                  <input
                    type="checkbox"
                    className="form-check-input"
                    checked={agreeTerms}
                    onChange={(e) => setAgreeTerms(e.target.checked)}
                  />

                  {" "}I agree to the
                  <strong style={{ color: "#2563eb" }}>
                    {" "}Terms of Service
                  </strong>
                  {" "}and
                  <strong style={{ color: "#2563eb" }}>
                    {" "}Privacy Policy
                  </strong>

                </label>

              </div>

              <br />

              {/* Error message */}
              {error && (
                <p style={{ color: "red", fontSize: "14px" }}>
                  {error}
                </p>
              )}

              {/* Success message */}
              {message && (
                <p style={{ color: "green", fontSize: "14px" }}>
                  {message}
                </p>
              )}

              <div style={{ justifyItems: "center" }}>

                <button
                  id="signup-btn"
                  type="submit"
                  disabled={loading}
                >
                  {loading ? "Creating account..." : "Sign up"}
                </button>

                <br />

                <p
                  className="Text-sign-page"
                  style={{ marginTop: "10px" }}
                >
                  OR
                </p>

                <button
                  id="google-btn"
                  type="button"
                >
                  Sign up with Google
                  <img src="imgs/google.png" alt="" />
                </button>

              </div>

              <br />

              <div className="end-tab">

                <div>
                  <p className="Text-sign-page">

                    Already have an account?{" "}

                    <strong
                      style={{
                        color: "#2563eb",
                        cursor: "pointer"
                      }}
                      onClick={() => setShowSignup(false)}
                    >
                      <u>Log in</u>
                    </strong>

                  </p>
                </div>

              </div>

            </div>

          </form>

        </div>
      </div>
    </div>
  );
}

export default Signup;
