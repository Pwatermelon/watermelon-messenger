type BrandIconProps = {
  size?: number;
  className?: string;
  title?: string;
};

function iconSrcForSize(size: number): string {
  if (size <= 64) return "/icon-180.png";
  if (size <= 180) return "/icon-180.png";
  if (size <= 192) return "/icon-192.png";
  if (size <= 200) return "/icon-200.png";
  return "/icon-512.png";
}

export function BrandIcon({ size = 48, className = "", title = "Watermelon" }: BrandIconProps) {
  const src = iconSrcForSize(size);
  return (
    <img
      src={src}
      alt={title}
      width={size}
      height={size}
      className={`brand-icon-img ${className}`.trim()}
      draggable={false}
      decoding="async"
    />
  );
}
