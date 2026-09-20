import { Link } from 'react-router-dom';

export default function CollaborativeListsPage() {
  return (
    <div className="container" style={{ padding: '40px 20px' }}>
      <h1 style={{ fontSize: '2rem', fontWeight: '900', marginBottom: '16px' }}>Collaborative Group Lists</h1>
      <p style={{ color: '#64748b', marginBottom: '24px' }}>Collaborate on grocery budgets with your team members in real-time.</p>
      <Link to="/saved" className="btn-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>View My Saved & Shared Lists</Link>
    </div>
  );
}