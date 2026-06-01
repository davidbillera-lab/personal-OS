export default function CrmPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-white">CRM</h1>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-white">Contacts</h2>
          <p className="text-xs text-gray-500">Client and prospect contact records — coming soon.</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-white">Lead Pipeline</h2>
          <p className="text-xs text-gray-500">Inbound leads by stage across all projects — coming soon.</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-white">Client Activity</h2>
          <p className="text-xs text-gray-500">Recent touchpoints and follow-up queue — coming soon.</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-white">Deals</h2>
          <p className="text-xs text-gray-500">Active deals and close-rate tracking — coming soon.</p>
        </div>
      </div>
    </div>
  )
}
