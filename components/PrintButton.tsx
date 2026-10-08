'use client';
export default function PrintButton({ label = 'Print' }: { label?: string }) {
  return <button type="button" className="btn btn-sec" onClick={() => window.print()}>{label}</button>;
}
