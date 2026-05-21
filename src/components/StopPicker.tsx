import React from 'react';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { cn } from '../lib/utils';
import { Camera, Video, Image, Info } from 'lucide-react';

interface StopType {
  id: string;
  name: string;
  icon: string;
}

interface StopPickerProps {
  types: StopType[];
  onSelect: (typeId: string) => void;
  selectedId?: string | null;
  onTakeMedia: (type: 'photo' | 'video' | 'gallery') => void;
  imagePreviews: string[];
  isUploading?: boolean;
}

export const StopPicker: React.FC<StopPickerProps> = ({ 
  types, 
  onSelect, 
  selectedId, 
  onTakeMedia, 
  imagePreviews,
  isUploading 
}) => {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {types.map(type => (
          <Button
            key={type.id}
            variant={selectedId === type.id ? 'primary' : 'outline'}
            onClick={() => onSelect(type.id)}
            className={cn(
              "h-24 flex-col gap-2 rounded-2xl md:rounded-3xl border-slate-100 dark:border-gray-800",
              selectedId === type.id && "ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-gray-900"
            )}
          >
            <span className="text-2xl">{type.icon}</span>
            <span className="text-[9px] font-black uppercase tracking-tight text-center px-1">
              {type.name}
            </span>
          </Button>
        ))}
      </div>

      <div className="space-y-3 pt-4 border-t border-slate-100 dark:border-gray-800">
        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Preuves Multi-Médias (Opt.)</label>
        <div className="flex gap-2">
          <Button 
            variant="secondary" 
            size="sm" 
            className="flex-1 h-12 gap-2" 
            onClick={() => onTakeMedia('photo')}
            disabled={isUploading}
          >
            <Camera size={16} /> Photo
          </Button>
          <Button 
            variant="secondary" 
            size="sm" 
            className="flex-1 h-12 gap-2" 
            onClick={() => onTakeMedia('video')}
            disabled={isUploading}
          >
            <Video size={16} /> Vidéo
          </Button>
          <Button 
            variant="secondary" 
            size="sm" 
            className="flex-1 h-12 gap-2" 
            onClick={() => onTakeMedia('gallery')}
            disabled={isUploading}
          >
            <Image size={16} /> Galerie
          </Button>
        </div>

        {imagePreviews.length > 0 && (
          <div className="flex gap-2 overflow-x-auto py-2 scrollbar-hide">
            {imagePreviews.map((prev, idx) => (
              <div key={idx} className="w-16 h-16 rounded-xl overflow-hidden border border-slate-200 dark:border-gray-800 bg-slate-50 shrink-0">
                 <img src={prev} className="w-full h-full object-cover" />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-2xl border border-blue-100 dark:border-blue-900/30 flex gap-3">
        <Info size={18} className="text-blue-600 shrink-0 mt-0.5" />
        <p className="text-[10px] font-bold text-blue-800 dark:text-blue-300 leading-relaxed uppercase">
          La qualification de l'arrêt est essentielle pour l'analyse OEE et la maintenance préventive.
        </p>
      </div>
    </div>
  );
};
