import { Plus, Crown, Clock3 } from 'lucide-react';

const COLOR_CLASSES = [
  'bg-emerald-700 text-white',
  'bg-blue-700 text-white',
  'bg-violet-700 text-white',
  'bg-amber-600 text-white',
  'bg-rose-700 text-white',
  'bg-teal-700 text-white',
];

function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return parts.length > 1 ? `${parts[0][0]}${parts[1][0]}`.toUpperCase() : parts[0].slice(0, 2).toUpperCase();
}

/** Displays the owner, accepted members and pending invitations. The + circle is always visible to owners. */
export default function ListMemberAvatars({ owner, members = [], canInvite = false, onInvite, compact = false }) {
  const safeMembers = Array.isArray(members) ? members : [];
  const people = [
    ...(owner?.username ? [{ ...owner, status: 'owner', role: 'owner' }] : []),
    ...safeMembers.filter((person) => person && String(person.id) !== String(owner?.id)),
  ];
  const accepted = safeMembers.filter((person) => person.status === 'accepted').length;
  const pending = safeMembers.filter((person) => person.status === 'pending').length;
  return (
    <div className="flex flex-wrap items-center gap-3" aria-label="List members and invitations">
      <div className="flex items-center -space-x-2">
        {people.slice(0, compact ? 5 : 12).map((person, index) => {
          const waiting = person.status === 'pending';
          const tip = `${person.username || 'Member'}${person.status === 'owner' ? ' · Owner' : waiting ? ' · Invited' : ' · Member'}`;
          return (
            <div key={`${person.id || person.username}-${person.status}`} title={tip} aria-label={tip}
              className={`relative flex ${compact ? 'h-9 w-9 text-[10px]' : 'h-11 w-11 text-xs'} shrink-0 items-center justify-center rounded-full border-[3px] border-white font-extrabold shadow-sm ${waiting ? 'bg-slate-100 text-slate-500 ring-1 ring-dashed ring-slate-400' : COLOR_CLASSES[index % COLOR_CLASSES.length]}`}>
              {initials(person.username)}
              {person.status === 'owner' && <Crown className="absolute -right-1 -top-1 h-3.5 w-3.5 fill-amber-400 text-amber-500" aria-label="Owner" />}
              {waiting && <Clock3 className="absolute -bottom-1 -right-0.5 h-3.5 w-3.5 rounded-full bg-white p-0.5 text-amber-700" />}
            </div>
          );
        })}
        {people.length > (compact ? 5 : 12) && <span className="relative flex h-10 w-10 items-center justify-center rounded-full border-[3px] border-white bg-slate-200 text-xs font-bold text-slate-700">+{people.length - (compact ? 5 : 12)}</span>}
        {canInvite && <button type="button" onClick={(event) => { event.stopPropagation(); onInvite?.(); }}
          aria-label="Add a person to this list" title="Add person" className={`relative z-10 flex ${compact ? 'h-10 w-10' : 'h-12 w-12'} shrink-0 items-center justify-center rounded-full border-[3px] border-white bg-emerald-600 text-white shadow-sm ring-1 ring-emerald-200 transition hover:scale-105 hover:bg-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700`}>
          <Plus className="h-5 w-5" strokeWidth={2.7} />
        </button>}
      </div>
      {!compact && <div className="text-xs text-slate-500">
        <p className="font-extrabold text-slate-800">{1 + accepted} member{accepted === 0 ? '' : 's'}{pending ? ` · ${pending} invited` : ''}</p>
        <p>{canInvite ? 'Tap + to invite someone' : 'Only the list owner can invite people'}</p>
      </div>}
    </div>
  );
}
