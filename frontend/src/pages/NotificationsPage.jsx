import { useState, useEffect } from 'react';
import axios from 'axios';
import { useToast } from '../context/ToastContext';

export default function NotificationsPage() {
  const [notifs, setNotifs] = useState([]);
  const { showToast } = useToast();

  useEffect(() => {
    axios.get('/api/notifications')
      .then(res => setNotifs(res.data || []))
      .catch(() => {});
  }, []);

  const respond = (id, action) => {
    axios.post(`/api/notifications/${id}/respond`, { action })
      .then(() => {
        showToast(`Invite ${action}ed!`);
        setNotifs(notifs.map(n => n.id === id ? { ...n, status: 'read' } : n));
      })
      .catch(() => showToast("Action failed.", "error"));
  };

  return (
    <div className="container" style={{ padding: '40px 20px', maxWidth: '800px' }}>
      <h1 style={{ fontSize: '2rem', fontWeight: '900', marginBottom: '24px' }}>Notifications</h1>
      {notifs.length === 0 ? <p style={{ color: '#64748b' }}>No notifications found.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {notifs.map(n => (
            <div key={n.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: n.status === 'unread' ? '#f0fdf4' : '#fff' }}>
              <div>
                <p style={{ margin: '0 0 4px', fontWeight: '700' }}>{n.message}</p>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{n.date}</span>
              </div>
              {n.message.includes('invited you') && n.status === 'unread' && (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => respond(n.id, 'accept')} className="btn-primary" style={{ fontSize: '0.8rem', padding: '6px 12px' }}>Accept</button>
                  <button onClick={() => respond(n.id, 'decline')} className="btn-secondary" style={{ fontSize: '0.8rem', padding: '6px 12px' }}>Decline</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}