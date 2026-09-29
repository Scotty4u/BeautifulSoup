import { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Check session status on mount / page refresh
  const checkUserSession = () => {
    setLoading(true);
    axios.get('http://localhost:5000/api/me', { withCredentials: true })
      .then(res => {
        if (res.data && res.data.authenticated) {
          setUser(res.data);
        } else {
          setUser(null);
        }
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    checkUserSession();
  }, []);

  return (
    <AuthContext.Provider value={{ user, setUser, loading, checkUserSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);