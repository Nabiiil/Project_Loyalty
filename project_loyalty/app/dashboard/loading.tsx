export default function DashboardLoading() {
  return (
    <main className="min-h-dvh bg-white px-5 py-10">
      <div className="mx-auto max-w-sm flex flex-col gap-6">
        <div className="h-8 w-28 rounded-lg bg-gray-100 animate-pulse" />
        <div className="flex flex-col gap-4">
          {[1, 2].map((i) => (
            <div key={i} className="rounded-2xl border border-gray-100 p-5 h-40 animate-pulse bg-gray-50" />
          ))}
        </div>
      </div>
    </main>
  )
}
