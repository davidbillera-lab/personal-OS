export default function CreativePage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-white">Creative</h1>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-white">Active Campaigns</h2>
          <p className="text-xs text-gray-500">Live marketing campaigns across all projects — coming soon.</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-white">Content Calendar</h2>
          <p className="text-xs text-gray-500">Scheduled content and publishing queue — coming soon.</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-white">Brand Assets</h2>
          <p className="text-xs text-gray-500">Logos, color palettes, and brand kits — coming soon.</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-white">Copy Bank</h2>
          <p className="text-xs text-gray-500">Reusable copy blocks and voice-approved templates — coming soon.</p>
        </div>
      </div>
    </div>
  )
}
