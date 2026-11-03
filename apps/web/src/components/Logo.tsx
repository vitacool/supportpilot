import { cn } from '../lib/utils';

export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <rect width="48" height="48" rx="13" fill="#0B1424" />
      <path
        d="M11 17.5c0-2.5 2-4.5 4.5-4.5h17c2.5 0 4.5 2 4.5 4.5v11c0 2.5-2 4.5-4.5 4.5H24l-7 5.5V33h-1.5c-2.5 0-4.5-2-4.5-4.5v-11Z"
        fill="#6D8BFF"
      />
      <circle cx="19" cy="23" r="2.1" fill="#0B1424" />
      <circle cx="24" cy="23" r="2.1" fill="#0B1424" />
      <circle cx="29" cy="23" r="2.1" fill="#0B1424" />
    </svg>
  );
}

export function Logo({
  compact = false,
  dark = false,
  className,
}: {
  compact?: boolean;
  dark?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('brand', className)}>
      <LogoMark size={compact ? 31 : 36} />
      {!compact && (
        <div className="brand-text">
          <div className={cn('brand-name', dark && 'is-dark')}>
            Support<span>Pilot</span>
          </div>
          <div className={cn('brand-sub', dark && 'is-dark')}>AI 客服协同平台</div>
        </div>
      )}
    </div>
  );
}
