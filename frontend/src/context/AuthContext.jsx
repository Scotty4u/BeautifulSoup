import { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Check session status from Flask backend (/api/me)
  const checkUserSession = async () => {
    setLoading(true);
    try {
      const res = await axios.get('http://localhost:5000/api/me', { withCredentials: true });
      if (res.data && res.data.authenticated) {
        setUser(res.data.user || res.data);
        return res.data.user || res.data;
      } else {
        setUser(null);
        return null;
      }
    } catch (error) {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  };

  // Call this directly on successful login to set user state instantly
  const loginUser = (userData) => {
    setUser(userData);
  };

  // Call this on logout
  const logoutUser = async () => {
    try {
      await axios.post('http://localhost:5000/api/logout', {}, { withCredentials: true });
    } catch (err) {
      console.error("Logout failed", err);
    } finally {
      setUser(null);
    }
  };

  useEffect(() => {
    checkUserSession();
  }, []);

  return (
    <AuthContext.Provider value={{ user, setUser, loading, checkUserSession, loginUser, logoutUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);