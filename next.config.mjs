/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@react-pdf/renderer'],
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
