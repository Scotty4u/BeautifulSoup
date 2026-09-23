import React, { useState } from "react";
import google_image from "./assets/google.png";
import api from "./api"; // Import the axios instance we created

function Login({ setIsAuthenticated, setShowSignup }) {
  // State to hold form inputs, errors, and loading status
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Handle the form submission
  const handleLogin = async (e) => {
    e.preventDefault(); // Prevents the page from reloading
    setError("");       // Clear any previous errors
    setIsLoading(true);

    try {
      // Send credentials to your Flask backend
      const response = await api.post("/api/login", {
        email: email,
        password: password,
      });

      if (response.data.success) {
        // Tell App.jsx that the user is successfully logged in!
        setIsAuthenticated(true);
      }
    } catch (err) {
      // If Flask returns a 401 error, catch it and show a message
      if (err.response && err.response.data && err.response.data.error) {
        setError(err.response.data.error);
      } else {
        setError("An error occurred while connecting to the server.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <div style={{ justifyItems: "center", marginTop: "-50px" }}>
        <div className="login-card-logo">
          <div className="logo" style={{ marginTop: "30px", marginBottom: "5px", display: "grid", justifyItems: "center" }}>
            <i className="fas fa-shopping-bag" style={{ fontSize: "70px", color: "#2563eb" }}></i>
            <span style={{ marginTop: "5%", color: "black", fontWeight: "bolder", fontSize: "30px" }}>
              Smart Basket
            </span>
          </div>
          <div style={{ justifyItems: "center" }}>
            <br />
            <h3 className="sign-text">Sign in</h3>
            <p style={{ fontSize: "15px" }}>Welcome back! Please sign in to your account</p>
          </div>
          <br />

          {/* Show error message if login fails */}
          {error && (
            <div style={{ color: "red", textAlign: "center", marginBottom: "10px", fontSize: "14px" }}>
              {error}
            </div>
          )}

          {/* Attach the submit handler to the form */}
          <form onSubmit={handleLogin}>
            <div className="Content">
              <label htmlFor="email" style={{ fontSize: "13px" }}>Email Address</label> <br />
              <input
                className="Username-box"
                type="email"
                id="email"
                placeholder="Enter your email address"
                style={{ marginTop: "5px" }}
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)} // Update state as user types
              />
              <br />
              <label htmlFor="password" style={{ fontSize: "13px" }}>Password</label><br />
              <input
                className="Username-box"
                type="password"
                id="password"
                placeholder="Enter your password"
                style={{ marginTop: "5px" }}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)} // Update state as user types
              />
              <br />
              <div>
                {/* Changed type="button" to type="submit" so hitting Enter works */}
                <button 
                  id="log-btn" 
                  type="submit" 
                  style={{ marginBottom: "10px" }}
                  disabled={isLoading} // Prevent double-clicks while loading
                >
                  {isLoading ? "Logging in..." : "Login"}
                </button>
              </div>
              <br />
            </div>

            <div><p className="Text-sign-page">OR</p></div><br />
            <div style={{ marginTop: "-4px" }}>
              <button type="button" id="google-btn"> 
                Sign in with Google <img src={google_image} alt="Google logo" />
              </button>
            </div>
          </form>
          <br />
          <br />
          <p>
            Don't have an account?{" "}
                <span onClick={() => setShowSignup(true)}>
                 Sign up
                </span>
          </p>
        </div>
      </div>
    </div>
  );
}

export default Login;