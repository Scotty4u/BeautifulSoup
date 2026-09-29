import { useNavigate, useLocation } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

// Pages where a back button doesn't make sense
const HIDE_ON = ['/', '/home'];

export default function BackButton() {
  const navigate = useNavigate();
  const location = useLocation();

  if (HIDE_ON.includes(location.pathname)) return null;

  return (
    <button
      onClick={() => navigate(-1)}
      className="flex items-center gap-1 text-sm text-slate-500 hover:text-emerald-600 transition-colors font-medium py-1 group"
    >
      <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
      Back
    </button>
  );
}