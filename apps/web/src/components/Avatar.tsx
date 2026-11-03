import { cn, initials } from '../lib/utils';

export function Avatar({
  name,
  color = '#5EEAD4',
  size = 32,
  className,
}: {
  name: string;
  color?: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn('avatar', className)}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${color}, ${color}99)`,
        fontSize: Math.max(10, size * 0.34),
      }}
      title={name}
    >
      {initials(name)}
    </span>
  );
}
