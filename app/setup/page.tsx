export default function Setup() {
  return (
    <div className="mx-auto max-w-xl p-6">
      <h1 className="h2">Configuration needed</h1>
      <p className="mb-3 text-sm">The application is running, but the Supabase environment variables are missing. In Vercel → Project → Settings → Environment Variables add:</p>
      <ul className="mb-3 list-disc pl-6 text-sm"><li><code>NEXT_PUBLIC_SUPABASE_URL</code></li><li><code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code></li><li><code>SUPABASE_SERVICE_ROLE_KEY</code> (server only)</li><li><code>NEXT_PUBLIC_SITE_URL</code> (your Vercel address)</li></ul>
      <p className="text-sm">Then redeploy.</p>
    </div>
  );
}
