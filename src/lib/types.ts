export type Role = 'admin' | 'accounts' | 'ops' | 'client';
export type OrderStatus = 'open' | 'complete' | 'cancelled';
export type InvoiceType = 'full' | 'shipment' | 'backorder';
export type RequestStatus = 'pending' | 'approved' | 'rejected';
export type TransferStatus = 'draft' | 'in_transit' | 'received' | 'cancelled';
export type XeroStatus = 'not_synced' | 'synced' | 'error';

export type OrderEventType =
  | 'placed' | 'invoice_sent' | 'payment_received'
  | 'supplier_ordered' | 'stock_arrived' | 'packed' | 'shipped';

export interface Settings {
  id: number;
  company: string;
  company_address: string;
  invoice_prefix: string;
  next_invoice: number;
  next_order: number;
  next_po: number;
  next_transfer: number;
  vat_rate: number;
  payment_days: number;
  xero_account_code: string;
  tax_type_std: string;
  tax_type_zero: string;
  confirmation_cc: string[];
  supplier_recipient: string;
  application_recipient: string;
  email_from: string;
}

export interface Tier { id: string; name: string; sort: number }
export interface Location { id: string; name: string; address: string | null; active: boolean }
export interface Product { id: string; sku: string; name: string; brand: string | null; active: boolean }

export interface Client {
  id: string; name: string; tier_id: string; email: string | null; phone: string | null;
  vat_no: string | null; address: string | null; vat_exempt: boolean;
  default_location_id: string | null; auth_user_id: string | null; active: boolean;
}

export interface Order {
  id: string; number: string; client_id: string; date: string; status: OrderStatus;
  fulfilment_location_id: string; notes: string | null;
}

export interface OrderLine {
  id: string; order_id: string; product_id: string | null; sku: string; name: string;
  qty: number; unit_price: number; alloc_qty: number; bo_qty: number; po_qty: number;
  invoiced_ship: boolean;
}

export interface Invoice {
  id: string; number: string; order_id: string; client_id: string; type: InvoiceType;
  date: string; due_date: string; vat_rate: number; paid: boolean; paid_date: string | null;
  ready_to_pack: boolean; packed: boolean; packed_at: string | null;
  shipped: boolean; shipped_at: string | null;
  carrier: string | null; tracking_number: string | null; tracking_url: string | null;
  location_id: string; superseded: boolean;
  xero_id: string | null; xero_status: XeroStatus; xero_error: string | null; exported: boolean;
}

export interface InvoiceLine {
  id: string; invoice_id: string; sku: string; name: string; qty: number; unit_price: number;
}

export interface PurchaseOrder {
  id: string; number: string; date: string; received: boolean;
  received_at: string | null; receive_location_id: string;
}

export interface PoLine {
  id: string; po_id: string; sku: string; name: string; qty: number;
  so_reference: string | null; order_id: string | null; received_qty: number;
}

export interface OrderEvent {
  id: string; order_id: string; type: OrderEventType; created_at: string;
  meta: Record<string, unknown>;
}

export interface AccountRequest {
  id: string; company_name: string; contact_name: string; email: string; phone: string | null;
  vat_no: string | null; address: string | null; business_type: string | null;
  website: string | null; message: string | null; status: RequestStatus;
  created_at: string; review_note: string | null; client_id: string | null;
}

/** Ordered stages of the client-facing timeline. */
export const TIMELINE: { type: OrderEventType; label: string }[] = [
  { type: 'placed', label: 'Placed' },
  { type: 'invoice_sent', label: 'Invoice sent' },
  { type: 'payment_received', label: 'Payment received' },
  { type: 'supplier_ordered', label: 'Ordered from supplier' },
  { type: 'stock_arrived', label: 'Stock arrived' },
  { type: 'packed', label: 'Packed' },
  { type: 'shipped', label: 'Shipped' },
];
