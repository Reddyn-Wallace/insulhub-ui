export default function LoadingSkeleton() {
  return (
    <div className="space-y-3 px-4 pt-4">
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 animate-pulse"
        >
          <div className="h-5 bg-gray-200 rounded w-1/2 mb-3" />
          <div className="h-4 bg-gray-100 rounded w-3/4 mb-2" />
          <div className="h-4 bg-gray-100 rounded w-2/3 mb-3" />
          <div className="flex gap-2">
            <div className="h-6 bg-gray-100 rounded-full w-20" />
            <div className="h-6 bg-gray-100 rounded-full w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}
