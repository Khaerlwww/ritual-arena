import { BookOpen, Coins, Fingerprint, Flame, Lightbulb, Sparkles, Swords, Wallet } from "lucide-react";

const gettingStarted = [
  "Connect your wallet",
  "Switch to Ritual Chain",
  "Forge your Identity Card",
];

const buildIdentity = [
  "Train your card",
  "Earn XP and AP",
  "Unlock progression",
  "Increase Identity Score",
];

const arena = [
  "Open Arena",
  "Check the current battle",
  "Support one side with AP (Arena uses its own internal ledger, not the on-chain RitualAP)",
  "Wait for settlement",
  "Claim rewards if your side wins",
  "Arena activity contributes to Arena Score",
];

const identityScore = [
  { label: "Training Score", weight: "40%" },
  { label: "Achievement Score", weight: "30%" },
  { label: "Arena Score", weight: "20%" },
  { label: "Collection Score", weight: "10%" },
];

const tips = [
  "Forge first before training",
  "Train when cooldown is ready",
  "AP is the on-chain RitualAP ERC-20 (21M cap, no premint) — earned from Training, used in the Pack marketplace, transferable wallet-to-wallet",
  "Arena Score is separate from AP and comes from battle activity",
  "Identity Score is the main progression score",
];

function SectionTitle({ icon: Icon, children }: { icon: typeof BookOpen; children: string }) {
  return (
    <div className="title-grad flex items-center gap-1.5 px-1.5 py-[3px] font-ui text-[11px] font-bold text-ice">
      <Icon size={12} /> {children}
    </div>
  );
}

function StepItem({ index, children }: { index: number; children: string }) {
  return (
    <div className="bevel-in-thin flex items-center gap-2 bg-[#061512] px-2 py-1.5">
      <span className="grid h-5 w-5 place-items-center bg-teal2 font-ui text-[10px] font-bold text-coal">{index + 1}</span>
      <span>{children}</span>
    </div>
  );
}

export function RitualDocsWindow() {
  return (
    <div className="grid gap-4 font-mono text-[12px] leading-5 text-iceaccent/80">
      <section className="bevel-out bg-wgray p-[2px]">
        <SectionTitle icon={BookOpen}>Ritual Arena Guide</SectionTitle>
        <div className="bevel-in grid gap-3 bg-coal p-3">
          <div className="flex items-start gap-3">
            <div className="bevel-out grid h-10 w-10 shrink-0 place-items-center bg-wgray text-teal2">
              <Sparkles size={20} />
            </div>
            <div>
              <h2 className="font-display text-2xl font-extrabold text-ice">Ritual Arena</h2>
              <p className="mt-1 max-w-3xl">
                Ritual Arena lets you forge an Identity Card, train it over time, support Arena battles with AP, earn achievements, and grow your Identity Rank.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="bevel-out bg-wgray p-[2px]">
          <SectionTitle icon={Wallet}>Getting Started</SectionTitle>
          <div className="bevel-in grid gap-1.5 bg-coal p-3">
            {gettingStarted.map((step, i) => (
              <StepItem key={step} index={i}>{step}</StepItem>
            ))}
          </div>
        </div>

        <div className="bevel-out bg-wgray p-[2px]">
          <SectionTitle icon={Flame}>Build Your Identity</SectionTitle>
          <div className="bevel-in grid gap-1.5 bg-coal p-3">
            {buildIdentity.map((step, i) => (
              <StepItem key={step} index={i}>{step}</StepItem>
            ))}
          </div>
        </div>
      </section>

      <section className="bevel-out bg-wgray p-[2px]">
        <SectionTitle icon={Swords}>Arena</SectionTitle>
        <div className="bevel-in grid gap-1.5 bg-coal p-3">
          {arena.map((step, i) => (
            <StepItem key={step} index={i}>{step}</StepItem>
          ))}
        </div>
      </section>

      <section className="bevel-out bg-wgray p-[2px]">
        <SectionTitle icon={Coins}>Identity Score</SectionTitle>
        <div className="bevel-in grid gap-1.5 bg-coal p-3">
          <p className="text-iceaccent/65">
            Your Identity Score is the main progression number. It combines four sources:
          </p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {identityScore.map((s) => (
              <div key={s.label} className="bevel-in-thin flex items-center justify-between bg-[#061512] px-2 py-1.5">
                <span className="text-ice">{s.label}</span>
                <span className="font-ui font-bold text-aqua">{s.weight}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bevel-out bg-wgray p-[2px]">
        <SectionTitle icon={Lightbulb}>Quick Tips</SectionTitle>
        <div className="bevel-in grid gap-2 bg-coal p-3">
          {tips.map((tip) => (
            <div key={tip} className="bevel-in-thin flex items-start gap-2 bg-[#061512] p-2">
              <Fingerprint size={13} className="mt-0.5 shrink-0 text-aqua" />
              <p>{tip}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
