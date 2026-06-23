import { useId } from "react";

/** Ritual glyph as a white-only mark, without any background plate. */
export function RitualMark({
  size = 24,
  spin = false,
  glow = true,
  shine = true,
}: {
  size?: number;
  spin?: boolean;
  glow?: boolean;
  shine?: boolean;
}) {
  const reactId = useId().replace(/:/g, "");
  const shineId = `ritualShine-${reactId}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 189 189"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Ritual"
      style={{
        animation: spin ? "logoSpinRtl 5s linear infinite" : undefined,
        filter: glow
          ? "drop-shadow(0 0 5px rgba(255, 255, 255, 0.45)) drop-shadow(0 0 12px rgba(72, 168, 154, 0.32))"
          : undefined,
        display: "block",
      }}
    >
      <defs>
        <linearGradient id={shineId} x1="-30" y1="0" x2="130" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#dfe7e5" />
          <stop offset="0.38" stopColor="#ffffff" />
          <stop offset="0.52" stopColor="#c9fff4" />
          <stop offset="0.72" stopColor="#ffffff" />
          <stop offset="1" stopColor="#dfe7e5" />
          {shine ? (
            <animateTransform
              attributeName="gradientTransform"
              type="translate"
              values="-70 0;70 0;-70 0"
              dur="3.8s"
              repeatCount="indefinite"
            />
          ) : null}
        </linearGradient>
      </defs>

      <path
        fill={`url(#${shineId})`}
        d="M30.4227 108.445L40.6803 98.1203L48.5666 106.058L30.0682 124.677L0.70482 95.1222L30.0678 65.5677L70.0435 105.804L62.1576 113.741L30.4227 81.7994L30.068 81.4424L29.7133 81.7994L16.827 94.7696L16.4768 95.122L16.827 95.4744L29.7133 108.445L30.068 108.802L30.4227 108.445ZM73.0227 22.3335L112.998 62.5693L105.112 70.5069L73.3773 38.5655L73.0226 38.2085L72.6679 38.5655L59.7815 51.5358L59.4314 51.8882L59.7815 52.2406L70.0437 62.5695L62.1578 70.5068L43.6594 51.888L73.0227 22.3335ZM76.0015 127.675L83.8871 119.738L115.622 151.68L115.977 152.037L116.331 151.68L129.218 138.709L129.568 138.357L129.218 138.005L118.956 127.676L126.842 119.738L145.341 138.356L115.977 167.911L76.0015 127.675ZM126.842 76.5037L158.577 108.445L158.932 108.802L159.287 108.445L172.173 95.4749L172.523 95.1225L172.173 94.7701L159.287 81.7999L158.932 81.4429L158.577 81.7999L148.32 92.1242L140.433 84.1866L158.932 65.5679L188.295 95.1223L158.932 124.677L118.956 84.441L126.842 76.5037ZM73.3773 151.679L83.6349 141.354L91.5211 149.292L73.0227 167.911L43.6594 138.356L83.6347 98.1201L91.521 106.058L59.7815 138.004L59.4314 138.356L59.7815 138.709L72.6679 151.679L73.0226 152.036L73.3773 151.679ZM105.368 92.12L97.4825 84.1828L129.222 52.2368L129.572 51.8844L129.222 51.5319L116.336 38.5617L115.981 38.2047L115.626 38.5617L105.369 48.8861L97.4826 40.9488L115.981 22.3297L145.344 51.8842L105.368 92.12ZM91.5208 62.8237L62.4101 92.1239L54.5242 84.1866L83.6349 54.8865L91.5208 62.8237ZM76.0017 84.4408L83.8876 76.5036L112.998 105.804L105.112 113.741L76.0017 84.4408ZM97.4786 127.421L126.589 98.1205L134.476 106.058L105.365 135.358L97.4786 127.421ZM94.669 30.6567L79.7922 15.683L94.669 0.709411L109.546 15.683L94.669 30.6567ZM94.6691 188.291L79.7923 173.317L94.6691 158.343L109.546 173.317L94.6691 188.291Z"
      />
    </svg>
  );
}

type LogoProps = { size?: number; spin?: boolean; variant?: "vinyl" | "ritual" };

export function Logo({ size = 40, spin = true, variant = "ritual" }: LogoProps) {
  return (
    <div className="flex items-center gap-3">
      <div className="relative grid place-items-center" style={{ width: size, height: size }}>
        {variant === "ritual" ? (
          <div className="absolute inset-0 grid place-items-center">
            <RitualMark size={size} spin={spin} />
          </div>
        ) : (
          <>
            <div
              className={`absolute inset-0 rounded-full bg-gradient-to-br from-drop via-anthem to-bass shadow-drop ${
                spin ? "animate-[spin_5s_linear_infinite]" : ""
              }`}
            >
              <div className="absolute inset-[14%] rounded-full border border-white/20" />
              <div className="absolute inset-[28%] rounded-full border border-white/15" />
            </div>
            <div
              className="relative grid place-items-center rounded-full bg-ink"
              style={{ width: size * 0.42, height: size * 0.42 }}
            >
              <svg width={size * 0.24} height={size * 0.24} viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M9 18V6l10-2v12" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="6.5" cy="18" r="2.8" fill="white" />
                <circle cx="16.5" cy="16" r="2.8" fill="white" />
              </svg>
            </div>
          </>
        )}
      </div>
      <div className="leading-tight">
        <p className="font-display text-lg font-extrabold tracking-tight">Ritual Arena</p>
        <p className="-mt-0.5 text-[10px] font-semibold uppercase tracking-[0.3em] text-drop">forge · your · identity</p>
      </div>
    </div>
  );
}
