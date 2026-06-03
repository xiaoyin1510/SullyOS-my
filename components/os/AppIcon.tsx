
import React from 'react';
import { AppConfig } from '../../types';
import { Icons } from '../../constants';
import { useOS } from '../../context/OSContext';

interface AppIconProps {
  app: AppConfig;
  onClick: () => void;
  size?: 'sm' | 'md' | 'lg';
  hideLabel?: boolean;
  variant?: 'default' | 'minimal' | 'dock';
}

const AppIcon: React.FC<AppIconProps> = React.memo(({ app, onClick, size = 'md', hideLabel = false, variant = 'default' }) => {
  const { customIcons, theme } = useOS();
  const IconComponent = Icons[app.icon] || Icons.Settings;
  const customIconUrl = customIcons[app.id];
  const contentColor = theme.contentColor || '#ffffff';

  // Standard sizes
  const sizeClasses =
    size === 'lg' ? 'w-[4.25rem] h-[4.25rem]' :
    size === 'sm' ? 'w-[2.75rem] h-[2.75rem]' :
    'w-[3.5rem] h-[3.5rem]';

  return (
    <button 
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 group relative active:scale-95 transition-transform duration-200"
      style={{ WebkitTapHighlightColor: 'transparent' }}
    >
      {/* Container: translucent tile (blur removed for perf — blur × 8+ icons stalls launcher) */}
      <div className={`${sizeClasses} relative flex items-center justify-center
        bg-white/40 rounded-[1.125rem]
        border border-white/35
        shadow-[0_4px_12px_rgba(0,0,0,0.16)]
        group-hover:bg-white/50 group-hover:border-white/50
      `}>

        {customIconUrl ? (
            <img src={customIconUrl} className="w-full h-full object-cover rounded-[1.2rem]" alt={app.name} loading="lazy" />
        ) : (
            <div 
                className="w-[50%] h-[50%] drop-shadow-[0_2px_5px_rgba(0,0,0,0.3)] opacity-90"
                style={{ color: contentColor }}
            >
                 <IconComponent className="w-full h-full" />
            </div>
        )}
      </div>
      
      {!hideLabel && (
        <span
            className={`${size === 'sm' ? 'text-[8.5px] tracking-wider' : 'text-[10px] tracking-widest'} font-bold uppercase opacity-80 text-shadow-md transition-opacity max-w-full truncate ${variant === 'dock' ? 'hidden' : 'block'}`}
            style={{ color: contentColor }}
        >
          {app.name}
        </span>
      )}
    </button>
  );
}, (prev, next) => {
    // Custom comparison to prevent re-render unless specific props change
    // We don't check 'onClick' deeply assuming it's stable or we want to ignore function ref changes
    return prev.app.id === next.app.id && 
           prev.size === next.size && 
           prev.hideLabel === next.hideLabel &&
           prev.variant === next.variant;
});

export default AppIcon;
