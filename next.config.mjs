/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@react-pdf/renderer', 'pdfkit'],
  // @react-pdf/renderer draws text through pdfkit, which loads its standard
  // fonts (Helvetica, Courier, …) from files inside its own package using a
  // path built at runtime rather than a static require(...) call — so Vercel's
  // build-time file trace never sees them and leaves them out of the
  // deployed function, which then crashes with MODULE_NOT_FOUND the moment
  // it tries to draw a character. Naming the files here is the fix: it
  // forces them into every route that renders a PDF, regardless of what the
  // trace could statically discover.
  outputFileTracingIncludes: {
    '/api/invoices/*/pdf': ['./node_modules/pdfkit/js/**/*'],
    '/api/invoices/*/packing-list': ['./node_modules/pdfkit/js/**/*'],
  },
  experimental: {
    serverActions: {
      // The Import screen parses the uploaded sheet in the browser and sends
      // the mapped rows to a Server Action as a JSON argument. Next.js caps a
      // Server Action body at 1MB by default, which a real price, client or
      // stock sheet can exceed — and it is rejected before the action runs, so
      // the failure surfaces as a bare 500 rather than anything the import
      // screen can report. 10MB covers a full quarterly list across every tier
      // with room to spare.
      bodySizeLimit: '10mb',
    },
  },
};
export default nextConfig;
