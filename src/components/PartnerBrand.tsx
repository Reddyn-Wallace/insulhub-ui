import Image from "next/image";

export default function PartnerBrand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`overflow-hidden rounded-xl bg-white shadow-sm ${compact ? "h-10 w-10" : "h-14 w-14"}`}>
        <Image src="/icon-192x192.png" alt="" aria-hidden="true" width={56} height={56} className="h-full w-full object-cover" priority />
      </span>
      <span>
        <span className="block text-[10px] font-semibold tracking-[0.22em] text-white/75">Insulmax</span>
        <span className={`${compact ? "text-base" : "text-xl"} block font-bold tracking-[0.18em] text-[#f97316]`}>INSULHUB</span>
      </span>
    </div>
  );
}
