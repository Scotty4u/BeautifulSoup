import { useState } from 'react';
import { ImageOff } from 'lucide-react';

export default function OrderProductImage({ src, name }) {
  const [failedSource, setFailedSource] = useState(null);
  return (
    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-100 bg-white p-1.5 sm:h-20 sm:w-20">
      {src && failedSource !== src ? (
        <img src={src} alt={name || 'Product'} loading="lazy" referrerPolicy="no-referrer"
          onError={() => setFailedSource(src)} className="h-full w-full object-contain" />
      ) : (
        <span role="img" aria-label={`Image unavailable for ${name || 'product'}`} className="flex flex-col items-center gap-1 text-slate-400">
          <ImageOff className="h-5 w-5" aria-hidden="true" />
          <span className="text-[9px]">No image</span>
        </span>
      )}
    </div>
  );
}
