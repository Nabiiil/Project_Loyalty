export default function ScanLoading() {
  return (
    <main className="min-h-dvh flex items-center justify-center bg-white px-6">
      <div className="w-full max-w-xs flex flex-col items-center gap-6 text-center">
        <div className="w-12 h-12 rounded-full border-4 border-gray-200 border-t-gray-900 animate-spin" />
        <p className="text-gray-500">Recording your stamp…</p>
      </div>
    </main>
  )
}
