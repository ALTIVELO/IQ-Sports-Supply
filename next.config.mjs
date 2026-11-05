/** @type {import('next').NextConfig} */
const nextConfig = {
  // Left out of the bundle and required at run time instead. @react-pdf's
  // renderer and ExcelJS both reach for files inside their own packages
  // through paths webpack cannot follow; bundling them turns that into a
  // MODULE_NOT_FOUND at the moment a document is generated.
  serverExternalPackages: ['@react-pdf/renderer', 'pdfkit', 'exceljs'],
  // @react-pdf/renderer draws text through pdfkit, which loads its standard
  // fonts (Helvetica, Courier, …) from files inside its own package using a
  // path built at runtime rather than a static require(...) call — so Vercel's
  // build-time file trace never sees them and leaves them out of the
  // deployed function, which then crashes with MODULE_NOT_FOUND the moment
  // it tries to draw a character. Naming the files here is the fix: it
  // forces them into every route that renders a PDF, regardless of what the
  // trace could statically discover.
  //
  // Applied to every route rather than just the two PDF endpoints, because the
  // order confirmation email attaches the invoice — so notifications.ts
  // renders a PDF from inside a Server Action, and those are bundled into
  // whichever page imports them, not into /api/invoices/*. Naming those pages
  // instead would mean listing nearly every staff and portal route and
  // remembering to extend the list forever, and getting it wrong is invisible:
  // the render failure is caught so the confirmation still sends, just with no
  // invoice attached. A few MB on each function is the cheaper mistake.
  //
  // The Madison order form is the same kind of problem: supplier-sheet.ts
  // reads templates/madison-order.xlsx from disk at request time, by a path
  // the trace cannot see through, and the file is not under public/ — which
  // would not help anyway, since public/ is served from the CDN and is not on
  // the function's filesystem at all.
  outputFileTracingIncludes: {
    '/**': ['./node_modules/pdfkit/js/**/*', './templates/*.xlsx'],
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
