export default function SkeletonCard() {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '340px' }}>
      <div>
        <div className="skeleton-box" style={{ height: '160px', borderRadius: '12px', marginBottom: '16px' }}></div>
        <div className="skeleton-box" style={{ width: '35%', height: '18px', borderRadius: '6px', marginBottom: '12px' }}></div>
        <div className="skeleton-box" style={{ width: '90%', height: '16px', borderRadius: '4px', marginBottom: '8px' }}></div>
        <div className="skeleton-box" style={{ width: '70%', height: '16px', borderRadius: '4px' }}></div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '16px', borderTop: '1px solid #f1f5f9', paddingTop: '12px' }}>
        <div className="skeleton-box" style={{ width: '35%', height: '24px', borderRadius: '4px' }}></div>
        <div className="skeleton-box" style={{ width: '80px', height: '32px', borderRadius: '12px' }}></div>
      </div>
    </div>
  );
}