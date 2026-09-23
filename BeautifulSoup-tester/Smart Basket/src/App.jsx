import React, { useState, useEffect } from 'react';
import Header from "./Header.jsx";
import Footer from "./Footer.jsx";
import Body from "./Body.jsx";
import Login from "./Login.jsx";
import Signup from "./Signup.jsx";
import api from "./api";

function App() {
  // Track whether the user is logged in
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Track whether we are checking the backend session
  const [loading, setLoading] = useState(true);

  // Track whether to show Signup or Login
  const [showSignup, setShowSignup] = useState(false);

  useEffect(() => {
    const checkSession = async () => {
      try {
        const response = await api.get('/api/db/active-cart');
        setIsAuthenticated(response.data.authenticated);
      } catch (error) {
        setIsAuthenticated(false);
      } finally {
        setLoading(false);
      }
    };

    checkSession();
  }, []);

  // Loading screen
  if (loading) {
    return <div>Loading SmartBasket...</div>;
  }

  return (
    <div>
      {isAuthenticated ? (
        <>
          <Header setIsAuthenticated={setIsAuthenticated} />
          <Body />
          <Footer />
        </>
      ) : showSignup ? (
        <Signup
          setShowSignup={setShowSignup}
          setIsAuthenticated={setIsAuthenticated}
        />
      ) : (
        <Login
          setIsAuthenticated={setIsAuthenticated}
          setShowSignup={setShowSignup}
        />
      )}
    </div>
  );
}

export default App;