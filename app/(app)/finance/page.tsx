export default function FinancePage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-white">Finance</h1>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-white">Revenue Overview</h2>
          <p className="text-xs text-gray-500">Revenue tracking across all portfolio projects — coming soon.</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-white">Expense Tracker</h2>
          <p className="text-xs text-gray-500">API costs, subscriptions, and ops expenses — coming soon.</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-white">Project P&amp;L</h2>
          <p className="text-xs text-gray-500">Per-project profit and loss — coming soon.</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-white">Invoices</h2>
          <p className="text-xs text-gray-500">Invoice log for client-facing projects — coming soon.</p>
        </div>
      </div>
    </div>
  )
}
